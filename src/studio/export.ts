import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { DioramaRenderer } from './engine/renderer';
import type { Keyframe } from './model/timeline';
import {
  evaluateTimeline,
  resolveCameraValues,
  resolveLayerValues,
  resolveSceneValues,
} from './model/timeline';
import type { CameraValues, LayerValues, SceneValues } from './model/channels';
import type { LayerState, SceneSettings } from './store';
import type { FrameState } from './engine/frame';
import { resolveFocus } from './engine/focus';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  duration: number;
  bitrate: number;
  /** 1 disables motion blur and keeps the single-render path. */
  motionBlurSamples: number;
  /** Shutter angle in degrees: fraction of the frame interval the shutter is open. */
  shutterAngle: number;
}

export const DEFAULT_EXPORT: ExportOptions = {
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 6,
  bitrate: 20_000_000,
  motionBlurSamples: 1,
  shutterAngle: 180,
};

export type ExportQualityName = 'draft' | 'standard' | 'smooth' | 'high';

/**
 * The frame owns the resolution and the aspect, so an export preset only picks
 * how much of it to render (scale) and how smooth it plays (fps).
 */
export const EXPORT_QUALITIES: Record<
  ExportQualityName,
  { label: string; scale: number; fps: number; bitrate: number }
> = {
  draft: { label: 'Brouillon · 0.5× · 30 fps', scale: 0.5, fps: 30, bitrate: 8_000_000 },
  standard: { label: 'Standard · 1× · 30 fps', scale: 1, fps: 30, bitrate: 20_000_000 },
  smooth: { label: 'Fluide · 1× · 60 fps', scale: 1, fps: 60, bitrate: 30_000_000 },
  high: { label: 'Haute · 2× · 60 fps', scale: 2, fps: 60, bitrate: 80_000_000 },
};

/** Nearest even value, at least 2: H.264 chroma subsampling requires even dimensions. */
function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Encoded size for a given frame and quality scale.
 *
 * Two constraints shape the result: H.264 4:2:0 needs both dimensions even, and
 * no encoder here is guaranteed above 4K, so an oversized request is scaled down
 * uniformly (aspect preserved) before the parity rounding rather than clamped
 * per-axis, which would stretch the picture.
 */
export function resolveExportSize(
  frame: FrameState,
  scale: number,
): { width: number; height: number } {
  const MAX_WIDTH = 3840;
  const MAX_HEIGHT = 2160;
  let width = Math.max(2, frame.width) * scale;
  let height = Math.max(2, frame.height) * scale;

  const overshoot = Math.max(width / MAX_WIDTH, height / MAX_HEIGHT);
  if (overshoot > 1) {
    width /= overshoot;
    height /= overshoot;
  }

  return { width: toEven(width), height: toEven(height) };
}

/**
 * H.264 level must cover the frame size: Level 4.0 tops out at 1080p, so
 * anything larger needs Level 5.1 or the encoder rejects the configuration.
 */
function avcCodecFor(width: number, height: number): string {
  return width * height <= 1920 * 1080 ? 'avc1.640028' : 'avc1.640033';
}

export interface ExportInput {
  renderer: DioramaRenderer;
  keyframes: Keyframe[];
  camera: CameraValues;
  layers: Record<string, LayerState>;
  scene: SceneValues;
  sceneSettings: SceneSettings;
  options?: Partial<ExportOptions>;
  onProgress?: (ratio: number) => void;
}

/**
 * Deterministic export loop (PRD §5.6): virtual clock, no rAF dependency.
 * The captured clone is inert, so layer snapshots stay valid for the whole run.
 */
