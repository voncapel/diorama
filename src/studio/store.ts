import { create } from 'zustand';
import type { CaptureBundle, CaptureGroup, CaptureLayer } from '../shared/types';
import {
  findContainerChildren,
  inferCaptureGroups,
  parentOfLayer,
  sanitizeGroups,
  setLayerParent as setLayerParentHelper,
  reorderChild as reorderChildHelper,
  dissolveGroup,
} from '../shared/groups';
import type {
  CameraChannelId,
  CameraValues,
  ChannelId,
  LayerChannelId,
  LayerValues,
  SceneChannelId,
  SceneValues,
} from './model/channels';
import {
  CAMERA_CHANNELS,
  DEFAULT_CAMERA_VALUES,
  DEFAULT_LAYER_VALUES,
  DEFAULT_SCENE_VALUES,
  SCENE_CHANNELS,
  clampToChannel,
} from './model/channels';
import type { Easing, Keyframe } from './model/timeline';
import {
  evaluateTimeline,
  keyframeTimes,
  makeKeyframe,
  resolveCameraValues,
  resolveLayerValues,
  resolveSceneValues,
  trackKey,
} from './model/timeline';
import type { PresetContext } from './engine/presets';
import { applyPreset, directLocal } from './engine/presets';
import type { FrameFormatName, FrameState } from './engine/frame';
import { DEFAULT_FRAME, FRAME_FORMATS } from './engine/frame';
import type { ExportQualityName } from './export';

export interface LayerState {
  values: LayerValues;
  visible: boolean;
  locked: boolean;
  /** Layer casts a shadow on the layers behind it (lighting must be enabled). */
  castShadow: boolean;
  /** Solid colour for the background layer. */
  backgroundColor?: string;
}

export interface FocusTarget {
  layerId: string;
  u: number;
  v: number;
}

export interface SceneSettings {
  lightEnabled: boolean;
  dofEnabled: boolean;
  focusTarget: FocusTarget | null;
  focusLocked: boolean;
}

const CAMERA_CHANNEL_IDS = new Set<string>(CAMERA_CHANNELS.map((c) => c.id));
const SCENE_CHANNEL_IDS = new Set<string>(SCENE_CHANNELS.map((c) => c.id));

export type Tool = 'select' | 'orbit' | 'focus';
export type InspectorTarget = 'layer' | 'camera' | 'scene' | 'frame' | 'export';

export interface TimelineUi {
  /** Height of the timeline panel in px; the user drags the divider. */
  height: number;
  /** Pixels per second. */
  zoom: number;
  /** Horizontal scroll offset in seconds. */
  scroll: number;
  /** Layer ids whose channel sub-rows are expanded. */
  expanded: string[];
  snap: boolean;
  collapsedGroups: string[];
}

interface StudioState {
  bundle: CaptureBundle | null;
  error: string | null;
  loading: boolean;

  layers: Record<string, LayerState>;
  camera: CameraValues;
  scene: SceneValues;
  sceneSettings: SceneSettings;
  frame: FrameState;

  keyframes: Keyframe[];
  duration: number;
  playhead: number;
  playing: boolean;
  /** When on, editing an unkeyed channel creates an initial keyframe at the playhead. */
  autoKey: boolean;

  selection: string[];
  hoveredLayerId: string | null;
  tool: Tool;
  inspector: InspectorTarget;
  timelineUi: TimelineUi;

  exporting: boolean;
  exportProgress: number;
  exportQuality: ExportQualityName;
  motionBlurSamples: number;
  prompt: string;

  agentConnected: boolean;
  setAgentConnected: (connected: boolean) => void;
  agentRendering: boolean;
  setAgentRendering: (rendering: boolean) => void;

  setBundle: (bundle: CaptureBundle) => void;
  mergeBundle: (bundle: CaptureBundle) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;

  /**
   * Sets a channel value.
   * Animated track: writes/updates keyframe at playhead without touching base value.
   * Unkeyed track: writes base value (and creates first keyframe if autoKey is on).
   */
  setLayerValue: (id: string, channel: LayerChannelId, value: number) => void;
  setLayerValues: (id: string, patch: Partial<LayerValues>) => void;
  setLayerFlags: (id: string, patch: Partial<Omit<LayerState, 'values'>>) => void;
  setCameraValue: (channel: CameraChannelId, value: number) => void;
  setCameraValues: (patch: Partial<CameraValues>) => void;
  setSceneValue: (channel: SceneChannelId, value: number) => void;
  setSceneSettings: (patch: Partial<SceneSettings>) => void;
  setFocusTarget: (target: FocusTarget | null) => void;
  setFocusLocked: (locked: boolean) => void;
  clearFocusTarget: () => void;
  setFrame: (patch: Partial<FrameState>) => void;
  setFrameFormat: (name: FrameFormatName) => void;
  swapFrameOrientation: () => void;

