import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Easing, Keyframe } from '../../model/timeline';
import { EASING_LABELS } from '../../model/timeline';
import { channelDef, CHANNEL_GROUP_LABELS } from '../../model/channels';

export interface KeyframePopoverProps {
  keyframe: Keyframe;
  /** Anchor in viewport coordinates. */
  x: number;
  y: number;
  onChange: (patch: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>) => void;
  onRemove: () => void;
  onClose: () => void;
}

const EASING_IDS = Object.keys(EASING_LABELS) as Easing[];

function NumberInput({
  value,
  step,
  precision,
  unit,
  onCommit,
}: {
  value: number;
  step: number;
  precision: number;
  unit: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(value.toFixed(precision));
  useEffect(() => setText(value.toFixed(precision)), [value, precision]);
  const commit = () => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setText(value.toFixed(precision));
  };
  return (
    <span className="tl-pop__field">
      <input
        className="tl-pop__input"
        type="number"
        step={step}
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            commit();
            (ev.currentTarget as HTMLInputElement).blur();
          }
          ev.stopPropagation();
        }}
      />
      {unit ? <span className="tl-pop__unit">{unit}</span> : null}
    </span>
  );
}

/** Inline editor for one keyframe: time, value, easing, delete. */
export function KeyframePopover({ keyframe, x, y, onChange, onRemove, onClose }: KeyframePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const def = channelDef(keyframe.channel);

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the popover inside the viewport.
  const width = 240;
  const height = 150;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2));
  const top = y - height - 12 < 8 ? y + 14 : y - height - 12;

  return (
    <div ref={ref} className="tl-pop" style={{ left, top }} onPointerDown={(ev) => ev.stopPropagation()}>
      <div className="tl-pop__title">
        <span className="tl-pop__group">{CHANNEL_GROUP_LABELS[def.group]}</span>
        <span>{def.label}</span>
      </div>
      <label className="tl-pop__row">
        <span className="tl-pop__label">Temps</span>
        <NumberInput value={keyframe.time} step={0.01} precision={2} unit="s" onCommit={(time) => onChange({ time })} />
      </label>
      <label className="tl-pop__row">
        <span className="tl-pop__label">Valeur</span>
        <NumberInput
          value={keyframe.value}
          step={def.step}
          precision={def.precision}
          unit={def.unit ?? ''}
          onCommit={(value) => onChange({ value })}
        />
      </label>
      <label className="tl-pop__row">
        <span className="tl-pop__label">Easing</span>
        <select
          className="tl-pop__select"
          value={keyframe.easing}
          onChange={(ev) => onChange({ easing: ev.target.value as Easing })}
          onKeyDown={(ev) => ev.stopPropagation()}
        >
          {EASING_IDS.map((id) => (
            <option key={id} value={id}>
              {EASING_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <div className="tl-pop__actions">
        <button type="button" className="tl-btn tl-btn--danger" onClick={onRemove} title="Supprimer la keyframe (Suppr)">
          <Trash2 size={13} />
          <span>Supprimer</span>
        </button>
      </div>
    </div>
  );
}
