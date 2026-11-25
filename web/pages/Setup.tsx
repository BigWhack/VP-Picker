import { useApi, postApi, useInvalidateAll } from '../api';
import { Card } from '../components/Card';

export interface SetupData { stravaConfigured: boolean; stravaConnected: boolean; haeFolder: string | null; haeFilesSeen: number; backfillRemaining: number; backfillDone: boolean; daysOfData: number }

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="list-row" style={{ alignItems: 'flex-start' }}>
      <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none',
        background: done ? 'var(--good)' : 'var(--track)', color: done ? 'var(--bg)' : 'var(--text-3)', fontWeight: 700 }}>{done ? '✓' : '·'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{title}</strong> <span className="sr-only" style={{ position: 'absolute', left: -9999 }}>{done ? '(done)' : '(to do)'}</span>
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
        <p className="lede">Your dashboard fills in as soon as data arrives. Everything stays on this Mac.</p>
      </div>
      <Card title="Setup checklist">
        <Step done={data.stravaConfigured} title="1. Add your Strava API key">
          Create an app at strava.com/settings/api with <em>Authorization Callback Domain</em> set to <code>localhost</code>, then run <code>npm run setup</code> and restart.
        </Step>
        <Step done={data.stravaConnected} title="2. Connect Strava">
          {data.stravaConfigured ? <a className="btn primary" href="/auth/strava/start" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>Connect Strava</a> : 'Available after step 1.'}
          {data.stravaConnected && !data.backfillDone && <p style={{ margin: '6px 0 0' }}>Importing your history… {data.backfillRemaining} activities queued.</p>}
        </Step>
        <Step done={data.haeFilesSeen > 0} title="3. Set up Health Auto Export on your iPhone">
          In Health Auto Export (Premium), create the three iCloud Drive automations described in the README (Health Metrics, Sleep, Workouts), then run a one-off export of your full history.
          {data.haeFolder ? <> Watching <code>{data.haeFolder}</code>.</> : ' The Health Auto Export iCloud folder hasn’t appeared on this Mac yet.'}
          {data.haeFilesSeen > 0 && <> {data.haeFilesSeen} files imported.</>}
        </Step>
        <Step done={data.daysOfData > 0} title="4. First sync">
          <button type="button" className="btn" style={{ marginTop: 6 }} onClick={async () => { await postApi('/api/sync/run').catch(() => undefined); setTimeout(invalidate, 3000); }}>Sync now</button>
        </Step>
      </Card>
    </>
  );
}
