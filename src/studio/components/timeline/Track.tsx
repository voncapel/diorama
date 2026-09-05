import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Sparkles,
} from 'lucide-react';
import type { Keyframe } from '../../model/timeline';
import { KeyframeDiamond } from './KeyframeDiamond';
import { roundTime, timeToX } from './useTimelineGeometry';

export interface KeyframeMark {
  time: number;
  ids: string[];
  isGroupAggregate?: boolean;
}

/** Collapses keyframes sharing the same time (to the ms) into one mark. */
export function marksOf(
  keyframes: readonly Keyframe[],
  groupAggregateKfIds?: ReadonlySet<string>,
): KeyframeMark[] {
  const byTime = new Map<number, { ids: string[]; isGroupAggregate: boolean }>();
  for (const kf of keyframes) {
    const t = roundTime(kf.time);
    const isAgg = groupAggregateKfIds ? groupAggregateKfIds.has(kf.id) : false;
    const existing = byTime.get(t);
    if (existing) {
      existing.ids.push(kf.id);
      if (isAgg) existing.isGroupAggregate = true;
    } else {
      byTime.set(t, { ids: [kf.id], isGroupAggregate: isAgg });
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, data]) => ({ time, ids: data.ids, isGroupAggregate: data.isGroupAggregate }));
}

export interface TrackHeadProps {
  height: number;
  depth: number;
  kind: 'camera' | 'scene' | 'layer' | 'channel';
  layerId?: string | null;
  label: ReactNode;
  icon?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  selected?: boolean;
  hovered?: boolean;
  visible?: boolean;
  locked?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  childCount?: number;
  isDragging?: boolean;
  isDropInside?: boolean;
  rowIndex?: number;
  onToggleGroup?: () => void;
  onToggleChannels?: () => void;
  onClick?: (ev: ReactMouseEvent<HTMLDivElement>) => void;
  onDoubleClickLabel?: (ev: ReactMouseEvent<HTMLSpanElement>) => void;
  onPointerDown?: (ev: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu?: (ev: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onToggleVisible?: () => void;
  onToggleLocked?: () => void;
  onFit?: () => void;
  onApplyGroupOpening?: () => void;
}

export function TrackHead({
  height,
  depth,
  kind,
  layerId,
  label,
  icon,
  expandable,
  expanded,
  selected,
  hovered,
  visible = true,
  locked = false,
  hasChildren = false,
  collapsed = false,
  childCount = 0,
  isDragging = false,
  isDropInside = false,
  rowIndex,
  onToggleGroup,
  onToggleChannels,
  onClick,
  onDoubleClickLabel,
  onPointerDown,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  onToggleVisible,
  onToggleLocked,
  onFit,
  onApplyGroupOpening,
}: TrackHeadProps) {
  const className = [
    'tl-head',
    kind === 'channel' ? 'tl-head--sub' : '',
    selected ? 'is-selected' : '',
    hovered ? 'is-hovered' : '',
    isDragging ? 'is-dragging' : '',
    isDropInside ? 'is-drop-inside' : '',
    !visible ? 'tl-head--hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const paddingLeft = 8 + depth * 14;

  return (
    <div
      className={className}
      style={{ height, paddingLeft }}
      data-row-index={rowIndex}
      data-layer-id={layerId ?? undefined}
      data-kind={kind}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {kind === 'layer' && hasChildren ? (
        <button
          type="button"
          className={`tl-chevron tl-chevron--group${!collapsed ? ' is-open' : ''}`}
          title={collapsed ? 'Déplier le groupe' : 'Replier le groupe'}
          aria-label={collapsed ? 'Déplier le groupe' : 'Replier le groupe'}
          aria-expanded={!collapsed}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleGroup?.();
          }}
        >
          <ChevronRight size={12} />
        </button>
      ) : kind !== 'channel' ? (
        <span className="tl-chevron-spacer" aria-hidden="true" />
      ) : null}

      {icon}

      <span
        className="tl-head__label"
        onDoubleClick={(ev) => {
          if (hasChildren) {
            ev.stopPropagation();
            onDoubleClickLabel?.(ev);
          }
        }}
        title={typeof label === 'string' ? label : undefined}
      >
        {label}
      </span>

      {hasChildren && childCount > 0 && (
        <span className="tl-head__badge" title={`${childCount} éléments groupés`}>
          {childCount}
        </span>
      )}

      {expandable && (
        <button
          type="button"
          className={`tl-chevron--channels${expanded ? ' is-open' : ''}`}
          title="Canaux"
          aria-label="Canaux"
          aria-expanded={expanded}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleChannels?.();
          }}
        >
          <ChevronDown size={10} />
        </button>
      )}

