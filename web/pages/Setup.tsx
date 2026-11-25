import { useApi, postApi, useInvalidateAll } from '../api';
import { Card } from '../components/Card';

export interface SetupData { stravaConfigured: boolean; stravaConnected: boolean; haeFolder: string | null; haeFilesSeen: number; backfillRemaining: number; backfillDone: boolean; daysOfData: number }

function Step({ done, optional, title, children }: { done: boolean; optional?: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none',
        background: done ? 'var(--good)' : 'var(--track)', color: done ? 'var(--bg)' : 'var(--text-3)', fontWeight: 700 }}>{done ? '✓' : optional ? '–' : '·'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
        <span style={{ position: 'absolute', left: -9999 }}>{done ? '(done)' : optional ? '(optional)' : '(to do)'}</span>
        <div className="small muted-2" style={{ marginTop: 4 }}>{children}</div>
      </div>
    </div>
  );
}

export function Setup() {
  const { data } = useApi<SetupData>('/api/setup', { refetchMs: 10000 });
  const invalidate = useInvalidateAll();
  if (!data) return <p className="empty">Loading…</p>;
  return (
    <>
      <div>
        <p className="eyebrow">Welcome</p>
        <h1 className="headline">Let’s connect your data</h1>
        <p className="lede">Your Apple Watch data arrives through the Health Auto Export app on your iPhone. Everything stays on this Mac.</p>
      </div>
      <Card title="Setup checklist">
        <Step done={data.haeFilesSeen > 0} title="1. Set up Health Auto Export on your iPhone">
          In Health Auto Export (Premium), create the three iCloud Drive automations described in the README (Health Metrics, Sleep, Workouts), then run a one-off export of your full history.
          {data.haeFolder ? <> Watching <code>{data.haeFolder}</code>.</> : ' The Health Auto Export iCloud folder hasn’t appeared on this Mac yet — check iCloud Drive is on for both your iPhone and Mac.'}
          {data.haeFilesSeen > 0 && <> {data.haeFilesSeen} files imported.</>}
        </Step>
        <Step done={data.daysOfData > 0} title="2. First sync">
          New files are picked up within about 5 minutes, or sync now:
          <div><button type="button" className="btn" style={{ marginTop: 6 }} onClick={async () => { await postApi('/api/sync/run').catch(() => undefined); setTimeout(invalidate, 3000); }}>Sync now</button></div>
        </Step>
        <Step done={false} optional title="3. Add your shoes">
          Optional: add your running shoes in Settings to track their mileage.
        </Step>
        <Step done={data.stravaConnected} optional title="4. Strava (optional)">
          Not needed — your workouts, routes and heart rate all come from your Apple Watch. Strava only adds your activity names, segments and its own shoe/bike mileage.
          {data.stravaConfigured && !data.stravaConnected && <div><a className="btn" href="/auth/strava/start" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>Connect Strava</a></div>}
          {data.stravaConnected && !data.backfillDone && <p style={{ margin: '6px 0 0' }}>Importing your Strava history… {data.backfillRemaining} activities queued.</p>}
        </Step>
      </Card>
    </>
  );
}