export async function exportMp4(input: ExportInput): Promise<Blob> {
  const { renderer, keyframes, camera, layers, scene, sceneSettings, onProgress } = input;
  const opts: ExportOptions = { ...DEFAULT_EXPORT, ...input.options };
  const samples = Math.max(1, Math.round(opts.motionBlurSamples));

  if (typeof VideoEncoder === 'undefined') {
    throw new Error("WebCodecs (VideoEncoder) indisponible dans ce navigateur.");
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: opts.width,
      height: opts.height,
      frameRate: opts.fps,
    },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => console.error('[diorama] encoder error', err),
  });

  const encoderConfig: VideoEncoderConfig = {
    codec: avcCodecFor(opts.width, opts.height),
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate,
    framerate: opts.fps,
    latencyMode: 'quality',
  };

  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (support.supported !== true) {
    throw new Error(
      `Configuration d'encodage non supportée : ${opts.width}x${opts.height} @ ${opts.fps} fps (${encoderConfig.codec}).`,
    );
  }

  encoder.configure(encoderConfig);

  // Snapshot the live view settings, then switch to fixed export resolution.
  // CSS pixels, not device pixels: resize() expects CSS units.
  const previousSize = {
    width: renderer.canvas.clientWidth,
    height: renderer.canvas.clientHeight,
  };

  renderer.setExportSize(opts.width, opts.height);

  const totalFrames = Math.max(1, Math.round(opts.duration * opts.fps));

  const renderAt = (t: number) => {
    const ev = evaluateTimeline(keyframes, t);
    const cam = resolveCameraValues(camera, ev.camera);
    const layerValues: Record<string, LayerValues> = {};
    for (const id of Object.keys(layers)) {
      const lState = layers[id];
      if (lState) {
        layerValues[id] = resolveLayerValues(lState.values, ev.layers[id]);
      }
    }
    const sceneVals = resolveSceneValues(scene, ev.scene);

    renderer.applyCamera(cam);
    renderer.applyLayers(layerValues, layers);
    renderer.applyScene(sceneVals, sceneSettings);
    const effectiveFocus = resolveFocus(renderer, cam, sceneSettings);
    renderer.setDof(sceneSettings.dofEnabled, effectiveFocus, cam.aperture, cam.maxBlur);
    renderer.renderFrame();
  };

  // Off-screen accumulator for sub-frame averaging (motion blur only).
  let accum: HTMLCanvasElement | null = null;
  let accumCtx: CanvasRenderingContext2D | null = null;
  if (samples > 1) {
    accum = document.createElement('canvas');
    accum.width = opts.width;
    accum.height = opts.height;
    const ctx = accum.getContext('2d');
    if (!ctx) throw new Error("Contexte 2D indisponible pour l'accumulation motion blur");
    accumCtx = ctx;
  }

  // Warm-up: the first rendered frame differs from the steady state, so render
  // one at t=0 and discard it before encoding anything.
  renderAt(0);

  try {
    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / opts.fps;

      if (accum && accumCtx) {
        // Exact mean: additive blending of samples each weighted 1/samples.
        accumCtx.globalCompositeOperation = 'source-over';
        accumCtx.globalAlpha = 1;
        accumCtx.clearRect(0, 0, accum.width, accum.height);
        accumCtx.globalCompositeOperation = 'lighter';
        accumCtx.globalAlpha = 1 / samples;
        for (let k = 0; k < samples; k++) {
          const sub = (frame + (k / samples) * (opts.shutterAngle / 360)) / opts.fps;
          renderAt(sub);
          accumCtx.drawImage(renderer.canvas, 0, 0, accum.width, accum.height);
        }
        accumCtx.globalCompositeOperation = 'source-over';
        accumCtx.globalAlpha = 1;
      } else {
        renderAt(t);
      }

      const source = accum ?? renderer.canvas;
      const videoFrame = new VideoFrame(source, {
        timestamp: Math.round(t * 1e6),
        duration: Math.round(1e6 / opts.fps),
      });
      encoder.encode(videoFrame, { keyFrame: frame % opts.fps === 0 });
      videoFrame.close();

      // Back-pressure against the encoder queue.
      if (frame % 30 === 0) {
        await encoder.flush();
        onProgress?.(frame / totalFrames);
      }
    }

    await encoder.flush();
    muxer.finalize();
    onProgress?.(1);

    return new Blob([target.buffer as ArrayBuffer], { type: 'video/mp4' });
  } finally {
    // Never let cleanup mask the original failure.
    if (encoder.state !== 'closed') {
      try {
        encoder.close();
      } catch {
        /* ignore */
      }
    }
    renderer.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.resize(previousSize.width, previousSize.height);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
