export interface WindowNight { date: string; bedtime: string; wake: string }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** Minutes after 20:00, so a 20:00 → 10:00 axis is linear across midnight. */
const axis = (hhmm: string) => (toMin(hhmm) - 20 * 60 + 1440) % 1440;
const SPAN = 14 * 60;
const pct = (hhmm: string) => (Math.min(SPAN, axis(hhmm)) / SPAN) * 100;

export function SleepWindow({ nights, usualBedtime, height = 220 }: { nights: WindowNight[]; usualBedtime: string | null; height?: number }) {
  const labels = ['20:00', '22:00', '00:00', '02:00', '04:00', '06:00', '08:00', '10:00'];
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const cols = `repeat(${nights.length}, minmax(0, 1fr))`;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ position: 'relative', width: 40, flex: 'none', height }} className="tiny muted" aria-hidden="true">
          {labels.map((l, i) => <span key={l} style={{ position: 'absolute', top: `calc(${(i / 7) * 100}% - 7px)` }}>{l}</span>)}
        </div>
        <div role="img" aria-label={`Bedtime and wake time for the last ${nights.length} nights`}
          style={{ flex: 1, minWidth: 0, position: 'relative', height, display: 'grid', gridTemplateColumns: cols, gap: nights.length > 10 ? 3 : 10 }}>
          {usualBedtime && <div style={{ position: 'absolute', left: 0, right: 0, top: `${pct(usualBedtime)}%`, borderTop: '1px dashed var(--dash)' }} />}
          {nights.map((n, i) => {
            const top = pct(n.bedtime); const bottom = pct(n.wake);
            return (
              <div key={n.date} style={{ position: 'relative' }} title={`${n.bedtime} → ${n.wake}`}>
                <div style={{ position: 'absolute', left: '20%', right: '20%', top: `${top}%`, height: `${Math.max(2, bottom - top)}%`,
                  background: i === nights.length - 1 ? 'var(--core)' : 'var(--window)', borderRadius: 6 }} />
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `50px ${cols}`, gap: 10, textAlign: 'center', marginTop: 6 }} className="tiny muted">
        <span />
        {nights.map((n, i) => <span key={n.date} style={i === nights.length - 1 ? { color: 'var(--text)', fontWeight: 600 } : undefined}>{nights.length > 10 ? (i % 5 === 0 || i === nights.length - 1 ? new Date(`${n.date}T12:00:00Z`).getUTCDate() : '') : day(n.date)}</span>)}
      </div>
    </div>
  );
}