  select: (ids: string[], mode?: 'replace' | 'toggle' | 'add') => void;
  setHovered: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  setInspector: (target: InspectorTarget) => void;
  setTimelineUi: (patch: Partial<TimelineUi>) => void;
  toggleExpanded: (layerId: string) => void;

  setKeyframes: (keyframes: Keyframe[]) => void;
  /** Writes or updates the keyframe of a track at the playhead. */
  keyAtPlayhead: (layerId: string | null, channel: ChannelId, value?: number) => void;
  /** Removes the keyframe of a track at the playhead if one exists, else adds one. */
  toggleKeyAtPlayhead: (layerId: string | null, channel: ChannelId) => void;
  jumpToPrevKeyframe: () => void;
  jumpToNextKeyframe: () => void;
  moveKeyframes: (ids: string[], deltaTime: number) => void;
  updateKeyframe: (id: string, patch: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>) => void;
  removeKeyframes: (ids: string[]) => void;
  setEasingForTrack: (layerId: string | null, channel: ChannelId, easing: Easing) => void;
  clearTrack: (layerId: string | null, channel: ChannelId) => void;

  setDuration: (duration: number) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setAutoKey: (on: boolean) => void;

  setExporting: (exporting: boolean, progress?: number) => void;
  setExportQuality: (quality: ExportQualityName) => void;
  setMotionBlurSamples: (samples: number) => void;
  setPrompt: (prompt: string) => void;

  addLayers: (newLayers: CaptureLayer[], initialZ?: number) => void;
  removeLayer: (layerId: string) => void;
  setLayerParent: (layerId: string, parentId: string | null, index?: number) => void;
  groupLayers: (layerIds: string[]) => void;
  ungroup: (layerIdOrGroupId: string) => void;
  reorderChild: (parentId: string, childId: string, index: number) => void;
  toggleGroupCollapsed: (layerId: string) => void;
  createGroup: (parentId: string) => void;
  applyGroupOpening: (groupIdOrParentId: string, at?: number) => void;
  runDirector: () => void;
}

function defaultLayerState(layer: CaptureLayer): LayerState {
  const isBg = layer.role === 'background';
  return {
    values: { ...DEFAULT_LAYER_VALUES, z: isBg ? 0 : 60 },
    visible: true,
    locked: isBg,
    castShadow: !isBg,
    backgroundColor: layer.backgroundColor ?? (isBg ? '#ffffff' : undefined),
  };
}

function findKeyAt(keyframes: Keyframe[], layerId: string | null, channel: ChannelId, t: number): Keyframe | undefined {
  return keyframes.find(
    (k) => k.layerId === layerId && k.channel === channel && Math.abs(k.time - t) < 1e-3,
  );
}

/**
 * Pure helper returning keyframe updates (or new keyframe) when upserting a keyframe at playhead.
 */
function upsertKeyframeAtPlayhead(
  keyframes: Keyframe[],
  layerId: string | null,
  channel: ChannelId,
  playhead: number,
  value: number,
): Keyframe[] {
  const existing = findKeyAt(keyframes, layerId, channel, playhead);
  if (existing) {
    return keyframes.map((k) => (k.id === existing.id ? { ...k, value } : k));
  }
  const sibling = keyframes.find((k) => k.layerId === layerId && k.channel === channel);
  return [...keyframes, makeKeyframe(layerId, channel, playhead, value, sibling?.easing)];
}

/**
 * Pure helper merging keyframes by track and time.
 * Upserts matching (layerId, channel, time) keyframes and appends new ones.
 */
export function mergeKeyframes(existing: Keyframe[], incoming: Keyframe[]): Keyframe[] {
  const result = [...existing];
  for (const kf of incoming) {
    const existingIndex = result.findIndex(
      (k) =>
        k.layerId === kf.layerId &&
        k.channel === kf.channel &&
        Math.abs(k.time - kf.time) < 1e-3,
    );
    if (existingIndex >= 0) {
      result[existingIndex] = {
        ...result[existingIndex]!,
        value: kf.value,
        easing: kf.easing,
      };
    } else {
      result.push(kf);
    }
  }
  return result;
}

interface ChannelWriteState {
  layers: Record<string, LayerState>;
  camera: CameraValues;
  scene: SceneValues;
  keyframes: Keyframe[];
  playhead: number;
  autoKey: boolean;
}

