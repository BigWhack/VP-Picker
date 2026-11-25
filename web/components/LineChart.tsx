export interface Line { name: string; color: string; values: (number | null)[]; dashed?: boolean; width?: number }

/** Multi-line SVG chart over a shared x index, with optional zero line and bars. */
export function LineChart({ lines, labels, height = 200, bars, zero = false, ariaLabel, format = (v: number) => String(Math.round(v)) }:
  { lines: Line[]; labels: string[]; height?: number; bars?: { values: number[]; color: string }; zero?: boolean; ariaLabel: string; format?: (v: number) => string }) {
  const all = [...lines.flatMap((l) => l.values.filter((v): v is number => v !== null)), ...(zero ? [0] : [])];
  if (all.length < 2) return <p className="empty">Not enough data yet.</p>;
  let lo = Math.min(...all); let hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const W = 600; const H = 100; const n = labels.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = (vals: (number | null)[]) => {
    let d = ''; let pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(2)} `; pen = true; });
    return d;
  };
  const bmax = bars ? Math.max(1, ...bars.values) : 1;
  const step = Math.max(1, Math.ceil(n / 6));
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }} className="small">
        {lines.map((l) => <span key={l.name}><span style={{ display: 'inline-block', width: 14, height: 3, background: l.color, verticalAlign: 'middle', marginRight: 6, opacity: l.dashed ? 0.6 : 1 }} />{l.name}</span>)}
      </div>
      <div style={{ position: 'relative' }}>
        <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
          {bars && bars.values.map((v, i) => <rect key={i} x={x(i) - W / n / 2.5} width={W / n / 1.25} y={H - (v / bmax) * H * 0.35} height={(v / bmax) * H * 0.35} fill={bars.color} opacity={0.35} />)}
          {zero && lo < 0 && hi > 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--dash)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
          {lines.map((l) => <path key={l.name} d={path(l.values)} fill="none" stroke={l.color} strokeWidth={l.width ?? 2} strokeDasharray={l.dashed ? '5 4' : undefined} opacity={l.dashed ? 0.6 : 1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
        </svg>
        <span className="tiny muted" style={{ position: 'absolute', top: 0, left: 4 }}>{format(hi - pad)}</span>
        <span className="tiny muted" style={{ position: 'absolute', bottom: 0, left: 4 }}>{format(lo + pad)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }} className="tiny muted">
        {labels.map((l, i) => (i % step === 0 || i === n - 1 ? <span key={i}>{l}</span> : null))}
      </div>
    </div>
  );
}
