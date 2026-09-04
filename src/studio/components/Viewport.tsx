import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStudio } from '../store';
import { DioramaRenderer } from '../engine/renderer';
import { buildScene, disposeScene } from '../engine/sceneBuilder';
import type { BuiltScene } from '../engine/sceneBuilder';
import { computeFrameBox, frameAspect } from '../engine/frame';
import type { FrameBox, FrameState } from '../engine/frame';
import {
  evaluateTimeline,
  resolveCameraValues,
  resolveLayerValues,
  resolveSceneValues,
} from '../model/timeline';
import type { CameraValues, LayerValues } from '../model/channels';
import { resolveFocus } from '../engine/focus';
import '../styles/viewport.css';

export interface ViewportHandle {
  renderer: DioramaRenderer | null;
}

/** Shared handle so other components (e.g. export) can reach the live renderer. */
export const viewportHandle: ViewportHandle = { renderer: null };

/** Fractions of the frame where each guide mode draws its lines. */
function guideFractions(mode: FrameState['guides']): { x: number[]; y: number[] } {
  switch (mode) {
    case 'thirds':
      return { x: [1 / 3, 2 / 3], y: [1 / 3, 2 / 3] };
    case 'center':
      return { x: [0.5], y: [0.5] };
    case 'grid':
      return { x: [0.25, 0.5, 0.75], y: [0.25, 0.5, 0.75] };
    default:
      return { x: [], y: [] };
  }
}

type Point2D = { x: number; y: number };

type HandleKind =
  | 'corner-tl'
  | 'corner-tr'
  | 'corner-br'
  | 'corner-bl'
  | 'edge-top'
  | 'edge-right'
  | 'edge-bottom'
  | 'edge-left';

interface DragState {
  type: 'layer' | 'orbit' | 'pan' | 'handle';
  initialPointerX: number;
  initialPointerY: number;
  thresholdMet: boolean;
  handleKind?: HandleKind;
  handleLayerId?: string;
  initialScale?: number;
  centerPx?: Point2D;
  initialValues?: Record<string, LayerValues>;
  initialCamera?: CameraValues;
  altPressed?: boolean;
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<DioramaRenderer | null>(null);
  const sceneRef = useRef<BuiltScene | null>(null);
  const initialFitDoneRef = useRef(false);
  const buildSeqRef = useRef(0);

  const svgOverlayRef = useRef<SVGSVGElement>(null);
  const hoverPolygonRef = useRef<SVGPolygonElement>(null);
  const selectionGroupRef = useRef<SVGGElement>(null);
  const snapGuidesGroupRef = useRef<SVGGElement>(null);
  const focusMarkerGroupRef = useRef<SVGGElement>(null);

