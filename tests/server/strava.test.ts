import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb } from '../helpers/db.js';
import { buildApp } from '../../server/app.js';
import { StravaClient } from '../../server/ingest/strava/client.js';
import { createStravaSync } from '../../server/ingest/strava/sync.js';
import { mapActivity, mapStreams } from '../../server/ingest/strava/map.js';
import { saveTokens, getTokens, queueSize } from '../../server/repo/strava.js';
import { getWorkoutRecords, getRecordStreams, getGear } from '../../server/repo/workouts.js';

const fx = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/strava/${f}`, import.meta.url), 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'strava-'));
const creds = { clientId: '123', clientSecret: 'shh' };
const NOW = new Date('2026-11-24T08:00:00Z');
const nowSec = NOW.getTime() / 1000;

type Handler = (url: URL, init?: RequestInit) => Response | undefined;
function mockFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    return handler(url, init) ?? new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-usage': '10,100', 'x-ratelimit-limit': '200,2000', ...headers } });

function stravaApi(opts: { failStreamsFor?: number; acts?: unknown[] } = {}): Handler {
  const acts = (opts.acts ?? fx('activities.json')) as { id: number }[];
  return (url) => {
    if (url.pathname === '/api/v3/athlete/activities') {
      const before = Number(url.searchParams.get('before') ?? Infinity); const after = Number(url.searchParams.get('after') ?? -Infinity);
      const page = Number(url.searchParams.get('page') ?? 1);
      const list = (acts as { id: number; start_date: string }[]).filter((a) => { const t = Date.parse(a.start_date) / 1000; return t < before && t > after; });
      return json(page === 1 ? list : []);
    }
    const m = url.pathname.match(/^\/api\/v3\/activities\/(\d+)(\/streams)?$/);
    if (m && m[2]) {
      if (Number(m[1]) === opts.failStreamsFor) return json({ message: 'Rate Limit Exceeded' }, 429);
      return json(fx('streams.json'));
    }
    if (m) return json({ ...fx('activity.json'), ...acts.find((a) => a.id === Number(m[1])) });
    if (url.pathname === '/api/v3/gear/g1') return json(fx('gear.json'));
    return undefined;
  };
}

describe('Strava OAuth', () => {
  it('redirects to the exact authorize URL', async () => {
    const app = buildApp({ db: testDb(), dataDir: tmp(), home: tmp(), env: { STRAVA_CLIENT_ID: '123', STRAVA_CLIENT_SECRET: 'x', PORT: 4321 } });
    const res = await app.inject({ method: 'GET', url: '/auth/strava/start' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/www\.strava\.com\/oauth\/authorize\?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A4321%2Fauth%2Fstrava%2Fcallback&response_type=code&approval_prompt=auto&scope=read%2Cactivity%3Aread_all%2Cprofile%3Aread_all&state=[0-9a-f]{32}$/);
  });

  it('exchanges the code, stores tokens and redirects to settings', async () => {
    const db = testDb();
    const { fn } = mockFetch((url) => (url.pathname === '/oauth/token'
      ? json({ access_token: 'a1', refresh_token: 'r1', expires_at: nowSec + 21600, athlete: { id: 7, firstname: 'J' } }) : undefined));
    const app = buildApp({ db, dataDir: tmp(), home: tmp(), env: { STRAVA_CLIENT_ID: '123', STRAVA_CLIENT_SECRET: 'x' }, fetchFn: fn });
    const start = await app.inject({ method: 'GET', url: '/auth/strava/start' });
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const res = await app.inject({ method: 'GET', url: `/auth/strava/callback?code=abc&scope=read,activity:read_all,profile:read_all&state=${state}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings?strava=connected');
    expect(getTokens(db)).toMatchObject({ access: 'a1', refresh: 'r1' });
  });
});

