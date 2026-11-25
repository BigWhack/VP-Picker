import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScheduler } from '../../server/sync/scheduler.js';
import { runSyncJob } from '../../server/sync/job.js';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { updateSettings } from '../../server/repo/settings.js';
import { upsertSamples } from '../../server/repo/samples.js';

afterEach(() => vi.useRealTimers());
const tmp = () => mkdtempSync(join(tmpdir(), 'sync-'));

describe('scheduler', () => {
  it('runs immediately, then only when 55 minutes have passed', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T08:00:00Z') });
    let last: Date | null = null;
    const run = vi.fn(async () => { last = new Date(); });
    const stop = startScheduler(run, { lastRun: () => last });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50 * 60000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('never overlaps a run that is still in flight', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => new Promise<void>(() => {}));
    const stop = startScheduler(run, { lastRun: () => null });
    await vi.advanceTimersByTimeAsync(3 * 3600000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('sync job', () => {
  it('keeps going when the HAE stage fails and reports partial', async () => {
    const db = testDb(); const data = tmp();
    const notAFolder = join(data, 'file.txt'); writeFileSync(notAFolder, 'x');
    updateSettings(db, { haeFolder: notAFolder, tz: 'Europe/London' });
    const r = await runSyncJob({ db, dataDir: data, home: tmp(), now: () => new Date('2026-11-24T08:00:00Z') });
    expect(r.status).toBe('partial');
    expect(r.errors[0]).toMatch(/hae/i);
    expect(r.recomputedDays).toBeGreaterThan(0);
  });
});

describe('sync API', () => {
  it('reports stale Health Auto Export data', async () => {
    const db = testDb();
    upsertSamples(db, [{ metric: 'steps', start: '2026-11-24T04:00:00.000Z', end: '2026-11-24T04:00:00.000Z', value: 1, unit: 'steps', source: 'w' }]);
    const app = buildApp({ db, dataDir: tmp(), home: tmp(), now: () => new Date('2026-11-24T08:00:00Z') });
    const res = await app.inject({ method: 'GET', url: '/api/sync/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources.hae).toMatchObject({ lastDataAt: '2026-11-24T04:00:00.000Z', stale: true });
    expect(res.json().sources.strava.connected).toBe(false);
  });

  it('starts a run on POST and returns 202', async () => {
    const db = testDb();
    const app = buildApp({ db, dataDir: tmp(), home: tmp(), now: () => new Date('2026-11-24T08:00:00Z') });
    const res = await app.inject({ method: 'POST', url: '/api/sync/run' });
    expect(res.statusCode).toBe(202);
  });
});
