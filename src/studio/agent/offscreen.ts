import { frameAspect } from '../engine/frame';
import { resolveFocus } from '../engine/focus';
import {
  evaluateTimeline,
  resolveCameraValues,
  resolveLayerValues,
  resolveSceneValues,
} from '../model/timeline';
import type { LayerValues } from '../model/channels';
import { useStudio } from '../store';
import { viewportHandle } from '../components/Viewport';

// Mutex promise chain to serialize offscreen renders
let offscreenMutex = Promise.resolve<any>(null);

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = offscreenMutex.then(fn, fn);
  offscreenMutex = next.catch(() => {});
  return next;
}

function waitNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Single frame render at a given time and width.
 */
export async function renderOffscreen(
  time: number,
  width: number,
): Promise<{ png: string; width: number; height: number; time: number }> {
  return withMutex(async () => {
    const renderer = viewportHandle.renderer;
    if (!renderer) {
      throw new Error("Le viewport n'est pas prêt");
    }
    const st = useStudio.getState();
    if (st.exporting) {
      throw new Error("Impossible de rendre pendant qu'un export vidéo est en cours");
    }

    st.setAgentRendering(true);
    await waitNextFrame();

    const previousSize = {
      width: renderer.canvas.clientWidth,
      height: renderer.canvas.clientHeight,
    };
    const prevPr = window.devicePixelRatio || 1;

    const height = Math.max(2, Math.round(width / frameAspect(st.frame)));

    try {
      renderer.setExportSize(width, height);

      const renderAt = (t: number) => {
        const ev = evaluateTimeline(st.keyframes, t);
        const cam = resolveCameraValues(st.camera, ev.camera);
        const layerValues: Record<string, LayerValues> = {};
        for (const id in st.layers) {
          const lState = st.layers[id];
          if (lState) {
            layerValues[id] = resolveLayerValues(lState.values, ev.layers[id]);
          }
        }
        const sceneVals = resolveSceneValues(st.scene, ev.scene);

        renderer.applyCamera(cam);
        renderer.applyLayers(layerValues, st.layers);
        renderer.applyScene(sceneVals, st.sceneSettings);
        const effectiveFocus = resolveFocus(renderer, cam, st.sceneSettings);
        renderer.setDof(st.sceneSettings.dofEnabled, effectiveFocus, cam.aperture, cam.maxBlur);
        renderer.renderFrame();
      };

      // Warm-up render
      renderAt(time);
      // Actual render
      renderAt(time);

      const canvas2d = document.createElement('canvas');
      canvas2d.width = width;
      canvas2d.height = height;
      const ctx = canvas2d.getContext('2d');
      if (!ctx) throw new Error('Impossible d’obtenir le contexte 2D pour le rendu offscreen');

      ctx.drawImage(renderer.canvas, 0, 0, width, height);
      const dataUrl = canvas2d.toDataURL('image/png');
      const png = dataUrl.replace(/^data:image\/png;base64,/, '');

      return { png, width, height, time };
    } finally {
      renderer.renderer.setPixelRatio(Math.min(prevPr, 2));
      renderer.resize(previousSize.width, previousSize.height);
      st.setAgentRendering(false);
    }
  });
}

/**
 * Multiple frame render for contact sheet: changes size once.
 */
export async function renderFramesOffscreen(
  times: number[],
  width: number,
): Promise<{ canvases: HTMLCanvasElement[]; width: number; height: number }> {
  return withMutex(async () => {
    const renderer = viewportHandle.renderer;
    if (!renderer) {
      throw new Error("Le viewport n'est pas prêt");
    }
    const st = useStudio.getState();
    if (st.exporting) {
      throw new Error("Impossible de rendre pendant qu'un export vidéo est en cours");
    }

    st.setAgentRendering(true);
    await waitNextFrame();

    const previousSize = {
      width: renderer.canvas.clientWidth,
      height: renderer.canvas.clientHeight,
    };
    const prevPr = window.devicePixelRatio || 1;

    const height = Math.max(2, Math.round(width / frameAspect(st.frame)));

    try {
      renderer.setExportSize(width, height);

      const renderAt = (t: number) => {
        const ev = evaluateTimeline(st.keyframes, t);
        const cam = resolveCameraValues(st.camera, ev.camera);
        const layerValues: Record<string, LayerValues> = {};
        for (const id in st.layers) {
          const lState = st.layers[id];
          if (lState) {
            layerValues[id] = resolveLayerValues(lState.values, ev.layers[id]);
          }
        }
        const sceneVals = resolveSceneValues(st.scene, ev.scene);

        renderer.applyCamera(cam);
        renderer.applyLayers(layerValues, st.layers);
        renderer.applyScene(sceneVals, st.sceneSettings);
        const effectiveFocus = resolveFocus(renderer, cam, st.sceneSettings);
        renderer.setDof(st.sceneSettings.dofEnabled, effectiveFocus, cam.aperture, cam.maxBlur);
        renderer.renderFrame();
      };

      // Warm-up
      renderAt(times[0] ?? 0);

      const canvases: HTMLCanvasElement[] = [];

      for (const t of times) {
        renderAt(t);
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Impossible d’obtenir le contexte 2D');
        ctx.drawImage(renderer.canvas, 0, 0, width, height);
        canvases.push(c);
      }

      return { canvases, width, height };
    } finally {
      renderer.renderer.setPixelRatio(Math.min(prevPr, 2));
      renderer.resize(previousSize.width, previousSize.height);
      st.setAgentRendering(false);
    }
  });
}
