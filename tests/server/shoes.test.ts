import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { upsertRecord } from '../../server/repo/workouts.js';
import { rebuildWorkouts } from '../../server/merge/workouts.js';
import { updateSettings } from '../../server/repo/settings.js';
import type { WorkoutRecord } from '../../shared/types.js';
import type { Db } from '../../server/db/client.js';

const run = (id: string, start: string, km: number, sport: WorkoutRecord['sport'] = 'run'): WorkoutRecord => ({
  source: 'apple', sourceId: id, sport, start, end: new Date(Date.parse(start) + 3000000).toISOString(), tzOffsetMin: 0, durationS: 3000, distanceM: km * 1000,
});

let app: FastifyInstance; let db: Db;
beforeEach(() => {
  db = testDb(); updateSettings(db, { tz: 'Europe/London' });
  upsertRecord(db, run('r1', '2026-10-20T07:00:00.000Z', 10), null); // before any shoe
  upsertRecord(db, run('r2', '2026-11-02T07:00:00.000Z', 8), null);
  upsertRecord(db, run('r3', '2026-11-10T07:00:00.000Z', 12), null);
  upsertRecord(db, run('w1', '2026-11-11T07:00:00.000Z', 5, 'walk'), null); // walks don't count
  upsertRecord(db, run('r4', '2026-11-20T07:00:00.000Z', 21), null);
  rebuildWorkouts(db);
  const d = mkdtempSync(join(tmpdir(), 'shoe-'));
  app = buildApp({ db, dataDir: d, home: d, now: () => new Date('2026-11-24T08:00:00Z') });
});

const shoes = async () => (await app.inject({ url: '/api/gear' })).json().shoes as { id: string; name: string; distanceKm: number; runs: number; warn: boolean; retiredFrom: string | null }[];

describe('shoe mileage without Strava', () => {
  it('counts runs from the in-use date on top of the starting distance', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/gear', payload: { name: 'Pegasus 41', inUseFrom: '2026-11-01', startKm: 100 } });
    expect(res.statusCode).toBe(201);
    const [s] = await shoes();
    expect(s).toMatchObject({ name: 'Pegasus 41', distanceKm: 141, runs: 3, warn: false });
  });

  it('a newer shoe takes over, and retiring it hands runs back', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/gear', payload: { name: 'Old', inUseFrom: '2026-11-01', startKm: 590 } })).json().shoe;
    await app.inject({ method: 'POST', url: '/api/gear', payload: { name: 'New', inUseFrom: '2026-11-15', startKm: 0 } });
    let list = await shoes();
    expect(list.find((x) => x.name === 'Old')).toMatchObject({ distanceKm: 610, runs: 2, warn: true });
    expect(list.find((x) => x.name === 'New')).toMatchObject({ distanceKm: 21, runs: 1 });
    const n = list.find((x) => x.name === 'New')!;
    await app.inject({ method: 'PATCH', url: `/api/gear/${n.id}`, payload: { retiredFrom: '2026-11-15' } });
    list = await shoes();
    expect(list.find((x) => x.name === 'Old')!.runs).toBe(3);
    expect(a.name).toBe('Old');
  });

  it('shows the shoe on the run page and validates input', async () => {
    await app.inject({ method: 'POST', url: '/api/gear', payload: { name: 'Pegasus 41', inUseFrom: '2026-11-01', startKm: 0 } });
    const d = (await app.inject({ url: '/api/workouts/apple%3Ar3' })).json();
    expect(d.gear).toMatchObject({ name: 'Pegasus 41', kind: 'shoe', distanceKm: 41 });
    expect((await app.inject({ url: '/api/workouts/apple%3Ar1' })).json().gear).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/api/gear', payload: { name: '', inUseFrom: '2026-11-01' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/gear', payload: { name: 'X', inUseFrom: 'yesterday' } })).statusCode).toBe(400);
  });

  it('can delete a shoe', async () => {
    const s = (await app.inject({ method: 'POST', url: '/api/gear', payload: { name: 'Temp', inUseFrom: '2026-11-01' } })).json().shoe;
    expect((await app.inject({ method: 'DELETE', url: `/api/gear/${s.id}` })).statusCode).toBe(200);
    expect(await shoes()).toHaveLength(0);
  });
});
