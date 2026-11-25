import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, postApi, useInvalidateAll } from '../api';
import { Card } from '../components/Card';
import type { SetupData } from './Setup';

interface SettingsResp {
  settings: { tz: string; dob?: string; sex?: 'male' | 'female'; hrMax?: number; hrRestOverride?: number; sleepNeedMin: number;
    goals: { steps: number; activeKcal: number; exerciseMin: number; standHours: number }; ftp?: number; zoneModel: 'hrr' | 'pctMax'; units: 'metric' | 'imperial';
    haeFolder?: string; lanMode: boolean; hasPasscode: boolean; ingestToken: string | null };
  discoveredHaeFolder: string | null;
  imports: { source: string; path: string; status: string; error: string | null; receivedAt: string }[];
  config: { recoveryWeights: Record<string, number>; bands: { well: number; moderate: number } };
}

const STRAVA_MSG: Record<string, string> = { connected: 'Strava connected. Importing your history in the background.', 'missing-scope': 'Strava needs permission to read all activities — please tick every box when connecting.', denied: 'Strava connection was cancelled.' };
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function Settings() {
  const { data } = useApi<SettingsResp>('/api/settings');
  const setup = useApi<SetupData>('/api/setup', { refetchMs: 15000 }).data;
  const invalidate = useInvalidateAll();
  const [params] = useSearchParams();
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setForm({ ...data.settings, sleepNeedHours: (data.settings.sleepNeedMin / 60).toString() }); }, [data]);
  if (!data) return <p className="empty">Loading…</p>;
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const goals = (form.goals ?? data.settings.goals) as SettingsResp['settings']['goals'];
  const stravaMsg = params.get('strava');

  const save = async () => {
    setErrors({}); setMsg(null);
    const payload = {
      tz: form.tz, dob: form.dob || null, sex: form.sex || null, hrMax: numOrNull(String(form.hrMax ?? '')), hrRestOverride: numOrNull(String(form.hrRestOverride ?? '')),
      sleepNeedMin: Math.round(Number(form.sleepNeedHours) * 60), goals, ftp: numOrNull(String(form.ftp ?? '')), zoneModel: form.zoneModel, units: form.units, haeFolder: form.haeFolder || null,
    };
    try { await postApi('/api/settings', payload, 'PUT'); setMsg('Saved. Scores are being recalculated.'); invalidate(); }
    catch (e) { setErrors(((e as { data?: { fields?: Record<string, string> } }).data?.fields) ?? {}); setMsg('Please fix the highlighted fields.'); }
  };
  const field = (k: string, label: string, input: React.ReactNode) => (
    <label className="field">{label}{input}{errors[k] && <span className="worse-text small">{errors[k]}</span>}</label>
  );
  return (
    <>
      <h1 className="headline">Settings</h1>
      {stravaMsg && <div className={`flag ${stravaMsg === 'connected' ? 'info' : ''}`}>{STRAVA_MSG[stravaMsg] ?? `Strava: ${stravaMsg}`}</div>}

      <Card title="Data sources">
        <div className="list-row"><span style={{ flex: '1 1 260px' }}><strong>Apple Health (Health Auto Export)</strong><br /><span className="small muted">{setup?.haeFilesSeen ?? 0} files imported · watching {data.settings.haeFolder ?? data.discoveredHaeFolder ?? 'no folder found yet'}</span></span>
          <button type="button" className="btn" onClick={async () => { await postApi('/api/sync/run'); setTimeout(invalidate, 3000); }}>Sync now</button>
        </div>
        {field('haeFolder', 'Health Auto Export folder (leave blank to auto-detect)', <input value={String(form.haeFolder ?? '')} placeholder={data.discoveredHaeFolder ?? '~/Library/Mobile Documents/…/Documents'} onChange={(e) => set('haeFolder', e.target.value)} />)}
        <div className="list-row"><span style={{ flex: '1 1 260px' }}><strong>Strava</strong> <span className="pill">Optional</span><br /><span className="small muted">{setup?.stravaConnected ? `Connected${setup.backfillDone ? '' : ` · importing history (${setup.backfillRemaining} queued)`}` : 'Not used — workouts come from your Apple Watch. Strava would only add activity names and segments.'}</span></span>
          {setup?.stravaConnected
            ? <button type="button" className="btn" onClick={async () => { await postApi('/api/strava/disconnect'); invalidate(); }}>Disconnect</button>
            : setup?.stravaConfigured && <a className="btn primary" href="/auth/strava/start" style={{ textDecoration: 'none' }}>Connect Strava</a>}
        </div>
        {data.imports.length > 0 && (
          <details><summary className="small muted" style={{ cursor: 'pointer' }}>Recent imports</summary>
            {data.imports.map((i) => <div key={i.receivedAt + i.path} className="small" style={{ padding: '4px 0' }}><span className={i.status === 'ok' ? 'good-text' : 'worse-text'}>{i.status}</span> {new Date(i.receivedAt).toLocaleString('en-GB')} · {i.path.split('/').pop()}{i.error ? ` — ${i.error}` : ''}</div>)}
          </details>
        )}
      </Card>

      <Card title="Profile" aside="Used for heart-rate zones, training load and VO₂ max category">
        <div className="form-grid">
          {field('dob', 'Date of birth', <input type="date" value={String(form.dob ?? '')} onChange={(e) => set('dob', e.target.value)} />)}
          {field('sex', 'Sex (for physiology formulas)', <select value={String(form.sex ?? '')} onChange={(e) => set('sex', e.target.value)}><option value="">Not set</option><option value="male">Male</option><option value="female">Female</option></select>)}
          {field('hrMax', 'Max heart rate (blank = estimate)', <input inputMode="numeric" value={String(form.hrMax ?? '')} onChange={(e) => set('hrMax', e.target.value)} />)}
          {field('hrRestOverride', 'Resting heart rate (blank = from watch)', <input inputMode="numeric" value={String(form.hrRestOverride ?? '')} onChange={(e) => set('hrRestOverride', e.target.value)} />)}
          {field('ftp', 'Cycling FTP in watts (optional)', <input inputMode="numeric" value={String(form.ftp ?? '')} onChange={(e) => set('ftp', e.target.value)} />)}
          {field('zoneModel', 'Heart-rate zone model', <select value={String(form.zoneModel)} onChange={(e) => set('zoneModel', e.target.value)}><option value="hrr">Heart-rate reserve</option><option value="pctMax">% of max HR</option></select>)}
          {field('sleepNeedMin', 'Sleep need (hours)', <input inputMode="decimal" value={String(form.sleepNeedHours ?? '')} onChange={(e) => set('sleepNeedHours', e.target.value)} />)}
          {field('tz', 'Time zone', <input value={String(form.tz ?? '')} onChange={(e) => set('tz', e.target.value)} />)}
        </div>
      </Card>

      <Card title="Daily goals">
        <div className="form-grid">
          {(['steps', 'activeKcal', 'exerciseMin', 'standHours'] as const).map((k) => (
            <label key={k} className="field">{({ steps: 'Steps', activeKcal: 'Move (kcal)', exerciseMin: 'Exercise (min)', standHours: 'Stand hours' })[k]}
              <input inputMode="numeric" value={goals[k]} onChange={(e) => set('goals', { ...goals, [k]: Number(e.target.value) || 0 })} />
            </label>
          ))}
        </div>
        {errors.goals && <span className="worse-text small">{errors.goals}</span>}
      </Card>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn primary" onClick={save}>Save settings</button>
        {msg && <span className="small muted-2" role="status">{msg}</span>}
      </div>

      <ShoesCard />

      <LanCard lanMode={data.settings.lanMode} ingestToken={data.settings.ingestToken} onChange={invalidate} />

      <Card title="How the scores work">
        <p className="small muted-2" style={{ margin: 0 }}>
          <strong>Recovery (0–100)</strong> compares last night with your own last 30 days: HRV {data.config.recoveryWeights.hrv}%, resting heart rate {data.config.recoveryWeights.rhr}%, sleep vs need {data.config.recoveryWeights.sleep}%, breathing rate {data.config.recoveryWeights.resp}%, training form {data.config.recoveryWeights.form}%.
          {' '}{data.config.bands.well}+ is well recovered, {data.config.bands.moderate}–{data.config.bands.well - 1} moderate, below {data.config.bands.moderate} low.
          <br /><strong>Sleep score</strong>: duration vs need 50, efficiency 15, deep + REM share 20, bedtime regularity 15.
          <br /><strong>Training load</strong> is Banister TRIMP from heart rate; fitness is its 42-day average, fatigue its 7-day average, form = fitness − fatigue.
          <br />Every number needs 7 days of history before it is compared with your normal (“Calibrating”).
        </p>
      </Card>

      <Card title="Your data">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn" href="/api/export/db" style={{ textDecoration: 'none' }}>Download database</a>
          {['daily', 'workouts', 'scores', 'load'].map((t) => <a key={t} className="btn" href={`/api/export/csv/${t}`} style={{ textDecoration: 'none' }}>{t}.csv</a>)}
          <button type="button" className="btn" onClick={async () => { await postApi('/api/analytics/rebuild'); setMsg('Rebuilding all analytics…'); setTimeout(invalidate, 5000); }}>Rebuild analytics</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>All data is stored in the <code>data/</code> folder on this Mac. Back it up by copying that folder.</p>
      </Card>
      <p className="small muted">Not a medical device. For personal insight only. Recovery, sleep and fitness numbers are estimates to help you notice trends, not diagnoses.</p>
    </>
  );
}

