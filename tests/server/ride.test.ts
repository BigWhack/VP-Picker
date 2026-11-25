import { describe, it, expect } from 'vitest';
import { detectClimbs, windShare, normalizedPower, tss, analyzeRide } from '../../server/analytics/ride.js';
import type { Streams } from '../../shared/types.js';

function profile(segments: [number, number][], step = 10): Streams {
  // segments: [lengthM, gradeFraction]
  const s: Streams = { time: [], distance: [], altitude: [] };
  let d = 0; let a = 100; let t = 0;
  s.time.push(0); s.distance!.push(0); s.altitude!.push(a);
  for (const [len, g] of segments) for (let x = 0; x < len; x += step) { d += step; a += step * g; t += 2; s.time.push(t); s.distance!.push(d); s.altitude!.push(a); }
  return s;
}

describe('cycling analytics', () => {
  it('detects a 1 km climb at 5%', () => {
    const c = detectClimbs(profile([[1000, 0.05], [1000, 0]]));
    expect(c).toHaveLength(1);
    expect(c[0].gainM).toBeCloseTo(50, -1);
    expect(c[0].lengthM).toBeGreaterThanOrEqual(900);
    expect(c[0].vamMh).toBeGreaterThan(0);
  });

  it('ignores short steep ramps', () => {
    expect(detectClimbs(profile([[300, 0.08], [1000, 0]]))).toHaveLength(0);
  });

  it('splits wind into head, tail and cross shares', () => {
    const north: [number, number][] = Array.from({ length: 20 }, (_, i) => [51 + i * 0.001, 0]);
    expect(windShare(north, 0).head).toBeCloseTo(1);
    expect(windShare([...north].reverse(), 0).tail).toBeCloseTo(1);
    expect(windShare(north, 90).cross).toBeCloseTo(1);
  });

  it('normalised power and TSS', () => {
    const t = Array.from({ length: 3601 }, (_, i) => i);
    expect(normalizedPower(t, t.map(() => 200))).toBeCloseTo(200, 5);
    expect(tss(200, 200, 3600)).toBeCloseTo(100);
    expect(normalizedPower(t.slice(0, 10), t.slice(0, 10).map(() => 200))).toBeNull();
  });

  it('omits power without a power meter', () => {
    const s = profile([[2000, 0.01]]);
    const a = analyzeRide({ start: '2026-11-22T09:00:00Z', end: '2026-11-22T10:00:00Z', durationS: 3600, distanceM: 2000 }, s, null,
      { hrRest: 50, hrMax: 190, sex: 'male', zoneModel: 'hrr' }, undefined);
    expect(a.power).toBeNull();
    expect(JSON.stringify(a)).not.toContain('NaN');
  });
});
