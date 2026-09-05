import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Box,
  Camera,
  ChevronsDownUp,
  Crosshair,
  Eye,
  EyeOff,
  Group,
  Lock,
  LockOpen,
  Magnet,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Trash2,
  Ungroup,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useStudio } from '../../store';
import {
  CAMERA_CHANNELS,
  CHANNEL_GROUP_LABELS,
  LAYER_CHANNELS,
  SCENE_CHANNELS,
  type CameraChannelId,
  type ChannelDef,
  type ChannelId,
  type LayerChannelId,
  type SceneChannelId,
} from '../../model/channels';
import { keyframeTimes, snapTime, type Keyframe } from '../../model/timeline';
import {
  HEADER_W,
  ROW_H,
  RULER_H,
  SNAP_PX,
  SUB_ROW_H,
  clampHeight,
  clampScroll,
  clampZoom,
  formatTime,
  roundTime,
  secondMarks,
  timeToX,
  useElementWidth,
  xToTime,
} from './useTimelineGeometry';
import { KeyframePopover } from './KeyframePopover';
import { marksOf, TrackHead, TrackLane } from './Track';
import { Ruler } from './Ruler';
import { KeyDot } from '../ui/KeyDot';
import { KeyJumpButtons } from '../ui/KeyJumpButtons';
import { Toggle } from '../ui/Toggle';
import { viewportHandle } from '../Viewport';
import {
  ancestorsOfLayer,
  childrenOfLayer,
  depthOfLayer,
  descendantsOfLayer,
  flattenTree,
  isAncestorOf,
  layerTree,
  parentOfLayer,
} from '../../../shared/groups';
import type { CaptureGroup } from '../../../shared/types';
import '../../styles/timeline.css';

interface PopoverState {
  id: string;
  x: number;
  y: number;
}

interface DropTarget {
  targetLayerId: string;
  mode: 'inside' | 'before' | 'after';
  parentId: string | null;
  index?: number;
  dropLineTop?: number;
  dropLineLeft?: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  layerId: string;
}

interface RowItem {
  key: string;
  depth: number;
  height: number;
  kind: 'camera' | 'scene' | 'layer' | 'channel';
  label: string;
  icon?: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  selected?: boolean;
  hovered?: boolean;
  visible?: boolean;
  locked?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  childCount?: number;
  keyframes: Keyframe[];
  groupAggregateKfIds?: Set<string>;
  layerId: string | null;
  channel?: ChannelId;
  stripThumb?: string | null;
  stripColor?: string;
  isGroupAggregate?: boolean;
}

function getTopLevelMovedIds(candidateIds: string[], groups: CaptureGroup[] | undefined): string[] {
  return candidateIds.filter((id) => {
    return !candidateIds.some((otherId) => otherId !== id && isAncestorOf(groups, otherId, id));
  });
}

