import { AgentClient } from '../../shared/agentClient';
import type {
  AckResult,
  AgentKeyframe,
  ApplyPresetParams,
  ApplyPresetResult,
  ClearTimelineParams,
  ContactSheetParams,
  ContactSheetResult,
  ExportParams,
  ExportResult,
  FitParams,
  FitResult,
  FrameFormatId,
  GetSceneParams,
  GetSceneResult,
  SceneLayer,
  ScreenshotParams,
  ScreenshotResult,
  SeekParams,
  SetCameraParams,
  SetDurationParams,
  SetFrameParams,
  SetKeyframesParams,
  SetKeyframesResult,
  SetLayerParams,
  SetSceneParams,
} from '../../shared/agentProtocol';
import type { CaptureBundle } from '../../shared/types';
import { viewportHandle } from '../components/Viewport';
import { fitRectInFrame, FRAME_FORMATS, frameAspect } from '../engine/frame';
import type { FrameFormatName } from '../engine/frame';
import { applyPreset, presetInfos } from '../engine/presets';
import {
  CAMERA_CHANNELS,
  clampToChannel,
  LAYER_CHANNELS,
  SCENE_CHANNELS,
} from '../model/channels';
import type {
  CameraChannelId,
  CameraValues,
  ChannelDef,
  ChannelId,
  LayerChannelId,
  LayerValues,
  SceneChannelId,
} from '../model/channels';
import { EASINGS, makeKeyframe } from '../model/timeline';
import type { Easing, Keyframe } from '../model/timeline';
import { orderedLayers, useStudio } from '../store';
import { runExport } from './exportRun';
import { renderFramesOffscreen, renderOffscreen } from './offscreen';

function requireBundle(): CaptureBundle {
  const bundle = useStudio.getState().bundle;
  if (!bundle) {
    throw new Error('Aucun bundle chargé dans le Studio');
  }
  return bundle;
}

const ALL_CHANNELS_MAP = new Map<string, ChannelDef>([
  ...LAYER_CHANNELS.map((c) => [c.id, c] as const),
  ...CAMERA_CHANNELS.map((c) => [c.id, c] as const),
  ...SCENE_CHANNELS.map((c) => [c.id, c] as const),
]);

function channelDef(id: string): ChannelDef {
  const def = ALL_CHANNELS_MAP.get(id);
  if (!def) throw new Error(`Canal inconnu: ${id}`);
  return def;
}

