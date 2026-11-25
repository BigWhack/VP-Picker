import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { recompute } from '../../server/analytics/recompute.js';
import { getDaily } from '../../server/repo/derived.js';
import { updateSettings } from '../../server/repo/settings.js';
import { vo2Category } from '../../shared/vo2-categories.js';
import type { Db } from '../../server/db/client.js';

const now = new Date('2026-11-24T08:00:00Z');
let app: FastifyInstance; let db: Db;
beforeAll(async () => {
  db = testDb(); seedDemo(db, 60, now); await recompute(db, { now });
  const t = mkdtempSync(join(tmpdir(), 'h-')); app = buildApp({ db, dataDir: t, home: t, now: () => now });
});

describe('heart API', () => {
  it('series length follows the range', async () => {
    const b = (await app.inject({ url: '/api/heart?range=30d' })).json();
    expect(b.series.rhr.points).toHaveLength(30);
    expect(b.series.hrv.band).not.toBeNull();
    expect((await app.inject({ url: '/api/heart?range=90d' })).json().series.rhr.points).toHaveLength(90);
  });
  it('VO2 category needs date of birth and sex', async () => {
    expect((await app.inject({ url: '/api/heart' })).json().vo2Category).toBe('High');
    updateSettings(db, { dob: null as never });
    expect((await app.inject({ url: '/api/heart' })).json().vo2Category).toBeNull();
    updateSettings(db, { dob: '1994-06-01' });
  });
  it('VO2 table lookups', () => {
    expect(vo2Category(49.3, 32, 'male')).toBe('High');
    expect(vo2Category(30, 32, 'male')).toBe('Low');
    expect(vo2Category(36, 25, 'female')).toBe('Below average');
  });
});

describe('heart flag episodes', () => {
  it('only heart flags, consecutive days collapsed', async () => {
    const { saveInsights } = await import('../../server/repo/derived.js');
    for (const d of ['2026-11-20', '2026-11-21', '2026-11-22']) saveInsights(db, d, [{ date: d, kind: 'rhr_elevated', severity: 'warn', text: 'x' }, { date: d, kind: 'sleep_debt', severity: 'info', text: 'y' }]);
    const b = (await app.inject({ url: '/api/heart?range=30d' })).json();
    expect(b.flagEpisodes).toContainEqual({ kind: 'rhr_elevated', from: '2026-11-20', to: '2026-11-22', text: 'x' });
    expect(b.flagEpisodes.filter((f: { kind: string }) => f.kind === 'rhr_elevated')).toHaveLength(1);
    expect(b.flagEpisodes.some((f: { kind: string }) => f.kind === 'sleep_debt')).toBe(false);
  });
});

describe('activity API', () => {
  it('day totals match the daily rollup and goals are included', async () => {
    const b = (await app.inject({ url: '/api/activity?range=30d' })).json();
    expect(b.days).toHaveLength(30);
    const today = getDaily(db, '2026-11-24', '2026-11-24')[0];
    expect(b.days[29].steps).toBe(today.steps);
    expect(b.goals.steps).toBe(10000);
    expect(b.weekCompare.map((r: { key: string }) => r.key)).toEqual(['steps', 'activeKcal', 'exerciseMin', 'standHours']);
    expect(b.monthTotals.length).toBeGreaterThan(0);
  });
});
