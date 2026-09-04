import type { FrameFormatId } from './agentProtocol';

export const BUNDLE_STORAGE_KEY = 'diorama:lastBundle';

/**
 * Selection handed to a freshly injected content script. A message cannot be used
 * there: `executeScript` runs the script immediately, before any message could be
 * delivered, so the payload is parked in storage and consumed on start-up.
 */
export const PENDING_SELECTION_KEY = 'diorama:pendingSelection';

export const AGENT_INJECTION_KEY = 'diorama:agentInjection';

export interface CaptureSource {
  url: string;
  title: string;
  capturedAt: string;
}

export interface CaptureViewport {
  width: number;
  height: number;
  dpr: number;
  /** Page scroll at capture time. Optional for bundles created before this field existed. */
  scrollX?: number;
  scrollY?: number;
}

export interface LayerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureFont {
  family: string;
  weight: string;
  style: string;
  src: string;
}

export interface CaptureLayer {
  id: string;
  role: 'background' | 'zap';
  clusterId?: string;
  selector: string;
  /**
   * Identity of the captured element across captures. `id` and `selector` are both
   * positional (`L1`, `[data-diorama-layer="L1"]`), so they shift when the pick
   * order changes; this carries the stable `data-dio-id` marker instead and is what
   * layer settings and keyframes are reconciled on. Optional: absent on bundles
   * created before the accumulative selection flow.
   */
  stableId?: string;
  rect: LayerRect;
  label: string;
  order: number;
  /** Solid background color (e.g. '#ffffff'), primarily for role: 'background'. */
  backgroundColor?: string;
}

export interface CaptureCluster {
  id: string;
  score: number;
  memberIds: string[];
}

/** Stable `[data-dio-id="N"]` selectors of the picked elements, for re-seeding the overlay. */
export interface CaptureSelection {
  selectors: string[];
}

export interface CaptureDimensions {
  width: number;
  height: number;
}

/** One native layer capture. Coordinates are CSS pixels in the document space. */
export interface CaptureRasterLayer {
  layerId: string;
  sourceRect?: LayerRect;
  png?: string;
  /** A layer failure is retained without invalidating the other native captures. */
  error?: string;
}

/**
 * Optional Chrome DevTools Protocol raster payload added to a v1 clone bundle.
 * Every field is optional so older and partially enriched v1 bundles remain valid.
 */
export interface CaptureRaster {
  method?: 'cdp-page-capture-screenshot';
  viewport?: CaptureDimensions;
  document?: CaptureDimensions;
  dpr?: number;
  /** Complete, unmodified document screenshot used as the visual oracle. */
  oraclePng?: string;
  /** Complete document with every selected layer hidden without reflow. */
  backgroundPng?: string;
  layers?: CaptureRasterLayer[];
  /** Global CDP failure; the clone payload remains usable as a fallback. */
  error?: string;
}

export interface CaptureIntent {
  brief?: string;
  frameFormat?: FrameFormatId;
}

export interface CaptureBundle {
  version: 1;
  source: CaptureSource;
  viewport: CaptureViewport;
  html: string;
  styles: string;
  assets: Record<string, string>;
  fonts: CaptureFont[];
  layers: CaptureLayer[];
  clusters: CaptureCluster[];
  /** Optional: absent on bundles created before the accumulative selection flow. */
  selection?: CaptureSelection;
  /** User intent from picker or agent capture. */
  intent?: CaptureIntent;
  /** Optional native CDP raster enrichment; the clone fields above stay authoritative fallback data. */
  raster?: CaptureRaster;
}

export interface BundleMessage {
  type: 'DIORAMA_BUNDLE';
  bundle: CaptureBundle;
}

export interface ToggleMessage {
  type: 'DIORAMA_TOGGLE';
}

/** Studio → background: go back to the source tab and re-open the picker. */
export interface ReselectMessage {
  type: 'DIORAMA_RESELECT';
  url: string;
  selectors: string[];
}

/** Background → content: (re)start the picker, optionally pre-filled. */
export interface StartMessage {
  type: 'DIORAMA_START';
  selectors?: string[];
}

/** Background → studio tab: a refreshed bundle landed in storage. */
export interface BundleUpdatedMessage {
  type: 'DIORAMA_BUNDLE_UPDATED';
}

export interface FetchAssetMessage {
  type: 'DIORAMA_FETCH_ASSET';
  url: string;
}

export interface FetchAssetResponse {
  ok: boolean;
  dataUri?: string;
  error?: string;
}

export interface InspectMessage {
  type: 'DIORAMA_INSPECT';
  limit: number;
}

export interface AgentCaptureMessage {
  type: 'DIORAMA_AGENT_CAPTURE';
  selectors: string[];
  intent?: CaptureIntent;
  expandClusters: boolean;
}

export interface PickerStateMessage {
  type: 'DIORAMA_PICKER_STATE';
}

export interface PickerStateResponse {
  open: boolean;
  selectors: string[];
  brief?: string;
  frameFormat?: FrameFormatId;
}

export type DioramaMessage =
  | BundleMessage
  | FetchAssetMessage
  | ToggleMessage
  | ReselectMessage
  | StartMessage
  | BundleUpdatedMessage
  | InspectMessage
  | AgentCaptureMessage
  | PickerStateMessage;
