/**
 * Agent API contract shared by the extension (background service worker and
 * Studio tab) and the local bridge (`bridge/`, an MCP server).
 *
 * Transport: the extension opens WebSocket client connections to the bridge at
 * `ws://127.0.0.1:${AGENT_BRIDGE_PORT}`. Two clients connect, one per role:
 * - `background`: page inspection, capture, tab management;
 * - `studio`: everything that needs the live renderer (scene, timeline,
 *   screenshots, export).
 * The bridge exposes one MCP tool per method (`diorama_<method>`) and routes each
 * call to the client owning that method. Binary payloads (PNG, MP4) travel as
 * base64 strings inside JSON; the bridge turns them into MCP image content or
 * writes them to disk.
 */

export const AGENT_BRIDGE_PORT = 47831;
export const AGENT_PROTOCOL_VERSION = 1;

export type AgentRole = 'background' | 'studio';

/* ------------------------------------------------------------------ */
/* Wire messages                                                      */
/* ------------------------------------------------------------------ */

/** Extension → bridge, first message after the socket opens. */
export interface HelloMessage {
  type: 'hello';
  role: AgentRole;
  protocol: typeof AGENT_PROTOCOL_VERSION;
  extensionVersion: string;
  /** Method names this client answers. The bridge builds its routing table from it. */
  methods: string[];
}

/** Bridge → extension. */
export interface CallMessage {
  type: 'call';
  id: string;
  method: string;
  params: unknown;
}

/** Extension → bridge. */
export interface ResultMessage {
  type: 'result';
  id: string;
  ok: true;
  result: unknown;
}

export interface ErrorMessage {
  type: 'result';
  id: string;
  ok: false;
  error: string;
}

/** Extension → bridge, unsolicited. */
export interface EventMessage {
  type: 'event';
  name: AgentEventName;
  data: unknown;
}

export type AgentEventName =
  /** A new capture bundle has been stored (data: SceneSummary-like BundleSummary). */
  | 'bundle'
  /** Studio tab opened or reloaded. */
  | 'studio-ready'
  /** Export progress 0..1. */
  | 'export-progress';

export type ExtensionToBridge = HelloMessage | ResultMessage | ErrorMessage | EventMessage;
export type BridgeToExtension = CallMessage;

/* ------------------------------------------------------------------ */
/* Method catalogue                                                   */
/* ------------------------------------------------------------------ */

/** Methods answered by the background service worker. */
export const BACKGROUND_METHODS = [
  'list_tabs',
  'inspect_page',
  'capture',
  'wait_for_capture',
  'open_studio',
] as const;

/** Methods answered by the Studio tab. */
export const STUDIO_METHODS = [
  'get_scene',
  'set_frame',
  'set_duration',
  'set_camera',
  'set_layer',
  'set_scene',
  'fit',
  'set_keyframes',
  'clear_timeline',
  'apply_preset',
  'seek',
  'screenshot',
  'contact_sheet',
  'export',
] as const;

export type BackgroundMethod = (typeof BACKGROUND_METHODS)[number];
export type StudioMethod = (typeof STUDIO_METHODS)[number];
export type AgentMethod = BackgroundMethod | StudioMethod;

/* ------------------------------------------------------------------ */
/* Shared value shapes                                                */
/* ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FrameFormatId =
  | 'landscape-16-9'
  | 'portrait-9-16'
  | 'square-1-1'
  | 'portrait-4-5'
  | 'landscape-4-3'
  | 'cinema-21-9'
  | 'custom';

export type EasingId = 'linear' | 'expo.out' | 'quart.out' | 'quint.inOut' | 'cubic.inOut' | 'back.out';

export type PresetId =
  | 'dolly-in'
  | 'dolly-out'
  | 'orbit-reveal'
  | 'push-tilt'
  | 'rack-focus'
  | 'stagger-cascade'
  | 'parallax-drift'
  | 'hero-lift'
  | 'whip-pan'
  | 'settle';

/** Keyframe as accepted and returned by the API (same shape as the Studio model). */
export interface AgentKeyframe {
  id?: string;
  /** null for camera and scene channels. */
  layerId: string | null;
  channel: string;
  time: number;
  value: number;
  /** Curve *into* this keyframe. Default 'quart.out'. */
  easing?: EasingId;
}

/* ------------------------------------------------------------------ */
/* background: list_tabs                                              */
/* ------------------------------------------------------------------ */

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
}

export type ListTabsParams = Record<string, never>;
export interface ListTabsResult {
  tabs: TabInfo[];
}

