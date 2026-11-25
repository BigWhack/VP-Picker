import { describe, it, expect } from 'vitest';
import { riegel, vdot, timeForVdot, prHistory, fastestWindow, predictions } from '../../server/analytics/records.js';

describe('records and predictions', () => {
  it('Riegel', () => { expect(riegel(1200, 5000, 10000)).toBeCloseTo(2501.9, 1); });
  it('Daniels VDOT round-trips', () => {
    expect(vdot(5000, 1200)).toBeCloseTo(49.81, 2);
    expect(timeForVdot(vdot(5000, 1200), 5000)).toBeCloseTo(1200, 0);
  });
  it('fastest rolling window on a distance stream', () => {
    // 2 km: first km at 5:00, second at 4:00
    const time: number[] = []; const distance: number[] = [];
    for (let t = 0; t <= 300; t++) { time.push(t); distance.push(t * (1000 / 300)); }
    for (let t = 1; t <= 240; t++) { time.push(300 + t); distance.push(1000 + t * (1000 / 240)); }
    expect(fastestWindow(time, distance, 1000)).toBeCloseTo(240, 0);
    expect(fastestWindow(time, distance, 5000)).toBeNull();
  });
  it('keeps PR history: faster efforts become PRs, slower ones do not', () => {
    const h = prHistory([
      { distanceM: 5000, timeS: 1300, workoutId: 'a', date: '2026-09-01' },
      { distanceM: 5000, timeS: 1250, workoutId: 'b', date: '2026-10-01' },
      { distanceM: 5000, timeS: 1280, workoutId: 'c', date: '2026-11-01' },
    ]);
    expect(h.map((r) => r.workoutId)).toEqual(['a', 'b']);
    expect(h.map((r) => r.date)).toEqual(['2026-09-01', '2026-10-01']);
  });
  it('predicts race times from the best recent effort', () => {
    const p = predictions([{ distanceM: 5000, timeS: 1200, workoutId: 'x', date: '2026-11-20' }, { distanceM: 1000, timeS: 300, workoutId: 'y', date: '2026-11-21' }]);
    const tenK = p.find((r) => r.distanceM === 10000)!;
    expect(tenK.riegelS).toBeCloseTo(2501.9, 0);
    expect(tenK.vdotS).toBeGreaterThan(2400);
    expect(tenK.vdotS).toBeLessThan(2600);
    expect(p.map((r) => r.label)).toEqual(['5K', '10K', 'Half marathon', 'Marathon']);
  });
});
