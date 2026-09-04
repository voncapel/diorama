import type { CaptureBundle, LayerRect } from '../../shared/types';

export interface BuiltScene {
  /** The offscreen <canvas layoutsubtree> hosting the reconstructed DOM. */
  host: HTMLCanvasElement;
  /** The host 2D context — the only context allowed to draw its own snapshots. */
  ctx: CanvasRenderingContext2D;
  /** layerId → the element inside the reconstructed DOM tree. */
  elements: Map<string, HTMLElement>;
  /** layerId → rect measured in the rebuilt scene, relative to the root. */
  rects: Map<string, LayerRect>;
  /** Styles owned by this build; disposed by identity to avoid cross-build races. */
  injectedStyles: HTMLStyleElement[];
  /** Captures a layer texture using Zero-Reflow Multi-Pass isolation into scratchCtx. */
  captureLayerTexture: (
    layerId: string,
    scratchCtx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => Promise<void>;
}

export class HtmlInCanvasUnsupportedError extends Error {
  constructor() {
    super(
      "L'API HTML-in-Canvas est absente. Lancez Chrome/Chromium 147+ avec " +
        '--enable-blink-features=HTMLInCanvas (chrome://flags/#canvas-draw-element).',
    );
    this.name = 'HtmlInCanvasUnsupportedError';
  }
}

/** Raised when the paint record is missing — almost always a backgrounded tab. */
export class PaintRecordUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      "Aucun rendu disponible pour cet élément. L'onglet du studio doit rester au " +
        "premier plan et visible pendant la capture et l'export : Chromium ne peint " +
        `pas les onglets en arrière-plan. (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'PaintRecordUnavailableError';
  }
}

export function isHtmlInCanvasSupported(): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return (
    typeof canvas.requestPaint === 'function' &&
    typeof canvas.captureElementImage === 'function' &&
    !!ctx &&
    typeof ctx.drawElementImage === 'function'
  );
}

function injectFonts(bundle: CaptureBundle, doc: Document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.dataset['diorama'] = 'fonts';
  style.textContent = bundle.fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:${f.src};font-display:block;}`,
    )
    .join('\n');
  doc.head.appendChild(style);
  return style;
}

function injectScopedSheet(bundle: CaptureBundle, doc: Document): HTMLStyleElement {
  const style = doc.createElement('style');
  style.dataset['diorama'] = 'scoped';
  style.textContent = bundle.styles;
  doc.head.appendChild(style);
  return style;
}

/** Resolves once the tab is foreground — a hidden tab never paints (G2). */
function waitForVisible(doc: Document, timeoutMs = 10000): Promise<void> {
  if (doc.visibilityState === 'visible') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      doc.removeEventListener('visibilitychange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (doc.visibilityState === 'visible') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    doc.addEventListener('visibilitychange', onChange);
  });
}

/** Requests a paint and resolves once the host emits `paint`, with rAF pump and timeout fallback. */
function requestAndWaitForPaint(host: HTMLCanvasElement, timeoutMs = 2500): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      host.removeEventListener('paint', finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    host.addEventListener('paint', finish, { once: true });
    host.requestPaint();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {});
    });
  });
}

/** Captures element image with retry for frame synchronization. */
async function captureWithRetry(
  host: HTMLCanvasElement,
  root: HTMLElement,
  maxAttempts = 5,
): Promise<ElementImage> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return host.captureElementImage(root);
    } catch (err) {
      if (attempt === maxAttempts - 1) throw new PaintRecordUnavailableError(err);
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
      await requestAndWaitForPaint(host, 1200);
    }
  }
  throw new PaintRecordUnavailableError('Capture attempt exhausted');
}


export function hasCompleteNativeRaster(bundle: CaptureBundle): boolean {
  const raster = bundle.raster;
  if (!raster || raster.error) return false;
  return bundle.layers
    .filter((layer) => layer.role === 'zap')
    .every((layer) => raster.layers?.some((capture) => capture.layerId === layer.id && capture.png));
}

function loadRasterImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('PNG raster natif illisible'));
    image.src = dataUrl;
  });
}

async function buildNativeScene(bundle: CaptureBundle, doc: Document): Promise<BuiltScene> {
  const raster = bundle.raster!;
  const host = doc.createElement('canvas');
  host.dataset['diorama'] = 'native-raster-host';
  host.width = Math.max(1, raster.document?.width ?? bundle.layers[0]?.rect.w ?? bundle.viewport.width);
  host.height = Math.max(1, raster.document?.height ?? bundle.layers[0]?.rect.h ?? bundle.viewport.height);
  const ctx = host.getContext('2d');
  if (!ctx) throw new Error('Contexte 2D indisponible pour les rasters natifs');

  const elements = new Map<string, HTMLElement>();
  const rects = new Map<string, LayerRect>();
  for (const layer of bundle.layers) {
    elements.set(layer.id, doc.createElement('div'));
    if (layer.role === 'background') {
      rects.set(layer.id, { x: 0, y: 0, w: host.width, h: host.height });
    } else {
      const nativeLayer = raster.layers?.find((capture) => capture.layerId === layer.id);
      rects.set(layer.id, nativeLayer?.sourceRect ?? layer.rect);
    }
  }

  const captureLayerTexture: BuiltScene['captureLayerTexture'] = async (
    layerId,
    scratchCtx,
    width,
    height,
  ) => {
    const layer = bundle.layers.find((candidate) => candidate.id === layerId);
    if (layer?.role === 'background') {
      const color = layer.backgroundColor ?? '#ffffff';
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.fillStyle = color;
      scratchCtx.fillRect(0, 0, width, height);
      return;
    }
    const dataUrl = raster.layers?.find((capture) => capture.layerId === layerId)?.png;
    if (!dataUrl) throw new Error(`Raster natif absent pour la couche ${layerId}`);
    const image = await loadRasterImage(dataUrl);
    scratchCtx.clearRect(0, 0, width, height);
    scratchCtx.drawImage(image, 0, 0, width, height);
  };

  return { host, ctx, elements, rects, injectedStyles: [], captureLayerTexture };
}