/**
 * Computes state updates for writing a channel value with AE semantics:
 * - if animated (>=1 keyframe on the track): upsert keyframe at playhead, base untouched.
 * - if not animated: write base, + keyframe if autoKey is true.
 */
function applyChannelValue(
  state: ChannelWriteState,
  layerId: string | null,
  channel: ChannelId,
  rawValue: number,
): void {
  const v = clampToChannel(channel, rawValue);
  const animated = state.keyframes.some((k) => k.layerId === layerId && k.channel === channel);

  if (animated) {
    state.keyframes = upsertKeyframeAtPlayhead(state.keyframes, layerId, channel, state.playhead, v);
  } else {
    if (layerId !== null) {
      const layer = state.layers[layerId];
      if (layer) {
        state.layers[layerId] = {
          ...layer,
          values: { ...layer.values, [channel]: v },
        };
      }
    } else if (CAMERA_CHANNEL_IDS.has(channel)) {
      state.camera = { ...state.camera, [channel]: v };
    } else if (SCENE_CHANNEL_IDS.has(channel)) {
      state.scene = { ...state.scene, [channel]: v };
    }

    if (state.autoKey) {
      state.keyframes = upsertKeyframeAtPlayhead(state.keyframes, layerId, channel, state.playhead, v);
    }
  }
}

