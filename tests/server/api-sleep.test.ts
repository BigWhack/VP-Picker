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
  const db = testDb(); seedDemo(db, 60, now); await recompute(db, { now });
  const t = mkdtempSync(join(tmpdir(), 's-')); app = buildApp({ db, dataDir: t, home: t, now: () => now });
});

describe('GET /api/sleep', () => {
  it('returns the night, 30-night history, debt and regularity', async () => {
    const b = (await app.inject({ url: '/api/sleep?date=2026-11-24' })).json();
    expect(b.date).toBe('2026-11-24');
    expect(b.history).toHaveLength(30);
    expect(b.night.score).toBeGreaterThanOrEqual(0);
    expect(b.night.score).toBeLessThanOrEqual(100);
    expect(b.night.segments.length).toBeGreaterThan(3);
    expect(b.night.scoreComponents).toHaveProperty('duration');
    expect(b.night.overnight).toHaveProperty('lowestHr');
    expect(typeof b.debtMin).toBe('number');
    expect(b.needMin).toBe(450);
    expect(b.stageAvg.deep).toBeGreaterThan(0);
  });
  it('returns night: null for a date without sleep', async () => {
    const res = await app.inject({ url: '/api/sleep?date=2025-01-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().night).toBeNull();
  });
});
