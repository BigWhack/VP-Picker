import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { recompute } from '../../server/analytics/recompute.js';
import type { Db } from '../../server/db/client.js';

const now = new Date('2026-11-24T08:00:00Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'today-'));
let seeded: Db;

beforeAll(async () => {
  seeded = testDb();
  seedDemo(seeded, 60, now);
  await recompute(seeded, { now });
});

describe('GET /api/today', () => {
  it('returns the full home-screen payload for seeded data', async () => {
    const app = buildApp({ db: seeded, dataDir: tmp(), home: tmp(), now: () => now });
    const res = await app.inject({ method: 'GET', url: '/api/today' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.date).toBe('2026-11-24');
    for (const k of ['headline', 'detail', 'recovery', 'vsNormal', 'lastNight', 'sleepWindow', 'usualBedtime', 'trends', 'weekCompare', 'lastWorkout', 'flags', 'sync']) {
      expect(b).toHaveProperty(k);
    }
    expect(typeof b.recovery.score).toBe('number');
    expect(b.trends.hrv.points).toHaveLength(14);
    expect(b.trends.hrv.band).not.toBeNull();
    expect(b.sleepWindow).toHaveLength(7);
    expect(b.sleepWindow[0].bedtime).toMatch(/^\d{2}:\d{2}$/);
    expect(b.weekCompare.map((r: { key: string }) => r.key)).toEqual(expect.arrayContaining(['sleep', 'hrv', 'rhr', 'steps', 'trainingMin', 'runKm', 'rideKm']));
    expect(b.lastNight.segments.length).toBeGreaterThan(3);
    expect(b.lastNight.stageAvg.deep).toBeGreaterThan(0);
    expect(b.vsNormal.map((v: { key: string }) => v.key)).toEqual(['hrv', 'rhr', 'sleep', 'resp']);
    expect(b.vsNormal.every((v: { calibrating: boolean }) => v.calibrating === false)).toBe(true);
    expect(b.lastWorkout.name).toBeTruthy();
  });

  it('returns an empty but valid payload for a fresh database', async () => {
    const app = buildApp({ db: testDb(), dataDir: tmp(), home: tmp(), now: () => now });
    const b = (await app.inject({ method: 'GET', url: '/api/today' })).json();
    expect(b.recovery.score).toBeNull();
    expect(b.lastNight).toBeNull();
    expect(b.lastWorkout).toBeNull();
    expect(b.vsNormal.every((v: { calibrating: boolean }) => v.calibrating)).toBe(true);
  });
});
