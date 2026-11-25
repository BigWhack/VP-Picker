import { describe, it, expect } from 'vitest';
import { findPatterns } from '../../server/analytics/patterns.js';
import type { DailyRow } from '../../shared/types.js';

function rows(n: number, f: (i: number, rnd: () => number) => Record<string, number>): DailyRow[] {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), ...f(i, rnd) })) as unknown as DailyRow[];
}

describe('patterns', () => {
  it('finds later bedtimes going with lower recovery', () => {
    const data = rows(80, (_i, r) => { const bed = 240 + r() * 120; return { bedtime: bed, recovery: 90 - (bed - 240) * 0.4 + r() * 10 }; });
    const p = findPatterns(data);
    const bed = p.find((x) => x.driver === 'bedtime' && x.outcome === 'recovery')!;
    expect(bed.rho).toBeLessThan(-0.3);
    expect(bed.text).toMatch(/bed later/);
    expect(bed.text).toMatch(/recovery tends to be lower/);
    expect(bed.points.length).toBe(bed.n);
  });

  it('ignores noise', () => {
    const data = rows(80, (_i, r) => ({ bedtime: r() * 120, recovery: r() * 100, steps: r() * 10000, rhr: 50 + r() * 5 }));
    expect(findPatterns(data).filter((p) => Math.abs(p.rho) >= 0.3)).toHaveLength(0);
  });

  it('needs at least 30 pairs', () => {
    const data = rows(20, (_i, r) => { const bed = 240 + r() * 120; return { bedtime: bed, recovery: 90 - (bed - 240) * 0.4 }; });
    expect(findPatterns(data)).toHaveLength(0);
  });

  it('pairs daytime drivers with the next day', () => {
    const data = rows(80, (i) => ({ load: i % 2 ? 150 : 0, hrvNight: i % 2 ? 60 : 40 }));
    // load on odd days is followed by HRV on even days (40) → negative relationship next day
    const p = findPatterns(data).find((x) => x.driver === 'load' && x.outcome === 'hrv')!;
    expect(p.rho).toBeLessThan(-0.9);
    expect(p.text).toMatch(/next-day HRV/);
  });
});
