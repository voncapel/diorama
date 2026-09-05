import type {
  CaptureBundle,
  CaptureCluster,
  CaptureFont,
  CaptureLayer,
  FetchAssetResponse,
} from '../shared/types';
import { inferCaptureGroups } from '../shared/groups';

/**
 * Style capture is exhaustive: every computed longhand that differs from the
 * user-agent default of the *same tag* is emitted. A short whitelist was
 * measured to drop layout-critical longhands (logical box properties, SVG
 * geometry, line-clamp, float, wrapping) and desynchronised the rebuilt clone
 * from the live page. The denylist below only removes longhands with no effect
 * on a static repaint.
 */
const DENIED_PROP_RE =
  /^(?:--|cursor|pointer-events|user-select|touch-action|scroll-|overscroll|will-change|contain|content-visibility|view-transition|view-timeline|anchor|position-|timeline|animation-|transition-|caret-color|-webkit-tap|-webkit-locale|-webkit-user|overflow-anchor|speak|orphans|widows|resize|nav-|offset-|page|print-|math-|ruby-|counter-|quotes|unicode-bidi|text-orientation|forced-color|accent-color|color-scheme|field-sizing|interactivity)/;

/**
 * Longhands the studio neutralises with an *inline* WRAPPER_RESET when it
 * rebuilds an ancestor chain (sceneBuilder G3 hoisting). An `!important`
 * declaration from the scoped sheet would beat that inline reset and misplace
 * every hoisted layer, so these stay non-important; everything else is emitted
 * `!important` to survive studio.css selectors that outrank a single `.dio-N`.
 */
const NO_IMPORTANT_RE =
  /^(?:display|position|top|right|bottom|left|inset|float|clear|box-sizing|margin|padding|border|background|box-shadow|transform|translate|rotate|scale|width|height|min-|max-|inline-size|block-size|overflow|flex|grid|place-|align-self|justify-self)/;

/** url()-bearing longhands must be inlined as data: URIs (C2 workaround). */
const URL_VALUE_RE = /\burl\(/;

const SKIPPED_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'LINK', 'META', 'STYLE', 'TEMPLATE']);

const PROBE_ATTR = 'data-dio-probe';
const SVG_NS = 'http://www.w3.org/2000/svg';

const DEPENDENT_GROUPS = new Map<string, readonly string[]>();
const RAW_DEPENDENT_GROUPS: readonly (readonly string[])[] = [
  ...(['top', 'right', 'bottom', 'left'] as const).map((side) => [
    `border-${side}-width`,
    `border-${side}-style`,
    `border-${side}-color`,
  ]),
  ['outline-width', 'outline-style', 'outline-color', 'outline-offset'],
  ['column-rule-width', 'column-rule-style', 'column-rule-color'],
  ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'],
  ['text-emphasis-style', 'text-emphasis-color'],
];
for (const group of RAW_DEPENDENT_GROUPS) {
  for (const prop of group) {
    DEPENDENT_GROUPS.set(prop, group);
  }
}

const UA_ATTRS = new Set([
  'href',
  'type',
  'hidden',
  'dir',
  'disabled',
  'checked',
  'readonly',
  'multiple',
  'size',
  'rows',
  'cols',
  'align',
  'valign',
  'width',
  'height',
  'color',
  'bgcolor',
  'border',
  'nowrap',
  'cellpadding',
  'cellspacing',
  'hspace',
  'vspace',
  'noshade',
  'face',
  'start',
  'contenteditable',
  'open',
  'reversed',
  'wrap',
  'lang',
  'inert',
  'popover',
  'selected',
  'required',
  'placeholder',
]);

const PROBE_SAFE_EMPTY_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED']);

