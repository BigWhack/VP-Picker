import { describe, it, expect } from 'vitest';
import { recoveryScore, type RecoveryInput } from '../../server/analytics/recovery.js';
import type { Baseline } from '../../shared/types.js';

// median 50, iqr 13.5 → one z-unit = 10
const B = (median: number): Baseline => ({ median, iqr: 13.5, low: median - 6.75, high: median + 6.75, n: 30 });
const base: RecoveryInput = {
  hrv: 50, rhr: 50, asleepMin: 450, needMin: 450, resp: 50, tsb: 50,
  baselines: { hrv: B(50), rhr: B(50), resp: B(50), tsb: B(50) },
};

describe('recovery score', () => {
  it('scores 50 (moderate) when everything is at its median', () => {
    const r = recoveryScore(base);
    expect(r.score).toBe(50);
    expect(r.band).toBe('moderate');
  });

  it('scores 80 (well recovered) when HRV, RHR, sleep and form are all 2 z better', () => {
    const r = recoveryScore({ ...base, hrv: 70, rhr: 30, asleepMin: 540, tsb: 70 });
    expect(r.score).toBe(80);
    expect(r.band).toBe('well');
    expect(r.components.find((c) => c.key === 'rhr')!.z).toBeCloseTo(2);
  });

  it('re-normalises over available components when HRV is missing', () => {
    const r = recoveryScore({ ...base, hrv: null, rhr: 30 });
    const hrv = r.components.find((c) => c.key === 'hrv')!;
    expect(hrv.missing).toBe(true);
    expect(hrv.contribution).toBeNull();
    // wz = 25*2 / 60 = 0.8333 → 50 + 13.33 = 63
    expect(r.score).toBe(63);
    expect(Number.isNaN(r.score)).toBe(false);
  });

  it('returns null when both HRV and resting HR are missing', () => {
    const r = recoveryScore({ ...base, hrv: null, rhr: null });
    expect(r).toMatchObject({ score: null, band: null });
  });

  it('clips outliers so the score stays within 0–100', () => {
    expect(recoveryScore({ ...base, hrv: 10000, rhr: -1000, asleepMin: 5000, tsb: 5000 }).score).toBeLessThanOrEqual(100);
    expect(recoveryScore({ ...base, hrv: 0, rhr: 1000, asleepMin: 0, resp: 1000, tsb: -1000 }).score).toBe(2);
  });
});
