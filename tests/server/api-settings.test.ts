import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { recompute } from '../../server/analytics/recompute.js';
import { getSettings } from '../../server/repo/settings.js';
import type { Db } from '../../server/db/client.js';

const now = new Date('2026-11-24T08:00:00Z');
let app: FastifyInstance; let db: Db; let dir: string;
beforeAll(async () => {
  db = testDb(); seedDemo(db, 40, now); await recompute(db, { now });
  dir = mkdtempSync(join(tmpdir(), 'set-')); app = buildApp({ db, dataDir: dir, home: dir, now: () => now });
});

describe('settings API', () => {
  it('rejects invalid values with field errors', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { sleepNeedMin: 100 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.sleepNeedMin).toBeTruthy();
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: { tz: 'Not/AZone' } })).statusCode).toBe(400);
  });
  it('persists a valid update and never exposes secrets', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { sleepNeedMin: 480, hrMax: 192 } });
    expect(res.statusCode).toBe(200);
    expect(getSettings(db)).toMatchObject({ sleepNeedMin: 480, hrMax: 192 });
    const g = (await app.inject({ url: '/api/settings' })).json();
    expect(g.settings.sleepNeedMin).toBe(480);
    expect(g.settings).not.toHaveProperty('passcodeHash');
  });
  it('setup checklist reports what exists', async () => {
    const s = (await app.inject({ url: '/api/setup' })).json();
    expect(s).toMatchObject({ stravaConfigured: false, stravaConnected: false });
    expect(s.daysOfData).toBeGreaterThan(30);
  });
  it('exports CSV and the database', async () => {
    const csv = await app.inject({ url: '/api/export/csv/daily' });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.body.trim().split('\n');
    expect(lines[0].split(',')).toContain('date');
    expect(lines.length - 1).toBe((db.prepare('SELECT COUNT(*) AS c FROM daily').get() as { c: number }).c);
    expect((await app.inject({ url: '/api/export/csv/oauth_tokens' })).statusCode).toBe(404);
    const file = await app.inject({ url: '/api/export/db' });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