const INHERITED_PROPS = new Set([
  'color',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'font-variation-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-align-last',
  'text-indent',
  'text-transform',
  'text-shadow',
  'text-rendering',
  'white-space',
  'white-space-collapse',
  'text-wrap',
  'text-wrap-mode',
  'text-wrap-style',
  'word-break',
  'overflow-wrap',
  'hyphens',
  'tab-size',
  'direction',
  'writing-mode',
  'visibility',
  'list-style-type',
  'list-style-position',
  'list-style-image',
  'border-collapse',
  'border-spacing',
  'caption-side',
  'empty-cells',
  'quotes',
  'color-interpolation',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'text-anchor',
  'dominant-baseline',
  'image-rendering',
  'paint-order',
  'shape-rendering',
  '-webkit-text-fill-color',
  '-webkit-font-smoothing',
  'text-size-adjust',
  'text-underline-position',
  'text-underline-offset',
  'text-spacing-trim',
  'font-palette',
  'math-depth',
]);

const INHERITED_PREFIXES = [
  'font-variant',
  'font-synthesis',
  'stroke-',
  '-webkit-text-stroke',
  'text-emphasis',
] as const;

function isInheritedProp(prop: string): boolean {
  if (INHERITED_PROPS.has(prop)) return true;
  for (const prefix of INHERITED_PREFIXES) {
    if (prop === prefix || prop.startsWith(prefix.endsWith('-') ? prefix : prefix + '-')) {
      return true;
    }
  }
  return false;
}

const URL_RE = /url\((['"]?)([^'")]+)\1\)/g;

const BACKGROUND_PROPS = [
  'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat',
] as const;

/**
 * Detects the real solid background color of the source page.
 * Returns a 7-character hex string (#rrggbb) if the page has a simple solid color,
 * or '#ffffff' otherwise (images, gradients, transparent, or complex backgrounds).
 */
export function getPageBackgroundColor(): string {
  const extractSolidColor = (style: CSSStyleDeclaration): string | null => {
    const image = style.getPropertyValue('background-image');
    if (image && image !== 'none') {
      return null;
    }
    const color = style.getPropertyValue('background-color');
    if (!color || color === 'transparent') {
      return null;
    }

    // Match rgb(r, g, b) or rgba(r, g, b, a) in standard CSS syntax
    const rgbaMatch = color.match(
      /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+)\s*%?)?\)$/,
    );
    if (rgbaMatch) {
      const [, rStr, gStr, bStr, aStr] = rgbaMatch;
      if (aStr !== undefined) {
        const a = aStr.endsWith('%') ? parseFloat(aStr) / 100 : parseFloat(aStr);
        if (a < 1) return null; // not solid opaque
      }
      const r = Math.round(Number(rStr));
      const g = Math.round(Number(gStr));
      const b = Math.round(Number(bStr));
      return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
    }

    // Fallback: 1x1 canvas probe to parse hex, named colors, or modern color(...) notations
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        const r = data[0] ?? 0;
        const g = data[1] ?? 0;
        const b = data[2] ?? 0;
        const a = data[3] ?? 0;
        if (a < 255) return null; // not fully opaque
        return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
      }
    } catch {
      // ignore
    }

    return null;
  };

  const bodyStyle = getComputedStyle(document.body);
  const bodyColor = extractSolidColor(bodyStyle);
  if (bodyColor) return bodyColor;

  const htmlStyle = getComputedStyle(document.documentElement);
  const htmlColor = extractSolidColor(htmlStyle);
  if (htmlColor) return htmlColor;

  // Check root wrapper (e.g. Next.js #__next, Vite #root, <main>) if body/html are unstyled
  const firstChild = document.body.firstElementChild;
  if (firstChild instanceof HTMLElement) {
    const childStyle = getComputedStyle(firstChild);
    const childColor = extractSolidColor(childStyle);
    if (childColor) {
      const rect = firstChild.getBoundingClientRect();
      if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9) {
        return childColor;
      }
    }
  }

  return '#ffffff';
}

function isTransparentBackground(style: CSSStyleDeclaration): boolean {
  const color = style.getPropertyValue('background-color');
  const image = style.getPropertyValue('background-image');
  const hasColor = !!color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color);
  const hasImage = !!image && image !== 'none';
  return !hasColor && !hasImage;
}

/**
 * The page background lives on <body> — or, when that is transparent, on
 * <html>. The clone root is a plain <div>, so neither propagates to it.
 */
