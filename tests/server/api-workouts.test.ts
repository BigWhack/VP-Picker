import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { recompute } from '../../server/analytics/recompute.js';
import type { FastifyInstance } from 'fastify';

const now = new Date('2026-11-24T08:00:00Z');
let app: FastifyInstance;
beforeAll(async () => {
  const db = testDb(); seedDemo(db, 60, now); await recompute(db, { now });
  const tmp = mkdtempSync(join(tmpdir(), 'w-'));
  app = buildApp({ db, dataDir: tmp, home: tmp, now: () => now });
});

describe('workouts API', () => {
  it('lists and filters by sport, with weekly volume and calendar', async () => {
    const all = (await app.inject({ url: '/api/workouts' })).json();
    expect(all.total).toBeGreaterThan(20);
    const rides = (await app.inject({ url: '/api/workouts?sport=ride' })).json();
    expect(rides.items.length).toBeGreaterThan(0);
    expect(rides.items.every((w: { sport: string }) => w.sport === 'ride')).toBe(true);
    expect(all.weekly).toHaveLength(12);
    expect(all.weekly[11].bySport).toBeTypeOf('object');
    expect(all.calendar.length).toBeGreaterThan(300);
  });

  it('returns a run breakdown with splits, zones and similar runs', async () => {
    const runs = (await app.inject({ url: '/api/workouts?sport=run' })).json().items;
    const d = (await app.inject({ url: `/api/workouts/${encodeURIComponent(runs[0].id)}` })).json();
    expect(d.workout.id).toBe(runs[0].id);
    expect(d.analysis.kind).toBe('run');
    expect(d.analysis.splits.length).toBeGreaterThan(5);
    expect(d.analysis.zones.seconds).toHaveLength(5);
    expect(d.streams.time.length).toBeLessThanOrEqual(1500);
    expect(Array.isArray(d.similar)).toBe(true);
  });

  it('returns a strength workout without streams', async () => {
    const s = (await app.inject({ url: '/api/workouts?sport=strength' })).json().items[0];
    const d = (await app.inject({ url: `/api/workouts/${encodeURIComponent(s.id)}` })).json();
    expect(d.streams).toBeNull();
    expect(d.analysis.kind).toBe('generic');
  });

  it('404s an unknown workout and serves the records board', async () => {
    expect((await app.inject({ url: '/api/workouts/nope' })).statusCode).toBe(404);
    const r = (await app.inject({ url: '/api/records' })).json();
    expect(r.current.find((x: { label: string }) => x.label === '5K').best).not.toBeNull();
    expect(r.predictions).toHaveLength(4);
  });
});