/**
 * Rebuilds the captured DOM inside an offscreen <canvas layoutsubtree>.
 *
 * Zero-Reflow Multi-Pass Architecture:
 * The DOM clone remains 100% intact with its original CSS hierarchy (no hoisting,
 * no wrapper reset, no reflow). `root` is the sole immediate child of `host`
 * with `drawable`.
 *
 * Each layer is isolated using CSS `visibility` cascading:
 * - Background pass: zapped layers receive `visibility: hidden`, painting the background clean.
 * - Layer passes: `root` receives `visibility: hidden` and the target layer receives
 *   `visibility: visible`, rendering only the target at its exact page coordinates.
 */
export async function buildScene(
  bundle: CaptureBundle,
  doc: Document = document,
): Promise<BuiltScene> {
  if (hasCompleteNativeRaster(bundle)) return buildNativeScene(bundle, doc);
  if (!isHtmlInCanvasSupported()) throw new HtmlInCanvasUnsupportedError();

  const injectedStyles = [injectFonts(bundle, doc), injectScopedSheet(bundle, doc)];

  const host = doc.createElement('canvas');
  host.dataset['diorama'] = 'host';
  host.width = bundle.viewport.width;
  const bgLayer = bundle.layers.find((l) => l.role === 'background');
  host.height = Math.max(bundle.viewport.height, bgLayer?.rect.h ?? bundle.viewport.height);
  host.setAttribute('layoutsubtree', '');
  // Must stay geometrically inside the viewport: offscreen, opacity:0, visibility:hidden
  // and display:none all kill the paint record, so hide it behind the 3D viewport instead.
  host.style.cssText = `position:fixed;left:0;top:0;width:${host.width}px;height:${host.height}px;pointer-events:none;z-index:-1;`;

  const ctx = host.getContext('2d');
  if (!ctx) throw new Error('Contexte 2D indisponible sur le canvas hôte');

  const wrapper = doc.createElement('div');
  wrapper.innerHTML = bundle.html;
  const root = wrapper.firstElementChild;
  if (!root || !(root instanceof HTMLElement)) throw new Error('Bundle HTML vide');

  root.setAttribute('drawable', '');
  host.appendChild(root);
  doc.body.appendChild(host);

  // A pair of animation frames only proves that layout had a chance to run;
  // data-URI fonts and images can still be decoding on another thread. Wait on
  // their actual readiness signals so repeated builds cannot capture a FOUT or
  // an empty/partially decoded image.
  await waitForVisible(doc);
  await doc.fonts.ready;
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
  await requestAndWaitForPaint(host);

  const elements = new Map<string, HTMLElement>();
  const rects = new Map<string, LayerRect>();

  const rootRect = root.getBoundingClientRect();

  // Measure all layers in their pristine, un-shifted DOM positions.
  for (const layer of bundle.layers) {
    if (layer.role === 'background') {
      elements.set(layer.id, root);
      rects.set(layer.id, {
        x: 0,
        y: 0,
        w: rootRect.width || layer.rect.w,
        h: rootRect.height || layer.rect.h,
      });
      continue;
    }

    const el = root.querySelector(layer.selector);
    if (!(el instanceof HTMLElement)) continue;

    const r = el.getBoundingClientRect();
    elements.set(layer.id, el);
    rects.set(layer.id, {
      x: r.left - rootRect.left,
      y: r.top - rootRect.top,
      w: r.width || layer.rect.w,
      h: r.height || layer.rect.h,
    });
  }

  const bgLayerId = bgLayer?.id ?? 'L0';
  const zappedLayers = bundle.layers.filter((l) => l.role !== 'background');

  const captureLayerTexture = async (
    layerId: string,
    scratchCtx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): Promise<void> => {
    await waitForVisible(doc);

    if (layerId === bgLayerId) {
      const color = bundle.layers.find((l) => l.id === bgLayerId)?.backgroundColor ?? '#ffffff';
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.fillStyle = color;
      scratchCtx.fillRect(0, 0, width, height);
      return;
    } else {
      // Zap layer pass: isolate target layer at its exact native position
      const targetEl = elements.get(layerId);
      const rect = rects.get(layerId);
      if (!targetEl || !rect) return;

      // Hide root so page background and ancestors are transparent
      root.style.setProperty('visibility', 'hidden', 'important');

      // Ensure only targetEl is visible
      for (const l of zappedLayers) {
        const el = elements.get(l.id);
        if (!el) continue;
        if (l.id === layerId) {
          el.style.setProperty('visibility', 'visible', 'important');
        } else {
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }

      await requestAndWaitForPaint(host);
      const image = await captureWithRetry(host, root);

      ctx.clearRect(0, 0, host.width, host.height);
      ctx.drawElementImage(image, 0, 0);

      // Blit target sub-region from host canvas into scratchCtx
      scratchCtx.clearRect(0, 0, width, height);
      scratchCtx.drawImage(
        host,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        0,
        0,
        width,
        height,
      );

      // Restore visibility styles
      root.style.removeProperty('visibility');
      for (const l of zappedLayers) {
        const el = elements.get(l.id);
        if (el) el.style.removeProperty('visibility');
      }
    }
  };

  return { host, ctx, elements, rects, injectedStyles, captureLayerTexture };
}

export function disposeScene(scene: BuiltScene) {
  scene.host.remove();
  for (const style of scene.injectedStyles) style.remove();
}