describe('Strava client', () => {
  it('refreshes an expired token once and retries', async () => {
    const db = testDb();
    saveTokens(db, { access: 'old', refresh: 'r1', expiresAt: nowSec - 10 });
    const { fn, calls } = mockFetch((url, init) => {
      if (url.pathname === '/oauth/token') return json({ access_token: 'new', refresh_token: 'r2', expires_at: nowSec + 21600 });
      if (url.pathname === '/api/v3/athlete') return (init?.headers as Record<string, string>).authorization === 'Bearer new' ? json({ id: 7 }) : json({}, 401);
      return undefined;
    });
    const c = new StravaClient(db, creds, fn, () => NOW);
    expect(await c.get('/athlete')).toEqual({ id: 7 });
    expect(calls.filter((x) => x.includes('/oauth/token'))).toHaveLength(1);
    expect(getTokens(db)!.refresh).toBe('r2');
  });

  it('a 401 on refresh disconnects Strava', async () => {
    const db = testDb();
    saveTokens(db, { access: 'old', refresh: 'bad', expiresAt: nowSec - 10 });
    const { fn } = mockFetch((url) => (url.pathname === '/oauth/token' ? json({ message: 'Bad Request' }, 401) : undefined));
    const sync = createStravaSync(db, new StravaClient(db, creds, fn, () => NOW));
    await expect(sync.poll()).rejects.toThrow(/reconnect/i);
    expect(getTokens(db)).toBeNull();
    const app = buildApp({ db, dataDir: tmp(), home: tmp(), now: () => NOW });
    expect((await app.inject({ method: 'GET', url: '/api/sync/status' })).json().sources.strava.connected).toBe(false);
  });
});

describe('Strava mapping', () => {
  it('maps an activity and its streams', () => {
    const r = mapActivity(fx('activity.json'));
    expect(r).toMatchObject({ source: 'strava', sourceId: '1000', sport: 'run', start: '2026-11-23T07:00:40.000Z', durationS: 3100,
      movingS: 3000, distanceM: 10200, elevGainM: 45, avgHr: 148, maxHr: 171, energyKcal: 642, gearId: 'g1', name: 'Morning run' });
    expect(r.polyline).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    const s = mapStreams(fx('streams.json'));
    expect(s.time).toEqual([0, 5, 10, 15, 20]);
    expect(s.speed![0]).toBe(3.2);
    expect(s.latlng![1]).toEqual([51.5001, -0.1]);
    expect(s.grade![1]).toBe(1.5);
  });
});

describe('Strava sync', () => {
  it('imports activities with detail, streams and gear', async () => {
    const db = testDb();
    saveTokens(db, { access: 'a', refresh: 'r', expiresAt: nowSec + 20000 });
    const { fn } = mockFetch(stravaApi());
    const r = await createStravaSync(db, new StravaClient(db, creds, fn, () => NOW)).poll();
    expect(r).toMatchObject({ newActivities: 3, processed: 3 });
    expect(getWorkoutRecords(db, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'strava')).toHaveLength(3);
    expect(getRecordStreams(db, 'strava', '1000')!.heartrate).toHaveLength(5);
    expect(getGear(db, 'g1')).toMatchObject({ name: 'Pegasus 41', distanceM: 482000 });
    expect(queueSize(db)).toBe(0);
  });

  it('keeps the queue on a 429 and resumes next poll', async () => {
    const db = testDb();
    saveTokens(db, { access: 'a', refresh: 'r', expiresAt: nowSec + 20000 });
    const first = mockFetch(stravaApi({ failStreamsFor: 1002 }));
    const r1 = await createStravaSync(db, new StravaClient(db, creds, first.fn, () => NOW)).poll();
    expect(r1.processed).toBe(2);
    expect(queueSize(db)).toBe(1);
    const second = mockFetch(stravaApi());
    const r2 = await createStravaSync(db, new StravaClient(db, creds, second.fn, () => NOW)).poll();
    expect(r2.processed).toBe(1);
    expect(second.calls).toContain('GET /api/v3/activities/1002');
    expect(queueSize(db)).toBe(0);
  });

  it('stops before the 15-minute budget is spent', async () => {
    const db = testDb();
    saveTokens(db, { access: 'a', refresh: 'r', expiresAt: nowSec + 20000 });
    const { fn } = mockFetch((url) => {
      const h = stravaApi()(url);
      return h ? new Response(h.body, { status: h.status, headers: { 'x-ratelimit-usage': '95,100', 'x-ratelimit-limit': '200,2000' } }) : undefined;
    });
    const r = await createStravaSync(db, new StravaClient(db, creds, fn, () => NOW)).poll();
    expect(r.processed).toBe(0);
    expect(queueSize(db)).toBe(3);
  });

  it('does nothing when Strava is not connected', async () => {
    const db = testDb();
    const { fn, calls } = mockFetch(stravaApi());
    const r = await createStravaSync(db, new StravaClient(db, creds, fn, () => NOW)).poll();
    expect(r).toMatchObject({ newActivities: 0, processed: 0 });
    expect(calls).toHaveLength(0);
  });
});
