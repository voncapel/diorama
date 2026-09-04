/**
 * DOM clustering — PRD §5.2.
 * sig(el) = tagPath (.30) + classTokens (.30) + geometry (.25) + childShape (.15)
 */

export const CLUSTER_THRESHOLD = 0.72;

export interface Signature {
  tagPath: string;
  classTokens: Set<string>;
  w: number;
  h: number;
  childShape: Set<string>;
}

const HASHY = /^[a-z]*[-_]?[0-9a-f]{5,}$/i;

/** Strips CSS-in-JS hashes and numeric suffixes: `Card_root__x1f9a` → `card_root`. */
export function normalizeToken(token: string): string {
  const parts = token.split(/[-_]/).filter((p) => p.length > 0);
  const kept = parts.filter((p) => !HASHY.test(p) && !/^\d+$/.test(p));
  const base = (kept.length > 0 ? kept : parts).join('_');
  return base.replace(/\d+$/, '').toLowerCase();
}

function tagPathOf(el: Element): string {
  const path: string[] = [];
  let node: Element | null = el;
  for (let i = 0; i < 3 && node; i++) {
    path.push(node.tagName.toLowerCase());
    node = node.parentElement;
  }
  return path.join('>');
}

function childShapeOf(el: Element): Set<string> {
  const shape = new Set<string>();
  const kids = Array.from(el.children);
  shape.add(`n:${kids.length}`);
  for (const kid of kids) shape.add(`t:${kid.tagName.toLowerCase()}`);
  return shape;
}

export function signature(el: Element): Signature {
  const rect = el.getBoundingClientRect();
  const tokens = new Set<string>();
  for (const cls of Array.from(el.classList)) {
    const t = normalizeToken(cls);
    if (t) tokens.add(t);
  }
  return {
    tagPath: tagPathOf(el),
    classTokens: tokens,
    w: rect.width,
    h: rect.height,
    childShape: childShapeOf(el),
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Bucketised ±8% tolerance on each dimension. */
function geometryScore(a: Signature, b: Signature): number {
  const dim = (x: number, y: number) => {
    const max = Math.max(x, y);
    if (max === 0) return 1;
    const rel = Math.abs(x - y) / max;
    if (rel <= 0.08) return 1;
    return Math.max(0, 1 - (rel - 0.08) / 0.42);
  };
  return (dim(a.w, b.w) + dim(a.h, b.h)) / 2;
}

export function similarity(a: Signature, b: Signature): number {
  return (
    0.3 * (a.tagPath === b.tagPath ? 1 : 0) +
    0.3 * jaccard(a.classTokens, b.classTokens) +
    0.25 * geometryScore(a, b) +
    0.15 * jaccard(a.childShape, b.childShape)
  );
}

export interface ClusterResult {
  members: Element[];
  score: number;
}

/** Above this share of the viewport an element is a page section, not a card. */
const MAX_TARGET_AREA_RATIO = 0.4;

function colorHasVisibleAlpha(color: string): boolean {
  const value = color.trim().toLowerCase();
  if (!value || value === 'transparent') return false;

  const match = value.match(/^rgba?\((.*)\)$/);
  if (!match) return true;

  const body = match[1] ?? '';
  let alpha: string | undefined;
  if (body.includes('/')) {
    alpha = body.slice(body.lastIndexOf('/') + 1).trim();
  } else {
    const components = body.includes(',') ? body.split(',') : body.split(/\s+/);
    if (components.length >= 4) alpha = components.at(-1)?.trim();
  }
  if (alpha === undefined) return true;

  const parsed = Number.parseFloat(alpha);
  return !Number.isFinite(parsed) || parsed > 0;
}

function paintsOwnBox(el: Element): boolean {
  const style = getComputedStyle(el);
  if (colorHasVisibleAlpha(style.backgroundColor) || style.backgroundImage !== 'none') return true;

  const borders: Array<[string, string]> = [
    [style.borderTopWidth, style.borderTopStyle],
    [style.borderRightWidth, style.borderRightStyle],
    [style.borderBottomWidth, style.borderBottomStyle],
    [style.borderLeftWidth, style.borderLeftStyle],
  ];
  if (borders.some(([width, borderStyle]) => Number.parseFloat(width) > 0 && borderStyle !== 'none')) {
    return true;
  }

  return (
    style.boxShadow !== 'none' ||
    (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
  );
}

function boxesMatch(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.x - b.x) <= 2 &&
    Math.abs(a.y - b.y) <= 2 &&
    Math.abs(a.width - b.width) <= 2 &&
    Math.abs(a.height - b.height) <= 2
  );
}

/** Promotes a transparent wrapper to a same-sized ancestor that paints the visual box. */
export function promoteToVisualBox(el: Element): Element {
  if (paintsOwnBox(el)) return el;

  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  let current = el;

  for (let i = 0; i < 6; i++) {
    const parent = current.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;

    const currentRect = current.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    if (!boxesMatch(currentRect, parentRect)) break;
    if (parentRect.width * parentRect.height > viewportArea * MAX_TARGET_AREA_RATIO) break;

    const onlyVisibleChild = Array.from(parent.children).every((child) => {
      if (child === current) return true;
      const rect = child.getBoundingClientRect();
      return rect.width < 1 || rect.height < 1;
    });
    if (!onlyVisibleChild) break;

    current = parent;
    if (paintsOwnBox(current)) return current;
  }

  return el;
}

/** Number of similar-geometry siblings a candidate ancestor must have. */
function repeatedSiblingCount(el: Element, threshold: number): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  const sig = signature(el);
  let count = 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling === el) continue;
    const rect = sibling.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (similarity(sig, signature(sibling)) >= threshold) count++;
  }
  return count;
}

