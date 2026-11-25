import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { BarChart } from '../components/BarChart';
import { CalendarHeatmap } from '../components/CalendarHeatmap';
import { fmtClock, fmtKm, fmtPace } from '../../shared/format';
import { SPORT_COLOR, SPORT_LABEL } from '../sport';

interface ListData {
  items: { id: string; name: string; sport: string; start: string; distanceM: number | null; durationS: number; avgHr: number | null; load: number | null }[];
  total: number; page: number; pageSize: number;
  weekly: { week: string; bySport: Record<string, number> }[];
  calendar: { date: string; minutes: number }[];
}

const SPORTS = ['', 'run', 'ride', 'walk', 'hike', 'strength', 'hiit', 'swim', 'other'];

export function Workouts() {
  const [sport, setSport] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), ...(sport ? { sport } : {}), ...(q ? { q } : {}) });
  const { data, isLoading } = useApi<ListData>(`/api/workouts?${params}`);
  const sportsInWeeks = data ? [...new Set(data.weekly.flatMap((w) => Object.keys(w.bySport)))] : [];
  return (
    <>
      <h1 className="headline">Workouts</h1>
      {data && (
        <div className="grid-2">
          <Card title="Weekly training time · 12 weeks" aside={<span>{sportsInWeeks.map((s) => <span key={s} style={{ marginLeft: 10 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: SPORT_COLOR[s], marginRight: 4 }} />{SPORT_LABEL[s]}</span>)}</span>}>
            <BarChart ariaLabel="Training minutes per week by sport for the last 12 weeks" format={(v) => `${Math.round(v)} min`}
              bars={data.weekly.map((w, i) => ({ label: new Date(`${w.week}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
                highlight: i === data.weekly.length - 1 ? true : undefined,
                segments: Object.entries(w.bySport).map(([s, v]) => ({ name: s, value: v, color: SPORT_COLOR[s] ?? '#9AA4B2' })) }))} />
          </Card>
          <Card title="Training calendar · 12 months" aside="Darker = more minutes">
            <CalendarHeatmap days={data.calendar.map((d) => ({ date: d.date, value: d.minutes }))} label="Minutes trained per day over the last year" unit="min" />
          </Card>
        </div>
      )}
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="tabs" role="group" aria-label="Filter by sport">
            {SPORTS.map((s) => <button key={s || 'all'} type="button" className={sport === s ? 'on' : ''} onClick={() => { setSport(s); setPage(1); }}>{s ? SPORT_LABEL[s] : 'All'}</button>)}
          </div>
          <label className="field" style={{ minWidth: 200 }}><span className="sr-only" style={{ position: 'absolute', left: -9999 }}>Search</span>
            <input type="search" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search workouts by name" />
          </label>
        </div>
        {isLoading && <p className="empty">Loading…</p>}
        {data && data.items.length === 0 && <p className="empty">No workouts yet. They’ll appear after your first sync.</p>}
        <div>
          {data?.items.map((w) => (
            <Link key={w.id} to={`/workouts/${encodeURIComponent(w.id)}`} className="list-row">
              <span style={{ flex: '1 1 220px' }}>
                <strong style={{ display: 'block' }}>{w.name}</strong>
                <span className="small muted"><span style={{ color: SPORT_COLOR[w.sport] }}>●</span> {SPORT_LABEL[w.sport]} · {new Date(w.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              </span>
              <span style={{ flex: '0 0 90px' }}><strong>{w.distanceM ? fmtKm(w.distanceM) : '—'}</strong></span>
              <span style={{ flex: '0 0 80px' }}>{fmtClock(w.durationS)}</span>
              <span style={{ flex: '0 0 100px' }}>{w.distanceM && w.sport === 'run' ? fmtPace(w.durationS / (w.distanceM / 1000)) : w.distanceM && w.sport === 'ride' ? `${((w.distanceM / 1000) / (w.durationS / 3600)).toFixed(1)} km/h` : ''}</span>
              <span style={{ flex: '0 0 80px' }}>{w.avgHr ? `${Math.round(w.avgHr)} bpm` : ''}</span>
              <span style={{ flex: '0 0 70px' }} className="muted small">{w.load !== null ? `Load ${Math.round(w.load)}` : ''}</span>
            </Link>
          ))}
        </div>
        {data && data.total > data.pageSize && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
            <span className="small muted">Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
            <button type="button" className="btn" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Older</button>
          </div>
        )}
      </Card>
    </>
  );
}
