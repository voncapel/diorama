import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { formatTick, majorStep, minorStep, timeToX } from './useTimelineGeometry';

export interface RulerProps {
  zoom: number;
  scroll: number;
  duration: number;
  width: number;
  playhead: number;
  onScrubStart: (ev: ReactPointerEvent<HTMLDivElement>) => void;
}

interface Tick {
  t: number;
  x: number;
  major: boolean;
}

/** Time ruler: adaptive ticks, playhead head, click or drag to scrub. */
export function Ruler({ zoom, scroll, duration, width, playhead, onScrubStart }: RulerProps) {
  const ticks = useMemo<Tick[]>(() => {
    if (width <= 0) return [];
    const major = majorStep(zoom);
    const minor = minorStep(major);
    const first = Math.floor(scroll / minor) * minor;
    const last = scroll + width / zoom;
    const out: Tick[] = [];
    const ratio = Math.round(major / minor);
    for (let i = 0; ; i++) {
      const t = first + i * minor;
      if (t > last + 1e-6) break;
      if (t < -1e-6) continue;
      const index = Math.round(t / minor);
      out.push({ t, x: timeToX(t, zoom, scroll), major: index % ratio === 0 });
    }
    return out;
  }, [zoom, scroll, width]);

  const major = majorStep(zoom);
  const endX = timeToX(duration, zoom, scroll);
  const headX = timeToX(playhead, zoom, scroll);

  return (
    <div className="tl-ruler" onPointerDown={onScrubStart}>
      {ticks.map((tick) => (
        <div key={tick.t.toFixed(3)} className={tick.major ? 'tl-tick is-major' : 'tl-tick'} style={{ left: tick.x }}>
          {tick.major ? <span className="tl-tick__label">{formatTick(tick.t, major)}</span> : null}
        </div>
      ))}
      <div className="tl-ruler__end" style={{ left: endX }} />
      <div className="tl-playhead-head" style={{ left: headX }} />
    </div>
  );
}