/**
 * The element under the cursor is the deepest descendant (a bare `<li>`), never
 * the visually meaningful unit. First promote transparent wrappers to a
 * same-sized ancestor that paints their visual box, then walk the whole ancestor
 * chain and keep the largest *repeated* one under 40% of the viewport.
 *
 * Stopping at the first non-repeated ancestor would fail on the common
 * `li > ul > .card` shape: the `<ul>` is a unique container, yet `.card` above
 * it is the real repeated unit. So every level is scored, not just the next.
 */
export function resolveTarget(el: Element, threshold = CLUSTER_THRESHOLD): Element {
  el = promoteToVisualBox(el);
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  let best = el;
  let bestArea = -1;
  let current: Element | null = el;

  for (let i = 0; i < 12 && current; i++) {
    if (current === document.body || current === document.documentElement) break;

    const r = current.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > viewportArea * MAX_TARGET_AREA_RATIO) break;

    if (area > bestArea && repeatedSiblingCount(current, threshold) > 0) {
      best = current;
      bestArea = area;
    }

    current = current.parentElement;
  }

  return best;
}

/** First pass: siblings of the same parent only (avoids massive false positives). */
export function clusterSiblings(target: Element, threshold = CLUSTER_THRESHOLD): ClusterResult {
  const parent = target.parentElement;
  if (!parent) return { members: [target], score: 1 };

  const sig = signature(target);
  const members: Element[] = [target];
  let total = 0;
  let count = 0;

  for (const sibling of Array.from(parent.children)) {
    if (sibling === target) continue;
    const rect = sibling.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const score = similarity(sig, signature(sibling));
    if (score >= threshold) {
      members.push(sibling);
      total += score;
      count++;
    }
  }

  return { members: staggerOrder(members), score: count > 0 ? total / count : 1 };
}

/** Second pass: widen to the whole page using the same signature. */
export function clusterDocument(target: Element, threshold = CLUSTER_THRESHOLD): ClusterResult {
  const sig = signature(target);
  const members: Element[] = [target];
  let total = 0;
  let count = 0;

  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (el === target) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const score = similarity(sig, signature(el));
    if (score >= threshold) {
      members.push(el);
      total += score;
      count++;
    }
  }

  return { members: staggerOrder(members), score: count > 0 ? total / count : 1 };
}

/** Stagger order derives from position: x then y. */
export function staggerOrder(elements: Element[]): Element[] {
  return [...elements].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.x - rb.x || ra.y - rb.y;
  });
}
