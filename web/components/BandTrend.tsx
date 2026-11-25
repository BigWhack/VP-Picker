import type { Series } from '../../shared/types';

export function BandTrend({ series, color, label, unit, height = 120 }: { series: Series; color: string; label: string; unit?: string; height?: number }) {
  const pts = series.points.filter((p) => p.value !== null) as { date: string; value: number }[];
  if (pts.length < 2) return <p className="empty">Not enough data yet.</p>;
  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (series.band) { lo = Math.min(lo, series.band.low); hi = Math.max(hi, series.band.high); }
  const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
  const n = series.points.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * 260);
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
  const line = series.points.map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value).toFixed(2)}`)).filter(Boolean).join(' ');
  const first = pts[0]; const last = pts[pts.length - 1];
  const fmtD = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <div>
      <svg width="100%" height={height} viewBox="0 0 260 100" preserveAspectRatio="none" role="img"
        aria-label={`${label} from ${Math.round(first.value)} to ${Math.round(last.value)}${unit ? ' ' + unit : ''} over ${n} days`}>
        {series.band && <rect x="0" y={y(series.band.high)} width="260" height={Math.max(0, y(series.band.low) - y(series.band.high))} fill="var(--good-fill)" />}
        <polyline fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" points={line} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between' }} className="tiny muted">
        <span>{fmtD(series.points[0].date)}</span>{series.band && <span>Shaded = usual range</span>}<span>{fmtD(series.points[n - 1].date)}</span>
      </div>
    </div>
  );
}
