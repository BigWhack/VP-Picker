import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb } from '../helpers/db.js';
import { StravaClient } from '../../server/ingest/strava/client.js';
import { createStravaSync } from '../../server/ingest/strava/sync.js';
import { saveTokens } from '../../server/repo/strava.js';
import { getWorkoutRecords, getRecordStreams, getExtras } from '../../server/repo/workouts.js';
import { getSettings, updateSettings } from '../../server/repo/settings.js';
import { importHaeFolder } from '../../server/ingest/hae/importer.js';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/strava/${f}`, import.meta.url), 'utf8'));
const NOW = new Date('2026-11-24T08:00:00Z');
const nowSec = NOW.getTime() / 1000;
const creds = { clientId: '1', clientSecret: 'x' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'x-ratelimit-usage': '1,10' } });
type Act = { id: number; name: string; start_date: string; [k: string]: unknown };

function api(state: { acts: Act[]; inclusiveAfter?: boolean; streams?: (id: number) => Response; detail?: (id: number) => Response }) {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = new URL(String(input)); calls.push(`${url.pathname}?${url.searchParams}`);
    if (url.pathname === '/api/v3/athlete/activities') {
      const before = Number(url.searchParams.get('before') ?? Infinity); const after = Number(url.searchParams.get('after') ?? -Infinity);
      const page = Number(url.searchParams.get('page') ?? 1);
      const list = state.acts.filter((a) => { const t = Date.parse(a.start_date) / 1000; return t < before && (state.inclusiveAfter ? t >= after : t > after); });
      return json(page === 1 ? list : []);
    }
    const m = url.pathname.match(/^\/api\/v3\/activities\/(\d+)(\/streams)?$/);
    if (m && m[2]) return state.streams ? state.streams(Number(m[1])) : json(fx('streams.json'));
    if (m) return state.detail ? state.detail(Number(m[1])) : json({ ...fx('activity.json'), ...state.acts.find((a) => a.id === Number(m[1])) });
    if (url.pathname.startsWith('/api/v3/gear/')) return json(fx('gear.json'));
    return new Response('nf', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

function freshDb() {
  const db = testDb();
  saveTokens(db, { access: 'a', refresh: 'r', expiresAt: nowSec + 20000 });
  return db;
}
const acts = (): Act[] => (fx('activities.json') as Act[]).map((a) => ({ ...a }));

describe('M1: HAE import does not swallow concurrent writes', () => {
  it('a settings change made during a failing import survives', async () => {
    const db = testDb(); const dir = mkdtempSync(join(tmpdir(), 'm1-'));
    const points = Array.from({ length: 12000 }, (_, i) => `{"qty":1,"date":"2026-11-2${i % 5} 0${i % 9}:00:00 +0000","source":"s${i}"}`).join(',');
    writeFileSync(join(dir, 'bad.json'), `{"data":{"metrics":[{"name":"step_count","units":"count","data":[${points}`);
    const p = importHaeFolder(db, dir, join(dir, 'raw'));
    const imported = () => (db.prepare('SELECT COUNT(*) AS c FROM samples').get() as { c: number }).c;
    for (let i = 0; i < 5000 && imported() === 0; i++) await new Promise((r) => setImmediate(r));
    expect(imported()).toBeGreaterThan(0); // the import is part-way through the file
    updateSettings(db, { sleepNeedMin: 500 });
    await p;
    expect(getSettings(db).sleepNeedMin).toBe(500);
  });
});

describe('M2: new-activity loop always makes progress', () => {
  it('stops when Strava treats `after` as inclusive', async () => {
    const db = freshDb(); const state = { acts: acts(), inclusiveAfter: true };
    await createStravaSync(db, new StravaClient(db, creds, api(state).fn, () => NOW)).poll();
    const second = api(state);
    await createStravaSync(db, new StravaClient(db, creds, second.fn, () => NOW)).poll();
    expect(second.calls.filter((c) => c.startsWith('/api/v3/athlete/activities')).length).toBeLessThan(6);
  });
});

describe('M3: detail without streams', () => {
  it('saves laps and best efforts when the activity has no streams (404)', async () => {
    const db = freshDb();
    const r = await createStravaSync(db, new StravaClient(db, creds, api({ acts: acts(), streams: () => new Response('nf', { status: 404 }) }).fn, () => NOW)).poll();
    expect(r.processed).toBe(3);
    expect(getExtras(db, '1000')!.bestEfforts).toHaveLength(2);
    expect(getRecordStreams(db, 'strava', '1000')).toBeNull();
  });
  it('a failing activity is tried once per sync, not five times in a row', async () => {
    const db = freshDb(); const state = { acts: acts(), detail: (id: number) => (id === 1001 ? json({}, 500) : json({ ...fx('activity.json'), ...acts().find((a) => a.id === id) })) };
    const { fn, calls } = api(state);
    await createStravaSync(db, new StravaClient(db, creds, fn, () => NOW)).poll();
    expect(calls.filter((c) => c.startsWith('/api/v3/activities/1001?')).length).toBe(1);
  });
});

describe('M4: Strava edits and deletions', () => {
  it('picks up renames and removes deleted activities from the last 30 days', async () => {
    const db = freshDb(); const state = { acts: acts() };
    await createStravaSync(db, new StravaClient(db, creds, api(state).fn, () => NOW)).poll();
    state.acts[0].name = 'Renamed run';
    state.acts.splice(2, 1);
    await createStravaSync(db, new StravaClient(db, creds, api(state).fn, () => NOW)).poll();
    const recs = getWorkoutRecords(db, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'strava');
    expect(recs.map((r) => r.sourceId).sort()).toEqual(['1000', '1001']);
    expect(recs.find((r) => r.sourceId === '1000')!.name).toBe('Renamed run');
  });
});
