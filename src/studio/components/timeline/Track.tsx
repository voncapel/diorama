import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Keyframe } from '../../model/timeline';
import { KeyframeDiamond } from './KeyframeDiamond';
import { roundTime, timeToX } from './useTimelineGeometry';

export interface KeyframeMark {
  time: number;
  ids: string[];
}

/** Collapses keyframes sharing the same time (to the ms) into one mark. */
export function marksOf(keyframes: readonly Keyframe[]): KeyframeMark[] {
  const byTime = new Map<number, string[]>();
  for (const kf of keyframes) {
    const t = roundTime(kf.time);
    const list = byTime.get(t);
    if (list) list.push(kf.id);
    else byTime.set(t, [kf.id]);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, ids]) => ({ time, ids }));
}

export interface TrackHeadProps {
  height: number;
  depth: 0 | 1;
  label: ReactNode;
  icon?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: (ev: ReactMouseEvent<HTMLDivElement>) => void;
}

export function TrackHead({ height, depth, label, icon, expandable, expanded, selected, onToggle, onClick }: TrackHeadProps) {
  const className = ['tl-head', depth === 1 ? 'tl-head--sub' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  return (
    <div className={className} style={{ height }} onClick={onClick}>
      {depth === 0 ? (
        <button
          type="button"
          className={expanded ? 'tl-chevron is-open' : 'tl-chevron'}
          disabled={!expandable}
          aria-label={expanded ? 'Replier' : 'Déplier'}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggle?.();
          }}
        >
          <ChevronRight size={12} />
        </button>
      ) : null}
      {icon}
      <span className="tl-head__label">{label}</span>
    </div>
  );
}

export interface TrackLaneProps {
  height: number;
  depth: 0 | 1;
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
  const className = depth === 1 ? 'tl-lane tl-lane--sub' : 'tl-lane';
  return (
    <div className={className} style={{ height }} onPointerDown={onLanePointerDown}>
      {children}
      {marks.map((mark) => (
        <KeyframeDiamond
          key={mark.time.toFixed(3)}
          x={timeToX(mark.time, zoom, scroll)}
          ids={mark.ids}
          aggregate={depth === 0 && mark.ids.length > 1}
          selected={mark.ids.some((id) => selectedIds.has(id))}
          title={`${mark.time.toFixed(2)} s`}
          onPointerDown={onKeyframePointerDown}
          onDoubleClick={onKeyframeDoubleClick}
        />
      ))}
    </div>
  );
}
