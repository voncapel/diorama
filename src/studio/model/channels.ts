/**
 * Channel registry: every animatable property is declared once here and is
 * wired automatically into the inspector (fields), the timeline (keyframe
 * rows) and the renderer (resolved values). Adding a capability to a layer or
 * to the camera means adding a channel here, then consuming it in the renderer.
 */

export type ChannelTarget = 'layer' | 'camera' | 'scene';

export interface ChannelDef<Id extends string = string> {
  id: Id;
  target: ChannelTarget;
  /** Inspector section the field belongs to. */
  group: ChannelGroup;
  label: string;
  /** Displayed after the value; also documents the unit of the stored number. */
  unit?: '' | 'px' | '°' | '%' | 'x';
  /** Hard limits enforced on input. */
  min?: number;
  max?: number;
  /** Pointer scrub increment (Shift = /10, Alt = ×10). */
  step: number;
  /** Decimal places shown in fields. */
  precision: number;
  default: number;
  /** Slider range when a slider is used instead of a scrub field. */
  soft?: [number, number];
}

export type ChannelGroup =
  | 'position'
  | 'rotation'
  | 'scale'
  | 'distort'
  | 'reveal'
  | 'appearance'
  | 'volume'
  | 'shadow'
  | 'camera'
  | 'lens'
  | 'light';

export const CHANNEL_GROUP_LABELS: Record<ChannelGroup, string> = {
  position: 'Position',
  rotation: 'Rotation',
  scale: 'Échelle',
  distort: 'Distorsion',
  reveal: 'Révélation',
  appearance: 'Apparence',
  volume: 'Volume',
  shadow: 'Ombre',
  camera: 'Caméra',
  lens: 'Objectif',
  light: 'Lumière',
};

/** Layer channels. Position values are offsets from the captured page position. */
export const LAYER_CHANNELS = [
  { id: 'x', target: 'layer', group: 'position', label: 'X', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'y', target: 'layer', group: 'position', label: 'Y', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'z', target: 'layer', group: 'position', label: 'Z', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'rotX', target: 'layer', group: 'rotation', label: 'X', unit: '°', step: 0.5, precision: 1, default: 0, min: -180, max: 180 },
  { id: 'rotY', target: 'layer', group: 'rotation', label: 'Y', unit: '°', step: 0.5, precision: 1, default: 0, min: -180, max: 180 },
  { id: 'rotZ', target: 'layer', group: 'rotation', label: 'Z', unit: '°', step: 0.5, precision: 1, default: 0, min: -180, max: 180 },
  { id: 'scale', target: 'layer', group: 'scale', label: 'Uniforme', unit: '%', step: 1, precision: 0, default: 100, min: 1, max: 1000 },
  { id: 'anchorX', target: 'layer', group: 'scale', label: 'Pivot X', unit: '%', step: 1, precision: 0, default: 50, min: 0, max: 100 },
  { id: 'anchorY', target: 'layer', group: 'scale', label: 'Pivot Y', unit: '%', step: 1, precision: 0, default: 50, min: 0, max: 100 },
  { id: 'tlX', target: 'layer', group: 'distort', label: 'Haut gauche X', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'tlY', target: 'layer', group: 'distort', label: 'Haut gauche Y', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'trX', target: 'layer', group: 'distort', label: 'Haut droit X', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'trY', target: 'layer', group: 'distort', label: 'Haut droit Y', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'brX', target: 'layer', group: 'distort', label: 'Bas droit X', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'brY', target: 'layer', group: 'distort', label: 'Bas droit Y', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'blX', target: 'layer', group: 'distort', label: 'Bas gauche X', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'blY', target: 'layer', group: 'distort', label: 'Bas gauche Y', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'reveal', target: 'layer', group: 'reveal', label: 'Ouverture', unit: '%', step: 1, precision: 0, default: 100, min: 0, max: 100 },
  { id: 'revealAngle', target: 'layer', group: 'reveal', label: 'Direction', unit: '°', step: 1, precision: 0, default: 0, min: -180, max: 180 },
  { id: 'revealFeather', target: 'layer', group: 'reveal', label: 'Douceur intérieure', unit: 'px', step: 1, precision: 0, default: 0, min: 0, max: 1000 },
  { id: 'opacity', target: 'layer', group: 'appearance', label: 'Opacité', unit: '%', step: 1, precision: 0, default: 100, min: 0, max: 100, soft: [0, 100] },
  { id: 'thickness', target: 'layer', group: 'volume', label: 'Épaisseur', unit: 'px', step: 0.5, precision: 1, default: 0, min: 0, max: 200, soft: [0, 30] },
  { id: 'shadowOpacity', target: 'layer', group: 'shadow', label: 'Intensité', unit: '%', step: 1, precision: 0, default: 100, min: 0, max: 100, soft: [0, 100] },
] as const satisfies readonly ChannelDef[];

