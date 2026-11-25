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
    // One value per time slot: when several sources (or combined "Watch|iPhone" strings) report the same slot,
    // keep the largest, then add the slots up. Avoids both double counting and dropping hours.
    const bySlot = new Map<string, number>();
    for (const s of samples) bySlot.set(s.start, Math.max(bySlot.get(s.start) ?? -Infinity, s.value));
    let total = 0;
    for (const v of bySlot.values()) total += v;
    return total;
  }
  const vals = samples.map((s) => s.value);
  if (rule === 'avg') return mean(vals);
  if (rule === 'min') return Math.min(...vals);
  if (rule === 'max') return Math.max(...vals);
  return [...samples].sort((a, b) => a.start.localeCompare(b.start))[samples.length - 1].value;
}

/** Samples (sorted by start) whose start lies within [fromIso, toIso], found by binary search. */
function windowOf(sorted: Sample[], fromIso: string, toIso: string): Sample[] {
  const lower = (x: string) => { let lo = 0; let hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].start < x) lo = m + 1; else hi = m; } return lo; };
  const upper = (x: string) => { let lo = 0; let hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].start <= x) lo = m + 1; else hi = m; } return lo; };
  return sorted.slice(lower(fromIso), upper(toIso));
}


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

  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourCache = new Map<string, string>();
  // Local date per sample; cached per UTC hour (time zones change on whole/half hours, so 30-minute keys are safe).
  const dayOf = (iso: string) => {
    const k = iso.slice(0, 13) + (iso.slice(14, 16) < '30' ? 'a' : 'b');
    let d = hourCache.get(k);
    if (!d) { d = fmt.format(new Date(iso)); hourCache.set(k, d); }
    return d;
  };
  const byMetric = new Map<string, Sample[]>();
  for (const key of [...(Object.keys(METRICS) as MetricKey[]), 'hrMin']) byMetric.set(key, getSamples(db, key, fromIso, toIso));

  for (const key of Object.keys(METRICS) as MetricKey[]) {
    const buckets = new Map<string, Sample[]>();
    for (const s of byMetric.get(key)!) {
      const d = dayOf(s.start);
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
    const hrvN = windowOf(byMetric.get('hrv')!, n.start, n.end);
    row.hrvNight = hrvN.length ? mean(hrvN.map((x) => x.value)) : null;
    let low = Infinity;
    for (const x of windowOf(byMetric.get('hrMin')!, n.start, n.end)) low = Math.min(low, x.value);
    for (const x of windowOf(byMetric.get('hr')!, n.start, n.end)) low = Math.min(low, x.value);
    row.lowestHr = Number.isFinite(low) ? low : null;
    const resp = windowOf(byMetric.get('resp')!, n.start, n.end);
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
