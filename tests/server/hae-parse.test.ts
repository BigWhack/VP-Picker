import { describe, it, expect } from 'vitest';
import { parseHaeFile, type HaeItem } from '../../server/ingest/hae/parse.js';
import { normalizeMetric, normalizeWorkout, parseHaeDate } from '../../server/ingest/hae/normalize.js';
import type { Sample, SleepSegment } from '../../shared/types.js';

const fx = (f: string) => new URL(`../fixtures/hae/${f}`, import.meta.url).pathname;

async function collect(file: string): Promise<HaeItem[]> {
  const out: HaeItem[] = [];
  for await (const item of parseHaeFile(fx(file))) out.push(item);
  return out;
}

async function normalized(file: string) {
  const samples: Sample[] = []; const sleep: SleepSegment[] = [];
  for (const it of await collect(file)) {
    if (it.kind === 'metric') {
      const n = normalizeMetric(it.name, it.units, it.point);
      samples.push(...n.samples); sleep.push(...n.sleep);
    }
  }
  return { samples, sleep };
}

describe('HAE parsing', () => {
  it('parses HAE dates to UTC ISO with offset', () => {
    expect(parseHaeDate('2026-11-24 06:34:00 +0000')).toEqual({ iso: '2026-11-24T06:34:00.000Z', offsetMin: 0 });
    expect(parseHaeDate('2024-02-06 14:30:00 -0800')).toEqual({ iso: '2024-02-06T22:30:00.000Z', offsetMin: -480 });
  });

  it('streams metric points with their metric name, even when name comes after data', async () => {
    const items = await collect('metrics-hourly.json');
    const names = items.filter((i) => i.kind === 'metric').map((i) => (i as { name: string }).name);
    expect(names).toContain('heart_rate_variability');
    expect(names.filter((n) => n === 'step_count')).toHaveLength(2);
  });

  it('normalises qty, heart-rate and unit conversions', async () => {
    const { samples } = await normalized('metrics-hourly.json');
    expect(samples.filter((s) => s.metric === 'steps').map((s) => s.value)).toEqual([820, 1310]);
    const hr = samples.filter((s) => s.start === '2026-11-24T07:00:00.000Z' && s.metric.startsWith('hr'));
    expect(Object.fromEntries(hr.map((s) => [s.metric, s.value]))).toEqual({ hr: 61, hrMin: 48, hrMax: 92 });
    const dist = samples.find((s) => s.metric === 'distance')!;
    expect(dist.value).toBeCloseTo(1.609, 3);
    expect(dist.unit).toBe('km');
    expect(samples.find((s) => s.metric === 'hae:mystery_metric')).toMatchObject({ value: 3, source: 'unknown' });
  });

  it('turns unsummarised sleep into stage segments and ignores summarised sleep', async () => {
    const { sleep } = await normalized('sleep-raw.json');
    expect(sleep.map((s) => s.stage)).toEqual(['core', 'deep', 'awake', 'rem', 'asleep', 'inBed']);
    expect(sleep[1]).toEqual({ start: '2026-11-23T23:32:00.000Z', end: '2026-11-24T00:17:00.000Z', stage: 'deep', source: "Jack's Apple Watch" });
  });

  it('normalises a v2 workout with route and heart rate into a record and streams', async () => {
    const ws = (await collect('workouts.json')).filter((i) => i.kind === 'workout');
    expect(ws).toHaveLength(2);
    const run = normalizeWorkout((ws[0] as { w: Record<string, unknown> }).w);
    expect(run.record).toMatchObject({ source: 'apple', sourceId: '550e8400-e29b-41d4-a716-446655440000', sport: 'run',
      start: '2026-11-23T07:00:00.000Z', durationS: 3134, distanceM: 10200, energyKcal: 642, avgHr: 148, maxHr: 171, elevGainM: 48 });
    expect(run.streams!.latlng!.length).toBe(3);
    expect(run.streams!.time).toEqual([0, 4, 8]);
    expect(run.streams!.heartrate).toEqual([110, 110, 120]);
    expect(run.streams!.distance![2]).toBeGreaterThan(20);
    const lift = normalizeWorkout((ws[1] as { w: Record<string, unknown> }).w);
    expect(lift.record.sport).toBe('strength');
    expect(lift.streams).toBeNull();
  });
});
