import type { ExportQualityId } from '../../shared/agentProtocol';
import { viewportHandle } from '../components/Viewport';
import { EXPORT_QUALITIES, exportMp4, resolveExportSize } from '../export';
import type { ExportQualityName } from '../export';
import { useStudio } from '../store';

export interface RunExportParams {
  quality?: ExportQualityId;
  motionBlurSamples?: number;
  onProgress?: (ratio: number) => void;
}

export interface RunExportResult {
  blob: Blob;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bytes: number;
}

export async function runExport(params: RunExportParams = {}): Promise<RunExportResult> {
  const renderer = viewportHandle.renderer;
  if (!renderer) {
    throw new Error("Le viewport n'est pas prêt");
  }
  const st = useStudio.getState();
  if (st.exporting) {
    throw new Error("Un export est déjà en cours");
  }

  const qualityName: ExportQualityName = (params.quality ?? st.exportQuality) as ExportQualityName;
  const q = EXPORT_QUALITIES[qualityName] ?? EXPORT_QUALITIES.standard;
  const samples = params.motionBlurSamples ?? st.motionBlurSamples;
  const size = resolveExportSize(st.frame, q.scale);

  st.setPlaying(false);
  st.setExporting(true, 0);

  try {
    const blob = await exportMp4({
      renderer,
      keyframes: st.keyframes,
      camera: st.camera,
      layers: st.layers,
      scene: st.scene,
      sceneSettings: st.sceneSettings,
      options: {
        duration: st.duration,
        width: size.width,
        height: size.height,
        fps: q.fps,
        bitrate: q.bitrate,
        motionBlurSamples: samples,
      },
      onProgress: (ratio: number) => {
        st.setExporting(true, ratio);
        params.onProgress?.(ratio);
      },
    });

    return {
      blob,
      width: size.width,
      height: size.height,
      fps: q.fps,
      duration: st.duration,
      bytes: blob.size,
    };
  } finally {
    st.setExporting(false, 0);
  }
}
