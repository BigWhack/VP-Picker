import { describe, it, expect } from 'vitest';
import { computeBaseline, robustZ } from '../../server/analytics/baseline.js';
import { quantile, spearman } from '../../server/analytics/stats.js';

describe('baselines', () => {
  it('computes median, IQR and usual range', () => {
    const b = computeBaseline([1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(b).toMatchObject({ median: 5, iqr: 4, low: 3, high: 7, n: 9 });
  });
  it('needs at least 7 values', () => {
    expect(computeBaseline([1, 2, 3])).toBeNull();
  });
  it('robust z-score, clipped to ±3, zero when IQR is zero', () => {
    const b = computeBaseline([1, 2, 3, 4, 5, 6, 7, 8, 9])!;
    expect(robustZ(9, b)).toBeCloseTo(1.35, 5);
    expect(robustZ(100, b)).toBe(3);
    expect(robustZ(-100, b)).toBe(-3);
    expect(robustZ(5, computeBaseline([5, 5, 5, 5, 5, 5, 5])!)).toBe(0);
  });
  it('quantile uses linear interpolation', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it('spearman rank correlation', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});