function LanCard({ lanMode, ingestToken, onChange }: { lanMode: boolean; ingestToken: string | null; onChange: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async (enabled: boolean) => {
    try { await postApi('/api/lan', { enabled, passcode }); setMsg('Saved. Restart the app (npm start) for this to take effect.'); onChange(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Card title="Home-network mode" aside={lanMode ? 'On' : 'Off'}>
      <p className="small muted-2" style={{ margin: 0 }}>
        Lets your phone open the dashboard at http://&lt;your-mac-name&gt;.local:4321 on the same Wi-Fi, with a passcode, and lets Health Auto Export push data
        straight to the Mac (REST API automation) instead of via iCloud Drive. Off by default: the dashboard is only reachable from this Mac.
      </p>
      {!lanMode && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field">Choose a passcode (6+ characters)<input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>
          <button type="button" className="btn" disabled={passcode.length < 6} onClick={() => toggle(true)}>Turn on</button>
        </div>
      )}
      {lanMode && (
        <>
          {ingestToken && <p className="small" style={{ margin: 0 }}>Health Auto Export REST URL: <code>http://&lt;your-mac-name&gt;.local:4321/api/ingest/hae</code> · header <code>Authorization: Bearer {ingestToken}</code></p>}
          <div><button type="button" className="btn" onClick={() => toggle(false)}>Turn off</button></div>
        </>
      )}
      {msg && <p className="small muted-2" role="status" style={{ margin: 0 }}>{msg}</p>}
    </Card>
  );
}

interface Shoe { id: string; name: string; inUseFrom: string; retiredFrom: string | null; startKm: number; distanceKm: number; runs: number; warn: boolean }

function ShoesCard() {
  const { data } = useApi<{ shoes: Shoe[] }>('/api/gear');
  const invalidate = useInvalidateAll();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(today);
  const [startKm, setStartKm] = useState('0');
  const [err, setErr] = useState<Record<string, string>>({});
  const add = async () => {
    setErr({});
    try { await postApi('/api/gear', { name, inUseFrom: from, startKm: Number(startKm) || 0 }); setName(''); setStartKm('0'); invalidate(); }
    catch (e) { setErr(((e as { data?: { fields?: Record<string, string> } }).data?.fields) ?? { _: (e as Error).message }); }
  };
  const act = async (path: string, body: unknown, method: string) => { await postApi(path, body, method); invalidate(); };
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <Card title="Shoes" aside="Runs count towards the newest shoe in use on that day">
      {data?.shoes.length === 0 && <p className="empty" style={{ margin: 0 }}>No shoes yet. Add a pair to track its mileage; most last 500–800 km.</p>}
      {data?.shoes.map((s) => (
        <div key={s.id} className="list-row">
          <span style={{ flex: '1 1 220px' }}>
            <strong>{s.name}</strong>{s.retiredFrom && <span className="pill" style={{ marginLeft: 8 }}>Retired</span>}
            <br /><span className="small muted">Since {fmt(s.inUseFrom)}{s.retiredFrom ? ` · retired ${fmt(s.retiredFrom)}` : ''} · {s.runs} runs{s.startKm ? ` · started at ${s.startKm} km` : ''}</span>
          </span>
          <span style={{ flex: '0 0 110px' }}><strong className={s.warn ? 'worse-text' : ''}>{Math.round(s.distanceKm)} km</strong>{s.warn && <><br /><span className="small worse-text">Time for new ones?</span></>}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            {s.retiredFrom
              ? <button type="button" className="btn" onClick={() => act(`/api/gear/${encodeURIComponent(s.id)}`, { retiredFrom: null }, 'PATCH')}>Un-retire</button>
              : <button type="button" className="btn" onClick={() => act(`/api/gear/${encodeURIComponent(s.id)}`, { retiredFrom: today }, 'PATCH')}>Retire</button>}
            <button type="button" className="btn" aria-label={`Delete ${s.name}`} onClick={() => { if (window.confirm(`Delete ${s.name}?`)) void act(`/api/gear/${encodeURIComponent(s.id)}`, undefined, 'DELETE'); }}>Delete</button>
          </span>
        </div>
      ))}
      <div className="form-grid divider">
        <label className="field">Shoe name<input value={name} placeholder="e.g. Pegasus 41" onChange={(e) => setName(e.target.value)} />{err.name && <span className="worse-text small">{err.name}</span>}</label>
        <label className="field">In use from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />{err.inUseFrom && <span className="worse-text small">{err.inUseFrom}</span>}</label>
        <label className="field">Distance already done (km)<input inputMode="decimal" value={startKm} onChange={(e) => setStartKm(e.target.value)} />{err.startKm && <span className="worse-text small">{err.startKm}</span>}</label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><button type="button" className="btn primary" onClick={add} disabled={!name.trim()}>Add shoes</button></div>
      </div>
    </Card>
  );
}
