import type { Db } from '../db/client.js';
import type { Streams } from '../../shared/types.js';
import { getExtras, listWorkouts, type MergedWorkout } from '../repo/workouts.js';
import { getAnalysis } from '../repo/derived.js';
import { localDate } from './dates.js';
import { savePersonalRecords, getPersonalRecords } from '../repo/derived.js';

export const STANDARD = [
  { label: '400 m', distanceM: 400 }, { label: '1 km', distanceM: 1000 }, { label: '1 mile', distanceM: 1609.34 },
  { label: '5K', distanceM: 5000 }, { label: '10K', distanceM: 10000 }, { label: 'Half marathon', distanceM: 21097.5 }, { label: 'Marathon', distanceM: 42195 },
];
const RACES = STANDARD.slice(3);

export const riegel = (t1S: number, d1M: number, d2M: number, exp = 1.06) => t1S * (d2M / d1M) ** exp;

/** Daniels & Gilbert VDOT from a race performance. */
export function vdot(distM: number, timeS: number): number {
  const t = timeS / 60; const v = distM / t;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}

/** Race time (s) for a distance at a given VDOT, by bisection. */
export function timeForVdot(v: number, distM: number): number {
  let lo = distM / 10; let hi = distM * 2; // 10 m/s … 0.5 m/s
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (vdot(distM, mid) > v) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Fastest time to cover `target` metres anywhere in a distance stream (two-pointer, interpolated). */
export function fastestWindow(time: number[], distance: number[], target: number): number | null {
  if (!distance.length || distance[distance.length - 1] - distance[0] < target) return null;
  let best = Infinity; let j = 0;
  for (let i = 0; i < distance.length; i++) {
    while (j < distance.length && distance[j] - distance[i] < target) j++;
    if (j >= distance.length) break;
    const over = distance[j] - distance[i] - target;
    const seg = distance[j] - distance[j - 1];
    const tEnd = seg > 0 ? time[j] - (over / seg) * (time[j] - time[j - 1]) : time[j];
    best = Math.min(best, tEnd - time[i]);
  }
  return Number.isFinite(best) ? best : null;
}

export interface Effort { distanceM: number; timeS: number; workoutId: string; date: string }

/** Chronological PR progression per distance: each effort that beats every earlier one. */
export function prHistory(efforts: Effort[]): Effort[] {
  const best = new Map<number, number>(); const out: Effort[] = [];
  for (const e of [...efforts].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = Math.round(e.distanceM);
    if (e.timeS < (best.get(key) ?? Infinity)) { best.set(key, e.timeS); out.push(e); }
  }
  return out;
}

/** Predictions for 5K/10K/half/marathon from the effort (≥ 1 km) with the highest VDOT. */
export function predictions(recent: Effort[]): { label: string; distanceM: number; riegelS: number; vdotS: number; from: Effort }[] {
  const usable = recent.filter((e) => e.distanceM >= 1000 && e.timeS > 0);
  if (!usable.length) return [];
  const src = usable.reduce((a, b) => (vdot(b.distanceM, b.timeS) > vdot(a.distanceM, a.timeS) ? b : a));
  const v = vdot(src.distanceM, src.timeS);
  return RACES.map((r) => ({ label: r.label, distanceM: r.distanceM, riegelS: riegel(src.timeS, src.distanceM, r.distanceM), vdotS: timeForVdot(v, r.distanceM), from: src }));
}

/** Best efforts for one run: Strava's own best efforts when present, else fastest windows on the distance stream. */
export function effortsFor(db: Db, w: MergedWorkout, streams: Streams | null, tz: string): Effort[] {
  const date = localDate(w.start, tz);
  const ex = w.stravaId ? getExtras(db, w.stravaId) : null;
  const be = (ex?.bestEfforts ?? null) as { distance: number; elapsed_time: number }[] | null;
  const out: Effort[] = [];
  if (be?.length) {
    for (const e of be) {
      const std = STANDARD.find((s) => Math.abs(s.distanceM - e.distance) < 5);
      if (std) out.push({ distanceM: std.distanceM, timeS: e.elapsed_time, workoutId: w.id, date });
    }
    return out;
  }
  if (!streams?.distance) return out;
  for (const std of STANDARD) {
    const t = fastestWindow(streams.time, streams.distance, std.distanceM);
    if (t) out.push({ distanceM: std.distanceM, timeS: t, workoutId: w.id, date });
  }
  return out;
}

/** Efforts for every run, read from the cached per-workout analyses (no stream decompression). */
export function collectEfforts(db: Db): Effort[] {
  const out: Effort[] = [];
  for (const w of listWorkouts(db, { sport: 'run' }).items) {
    const a = getAnalysis<{ efforts?: Effort[] }>(db, w.id);
    for (const e of a?.efforts ?? []) out.push({ ...e, workoutId: w.id });
  }
  return out;
}

export function rebuildRecords(db: Db): void {
  savePersonalRecords(db, prHistory(collectEfforts(db)).map((e) => ({ kind: 'pr', ...e })));
}

export function recordsBoard(db: Db, today: string) {
  const history = getPersonalRecords(db);
  const current = STANDARD.map((s) => {
    const rows = history.filter((r) => Math.abs(r.distanceM - s.distanceM) < 1).sort((a, b) => a.timeS - b.timeS);
    return { label: s.label, distanceM: s.distanceM, best: rows[0] ?? null, history: [...rows].sort((a, b) => a.date.localeCompare(b.date)) };
  });
  const since = new Date(Date.parse(today) - 90 * 86400000).toISOString().slice(0, 10);
  const recent = collectEfforts(db).filter((e) => e.date >= since);
  return { current, predictions: predictions(recent) };
}
