import { describe, it, expect } from 'vitest';
import { assignNights, summarizeNight, sleepDebt, circularSdMin, sleepScore } from '../../server/analytics/sleep.js';
import type { SleepSegment, SleepStage } from '../../shared/types.js';

const MOCK: [SleepStage, number][] = [['core', 20], ['deep', 45], ['core', 40], ['rem', 20], ['core', 35], ['awake', 5],
  ['deep', 21], ['core', 50], ['rem', 28], ['core', 45], ['awake', 8], ['rem', 30], ['core', 40], ['rem', 28], ['core', 22], ['awake', 5]];

function build(startIso: string, seq: [SleepStage, number][], source = "Jack's Apple Watch"): SleepSegment[] {
  let t = Date.parse(startIso);
  return seq.map(([stage, min]) => {
    const s = { start: new Date(t).toISOString(), end: new Date(t + min * 60000).toISOString(), stage, source };
    t += min * 60000;
    return s;
  });
}

describe('sleep analytics', () => {
  it('summarises the mockup night', () => {
    const { nights } = assignNights(build('2026-11-23T23:12:00Z', MOCK), 'Europe/London');
    expect(nights).toHaveLength(1);
    expect(summarizeNight(nights[0])).toMatchObject({
      date: '2026-11-24', asleepMin: 424, inBedMin: 442, bedtime: '2026-11-23T23:12:00.000Z', wake: '2026-11-24T06:34:00.000Z',
      stages: { deep: 66, core: 252, rem: 106, awake: 18 }, awakenings: 2,
    });
    expect(summarizeNight(nights[0]).efficiency).toBeCloseTo(424 / 442, 5);
  });

  it('treats an afternoon session as a nap', () => {
    const segs = [...build('2026-11-23T23:12:00Z', MOCK), ...build('2026-11-24T14:30:00Z', [['core', 40]])];
    const { nights, naps } = assignNights(segs, 'Europe/London');
    expect(nights).toHaveLength(1);
    expect(naps).toHaveLength(1);
    expect(naps[0].date).toBe('2026-11-24');
  });

  it('handles the October clock change as one night', () => {
    const segs = build('2026-10-24T22:00:00Z', [['core', 300], ['deep', 120], ['rem', 120]]); // 23:00 BST → 07:00 GMT
    const { nights } = assignNights(segs, 'Europe/London');
    expect(nights).toHaveLength(1);
    expect(summarizeNight(nights[0])).toMatchObject({ date: '2026-10-25', inBedMin: 540, asleepMin: 540 });
  });

  it('merges blocks separated by less than 45 minutes', () => {
    const merged = assignNights([...build('2026-11-23T23:00:00Z', [['core', 120]]), ...build('2026-11-24T01:30:00Z', [['core', 300]])], 'Europe/London');
    expect(merged.nights.length + merged.naps.length).toBe(1);
    const split = assignNights([...build('2026-11-23T23:00:00Z', [['core', 120]]), ...build('2026-11-24T02:00:00Z', [['core', 300]])], 'Europe/London');
    expect(split.nights.length + split.naps.length).toBe(2);
    expect(split.nights).toHaveLength(1);
    expect(summarizeNight(split.nights[0]).asleepMin).toBe(300);
  });

  it('prefers Apple Watch stages over iPhone ones and uses in-bed samples', () => {
    const watch = build('2026-11-23T23:12:00Z', MOCK);
    const phone = build('2026-11-23T23:00:00Z', [['asleep', 400]], "Jack's iPhone");
    const inBed: SleepSegment = { start: '2026-11-23T23:00:00.000Z', end: '2026-11-24T06:40:00.000Z', stage: 'inBed', source: "Jack's iPhone" };
    const { nights } = assignNights([...watch, ...phone, inBed], 'Europe/London');
    const s = summarizeNight(nights[0]);
    expect(s.asleepMin).toBe(424);
    expect(s.inBedMin).toBe(460);
  });

  it('computes sleep debt with capped surplus', () => {
    expect(sleepDebt([420, 480, 400], 450)).toBe(50);
    expect(sleepDebt([600, 600], 450)).toBe(0);
  });

  it('computes circular SD across midnight', () => {
    expect(circularSdMin(['23:30', '00:30'])).toBeCloseTo(30, 0);
  });

  it('gives a perfect night a score of 100', () => {
    expect(sleepScore({ asleepMin: 450, needMin: 450, efficiency: 0.95, restorativeShare: 0.4,
      baselineRestorativeShare: 0.4, regularitySdMin: 15 }).score).toBe(100);
    const poor = sleepScore({ asleepMin: 225, needMin: 450, efficiency: 0.7, restorativeShare: 0.2,
      baselineRestorativeShare: 0.4, regularitySdMin: 60 });
    expect(poor.score).toBe(35);
  });
});
