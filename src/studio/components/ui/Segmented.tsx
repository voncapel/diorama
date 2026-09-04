import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Shown as a tooltip; the label is still used for accessibility. */
  title?: string;
  /** Hides the label and renders the icon alone. */
  iconOnly?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Stretches the group to its container. */
  block?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  block = false,
  disabled = false,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className={block ? 'segmented block' : 'segmented'} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.iconOnly ? opt.label : undefined}
            title={opt.title ?? (opt.iconOnly ? opt.label : undefined)}
            className={`segmented-item${active ? ' active' : ''}${opt.iconOnly ? ' icon-only' : ''}`}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(opt.value);
            }}
          >
            {opt.icon}
            {!opt.iconOnly && <span>{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
