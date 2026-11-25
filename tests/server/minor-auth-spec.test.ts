import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { enableLan } from '../../server/api/lan-auth.js';
import { hasNewHaeFiles, importHaeFolder } from '../../server/ingest/hae/importer.js';
import { runSyncJob, lastRunAt } from '../../server/sync/job.js';
import { regularitySdMin } from '../../server/analytics/sleep.js';
import { recompute } from '../../server/analytics/recompute.js';

const LAN = '192.168.1.20';
const tmp = () => mkdtempSync(join(tmpdir(), 'm8-'));

describe('M8: login hardening', () => {
  it('rate-limits repeated wrong passcodes', async () => {
    const db = testDb(); enableLan(db, 'correct horse'); const d = tmp();
    const app = buildApp({ db, dataDir: d, home: d });
    const tryLogin = (passcode: string) => app.inject({ method: 'POST', url: '/api/login', remoteAddress: LAN, headers: { host: 'mac.local:4321' }, payload: { passcode } });
    for (let i = 0; i < 5; i++) expect((await tryLogin('wrong')).statusCode).toBe(401);
    expect((await tryLogin('wrong')).statusCode).toBe(429);
    expect((await tryLogin('correct horse')).statusCode).toBe(429);
  });

  it('changing the passcode signs out existing sessions', async () => {
    const db = testDb(); enableLan(db, 'correct horse'); const d = tmp();
    const app = buildApp({ db, dataDir: d, home: d });
    const login = await app.inject({ method: 'POST', url: '/api/login', remoteAddress: LAN, headers: { host: 'mac.local:4321' }, payload: { passcode: 'correct horse' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ url: '/api/health', remoteAddress: LAN, headers: { cookie, host: 'mac.local:4321' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/settings', remoteAddress: LAN, headers: { cookie, host: 'mac.local:4321' } })).statusCode).toBe(200);
    enableLan(db, 'battery staple');
    expect((await app.inject({ url: '/api/settings', remoteAddress: LAN, headers: { cookie, host: 'mac.local:4321' } })).statusCode).toBe(401);
  });

  it('limits request bodies to 1 MB except Health Auto Export pushes', async () => {
    const db = testDb(); const { ingestToken } = enableLan(db, 'correct horse'); const d = tmp();
    const app = buildApp({ db, dataDir: d, home: d });
    const big = { data: { metrics: [], pad: 'x'.repeat(2 * 1024 * 1024) } };
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: big })).statusCode).toBe(413);
    expect((await app.inject({ method: 'POST', url: '/api/ingest/hae', payload: big, headers: { authorization: `Bearer ${ingestToken}` } })).statusCode).toBe(202);
  });
});

describe('M9: spec drift', () => {
  it('detects new Health Auto Export files cheaply between hourly syncs', async () => {
    const db = testDb(); const dir = tmp(); const raw = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ data: { metrics: [] } }));
    expect(hasNewHaeFiles([dir])).toBe(true);
    await importHaeFolder(db, dir, raw);
    expect(hasNewHaeFiles([dir])).toBe(false);
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ data: { metrics: [] } }));
    expect(hasNewHaeFiles([dir])).toBe(true);
  });

  it('a Health-only sync skips Strava and does not reset the hourly clock', async () => {
    const db = testDb(); const d = tmp(); mkdirSync(join(d, 'inbox'));
    let polled = 0;
    const strava = { poll: async () => { polled++; return { newActivities: 0, queued: 0, processed: 0 }; } };
    await runSyncJob({ db, dataDir: d, home: d, strava, now: () => new Date('2026-11-24T08:00:00Z') });
    await runSyncJob({ db, dataDir: d, home: d, strava, haeOnly: true, now: () => new Date('2026-11-24T08:05:00Z') });
    expect(polled).toBe(1);
    expect(lastRunAt(db)!.toISOString()).toBe('2026-11-24T08:00:00.000Z');
  });

  it('bedtime regularity uses both bedtime and wake time', () => {
    expect(regularitySdMin(['23:00', '23:00', '23:00'], ['06:30', '07:30', '07:00'])).toBeCloseTo(12.3, 0);
  });

  it('similar sessions are found for rides, not just runs', async () => {
    const db = testDb(); const now = new Date('2026-11-24T08:00:00Z'); seedDemo(db, 60, now); await recompute(db, { now });
    const d = tmp(); const app = buildApp({ db, dataDir: d, home: d, now: () => now });
    const rides = (await app.inject({ url: '/api/workouts?sport=ride' })).json().items;
    const detail = (await app.inject({ url: `/api/workouts/${encodeURIComponent(rides[0].id)}` })).json();
    expect(detail.similar.length).toBeGreaterThan(0);
    expect(detail.similar[0]).toHaveProperty('speedKmh');
  });
});