async function rootBackgroundDecls(
  assets: Record<string, string>,
): Promise<Record<string, string>> {
  const bodyStyle = getComputedStyle(document.body);
  const source = isTransparentBackground(bodyStyle)
    ? getComputedStyle(document.documentElement)
    : bodyStyle;

  const decls: Record<string, string> = {};
  for (const prop of BACKGROUND_PROPS) {
    const v = source.getPropertyValue(prop);
    if (v && v !== 'none') decls[prop] = v;
  }
  if (decls['background-image']) {
    decls['background-image'] = await inlineCssUrls(decls['background-image'], assets);
  }
  return decls;
}

async function fetchAsset(url: string): Promise<string | null> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'DIORAMA_FETCH_ASSET',
      url,
    })) as FetchAssetResponse;
    return res?.ok && res.dataUri ? res.dataUri : null;
  } catch {
    return null;
  }
}

function absoluteUrl(url: string): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('#')) return null;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return null;
  }
}

/** Rewrites every url() in a CSS value to a data: URI (C2 workaround). */
async function inlineCssUrls(
  value: string,
  assets: Record<string, string>,
): Promise<string> {
  if (!value.includes('url(')) return value;
  const targets = new Set<string>();
  for (const match of value.matchAll(URL_RE)) {
    const abs = absoluteUrl(match[2] ?? '');
    if (abs) targets.add(abs);
  }
  for (const abs of targets) {
    if (assets[abs] === undefined) {
      const data = await fetchAsset(abs);
      if (data) assets[abs] = data;
    }
  }
  return value.replace(URL_RE, (whole, _q: string, raw: string) => {
    const abs = absoluteUrl(raw);
    const data = abs ? assets[abs] : undefined;
    return data ? `url("${data}")` : whole;
  });
}

/** Snapshots every longhand of a computed style, denylist applied. */
function snapshotStyle(cs: CSSStyleDeclaration): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < cs.length; i++) {
    const prop = cs[i];
    if (!prop || DENIED_PROP_RE.test(prop)) continue;
    out.set(prop, cs.getPropertyValue(prop));
  }
  return out;
}

interface DefaultStyleSet {
  base: Map<string, string>;
  before: Map<string, string>;
  after: Map<string, string>;
}

/**
 * User-agent defaults, read from an empty same-origin about:blank iframe so the
 * host page's own stylesheets cannot pollute them. One entry per
 * (namespace, tagName); the cache is what keeps the exhaustive diff affordable.
 */
class DefaultStyleProbe {
  private readonly cache = new Map<string, DefaultStyleSet>();
  private frame: HTMLIFrameElement | null = null;
  private doc: Document | null = null;
  private view: (Window & typeof globalThis) | null = null;

  mount(): void {
    if (this.frame) return;
    const frame = document.createElement('iframe');
    frame.setAttribute(PROBE_ATTR, '1');
    frame.setAttribute('aria-hidden', 'true');
    frame.src = 'about:blank';
    frame.style.cssText =
      'position:absolute;top:0;left:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);
    this.frame = frame;
    // Same-origin about:blank: contentDocument is synchronously reachable.
    this.doc = frame.contentDocument;
    this.view = (frame.contentWindow as (Window & typeof globalThis) | null) ?? null;
  }

  unmount(): void {
    this.frame?.remove();
    this.frame = null;
    this.doc = null;
    this.view = null;
    this.cache.clear();
  }

