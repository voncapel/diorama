import type { InspectPageResult, PageCandidate, Rect } from '../shared/agentProtocol';
import { clusterSiblings, resolveTarget } from './cluster';
import { tagLiveElements } from './serialize';

const MAX_EXAMINED_ELEMENTS = 4000;
const MIN_WIDTH = 40;
const MIN_HEIGHT = 24;
const MAX_DOC_AREA_RATIO = 0.95;

function getDepth(el: Element): number {
  let depth = 0;
  let current: Element | null = el.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function normalizeText(text: string | null): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, 120);
}

function classifyKind(
  el: Element,
  tag: string,
  clusterSize: number,
  area: number,
  viewportArea: number,
  inViewport: boolean,
  topDoc: number,
  viewportHeight: number,
): string {
  const className = (el.getAttribute('class') || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();

  // hero: header/section/div de premier niveau dans le viewport initial contenant un h1
  if (
    inViewport &&
    topDoc <= viewportHeight * 0.5 &&
    (tag === 'header' || tag === 'section' || tag === 'div') &&
    el.querySelector('h1') !== null
  ) {
    return 'hero';
  }

  // card: clusterSize > 1 et aire entre 1% et 25%
  const areaRatio = viewportArea > 0 ? area / viewportArea : 0;
  if (clusterSize > 1 && areaRatio >= 0.01 && areaRatio <= 0.25) {
    return 'card';
  }

  // heading: h1-h3
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
    return 'heading';
  }

  // image: img/picture/svg/video/figure
  if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'video' || tag === 'figure') {
    return 'image';
  }

  // button: button, a avec role button ou classe contenant btn/button
  if (
    tag === 'button' ||
    (tag === 'a' && (role === 'button' || /\b(btn|button)\b/i.test(className))) ||
    role === 'button'
  ) {
    return 'button';
  }

  // nav: nav/header avec liens
  if ((tag === 'nav' || tag === 'header') && el.querySelector('a') !== null) {
    return 'nav';
  }

  // section: section/article/main > 25% du viewport
  if ((tag === 'section' || tag === 'article' || tag === 'main') && areaRatio > 0.25) {
    return 'section';
  }

  // text: p/span/li
  if (tag === 'p' || tag === 'span' || tag === 'li') {
    return 'text';
  }

  return 'other';
}

export function inspectPage(limit: number): Omit<InspectPageResult, 'tabId' | 'screenshotPng'> {
  tagLiveElements();

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportArea = Math.max(1, viewportWidth * viewportHeight);
  const docWidth = document.documentElement.scrollWidth;
  const docHeight = document.documentElement.scrollHeight;
  const docArea = Math.max(1, docWidth * docHeight);
  const dpr = window.devicePixelRatio || 1;

  const allElements = document.body.querySelectorAll('*');
  const seenTargets = new Set<Element>();
  const scoredCandidates: Array<{ candidate: PageCandidate; score: number }> = [];

  const examineCount = Math.min(allElements.length, MAX_EXAMINED_ELEMENTS);

  for (let i = 0; i < examineCount; i++) {
    const el = allElements[i];
    if (!el) continue;

    // Exclude html, body, and anything inside diorama overlay
    if (el === document.body || el === document.documentElement) continue;
    if (el.closest('[data-diorama-overlay]')) continue;

    // Visible: getClientRects().length > 0, visibility !== 'hidden', opacity > 0
    if (el.getClientRects().length === 0) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || Number.parseFloat(style.opacity) <= 0) continue;

    const clientRect = el.getBoundingClientRect();
    if (clientRect.width < MIN_WIDTH || clientRect.height < MIN_HEIGHT) continue;

    const area = clientRect.width * clientRect.height;
    if (area > docArea * MAX_DOC_AREA_RATIO) continue;

    // Resolve target using resolveTarget; only keep if result is the element itself
    const resolved = resolveTarget(el);
    if (resolved !== el) continue;

    if (seenTargets.has(resolved)) continue;
    seenTargets.add(resolved);

    // Check if resolved element is tagged with data-dio-id
    const dioId = resolved.getAttribute('data-dio-id');
    const selector = dioId ? `[data-dio-id="${dioId}"]` : '';
    if (!selector) continue;

    const tag = resolved.tagName.toLowerCase();
    const classAttr = resolved.getAttribute('class') || '';
    const className = classAttr.trim().split(/\s+/)[0] || '';
    const text = normalizeText(resolved.textContent);

    const pageX = clientRect.x + scrollX;
    const pageY = clientRect.y + scrollY;
    const rect: Rect = {
      x: pageX,
      y: pageY,
      w: clientRect.width,
      h: clientRect.height,
    };

    const inViewport =
      clientRect.bottom > 0 &&
      clientRect.right > 0 &&
      clientRect.top < viewportHeight &&
      clientRect.left < viewportWidth;

    const cluster = clusterSiblings(resolved);
    const clusterSize = cluster.members.length;
    const clusterSelectors: string[] = [];
    for (const member of cluster.members) {
      const mId = member.getAttribute('data-dio-id');
      if (mId) clusterSelectors.push(`[data-dio-id="${mId}"]`);
    }

    const depth = getDepth(resolved);
    const kind = classifyKind(
      resolved,
      tag,
      clusterSize,
      area,
      viewportArea,
      inViewport,
      pageY,
      viewportHeight,
    );

    // Scoring:
    // +3 if inViewport
    // +2 if clusterSize > 1
    // +2 if tag in {section, article, header, h1, h2, img, picture, video, button, figure} or a[role=button]
    // +1 if area between 2% and 40% of viewport
    // +1 if text non-empty
    // -1 per level of depth beyond 8
    // -2 if area < 1% of viewport
    let score = 0;
    if (inViewport) score += 3;
    if (clusterSize > 1) score += 2;

    const priorityTags = new Set([
      'section',
      'article',
      'header',
      'h1',
      'h2',
      'img',
      'picture',
      'video',
      'button',
      'figure',
    ]);
    const isButtonAnchor = tag === 'a' && resolved.getAttribute('role') === 'button';
    if (priorityTags.has(tag) || isButtonAnchor) score += 2;

    const areaRatio = area / viewportArea;
    if (areaRatio >= 0.02 && areaRatio <= 0.4) score += 1;
    if (text.length > 0) score += 1;
    if (depth > 8) score -= depth - 8;
    if (areaRatio < 0.01) score -= 2;

    const candidate: PageCandidate = {
      selector,
      tag,
      className,
      text,
      rect,
      inViewport,
      clusterSize,
      clusterSelectors,
      depth,
      kind,
    };

    scoredCandidates.push({ candidate, score });
  }

  // Sort descending by score
  scoredCandidates.sort((a, b) => b.score - a.score);
  const candidates = scoredCandidates.slice(0, Math.max(1, limit)).map((item) => item.candidate);

  return {
    url: window.location.href,
    title: document.title,
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      scrollX,
      scrollY,
      dpr,
    },
    document: {
      width: docWidth,
      height: docHeight,
    },
    candidates,
  };
}
