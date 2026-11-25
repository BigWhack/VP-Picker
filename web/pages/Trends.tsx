import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { LineChart } from '../components/LineChart';
import { Scatter } from '../components/Scatter';
import { RangeTabs, type RangeKey } from '../components/RangeTabs';
import { fmtClock, fmtDuration } from '../../shared/format';
import type { Series } from '../../shared/types';

interface TrendData { label: string; unit: string; series: Series; compareSeries: Series | null; summary: { mean: number | null; previousMean: number | null; change: number | null } }
interface LoadData { days: { date: string; load: number; atl: number; ctl: number; tsb: number; acwr: number | null }[]; weeks: { week: string; load: number; monotony: number | null; strain: number | null }[] }
interface Records {
  current: { label: string; distanceM: number; best: { timeS: number; date: string; workoutId: string } | null; history: { timeS: number; date: string }[] }[];
  predictions: { label: string; distanceM: number; riegelS: number; vdotS: number; from: { distanceM: number; timeS: number; date: string } }[];
}
interface Patterns { patterns: { driver: string; outcome: string; rho: number; n: number; text: string; points: [number, number][] }[] }

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMetric = (v: number | null, unit: string) => (v === null ? '—' : unit === 'min' ? fmtDuration(v) : `${Math.round(v * 10) / 10}${unit && unit !== '%' ? ` ${unit}` : unit}`);

export function Trends() {
  const [metric, setMetric] = useState('recovery');
  const [range, setRange] = useState<RangeKey>('90d');
  const [compare, setCompare] = useState<'none' | 'previous' | 'lastYear'>('previous');
  const metrics = useApi<{ key: string; label: string; unit: string }[]>('/api/trends/metrics').data ?? [];
  const trend = useApi<TrendData>(`/api/trends?metric=${metric}&range=${range}${compare !== 'none' ? `&compareTo=${compare}` : ''}`).data;
  const load = useApi<LoadData>(`/api/trends/load?range=${range}`).data;
  const records = useApi<Records>('/api/records').data;
  const patterns = useApi<Patterns>('/api/patterns').data;
  const latest = load?.days.at(-1);
  const formWord = latest ? (latest.tsb > 5 ? 'Fresh' : latest.tsb > -10 ? 'Balanced' : latest.tsb > -30 ? 'Building fitness (fatigued)' : 'Very fatigued') : null;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="headline">Trends</h1>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      <Card title="Any metric over time" aside={trend?.summary.mean !== null && trend ? <>Average <strong>{fmtMetric(trend.summary.mean, trend.unit)}</strong>{trend.summary.change !== null && <> · {trend.summary.change >= 0 ? '+' : '−'}{fmtMetric(Math.abs(trend.summary.change), trend.unit)} vs comparison</>}</> : undefined}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field">Metric
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>{metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          </label>
          <label className="field">Compare with
            <select value={compare} onChange={(e) => setCompare(e.target.value as typeof compare)}>
              <option value="none">Nothing</option><option value="previous">Previous period</option><option value="lastYear">Same period last year</option>
            </select>
          </label>
        </div>
        {trend && (
          <LineChart ariaLabel={`${trend.label} over the selected period`} labels={trend.series.points.map((p) => day(p.date))}
            format={(v) => fmtMetric(v, trend.unit)}
            lines={[
              ...(trend.compareSeries ? [{ name: compare === 'lastYear' ? 'Last year' : 'Previous period', color: '#9AA4B2', dashed: true, values: trend.compareSeries.points.map((p) => p.value) }] : []),
              { name: trend.label, color: 'var(--good)', values: trend.series.points.map((p) => p.value) },
            ]} />
        )}
      </Card>

      {load && load.days.length > 1 && (
        <Card title="Fitness, fatigue and form" aside={latest && formWord ? <>Form <strong>{Math.round(latest.tsb)}</strong> · {formWord}</> : undefined}>
          <LineChart ariaLabel="Training fitness, fatigue and form over time, with daily load bars" labels={load.days.map((d) => day(d.date))} zero
            bars={{ values: load.days.map((d) => d.load), color: '#9AA4B2' }}
            lines={[{ name: 'Fitness (42-day)', color: 'var(--core)', values: load.days.map((d) => d.ctl), width: 2.5 },
              { name: 'Fatigue (7-day)', color: 'var(--heart)', values: load.days.map((d) => d.atl) },
              { name: 'Form', color: 'var(--good)', values: load.days.map((d) => d.tsb) }]} />
          <p className="small muted" style={{ margin: 0 }}>Fitness rises slowly with consistent training; fatigue reacts to recent sessions. Form = fitness − fatigue: negative while building, positive when fresh.{latest?.acwr ? ` This week is ${latest.acwr.toFixed(2)}× your 4-week average.` : ''}</p>
        </Card>
      )}

      {records && (
        <div className="grid-2">
          <Card title="Personal bests" aside="Running">
            <table className="compare" style={{ minWidth: 0 }}>
              <thead><tr><th>Distance</th><th>Best</th><th>When</th></tr></thead>
              <tbody>{records.current.filter((r) => r.best).map((r) => (
                <tr key={r.label}><td>{r.label}</td><td style={{ fontWeight: 600 }}>{fmtClock(r.best!.timeS)}</td>
                  <td><Link to={`/workouts/${encodeURIComponent(r.best!.workoutId)}`}>{day(r.best!.date)}</Link>{r.history.length > 1 && <span className="muted small"> · {r.history.length} PRs</span>}</td></tr>
              ))}</tbody>
            </table>
            {records.current.every((r) => !r.best) && <p className="empty">Personal bests appear once you have runs with GPS.</p>}
          </Card>
          <Card title="Race predictions" aside="From your best effort in the last 90 days">
            {records.predictions.length ? (
              <>
                <table className="compare" style={{ minWidth: 0 }}>
                  <thead><tr><th>Race</th><th>Riegel</th><th>VDOT</th></tr></thead>
                  <tbody>{records.predictions.map((p) => <tr key={p.label}><td>{p.label}</td><td style={{ fontWeight: 600 }}>{fmtClock(p.riegelS)}</td><td className="muted-2">{fmtClock(p.vdotS)}</td></tr>)}</tbody>
                </table>
                <p className="small muted" style={{ margin: 0 }}>Based on {(records.predictions[0].from.distanceM / 1000).toFixed(1)} km in {fmtClock(records.predictions[0].from.timeS)} on {day(records.predictions[0].from.date)}. Longer predictions assume the training to match.</p>
              </>
            ) : <p className="empty">Needs a run of at least 1 km in the last 90 days.</p>}
          </Card>
        </div>
      )}

      <Card title="Patterns" aside="Pattern, not proof">
        {!patterns?.patterns.length && <p className="empty">No clear patterns yet. They appear once there are 30+ days of overlapping data and a meaningful relationship (|ρ| ≥ 0.3).</p>}
        <div className="grid-2">
          {patterns?.patterns.map((p) => (
            <div key={p.driver + p.outcome} className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0 }}>{p.text}</p>
              <Scatter points={p.points} ariaLabel={`Scatter plot: ${p.text}`} color={(p.rho < 0) === (p.outcome === 'rhr') ? 'var(--good)' : 'var(--worse)'} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
