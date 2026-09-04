import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface KeyframeDiamondProps {
  /** Position of the diamond centre in lane px. */
  x: number;
  /** Ids of the keyframes represented by this mark (several when aggregated). */
  ids: string[];
  selected: boolean;
  /** True when the mark stands for more than one keyframe. */
  aggregate: boolean;
  title?: string;
  onPointerDown: (ev: ReactPointerEvent<HTMLDivElement>, ids: string[]) => void;
  onDoubleClick: (ev: ReactMouseEvent<HTMLDivElement>, ids: string[]) => void;
}

export function KeyframeDiamond({ x, ids, selected, aggregate, title, onPointerDown, onDoubleClick }: KeyframeDiamondProps) {
  const className = ['tl-kf', selected ? 'is-selected' : '', aggregate ? 'is-aggregate' : ''].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      style={{ left: x }}
      data-ids={ids.join(',')}
      title={title}
      onPointerDown={(ev) => onPointerDown(ev, ids)}
      onDoubleClick={(ev) => onDoubleClick(ev, ids)}
    >
      <span className="tl-kf__shape" />
    </div>
  );
}
