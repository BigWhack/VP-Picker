import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { RecoveryRing } from '../components/RecoveryRing';
import { RangeBar } from '../components/RangeBar';
import { Hypnogram, type Seg } from '../components/Hypnogram';
import { StageCompare } from '../components/StageCompare';
import { SleepWindow } from '../components/SleepWindow';
import { BandTrend } from '../components/BandTrend';
import { CompareTable, type CompareRow } from '../components/CompareTable';
import { fmtDuration, fmtKm, fmtPace, fmtClock } from '../../shared/format';
import type { Series } from '../../shared/types';

type Stages = { deep: number; core: number; rem: number; awake: number };
export interface TodayData {
  date: string; tz: string; headline: string; detail: string;
  recovery: { score: number | null; band: 'well' | 'moderate' | 'low' | null };
  recoveryDelta: number | null;
  vsNormal: { key: string; label: string; unit: string; value: number | null; low: number | null; high: number | null; calibrating: boolean }[];
  lastNight: null | { bedtime: string; wake: string; asleepMin: number; efficiency: number; stages: Stages; stageAvg: Stages; segments: Seg[] };
  sleepWindow: { date: string; bedtime: string; wake: string }[];
  usualBedtime: string | null;
  trends: { hrv: Series; rhr: Series };
  weekCompare: CompareRow[];
  lastWorkout: null | { id: string; name: string; sport: string; start: string; distanceM: number | null; durationS: number; avgHr: number | null };
  flags: { kind: string; severity: string; text: string }[];
}

const BAND_WORD: Record<string, string> = { well: 'well recovered', moderate: 'moderately recovered', low: 'Recovery is low' };

function Headline({ text, band }: { text: string; band: string | null }) {
  const word = band ? BAND_WORD[band] : null;
  if (!word || !text.includes(word)) return <h1 className="headline">{text}</h1>;
  const [a, b] = text.split(word);
  return <h1 className="headline">{a}<span className={band === 'low' ? 'worse-text' : 'good'} style={band === 'moderate' ? { color: '#C8E06B' } : undefined}>{word}</span>{b}</h1>;
}

const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });

export function Today() {
  const { data, isLoading, error } = useApi<TodayData>('/api/today', { refetchMs: 5 * 60000 });
  if (isLoading) return <p className="empty">Loading…</p>;
  if (error || !data) return <p className="empty">Couldn’t load today’s data. Is the server running?</p>;
  const longDate = new Date(`${data.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const n = data.lastNight;
  const lw = data.lastWorkout;
  const hrvToday = data.trends.hrv.points.at(-1)?.value ?? null;
  const rhrToday = data.trends.rhr.points.at(-1)?.value ?? null;
  return (
    <>
      <section className="hero">
        <div className="text">
          <p className="eyebrow">{longDate}</p>
          <Headline text={data.headline} band={data.recovery.band} />
          {data.detail && <p className="lede">{data.detail}</p>}
        </div>
        <div className="ring"><RecoveryRing score={data.recovery.score} band={data.recovery.band} delta={data.recoveryDelta} /></div>
      </section>

      {data.flags.length > 0 && (
        <section aria-label="Flags" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.flags.map((f) => <div key={f.kind} className={`flag ${f.severity}`}>{f.text}</div>)}
        </section>
      )}

      <Card title="Today vs your normal" aside="Shaded = your usual range, last 30 days">
        <div className="grid-auto">
          {data.vsNormal.map((v) => (
            <RangeBar key={v.key} label={v.label} value={v.value} unit={v.unit} low={v.low} high={v.high} calibrating={v.calibrating}
              display={v.key === 'sleep' ? fmtDuration : undefined} />
          ))}
        </div>
      </Card>

      {(n || data.sleepWindow.length > 0) && (
        <div className="grid-2">
          {n && (
            <Card title="Last night" aside={`${hm(n.bedtime, data.tz)} → ${hm(n.wake, data.tz)} · ${Math.round(n.efficiency * 100)}% efficient`}>
              <p className="big">{fmtDuration(n.asleepMin)}</p>
              <Hypnogram segments={n.segments} start={n.bedtime} end={n.wake} tz={data.tz} />
              <div className="divider" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="small muted" style={{ margin: 0 }}>Stages vs your 30-night average (thin bar)</p>
                <StageCompare stages={n.stages} avg={n.stageAvg} />
              </div>
              <Link to="/sleep" className="small">Sleep details →</Link>
            </Card>
          )}
          {data.sleepWindow.length > 0 && (
            <Card title={`Sleep window · ${data.sleepWindow.length} nights`} aside="Bedtime to wake">
              <SleepWindow nights={data.sleepWindow} usualBedtime={data.usualBedtime} />
              {data.usualBedtime && <p className="small muted-2 divider" style={{ margin: 0 }}>Dashed line is your usual bedtime ({data.usualBedtime}).</p>}
            </Card>
          )}
        </div>
      )}

      <div className="grid-2">
        <Card title="HRV · 14 days" aside={hrvToday !== null ? <strong>{Math.round(hrvToday)} ms</strong> : undefined}>
          <BandTrend series={data.trends.hrv} color="var(--good)" label="HRV" unit="ms" />
        </Card>
        <Card title="Resting HR · 14 days" aside={rhrToday !== null ? <strong>{Math.round(rhrToday)} bpm</strong> : undefined}>
          <BandTrend series={data.trends.rhr} color="var(--heart)" label="Resting heart rate" unit="bpm" />
        </Card>
      </div>

      <Card title="This week vs last week" aside="Mon–today vs the same days last week">
        <CompareTable rows={data.weekCompare} />
      </Card>

      {lw && (
        <Link to={`/workouts/${encodeURIComponent(lw.id)}`} className="card" style={{ textDecoration: 'none', color: 'inherit', flexDirection: 'row', flexWrap: 'wrap', gap: '8px 28px', alignItems: 'center' }}>
          <span style={{ flex: '1 1 200px' }}>
            <span className="tiny muted" style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last workout</span>
            <strong>{lw.name} · {new Date(lw.start).toLocaleDateString('en-GB', { weekday: 'short', timeZone: data.tz })}</strong>
          </span>
          {lw.distanceM ? <span><strong>{fmtKm(lw.distanceM)}</strong></span> : null}
          <span>{fmtClock(lw.durationS)}</span>
          {lw.distanceM && lw.sport === 'run' ? <span>{fmtPace(lw.durationS / (lw.distanceM / 1000))}</span> : null}
          {lw.avgHr ? <span>{Math.round(lw.avgHr)} bpm</span> : null}
          <span className="muted">Breakdown →</span>
        </Link>
      )}
    </>
  );
}