      {kind === 'layer' && layerId && (
        <span className="tl-head__actions" onClick={(ev) => ev.stopPropagation()}>
          {hasChildren && onApplyGroupOpening && (
            <button
              type="button"
              className="icon-btn accent"
              title="Animer l’ouverture"
              aria-label="Animer l’ouverture"
              onClick={(ev) => {
                ev.stopPropagation();
                onApplyGroupOpening();
              }}
            >
              <Sparkles size={11} />
            </button>
          )}
          {onFit && (
            <button
              type="button"
              className="icon-btn"
              title="Cadrer la couche"
              aria-label="Cadrer la couche"
              onClick={(ev) => {
                ev.stopPropagation();
                onFit();
              }}
            >
              <Crosshair size={11} />
            </button>
          )}
          <button
            type="button"
            className={visible ? 'icon-btn' : 'icon-btn on'}
            title={visible ? 'Masquer' : 'Afficher'}
            aria-label={visible ? 'Masquer' : 'Afficher'}
            aria-pressed={!visible}
            onClick={(ev) => {
              ev.stopPropagation();
              onToggleVisible?.();
            }}
          >
            {visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button
            type="button"
            className={locked ? 'icon-btn on' : 'icon-btn'}
            title={locked ? 'Déverrouiller' : 'Verrouiller'}
            aria-label={locked ? 'Déverrouiller' : 'Verrouiller'}
            aria-pressed={locked}
            onClick={(ev) => {
              ev.stopPropagation();
              onToggleLocked?.();
            }}
          >
            {locked ? <Lock size={11} /> : <LockOpen size={11} />}
          </button>
        </span>
      )}
    </div>
  );
}

export interface TrackLaneProps {
  height: number;
  depth: number;
  zoom: number;
  scroll: number;
  marks: KeyframeMark[];
  selectedIds: ReadonlySet<string>;
  /** Layer strip and its content, rendered under the keyframes. */
  children?: ReactNode;
  onLanePointerDown: (ev: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyframePointerDown: (ev: ReactPointerEvent<HTMLDivElement>, ids: string[]) => void;
  onKeyframeDoubleClick: (ev: ReactMouseEvent<HTMLDivElement>, ids: string[]) => void;
}

export function TrackLane({
  height,
  depth,
  zoom,
  scroll,
  marks,
  selectedIds,
  children,
  onLanePointerDown,
  onKeyframePointerDown,
  onKeyframeDoubleClick,
}: TrackLaneProps) {
  const className = depth > 0 ? 'tl-lane tl-lane--sub' : 'tl-lane';
  return (
    <div className={className} style={{ height }} onPointerDown={onLanePointerDown}>
      {children}
      {marks.map((mark) => (
        <KeyframeDiamond
          key={mark.time.toFixed(3)}
          x={timeToX(mark.time, zoom, scroll)}
          ids={mark.ids}
          aggregate={mark.ids.length > 1}
          isGroupAggregate={mark.isGroupAggregate}
          selected={mark.ids.some((id) => selectedIds.has(id))}
          title={`${mark.time.toFixed(2)} s`}
          onPointerDown={onKeyframePointerDown}
          onDoubleClick={onKeyframeDoubleClick}
        />
      ))}
    </div>
  );
}
