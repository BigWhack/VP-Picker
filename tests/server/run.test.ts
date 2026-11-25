import { describe, it, expect } from 'vitest';
import { gapFactor, minettiCost, kmSplits, decouplingPct, efficiencyFactor, strideLengthM, runForm, similarRuns, analyzeRun } from '../../server/analytics/run.js';
import type { Sample, Streams } from '../../shared/types.js';

function flatRun(distanceM: number, speed = 3.25, hr = (t: number) => 150): Streams {
  const s: Streams = { time: [], distance: [], speed: [], heartrate: [], cadence: [], altitude: [], grade: [] };
  const dur = distanceM / speed;
  const times = Array.from({ length: Math.floor(dur) + 1 }, (_, i) => i);
  if (times[times.length - 1] < dur) times.push(dur);
  for (const t of times) {
    s.time.push(t); s.distance!.push(Math.min(distanceM, t * speed)); s.speed!.push(speed);
    s.heartrate!.push(hr(t)); s.cadence!.push(85); s.altitude!.push(10); s.grade!.push(0);
  }
  return s;
}

describe('running analytics', () => {
  it('Minetti grade-adjusted factors', () => {
    expect(minettiCost(0)).toBeCloseTo(3.6);
    expect(gapFactor(0.1)).toBeCloseTo(1.6578, 3);
    expect(gapFactor(-0.1)).toBeCloseTo(0.5977, 3);
    expect(gapFactor(0.9)).toBeCloseTo(gapFactor(0.45));
  });

  it('per-km splits with a partial last split', () => {
    const sp = kmSplits(flatRun(10200))!;
    expect(sp).toHaveLength(11);
    expect(sp[0].paceS).toBeCloseTo(1000 / 3.25, 0);
    expect(sp[10].distanceKm).toBeCloseTo(0.2, 2);
    expect(sp[10].paceS).toBeCloseTo(1000 / 3.25, 0);
    expect(sp[0].cadenceSpm).toBe(170);
    expect(sp[0].gapPaceS).toBeCloseTo(sp[0].paceS, 0);
    expect(sp[0].avgHr).toBe(150);
  });

  it('aerobic decoupling between halves', () => {
    const s = flatRun(6000, 3, (t) => (t < 1000 ? 140 : 147));
    expect(decouplingPct(s)).toBeCloseTo(4.76, 2);
  });

  it('efficiency factor and stride length', () => {
    expect(efficiencyFactor(flatRun(5000, 3, () => 150))).toBeCloseTo(180 / 150, 3);
    expect(strideLengthM(3, 180)).toBeCloseTo(1.0);
    expect(strideLengthM(3, 0)).toBeNull();
  });

  it('averages Apple running form samples in the workout window', () => {
    const at = (m: string, t: string, v: number): Sample => ({ metric: m, start: t, end: t, value: v, unit: '', source: 'w' });
    const f = runForm([at('runPower', '2026-11-23T07:10:00Z', 250), at('runPower', '2026-11-23T07:20:00Z', 270), at('groundContact', '2026-11-23T07:10:00Z', 240),
      at('runPower', '2026-11-23T09:00:00Z', 999)], '2026-11-23T07:00:00Z', '2026-11-23T07:52:00Z');
    expect(f).toEqual({ power: 260, strideLength: null, groundContactMs: 240, vertOscCm: null });
  });

  it('finds similar runs within ±10% distance in the last 90 days', () => {
    const all = [
      { id: 'a', distanceM: 10000, start: '2026-11-01T07:00:00Z', paceS: 310, avgHr: 150, ef: 1.2 },
      { id: 'b', distanceM: 5000, start: '2026-11-02T07:00:00Z', paceS: 300, avgHr: 150, ef: 1.2 },
      { id: 'c', distanceM: 10500, start: '2026-06-01T07:00:00Z', paceS: 300, avgHr: 150, ef: 1.2 },
    ];
    expect(similarRuns({ distanceM: 10200, start: '2026-11-23T07:00:00Z' }, all).map((r) => r.id)).toEqual(['a']);
  });

  it('treadmill run without GPS or distance stream gives nulls, never NaN', () => {
    const s: Streams = { time: [0, 5, 10], heartrate: [140, 141, 142] };
    expect(kmSplits(s)).toBeNull();
    expect(decouplingPct(s)).toBeNull();
    const a = analyzeRun({ start: '2026-11-23T07:00:00Z', end: '2026-11-23T07:30:00Z', durationS: 1800, distanceM: 5000, avgHr: 141 }, s, [],
      { hrRest: 50, hrMax: 190, sex: 'male', zoneModel: 'hrr' });
    expect(JSON.stringify(a)).not.toContain('NaN');
    expect(a.splits).toBeNull();
    expect(a.paceS).toBeCloseTo(360);
    expect(analyzeRun({ start: '2026-11-23T07:00:00Z', end: '2026-11-23T07:30:00Z', durationS: 1800 }, null, [], { hrRest: 50, hrMax: 190, sex: 'male', zoneModel: 'hrr' }).zones).toBeNull();
  });
});