export function Timeline() {
  const bundle = useStudio((s) => s.bundle);
  const layersState = useStudio((s) => s.layers);
  const keyframes = useStudio((s) => s.keyframes);
  const duration = useStudio((s) => s.duration);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const autoKey = useStudio((s) => s.autoKey);
  const selection = useStudio((s) => s.selection);
  const timelineUi = useStudio((s) => s.timelineUi);
  const prompt = useStudio((s) => s.prompt);
  const hoveredLayerId = useStudio((s) => s.hoveredLayerId);

  const setPlaying = useStudio((s) => s.setPlaying);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const setDuration = useStudio((s) => s.setDuration);
  const setAutoKey = useStudio((s) => s.setAutoKey);
  const select = useStudio((s) => s.select);
  const setTimelineUi = useStudio((s) => s.setTimelineUi);
  const toggleExpanded = useStudio((s) => s.toggleExpanded);
  const toggleGroupCollapsed = useStudio((s) => s.toggleGroupCollapsed);
  const setLayerParent = useStudio((s) => s.setLayerParent);
  const groupLayers = useStudio((s) => s.groupLayers);
  const ungroup = useStudio((s) => s.ungroup);
  const applyGroupOpening = useStudio((s) => s.applyGroupOpening);
  const setLayerFlags = useStudio((s) => s.setLayerFlags);
  const setHovered = useStudio((s) => s.setHovered);
  const setCameraValues = useStudio((s) => s.setCameraValues);
  const removeLayer = useStudio((s) => s.removeLayer);
  const moveKeyframes = useStudio((s) => s.moveKeyframes);
  const updateKeyframe = useStudio((s) => s.updateKeyframe);
  const removeKeyframes = useStudio((s) => s.removeKeyframes);
  const setPrompt = useStudio((s) => s.setPrompt);
  const runDirector = useStudio((s) => s.runDirector);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // Drag and drop state
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [movedLayerIds, setMovedLayerIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Custom context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const lanesRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const laneWidth = useElementWidth(lanesRef);

  const isDraggingRef = useRef(false);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const movedIdsRef = useRef<string[]>([]);
  const hasDraggedRef = useRef(false);

  const { height, zoom, scroll, expanded, snap } = timelineUi;

  // Sync horizontal/vertical scroll between heads and lanes
  const onLanesScroll = useCallback((ev: React.UIEvent<HTMLDivElement>) => {
    if (headsRef.current) {
      headsRef.current.scrollTop = ev.currentTarget.scrollTop;
    }
  }, []);

  // 1. Playback Clock (rAF)
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = useStudio.getState();
      let next = st.playhead + dt;
      if (next >= st.duration) {
        next = 0; // loop
      }
      st.setPlayhead(next);

      // Auto-scroll to keep playhead visible
      if (laneWidth > 0) {
        const { zoom: curZoom, scroll: curScroll } = st.timelineUi;
        const playheadX = timeToX(next, curZoom, curScroll);
        if (playheadX > laneWidth - 30) {
          const nextScroll = clampScroll(next - (laneWidth - 60) / curZoom, st.duration, curZoom, laneWidth);
          st.setTimelineUi({ scroll: nextScroll });
        } else if (playheadX < 10 && curScroll > 0) {
          const nextScroll = clampScroll(next - 20 / curZoom, st.duration, curZoom, laneWidth);
          st.setTimelineUi({ scroll: nextScroll });
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, laneWidth]);

  // 2. Keyboard shortcuts (Delete keyframe, Cmd+G, Cmd+Shift+G, Alt+Left/Right)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInput) return;

      // Delete keyframes
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (selectedIds.size > 0) {
          ev.preventDefault();
          removeKeyframes([...selectedIds]);
          setSelectedIds(new Set());
          setPopover(null);
        }
        return;
      }

      // Cmd/Ctrl+Shift+G: Dégrouper la sélection
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === 'g' || ev.key === 'G')) {
        ev.preventDefault();
        const groups = bundle?.groups ?? [];
        for (const selId of selection) {
          if (groups.some((g) => g.parentId === selId || g.id === selId)) {
            ungroup(selId);
          }
        }
        return;
      }

      // Cmd/Ctrl+G: Grouper la sélection
      if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && (ev.key === 'g' || ev.key === 'G')) {
        ev.preventDefault();
        if (selection.length >= 2) {
          groupLayers(selection);
        }
        return;
      }

      // Alt+Left: Replier le(s) groupe(s) sélectionné(s)
      if (ev.altKey && ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const groups = bundle?.groups ?? [];
        const collapsed = new Set(timelineUi.collapsedGroups ?? []);
        for (const selId of selection) {
          if (groups.some((g) => g.parentId === selId)) {
            collapsed.add(selId);
          }
        }
        setTimelineUi({ collapsedGroups: [...collapsed] });
        return;
      }

      // Alt+Right: Déplier le(s) groupe(s) sélectionné(s)
      if (ev.altKey && ev.key === 'ArrowRight') {
        ev.preventDefault();
        const collapsed = new Set(timelineUi.collapsedGroups ?? []);
        for (const selId of selection) {
          collapsed.delete(selId);
        }
        setTimelineUi({ collapsedGroups: [...collapsed] });
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedIds,
    selection,
    bundle?.groups,
    timelineUi.collapsedGroups,
    removeKeyframes,
    groupLayers,
    ungroup,
    setTimelineUi,
  ]);

  // 3. Auto-uncollapse ancestors when a layer is selected in viewport
  useEffect(() => {
    if (!bundle?.groups || selection.length === 0) return;
    const collapsed = timelineUi.collapsedGroups ?? [];
    if (collapsed.length === 0) return;

    const toUncollapse = new Set<string>();
    for (const selId of selection) {
      const ancestors = ancestorsOfLayer(bundle.groups, selId);
      for (const anc of ancestors) {
        if (collapsed.includes(anc)) {
          toUncollapse.add(anc);
        }
      }
    }

    if (toUncollapse.size > 0) {
      setTimelineUi({
        collapsedGroups: collapsed.filter((id) => !toUncollapse.has(id)),
      });
    }
  }, [selection, bundle?.groups, timelineUi.collapsedGroups, setTimelineUi]);

  // 4. Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  // 5. Top Resize Drag Handler
  const onResizeStart = useCallback(
    (ev: ReactPointerEvent) => {
      ev.preventDefault();
      const startY = ev.clientY;
      const startH = height;

      const onPointerMove = (e: PointerEvent) => {
        const delta = startY - e.clientY;
        setTimelineUi({ height: clampHeight(startH + delta) });
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [height, setTimelineUi],
  );

  // 6. Scrubbing logic (Ruler or empty lane)
  const snapCandidateTimes = useMemo(() => {
    const kTimes = keyframeTimes(keyframes);
    const sTimes = secondMarks(duration);
    return [...new Set([...kTimes, ...sTimes])].sort((a, b) => a - b);
  }, [keyframes, duration]);

  const scrubAtClientX = useCallback(
    (clientX: number) => {
      if (!lanesRef.current) return;
      const rect = lanesRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const rawTime = Math.max(0, Math.min(duration, xToTime(x, zoom, scroll)));
      let targetTime = rawTime;
      if (snap) {
        targetTime = snapTime(rawTime, snapCandidateTimes, SNAP_PX / zoom);
      }
      setPlayhead(roundTime(targetTime));
    },
    [duration, zoom, scroll, snap, snapCandidateTimes, setPlayhead],
  );

  const onScrubStart = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      ev.preventDefault();
      setPlaying(false);
      scrubAtClientX(ev.clientX);

      const onPointerMove = (e: PointerEvent) => {
        scrubAtClientX(e.clientX);
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [scrubAtClientX, setPlaying],
  );

  // 7. Keyframe Selection and Dragging
  const onKeyframePointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, ids: string[]) => {
      ev.stopPropagation();
      ev.preventDefault();

      let nextSelected: Set<string>;
      if (ev.shiftKey) {
        nextSelected = new Set(selectedIds);
        for (const id of ids) {
          if (nextSelected.has(id)) nextSelected.delete(id);
          else nextSelected.add(id);
        }
      } else {
        const alreadySelected = ids.some((id) => selectedIds.has(id));
        if (alreadySelected) {
          nextSelected = new Set(selectedIds);
        } else {
          nextSelected = new Set(ids);
        }
      }
      setSelectedIds(nextSelected);

      const dragTargetIds = [...nextSelected];
      const startX = ev.clientX;
      let lastAppliedDt = 0;

      const otherKeyframes = keyframes.filter((k) => !nextSelected.has(k.id));
      const otherTimes = [...new Set([...keyframeTimes(otherKeyframes), ...secondMarks(duration)])].sort((a, b) => a - b);
      const anchorKf = keyframes.find((k) => k.id === ids[0]) ?? keyframes.find((k) => nextSelected.has(k.id));
      const anchorTime = anchorKf?.time ?? 0;

      const onPointerMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        let totalDt = dx / zoom;

        if (snap) {
          const rawAnchorTarget = anchorTime + totalDt;
          const snappedAnchorTarget = snapTime(rawAnchorTarget, otherTimes, SNAP_PX / zoom);
          totalDt = snappedAnchorTarget - anchorTime;
        }

        const delta = totalDt - lastAppliedDt;
        if (delta !== 0) {
          moveKeyframes(dragTargetIds, delta);
          lastAppliedDt = totalDt;
        }
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [selectedIds, keyframes, duration, zoom, snap, moveKeyframes],
  );

  // 8. Keyframe Double Click
  const onKeyframeDoubleClick = useCallback(
    (ev: ReactMouseEvent<HTMLDivElement>, ids: string[], isAggregate: boolean, layerIdKey: string) => {
      ev.stopPropagation();
      if (isAggregate) {
        toggleExpanded(layerIdKey);
      } else if (ids[0]) {
        setPopover({ id: ids[0], x: ev.clientX, y: ev.clientY });
      }
    },
    [toggleExpanded],
  );

  // 9. Wheel on lanes
  const onLanesWheel = useCallback(
    (ev: React.WheelEvent<HTMLDivElement>) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        if (!lanesRef.current) return;
        const rect = lanesRef.current.getBoundingClientRect();
        const cursorX = ev.clientX - rect.left;
        const timeAtCursor = xToTime(cursorX, zoom, scroll);

        const zoomDelta = -ev.deltaY * 0.5;
        const nextZoom = clampZoom(zoom + zoomDelta);
        const nextScroll = clampScroll(timeAtCursor - cursorX / nextZoom, duration, nextZoom, laneWidth);

        setTimelineUi({ zoom: nextZoom, scroll: nextScroll });
      } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        ev.preventDefault();
        const delta = (ev.shiftKey ? ev.deltaY : ev.deltaX) / zoom;
        const nextScroll = clampScroll(scroll + delta, duration, zoom, laneWidth);
        setTimelineUi({ scroll: nextScroll });
      }
    },
    [zoom, scroll, duration, laneWidth, setTimelineUi],
  );

  // Camera fit helper
  const fitLayerCamera = useCallback(
    (layerId: string) => {
      const renderer = viewportHandle.renderer;
      const b = useStudio.getState().bundle;
      if (!renderer || !b) return;
      const fitted = renderer.fitLayer(b, layerId, renderer.camera.fov);
      if (fitted) setCameraValues(fitted);
    },
    [setCameraValues],
  );

  // 10. Build Rows
  const groups = bundle?.groups ?? [];
  const rawLayers = bundle?.layers ?? [];
  const backgroundLayer = useMemo(() => rawLayers.find((l) => l.role === 'background') ?? null, [rawLayers]);
  const bgLayerId = backgroundLayer?.id ?? null;

  const rows = useMemo<RowItem[]>(() => {
    const list: RowItem[] = [];

    // --- Camera row ---
    const camKeyframes = keyframes.filter(
      (k) => k.layerId === null && (CAMERA_CHANNELS as readonly ChannelDef[]).some((c) => c.id === k.channel),
    );
    const camExpanded = expanded.includes('_camera');
    const camActiveChannels = CAMERA_CHANNELS.filter((ch) => camKeyframes.some((k) => k.channel === ch.id));

    list.push({
      key: '_camera',
      depth: 0,
      height: ROW_H,
      kind: 'camera',
      label: 'Caméra',
      icon: <Camera size={14} color="var(--ink-2)" />,
      expandable: camActiveChannels.length > 0,
      expanded: camExpanded,
      keyframes: camKeyframes,
      layerId: null,
    });

    if (camExpanded) {
      for (const ch of camActiveChannels) {
        const chKeyframes = camKeyframes.filter((k) => k.channel === ch.id);
        list.push({
          key: `_camera|${ch.id}`,
          depth: 1,
          height: SUB_ROW_H,
          kind: 'channel',
          label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
          icon: <KeyDot layerId={null} channel={ch.id as CameraChannelId} />,
          keyframes: chKeyframes,
          layerId: null,
          channel: ch.id as CameraChannelId,
        });
      }
    }

    // --- Scene row ---
    const sceneKeyframes = keyframes.filter(
      (k) => k.layerId === null && (SCENE_CHANNELS as readonly ChannelDef[]).some((c) => c.id === k.channel),
    );
    const sceneExpanded = expanded.includes('_scene');
    const sceneActiveChannels = SCENE_CHANNELS.filter((ch) => sceneKeyframes.some((k) => k.channel === ch.id));

    list.push({
      key: '_scene',
      depth: 0,
      height: ROW_H,
      kind: 'scene',
      label: 'Scène',
      icon: <Sun size={14} color="var(--ink-2)" />,
      expandable: sceneActiveChannels.length > 0,
      expanded: sceneExpanded,
      keyframes: sceneKeyframes,
      layerId: null,
    });

    if (sceneExpanded) {
      for (const ch of sceneActiveChannels) {
        const chKeyframes = sceneKeyframes.filter((k) => k.channel === ch.id);
        list.push({
          key: `_scene|${ch.id}`,
          depth: 1,
          height: SUB_ROW_H,
          kind: 'channel',
          label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
          icon: <KeyDot layerId={null} channel={ch.id as SceneChannelId} />,
          keyframes: chKeyframes,
          layerId: null,
          channel: ch.id as SceneChannelId,
        });
      }
    }

    // --- Zap layers tree ---
    const tree = layerTree(groups, rawLayers);
    const flattened = flattenTree(tree, new Set(timelineUi.collapsedGroups ?? []));

    for (const node of flattened) {
      const layer = node.layer;
      const id = layer.id;
      const depth = node.depth;
      const hasChildren = node.hasChildren;
      const collapsed = node.collapsed;
      const layerState = layersState[id];
      const visible = layerState?.visible ?? true;
      const locked = layerState?.locked ?? false;
      const directChildren = childrenOfLayer(groups, id);
      const childCount = directChildren.length;
      const isSelected = selection.includes(id);
      const isHovered = hoveredLayerId === id;
      const lExpanded = expanded.includes(id);

      let allLayerKeyframes: Keyframe[];
      let groupAggregateKfIds: Set<string> | undefined;
      if (hasChildren && collapsed) {
        const descIds = descendantsOfLayer(groups, id);
        const descSet = new Set(descIds);
        allLayerKeyframes = keyframes.filter((k) => k.layerId === id || (k.layerId !== null && descSet.has(k.layerId)));
        groupAggregateKfIds = new Set(
          keyframes.filter((k) => k.layerId !== null && descSet.has(k.layerId)).map((k) => k.id),
        );
      } else {
        allLayerKeyframes = keyframes.filter((k) => k.layerId === id);
      }

      const layerOnlyKeyframes = keyframes.filter((k) => k.layerId === id);
      const lActiveChannels = LAYER_CHANNELS.filter((ch) => layerOnlyKeyframes.some((k) => k.channel === ch.id));
      const thumb = bundle?.raster?.layers?.find((l) => l.layerId === id)?.png ?? null;

      const icon = thumb ? (
        <span className="layer-thumb">
          <img src={thumb} alt="" draggable={false} />
        </span>
      ) : (
        <Box size={14} color="var(--ink-2)" />
      );

      list.push({
        key: id,
        depth,
        height: ROW_H,
        kind: 'layer',
        label: layer.label,
        icon,
        expandable: lActiveChannels.length > 0,
        expanded: lExpanded,
        selected: isSelected,
        hovered: isHovered,
        visible,
        locked,
        hasChildren,
        collapsed,
        childCount,
        keyframes: allLayerKeyframes,
        groupAggregateKfIds,
        isGroupAggregate: hasChildren && collapsed,
        layerId: id,
        stripThumb: thumb,
        stripColor: layer.backgroundColor,
      });

      if (lExpanded) {
        for (const ch of lActiveChannels) {
          const chKeyframes = layerOnlyKeyframes.filter((k) => k.channel === ch.id);
          list.push({
            key: `${id}|${ch.id}`,
            depth: depth + 1,
            height: SUB_ROW_H,
            kind: 'channel',
            label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
            icon: <KeyDot layerId={id} channel={ch.id as LayerChannelId} />,
            keyframes: chKeyframes,
            layerId: id,
            channel: ch.id as LayerChannelId,
          });
        }
      }
    }

    // --- Background layer (last row, depth 0, non groupable) ---
    if (backgroundLayer) {
      const bgId = backgroundLayer.id;
      const bgState = layersState[bgId];
      const bgVisible = bgState?.visible ?? true;
      const bgLocked = bgState?.locked ?? false;
      const bgKeyframes = keyframes.filter((k) => k.layerId === bgId);
      const bgExpanded = expanded.includes(bgId);
      const bgActiveChannels = LAYER_CHANNELS.filter((ch) => bgKeyframes.some((k) => k.channel === ch.id));
      const bgThumb = bundle?.raster?.layers?.find((l) => l.layerId === bgId)?.png ?? null;

      const bgIcon = (
        <span
          className="layer-thumb plate"
          style={bgState?.backgroundColor ? { background: bgState.backgroundColor } : undefined}
        />
      );

      list.push({
        key: bgId,
        depth: 0,
        height: ROW_H,
        kind: 'layer',
        label: 'Fond',
        icon: bgIcon,
        expandable: bgActiveChannels.length > 0,
        expanded: bgExpanded,
        selected: selection.includes(bgId),
        hovered: hoveredLayerId === bgId,
        visible: bgVisible,
        locked: bgLocked,
        hasChildren: false,
        collapsed: false,
        childCount: 0,
        keyframes: bgKeyframes,
        layerId: bgId,
        stripThumb: bgThumb,
        stripColor: bgState?.backgroundColor,
      });

      if (bgExpanded) {
        for (const ch of bgActiveChannels) {
          const chKeyframes = bgKeyframes.filter((k) => k.channel === ch.id);
          list.push({
            key: `${bgId}|${ch.id}`,
            depth: 1,
            height: SUB_ROW_H,
            kind: 'channel',
            label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
            icon: <KeyDot layerId={bgId} channel={ch.id as LayerChannelId} />,
            keyframes: chKeyframes,
            layerId: bgId,
            channel: ch.id as LayerChannelId,
          });
        }
      }
    }

    return list;
  }, [
    groups,
    rawLayers,
    keyframes,
    expanded,
    timelineUi.collapsedGroups,
    layersState,
    selection,
    hoveredLayerId,
    backgroundLayer,
    bundle?.raster?.layers,
  ]);

  // 11. Pointer down for DnD on TrackHead
  const onHeadPointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>, row: RowItem) => {
      if (ev.button !== 0) return;
      const target = ev.target as HTMLElement;
      if (target.closest('button, .icon-btn, .tl-chevron, .tl-chevron--channels, .tl-chevron--group')) {
        return;
      }
      if (row.kind !== 'layer' || !row.layerId || row.key === bgLayerId) {
        return;
      }

      const startX = ev.clientX;
      const startY = ev.clientY;
      const sourceLayerId = row.layerId;
      hasDraggedRef.current = false;

      let autoScrollRaf = 0;
      let currentPointerY = startY;

      const runAutoScroll = () => {
        if (!headsRef.current || !isDraggingRef.current) return;
        const headsRect = headsRef.current.getBoundingClientRect();
        const topDist = currentPointerY - headsRect.top;
        const botDist = headsRect.bottom - currentPointerY;
        if (topDist >= 0 && topDist < 24) {
          headsRef.current.scrollTop -= 6;
          if (lanesRef.current) lanesRef.current.scrollTop -= 6;
        } else if (botDist >= 0 && botDist < 24) {
          headsRef.current.scrollTop += 6;
          if (lanesRef.current) lanesRef.current.scrollTop += 6;
        }
        autoScrollRaf = requestAnimationFrame(runAutoScroll);
      };

      const cleanup = () => {
        document.body.style.cursor = '';
        if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        isDraggingRef.current = false;
        dropTargetRef.current = null;
        movedIdsRef.current = [];
        setDragSourceId(null);
        setMovedLayerIds([]);
        setDropTarget(null);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        }
      };

      const onPointerMove = (e: PointerEvent) => {
        currentPointerY = e.clientY;
        if (!isDraggingRef.current) {
          const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
          if (dist >= 4) {
            isDraggingRef.current = true;
            hasDraggedRef.current = true;
            document.body.style.cursor = 'grabbing';
            const curSelection = useStudio.getState().selection;
            const curGroups = useStudio.getState().bundle?.groups;
            const candidateIds = curSelection.includes(sourceLayerId) ? curSelection : [sourceLayerId];
            const moved = getTopLevelMovedIds(candidateIds, curGroups);
            movedIdsRef.current = moved;
            setMovedLayerIds(moved);
            setDragSourceId(sourceLayerId);
            autoScrollRaf = requestAnimationFrame(runAutoScroll);
          } else {
            return;
          }
        }

        if (!headsRef.current) return;
        const headsEl = headsRef.current;
        const layerRows = headsEl.querySelectorAll<HTMLElement>('.tl-head[data-kind="layer"]');
        let candidateEl: HTMLElement | null = null;
        for (const el of layerRows) {
          const rect = el.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            candidateEl = el;
            break;
          }
        }

        if (!candidateEl) {
          dropTargetRef.current = null;
          setDropTarget(null);
          return;
        }

        const targetLayerId = candidateEl.dataset.layerId;
        const curGroups = useStudio.getState().bundle?.groups;

        if (
          !targetLayerId ||
          targetLayerId === bgLayerId ||
          movedIdsRef.current.includes(targetLayerId) ||
          movedIdsRef.current.some((srcId) => isAncestorOf(curGroups, srcId, targetLayerId))
        ) {
          dropTargetRef.current = null;
          setDropTarget(null);
          return;
        }

        const rect = candidateEl.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        const targetDepth = depthOfLayer(curGroups, targetLayerId);
        const targetParentId = parentOfLayer(curGroups, targetLayerId);

        if (relY >= 0.25 && relY <= 0.75) {
          const targetChildren = childrenOfLayer(curGroups, targetLayerId);
          const nextTarget: DropTarget = {
            targetLayerId,
            mode: 'inside',
            parentId: targetLayerId,
            index: targetChildren.length,
          };
          dropTargetRef.current = nextTarget;
          setDropTarget(nextTarget);
        } else if (relY < 0.25) {
          let index: number | undefined = undefined;
          if (targetParentId !== null) {
            const children = childrenOfLayer(curGroups, targetParentId);
            const idx = children.indexOf(targetLayerId);
            index = idx >= 0 ? idx : 0;
          }
          const headsBox = headsEl.getBoundingClientRect();
          const dropLineTop = rect.top - headsBox.top + headsEl.scrollTop;
          const nextTarget: DropTarget = {
            targetLayerId,
            mode: 'before',
            parentId: targetParentId,
            index,
            dropLineTop,
            dropLineLeft: 8 + targetDepth * 14,
          };
          dropTargetRef.current = nextTarget;
          setDropTarget(nextTarget);
        } else {
          let index: number | undefined = undefined;
          if (targetParentId !== null) {
            const children = childrenOfLayer(curGroups, targetParentId);
            const idx = children.indexOf(targetLayerId);
            index = idx >= 0 ? idx + 1 : undefined;
          }
          const headsBox = headsEl.getBoundingClientRect();
          const dropLineTop = rect.bottom - headsBox.top + headsEl.scrollTop;
          const nextTarget: DropTarget = {
            targetLayerId,
            mode: 'after',
            parentId: targetParentId,
            index,
            dropLineTop,
            dropLineLeft: 8 + targetDepth * 14,
          };
          dropTargetRef.current = nextTarget;
          setDropTarget(nextTarget);
        }
      };

      const onPointerUp = () => {
        if (isDraggingRef.current) {
          const dt = dropTargetRef.current;
          const moved = movedIdsRef.current;
          if (dt && moved.length > 0) {
            const { parentId, index, mode, targetLayerId } = dt;
            const curStore = useStudio.getState();
            if (mode === 'inside') {
              const collapsed = curStore.timelineUi.collapsedGroups ?? [];
              if (collapsed.includes(targetLayerId)) {
                curStore.setTimelineUi({ collapsedGroups: collapsed.filter((id) => id !== targetLayerId) });
              }
              const currentChildren = childrenOfLayer(curStore.bundle?.groups, targetLayerId);
              let baseIdx = currentChildren.length;
              for (const id of moved) {
                curStore.setLayerParent(id, targetLayerId, baseIdx++);
              }
            } else {
              if (parentId === null) {
                for (const id of moved) {
                  curStore.setLayerParent(id, null);
                }
              } else {
                // Re-anchor on the target sibling after every move: removing a
                // moved layer from the same parent shifts the precomputed index.
                for (let i = 0; i < moved.length; i++) {
                  const mId = moved[i]!;
                  const siblings = childrenOfLayer(useStudio.getState().bundle?.groups, parentId);
                  const anchor = siblings.indexOf(targetLayerId);
                  const insertAt =
                    anchor >= 0 ? anchor + (mode === 'after' ? 1 : 0) + i : index !== undefined ? index + i : siblings.length;
                  curStore.setLayerParent(mId, parentId, insertAt);
                }
              }
            }
          }
        }
        cleanup();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('keydown', onKeyDown);
    },
    [bgLayerId],
  );

  // 12. Head Click & Context menu
  const onHeadClick = useCallback(
    (ev: ReactMouseEvent<HTMLDivElement>, row: RowItem) => {
      if (hasDraggedRef.current) {
        hasDraggedRef.current = false;
        return;
      }
      if (row.kind === 'layer' && row.layerId) {
        if (ev.shiftKey) select([row.layerId], 'toggle');
        else if (ev.metaKey || ev.ctrlKey) select([row.layerId], 'add');
        else select([row.layerId], 'replace');
      }
    },
    [select],
  );

  const onHeadContextMenu = useCallback(
    (ev: ReactMouseEvent<HTMLDivElement>, row: RowItem) => {
      if (row.kind !== 'layer' || !row.layerId) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (!selection.includes(row.layerId)) {
        select([row.layerId], 'replace');
      }
      const menuW = 190;
      const menuH = 290;
      const x = Math.min(ev.clientX, window.innerWidth - menuW - 8);
      const y = Math.min(ev.clientY, window.innerHeight - menuH - 8);
      setContextMenu({ x, y, layerId: row.layerId });
    },
    [selection, select],
  );

  const activePopoverKf = useMemo(() => {
    if (!popover) return null;
    return keyframes.find((k) => k.id === popover.id) ?? null;
  }, [popover, keyframes]);

  // Toolbar group status
  const allGroupParentIds = useMemo(() => {
    return (bundle?.groups ?? []).map((g) => g.parentId);
  }, [bundle?.groups]);

  const canUngroup = useMemo(() => {
    return selection.some((id) => (bundle?.groups ?? []).some((g) => g.parentId === id || g.id === id));
  }, [selection, bundle?.groups]);

  const hasCollapsedGroups = (timelineUi.collapsedGroups ?? []).length > 0;

  const playheadX = timeToX(playhead, zoom, scroll);
  const stripLeft = timeToX(0, zoom, scroll);
  const stripWidth = duration * zoom;

  return (
    <div className="tl" style={{ height }}>
      {/* 1. Resize handle */}
      <div className="tl-resize" onPointerDown={onResizeStart} />

      {/* 2. Toolbar */}
      <div className="tl-toolbar">
        <button
          type="button"
          className="icon-btn"
          title="Début (0s)"
          onClick={() => setPlayhead(0)}
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Fin"
          onClick={() => setPlayhead(duration)}
        >
          <SkipForward size={14} />
        </button>

        <KeyJumpButtons />

        <span className="tl-time">
          {formatTime(playhead)} / {formatTime(duration)}
        </span>

        <span className="tl-toolbar-label" style={{ marginLeft: 4 }}>Durée</span>
        <input
          type="number"
          className="tl-toolbar-input"
          min={0.5}
          max={60}
          step={0.5}
          value={duration}
          onChange={(ev) => {
            const v = Number.parseFloat(ev.target.value);
            if (Number.isFinite(v) && v > 0) setDuration(v);
          }}
        />

        <Toggle
          label="Auto-key"
          checked={autoKey}
          onChange={setAutoKey}
          title="Créer automatiquement une keyframe lors des modifications"
        />

        <button
          type="button"
          className={`btn ${snap ? 'active' : ''}`}
          title="Aimant (snap sur les secondes et keyframes)"
          style={{
            height: 24,
            padding: '0 6px',
            color: snap ? 'var(--accent)' : 'var(--ink-2)',
            background: snap ? 'var(--accent-soft)' : 'var(--bg-2)',
          }}
          onClick={() => setTimelineUi({ snap: !snap })}
        >
          <Magnet size={13} />
          <span>Aimant</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          title="Zoom arrière (-25%)"
          onClick={() => {
            const nextZoom = clampZoom(zoom * 0.75);
            setTimelineUi({ zoom: nextZoom, scroll: clampScroll(scroll, duration, nextZoom, laneWidth) });
          }}
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Zoom avant (+25%)"
          onClick={() => {
            const nextZoom = clampZoom(zoom * 1.25);
            setTimelineUi({ zoom: nextZoom, scroll: clampScroll(scroll, duration, nextZoom, laneWidth) });
          }}
        >
          <ZoomIn size={14} />
        </button>

        <div style={{ flex: 1 }} />

        {/* Group / Ungroup / Collapse All Toolbar Controls */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginRight: 6 }}>
          <button
            type="button"
            className="icon-btn"
            title="Grouper (⌘G)"
            aria-label="Grouper (⌘G)"
            disabled={selection.length < 2}
            onClick={() => groupLayers(selection)}
          >
            <Group size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Dégrouper (⇧⌘G)"
            aria-label="Dégrouper (⇧⌘G)"
            disabled={!canUngroup}
            onClick={() => {
              for (const id of selection) {
                if ((bundle?.groups ?? []).some((g) => g.parentId === id || g.id === id)) {
                  ungroup(id);
                }
              }
            }}
          >
            <Ungroup size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={hasCollapsedGroups ? 'Tout déplier' : 'Tout replier'}
            aria-label={hasCollapsedGroups ? 'Tout déplier' : 'Tout replier'}
            onClick={() =>
              setTimelineUi({
                collapsedGroups: hasCollapsedGroups ? [] : allGroupParentIds,
              })
            }
          >
            <ChevronsDownUp size={14} />
          </button>
        </div>

        <input
          type="text"
          className="tl-prompt-input"
          placeholder="Décrivez l'animation…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runDirector();
          }}
        />
        <button
          type="button"
          className="btn"
          style={{ height: 24, padding: '0 8px', color: 'var(--accent)' }}
          title="Générer l'animation avec le Réalisateur"
          onClick={runDirector}
        >
          <Wand2 size={13} />
          <span>Réalisateur</span>
        </button>
      </div>

      {/* 3. Body */}
      <div className="tl-body">
        {/* Heads Column */}
        <div className="tl-heads" ref={headsRef} style={{ width: HEADER_W }}>
          <div style={{ height: RULER_H, flexShrink: 0, borderBottom: '1px solid var(--line)' }} />
          {rows.map((row, index) => {
            const isDraggingThis =
              row.layerId !== null &&
              (dragSourceId === row.layerId || movedLayerIds.includes(row.layerId));
            const isDropInsideThis =
              dropTarget?.targetLayerId === row.layerId && dropTarget.mode === 'inside';

            return (
              <TrackHead
                key={row.key}
                rowIndex={index}
                depth={row.depth}
                height={row.height}
                kind={row.kind}
                layerId={row.layerId}
                label={row.label}
                icon={row.icon}
                expandable={row.expandable}
                expanded={row.expanded}
                selected={row.selected}
                hovered={row.hovered}
                visible={row.visible}
                locked={row.locked}
                hasChildren={row.hasChildren}
                collapsed={row.collapsed}
                childCount={row.childCount}
                isDragging={isDraggingThis}
                isDropInside={isDropInsideThis}
                onToggleGroup={() => {
                  if (row.layerId) toggleGroupCollapsed(row.layerId);
                }}
                onToggleChannels={() => {
                  if (row.kind === 'camera') toggleExpanded('_camera');
                  else if (row.kind === 'scene') toggleExpanded('_scene');
                  else if (row.layerId) toggleExpanded(row.layerId);
                }}
                onClick={(ev) => onHeadClick(ev, row)}
                onDoubleClickLabel={() => {
                  if (row.layerId && row.hasChildren) toggleGroupCollapsed(row.layerId);
                }}
                onPointerDown={(ev) => onHeadPointerDown(ev, row)}
                onContextMenu={(ev) => onHeadContextMenu(ev, row)}
                onMouseEnter={() => {
                  if (row.layerId) setHovered(row.layerId);
                }}
                onMouseLeave={() => {
                  if (row.layerId) setHovered(null);
                }}
                onToggleVisible={() => {
                  if (row.layerId) setLayerFlags(row.layerId, { visible: !row.visible });
                }}
                onToggleLocked={() => {
                  if (row.layerId) setLayerFlags(row.layerId, { locked: !row.locked });
                }}
                onFit={() => {
                  if (row.layerId) fitLayerCamera(row.layerId);
                }}
                onApplyGroupOpening={() => {
                  if (row.layerId) applyGroupOpening(row.layerId, playhead);
                }}
              />
            );
          })}

          {/* DnD drop line */}
          {dropTarget && dropTarget.dropLineTop !== undefined && (
            <div
              className="tl-drop-line"
              style={{
                top: dropTarget.dropLineTop,
                left: dropTarget.dropLineLeft ?? 8,
              }}
            />
          )}
        </div>

        {/* Lanes Column */}
        <div
          className="tl-lanes"
          ref={lanesRef}
          onWheel={onLanesWheel}
          style={{ overflowY: 'auto' }}
          onScroll={onLanesScroll}
        >
          <Ruler
            zoom={zoom}
            scroll={scroll}
            duration={duration}
            width={laneWidth}
            playhead={playhead}
            onScrubStart={onScrubStart}
          />

          <div
            className="tl-playhead"
            style={{
              left: playheadX,
              height: `calc(100% - ${RULER_H}px)`,
              top: RULER_H,
            }}
          />

          {rows.map((row) => {
            const marks = marksOf(row.keyframes, row.groupAggregateKfIds);
            const isAggregate = row.depth === 0 || Boolean(row.isGroupAggregate);

            const strip =
              row.kind === 'layer' && row.layerId !== null ? (
                <div
                  className="tl-strip"
                  style={{
                    left: stripLeft,
                    width: stripWidth,
                    backgroundColor: row.stripColor ?? undefined,
                  }}
                >
                  {row.stripThumb ? (
                    <span className="tl-strip__thumb">
                      <img src={row.stripThumb} alt="" draggable={false} />
                    </span>
                  ) : null}
                </div>
              ) : null;

            return (
              <TrackLane
                key={row.key}
                depth={row.depth}
                height={row.height}
                zoom={zoom}
                scroll={scroll}
                marks={marks}
                selectedIds={selectedIds}
                onLanePointerDown={onScrubStart}
                onKeyframePointerDown={onKeyframePointerDown}
                onKeyframeDoubleClick={(ev, ids) =>
                  onKeyframeDoubleClick(ev, ids, isAggregate && ids.length > 1, row.key)
                }
              >
                {strip}
              </TrackLane>
            );
          })}
        </div>
      </div>

      {/* Popover */}
      {activePopoverKf && popover ? (
        <KeyframePopover
          keyframe={activePopoverKf}
          x={popover.x}
          y={popover.y}
          onChange={(patch) => updateKeyframe(activePopoverKf.id, patch)}
          onRemove={() => {
            removeKeyframes([activePopoverKf.id]);
            setPopover(null);
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(activePopoverKf.id);
              return next;
            });
          }}
          onClose={() => setPopover(null)}
        />
      ) : null}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="tl-ctx"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`tl-ctx__item${selection.length < 2 ? ' is-disabled' : ''}`}
            disabled={selection.length < 2}
            onClick={() => {
              groupLayers(selection);
              setContextMenu(null);
            }}
          >
            <Group size={13} />
            <span>Grouper la sélection</span>
          </button>
          <button
            type="button"
            className={`tl-ctx__item${
              !(bundle?.groups ?? []).some(
                (g) => g.parentId === contextMenu.layerId || g.id === contextMenu.layerId,
              )
                ? ' is-disabled'
                : ''
            }`}
            disabled={
              !(bundle?.groups ?? []).some(
                (g) => g.parentId === contextMenu.layerId || g.id === contextMenu.layerId,
              )
            }
            onClick={() => {
              ungroup(contextMenu.layerId);
              setContextMenu(null);
            }}
          >
            <Ungroup size={13} />
            <span>Dégrouper</span>
          </button>
          <button
            type="button"
            className={`tl-ctx__item${
              parentOfLayer(bundle?.groups, contextMenu.layerId) === null ? ' is-disabled' : ''
            }`}
            disabled={parentOfLayer(bundle?.groups, contextMenu.layerId) === null}
            onClick={() => {
              setLayerParent(contextMenu.layerId, null);
              setContextMenu(null);
            }}
          >
            <span>Détacher du parent</span>
          </button>
          <button
            type="button"
            className={`tl-ctx__item${
              !(bundle?.groups ?? []).some((g) => g.parentId === contextMenu.layerId) ? ' is-disabled' : ''
            }`}
            disabled={!(bundle?.groups ?? []).some((g) => g.parentId === contextMenu.layerId)}
            onClick={() => {
              applyGroupOpening(contextMenu.layerId, playhead);
              setContextMenu(null);
            }}
          >
            <Sparkles size={13} />
            <span>Animer l’ouverture</span>
          </button>
          <button
            type="button"
            className="tl-ctx__item"
            onClick={() => {
              setTimelineUi({ collapsedGroups: hasCollapsedGroups ? [] : allGroupParentIds });
              setContextMenu(null);
            }}
          >
            <ChevronsDownUp size={13} />
            <span>{hasCollapsedGroups ? 'Tout déplier' : 'Tout replier'}</span>
          </button>
          <div className="tl-ctx__sep" />
          <button
            type="button"
            className="tl-ctx__item"
            onClick={() => {
              const vis = layersState[contextMenu.layerId]?.visible ?? true;
              setLayerFlags(contextMenu.layerId, { visible: !vis });
              setContextMenu(null);
            }}
          >
            {(layersState[contextMenu.layerId]?.visible ?? true) ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{(layersState[contextMenu.layerId]?.visible ?? true) ? 'Masquer' : 'Afficher'}</span>
          </button>
          <button
            type="button"
            className="tl-ctx__item"
            onClick={() => {
              const locked = layersState[contextMenu.layerId]?.locked ?? false;
              setLayerFlags(contextMenu.layerId, { locked: !locked });
              setContextMenu(null);
            }}
          >
            {(layersState[contextMenu.layerId]?.locked ?? false) ? <LockOpen size={13} /> : <Lock size={13} />}
            <span>{(layersState[contextMenu.layerId]?.locked ?? false) ? 'Déverrouiller' : 'Verrouiller'}</span>
          </button>
          <button
            type="button"
            className="tl-ctx__item"
            onClick={() => {
              fitLayerCamera(contextMenu.layerId);
              setContextMenu(null);
            }}
          >
            <Crosshair size={13} />
            <span>Cadrer la caméra</span>
          </button>
          <div className="tl-ctx__sep" />
          <button
            type="button"
            className="tl-ctx__item is-danger"
            onClick={() => {
              removeLayer(contextMenu.layerId);
              setContextMenu(null);
            }}
          >
            <Trash2 size={13} />
            <span>Supprimer</span>
          </button>
        </div>
      )}
    </div>
  );
}