  // Active snap guides to render in SVG
  const snapGuidesRef = useRef<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });

  // Keep track of resolved camera for worldPerPx calculations
  const resolvedCameraRef = useRef<CameraValues>(useStudio.getState().camera);

  const bundle = useStudio((s) => s.bundle);
  const error = useStudio((s) => s.error);
  const loading = useStudio((s) => s.loading);
  const frame = useStudio((s) => s.frame);
  const tool = useStudio((s) => s.tool);
  const selection = useStudio((s) => s.selection);
  const hoveredLayerId = useStudio((s) => s.hoveredLayerId);

  const setError = useStudio((s) => s.setError);
  const setCameraValues = useStudio((s) => s.setCameraValues);
  const setCameraValue = useStudio((s) => s.setCameraValue);
  const setSceneSettings = useStudio((s) => s.setSceneSettings);
  const setFocusTarget = useStudio((s) => s.setFocusTarget);
  const setLayerValues = useStudio((s) => s.setLayerValues);
  const select = useStudio((s) => s.select);
  const setHovered = useStudio((s) => s.setHovered);
  const setTool = useStudio((s) => s.setTool);
  const removeLayer = useStudio((s) => s.removeLayer);

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const aspect = frameAspect(frame);
  const box: FrameBox = useMemo(
    () => computeFrameBox(containerSize.width, containerSize.height, aspect),
    [containerSize.width, containerSize.height, aspect],
  );

  const boxRef = useRef<FrameBox>(box);
  boxRef.current = box;

  // Drag interaction state
  const dragStateRef = useRef<DragState | null>(null);

  // Initialize renderer & rAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: DioramaRenderer;
    try {
      renderer = new DioramaRenderer(canvas);
    } catch (err) {
      console.error('[DIORAMA ERROR]', err);
      useStudio.getState().setError(err instanceof Error ? err.message : String(err));
      return () => {};
    }

    rendererRef.current = renderer;
    viewportHandle.renderer = renderer;
    renderer.setFrameAspect(frameAspect(useStudio.getState().frame));

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);

    let raf = 0;
    const loop = () => {
      const st = useStudio.getState();
      const currentBox = boxRef.current;

      if (!st.exporting && !st.agentRendering && rendererRef.current) {
        const ev = evaluateTimeline(st.keyframes, st.playhead);
        const cam = resolveCameraValues(st.camera, ev.camera);
        resolvedCameraRef.current = cam;

        const layerValues: Record<string, LayerValues> = {};
        for (const id in st.layers) {
          const lState = st.layers[id];
          if (lState) {
            layerValues[id] = resolveLayerValues(lState.values, ev.layers[id]);
          }
        }
        const scene = resolveSceneValues(st.scene, ev.scene);

        renderer.applyCamera(cam);
        renderer.applyLayers(layerValues, st.layers);
        renderer.applyScene(scene, st.sceneSettings);
        const effectiveFocus = resolveFocus(renderer, cam, st.sceneSettings);
        renderer.setDof(st.sceneSettings.dofEnabled, effectiveFocus, cam.aperture, cam.maxBlur);
        renderer.renderFrame();

        // Direct DOM update of selection & hover overlays to avoid React renders at 60fps
        const w = currentBox.width;
        const h = currentBox.height;

        // 1. Hover quad
        if (hoverPolygonRef.current) {
          const hId = st.hoveredLayerId;
          if (hId && !st.selection.includes(hId) && st.layers[hId]?.visible) {
            const quad = renderer.layerScreenQuad(hId, w, h);
            if (quad && quad.length === 4) {
              const pts = quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
              hoverPolygonRef.current.setAttribute('points', pts);
              hoverPolygonRef.current.setAttribute('display', 'block');
            } else {
              hoverPolygonRef.current.setAttribute('display', 'none');
            }
          } else {
            hoverPolygonRef.current.setAttribute('display', 'none');
          }
        }

        // 2. Selection quads and handles
        if (selectionGroupRef.current) {
          const selGroup = selectionGroupRef.current;
          // Synchronize DOM elements inside selection group
          const selIds = st.selection.filter((id) => st.layers[id]?.visible);

          // We maintain child groups per selected layer
          const existingGroups = Array.from(selGroup.children) as SVGGElement[];
          while (existingGroups.length > selIds.length) {
            const last = existingGroups.pop();
            last?.remove();
          }
          while (existingGroups.length < selIds.length) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'sel-layer-group');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('class', 'sel-layer-quad');
            g.appendChild(poly);

            // 8 handles
            const handleKinds: HandleKind[] = [
              'corner-tl',
              'corner-tr',
              'corner-br',
              'corner-bl',
              'edge-top',
              'edge-right',
              'edge-bottom',
              'edge-left',
            ];
            for (const kind of handleKinds) {
              const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              rect.setAttribute('class', 'sel-handle');
              rect.setAttribute('width', '7');
              rect.setAttribute('height', '7');
              rect.setAttribute('data-kind', kind);
              g.appendChild(rect);
            }
            selGroup.appendChild(g);
            existingGroups.push(g);
          }

          selIds.forEach((id, index) => {
            const g = existingGroups[index];
            if (!g) return;
            g.setAttribute('data-layer-id', id);
            const poly = g.firstElementChild as SVGPolygonElement | null;
            const quad = renderer.layerScreenQuad(id, w, h);

            if (quad && quad.length === 4) {
              g.setAttribute('display', 'block');
              const pts = quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
              poly?.setAttribute('points', pts);

              const tl = quad[0];
              const tr = quad[1];
              const br = quad[2];
              const bl = quad[3];

              if (tl && tr && br && bl) {
                const topMid: Point2D = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
                const rightMid: Point2D = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 };
                const bottomMid: Point2D = { x: (br.x + bl.x) / 2, y: (br.y + bl.y) / 2 };
                const leftMid: Point2D = { x: (bl.x + tl.x) / 2, y: (bl.y + tl.y) / 2 };

                const handlePositions: Record<HandleKind, Point2D> = {
                  'corner-tl': tl,
                  'corner-tr': tr,
                  'corner-br': br,
                  'corner-bl': bl,
                  'edge-top': topMid,
                  'edge-right': rightMid,
                  'edge-bottom': bottomMid,
                  'edge-left': leftMid,
                };

                const cursors: Record<HandleKind, string> = {
                  'corner-tl': 'nwse-resize',
                  'corner-tr': 'nesw-resize',
                  'corner-br': 'nwse-resize',
                  'corner-bl': 'nesw-resize',
                  'edge-top': 'ns-resize',
                  'edge-right': 'ew-resize',
                  'edge-bottom': 'ns-resize',
                  'edge-left': 'ew-resize',
                };

                const rects = g.querySelectorAll<SVGRectElement>('rect.sel-handle');
                rects.forEach((r) => {
                  const kind = r.getAttribute('data-kind') as HandleKind;
                  const p = handlePositions[kind];
                  if (p) {
                    r.setAttribute('x', (p.x - 3.5).toFixed(1));
                    r.setAttribute('y', (p.y - 3.5).toFixed(1));
                    r.style.cursor = cursors[kind] || 'pointer';
                  }
                });
              }
            } else {
              g.setAttribute('display', 'none');
            }
          });
        }

        // 3. Snapping lines
        if (snapGuidesGroupRef.current) {
          const snapGroup = snapGuidesGroupRef.current;
          const { vertical, horizontal } = snapGuidesRef.current;
          const totalGuides = vertical.length + horizontal.length;

          const existingLines = Array.from(snapGroup.children) as SVGLineElement[];
          while (existingLines.length > totalGuides) {
            existingLines.pop()?.remove();
          }
          while (existingLines.length < totalGuides) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'sel-snap-line');
            snapGroup.appendChild(line);
            existingLines.push(line);
          }

          let lineIdx = 0;
          for (const vx of vertical) {
            const line = existingLines[lineIdx++];
            if (line) {
              line.setAttribute('x1', vx.toFixed(1));
              line.setAttribute('y1', '0');
              line.setAttribute('x2', vx.toFixed(1));
              line.setAttribute('y2', h.toString());
            }
          }
          for (const hy of horizontal) {
            const line = existingLines[lineIdx++];
            if (line) {
              line.setAttribute('x1', '0');
              line.setAttribute('y1', hy.toFixed(1));
              line.setAttribute('x2', w.toString());
              line.setAttribute('y2', hy.toFixed(1));
            }
          }
        }

        // 4. Focus target marker
        if (focusMarkerGroupRef.current) {
          const markerGroup = focusMarkerGroupRef.current;
          const { dofEnabled, focusTarget, focusLocked } = st.sceneSettings;
          if (dofEnabled && focusTarget && st.layers[focusTarget.layerId]?.visible) {
            const pt = renderer.focusPointScreen(focusTarget.layerId, focusTarget.u, focusTarget.v, w, h);
            if (pt && pt.x >= -20 && pt.x <= w + 20 && pt.y >= -20 && pt.y <= h + 20) {
              markerGroup.setAttribute('display', 'block');
              markerGroup.setAttribute('class', `focus-marker${focusLocked ? ' locked' : ''}`);
              markerGroup.setAttribute('transform', `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
            } else {
              markerGroup.setAttribute('display', 'none');
            }
          } else {
            markerGroup.setAttribute('display', 'none');
          }
        }
      }

      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (sceneRef.current) disposeScene(sceneRef.current);
      renderer.dispose();
      rendererRef.current = null;
      viewportHandle.renderer = null;
      initialFitDoneRef.current = false;
    };
  }, []);

  // Frame aspect & resize
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFrameAspect(aspect);
    renderer.resize(box.width, box.height);
  }, [aspect, box.width, box.height]);

  // Bundle loading & scene build
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !bundle) return;

    const buildId = ++buildSeqRef.current;
    const isCancelled = () => buildId !== buildSeqRef.current;

    (async () => {
      try {
        setError(null);
        if (sceneRef.current) {
          disposeScene(sceneRef.current);
          sceneRef.current = null;
        }

        const built = await buildScene(bundle);
        if (isCancelled()) {
          disposeScene(built);
          return;
        }
        sceneRef.current = built;

        await renderer.buildLayers(bundle, built, useStudio.getState().layers, isCancelled);
        if (isCancelled()) {
          if (sceneRef.current === built) sceneRef.current = null;
          disposeScene(built);
          return;
        }

        if (!initialFitDoneRef.current) {
          initialFitDoneRef.current = true;
          renderer.setFrameAspect(frameAspect(useStudio.getState().frame));
          const fitted = renderer.fitCamera(bundle, renderer.camera.fov);
          setCameraValues(fitted);
          renderer.applyCamera(fitted);
        }
      } catch (err) {
        if (!isCancelled()) {
          console.error('[DIORAMA ERROR]', err);
          if (sceneRef.current) {
            disposeScene(sceneRef.current);
            sceneRef.current = null;
          }
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      buildSeqRef.current++;
    };
  }, [bundle, setCameraValues, setError]);

  // Keyboard navigation & hotkeys
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (isTextTarget(ev.target)) return;

      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        const st = useStudio.getState();
        const bgLayer = st.bundle?.layers.find((l) => l.role === 'background');
        for (const id of st.selection) {
          if (id !== bgLayer?.id) {
            removeLayer(id);
          }
        }
      } else if (ev.key === 'Escape') {
        const st = useStudio.getState();
        if (st.tool === 'focus') {
          setTool('select');
        } else {
          select([]);
        }
      } else if (ev.key.toLowerCase() === 'v' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        setTool('select');
      } else if (ev.key.toLowerCase() === 'o' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        setTool('orbit');
      } else if (ev.key.toLowerCase() === 'f' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        setTool('focus');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [removeLayer, select, setTool]);

  // Helper: canvas pixel coordinates from pointer event
  const getCanvasPx = (e: ReactPointerEvent | PointerEvent): Point2D => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Helper: calculate world units per screen pixel
  const getWorldPerPx = (height: number) => {
    const cam = resolvedCameraRef.current;
    const distance = cam.distance;
    const fovRad = (cam.fov * Math.PI) / 180;
    return (2 * distance * Math.tan(fovRad / 2)) / Math.max(1, height);
  };

  // React's onWheel is passive, so preventDefault would be ignored and a
  // trackpad pinch would zoom the page instead of dollying.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useStudio.getState();
      const currentBox = boxRef.current;
      const worldPerPx = getWorldPerPx(currentBox.height);
      const ev = evaluateTimeline(st.keyframes, st.playhead);
      const resolvedCam = resolveCameraValues(st.camera, ev.camera);

      if (e.shiftKey) {
        setCameraValues({ targetY: resolvedCam.targetY + e.deltaY * worldPerPx * 0.5 });
      } else {
        setCameraValues({ distance: Math.max(10, resolvedCam.distance * (1 + e.deltaY * 0.0015)) });
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setCameraValues]);

  // Pointer Down
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = useStudio.getState();
    const renderer = rendererRef.current;
    if (!renderer) return;

    const currentBox = boxRef.current;
    const pt = getCanvasPx(e);
    const ndcX = (pt.x / currentBox.width) * 2 - 1;
    const ndcY = -((pt.y / currentBox.height) * 2 - 1);
    const ev = evaluateTimeline(st.keyframes, st.playhead);
    const resolvedCam = resolveCameraValues(st.camera, ev.camera);

    // Check if clicked directly on an SVG handle
    const targetElem = e.target as HTMLElement | SVGElement;
    if (targetElem.classList.contains('sel-handle')) {
      const handleKind = targetElem.getAttribute('data-kind') as HandleKind;
      const parentG = targetElem.closest('.sel-layer-group');
      const handleLayerId = parentG?.getAttribute('data-layer-id') || st.selection[0];

      if (handleLayerId && st.layers[handleLayerId]) {
        e.currentTarget.setPointerCapture(e.pointerId);
        const quad = renderer.layerScreenQuad(handleLayerId, currentBox.width, currentBox.height);
        let centerPx = { x: currentBox.width / 2, y: currentBox.height / 2 };
        if (quad && quad.length === 4) {
          const q0 = quad[0];
          const q1 = quad[1];
          const q2 = quad[2];
          const q3 = quad[3];
          if (q0 && q1 && q2 && q3) {
            centerPx = {
              x: (q0.x + q1.x + q2.x + q3.x) / 4,
              y: (q0.y + q1.y + q2.y + q3.y) / 4,
            };
          }
        }

        const initialValues: Record<string, LayerValues> = {};
        for (const id of st.selection) {
          const lState = st.layers[id];
          if (lState) {
            initialValues[id] = resolveLayerValues(lState.values, ev.layers[id]);
          }
        }

        dragStateRef.current = {
          type: 'handle',
          initialPointerX: pt.x,
          initialPointerY: pt.y,
          thresholdMet: true,
          handleKind,
          handleLayerId,
          initialScale: initialValues[handleLayerId]?.scale,
          centerPx,
          initialValues,
        };
        return;
      }
    }

    // Middle click OR Cmd/Ctrl + left click OR tool === 'orbit'
    const isOrbitGesture =
      e.button === 1 ||
      (e.button === 0 && (st.tool === 'orbit' || e.metaKey || e.ctrlKey));

    if (isOrbitGesture) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        type: e.shiftKey ? 'pan' : 'orbit',
        initialPointerX: pt.x,
        initialPointerY: pt.y,
        thresholdMet: true,
        initialCamera: { ...resolvedCam },
      };
      return;
    }

    // Left click on 'focus' tool
    if (e.button === 0 && st.tool === 'focus') {
      const hit = renderer.pickFocus(ndcX, ndcY);
      if (hit) {
        setFocusTarget({ layerId: hit.layerId, u: hit.u, v: hit.v });
        setCameraValue('focus', Math.round(hit.distance));
        if (!st.sceneSettings.dofEnabled) {
          setSceneSettings({ dofEnabled: true });
        }
      }
      return;
    }

    // Left click on 'select' tool
    if (e.button === 0) {
      const pickedId = renderer.pick(ndcX, ndcY);
      const isLocked = pickedId ? st.layers[pickedId]?.locked : false;
      const validPickId = isLocked ? null : pickedId;

      if (validPickId) {
        let activeSelection = [...st.selection];
        if (e.shiftKey) {
          select([validPickId], 'toggle');
          const isSelected = activeSelection.includes(validPickId);
          activeSelection = isSelected
            ? activeSelection.filter((id) => id !== validPickId)
            : [...activeSelection, validPickId];
        } else if (!activeSelection.includes(validPickId)) {
          select([validPickId]);
          activeSelection = [validPickId];
        }

        e.currentTarget.setPointerCapture(e.pointerId);
        const initialValues: Record<string, LayerValues> = {};
        for (const id of activeSelection) {
          const lState = st.layers[id];
          if (lState) {
            initialValues[id] = resolveLayerValues(lState.values, ev.layers[id]);
          }
        }

        dragStateRef.current = {
          type: 'layer',
          initialPointerX: pt.x,
          initialPointerY: pt.y,
          thresholdMet: false,
          initialValues,
          altPressed: e.altKey,
        };
      } else {
        select([]);
      }
    }
  };

  // Pointer Move
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = useStudio.getState();
    const renderer = rendererRef.current;
    if (!renderer) return;

    const currentBox = boxRef.current;
    const pt = getCanvasPx(e);
    const drag = dragStateRef.current;

    // Hover detection when not dragging
    if (!drag) {
      if (st.tool === 'select') {
        const ndcX = (pt.x / currentBox.width) * 2 - 1;
        const ndcY = -((pt.y / currentBox.height) * 2 - 1);
        const pickedId = renderer.pick(ndcX, ndcY);
        const isLocked = pickedId ? st.layers[pickedId]?.locked : false;
        setHovered(isLocked ? null : pickedId);
      }
      return;
    }

    // Drag threshold check (3 px)
    const totalDist = Math.hypot(pt.x - drag.initialPointerX, pt.y - drag.initialPointerY);
    if (!drag.thresholdMet) {
      if (totalDist >= 3) {
        drag.thresholdMet = true;
      } else {
        return;
      }
    }

    const worldPerPx = getWorldPerPx(currentBox.height);

    if (drag.type === 'orbit') {
      const cam = drag.initialCamera || st.camera;
      const totalDx = pt.x - drag.initialPointerX;
      const totalDy = pt.y - drag.initialPointerY;
      setCameraValues({
        orbitY: cam.orbitY + totalDx * 0.3,
        orbitX: cam.orbitX - totalDy * 0.3,
      });
      return;
    }

    if (drag.type === 'pan') {
      const cam = drag.initialCamera || st.camera;
      const totalDx = pt.x - drag.initialPointerX;
      const totalDy = pt.y - drag.initialPointerY;
      setCameraValues({
        targetX: cam.targetX - totalDx * worldPerPx,
        targetY: cam.targetY + totalDy * worldPerPx,
      });
      return;
    }

    if (drag.type === 'handle') {
      const targetId = drag.handleLayerId;
      if (!targetId || !drag.initialValues?.[targetId]) return;

      const initVal = drag.initialValues[targetId];
      const kind = drag.handleKind;

      if (kind && kind.startsWith('corner-')) {
        // Uniform scale: ratio of distance from center
        const center = drag.centerPx || { x: currentBox.width / 2, y: currentBox.height / 2 };
        const startDist = Math.hypot(drag.initialPointerX - center.x, drag.initialPointerY - center.y);
        const currentDist = Math.hypot(pt.x - center.x, pt.y - center.y);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          const nextScale = Math.max(1, Math.round((drag.initialScale ?? 100) * ratio));
          setLayerValues(targetId, { scale: nextScale });
        }
      } else if (kind && kind.startsWith('edge-')) {
        // Distortion of side in world units
        const totalDx = pt.x - drag.initialPointerX;
        const totalDy = pt.y - drag.initialPointerY;
        const worldDx = totalDx * worldPerPx;
        const worldDy = totalDy * worldPerPx;

        switch (kind) {
          case 'edge-top':
            setLayerValues(targetId, {
              tlY: initVal.tlY + worldDy,
              trY: initVal.trY + worldDy,
            });
            break;
          case 'edge-right':
            setLayerValues(targetId, {
              trX: initVal.trX + worldDx,
              brX: initVal.brX + worldDx,
            });
            break;
          case 'edge-bottom':
            setLayerValues(targetId, {
              blY: initVal.blY + worldDy,
              brY: initVal.brY + worldDy,
            });
            break;
          case 'edge-left':
            setLayerValues(targetId, {
              tlX: initVal.tlX + worldDx,
              blX: initVal.blX + worldDx,
            });
            break;
        }
      }
      return;
    }

    if (drag.type === 'layer') {
      const isAlt = e.altKey || drag.altPressed;
      const totalDx = pt.x - drag.initialPointerX;
      const totalDy = pt.y - drag.initialPointerY;

      if (isAlt) {
        // Alt + drag: Z translation only
        const dz = -totalDy * worldPerPx;
        for (const [id, init] of Object.entries(drag.initialValues || {})) {
          setLayerValues(id, { z: Math.round(init.z + dz) });
        }
        snapGuidesRef.current = { vertical: [], horizontal: [] };
      } else {
        // XY translation with snapping
        let deltaWorldX = totalDx * worldPerPx;
        let deltaWorldY = totalDy * worldPerPx;

        // Snapping logic: 6 px threshold against other visible layers
        const snapThresholdPx = 6;
        const vGuides: number[] = [];
        const hGuides: number[] = [];

        // Identify primary moved layer
        const primaryId = Object.keys(drag.initialValues || {})[0];
        if (primaryId) {
          const quad = renderer.layerScreenQuad(primaryId, currentBox.width, currentBox.height);
          if (quad && quad.length === 4) {
            const q0 = quad[0];
            const q1 = quad[1];
            const q2 = quad[2];
            const q3 = quad[3];

            if (q0 && q1 && q2 && q3) {
              const minX = Math.min(q0.x, q1.x, q2.x, q3.x);
              const maxX = Math.max(q0.x, q1.x, q2.x, q3.x);
              const midX = (minX + maxX) / 2;

              const minY = Math.min(q0.y, q1.y, q2.y, q3.y);
              const maxY = Math.max(q0.y, q1.y, q2.y, q3.y);
              const midY = (minY + maxY) / 2;

              const currentTargetsX = [minX, midX, maxX];
              const currentTargetsY = [minY, midY, maxY];

              // Compare against visible other layers
              for (const otherId in st.layers) {
                if (drag.initialValues?.[otherId] || !st.layers[otherId]?.visible) continue;
                const otherQuad = renderer.layerScreenQuad(otherId, currentBox.width, currentBox.height);
                if (!otherQuad || otherQuad.length !== 4) continue;

                const oq0 = otherQuad[0];
                const oq1 = otherQuad[1];
                const oq2 = otherQuad[2];
                const oq3 = otherQuad[3];
                if (!oq0 || !oq1 || !oq2 || !oq3) continue;

                const oMinX = Math.min(oq0.x, oq1.x, oq2.x, oq3.x);
                const oMaxX = Math.max(oq0.x, oq1.x, oq2.x, oq3.x);
                const oMidX = (oMinX + oMaxX) / 2;

                const oMinY = Math.min(oq0.y, oq1.y, oq2.y, oq3.y);
                const oMaxY = Math.max(oq0.y, oq1.y, oq2.y, oq3.y);
                const oMidY = (oMinY + oMaxY) / 2;

                const otherTargetsX = [oMinX, oMidX, oMaxX];
                const otherTargetsY = [oMinY, oMidY, oMaxY];

                for (const tx of currentTargetsX) {
                  for (const ox of otherTargetsX) {
                    const diff = ox - tx;
                    if (Math.abs(diff) <= snapThresholdPx) {
                      deltaWorldX += diff * worldPerPx;
                      vGuides.push(ox);
                    }
                  }
                }

                for (const ty of currentTargetsY) {
                  for (const oy of otherTargetsY) {
                    const diff = oy - ty;
                    if (Math.abs(diff) <= snapThresholdPx) {
                      deltaWorldY += diff * worldPerPx;
                      hGuides.push(oy);
                    }
                  }
                }
              }
            }
          }
        }

        snapGuidesRef.current = {
          vertical: Array.from(new Set(vGuides)),
          horizontal: Array.from(new Set(hGuides)),
        };

        for (const [id, init] of Object.entries(drag.initialValues || {})) {
          setLayerValues(id, {
            x: Math.round(init.x + deltaWorldX),
            y: Math.round(init.y + deltaWorldY),
          });
        }
      }
    }
  };

  // Pointer Up
  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragStateRef.current = null;
    snapGuidesRef.current = { vertical: [], horizontal: [] };
  };

  const guides = guideFractions(frame.guides);
  const maskAlpha = frame.showOverscan ? frame.maskOpacity : 1;

  const boxStyle = {
    position: 'absolute' as const,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  };

  const bgLayer = bundle?.layers.find((l) => l.role === 'background');
  const bgState = bgLayer ? useStudio.getState().layers[bgLayer.id] : null;
  const bgVisible = bgState?.visible ?? true;
  const bgOpacity = (bgState?.values.opacity ?? 100) / 100;
  const bgColor = bgState?.backgroundColor ?? bgLayer?.backgroundColor ?? '#ffffff';

  const isHoveredSelected = hoveredLayerId ? selection.includes(hoveredLayerId) : false;

  return (
    <div
      className="viewport"
      ref={containerRef}
      data-tool={tool}
      data-hover-selected={isHoveredSelected ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="frame-stage" style={{ background: `rgba(0,0,0,${maskAlpha})` }} />

      <div
        className="frame-inside"
        style={{
          ...boxStyle,
          background: bgVisible ? bgColor : '#08080a',
          opacity: bgVisible ? bgOpacity : 1,
        }}
      />

      <canvas ref={canvasRef} className="viewport-canvas" style={boxStyle} />

      {/* Frame overlay: guides lines & size badge */}
      <div className="frame-overlay" style={boxStyle}>
        {guides.x.map((f) => (
          <div
            key={`gx-${f}`}
            className="frame-guide-line"
            style={{ left: `${f * 100}%`, top: 0, width: 1, height: '100%' }}
          />
        ))}
        {guides.y.map((f) => (
          <div
            key={`gy-${f}`}
            className="frame-guide-line"
            style={{ top: `${f * 100}%`, left: 0, height: 1, width: '100%' }}
          />
        ))}
        <div className="frame-badge">
          {frame.width}×{frame.height}
        </div>
      </div>

      {/* Selection & Snapping SVG Overlay */}
      <svg ref={svgOverlayRef} className="sel-overlay" style={boxStyle}>
        <polygon ref={hoverPolygonRef} className="sel-hover-quad" display="none" />
        <g ref={selectionGroupRef} />
        <g ref={snapGuidesGroupRef} />
        <g ref={focusMarkerGroupRef} className="focus-marker" display="none">
          <circle cx="0" cy="0" r="7" />
          <line x1="-11" y1="0" x2="-7" y2="0" />
          <line x1="7" y1="0" x2="11" y2="0" />
          <line x1="0" y1="-11" x2="0" y2="-7" />
          <line x1="0" y1="7" x2="0" y2="11" />
        </g>
      </svg>

      {bundle && !error && (
        <div className="viewport-hud">
          {bundle.source.title} — {bundle.layers.filter((l) => l.role === 'zap').length} éléments détachés
        </div>
      )}

      {loading && !error && (
        <div className="overlay-message">
          <strong>Chargement de la scène…</strong>
        </div>
      )}

      {error && (
        <div className="overlay-message">
          <strong>Diorama ne peut pas rendre cette scène</strong>
          <div>{error}</div>
          {error.includes('WebGL') ? (
            <div>
              Ouvrez <code>chrome://gpu</code> pour vérifier l'accélération matérielle, puis
              rechargez cet onglet.
            </div>
          ) : (
            <div>
              Requis : Chromium 147+ avec <code>--enable-blink-features=HTMLInCanvas</code>{' '}
              (flag <code>#canvas-draw-element</code>).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
