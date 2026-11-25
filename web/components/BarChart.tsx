export interface Bar { label: string; segments: { value: number; color: string; name: string }[]; highlight?: boolean }

/** Vertical (stacked) bars with an optional goal line. */
export function BarChart({ bars, height = 150, goal, format = (v: number) => String(Math.round(v)), ariaLabel }:
  { bars: Bar[]; height?: number; goal?: number | null; format?: (v: number) => string; ariaLabel: string }) {
  const totals = bars.map((b) => b.segments.reduce((a, s) => a + s.value, 0));
  const max = Math.max(1, ...totals, goal ?? 0) * 1.08;
  return (
    <div role="img" aria-label={ariaLabel}>
      <div style={{ position: 'relative', height, display: 'grid', gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`, gap: bars.length > 20 ? 2 : 8, alignItems: 'end' }}>
        {goal ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(goal / max) * 100}%`, borderTop: '1px dashed var(--dash)' }} /> : null}
        {bars.map((b, i) => (
          <div key={b.label + i} title={`${b.label}: ${format(totals[i])}`} style={{ height: `${(totals[i] / max) * 100}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '6px 6px 2px 2px', overflow: 'hidden', opacity: b.highlight === false ? 0.55 : 1 }}>
            {b.segments.map((s) => <div key={s.name} style={{ height: totals[i] ? `${(s.value / totals[i]) * 100}%` : 0, background: s.color }} />)}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`, gap: bars.length > 20 ? 2 : 8, marginTop: 6 }} className="tiny muted">
        {bars.map((b, i) => <span key={b.label + i} style={{ textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>{bars.length > 16 && i % Math.ceil(bars.length / 8) !== 0 ? '' : b.label}</span>)}
      </div>
    </div>
  );
}