  /** Defaults for `el`'s tag and UA-relevant attributes, or null when the probe document is unavailable. */
  defaultsFor(el: Element): DefaultStyleSet | null {
    const doc = this.doc;
    const view = this.view;
    if (!doc || !doc.body || !view) return null;

    const ns = el.namespaceURI ?? '';
    const tagName = el.tagName;
    const isSafeEmpty = PROBE_SAFE_EMPTY_TAGS.has(tagName.toUpperCase());

    const attrEntries: string[] = [];
    if (!isSafeEmpty) {
      for (const attr of Array.from(el.attributes)) {
        const lower = attr.name.toLowerCase();
        if (UA_ATTRS.has(lower)) {
          const val = lower === 'href' ? '#' : attr.value;
          attrEntries.push(`${lower}=${val}`);
        }
      }
      attrEntries.sort();
    }

    const key = `${ns}|${tagName}|${attrEntries.join(';')}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    let probe: Element;
    try {
      if (isSafeEmpty) {
        probe =
          ns && ns !== 'http://www.w3.org/1999/xhtml'
            ? doc.createElementNS(ns, tagName)
            : doc.createElement(tagName);
      } else {
        const rawClone = el.cloneNode(false) as Element;
        for (const attr of Array.from(rawClone.attributes)) {
          const lower = attr.name.toLowerCase();
          if (!UA_ATTRS.has(lower)) {
            rawClone.removeAttribute(attr.name);
          } else if (lower === 'href') {
            rawClone.setAttribute(attr.name, '#');
          }
        }
        probe = doc.importNode(rawClone, false);
      }
    } catch {
      return null;
    }

    // SVG geometry longhands only resolve inside an <svg> subtree.
    let host: Element = doc.body;
    let wrapper: Element | null = null;
    if (ns === SVG_NS && tagName.toLowerCase() !== 'svg') {
      wrapper = doc.createElementNS(SVG_NS, 'svg');
      doc.body.appendChild(wrapper);
      host = wrapper;
    }

    host.appendChild(probe);
    let set: DefaultStyleSet;
    try {
      set = {
        base: snapshotStyle(view.getComputedStyle(probe)),
        before: snapshotStyle(view.getComputedStyle(probe, '::before')),
        after: snapshotStyle(view.getComputedStyle(probe, '::after')),
      };
    } finally {
      probe.remove();
      wrapper?.remove();
    }

    this.cache.set(key, set);
    return set;
  }
}

/**
 * Emits every longhand whose computed value differs from the tag's user-agent
 * default. Inherited longhands are retained if they differ from the parent computed style.
 * Dependent longhands (e.g. border width/style/color) are retained together.
 */
function declarations(
  style: CSSStyleDeclaration,
  defaults: Map<string, string> | null,
  parent: CSSStyleDeclaration | null = null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const changed = new Set<string>();

  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    if (!prop || DENIED_PROP_RE.test(prop)) continue;
    const v = style.getPropertyValue(prop);
    if (!v) continue;

    if (isInheritedProp(prop)) {
      // Preserve the cascade instead of freezing the same inherited value on
      // every descendant. Besides producing much smaller bundles, this keeps
      // sceneBuilder's visibility-based layer isolation effective.
      if (parent?.getPropertyValue(prop) === v) continue;
      if (!parent && defaults?.get(prop) === v) continue;
    } else if (defaults?.get(prop) === v) {
      continue;
    }

    changed.add(prop);
    out[prop] = v;
  }

  for (const prop of changed) {
    const group = DEPENDENT_GROUPS.get(prop);
    if (!group) continue;
    for (const member of group) {
      if (out[member] !== undefined) continue;
      if (DENIED_PROP_RE.test(member)) continue;
      const v = style.getPropertyValue(member);
      if (v) {
        out[member] = v;
      }
    }
  }

  return out;
}

function serializeDecls(decls: Record<string, string>): string {
  return Object.entries(decls)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

function capturedSelector(cls: string, pseudo = ''): string {
  // `.dio-N.dio-N` matches the same single class but doubles specificity to
  // (0,2,0), outranking studio.css rules like `.field label` / `input[type=range]`
  // for the layout longhands that must stay non-important (see NO_IMPORTANT_RE).
  return `.${cls}.${cls}${pseudo}`;
}

/**
 * Deterministic order (sorted) plus `!important` on everything the studio does
 * not neutralise inline, so studio.css selectors outranking `.dio-N` lose.
 */
function serializeCapturedDecls(decls: Record<string, string>): string {
  return Object.keys(decls)
    .sort()
    .map((k) => `${k}:${decls[k]}${NO_IMPORTANT_RE.test(k) ? '' : ' !important'}`)
    .join(';');
}

/** Freezes a live <canvas> into a data: URI. */
function freezeCanvas(source: HTMLCanvasElement): string | null {
  try {
    return source.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Freezes a <video> into its current frame. */
function freezeVideo(video: HTMLVideoElement): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 640;
    c.height = video.videoHeight || 360;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch {
    return video.poster || null;
  }
}

interface WalkContext {
  styles: string[];
  assets: Record<string, string>;
  counter: { n: number };
  probe: DefaultStyleProbe;
}

/** Inlines every url() the exhaustive capture pulled in (backgrounds, masks, borders…). */
async function inlineDeclUrls(
  decls: Record<string, string>,
  assets: Record<string, string>,
): Promise<void> {
  for (const prop of Object.keys(decls)) {
    const v = decls[prop];
    if (v && URL_VALUE_RE.test(v)) decls[prop] = await inlineCssUrls(v, assets);
  }
}

/**
 * Clones `source` into an inert tree, emitting one generated class per element.
 * Scoped sheet (not inline style) so ::before/::after survive — PRD §5.1.
 */
async function cloneWithStyles(
  source: Element,
  ctx: WalkContext,
  parentComputed: CSSStyleDeclaration | null = null,
): Promise<Element | null> {
  if (SKIPPED_TAGS.has(source.tagName)) return null;
  if (source.hasAttribute(PROBE_ATTR)) return null; // never clone the default-style probe

  const computed = getComputedStyle(source);
  if (computed.display === 'none') return null;

  const clone = source.cloneNode(false) as Element;
  for (const attr of ['onclick', 'onload', 'onerror', 'srcset', 'loading']) {
    clone.removeAttribute(attr);
  }
  // SVG paint servers and reuse nodes resolve through fragment IDs
  // (url(#gradient), <use href="#symbol">, masks, clips, filters…). Removing
  // those IDs makes otherwise valid graphics disappear in the rebuilt tree.
  if (source.namespaceURI !== SVG_NS) clone.removeAttribute('id');
  // Strip framework controller attributes (Stimulus, Alpine, etc.) so cloned DOM doesn't trigger host scripts
  for (const attr of Array.from(clone.attributes)) {
    if (
      attr.name.startsWith('data-controller') ||
      attr.name.startsWith('data-action') ||
      attr.name.includes('-target') ||
      attr.name.startsWith('data-turbo')
    ) {
      clone.removeAttribute(attr.name);
    }
  }

  const cls = `dio-${ctx.counter.n++}`;
  clone.setAttribute('class', `${source.getAttribute('class') ?? ''} ${cls}`.trim());

  const defaults = ctx.probe.defaultsFor(source);

  const decls = declarations(computed, defaults?.base ?? null, parentComputed);
  await inlineDeclUrls(decls, ctx.assets);
  ctx.styles.push(`${capturedSelector(cls)}{${serializeCapturedDecls(decls)}}`);

  // Pseudos diff against the *same pseudo of the same tag's default probe*:
  // diffing against the host element would wrongly drop inherited text styles
  // that the pseudo needs restated once it is detached from the site's cascade.
  for (const pseudo of ['::before', '::after'] as const) {
    const ps = getComputedStyle(source, pseudo);
    const content = ps.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') continue;
    const pdefaults = pseudo === '::before' ? defaults?.before : defaults?.after;
    const pdecls = declarations(ps, pdefaults ?? null, computed);
    pdecls['content'] = content;
    await inlineDeclUrls(pdecls, ctx.assets);
    ctx.styles.push(`${capturedSelector(cls, pseudo)}{${serializeCapturedDecls(pdecls)}}`);
  }

  // Media: inline or freeze.
  if (source instanceof HTMLImageElement) {
    const abs = absoluteUrl(source.currentSrc || source.src);
    if (abs) {
      if (ctx.assets[abs] === undefined) {
        const data = await fetchAsset(abs);
        if (data) ctx.assets[abs] = data;
      }
      const data = ctx.assets[abs];
      if (data) clone.setAttribute('src', data);
    }
  } else if (source instanceof HTMLCanvasElement) {
    const data = freezeCanvas(source);
    const img = document.createElement('img');
    img.setAttribute('class', clone.getAttribute('class') ?? '');
    if (data) img.setAttribute('src', data);
    return img;
  } else if (source instanceof HTMLVideoElement) {
    const data = freezeVideo(source);
    const img = document.createElement('img');
    img.setAttribute('class', clone.getAttribute('class') ?? '');
    if (data) img.setAttribute('src', data);
    return img;
  } else if (source instanceof HTMLIFrameElement) {
    // Cross-origin iframes are never painted; drop them rather than leave a hole.
    return clone;
  }

  // Flatten open shadow roots.
  const roots: (Element | ShadowRoot)[] = [source];
  if ((source as HTMLElement).shadowRoot) {
    roots.push((source as HTMLElement).shadowRoot as ShadowRoot);
  }

  for (const root of roots) {
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        clone.appendChild(document.createTextNode(child.textContent ?? ''));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const sub = await cloneWithStyles(child as Element, ctx, computed);
        if (sub) clone.appendChild(sub);
      }
    }
  }

  return clone;
}

/** Best-effort inlining of same-origin-readable @font-face rules. */
async function collectFonts(assets: Record<string, string>): Promise<CaptureFont[]> {
  const fonts: CaptureFont[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet, not readable
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const src = rule.style.getPropertyValue('src');
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '');
      if (!src || !family) continue;
      const inlined = await inlineCssUrls(src, assets);
      if (!inlined.includes('data:')) continue;
      fonts.push({
        family,
        weight: rule.style.getPropertyValue('font-weight') || '400',
        style: rule.style.getPropertyValue('font-style') || 'normal',
        src: inlined,
      });
    }
  }
  return fonts;
}

const OWNED_ID_ATTR = 'data-dio-owned-id';
const PREVIOUS_VISIBILITY_ATTR = 'data-dio-previous-inline-visibility';

export function tagLiveElements(): void {
  let id = 1;
  const usedIds = new Set(
    Array.from(document.body.querySelectorAll('[data-dio-id]'))
      .map((el) => el.getAttribute('data-dio-id'))
      .filter((value): value is string => value !== null),
  );
  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    if (SKIPPED_TAGS.has(el.tagName)) continue;
    if (el.closest('[data-diorama-root]') || el.closest('#diorama-root')) continue;
    if (!el.hasAttribute('data-dio-id')) {
      while (usedIds.has(String(id))) id++;
      const value = String(id++);
      el.setAttribute('data-dio-id', value);
      el.setAttribute(OWNED_ID_ATTR, '1');
      usedIds.add(value);
    }
  }
}

export function hideLiveElement(el: HTMLElement): void {
  if (!el.hasAttribute(PREVIOUS_VISIBILITY_ATTR)) {
    el.setAttribute(PREVIOUS_VISIBILITY_ATTR, el.style.visibility);
  }
  el.style.visibility = 'hidden';
  el.setAttribute('data-dio-hidden', '1');
}

function restoreElementVisibility(el: HTMLElement): void {
  if (el.hasAttribute(PREVIOUS_VISIBILITY_ATTR)) {
    el.style.visibility = el.getAttribute(PREVIOUS_VISIBILITY_ATTR) ?? '';
  } else if (el.hasAttribute('data-dio-hidden')) {
    // Compatibility with elements detached by an older runtime.
    el.style.visibility = '';
  }
  el.removeAttribute(PREVIOUS_VISIBILITY_ATTR);
  el.removeAttribute('data-dio-hidden');
}

/** Restores only selectors produced from a stable data-dio-id marker. */
export function restoreLiveElement(selector: string, doc: Document = document): boolean {
  const match = /^\[data-dio-id="([^"]+)"\]$/.exec(selector);
  const stableId = match?.[1];
  if (!stableId) return false;
  const el = Array.from(doc.querySelectorAll<HTMLElement>('[data-dio-id]')).find(
    (candidate) => candidate.getAttribute('data-dio-id') === stableId,
  );
  if (!el) return false;
  restoreElementVisibility(el);
  return true;
}

export function cleanupLiveElements(): void {
  const hidden = document.querySelectorAll<HTMLElement>(
    `[data-dio-hidden], [${PREVIOUS_VISIBILITY_ATTR}]`,
  );
  for (const el of hidden) restoreElementVisibility(el);

  const all = document.body.querySelectorAll(`[${OWNED_ID_ATTR}]`);
  for (const el of all) {
    el.removeAttribute('data-dio-id');
    el.removeAttribute(OWNED_ID_ATTR);
  }
}

export function createLayerFromElement(
  el: Element,
  index: number,
  clusterId?: string,
): CaptureLayer {
  const r = el.getBoundingClientRect();
  const dioId = el.getAttribute('data-dio-id') || '';
  const id = `L${index}`;
  const tagName = el.tagName.toLowerCase();
  const rawClass = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
  const label = rawClass ? `${tagName}.${rawClass}` : `${tagName} ${id}`;

  return {
    id,
    role: 'zap',
    clusterId,
    selector: dioId ? `[data-dio-id="${dioId}"]` : tagName,
    rect: {
      x: r.x + window.scrollX,
      y: r.y + window.scrollY,
      w: r.width,
      h: r.height,
    },
    label,
    order: index,
  };
}

export interface SerializeInput {
  zapped: Element[];
  clusterScore: number;
}

export async function serializeCapture(input: SerializeInput = { zapped: [], clusterScore: 1 }): Promise<CaptureBundle> {
  const { zapped, clusterScore } = input;

  tagLiveElements();

  // Tag the live elements so the marker survives the clone.
  zapped.forEach((el, i) => el.setAttribute('data-diorama-layer', `L${i + 1}`));

  // The probe iframe lives in <body> during the walk; cloneWithStyles skips it
  // by attribute, and the finally block guarantees it never outlives the call.
  const probe = new DefaultStyleProbe();
  probe.mount();

  const ctx: WalkContext = { styles: [], assets: {}, counter: { n: 0 }, probe };
  let clone: Element | null;
  let fonts: CaptureFont[];
  try {
    clone = await cloneWithStyles(document.body, ctx, null);
    fonts = await collectFonts(ctx.assets);
  } finally {
    probe.unmount();
    zapped.forEach((el) => el.removeAttribute('data-diorama-layer'));
  }

  const background = await rootBackgroundDecls(ctx.assets);
  const scrollHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  const width = document.documentElement.clientWidth;

  const root = document.createElement('div');
  root.setAttribute('data-diorama-root', '1');
  root.style.cssText =
    `position:relative;width:${width}px;min-height:${scrollHeight}px;overflow:hidden;` +
    `${serializeDecls(background)};`;
  if (clone) root.appendChild(clone);

  const defaultBgColor = getPageBackgroundColor();

  const layers: CaptureLayer[] = [
    {
      id: 'L0',
      role: 'background',
      selector: '[data-diorama-root="1"]',
      stableId: 'background',
      rect: { x: 0, y: 0, w: width, h: scrollHeight },
      label: 'Fond de page',
      order: 0,
      backgroundColor: defaultBgColor,
    },
  ];

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  zapped.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const id = `L${i + 1}`;
    const dioId = el.getAttribute('data-dio-id');
    layers.push({
      id,
      role: 'zap',
      clusterId: 'C1',
      selector: `[data-diorama-layer="${id}"]`,
      ...(dioId ? { stableId: dioId } : {}),
      rect: {
        x: r.x + scrollX,
        y: r.y + scrollY,
        w: r.width,
        h: r.height,
      },
      label: `${el.tagName.toLowerCase()} ${id}`,
      order: i,
    });
  });

  const clusters: CaptureCluster[] =
    zapped.length > 0
      ? [
          {
            id: 'C1',
            score: clusterScore,
            memberIds: zapped.map((_, i) => `L${i + 1}`),
          },
        ]
      : [];

  const groups = inferCaptureGroups(layers);

  return {
    version: 1,
    source: {
      url: location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
    },
    viewport: {
      width,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX,
      scrollY,
    },
    html: root.outerHTML,
    styles: ctx.styles.join('\n'),
    assets: ctx.assets,
    fonts,
    layers,
    clusters,
    groups,
  };
}
