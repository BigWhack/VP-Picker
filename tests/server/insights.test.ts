import { describe, it, expect } from 'vitest';
import { computeFlags, headline } from '../../server/analytics/insights.js';
import type { RecoveryResult } from '../../server/analytics/recovery.js';
import type { Baseline, DailyRow } from '../../shared/types.js';

const B = (median: number, iqr = 4): Baseline => ({ median, iqr, low: median - iqr / 2, high: median + iqr / 2, n: 30 });
const rec = (score: number | null, band: RecoveryResult['band'], comps: Partial<Record<string, [number, number]>> = {}): RecoveryResult => ({
  score, band,
  components: (['hrv', 'rhr', 'sleep', 'resp', 'form'] as const).map((key) => ({
    key, value: comps[key]?.[0] ?? null, z: comps[key] ? 1 : null, weight: 1, contribution: comps[key]?.[1] ?? null, missing: !comps[key],
  })),
});

describe('headline', () => {
  it('uses the band copy with a sleep phrase', () => {
    expect(headline(rec(82, 'well'), 424).headline).toBe("You're well recovered after 7 hours of sleep. A good day to train hard.");
    expect(headline(rec(50, 'moderate'), 424).headline).toBe("You're moderately recovered after 7 hours of sleep. Keep today steady.");
    expect(headline(rec(20, 'low'), 424).headline).toBe('Recovery is low after 7 hours of sleep. Take it easy today.');
  });
  it('drops the sleep clause without sleep and handles no score', () => {
    expect(headline(rec(82, 'well'), null).headline).toBe("You're well recovered. A good day to train hard.");
    expect(headline(rec(null, null), 424).headline).toBe('Not enough data yet to judge recovery.');
  });
  it('explains the two biggest contributors', () => {
    const r = rec(82, 'well', { hrv: [58, 9], rhr: [50, 4], sleep: [424, -1] });
    const { detail } = headline(r, 424, { baselines: { hrv: B(51.8), rhr: B(53) }, needMin: 450 });
    expect(detail).toBe('HRV is 12% above your 30-day baseline. Resting heart rate is at the low end of your range.');
  });
});

describe('flags', () => {
  const days = (rhr: number[]): DailyRow[] => rhr.map((v, i) => ({ date: `2026-11-${10 + i}`, rhr: v, resp: 14, hrvNight: 50 })) as unknown as DailyRow[];
  const base = { rhr: B(52), resp: B(14, 1), hrv: B(50, 6) };
  it('fires rhr_elevated only after two elevated days', () => {
    expect(computeFlags(days([52, 58, 58]), base, 0, 1).map((f) => f.kind)).toContain('rhr_elevated');
    expect(computeFlags(days([52, 52, 58]), base, 0, 1).map((f) => f.kind)).not.toContain('rhr_elevated');
  });
  it('fires sleep_debt above 300 minutes', () => {
    expect(computeFlags(days([52]), base, 301, 1).map((f) => f.kind)).toContain('sleep_debt');
    expect(computeFlags(days([52]), base, 300, 1).map((f) => f.kind)).not.toContain('sleep_debt');
  });
  it('fires ramping, resp and hrv flags', () => {
    const d: DailyRow[] = [40, 40, 40].map((h, i) => ({ date: `2026-11-1${i}`, rhr: 52, resp: i === 2 ? 16 : 14, hrvNight: h })) as unknown as DailyRow[];
    const kinds = computeFlags(d, base, 0, 1.6).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['ramping', 'resp_elevated', 'hrv_low']));
  });
});
