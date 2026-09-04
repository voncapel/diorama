/**
 * Composition frame: the output rectangle, decoupled from the viewport panel.
 *
 * The camera aspect follows this frame — never the canvas — so what the user
 * composes on screen is bit-for-bit what the export encodes (WYSIWYG). Every
 * helper here is pure and three-free so the framing maths can be reasoned about
 * (and reused by the export sizing) without touching the live scene.
 */

export type FrameFormatName =
  | 'landscape-16-9'
  | 'portrait-9-16'
  | 'square-1-1'
  | 'portrait-4-5'
  | 'landscape-4-3'
  | 'cinema-21-9'
  | 'custom';

export interface FrameState {
  /** Résolution de sortie en pixels ; définit aussi l'aspect du cadre. */
  width: number;
  height: number;
  /** Nom du format actif, ou 'custom' quand width/height sont saisis à la main. */
  format: FrameFormatName;
  /** Repères de composition affichés par-dessus le cadre. */
  guides: 'none' | 'thirds' | 'center' | 'grid';
  /** Zone hors-cadre : assombrie (mode masque) ou entièrement masquée. */
  maskOpacity: number; // 0 = hors-cadre visible tel quel, 1 = hors-cadre noir opaque
  /** Affiche la zone hors-cadre pour travailler avec du contexte autour. */
  showOverscan: boolean;
}

export const FRAME_FORMATS: Record<
  Exclude<FrameFormatName, 'custom'>,
  { label: string; width: number; height: number }
> = {
  'landscape-16-9': { label: 'Paysage · 16:9', width: 1920, height: 1080 },
  'portrait-9-16': { label: 'Portrait · 9:16 (Reels/Shorts)', width: 1080, height: 1920 },
  'square-1-1': { label: 'Carré · 1:1', width: 1080, height: 1080 },
  'portrait-4-5': { label: 'Portrait · 4:5 (Feed)', width: 1080, height: 1350 },
  'landscape-4-3': { label: 'Paysage · 4:3', width: 1440, height: 1080 },
  'cinema-21-9': { label: 'Cinéma · 21:9', width: 2560, height: 1080 },
};

export const DEFAULT_FRAME: FrameState = {
  width: 1920,
  height: 1080,
  format: 'landscape-16-9',
  guides: 'none',
  maskOpacity: 0.72,
  showOverscan: true,
};

export function frameAspect(frame: FrameState): number {
  return frame.width / Math.max(1, frame.height);
}

export interface WorldRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface FitResult {
  distance: number;
  targetX: number;
  targetY: number;
}

/**
 * Distance and aim point that make `rect` fill the frame with a relative margin.
 *
 * The vertical half-tangent alone covers the height; the width has to be divided
 * by the aspect first because a perspective camera derives its horizontal FOV
 * from the vertical one. Taking the max of both keeps the rect fully inside on
 * whichever axis is the tightest — the other one simply gets extra headroom.
 */
export function fitRectInFrame(
  rect: WorldRect,
  aspect: number,
  fovDeg: number,
  padding: number,
): FitResult {
  const tanHalf = Math.max(Math.tan((fovDeg * Math.PI) / 360), Number.EPSILON);
  const safeAspect = Math.max(aspect, Number.EPSILON);
  const distanceForHeight = ((rect.h / 2) * (1 + padding)) / tanHalf;
  const distanceForWidth = ((rect.w / 2) * (1 + padding)) / (tanHalf * safeAspect);
  return {
    distance: Math.max(distanceForHeight, distanceForWidth),
    targetX: rect.cx,
    targetY: rect.cy,
  };
}

export interface FrameBox {
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Letterboxes the frame inside its container, keeping 24px of breathing room so
 * the border and the badge never touch the panel edges. The 40px floor stops a
 * collapsed panel from producing a zero-sized render target.
 */
export function computeFrameBox(
  containerWidth: number,
  containerHeight: number,
  aspect: number,
): FrameBox {
  const margin = 24;
  const safeAspect = Math.max(aspect, Number.EPSILON);
  const availableWidth = Math.max(40, containerWidth - margin * 2);
  const availableHeight = Math.max(40, containerHeight - margin * 2);

  let width = availableWidth;
  let height = width / safeAspect;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * safeAspect;
  }
  width = Math.max(40, width);
  height = Math.max(40, height);

  return {
    width,
    height,
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
  };
}
