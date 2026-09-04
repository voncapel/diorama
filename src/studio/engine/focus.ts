import type { CameraValues } from '../model/channels';
import type { DioramaRenderer } from './renderer';
import type { SceneSettings } from '../store';

/**
 * Resolves effective camera focus distance:
 * If depth-of-field is enabled, focus is locked, and a target layer/uv is defined,
 * calculates the distance from the camera to that world point.
 * Falls back to camera.focus otherwise (or if the target cannot be resolved).
 */
export function resolveFocus(
  renderer: DioramaRenderer,
  cam: CameraValues,
  sceneSettings: SceneSettings,
): number {
  if (sceneSettings.dofEnabled && sceneSettings.focusLocked && sceneSettings.focusTarget) {
    const dist = renderer.focusDistanceTo(
      sceneSettings.focusTarget.layerId,
      sceneSettings.focusTarget.u,
      sceneSettings.focusTarget.v,
    );
    if (dist !== null && Number.isFinite(dist)) {
      return dist;
    }
  }
  return cam.focus;
}
