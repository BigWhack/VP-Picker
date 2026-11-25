import type { Db } from '../db/client.js';
import type { DailyRow, Sample } from '../../shared/types.js';
import { METRICS, type MetricKey } from '../../shared/metrics.js';
import { getSamples } from '../repo/samples.js';
import { getSleep } from '../repo/sleep.js';
import { listWorkouts } from '../repo/workouts.js';
import { assignNights, summarizeNight, type Night } from './sleep.js';
import { addDays, dateRange, localDate, localMinutes } from './dates.js';
import { mean } from './stats.js';

export const SLEEP_KEYS = ['asleepMin', 'inBedMin', 'efficiency', 'deepMin', 'coreMin', 'remMin', 'awakeMin', 'awakenings',
  'bedtime', 'wake', 'restorativeShare', 'hrvNight', 'lowestHr', 'respNight'] as const;

function aggregate(samples: Sample[], rule: 'sum' | 'avg' | 'min' | 'max' | 'last'): number | null {
  if (!samples.length) return null;
  if (rule === 'sum') {
    // Multiple sources (e.g. Watch and iPhone both counting steps): take the source with the largest total, like HealthKit's priority.
    const bySource = new Map<string, number>();
    for (const s of samples) bySource.set(s.source, (bySource.get(s.source) ?? 0) + s.value);
    return Math.max(...bySource.values());
  }
  const vals = samples.map((s) => s.value);
  if (rule === 'avg') return mean(vals);
  if (rule === 'min') return Math.min(...vals);
  if (rule === 'max') return Math.max(...vals);
  return [...samples].sort((a, b) => a.start.localeCompare(b.start))[samples.length - 1].value;
}

const inWindow = (s: Sample, n: Night) => s.start >= n.start && s.start <= n.end;

export function nightsBetween(db: Db, fromDate: string, toDate: string, tz: string): { nights: Night[]; naps: Night[] } {
  const segs = getSleep(db, `${addDays(fromDate, -2)}T00:00:00Z`, `${addDays(toDate, 1)}T23:59:59Z`);
  const r = assignNights(segs, tz);
  return { nights: r.nights.filter((n) => n.date >= fromDate && n.date <= toDate), naps: r.naps.filter((n) => n.date >= fromDate && n.date <= toDate) };
}

/** One row per local date: each catalogue metric aggregated by its daily rule, plus sleep and workout fields. */
export function buildDailyRows(db: Db, fromDate: string, toDate: string, tz: string): DailyRow[] {
  const fromIso = `${addDays(fromDate, -1)}T00:00:00Z`;
  const toIso = `${addDays(toDate, 2)}T00:00:00Z`;
  const dates = dateRange(fromDate, toDate);
  const rows = new Map<string, DailyRow>(dates.map((d) => [d, { date: d } as DailyRow]));

  const byMetric = new Map<string, Sample[]>();
  for (const key of [...(Object.keys(METRICS) as MetricKey[]), 'hrMin']) byMetric.set(key, getSamples(db, key, fromIso, toIso));

  for (const key of Object.keys(METRICS) as MetricKey[]) {
    const buckets = new Map<string, Sample[]>();
    for (const s of byMetric.get(key)!) {
      const d = localDate(s.start, tz);
      if (!rows.has(d)) continue;
      (buckets.get(d) ?? buckets.set(d, []).get(d)!).push(s);
    }
    for (const d of dates) rows.get(d)![key] = aggregate(buckets.get(d) ?? [], METRICS[key].daily);
  }

  const { nights } = nightsBetween(db, fromDate, toDate, tz);
  const nightBy = new Map(nights.map((n) => [n.date, n]));
  for (const d of dates) {
    const row = rows.get(d)!;
    const n = nightBy.get(d);
    if (!n) { for (const k of SLEEP_KEYS) row[k] = null; continue; }
    const s = summarizeNight(n);
    row.asleepMin = s.asleepMin; row.inBedMin = s.inBedMin; row.efficiency = s.efficiency;
    row.deepMin = s.stages.deep; row.coreMin = s.stages.core; row.remMin = s.stages.rem; row.awakeMin = s.stages.awake;
    row.awakenings = s.awakenings;
    row.bedtime = (localMinutes(s.bedtime, tz) - 18 * 60 + 1440) % 1440; // minutes after 18:00
    row.wake = localMinutes(s.wake, tz);
    row.restorativeShare = s.asleepMin > 0 ? (s.stages.deep + s.stages.rem) / s.asleepMin : null;
    const hrvN = byMetric.get('hrv')!.filter((x) => inWindow(x, n));
    row.hrvNight = hrvN.length ? mean(hrvN.map((x) => x.value)) : null;
    const low = [...byMetric.get('hrMin')!, ...byMetric.get('hr')!].filter((x) => inWindow(x, n));
    row.lowestHr = low.length ? Math.min(...low.map((x) => x.value)) : null;
    const resp = byMetric.get('resp')!.filter((x) => inWindow(x, n));
    row.respNight = resp.length ? mean(resp.map((x) => x.value)) : null;
  }

  const { items } = listWorkouts(db, { from: fromIso, to: toIso });
  for (const d of dates) Object.assign(rows.get(d)!, { trainingMin: 0, runKm: 0, rideKm: 0, workouts: 0, lateWorkout: 0 });
  for (const w of items) {
    const row = rows.get(localDate(w.start, tz));
    if (!row) continue;
    row.trainingMin = (row.trainingMin ?? 0) + w.durationS / 60;
    row.workouts = (row.workouts ?? 0) + 1;
    if (w.sport === 'run') row.runKm = (row.runKm ?? 0) + (w.distanceM ?? 0) / 1000;
    if (w.sport === 'ride') row.rideKm = (row.rideKm ?? 0) + (w.distanceM ?? 0) / 1000;
    if (localMinutes(w.end, tz) >= 19 * 60) row.lateWorkout = 1;
  }
  return dates.map((d) => rows.get(d)!);
}
