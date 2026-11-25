import { useState } from 'react';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { Hypnogram, type Seg } from '../components/Hypnogram';
import { StageCompare } from '../components/StageCompare';
import { SleepWindow } from '../components/SleepWindow';
import { BarChart } from '../components/BarChart';
import { fmtDuration } from '../../shared/format';

type Stages = { deep: number; core: number; rem: number; awake: number };
interface SleepData {
  date: string; tz: string; needMin: number; debtMin: number; regularitySdMin: number | null; avgAsleepMin: number | null; stageAvg: Stages;
  night: null | { bedtime: string; wake: string; asleepMin: number; inBedMin: number; efficiency: number; awakenings: number; stages: Stages; segments: Seg[];
    score: number | null; scoreComponents: Record<string, number> | null; overnight: { lowestHr: number | null; avgResp: number | null; hrv: number | null } };
  naps: { bedtime: string; wake: string; asleepMin: number }[];
  history: { date: string; asleepMin: number | null; score: number | null; deepMin: number | null; remMin: number | null; coreMin: number | null }[];
  window: { date: string; bedtime: string; wake: string }[];
}

const COMPONENT_MAX: Record<string, number> = { duration: 50, efficiency: 15, restorative: 20, regularity: 15 };
const COMPONENT_LABEL: Record<string, string> = { duration: 'Duration vs need', efficiency: 'Efficiency', restorative: 'Deep + REM share', regularity: 'Bedtime regularity' };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="tile"><p className="label">{label}</p><p className="value">{value}</p>{sub && <p className="sub">{sub}</p>}</div>;
}

export function Sleep() {
  const [date, setDate] = useState<string | null>(null);
  const { data, isLoading } = useApi<SleepData>(`/api/sleep${date ? `?date=${date}` : ''}`);
  if (isLoading || !data) return <p className="empty">Loading…</p>;
  const n = data.night;
  const today = new Date().toISOString().slice(0, 10);
  const label = new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: data.tz });
  const regularityWord = data.regularitySdMin === null ? null : data.regularitySdMin <= 20 ? 'Very regular' : data.regularitySdMin <= 40 ? 'Fairly regular' : 'Irregular';
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p className="eyebrow">Night ending {label}</p>
          <h1 className="headline">{n ? <>Slept {fmtDuration(n.asleepMin)}{n.score !== null && <span className="muted-2" style={{ fontSize: '0.6em' }}> · score {n.score}</span>}</> : 'No sleep recorded'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => setDate(addDays(data.date, -1))}>← Previous night</button>
          <button type="button" className="btn" disabled={data.date >= today} onClick={() => setDate(addDays(data.date, 1))}>Next night →</button>
        </div>
      </div>

      {n && (
        <div className="grid-2">
          <Card title="Stages through the night" aside={`${hm(n.bedtime)} → ${hm(n.wake)}`}>
            <Hypnogram segments={n.segments} start={n.bedtime} end={n.wake} tz={data.tz} />
            <div className="divider" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="small muted" style={{ margin: 0 }}>Compared with your 30-night average (thin bar)</p>
              <StageCompare stages={n.stages} avg={data.stageAvg} />
            </div>
          </Card>
          {n.scoreComponents && (
            <Card title="Sleep score" aside={`${n.score}/100`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(n.scoreComponents).map(([k, v]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 60px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                    <span className="muted-2">{COMPONENT_LABEL[k] ?? k}</span>
                    <div style={{ height: 10, background: 'var(--track)', borderRadius: 999 }}><div style={{ width: `${(v / COMPONENT_MAX[k]) * 100}%`, height: '100%', background: 'var(--core)', borderRadius: 999 }} /></div>
                    <span><strong>{Math.round(v)}</strong> <span className="muted">/ {COMPONENT_MAX[k]}</span></span>
                  </div>
                ))}
              </div>
              <p className="small muted divider" style={{ margin: 0 }}>Duration compares against your sleep need of {fmtDuration(data.needMin)} (change it in Settings).</p>
            </Card>
          )}
        </div>
      )}

      <div className="tiles">
        {n && <Tile label="Time in bed" value={fmtDuration(n.inBedMin)} sub={`${Math.round(n.efficiency * 100)}% efficient · ${n.awakenings} awakenings`} />}
        <Tile label="Sleep debt · 14 nights" value={fmtDuration(data.debtMin)} sub={data.debtMin > 300 ? 'Worth a few earlier nights' : 'Under control'} />
        {data.regularitySdMin !== null && <Tile label="Bedtime regularity" value={`±${Math.round(data.regularitySdMin)} min`} sub={regularityWord ?? undefined} />}
        {data.avgAsleepMin !== null && <Tile label="30-night average" value={fmtDuration(data.avgAsleepMin)} sub={`Need ${fmtDuration(data.needMin)}`} />}
        {n?.overnight.lowestHr ? <Tile label="Lowest heart rate" value={`${Math.round(n.overnight.lowestHr)} bpm`} /> : null}
        {n?.overnight.avgResp ? <Tile label="Breathing rate" value={`${n.overnight.avgResp.toFixed(1)} /min`} /> : null}
        {n?.overnight.hrv ? <Tile label="Overnight HRV" value={`${Math.round(n.overnight.hrv)} ms`} /> : null}
      </div>

      <Card title="Duration vs need · 30 nights" aside={<span><span style={{ color: 'var(--deep)' }}>■</span> Deep <span style={{ color: 'var(--core)' }}>■</span> Core <span style={{ color: 'var(--rem)' }}>■</span> REM · dashed = need</span>}>
        <BarChart goal={data.needMin} format={fmtDuration} ariaLabel="Minutes asleep each night for 30 nights, split by stage, against your sleep need"
          bars={data.history.map((h) => ({ label: new Date(`${h.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
            segments: [{ name: 'deep', value: h.deepMin ?? 0, color: 'var(--deep)' }, { name: 'core', value: (h.coreMin ?? 0) + Math.max(0, (h.asleepMin ?? 0) - (h.deepMin ?? 0) - (h.coreMin ?? 0) - (h.remMin ?? 0)), color: 'var(--core)' }, { name: 'rem', value: h.remMin ?? 0, color: 'var(--rem)' }] }))} />
      </Card>

      {data.window.length > 0 && (
        <Card title={`Sleep window · ${data.window.length} nights`} aside="Bedtime to wake">
          <SleepWindow nights={data.window} usualBedtime={null} height={260} />
        </Card>
      )}

      {data.naps.length > 0 && (
        <Card title="Naps">
          {data.naps.map((p) => <div key={p.bedtime} className="list-row"><span>{hm(p.bedtime)} → {hm(p.wake)}</span><strong>{fmtDuration(p.asleepMin)}</strong></div>)}
        </Card>
      )}
    </>
  );
}