export const useStudio = create<StudioState>((set, get) => ({
  bundle: null,
  error: null,
  loading: true,

  layers: {},
  camera: { ...DEFAULT_CAMERA_VALUES },
  scene: { ...DEFAULT_SCENE_VALUES },
  sceneSettings: { lightEnabled: true, dofEnabled: false, focusTarget: null, focusLocked: false },
  frame: { ...DEFAULT_FRAME },

  keyframes: [],
  duration: 6,
  playhead: 0,
  playing: false,
  autoKey: false,

  selection: [],
  hoveredLayerId: null,
  tool: 'select',
  inspector: 'layer',
  timelineUi: { height: 260, zoom: 140, scroll: 0, expanded: [], snap: true, collapsedGroups: [] },

  exporting: false,
  exportProgress: 0,
  exportQuality: 'standard',
  motionBlurSamples: 1,
  prompt: '',

  agentConnected: false,
  setAgentConnected: (agentConnected) => set({ agentConnected }),
  agentRendering: false,
  setAgentRendering: (agentRendering) => set({ agentRendering }),

  setBundle: (bundle) => {
    const layers: Record<string, LayerState> = {};
    for (const layer of bundle.layers) layers[layer.id] = defaultLayerState(layer);
    const brief = (bundle as any).intent?.brief;
    const format = (bundle as any).intent?.frameFormat;
    let nextFrame = get().frame;
    if (format && format !== 'custom' && FRAME_FORMATS[format as keyof typeof FRAME_FORMATS]) {
      const def = FRAME_FORMATS[format as keyof typeof FRAME_FORMATS];
      nextFrame = { ...nextFrame, format, width: def.width, height: def.height };
    }
    const rawGroups = bundle.groups !== undefined ? bundle.groups : inferCaptureGroups(bundle.layers);
    const groups = sanitizeGroups(rawGroups, bundle.layers);
    set({
      bundle: { ...bundle, groups },
      layers,
      selection: [],
      loading: false,
      error: null,
      prompt: brief ?? get().prompt,
      frame: nextFrame,
    });
  },

  /**
   * Re-selection path: keeps every edit and only reconciles the layers.
   * `layer.id` and `layer.selector` are positional, so the mapping runs on
   * `stableId` (the data-dio-id marker) with the selector as a legacy fallback.
   */
  mergeBundle: (bundle) => {
    const s = get();
    if (!s.bundle) {
      get().setBundle(bundle);
      return;
    }
    const identityOf = (layer: CaptureLayer) => layer.stableId ?? layer.selector;
    const oldIdByIdentity = new Map<string, string>();
    for (const layer of s.bundle.layers) oldIdByIdentity.set(identityOf(layer), layer.id);

    const idRemap = new Map<string, string>();
    const layers: Record<string, LayerState> = {};
    for (const layer of bundle.layers) {
      const oldId = oldIdByIdentity.get(identityOf(layer));
      if (oldId) idRemap.set(oldId, layer.id);
      layers[layer.id] = (oldId && s.layers[oldId]) || defaultLayerState(layer);
    }
    const keyframes = s.keyframes
      .map((kf) => {
        if (kf.layerId === null) return kf;
        const nextId = idRemap.get(kf.layerId);
        return nextId ? { ...kf, layerId: nextId } : null;
      })
      .filter((kf): kf is Keyframe => kf !== null);
    const selection = s.selection.map((id) => idRemap.get(id)).filter((id): id is string => !!id);
    let focusTarget = s.sceneSettings.focusTarget;
    if (focusTarget) {
      const remappedTargetId = idRemap.get(focusTarget.layerId);
      focusTarget = remappedTargetId ? { ...focusTarget, layerId: remappedTargetId } : null;
    }
    const sceneSettings = focusTarget !== s.sceneSettings.focusTarget
      ? { ...s.sceneSettings, focusTarget }
      : s.sceneSettings;

    const currentGroups = s.bundle.groups ?? [];
    const remappedGroups: CaptureGroup[] = [];
    for (const group of currentGroups) {
      const nextParentId = idRemap.get(group.parentId);
      if (!nextParentId) continue;
      const nextChildIds = group.childIds
        .map((childId) => idRemap.get(childId))
        .filter((id): id is string => !!id);
      if (nextChildIds.length === 0) continue;
      remappedGroups.push({
        id: group.id,
        parentId: nextParentId,
        childIds: nextChildIds,
      });
    }

    // Keep surviving Studio groups, then add only non-conflicting groups supplied
    // by the incoming bundle. This avoids reviving invalid old ids or silently
    // discarding legitimate groups created by another producer.
    const nextGroups = [...remappedGroups];
    const validLayerIds = new Set(bundle.layers.map((layer) => layer.id));
    const claimedLayerIds = new Set(nextGroups.flatMap((group) => [group.parentId, ...group.childIds]));
    const groupIds = new Set(nextGroups.map((group) => group.id));
    const incomingGroups = bundle.groups !== undefined ? bundle.groups : inferCaptureGroups(bundle.layers);
    for (const incoming of incomingGroups) {
      if (!validLayerIds.has(incoming.parentId) || claimedLayerIds.has(incoming.parentId) || groupIds.has(incoming.id)) {
        continue;
      }
      const childIds = incoming.childIds.filter(
        (id) => id !== incoming.parentId && validLayerIds.has(id) && !claimedLayerIds.has(id),
      );
      if (childIds.length === 0) continue;
      const group = { ...incoming, childIds };
      nextGroups.push(group);
      groupIds.add(group.id);
      claimedLayerIds.add(group.parentId);
      for (const id of group.childIds) claimedLayerIds.add(id);
    }

    const brief = (bundle as any).intent?.brief;
    set({
      bundle: {
        ...bundle,
        groups: sanitizeGroups(nextGroups, bundle.layers),
      },
      layers,
      keyframes,
      selection,
      sceneSettings,
      loading: false,
      error: null,
      prompt: brief ?? s.prompt,
    });
  },

  setError: (error) => set({ error, loading: false }),
  setLoading: (loading) => set({ loading }),

  setLayerValue: (id, channel, value) => {
    const s = get();
    if (!s.layers[id]) return;
    const writeState: ChannelWriteState = {
      layers: { ...s.layers },
      camera: s.camera,
      scene: s.scene,
      keyframes: s.keyframes,
      playhead: s.playhead,
      autoKey: s.autoKey,
    };
    applyChannelValue(writeState, id, channel, value);
    set({ layers: writeState.layers, keyframes: writeState.keyframes });
  },
  setLayerValues: (id, patch) =>
    set((s) => {
      if (!s.layers[id]) return {};
      const writeState: ChannelWriteState = {
        layers: { ...s.layers },
        camera: s.camera,
        scene: s.scene,
        keyframes: s.keyframes,
        playhead: s.playhead,
        autoKey: s.autoKey,
      };
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) {
          applyChannelValue(writeState, id, k as ChannelId, v);
        }
      }
      return { layers: writeState.layers, keyframes: writeState.keyframes };
    }),
  setLayerFlags: (id, patch) =>
    set((s) => {
      const layer = s.layers[id];
      if (!layer) return {};
      return { layers: { ...s.layers, [id]: { ...layer, ...patch } } };
    }),

  setCameraValue: (channel, value) => {
    const s = get();
    const writeState: ChannelWriteState = {
      layers: s.layers,
      camera: { ...s.camera },
      scene: s.scene,
      keyframes: s.keyframes,
      playhead: s.playhead,
      autoKey: s.autoKey,
    };
    applyChannelValue(writeState, null, channel, value);
    set({ camera: writeState.camera, keyframes: writeState.keyframes });
  },
  setCameraValues: (patch) =>
    set((s) => {
      const writeState: ChannelWriteState = {
        layers: s.layers,
        camera: { ...s.camera },
        scene: s.scene,
        keyframes: s.keyframes,
        playhead: s.playhead,
        autoKey: s.autoKey,
      };
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) {
          applyChannelValue(writeState, null, k as ChannelId, v);
        }
      }
      return { camera: writeState.camera, keyframes: writeState.keyframes };
    }),
  setSceneValue: (channel, value) => {
    const s = get();
    const writeState: ChannelWriteState = {
      layers: s.layers,
      camera: s.camera,
      scene: { ...s.scene },
      keyframes: s.keyframes,
      playhead: s.playhead,
      autoKey: s.autoKey,
    };
    applyChannelValue(writeState, null, channel, value);
    set({ scene: writeState.scene, keyframes: writeState.keyframes });
  },
  setSceneSettings: (patch) => set((s) => ({ sceneSettings: { ...s.sceneSettings, ...patch } })),
  setFocusTarget: (focusTarget) =>
    set((s) => ({ sceneSettings: { ...s.sceneSettings, focusTarget } })),
  setFocusLocked: (focusLocked) =>
    set((s) => ({ sceneSettings: { ...s.sceneSettings, focusLocked } })),
  clearFocusTarget: () =>
    set((s) => ({ sceneSettings: { ...s.sceneSettings, focusTarget: null, focusLocked: false } })),

  setFrame: (patch) =>
    set((s) => {
      const touchesSize = patch.width !== undefined || patch.height !== undefined;
      const format: FrameFormatName = patch.format ?? (touchesSize ? 'custom' : s.frame.format);
      return { frame: { ...s.frame, ...patch, format } };
    }),
  setFrameFormat: (name) =>
    set((s) => {
      if (name === 'custom') return { frame: s.frame };
      const preset = FRAME_FORMATS[name];
      return { frame: { ...s.frame, width: preset.width, height: preset.height, format: name } };
    }),
  swapFrameOrientation: () =>
    set((s) => {
      const width = s.frame.height;
      const height = s.frame.width;
      const match = (Object.keys(FRAME_FORMATS) as Exclude<FrameFormatName, 'custom'>[]).find(
        (name) => FRAME_FORMATS[name].width === width && FRAME_FORMATS[name].height === height,
      );
      return { frame: { ...s.frame, width, height, format: match ?? 'custom' } };
    }),

  select: (ids, mode = 'replace') =>
    set((s) => {
      let selection: string[];
      if (mode === 'replace') selection = [...ids];
      else if (mode === 'add') selection = [...new Set([...s.selection, ...ids])];
      else {
        selection = [...s.selection];
        for (const id of ids) {
          const i = selection.indexOf(id);
          if (i >= 0) selection.splice(i, 1);
          else selection.push(id);
        }
      }
      const inspector: InspectorTarget =
        selection.length > 0 ? 'layer' : s.inspector === 'layer' ? 'camera' : s.inspector;
      return { selection, inspector };
    }),
  setHovered: (hoveredLayerId) => set({ hoveredLayerId }),
  setTool: (tool) => set({ tool }),
  setInspector: (inspector) => set({ inspector }),
  setTimelineUi: (patch) => set((s) => ({ timelineUi: { ...s.timelineUi, ...patch } })),
  toggleExpanded: (layerId) =>
    set((s) => {
      const expanded = s.timelineUi.expanded.includes(layerId)
        ? s.timelineUi.expanded.filter((id) => id !== layerId)
        : [...s.timelineUi.expanded, layerId];
      return { timelineUi: { ...s.timelineUi, expanded } };
    }),
  toggleGroupCollapsed: (layerId) =>
    set((s) => {
      const collapsed = s.timelineUi.collapsedGroups ?? [];
      const collapsedGroups = collapsed.includes(layerId)
        ? collapsed.filter((id) => id !== layerId)
        : [...collapsed, layerId];
      return { timelineUi: { ...s.timelineUi, collapsedGroups } };
    }),

  setKeyframes: (keyframes) => set({ keyframes }),
  keyAtPlayhead: (layerId, channel, value) => {
    const s = get();
    let current = value;
    if (current === undefined) {
      const animated = s.keyframes.some((k) => k.layerId === layerId && k.channel === channel);
      if (animated) {
        const ev = evaluateTimeline(s.keyframes, s.playhead);
        if (layerId !== null) {
          const l = s.layers[layerId];
          if (l) current = resolveLayerValues(l.values, ev.layers[layerId])[channel as LayerChannelId];
        } else if (CAMERA_CHANNEL_IDS.has(channel)) {
          const cam = resolveCameraValues(s.camera, ev.camera);
          current = cam[channel as CameraChannelId];
        } else {
          const scn = resolveSceneValues(s.scene, ev.scene);
          current = scn[channel as SceneChannelId];
        }
      } else {
        if (layerId !== null) {
          current = s.layers[layerId]?.values[channel as LayerChannelId];
        } else if (CAMERA_CHANNEL_IDS.has(channel)) {
          current = s.camera[channel as CameraChannelId];
        } else {
          current = s.scene[channel as SceneChannelId];
        }
      }
    }
    if (current === undefined) return;
    const v = clampToChannel(channel, current);
    set({ keyframes: upsertKeyframeAtPlayhead(s.keyframes, layerId, channel, s.playhead, v) });
  },
  toggleKeyAtPlayhead: (layerId, channel) => {
    const s = get();
    const existing = findKeyAt(s.keyframes, layerId, channel, s.playhead);
    if (existing) set({ keyframes: s.keyframes.filter((k) => k.id !== existing.id) });
    else get().keyAtPlayhead(layerId, channel);
  },
  jumpToPrevKeyframe: () => {
    const s = get();
    const times = keyframeTimesForTarget(s);
    const threshold = s.playhead - 1e-3;
    let targetTime: number | null = null;
    for (let i = times.length - 1; i >= 0; i--) {
      const t = times[i];
      if (t !== undefined && t < threshold) {
        targetTime = t;
        break;
      }
    }
    if (targetTime !== null) {
      get().setPlayhead(targetTime);
    }
  },
  jumpToNextKeyframe: () => {
    const s = get();
    const times = keyframeTimesForTarget(s);
    const threshold = s.playhead + 1e-3;
    let targetTime: number | null = null;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t !== undefined && t > threshold) {
        targetTime = t;
        break;
      }
    }
    if (targetTime !== null) {
      get().setPlayhead(targetTime);
    }
  },
  moveKeyframes: (ids, deltaTime) =>
    set((s) => ({
      keyframes: s.keyframes.map((k) =>
        ids.includes(k.id) ? { ...k, time: Math.max(0, Math.min(s.duration, k.time + deltaTime)) } : k,
      ),
    })),
  updateKeyframe: (id, patch) =>
    set((s) => ({
      keyframes: s.keyframes.map((k) =>
        k.id === id
          ? { ...k, ...patch, time: patch.time !== undefined ? Math.max(0, Math.min(s.duration, patch.time)) : k.time }
          : k,
      ),
    })),
  removeKeyframes: (ids) => set((s) => ({ keyframes: s.keyframes.filter((k) => !ids.includes(k.id)) })),
  setEasingForTrack: (layerId, channel, easing) =>
    set((s) => ({
      keyframes: s.keyframes.map((k) =>
        trackKey(k.layerId, k.channel) === trackKey(layerId, channel) ? { ...k, easing } : k,
      ),
    })),
  clearTrack: (layerId, channel) =>
    set((s) => ({
      keyframes: s.keyframes.filter((k) => trackKey(k.layerId, k.channel) !== trackKey(layerId, channel)),
    })),

  setDuration: (duration) =>
    set((s) => {
      const d = Math.max(0.5, duration);
      return { duration: d, playhead: Math.min(s.playhead, d) };
    }),
  setPlayhead: (t) => set((s) => ({ playhead: Math.max(0, Math.min(s.duration, t)) })),
  setPlaying: (playing) => set({ playing }),
  setAutoKey: (autoKey) => set({ autoKey }),

  setExporting: (exporting, progress = 0) => set({ exporting, exportProgress: progress }),
  setExportQuality: (exportQuality) => set({ exportQuality }),
  setMotionBlurSamples: (motionBlurSamples) =>
    set({ motionBlurSamples: Math.max(1, Math.round(motionBlurSamples)) }),
  setPrompt: (prompt) => set({ prompt }),

  addLayers: (newLayers, initialZ = 60) => {
    const s = get();
    if (!s.bundle) return;
    const existingIds = new Set(s.bundle.layers.map((l) => l.id));
    const trulyNew = newLayers.filter((l) => !existingIds.has(l.id));
    if (trulyNew.length === 0) return;

    const layers = { ...s.layers };
    trulyNew.forEach((layer, i) => {
      const state = defaultLayerState(layer);
      state.values.z = initialZ + (trulyNew.length > 1 ? i * 15 : 0);
      layers[layer.id] = state;
    });

    const clusters = s.bundle.clusters.map((c) => ({ ...c, memberIds: [...c.memberIds] }));
    for (const layer of trulyNew) {
      if (!layer.clusterId) continue;
      const existing = clusters.find((c) => c.id === layer.clusterId);
      if (existing) existing.memberIds = [...new Set([...existing.memberIds, layer.id])];
      else clusters.push({ id: layer.clusterId, score: 1, memberIds: [layer.id] });
    }
    const combinedLayers = [...s.bundle.layers, ...trulyNew];
    const groups = sanitizeGroups(s.bundle.groups ? [...s.bundle.groups] : [], combinedLayers);
    set({ bundle: { ...s.bundle, layers: combinedLayers, clusters, groups }, layers });
  },

  removeLayer: (layerId) => {
    const s = get();
    if (!s.bundle) return;
    const layers = { ...s.layers };
    delete layers[layerId];
    const clusters = s.bundle.clusters
      .map((c) => ({ ...c, memberIds: c.memberIds.filter((id) => id !== layerId) }))
      .filter((c) => c.memberIds.length > 0);
    const currentGroups = s.bundle.groups ?? [];
    const dissolved = dissolveGroup(currentGroups, layerId);
    const remainingLayers = s.bundle.layers.filter((l) => l.id !== layerId);
    const nextGroups = sanitizeGroups(dissolved, remainingLayers);
    const focusTarget =
      s.sceneSettings.focusTarget?.layerId === layerId ? null : s.sceneSettings.focusTarget;
    const sceneSettings =
      focusTarget !== s.sceneSettings.focusTarget
        ? { ...s.sceneSettings, focusTarget }
        : s.sceneSettings;
    set({
      bundle: { ...s.bundle, layers: remainingLayers, clusters, groups: nextGroups },
      layers,
      keyframes: s.keyframes.filter((kf) => kf.layerId !== layerId),
      selection: s.selection.filter((id) => id !== layerId),
      sceneSettings,
    });
  },

  setLayerParent: (layerId, parentId, index) => {
    const s = get();
    if (!s.bundle) return;
    const nextGroups = setLayerParentHelper(s.bundle.groups, s.bundle.layers, layerId, parentId, index);
    set({ bundle: { ...s.bundle, groups: nextGroups } });
  },

  groupLayers: (layerIds) => {
    const s = get();
    if (!s.bundle || layerIds.length <= 1) return;
    const validLayers = s.bundle.layers.filter((l) => l.role === 'zap' && layerIds.includes(l.id));
    if (validLayers.length <= 1) return;

    // Largest surface area becomes parent
    const sorted = [...validLayers].sort((a, b) => {
      const areaA = a.rect.w * a.rect.h;
      const areaB = b.rect.w * b.rect.h;
      if (Math.abs(areaB - areaA) > 1e-4) return areaB - areaA;
      if (a.order !== b.order) return a.order - b.order;
      return a.id.localeCompare(b.id);
    });

    const parent = sorted[0]!;
    const children = sorted.slice(1);

    let currentGroups = s.bundle.groups ?? [];
    for (const child of children) {
      currentGroups = setLayerParentHelper(currentGroups, s.bundle.layers, child.id, parent.id);
    }
    set({ bundle: { ...s.bundle, groups: currentGroups } });
  },

  ungroup: (groupIdOrParentId) => {
    const s = get();
    if (!s.bundle) return;
    const currentGroups = s.bundle.groups ?? [];
    const targetGroup = currentGroups.find(
      (g) =>
        g.id === groupIdOrParentId ||
        g.parentId === groupIdOrParentId ||
        g.childIds.includes(groupIdOrParentId),
    );
    if (!targetGroup) return;

    const nextGroups = dissolveGroup(currentGroups, targetGroup.parentId);
    set({
      bundle: {
        ...s.bundle,
        groups: sanitizeGroups(nextGroups, s.bundle.layers),
      },
    });
  },

  reorderChild: (parentId, childId, index) => {
    const s = get();
    if (!s.bundle) return;
    const nextGroups = reorderChildHelper(s.bundle.groups, parentId, childId, index);
    set({ bundle: { ...s.bundle, groups: nextGroups } });
  },

  createGroup: (parentId: string) => {
    const s = get();
    if (!s.bundle) return;
    const zapLayers = s.bundle.layers.filter((l) => l.role === 'zap');
    const parent = zapLayers.find((l) => l.id === parentId);
    if (!parent) return;

    const currentGroups = s.bundle.groups ?? [];
    const potentialChildren = findContainerChildren(parent, zapLayers);
    const availableChildren = potentialChildren.filter(
      (c) => c.id !== parent.id && parentOfLayer(currentGroups, c.id) === null,
    );

    if (availableChildren.length === 0) return;

    let nextGroups = currentGroups;
    for (const child of availableChildren) {
      nextGroups = setLayerParentHelper(nextGroups, s.bundle.layers, child.id, parent.id);
    }
    set({ bundle: { ...s.bundle, groups: nextGroups } });
  },

  applyGroupOpening: (groupIdOrParentId: string, at?: number) => {
    const s = get();
    if (!s.bundle) return;
    const currentGroups = s.bundle.groups ?? [];
    const group = currentGroups.find(
      (g) =>
        g.id === groupIdOrParentId ||
        g.parentId === groupIdOrParentId ||
        g.childIds.includes(groupIdOrParentId),
    );
    if (!group) return;

    const targetIds = [group.parentId, ...group.childIds];
    const applyTime = at !== undefined ? Math.min(s.duration, Math.max(0, at)) : s.playhead;

    const layerZ: Record<string, number> = {};
    const layerBase: Record<string, LayerValues> = {};
    const animatedChannels: Record<string, string[]> = {};

    for (const id in s.layers) {
      layerZ[id] = s.layers[id]!.values.z;
      layerBase[id] = s.layers[id]!.values;
    }

    for (const kf of s.keyframes) {
      if (kf.layerId) {
        const arr = animatedChannels[kf.layerId] ?? [];
        if (!arr.includes(kf.channel)) {
          arr.push(kf.channel);
        }
        animatedChannels[kf.layerId] = arr;
      }
    }

    const ctx: PresetContext = {
      zapLayerIds: targetIds,
      baseDistance: s.camera.distance,
      baseCamera: s.camera,
      duration: s.duration,
      layerRects: {},
      layerZ,
      layerBase,
      animatedChannels,
    };

    const newKeyframes = applyPreset('modal-open', ctx, applyTime, {}, targetIds);
    const updatedKeyframes = mergeKeyframes(s.keyframes, newKeyframes);

    set({
      keyframes: updatedKeyframes,
      playhead: applyTime,
    });
  },

  runDirector: () => {
    const { bundle, camera, duration, prompt, layers, keyframes } = get();
    if (!bundle) return;
    const zapLayerIds = bundle.layers
      .filter((l) => l.role === 'zap')
      .sort((a, b) => a.order - b.order)
      .map((l) => l.id);

    const layerZ: Record<string, number> = {};
    const layerBase: Record<string, LayerValues> = {};
    const animatedChannels: Record<string, string[]> = {};
    for (const id of Object.keys(layers)) {
      const l = layers[id];
      if (l) {
        layerZ[id] = l.values.z;
        layerBase[id] = l.values;
      }
    }
    for (const kf of keyframes) {
      if (kf.layerId) {
        const arr = animatedChannels[kf.layerId] ?? [];
        if (!arr.includes(kf.channel)) {
          arr.push(kf.channel);
        }
        animatedChannels[kf.layerId] = arr;
      }
    }

    set({
      keyframes: directLocal(
        {
          zapLayerIds,
          baseDistance: camera.distance,
          duration,
          baseCamera: camera,
          layerRects: {},
          layerZ,
          layerBase,
          animatedChannels,
        },
        prompt,
      ),
      playhead: 0,
    });
  },
}));

