import { useState } from 'react';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { BarChart } from '../components/BarChart';
import { CalendarHeatmap } from '../components/CalendarHeatmap';
import { CompareTable, type CompareRow } from '../components/CompareTable';
import { RangeTabs, type RangeKey } from '../components/RangeTabs';

interface Day { date: string; steps: number | null; activeKcal: number | null; exerciseMin: number | null; standHours: number | null; flights: number | null; distanceM: number | null }
interface ActivityData {
  days: Day[]; goals: { steps: number; activeKcal: number; exerciseMin: number; standHours: number };
  weekCompare: CompareRow[]; monthTotals: { month: string; steps: number; activeKcal: number; exerciseMin: number; trainingMin: number; days: number }[];
}

const RINGS = [
  { key: 'activeKcal', goal: 'activeKcal', label: 'Move', unit: 'kcal', color: '#FF8FA3' },
  { key: 'exerciseMin', goal: 'exerciseMin', label: 'Exercise', unit: 'min', color: '#C8E06B' },
  { key: 'standHours', goal: 'standHours', label: 'Stand', unit: 'h', color: '#5BC8F5' },
  { key: 'steps', goal: 'steps', label: 'Steps', unit: '', color: '#3DDC97' },
] as const;

function Progress({ label, value, goal, unit, color }: { label: string; value: number | null; goal: number; unit: string; color: string }) {
  const pct = value === null ? 0 : Math.min(1, value / goal);
  return (
    <div className="tile">
      <p className="label">{label}</p>
      <p className="value">{value === null ? '—' : Math.round(value).toLocaleString('en-GB')}<span className="small muted"> / {goal.toLocaleString('en-GB')} {unit}</span></p>
      <div style={{ height: 8, background: 'var(--track)', borderRadius: 999, marginTop: 8 }} role="img" aria-label={`${label} ${Math.round(pct * 100)}% of goal`}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}

export function Activity() {
  const [range, setRange] = useState<RangeKey>('30d');
  const { data } = useApi<ActivityData>(`/api/activity?range=${range}`);
  const year = useApi<ActivityData>('/api/activity?range=1y').data;
  if (!data) return <p className="empty">Loading…</p>;
  const today = data.days.at(-1)!; const yesterday = data.days.at(-2);
  const short = data.days.length <= 31;
  const lbl = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="headline">Activity</h1>
        <RangeTabs value={range} onChange={setRange} />
      </div>
      <div>
        <p className="eyebrow" style={{ marginBottom: 10 }}>Today so far</p>
        <div className="tiles">{RINGS.map((r) => <Progress key={r.key} label={r.label} value={today[r.key]} goal={data.goals[r.goal]} unit={r.unit} color={r.color} />)}</div>
      </div>
      {yesterday && (
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>Yesterday</p>
          <div className="tiles">{RINGS.map((r) => <Progress key={r.key} label={r.label} value={yesterday[r.key]} goal={data.goals[r.goal]} unit={r.unit} color={r.color} />)}</div>
        </div>
      )}
      <div className="grid-2">
        {RINGS.map((r) => (
          <Card key={r.key} title={`${r.label} per day`} aside={`Dashed = goal ${data.goals[r.goal].toLocaleString('en-GB')}`}>
            <BarChart goal={data.goals[r.goal]} ariaLabel={`${r.label} per day against your goal`} format={(v) => `${Math.round(v)} ${r.unit}`}
              bars={(short ? data.days : weekly(data.days, r.key)).map((d) => ({ label: lbl(d.date), segments: [{ name: r.key, value: d[r.key] ?? 0, color: r.color }],
                highlight: (d[r.key] ?? 0) >= data.goals[r.goal] ? true : false }))} />
            {!short && <p className="tiny muted" style={{ margin: 0 }}>Weekly daily averages</p>}
          </Card>
        ))}
      </div>
      <Card title="This week vs last week" aside="Daily averages, Mon–today vs the same days last week">
        <CompareTable rows={data.weekCompare} />
      </Card>
      {year && (
        <Card title="Steps · last 12 months" aside="Darker = more steps">
          <CalendarHeatmap days={year.days.map((d) => ({ date: d.date, value: d.steps ?? 0 }))} label="Steps per day over the last year" unit="steps" />
        </Card>
      )}
    </>
  );
}

function weekly(days: Day[], key: 'steps' | 'activeKcal' | 'exerciseMin' | 'standHours'): Day[] {
  const out: Day[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7); const vals = chunk.map((d) => d[key]).filter((v): v is number => v !== null);
    out.push({ ...chunk[0], [key]: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null });
  }
  return out;
}
