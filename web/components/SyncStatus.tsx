import { useState } from 'react';
import { postApi, useApi, useInvalidateAll } from '../api';

interface Status {
  lastRun: string | null; nextRun: string | null; running: boolean; lastStatus: string | null;
  sources: { hae: { lastDataAt: string | null; stale: boolean }; strava: { connected: boolean } };
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => { const h = Math.round((Date.now() - Date.parse(iso)) / 3600000); return h < 1 ? 'under an hour' : h < 48 ? `${h}h` : `${Math.round(h / 24)} days`; };

export function SyncStatus() {
  const { data } = useApi<Status>('/api/sync/status', { refetchMs: 30000 });
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateAll();
  const sync = async () => {
    setBusy(true);
    await postApi('/api/sync/run').catch(() => undefined);
    setTimeout(() => { invalidate(); setBusy(false); }, 4000);
  };
  return (
    <div className="sync">
      {data?.lastRun ? <span>Synced {hhmm(data.lastRun)}{data.nextRun ? ` · next ${hhmm(data.nextRun)}` : ''}</span> : <span>Not synced yet</span>}
      {data?.sources.hae.lastDataAt && data.sources.hae.stale && <span className="stale">Apple Health data is {ago(data.sources.hae.lastDataAt)} old</span>}
      <button type="button" className="btn" onClick={sync} disabled={busy || data?.running}>{busy || data?.running ? 'Syncing…' : 'Sync now'}</button>
    </div>
  );
}
