import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { recompute } from '../../server/analytics/recompute.js';

const now = new Date('2026-11-24T08:00:00Z');
let app: FastifyInstance;
beforeAll(async () => {
  const db = testDb(); seedDemo(db, 120, now); await recompute(db, { from: 'all', now });
  const t = mkdtempSync(join(tmpdir(), 't-')); app = buildApp({ db, dataDir: t, home: t, now: () => now });
});

describe('trends API', () => {
  it('returns a metric series with a comparison period', async () => {
    const b = (await app.inject({ url: '/api/trends?metric=rhr&range=30d&compareTo=previous' })).json();
    expect(b.series.points).toHaveLength(30);
    expect(b.compareSeries.points).toHaveLength(30);
    expect(b.summary.mean).toBeGreaterThan(40);
    expect(typeof b.summary.change).toBe('number');
  });
  it('rejects unknown metrics', async () => {
    expect((await app.inject({ url: '/api/trends?metric=nope' })).statusCode).toBe(400);
  });
  it('serves training load and patterns', async () => {
    const l = (await app.inject({ url: '/api/trends/load?range=90d' })).json();
    expect(l.days).toHaveLength(90);
    expect(l.days[89]).toHaveProperty('ctl');
    expect(l.weeks.length).toBeGreaterThan(10);
    const p = (await app.inject({ url: '/api/patterns' })).json();
    expect(Array.isArray(p.patterns)).toBe(true);
  });
});