/* ------------------------------------------------------------------ */
/* background: inspect_page                                           */
/* ------------------------------------------------------------------ */

export interface InspectPageParams {
  /** Defaults to the active tab of the focused window. */
  tabId?: number;
  /** Max candidates returned (default 60). */
  limit?: number;
  /** Include a viewport screenshot (default true). */
  screenshot?: boolean;
}

/** One selectable element on the live page. `selector` is stable for the tab's lifetime. */
export interface PageCandidate {
  /** `[data-dio-id="N"]`, resolvable by `capture`. */
  selector: string;
  tag: string;
  /** First class token, if any. */
  className: string;
  /** Text excerpt, ≤ 120 chars. */
  text: string;
  /** Document-space rect (CSS px, page coordinates). */
  rect: Rect;
  /** True when the rect intersects the current viewport. */
  inViewport: boolean;
  /** Number of similar siblings found by the Zap clusterer (1 = alone). */
  clusterSize: number;
  /** Selectors of that cluster's members (including this one). */
  clusterSelectors: string[];
  /** Nesting depth from <body>. */
  depth: number;
  /** Heuristic role: 'hero' | 'card' | 'heading' | 'image' | 'button' | 'nav' | 'section' | 'text' | 'other'. */
  kind: string;
}

export interface InspectPageResult {
  tabId: number;
  url: string;
  title: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number; dpr: number };
  document: { width: number; height: number };
  /** PNG base64 of the visible viewport, when requested. */
  screenshotPng?: string;
  candidates: PageCandidate[];
  /** Selection the user already made with the picker overlay, if it is open. */
  userSelection?: { selectors: string[]; brief?: string; frameFormat?: FrameFormatId };
}

/* ------------------------------------------------------------------ */
/* background: capture                                                */
/* ------------------------------------------------------------------ */

export interface CaptureParams {
  tabId?: number;
  /**
   * CSS selectors of the elements to detach as layers. `[data-dio-id="N"]`
   * selectors from `inspect_page` are preferred; any CSS selector works.
   * Empty = whole page as a single background.
   */
  selectors: string[];
  /** User intent, stored in the bundle and echoed by `get_scene`. */
  brief?: string;
  frameFormat?: FrameFormatId;
  /** Expand each selector to its Zap cluster of similar siblings (default false). */
  expandClusters?: boolean;
}

export interface CaptureResult {
  /** Summary of the stored bundle; the Studio tab is opened/focused. */
  bundle: BundleSummary;
  /** Native raster status. */
  raster: 'native' | 'fallback' | 'error';
  rasterError?: string;
}

export interface BundleSummary {
  url: string;
  title: string;
  capturedAt: string;
  viewport: { width: number; height: number; dpr: number; scrollX: number; scrollY: number };
  document: { width: number; height: number };
  layerCount: number;
  brief?: string;
  frameFormat?: FrameFormatId;
}

/* ------------------------------------------------------------------ */
/* background: wait_for_capture / open_studio                         */
/* ------------------------------------------------------------------ */

export interface WaitForCaptureParams {
  /** Default 120000. */
  timeoutMs?: number;
}
export interface WaitForCaptureResult {
  bundle: BundleSummary;
}

export type OpenStudioParams = Record<string, never>;
export interface OpenStudioResult {
  tabId: number;
}

/* ------------------------------------------------------------------ */
/* studio: get_scene                                                  */
/* ------------------------------------------------------------------ */

export interface SceneLayer {
  id: string;
  role: 'background' | 'zap';
  label: string;
  clusterId?: string;
  /** Stagger order among zap layers. */
  order: number;
  /** Captured page rect (CSS px, page coordinates). */
  rect: Rect;
  /** Current base channel values (x, y, z, rotX…, opacity…). */
  values: Record<string, number>;
  visible: boolean;
  locked: boolean;
  castShadow: boolean;
  /** Channels that carry at least one keyframe. */
  animatedChannels: string[];
}

export interface ChannelInfo {
  id: string;
  target: 'layer' | 'camera' | 'scene';
  label: string;
  unit: string;
  default: number;
  min?: number;
  max?: number;
}

export interface GetSceneParams {
  /** Include the full keyframe list (default true). */
  keyframes?: boolean;
}

export interface GetSceneResult {
  bundle: BundleSummary;
  frame: { format: FrameFormatId; width: number; height: number };
  duration: number;
  playhead: number;
  camera: Record<string, number>;
  scene: Record<string, number>;
  sceneSettings: { lightEnabled: boolean; dofEnabled: boolean };
  layers: SceneLayer[];
  clusters: { id: string; memberIds: string[] }[];
  keyframes?: AgentKeyframe[];
  /** Registry of animatable channels with their units and limits. */
  channels: ChannelInfo[];
  presets: PresetInfo[];
  easings: EasingId[];
  frameFormats: { id: FrameFormatId; width: number; height: number }[];
}

