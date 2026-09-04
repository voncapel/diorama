import { useEffect, useState, type RefObject } from 'react';

/** Width of the header column, in px. */
export const HEADER_W = 220;
export const TOOLBAR_H = 36;
export const RULER_H = 24;
export const ROW_H = 28;
export const SUB_ROW_H = 22;
export const RESIZE_H = 5;
export const MIN_HEIGHT = 120;
export const MIN_ZOOM = 40;
export const MAX_ZOOM = 600;
/** Snap threshold in screen px. */
export const SNAP_PX = 8;
/** Keyframe diamond size in px. */
export const DIAMOND = 9;

export const MAJOR_STEPS = [0.1, 0.25, 0.5, 1, 2, 5] as const;
/** Minimum spacing between two major ticks, in px. */
const MIN_MAJOR_PX = 64;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function maxHeight(): number {
  return Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.6));
}

export function clampHeight(height: number): number {
  return Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(height)));
}

/** Largest scroll offset (seconds) that keeps the end of the clip reachable. */
export function maxScroll(duration: number, zoom: number, laneWidth: number): number {
  if (laneWidth <= 0) return 0;
  return Math.max(0, duration - laneWidth / zoom + 40 / zoom);
}

export function clampScroll(scroll: number, duration: number, zoom: number, laneWidth: number): number {
  return Math.min(maxScroll(duration, zoom, laneWidth), Math.max(0, scroll));
}

export function timeToX(t: number, zoom: number, scroll: number): number {
  return (t - scroll) * zoom;
}

export function xToTime(x: number, zoom: number, scroll: number): number {
  return scroll + x / zoom;
}

/** Picks the major tick step so majors are at least MIN_MAJOR_PX apart. */
export function majorStep(zoom: number): number {
  for (const step of MAJOR_STEPS) {
    if (step * zoom >= MIN_MAJOR_PX) return step;
  }
  return MAJOR_STEPS.at(-1) ?? 5;
}

export function minorStep(major: number): number {
  if (major === 0.25) return 0.05;
  return major / 5;
}

/** Formats seconds as m:ss.cc (centiseconds), e.g. 0:02.40. */
export function formatTime(t: number): string {
  const safe = Math.max(0, t);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

/** Short ruler label: whole seconds as "2s", fractions as "2.5s". */
export function formatTick(t: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.25 ? 1 : 2;
  const text = t.toFixed(decimals);
  return `${text.replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m))}s`;
}

/** Integer-second snap candidates within [0, duration]. */
export function secondMarks(duration: number): number[] {
  const marks: number[] = [];
  for (let s = 0; s <= duration + 1e-6; s += 1) marks.push(s);
  return marks;
}

export function roundTime(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/** Tracks the inner width of an element with a ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