function upsertKeyframes(list: AgentKeyframe[]): Keyframe[] {
  const st = useStudio.getState();
  let currentKeyframes = [...st.keyframes];

  for (const kf of list) {
    const def = channelDef(kf.channel);
    const clampedValue = clampToChannel(def.id as ChannelId, kf.value);
    const easing: Easing = kf.easing && kf.easing in EASINGS ? (kf.easing as Easing) : 'quart.out';
    const time = Math.min(st.duration, Math.max(0, kf.time));

    const existingIndex = currentKeyframes.findIndex(
      (k) =>
        k.layerId === kf.layerId &&
        k.channel === kf.channel &&
        Math.abs(k.time - time) < 1e-3,
    );

    if (existingIndex >= 0) {
      currentKeyframes[existingIndex] = {
        ...currentKeyframes[existingIndex]!,
        value: clampedValue,
        easing,
      };
    } else {
      currentKeyframes.push(
        makeKeyframe(kf.layerId, kf.channel as ChannelId, time, clampedValue, easing),
      );
    }
  }

  st.setKeyframes(currentKeyframes);
  return currentKeyframes;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function startStudioAgent(): () => void {
  let client: AgentClient | null = null;

  const handlers: Record<string, (params: any) => Promise<unknown> | unknown> = {
    get_scene: (params: GetSceneParams = {}): GetSceneResult => {
      const bundle = requireBundle();
      const s = useStudio.getState();

      const bg = bundle.layers.find((l) => l.role === 'background');
      const docW = bundle.raster?.document?.width ?? bg?.rect.w ?? bundle.viewport.width;
      const docH = bundle.raster?.document?.height ?? bg?.rect.h ?? bundle.viewport.height;
      const zapCount = bundle.layers.filter((l) => l.role === 'zap').length;

      const brief = (bundle as any).intent?.brief;
      const frameFormat = (bundle as any).intent?.frameFormat;

      const bundleSummary = {
        url: bundle.source.url,
        title: bundle.source.title,
        capturedAt: bundle.source.capturedAt,
        viewport: {
          width: bundle.viewport.width,
          height: bundle.viewport.height,
          dpr: bundle.viewport.dpr,
          scrollX: bundle.viewport.scrollX ?? 0,
          scrollY: bundle.viewport.scrollY ?? 0,
        },
        document: {
          width: docW,
          height: docH,
        },
        layerCount: zapCount,
        brief,
        frameFormat,
      };

      const animatedChannelsByLayer = new Map<string, Set<string>>();
      for (const kf of s.keyframes) {
        if (kf.layerId) {
          if (!animatedChannelsByLayer.has(kf.layerId)) {
            animatedChannelsByLayer.set(kf.layerId, new Set());
          }
          animatedChannelsByLayer.get(kf.layerId)!.add(kf.channel);
        }
      }

      const layers: SceneLayer[] = orderedLayers(bundle).map((l) => {
        const state = s.layers[l.id];
        return {
          id: l.id,
          role: l.role,
          label: l.label,
          clusterId: l.clusterId,
          order: l.order,
          rect: {
            x: l.rect.x,
            y: l.rect.y,
            w: l.rect.w,
            h: l.rect.h,
          },
          values: state ? { ...state.values } : {},
          visible: state?.visible ?? true,
          locked: state?.locked ?? false,
          castShadow: state?.castShadow ?? false,
          animatedChannels: Array.from(animatedChannelsByLayer.get(l.id) ?? []),
        };
      });

      const clusters = bundle.clusters.map((c) => ({
        id: c.id,
        memberIds: [...c.memberIds],
      }));

      const channels = [
        ...LAYER_CHANNELS.map((c: any) => ({
          id: c.id,
          target: 'layer' as const,
          label: c.label,
          unit: c.unit ?? '',
          default: c.default,
          min: c.min,
          max: c.max,
        })),
        ...CAMERA_CHANNELS.map((c: any) => ({
          id: c.id,
          target: 'camera' as const,
          label: c.label,
          unit: c.unit ?? '',
          default: c.default,
          min: c.min,
          max: c.max,
        })),
        ...SCENE_CHANNELS.map((c: any) => ({
          id: c.id,
          target: 'scene' as const,
          label: c.label,
          unit: c.unit ?? '',
          default: c.default,
          min: c.min,
          max: c.max,
        })),
      ];

      const frameFormatsList = (
        Object.keys(FRAME_FORMATS) as Exclude<FrameFormatName, 'custom'>[]
      ).map((k) => ({
        id: k as FrameFormatId,
        width: FRAME_FORMATS[k].width,
        height: FRAME_FORMATS[k].height,
      }));

      const result: GetSceneResult = {
        bundle: bundleSummary,
        frame: {
          format: s.frame.format as FrameFormatId,
          width: s.frame.width,
          height: s.frame.height,
        },
        duration: s.duration,
        playhead: s.playhead,
        camera: { ...s.camera },
        scene: { ...s.scene },
        sceneSettings: {
          lightEnabled: s.sceneSettings.lightEnabled,
          dofEnabled: s.sceneSettings.dofEnabled,
        },
        layers,
        clusters,
        channels,
        presets: presetInfos(),
        easings: Object.keys(EASINGS) as any,
        frameFormats: frameFormatsList,
      };

      if (params.keyframes !== false) {
        result.keyframes = s.keyframes.map((k) => ({
          id: k.id,
          layerId: k.layerId,
          channel: k.channel,
          time: k.time,
          value: k.value,
          easing: k.easing as any,
        }));
      }

      return result;
    },

    set_frame: (params: SetFrameParams): AckResult => {
      const s = useStudio.getState();
      if (params.format && params.format !== 'custom') {
        s.setFrameFormat(params.format as FrameFormatName);
      }
      if (params.width !== undefined || params.height !== undefined) {
        const patch: any = {};
        if (params.width !== undefined) patch.width = params.width;
        if (params.height !== undefined) patch.height = params.height;
        s.setFrame(patch);
      }
      const updated = useStudio.getState().frame;
      return { ok: true, values: { width: updated.width, height: updated.height } };
    },

    set_duration: (params: SetDurationParams): AckResult => {
      const s = useStudio.getState();
      if (typeof params.duration === 'number' && params.duration > 0) {
        s.setDuration(params.duration);
      }
      return { ok: true };
    },

    set_camera: (params: SetCameraParams): AckResult => {
      const s = useStudio.getState();
      if (params.at !== undefined) {
        const keyframesToAdd: AgentKeyframe[] = [];
        for (const ch in params.values) {
          keyframesToAdd.push({
            layerId: null,
            channel: ch,
            time: params.at,
            value: params.values[ch]!,
            easing: params.easing,
          });
        }
        upsertKeyframes(keyframesToAdd);
      } else {
        const patch: Partial<CameraValues> = {};
        for (const ch in params.values) {
          patch[ch as CameraChannelId] = params.values[ch];
        }
        s.setCameraValues(patch);
      }

      return { ok: true, values: { ...useStudio.getState().camera } };
    },

    set_layer: (params: SetLayerParams): AckResult => {
      const s = useStudio.getState();
      const layerId = params.layerId;
      if (!s.layers[layerId]) {
        throw new Error(`Couche introuvable: ${layerId}`);
      }

      if (params.flags) {
        s.setLayerFlags(layerId, params.flags);
      }

      if (params.values) {
        if (params.at !== undefined) {
          const keyframesToAdd: AgentKeyframe[] = [];
          for (const ch in params.values) {
            keyframesToAdd.push({
              layerId,
              channel: ch,
              time: params.at,
              value: params.values[ch]!,
              easing: params.easing,
            });
          }
          upsertKeyframes(keyframesToAdd);
        } else {
          const patch: Partial<LayerValues> = {};
          for (const ch in params.values) {
            patch[ch as LayerChannelId] = params.values[ch];
          }
          s.setLayerValues(layerId, patch);
        }
      }

      const updated = useStudio.getState().layers[layerId];
      return { ok: true, values: updated ? { ...updated.values } : {} };
    },

    set_scene: (params: SetSceneParams): AckResult => {
      const s = useStudio.getState();
      if (params.values) {
        for (const ch in params.values) {
          s.setSceneValue(ch as SceneChannelId, params.values[ch]!);
        }
      }
      if (params.settings) {
        s.setSceneSettings(params.settings);
      }
      return { ok: true, values: { ...useStudio.getState().scene } };
    },

    fit: (params: FitParams): FitResult => {
      const renderer = viewportHandle.renderer;
      if (!renderer) {
        throw new Error("Le viewport n'est pas prêt");
      }
      const bundle = requireBundle();
      const s = useStudio.getState();
      const fov = s.camera.fov;
      const padding = params.padding ?? 0.08;

      let camValues: CameraValues;

      if (params.target === 'all') {
        camValues = renderer.fitAll(bundle, fov, padding);
      } else if (params.target === 'viewport') {
        camValues = renderer.fitCamera(bundle, fov, padding);
      } else if (typeof params.target === 'string') {
        const fit = renderer.fitLayer(bundle, params.target, fov, padding);
        if (!fit) {
          throw new Error(`Impossible de cadrer la couche ${params.target}`);
        }
        camValues = fit;
      } else if (Array.isArray(params.target)) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const id of params.target) {
          const rect = renderer.layerWorldRect(id);
          if (rect) {
            minX = Math.min(minX, rect.cx - rect.w / 2);
            maxX = Math.max(maxX, rect.cx + rect.w / 2);
            minY = Math.min(minY, rect.cy - rect.h / 2);
            maxY = Math.max(maxY, rect.cy + rect.h / 2);
          }
        }

        if (!Number.isFinite(minX)) {
          camValues = renderer.fitCamera(bundle, fov, padding);
        } else {
          const unionRect = {
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2,
            w: Math.max(1, maxX - minX),
            h: Math.max(1, maxY - minY),
          };
          const fit = fitRectInFrame(unionRect, frameAspect(s.frame), fov, padding);
          camValues = {
            ...s.camera,
            distance: fit.distance,
            focus: fit.distance,
            targetX: fit.targetX,
            targetY: fit.targetY,
          };
        }
      } else {
        throw new Error('Cible fit invalide');
      }

      camValues.orbitX = params.orbitX !== undefined ? params.orbitX : s.camera.orbitX;
      camValues.orbitY = params.orbitY !== undefined ? params.orbitY : s.camera.orbitY;
      camValues.roll = params.roll !== undefined ? params.roll : s.camera.roll;

      if (params.apply !== false) {
        if (params.at !== undefined) {
          const kfs: AgentKeyframe[] = [
            'distance',
            'targetX',
            'targetY',
            'orbitX',
            'orbitY',
            'roll',
            'focus',
          ].map((channel) => ({
            layerId: null,
            channel,
            time: params.at!,
            value: camValues[channel as keyof CameraValues],
            easing: params.easing,
          }));
          upsertKeyframes(kfs);
        } else {
          s.setCameraValues(camValues);
        }
      }

      return { camera: camValues as unknown as Record<string, number> };
    },

    set_keyframes: (params: SetKeyframesParams): SetKeyframesResult => {
      const s = useStudio.getState();
      const bundle = requireBundle();
      const validLayerIds = new Set(bundle.layers.map((l) => l.id));

      if (params.mode === 'replace') {
        s.setKeyframes([]);
      }

      for (const kf of params.keyframes) {
        const def = channelDef(kf.channel);
        if (def.target === 'layer') {
          if (!kf.layerId || !validLayerIds.has(kf.layerId)) {
            throw new Error(`layerId inconnu ou manquant pour canal de couche: ${kf.layerId}`);
          }
        } else {
          if (kf.layerId !== null) {
            throw new Error(`layerId doit être null pour les canaux caméra ou scène`);
          }
        }
        if (kf.easing && !(kf.easing in EASINGS)) {
          throw new Error(`Courbe d’atténuation inconnue: ${kf.easing}`);
        }
        if (kf.time < 0 || kf.time > s.duration) {
          throw new Error(`Temps hors intervalle [0, ${s.duration}]: ${kf.time}`);
        }
      }

      const updated = upsertKeyframes(params.keyframes);
      return {
        count: updated.length,
        keyframes: updated.map((k) => ({
          id: k.id,
          layerId: k.layerId,
          channel: k.channel,
          time: k.time,
          value: k.value,
          easing: k.easing as any,
        })),
      };
    },

    clear_timeline: (params: ClearTimelineParams = {}): AckResult => {
      const s = useStudio.getState();
      if (params.layerId === undefined && params.channel === undefined) {
        s.setKeyframes([]);
        return { ok: true };
      }

      const filtered = s.keyframes.filter((k) => {
        if (params.layerId !== undefined && k.layerId !== params.layerId) {
          return true;
        }
        if (params.channel !== undefined && k.channel !== params.channel) {
          return true;
        }
        return false;
      });

      s.setKeyframes(filtered);
      return { ok: true };
    },

    apply_preset: (params: ApplyPresetParams): ApplyPresetResult => {
      const bundle = requireBundle();
      const s = useStudio.getState();
      const renderer = viewportHandle.renderer;

      const zapLayers = bundle.layers
        .filter((l) => l.role === 'zap')
        .sort((a, b) => a.order - b.order);

      const zapLayerIds = params.layerIds ?? zapLayers.map((l) => l.id);

      const layerZ: Record<string, number> = {};
      const layerBase: Record<string, LayerValues> = {};
      const layerRects: Record<string, { cx: number; cy: number; w: number; h: number }> = {};
      const animatedChannels: Record<string, string[]> = {};

      for (const id in s.layers) {
        layerZ[id] = s.layers[id]!.values.z;
        layerBase[id] = s.layers[id]!.values;
        if (renderer) {
          const r = renderer.layerWorldRect(id);
          if (r) layerRects[id] = r;
        }
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

      const ctx = {
        zapLayerIds,
        baseDistance: s.camera.distance,
        baseCamera: s.camera,
        duration: s.duration,
        layerRects,
        layerZ,
        layerBase,
        animatedChannels,
      };

      const kfs = applyPreset(
        params.preset,
        ctx,
        params.at ?? 0,
        params.params ?? {},
        zapLayerIds,
      );

      if (params.preset === 'rack-focus') {
        s.setSceneSettings({ dofEnabled: true });
      }

      const agentKfs: AgentKeyframe[] = kfs.map((k) => ({
        layerId: k.layerId,
        channel: k.channel,
        time: k.time,
        value: k.value,
        easing: k.easing as any,
      }));

      upsertKeyframes(agentKfs);

      return { added: agentKfs };
    },

    seek: (params: SeekParams): AckResult => {
      const s = useStudio.getState();
      s.setPlaying(false);
      s.setPlayhead(Math.min(s.duration, Math.max(0, params.time)));
      return { ok: true };
    },

    screenshot: async (params: ScreenshotParams = {}): Promise<ScreenshotResult> => {
      const s = useStudio.getState();
      const time = params.time ?? s.playhead;
      const width = params.width ?? 1280;
      return await renderOffscreen(time, width);
    },

    contact_sheet: async (params: ContactSheetParams = {}): Promise<ContactSheetResult> => {
      const s = useStudio.getState();
      const count = params.count ?? 6;
      let times: number[];
      if (params.times && params.times.length > 0) {
        times = params.times;
      } else {
        times = [];
        const step = count > 1 ? s.duration / (count - 1) : 0;
        for (let i = 0; i < count; i++) {
          times.push(Math.min(s.duration, i * step));
        }
      }

      const cellWidth = params.cellWidth ?? 480;
      const columns = Math.max(1, params.columns ?? 3);
      const rows = Math.ceil(times.length / columns);
      const footerH = 18;

      const { canvases, height: cellHeight } = await renderFramesOffscreen(times, cellWidth);

      const totalWidth = columns * cellWidth;
      const cellTotalHeight = cellHeight + footerH;
      const totalHeight = rows * cellTotalHeight;

      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = totalWidth;
      compositeCanvas.height = totalHeight;
      const ctx = compositeCanvas.getContext('2d');
      if (!ctx) throw new Error('Impossible de créer le contexte 2D pour la planche contact');

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, totalWidth, totalHeight);

      canvases.forEach((cellCanvas, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = col * cellWidth;
        const y = row * cellTotalHeight;
        const t = times[i] ?? 0;

        ctx.drawImage(cellCanvas, x, y, cellWidth, cellHeight);

        // Footer banner
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x, y + cellHeight, cellWidth, footerH);

        ctx.fillStyle = '#dddddd';
        ctx.font = '12px monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(`t = ${t.toFixed(2)} s`, x + 6, y + cellHeight + footerH / 2);
      });

      const dataUrl = compositeCanvas.toDataURL('image/png');
      const png = dataUrl.replace(/^data:image\/png;base64,/, '');

      return {
        png,
        width: totalWidth,
        height: totalHeight,
        times,
      };
    },

    export: async (params: ExportParams = {}): Promise<ExportResult> => {
      let lastProgressEmit = 0;
      const res = await runExport({
        quality: params.quality,
        motionBlurSamples: params.motionBlurSamples,
        onProgress: (ratio: number) => {
          const now = performance.now();
          if (now - lastProgressEmit >= 250 || ratio === 1) {
            lastProgressEmit = now;
            client?.emit('export-progress', ratio);
          }
        },
      });

      const base64Mp4 = await blobToBase64(res.blob);
      return {
        mp4: base64Mp4,
        width: res.width,
        height: res.height,
        fps: res.fps,
        duration: res.duration,
        bytes: res.bytes,
      };
    },
  };

  client = new AgentClient({
    role: 'studio',
    handlers,
    onStateChange: (connected) => {
      useStudio.getState().setAgentConnected(connected);
      if (connected) {
        const hasBundle = !!useStudio.getState().bundle;
        client?.emit('studio-ready', { hasBundle });
      }
    },
  });

  client.start();

  return () => {
    client?.stop();
    client = null;
  };
}
