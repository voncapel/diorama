import type { ChannelId, LayerChannelId, CameraChannelId, SceneChannelId } from './channels';
import { DEFAULT_CAMERA_VALUES, DEFAULT_SCENE_VALUES, CAMERA_CHANNELS, SCENE_CHANNELS, LAYER_CHANNELS } from './channels';
import type { CameraValues, LayerValues, SceneValues } from './channels';

export type Easing = 'linear' | 'expo.out' | 'quart.out' | 'quint.inOut' | 'cubic.inOut' | 'back.out';

export const EASINGS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  'expo.out': (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  'quart.out': (t) => 1 - Math.pow(1 - t, 4),
  'quint.inOut': (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  'cubic.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'back.out': (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export const EASING_LABELS: Record<Easing, string> = {
  linear: 'Linéaire',
  'expo.out': 'Expo out',
  'quart.out': 'Quart out',
  'quint.inOut': 'Quint in-out',
  'cubic.inOut': 'Cubic in-out',
  'back.out': 'Back out',
};

/**
 * One keyframe on one channel. `layerId` is null for camera and scene
 * channels. The easing describes the curve *into* this keyframe.
 */
export interface Keyframe {
  id: string;
  layerId: string | null;
  channel: ChannelId;
  time: number;
  value: number;
  easing: Easing;
}

export function trackKey(layerId: string | null, channel: ChannelId): string {
  return `${layerId ?? '_'}|${channel}`;
}

export interface EvaluatedTimeline {
  layers: Record<string, Partial<LayerValues>>;
  camera: Partial<CameraValues>;
  scene: Partial<SceneValues>;
}

const CAMERA_IDS = new Set<string>(CAMERA_CHANNELS.map((c) => c.id));
const SCENE_IDS = new Set<string>(SCENE_CHANNELS.map((c) => c.id));
const LAYER_IDS = new Set<string>(LAYER_CHANNELS.map((c) => c.id));

function evaluateChannel(sorted: Keyframe[], t: number): number {
  const first = sorted[0]!;
  if (t <= first.time) return first.value;
  const last = sorted[sorted.length - 1]!;
  if (t >= last.time) return last.value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const raw = span <= 0 ? 1 : (t - a.time) / span;
      return a.value + (b.value - a.value) * EASINGS[b.easing](Math.min(1, Math.max(0, raw)));
    }
  }
  return last.value;
}

/** Groups keyframes by track, each list sorted by time. */
export function groupTracks(keyframes: Keyframe[]): Map<string, Keyframe[]> {
  const tracks = new Map<string, Keyframe[]>();
  for (const kf of keyframes) {
    const key = trackKey(kf.layerId, kf.channel);
    const list = tracks.get(key);
    if (list) list.push(kf);
    else tracks.set(key, [kf]);
  }
  for (const list of tracks.values()) list.sort((a, b) => a.time - b.time);
  return tracks;
}

/**
 * Pure evaluation at virtual time t. Only keyed channels appear in the result;
 * callers overlay it on the static values. No rAF dependency, so the export
 * loop calls this with t = frame / fps.
 */
export function evaluateTimeline(keyframes: Keyframe[], t: number): EvaluatedTimeline {
  const out: EvaluatedTimeline = { layers: {}, camera: {}, scene: {} };
  for (const list of groupTracks(keyframes).values()) {
    const first = list[0]!;
    const value = evaluateChannel(list, t);
    if (first.layerId !== null && LAYER_IDS.has(first.channel)) {
      (out.layers[first.layerId] ??= {})[first.channel as LayerChannelId] = value;
    } else if (CAMERA_IDS.has(first.channel)) {
      out.camera[first.channel as CameraChannelId] = value;
    } else if (SCENE_IDS.has(first.channel)) {
      out.scene[first.channel as SceneChannelId] = value;
    }
  }
  return out;
}

export function resolveLayerValues(base: LayerValues, evaluated: Partial<LayerValues> | undefined): LayerValues {
  return evaluated ? { ...base, ...evaluated } : base;
}

export function resolveCameraValues(base: CameraValues, evaluated: Partial<CameraValues>): CameraValues {
  const merged = { ...DEFAULT_CAMERA_VALUES, ...base, ...evaluated };
  // Focus is a distance from the camera: an unkeyed focus rides along with a
  // keyed dolly so the frame does not go soft when the camera moves.
  if (evaluated.distance !== undefined && evaluated.focus === undefined) {
    merged.focus = base.focus + (evaluated.distance - base.distance);
  }
  return merged;
}

export function resolveSceneValues(base: SceneValues, evaluated: Partial<SceneValues>): SceneValues {
  return { ...DEFAULT_SCENE_VALUES, ...base, ...evaluated };
}

let kfSeq = 0;
export function makeKeyframe(
  layerId: string | null,
  channel: ChannelId,
  time: number,
  value: number,
  easing: Easing = 'quart.out',
): Keyframe {
  return { id: `kf${Date.now().toString(36)}${(kfSeq++).toString(36)}`, layerId, channel, time, value, easing };
}

/** Times of every keyframe on any track, deduplicated and sorted: the snap targets. */
export function keyframeTimes(keyframes: Keyframe[]): number[] {
  return [...new Set(keyframes.map((k) => Math.round(k.time * 1000) / 1000))].sort((a, b) => a - b);
}

/** Snaps t to the nearest candidate within `threshold` seconds, else returns t. */
export function snapTime(t: number, candidates: number[], threshold: number): number {
  let best = t;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
