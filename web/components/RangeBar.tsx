import { Calibrating } from './Calibrating';

export function rangeFor(value: number | null, low: number, high: number): { min: number; max: number } {
  const span = Math.max(high - low, Math.abs(high) * 0.05, 1);
  let min = low - span; let max = high + span;
  if (value !== null) { min = Math.min(min, value - span * 0.2); max = Math.max(max, value + span * 0.2); }
  return { min, max };
}

export interface RangeBarProps {
  label: string; value: number | null; unit: string; low: number | null; high: number | null;
  min?: number; max?: number; calibrating: boolean; display?: (v: number) => string;
}

const pct = (v: number, min: number, max: number) => `${Math.round(Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) * 100) / 100}%`;

export function RangeBar({ label, value, unit, low, high, min, max, calibrating, display }: RangeBarProps) {
  const fmt = display ?? ((v: number) => `${unit === 'bpm' || unit === 'ms' ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`);
  const ready = !calibrating && low !== null && high !== null;
  const r = ready ? (min !== undefined && max !== undefined ? { min, max } : rangeFor(value, low!, high!)) : null;
  const outside = ready && value !== null && (value < low! || value > high!);
  return (
    <div className="rangebar">
      <div className="row">
        <span className="muted-2">{label}</span>
        <span>
          <strong>{value === null ? '—' : fmt(value)}</strong>{' '}
          {ready ? <span className="muted">usual {fmt(low!).replace(` ${unit}`, '')}–{fmt(high!)}</span> : <Calibrating />}
        </span>
      </div>
      {r && (
        <div className="track" role="img" aria-label={`${label} ${value === null ? 'no data' : fmt(value)}, usual range ${fmt(low!)} to ${fmt(high!)}`}>
          <div className="band" style={{ left: pct(low!, r.min, r.max), width: `${((high! - low!) / (r.max - r.min)) * 100}%` }} />
          {value !== null && <div data-testid="marker" className={`marker ${outside ? 'out' : ''}`} style={{ left: pct(value, r.min, r.max) }} />}
        </div>
      )}
    </div>
  );
}
