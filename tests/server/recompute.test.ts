import { describe, it, expect } from 'vitest';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { recompute } from '../../server/analytics/recompute.js';
import { getScores, getDaily, getBaselines, getLoad } from '../../server/repo/derived.js';

const now = new Date('2026-11-24T08:00:00Z');

describe('recompute', () => {
  it('produces a recovery score, headline, baselines and load for today', async () => {
    const db = testDb();
    seedDemo(db, 60, now);
    await recompute(db, { now });
    const s = getScores(db, '2026-11-24')!;
    expect(s.recovery).toBeGreaterThanOrEqual(0);
    expect(s.recovery).toBeLessThanOrEqual(100);
    expect(s.headline).toMatch(/recover/);
    expect(s.sleepScore).toBeGreaterThan(0);
    expect(getBaselines(db, '2026-11-24').hrv.n).toBe(30);
    const today = getDaily(db, '2026-11-24', '2026-11-24')[0];
    expect(today.asleepMin).toBeGreaterThan(300);
    expect(today.steps).toBeGreaterThan(5000);
    expect(today.recovery).toBe(s.recovery);
    expect(getLoad(db, '2026-11-01', '2026-11-24').length).toBe(24);
  });

  it('is deterministic', async () => {
    const db = testDb();
    seedDemo(db, 60, now);
    await recompute(db, { now });
    const a = JSON.stringify([getDaily(db, '2026-10-01', '2026-11-24'), getScores(db, '2026-11-24')]);
    await recompute(db, { now });
    const b = JSON.stringify([getDaily(db, '2026-10-01', '2026-11-24'), getScores(db, '2026-11-24')]);
    expect(b).toBe(a);
  });

  it('handles days with no data', async () => {
    const db = testDb();
    await recompute(db, { from: '2026-11-20', to: '2026-11-24', now });
    const rows = getDaily(db, '2026-11-20', '2026-11-24');
    expect(rows).toHaveLength(5);
    expect(rows[4].asleepMin).toBeNull();
    expect(getScores(db, '2026-11-24')!.recovery).toBeNull();
    expect(getScores(db, '2026-11-24')!.headline).toBe('Not enough data yet to judge recovery.');
  });
});
