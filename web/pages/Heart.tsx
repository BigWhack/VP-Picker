import { useState } from 'react';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { BandTrend } from '../components/BandTrend';
import { RangeTabs, type RangeKey } from '../components/RangeTabs';
import type { Series } from '../../shared/types';

interface HeartData {
  series: Record<'rhr' | 'hrv' | 'walkHr' | 'hrRecovery' | 'vo2max' | 'lowestHr', Series>;
  latest: { rhr: number | null; hrv: number | null; vo2max: number | null };
  vo2Category: string | null;
  flagEpisodes: { kind: string; from: string; to: string; text: string }[];
}

const CARDS: { key: keyof HeartData['series']; title: string; unit: string; color: string; note: string }[] = [
  { key: 'rhr', title: 'Resting heart rate', unit: 'bpm', color: 'var(--heart)', note: 'Lower usually means better aerobic fitness and recovery.' },
  { key: 'hrv', title: 'Heart rate variability', unit: 'ms', color: 'var(--good)', note: 'Overnight SDNN. Higher than your usual suggests you are well recovered.' },
  { key: 'vo2max', title: 'VO₂ max (cardio fitness)', unit: 'ml/kg/min', color: 'var(--core)', note: 'Estimated by your watch during outdoor walks and runs.' },
  { key: 'walkHr', title: 'Walking heart rate', unit: 'bpm', color: 'var(--heart)', note: 'Average while walking. Falls as fitness improves.' },
  { key: 'lowestHr', title: 'Lowest overnight heart rate', unit: 'bpm', color: 'var(--rem)', note: 'Minimum while asleep.' },
  { key: 'hrRecovery', title: 'Heart-rate recovery', unit: 'bpm', color: 'var(--good)', note: 'Drop in the minute after a workout. Bigger is better.' },
];

const last = (s: Series) => [...s.points].reverse().find((p) => p.value !== null)?.value ?? null;

export function Heart() {
  const [range, setRange] = useState<RangeKey>('90d');
  const { data } = useApi<HeartData>(`/api/heart?range=${range}`);
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="headline">Heart</h1>
        <RangeTabs value={range} onChange={setRange} />
      </div>
      {data && (
        <>
          <div className="tiles">
            {data.latest.rhr !== null && <div className="tile"><p className="label">Resting HR</p><p className="value">{Math.round(data.latest.rhr)} bpm</p></div>}
            {data.latest.hrv !== null && <div className="tile"><p className="label">HRV</p><p className="value">{Math.round(data.latest.hrv)} ms</p></div>}
            {data.latest.vo2max !== null && <div className="tile"><p className="label">VO₂ max</p><p className="value">{data.latest.vo2max.toFixed(1)}</p><p className="sub">{data.vo2Category ?? 'Add your date of birth and sex in Settings to see your category'}</p></div>}
          </div>
          <div className="grid-2">
            {CARDS.filter((c) => data.series[c.key].points.some((p) => p.value !== null)).map((c) => {
              const v = last(data.series[c.key]);
              return (
                <Card key={c.key} title={c.title} aside={v !== null ? <strong>{c.key === 'vo2max' ? v.toFixed(1) : Math.round(v)} {c.unit}</strong> : undefined}>
                  <BandTrend series={data.series[c.key]} color={c.color} label={c.title} unit={c.unit} height={140} />
                  <p className="small muted" style={{ margin: 0 }}>{c.note}</p>
                </Card>
              );
            })}
          </div>
          <Card title="Heart flags in this period">
            {data.flagEpisodes.length === 0 && <p className="empty">Nothing unusual — no elevated resting heart rate, low HRV or raised breathing rate.</p>}
            {data.flagEpisodes.map((f) => {
              const d = (x: string) => new Date(`${x}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
              return <div key={f.from + f.kind} className="list-row"><span className="small muted" style={{ flex: '0 0 130px' }}>{f.from === f.to ? d(f.from) : `${d(f.from)} – ${d(f.to)}`}</span><span style={{ flex: '1 1 300px' }}>{f.text}</span></div>;
            })}
          </Card>
        </>
      )}
    </>
  );
}
