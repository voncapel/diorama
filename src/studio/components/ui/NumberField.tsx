import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

interface NumberFieldProps {
  /** null displays the mixed state (several differing values). */
  value: number | null;
  onChange: (value: number) => void;
  /** Scrub increment per pixel (Shift = /10, Alt = ×10) and arrow-key step. */
  step?: number;
  /** Decimal places shown. */
  precision?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  /** Optional label rendered to the left; it is a scrub handle too. */
  label?: string;
  title?: string;
  className?: string;
}

const DRAG_THRESHOLD_PX = 2;

function clamp(v: number, min: number | undefined, max: number | undefined): number {
  let out = v;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

function roundTo(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}

function format(v: number | null, precision: number): string {
  if (v === null) return 'mixte';
  if (!Number.isFinite(v)) return '';
  return roundTo(v, precision).toFixed(precision);
}

/** Accepts "12", "-3.5", "1 200", "12px", ",5" and simple arithmetic like "10+5". */
function parse(text: string): number | null {
  const cleaned = text.replace(/\s+/g, '').replace(/,/g, '.').replace(/[^0-9.+\-*/()]/g, '');
  if (!cleaned) return null;
  if (/^[+\-]?\d*\.?\d+$/.test(cleaned)) return Number(cleaned);
  if (!/^[0-9.+\-*/()]+$/.test(cleaned)) return null;
  try {
    const result = Function(`"use strict"; return (${cleaned});`)() as unknown;
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Scrubbable numeric field. A horizontal drag on the label or the input
 * changes the value by `step` per pixel; typing then Enter commits, Escape
 * restores, arrows nudge by `step`.
 */
export function NumberField({
  value,
  onChange,
  step = 1,
  precision = 0,
  min,
  max,
  unit,
  disabled = false,
  label,
  title,
  className,
}: NumberFieldProps) {
  const [text, setText] = useState(() => format(value, precision));
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    lastX: number;
    accumulated: number;
    moved: boolean;
    target: HTMLElement;
  } | null>(null);

  // While the user is typing the store value must not overwrite the draft.
  useEffect(() => {
    if (!editing) setText(format(value, precision));
  }, [value, precision, editing]);

  const commit = (next: number) => {
    const rounded = roundTo(clamp(next, min, max), precision);
    if (value === null || rounded !== roundTo(value, precision)) onChange(rounded);
    setText(format(rounded, precision));
  };

  const commitText = () => {
    const parsed = parse(text);
    if (parsed === null) setText(format(value, precision));
    else commit(parsed);
    setEditing(false);
  };

  const cancel = () => {
    setText(format(value, precision));
    setEditing(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
      const base = editing ? (parse(text) ?? value ?? 0) : (value ?? 0);
      commit(base + dir * step * mult);
      setEditing(false);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (disabled || e.button !== 0) return;
    // A focused input keeps its text-editing behaviour (caret placement, selection).
    if (editing && e.currentTarget === inputRef.current) return;
    // Keeps the browser from focusing the input on press: focus is granted on
    // release only when the pointer did not move (a plain click).
    e.preventDefault();
    const target = e.currentTarget;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startValue: value ?? 0,
      lastX: e.clientX,
      accumulated: value ?? 0,
      moved: false,
      target,
    };
    target.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.lastX;
    d.lastX = e.clientX;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      setDragging(true);
      inputRef.current?.blur();
    }
    const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    d.accumulated += dx * step * mult;
    const next = roundTo(clamp(d.accumulated, min, max), precision);
    d.accumulated = clamp(d.accumulated, min, max);
    setText(format(next, precision));
    onChange(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.target.hasPointerCapture(e.pointerId)) d.target.releasePointerCapture(e.pointerId);
    if (d.moved) {
      setDragging(false);
      e.preventDefault();
    } else if (e.currentTarget === inputRef.current) {
      // A plain click enters text editing.
      setEditing(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
      setEditing(true);
    }
  };

  const classes = ['numfield'];
  if (dragging) classes.push('dragging');
  if (disabled) classes.push('disabled');
  if (value === null) classes.push('mixed');
  if (className) classes.push(className);

  const field = (
    <div className={classes.join(' ')} title={title}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onFocus={() => {
          if (!dragging) setEditing(true);
        }}
        onBlur={() => {
          if (editing) commitText();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      {unit ? <span className="unit">{unit}</span> : null}
    </div>
  );

  if (!label) return field;

  return (
    <>
      <span
        className="prop-label"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title={title}
      >
        {label}
      </span>
      {field}
    </>
  );
}