export interface PresetInfo {
  id: PresetId;
  description: string;
  /** Parameter names with defaults and a one-line meaning. */
  params: { name: string; default: number | string; description: string }[];
  /** 'camera' presets ignore layerIds; 'layers' presets need them (default: all zap layers). */
  scope: 'camera' | 'layers' | 'both';
}

/* ------------------------------------------------------------------ */
/* studio: set_* / fit / seek                                         */
/* ------------------------------------------------------------------ */

export interface SetFrameParams {
  format?: FrameFormatId;
  width?: number;
  height?: number;
}

export interface SetDurationParams {
  duration: number;
}

export interface SetCameraParams {
  /** Partial camera values (distance, orbitX, orbitY, roll, targetX, targetY, fov, focus, aperture, maxBlur). */
  values: Record<string, number>;
  /** When set, writes keyframes at this time instead of base values. */
  at?: number;
  easing?: EasingId;
}

export interface SetLayerParams {
  layerId: string;
  values?: Record<string, number>;
  flags?: { visible?: boolean; locked?: boolean; castShadow?: boolean };
  at?: number;
  easing?: EasingId;
}

export interface SetSceneParams {
  values?: Record<string, number>;
  settings?: { lightEnabled?: boolean; dofEnabled?: boolean };
}

export interface FitParams {
  /** 'all' = every visible zap layer, 'viewport' = the captured source viewport, or a layer id / list of layer ids. */
  target: 'all' | 'viewport' | string | string[];
  /** Relative margin, default 0.08. */
  padding?: number;
  orbitX?: number;
  orbitY?: number;
  roll?: number;
  /** Apply to the camera (base or keyframe at `at`). Default true. */
  apply?: boolean;
  at?: number;
  easing?: EasingId;
}

export interface FitResult {
  camera: Record<string, number>;
}

export interface SeekParams {
  time: number;
}

/** Generic acknowledgement returning the values now in effect. */
export interface AckResult {
  ok: true;
  /** For camera/layer writes: resolved values after the write. */
  values?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* studio: timeline                                                   */
/* ------------------------------------------------------------------ */

export interface SetKeyframesParams {
  keyframes: AgentKeyframe[];
  /** 'merge' upserts by (layerId, channel, time); 'replace' drops every existing keyframe first. Default 'merge'. */
  mode?: 'merge' | 'replace';
}

export interface SetKeyframesResult {
  count: number;
  keyframes: AgentKeyframe[];
}

export interface ClearTimelineParams {
  /** Restrict to one layer (null = camera/scene tracks). Omit both to clear everything. */
  layerId?: string | null;
  channel?: string;
}

export interface ApplyPresetParams {
  preset: PresetId;
  /** Start time in seconds (default 0). */
  at?: number;
  /** Preset-specific parameters, see `get_scene().presets`. */
  params?: Record<string, number | string>;
  /** Layer ids in stagger order; default = all zap layers by `order`. */
  layerIds?: string[];
}

export interface ApplyPresetResult {
  added: AgentKeyframe[];
}

/* ------------------------------------------------------------------ */
/* studio: screenshot / contact_sheet / export                        */
/* ------------------------------------------------------------------ */

export interface ScreenshotParams {
  /** Timeline time to render (default: current playhead). */
  time?: number;
  /** Output width in px (height follows the frame aspect). Default 1280. */
  width?: number;
}

export interface ScreenshotResult {
  png: string;
  width: number;
  height: number;
  time: number;
}

export interface ContactSheetParams {
  /** Explicit times, or `count` evenly spaced over the duration (default 6). */
  times?: number[];
  count?: number;
  /** Columns in the grid (default 3). */
  columns?: number;
  /** Width of one cell in px (default 480). */
  cellWidth?: number;
}

export interface ContactSheetResult {
  png: string;
  width: number;
  height: number;
  times: number[];
}

export type ExportQualityId = 'draft' | 'standard' | 'smooth' | 'high';

export interface ExportParams {
  quality?: ExportQualityId;
  /** 1, 2, 4 or 8 sub-frames (default 1). */
  motionBlurSamples?: number;
}

export interface ExportResult {
  /** MP4 base64. The bridge writes it to disk and returns the path to the agent. */
  mp4: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bytes: number;
}