/** Ordered zap layers plus the background, as shown in the layer list and the timeline. */
export function orderedLayers(bundle: CaptureBundle | null): CaptureLayer[] {
  if (!bundle) return [];
  return [...bundle.layers].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'background' ? 1 : -1;
    return a.order - b.order;
  });
}

/**
 * Deduplicated and sorted keyframe times for the current inspector target:
 * - layer inspector with selection: keyframes on the selected layer(s)
 * - camera inspector: camera keyframes
 * - scene inspector: scene keyframes
 * - otherwise: all keyframes
 */
export function keyframeTimesForTarget(
  state: Pick<StudioState, 'inspector' | 'selection' | 'keyframes'>,
): number[] {
  let targetKeyframes: Keyframe[];
  if (state.inspector === 'layer' && state.selection.length > 0) {
    const selSet = new Set(state.selection);
    targetKeyframes = state.keyframes.filter((k) => k.layerId !== null && selSet.has(k.layerId));
  } else if (state.inspector === 'camera') {
    targetKeyframes = state.keyframes.filter(
      (k) => k.layerId === null && CAMERA_CHANNEL_IDS.has(k.channel),
    );
  } else if (state.inspector === 'scene') {
    targetKeyframes = state.keyframes.filter(
      (k) => k.layerId === null && SCENE_CHANNEL_IDS.has(k.channel),
    );
  } else {
    targetKeyframes = state.keyframes;
  }
  return keyframeTimes(targetKeyframes);
}
