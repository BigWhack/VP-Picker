import { describe, it, expect } from 'vitest';
import { trimpFromAverage, trimpFromStream, loadSeries, monotonyStrain, estimateHrMax } from '../../server/analytics/load.js';
import { hrZoneBounds, timeInZones } from '../../server/analytics/zones.js';

describe('training load', () => {
  it('computes Banister TRIMP from average HR', () => {
    expect(trimpFromAverage(150, 3600, 50, 190, 'male')).toBeCloseTo(108.10, 1);
    expect(trimpFromAverage(150, 3600, 50, 190, 'female')).toBeCloseTo(121.50, 1);
  });
  it('stream TRIMP matches the average version for constant HR', () => {
    const t = Array.from({ length: 3601 }, (_, i) => i);
    expect(trimpFromStream(t, t.map(() => 150), 50, 190, 'male')).toBeCloseTo(108.10, 0);
  });
  it('builds ATL/CTL/TSB from zero', () => {
    const s = loadSeries([{ date: '2026-01-01', load: 100 }]);
    expect(s[0].atl).toBeCloseTo(13.31, 2);
    expect(s[0].ctl).toBeCloseTo(2.35, 2);
    expect(s[0].tsb).toBe(0);
  });
  it('fills missing days and converges under constant load', () => {
    const days = Array.from({ length: 200 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), load: 100 }));
    const s = loadSeries(days);
    const last = s[s.length - 1];
    expect(last.atl).toBeCloseTo(100, 0);
    expect(Math.abs(last.ctl - 100)).toBeLessThan(1);
    expect(Math.abs(last.tsb)).toBeLessThan(1);
    expect(last.acwr).toBeCloseTo(1, 5);
    const gap = loadSeries([{ date: '2026-01-01', load: 100 }, { date: '2026-01-04', load: 100 }]);
    expect(gap.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });
  it('monotony and strain', () => {
    expect(monotonyStrain([0, 0, 0, 0, 0, 0, 0])).toEqual({ monotony: null, strain: null });
    const m = monotonyStrain([100, 50, 100, 50, 100, 50, 100]);
    expect(m.monotony).toBeGreaterThan(2);
  });
  it('estimates HR max', () => {
    expect(estimateHrMax([180, 185, 190, 182, 179], null)).toBe(190);
    expect(estimateHrMax([180], 40)).toBe(180);
    expect(estimateHrMax([], null)).toBeNull();
  });
});

describe('zones', () => {
  it('heart-rate-reserve zone bounds', () => {
    expect(hrZoneBounds(50, 190, 'hrr')).toEqual([120, 134, 148, 162, 176, 190]);
    expect(hrZoneBounds(50, 200, 'pctMax')).toEqual([100, 120, 140, 160, 180, 200]);
  });
  it('time in zones, with below-Z1 counted as Z1', () => {
    const t = Array.from({ length: 601 }, (_, i) => i);
    expect(timeInZones(t, t.map(() => 140), [120, 134, 148, 162, 176, 190])).toEqual([0, 600, 0, 0, 0]);
    expect(timeInZones(t, t.map(() => 90), [120, 134, 148, 162, 176, 190])).toEqual([600, 0, 0, 0, 0]);
  });
});
