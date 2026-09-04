import { useMemo } from 'react';
import { useStudio } from '../store';
import {
  evaluateTimeline,
  resolveCameraValues,
  resolveLayerValues,
  resolveSceneValues,
  type EvaluatedTimeline,
} from '../model/timeline';
import type { CameraValues, LayerValues, SceneValues } from '../model/channels';

export interface EvaluatedValues {
  evaluated: EvaluatedTimeline;
  camera: CameraValues;
  scene: SceneValues;
  layers: Record<string, LayerValues>;
  resolveLayer: (id: string) => LayerValues | undefined;
}

/**
 * Computes resolved channel values at the current playhead.
 * Evaluates the timeline once per render with useMemo(keyframes, playhead).
 */
export function useEvaluatedValues(): EvaluatedValues {
  const keyframes = useStudio((s) => s.keyframes);
  const playhead = useStudio((s) => s.playhead);
  const baseLayers = useStudio((s) => s.layers);
  const baseCamera = useStudio((s) => s.camera);
  const baseScene = useStudio((s) => s.scene);

  const evaluated = useMemo(() => evaluateTimeline(keyframes, playhead), [keyframes, playhead]);

  const camera = useMemo(
    () => resolveCameraValues(baseCamera, evaluated.camera),
    [baseCamera, evaluated.camera],
  );

  const scene = useMemo(
    () => resolveSceneValues(baseScene, evaluated.scene),
    [baseScene, evaluated.scene],
  );

  const layers = useMemo(() => {
    const res: Record<string, LayerValues> = {};
    for (const id in baseLayers) {
      const l = baseLayers[id];
      if (l) res[id] = resolveLayerValues(l.values, evaluated.layers[id]);
    }
    return res;
  }, [baseLayers, evaluated.layers]);

  const resolveLayer = useMemo(() => {
    return (id: string): LayerValues | undefined => {
      const l = baseLayers[id];
      if (!l) return undefined;
      return resolveLayerValues(l.values, evaluated.layers[id]);
    };
  }, [baseLayers, evaluated.layers]);

  return {
    evaluated,
    camera,
    scene,
    layers,
    resolveLayer,
  };
}
