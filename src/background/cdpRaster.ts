import type {
  CaptureBundle,
  CaptureRaster,
  CaptureRasterLayer,
  LayerRect,
} from '../shared/types';

const PROTOCOL_VERSION = '1.3';
const LAYER_OVERFLOW_MARGIN = 48;

type Debuggee = chrome.debugger.Debuggee;
type CdpResult = Record<string, unknown>;

function send<T extends CdpResult>(
  target: Debuggee,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return chrome.debugger.sendCommand(target, method, params) as unknown as Promise<T>;
}

function pngDataUrl(base64: string): string {
  return `data:image/png;base64,${base64}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function evaluate<T>(target: Debuggee, expression: string): Promise<T> {
  const result = await send<{
    result?: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(target, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Runtime.evaluate failed',
    );
  }
  return result.result?.value as T;
}

async function waitForSettledPage(target: Debuggee): Promise<void> {
  await evaluate(
    target,
    `(async () => {
      const readiness = (async () => {
        if (document.fonts?.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images, image =>
          typeof image.decode === 'function' ? image.decode().catch(() => undefined) : undefined
        ));
      })();
      await Promise.race([readiness, new Promise(resolve => setTimeout(resolve, 2000))]);
      const frames = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.race([frames, new Promise(resolve => setTimeout(resolve, 250))]);
      return true;
    })()`,
  );
}

const RESTORE_EXPRESSION = `(() => {
  const state = globalThis.__dioramaNativeRasterState;
  if (!state) return false;
  state.style?.remove();
  for (const entry of state.attributes) {
    if (entry.value === null) entry.element.removeAttribute(entry.name);
    else entry.element.setAttribute(entry.name, entry.value);
  }
  delete globalThis.__dioramaNativeRasterState;
  return true;
})()`;

async function restorePage(target: Debuggee): Promise<void> {
  await evaluate(target, RESTORE_EXPRESSION).catch(() => undefined);
  await send(target, 'Emulation.setDefaultBackgroundColorOverride').catch(() => undefined);
}

async function preparePass(
  target: Debuggee,
  mode: 'oracle' | 'background' | 'layer',
  stableIds: string[],
  targetStableId?: string,
): Promise<void> {
  await restorePage(target);
  const payload = JSON.stringify({ mode, stableIds, targetStableId });
  await evaluate(
    target,
    `(async () => {
      const input = ${payload};
      const attributes = [];
      const remember = (element, name) => {
        if (!element) return;
        attributes.push({ element, name, value: element.getAttribute(name) });
      };
      const byStableId = id => Array.from(document.querySelectorAll('[data-dio-id]'))
        .find(element => element.getAttribute('data-dio-id') === id);
      const style = document.createElement('style');
      style.setAttribute('data-diorama-native-raster', '1');

      if (input.mode === 'background') {
        for (const id of input.stableIds) {
          const element = byStableId(id);
          if (!element) continue;
          remember(element, 'style');
          element.style.setProperty('visibility', 'hidden', 'important');
        }
      } else if (input.mode === 'layer') {
        const targetElement = byStableId(input.targetStableId);
        if (!targetElement) throw new Error('Selected live element not found: ' + input.targetStableId);
        remember(targetElement, 'data-diorama-raster-target');
        targetElement.setAttribute('data-diorama-raster-target', '1');
        for (const id of new Set(input.stableIds)) {
          if (id === input.targetStableId) continue;
          const element = byStableId(id);
          if (!element || element === targetElement || !targetElement.contains(element)) continue;
          remember(element, 'data-diorama-raster-excluded');
          element.setAttribute('data-diorama-raster-excluded', '1');
        }
        style.textContent =
          ':root *{visibility:hidden!important}' +
          '[data-diorama-raster-target],[data-diorama-raster-target] *{visibility:visible!important}' +
          '[data-diorama-raster-target] [data-diorama-raster-excluded],[data-diorama-raster-target] [data-diorama-raster-excluded] *{visibility:hidden!important}' +
          'html,body{background:transparent!important}';
      }

      for (const element of document.querySelectorAll('[data-diorama-overlay],[data-diorama-ui]')) {
        remember(element, 'style');
        element.style.setProperty('visibility', 'hidden', 'important');
      }
      document.documentElement.appendChild(style);
      globalThis.__dioramaNativeRasterState = { attributes, style };
      const frames = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.race([frames, new Promise(resolve => setTimeout(resolve, 250))]);
      return true;
    })()`,
  );
  if (mode === 'layer') {
    await send(target, 'Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
  }
}

async function screenshot(target: Debuggee, rect: LayerRect): Promise<string> {
  const result = await send<{ data?: string }>(target, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    optimizeForSpeed: false,
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 },
  });
  if (!result.data) throw new Error('Page.captureScreenshot returned no PNG');
  return pngDataUrl(result.data);
}

function expandRect(rect: LayerRect, documentWidth: number, documentHeight: number): LayerRect {
  const x = Math.max(0, Math.floor(rect.x - LAYER_OVERFLOW_MARGIN));
  const y = Math.max(0, Math.floor(rect.y - LAYER_OVERFLOW_MARGIN));
  const right = Math.min(documentWidth, Math.ceil(rect.x + rect.w + LAYER_OVERFLOW_MARGIN));
  const bottom = Math.min(documentHeight, Math.ceil(rect.y + rect.h + LAYER_OVERFLOW_MARGIN));
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

/** Enriches a clone bundle with compositor-native PNGs. Never leaves the page mutated or attached. */
export async function captureNativeRaster(tabId: number, bundle: CaptureBundle): Promise<CaptureRaster> {
  const target: Debuggee = { tabId };
  let attached = false;
  let stage = 'attach';
  try {
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
    attached = true;
    stage = 'enable domains';
    await send(target, 'Page.enable');
    await send(target, 'Runtime.enable');
    stage = 'settle page';
    await waitForSettledPage(target);

    stage = 'read layout metrics';
    const metrics = await send<{
      contentSize?: { width?: number; height?: number };
      visualViewport?: { clientWidth?: number; clientHeight?: number };
    }>(target, 'Page.getLayoutMetrics');
    const documentWidth = Math.max(
      1,
      Math.ceil(metrics.contentSize?.width ?? bundle.layers[0]?.rect.w ?? bundle.viewport.width),
    );
    const documentHeight = Math.max(
      1,
      Math.ceil(metrics.contentSize?.height ?? bundle.layers[0]?.rect.h ?? bundle.viewport.height),
    );
    const fullRect: LayerRect = { x: 0, y: 0, w: documentWidth, h: documentHeight };
    const stableIds = bundle.layers
      .filter(layer => layer.role === 'zap')
      .map(layer => layer.stableId)
      .filter((id): id is string => Boolean(id));

    stage = 'prepare oracle';
    await preparePass(target, 'oracle', stableIds);
    stage = 'capture oracle';
    const oraclePng = await screenshot(target, fullRect);

    const layers: CaptureRasterLayer[] = [];
    for (const layer of bundle.layers.filter(candidate => candidate.role === 'zap')) {
      if (!layer.stableId) {
        layers.push({ layerId: layer.id, error: 'missing stableId' });
        continue;
      }
      const sourceRect = expandRect(layer.rect, documentWidth, documentHeight);
      try {
        stage = `prepare layer ${layer.id}`;
        await preparePass(target, 'layer', stableIds, layer.stableId);
        stage = `capture layer ${layer.id}`;
        layers.push({ layerId: layer.id, sourceRect, png: await screenshot(target, sourceRect) });
      } catch (error) {
        layers.push({ layerId: layer.id, sourceRect, error: errorMessage(error) });
      }
    }

    return {
      method: 'cdp-page-capture-screenshot',
      viewport: {
        width: Math.ceil(metrics.visualViewport?.clientWidth ?? bundle.viewport.width),
        height: Math.ceil(metrics.visualViewport?.clientHeight ?? bundle.viewport.height),
      },
      document: { width: documentWidth, height: documentHeight },
      dpr: bundle.viewport.dpr,
      oraclePng,
      layers,
    };
  } catch (error) {
    return { method: 'cdp-page-capture-screenshot', error: `${stage}: ${errorMessage(error)}` };
  } finally {
    if (attached) {
      await restorePage(target);
      await chrome.debugger.detach(target).catch(() => undefined);
    }
  }
}
