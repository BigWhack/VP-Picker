import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb } from '../helpers/db.js';
import { buildDailyRows } from '../../server/analytics/daily.js';
import { upsertSamples } from '../../server/repo/samples.js';
import { upsertSleep } from '../../server/repo/sleep.js';
import { updateSettings } from '../../server/repo/settings.js';
import { trimpFromStream, trimpFromAverage } from '../../server/analytics/load.js';
import { timeInZones } from '../../server/analytics/zones.js';
import { analyzeAllWorkouts } from '../../server/analytics/workouts.js';
import { seedDemo } from '../helpers/seed.js';
import { rebuildWorkouts } from '../../server/merge/workouts.js';
import { buildApp } from '../../server/app.js';
import { importHaeFolder } from '../../server/ingest/hae/importer.js';
import type { Sample, SleepSegment } from '../../shared/types.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'fix-'));

describe('C1: additive metrics with changing source strings', () => {
  it('sums every hour once even when the contributing devices change', () => {
    const db = testDb(); updateSettings(db, { tz: 'UTC' });
    const s = (h: number, v: number, src: string): Sample => ({ metric: 'steps', start: `2026-11-24T0${h}:00:00.000Z`, end: `2026-11-24T0${h}:00:00.000Z`, value: v, unit: 'steps', source: src });
    upsertSamples(db, [s(7, 820, 'W|P'), s(8, 1310, 'W'), s(9, 500, 'W|P'), s(9, 480, 'P')]);
    expect(buildDailyRows(db, '2026-11-24', '2026-11-24', 'UTC')[0].steps).toBe(2630);
  });
});

describe('I1: daily rollup scales linearly', () => {
  it('builds a year of 5-minute heart-rate data quickly', () => {
    const db = testDb(); updateSettings(db, { tz: 'UTC' });
    const start = Date.UTC(2025, 10, 25); const hr: Sample[] = []; const sleep: SleepSegment[] = [];
    for (let t = start; t < start + 365 * 86400000; t += 300000) hr.push({ metric: 'hr', start: new Date(t).toISOString(), end: new Date(t).toISOString(), value: 70, unit: 'bpm', source: 'W' });
    for (let d = 0; d < 365; d++) { const b = start + d * 86400000 - 3600000; sleep.push({ start: new Date(b).toISOString(), end: new Date(b + 8 * 3600000).toISOString(), stage: 'core', source: 'Watch' }); }
    upsertSamples(db, hr); upsertSleep(db, sleep);
    const t0 = Date.now();
    const rows = buildDailyRows(db, '2025-11-25', '2026-11-24', 'UTC');
    expect(rows.filter((r) => r.lowestHr === 70).length).toBeGreaterThan(360);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe('I2: workout analysis cache', () => {
  it('does not re-analyse every workout for a sub-bpm change in resting HR', () => {
    const db = testDb(); seedDemo(db, 30, new Date('2026-11-24T08:00:00Z')); rebuildWorkouts(db);
    const s = { zoneModel: 'hrr' as const } as never;
    const first = analyzeAllWorkouts(db, { hrRest: 53.5, hrMax: 185, sex: 'male' }, s);
    expect(first.analysed).toBeGreaterThan(5);
    expect(analyzeAllWorkouts(db, { hrRest: 53.2, hrMax: 185, sex: 'male' }, s).analysed).toBe(0);
  });
});

describe('I3: browser-origin protections', () => {
  it('rejects foreign Host headers (DNS rebinding) and cross-site POSTs', async () => {
    const db = testDb(); const d = tmp();
    const app = buildApp({ db, dataDir: d, home: d });
    expect((await app.inject({ url: '/api/settings', headers: { host: 'evil.example:4321' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/settings', headers: { host: 'localhost:4321' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/analytics/rebuild', headers: { host: 'localhost:4321', origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/analytics/rebuild', headers: { host: 'localhost:4321', origin: 'http://localhost:4321' } })).statusCode).toBe(202);
  });
  it('Strava OAuth callback requires the state issued by /start', async () => {
    const db = testDb(); const d = tmp();
    const app = buildApp({ db, dataDir: d, home: d, env: { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 'x' }, fetchFn: (async () => new Response('{}', { status: 500 })) as typeof fetch });
    const res = await app.inject({ url: '/auth/strava/callback?code=abc&scope=read,activity:read_all&state=forged' });
    expect(res.headers.location).toBe('/settings?strava=bad-state');
  });
});

describe('I4: pushed files', () => {
  it('removes inbox files once imported', async () => {
    const db = testDb(); const d = tmp(); const inbox = join(d, 'inbox');
    const { mkdirSync } = await import('node:fs'); mkdirSync(inbox);
    writeFileSync(join(inbox, 'a.json'), JSON.stringify({ data: { metrics: [{ name: 'step_count', units: 'count', data: [{ qty: 5, date: '2026-11-24 07:00:00 +0000' }] }] } }));
    const r = await importHaeFolder(db, inbox, join(d, 'raw'), { deleteAfterImport: true });
    expect(r.files).toBe(1);
    expect(readdirSync(inbox)).toHaveLength(0);
    expect(existsSync(join(d, 'raw', 'hae'))).toBe(true);
  });
});

describe('I5: per-minute heart-rate streams', () => {
  it('counts the full session when HR is sampled once a minute', () => {
    const t = Array.from({ length: 61 }, (_, i) => i * 60);
    expect(trimpFromStream(t, t.map(() => 150), 50, 190, 'male')).toBeCloseTo(trimpFromAverage(150, 3600, 50, 190, 'male'), 0);
    expect(timeInZones(t, t.map(() => 140), [120, 134, 148, 162, 176, 190])[1]).toBe(3600);
  });
  it('still ignores a long pause in a dense stream', () => {
    const t = [...Array.from({ length: 601 }, (_, i) => i), 4000, 4001];
    expect(timeInZones(t, t.map(() => 140), [120, 134, 148, 162, 176, 190])[1]).toBeLessThan(700);
  });
});
