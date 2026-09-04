import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Box,
  Camera,
  Magnet,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sun,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { orderedLayers, useStudio } from '../../store';
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
import '../../styles/timeline.css';

interface PopoverState {
  id: string;
  x: number;
  y: number;
}

interface RowItem {
  key: string;
  depth: 0 | 1;
  height: number;
  label: string;
  icon?: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onHeadClick?: (ev: ReactMouseEvent<HTMLDivElement>) => void;
  keyframes: Keyframe[];
  layerId: string | null;
  channel?: ChannelId;
  stripThumb?: string | null;
  stripColor?: string;
}

export function Timeline() {
  const bundle = useStudio((s) => s.bundle);
  const keyframes = useStudio((s) => s.keyframes);
  const duration = useStudio((s) => s.duration);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const autoKey = useStudio((s) => s.autoKey);
  const selection = useStudio((s) => s.selection);
  const timelineUi = useStudio((s) => s.timelineUi);
  const prompt = useStudio((s) => s.prompt);

  const setPlaying = useStudio((s) => s.setPlaying);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const setDuration = useStudio((s) => s.setDuration);
  const setAutoKey = useStudio((s) => s.setAutoKey);
  const select = useStudio((s) => s.select);
  const setTimelineUi = useStudio((s) => s.setTimelineUi);
  const toggleExpanded = useStudio((s) => s.toggleExpanded);
  const moveKeyframes = useStudio((s) => s.moveKeyframes);
  const updateKeyframe = useStudio((s) => s.updateKeyframe);
  const removeKeyframes = useStudio((s) => s.removeKeyframes);
  const setPrompt = useStudio((s) => s.setPrompt);
  const runDirector = useStudio((s) => s.runDirector);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const lanesRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const laneWidth = useElementWidth(lanesRef);

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

  // 2. Keyboard Delete shortcut
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        const activeEl = document.activeElement;
        const isInput =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.getAttribute('contenteditable') === 'true';
        if (!isInput && selectedIds.size > 0) {
          ev.preventDefault();
          removeKeyframes([...selectedIds]);
          setSelectedIds(new Set());
          setPopover(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, removeKeyframes]);

  // 3. Top Resize Drag Handler
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

  // 4. Scrubbing logic (Ruler or empty lane)
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

  // 5. Keyframe Selection and Dragging
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

      // Keyframes not being moved for snap candidate
      const otherKeyframes = keyframes.filter((k) => !nextSelected.has(k.id));
      const otherTimes = [...new Set([...keyframeTimes(otherKeyframes), ...secondMarks(duration)])].sort((a, b) => a - b);

      // We anchor on the first dragged keyframe for snapping
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

  // 6. Keyframe Double Click (open popover for 1 keyframe, or expand row if aggregate)
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

  // 7. Wheel on lanes (Ctrl/Cmd = zoom around mouse; Shift/deltaX = horizontal scroll; deltaY = vertical scroll)
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

  // 8. Build Rows (Camera, Scene, Layers)
  const layers = useMemo(() => orderedLayers(bundle), [bundle]);

  const rows = useMemo<RowItem[]>(() => {
    const list: RowItem[] = [];

    // --- Camera row ---
    const camKeyframes = keyframes.filter((k) => k.layerId === null && (CAMERA_CHANNELS as readonly ChannelDef[]).some((c) => c.id === k.channel));
    const camExpanded = expanded.includes('_camera');
    const camActiveChannels = CAMERA_CHANNELS.filter((ch) => camKeyframes.some((k) => k.channel === ch.id));

    list.push({
      key: '_camera',
      depth: 0,
      height: ROW_H,
      label: 'Caméra',
      icon: <Camera size={14} color="var(--ink-2)" />,
      expandable: camActiveChannels.length > 0,
      expanded: camExpanded,
      onToggle: () => toggleExpanded('_camera'),
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
          label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
          icon: <KeyDot layerId={null} channel={ch.id as CameraChannelId} />,
          keyframes: chKeyframes,
          layerId: null,
          channel: ch.id as CameraChannelId,
        });
      }
    }

    // --- Scene row ---
    const sceneKeyframes = keyframes.filter((k) => k.layerId === null && (SCENE_CHANNELS as readonly ChannelDef[]).some((c) => c.id === k.channel));
    const sceneExpanded = expanded.includes('_scene');
    const sceneActiveChannels = SCENE_CHANNELS.filter((ch) => sceneKeyframes.some((k) => k.channel === ch.id));

    list.push({
      key: '_scene',
      depth: 0,
      height: ROW_H,
      label: 'Scène',
      icon: <Sun size={14} color="var(--ink-2)" />,
      expandable: sceneActiveChannels.length > 0,
      expanded: sceneExpanded,
      onToggle: () => toggleExpanded('_scene'),
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
          label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
          icon: <KeyDot layerId={null} channel={ch.id as SceneChannelId} />,
          keyframes: chKeyframes,
          layerId: null,
          channel: ch.id as SceneChannelId,
        });
      }
    }

    // --- Layers ---
    for (const layer of layers) {
      const id = layer.id;
      const lKeyframes = keyframes.filter((k) => k.layerId === id);
      const lExpanded = expanded.includes(id);
      const lActiveChannels = LAYER_CHANNELS.filter((ch) => lKeyframes.some((k) => k.channel === ch.id));
      const thumb = bundle?.raster?.layers?.find((l) => l.layerId === id)?.png ?? null;
      const isSelected = selection.includes(id);

      const icon = thumb ? (
        <span className="layer-thumb" style={{ width: 16, height: 16, flexShrink: 0 }}>
          <img src={thumb} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </span>
      ) : (
        <Box size={14} color="var(--ink-2)" />
      );

      list.push({
        key: id,
        depth: 0,
        height: ROW_H,
        label: layer.label,
        icon,
        expandable: lActiveChannels.length > 0,
        expanded: lExpanded,
        selected: isSelected,
        onToggle: () => toggleExpanded(id),
        onHeadClick: (ev) => {
          if (ev.shiftKey) select([id], 'toggle');
          else select([id], 'replace');
        },
        keyframes: lKeyframes,
        layerId: id,
        stripThumb: thumb,
        stripColor: layer.backgroundColor,
      });

      if (lExpanded) {
        for (const ch of lActiveChannels) {
          const chKeyframes = lKeyframes.filter((k) => k.channel === ch.id);
          list.push({
            key: `${id}|${ch.id}`,
            depth: 1,
            height: SUB_ROW_H,
            label: `${CHANNEL_GROUP_LABELS[ch.group]} · ${ch.label}`,
            icon: <KeyDot layerId={id} channel={ch.id as LayerChannelId} />,
            keyframes: chKeyframes,
            layerId: id,
            channel: ch.id as LayerChannelId,
          });
        }
      }
    }

    return list;
  }, [bundle, keyframes, expanded, layers, selection, select, toggleExpanded]);

  const activePopoverKf = useMemo(() => {
    if (!popover) return null;
    return keyframes.find((k) => k.id === popover.id) ?? null;
  }, [popover, keyframes]);

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
          {rows.map((row) => (
            <TrackHead
              key={row.key}
              depth={row.depth}
              height={row.height}
              label={row.label}
              icon={row.icon}
              expandable={row.expandable}
              expanded={row.expanded}
              selected={row.selected}
              onToggle={row.onToggle}
              onClick={row.onHeadClick}
            />
          ))}
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
            const marks = marksOf(row.keyframes);
            const isAggregate = row.depth === 0;

            const strip =
              row.depth === 0 && row.layerId !== null ? (
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
    </div>
  );
}