export const CAMERA_CHANNELS = [
  { id: 'distance', target: 'camera', group: 'camera', label: 'Distance', unit: 'px', step: 10, precision: 0, default: 1600, min: 10 },
  { id: 'orbitX', target: 'camera', group: 'camera', label: 'Tilt', unit: '°', step: 0.5, precision: 1, default: 0, min: -89, max: 89 },
  { id: 'orbitY', target: 'camera', group: 'camera', label: 'Pan', unit: '°', step: 0.5, precision: 1, default: 0, min: -89, max: 89 },
  { id: 'roll', target: 'camera', group: 'camera', label: 'Roll', unit: '°', step: 0.5, precision: 1, default: 0, min: -180, max: 180 },
  { id: 'targetX', target: 'camera', group: 'camera', label: 'Cible X', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'targetY', target: 'camera', group: 'camera', label: 'Cible Y', unit: 'px', step: 1, precision: 0, default: 0 },
  { id: 'fov', target: 'camera', group: 'lens', label: 'Focale (FOV)', unit: '°', step: 0.5, precision: 1, default: 45, min: 5, max: 120, soft: [15, 95] },
  { id: 'focus', target: 'camera', group: 'lens', label: 'Mise au point', unit: 'px', step: 10, precision: 0, default: 1600, min: 1 },
  { id: 'aperture', target: 'camera', group: 'lens', label: 'Ouverture', unit: '', step: 0.05, precision: 2, default: 0, min: 0, max: 10, soft: [0, 10] },
  { id: 'maxBlur', target: 'camera', group: 'lens', label: 'Flou max', unit: '', step: 0.1, precision: 1, default: 1, min: 0, max: 5, soft: [0, 5] },
] as const satisfies readonly ChannelDef[];

export const SCENE_CHANNELS = [
  { id: 'lightAzimuth', target: 'scene', group: 'light', label: 'Azimut', unit: '°', step: 1, precision: 0, default: -35, min: -180, max: 180, soft: [-180, 180] },
  { id: 'lightElevation', target: 'scene', group: 'light', label: 'Élévation', unit: '°', step: 1, precision: 0, default: 55, min: 5, max: 89, soft: [5, 89] },
  { id: 'lightIntensity', target: 'scene', group: 'light', label: 'Intensité', unit: '%', step: 1, precision: 0, default: 60, min: 0, max: 300, soft: [0, 200] },
  { id: 'ambient', target: 'scene', group: 'light', label: 'Ambiante', unit: '%', step: 1, precision: 0, default: 70, min: 0, max: 200, soft: [0, 150] },
  { id: 'shadowSoftness', target: 'scene', group: 'light', label: 'Douceur des ombres', unit: '', step: 0.1, precision: 1, default: 3, min: 0, max: 20, soft: [0, 12] },
  { id: 'shadowOpacity', target: 'scene', group: 'light', label: 'Opacité des ombres', unit: '%', step: 1, precision: 0, default: 45, min: 0, max: 100, soft: [0, 100] },
] as const satisfies readonly ChannelDef[];

export type LayerChannelId = (typeof LAYER_CHANNELS)[number]['id'];
export type CameraChannelId = (typeof CAMERA_CHANNELS)[number]['id'];
export type SceneChannelId = (typeof SCENE_CHANNELS)[number]['id'];
export type ChannelId = LayerChannelId | CameraChannelId | SceneChannelId;

export type LayerValues = Record<LayerChannelId, number>;
export type CameraValues = Record<CameraChannelId, number>;
export type SceneValues = Record<SceneChannelId, number>;

function defaultsOf<T extends readonly ChannelDef[]>(defs: T): Record<T[number]['id'], number> {
  const out: Record<string, number> = {};
  for (const def of defs) out[def.id] = def.default;
  return out as Record<T[number]['id'], number>;
}

export const DEFAULT_LAYER_VALUES: LayerValues = defaultsOf(LAYER_CHANNELS);
export const DEFAULT_CAMERA_VALUES: CameraValues = defaultsOf(CAMERA_CHANNELS);
export const DEFAULT_SCENE_VALUES: SceneValues = defaultsOf(SCENE_CHANNELS);

const BY_ID: Record<string, ChannelDef> = {};
for (const def of [...LAYER_CHANNELS, ...CAMERA_CHANNELS, ...SCENE_CHANNELS]) BY_ID[def.id] = def as ChannelDef;

export function channelDef(id: ChannelId): ChannelDef {
  const def = BY_ID[id];
  if (!def) throw new Error(`Unknown channel: ${id}`);
  return def;
}

export function channelsForTarget(target: ChannelTarget): readonly ChannelDef[] {
  if (target === 'layer') return LAYER_CHANNELS;
  if (target === 'camera') return CAMERA_CHANNELS;
  return SCENE_CHANNELS;
}

export function clampToChannel(id: ChannelId, value: number): number {
  const def = channelDef(id);
  let v = value;
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}

/** Group order used by the inspector for each target. */
export function groupsForTarget(target: ChannelTarget): ChannelGroup[] {
  const seen: ChannelGroup[] = [];
  for (const def of channelsForTarget(target)) if (!seen.includes(def.group)) seen.push(def.group);
  return seen;
}
