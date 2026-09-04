import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface SectionProps {
  title: string;
  children: ReactNode;
  /** Initial state; the section keeps its own open/closed state afterwards. */
  defaultOpen?: boolean;
  /** Rendered at the right of the header (a Toggle, a count...). */
  extra?: ReactNode;
  /** Rendered at the bottom of the body, after the rows. */
  footer?: ReactNode;
}

export function Section({ title, children, defaultOpen = true, extra, footer }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={open ? 'section open' : 'section'}>
      <div className="section-headrow">
        <button
          type="button"
          className="section-head"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight size={12} className="chevron" />
          <span>{title}</span>
        </button>
        {extra && (
          <span className="section-extra" onClick={(e) => e.stopPropagation()}>
            {extra}
          </span>
        )}
      </div>
      {open && (
        <div className="section-body">
          {children}
          {footer}
        </div>
      )}
    </div>
  );
}
