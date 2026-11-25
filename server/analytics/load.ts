import { CONFIG } from '../../shared/analytics-config.js';
import { mean, sd, clamp } from './stats.js';

type Sex = 'male' | 'female';
const K = (sex: Sex | undefined) => (sex === 'female' ? { k: 0.86, b: 1.67 } : { k: 0.64, b: 1.92 });

function perMinute(hr: number, hrRest: number, hrMax: number, sex: Sex | undefined): number {
  if (hrMax <= hrRest) return 0;
  const r = clamp((hr - hrRest) / (hrMax - hrRest), 0, 1);
  const { k, b } = K(sex);
  return r * k * Math.exp(b * r);
}

/** Banister TRIMP from average HR and duration. */
export function trimpFromAverage(avgHr: number, durationS: number, hrRest: number, hrMax: number, sex: Sex = 'male'): number {
  return (durationS / 60) * perMinute(avgHr, hrRest, hrMax, sex);
}

/** Banister TRIMP integrated over an HR stream (t in seconds). */
export function trimpFromStream(t: number[], hr: number[], hrRest: number, hrMax: number, sex: Sex = 'male'): number {
  let total = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = Math.min(t[i] - t[i - 1], 30); // ignore pauses longer than 30 s
    if (dt <= 0) continue;
    total += (dt / 60) * perMinute(hr[i - 1], hrRest, hrMax, sex);
  }
  return total;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export interface LoadPoint { date: string; load: number; atl: number; ctl: number; tsb: number; acwr: number | null }

/** Exponentially weighted ATL (7 d) / CTL (42 d), TSB = yesterday's CTL − ATL, ACWR = 7 d / (28 d / 4). */
export function loadSeries(daily: { date: string; load: number }[], until?: string): LoadPoint[] {
  if (!daily.length) return [];
  const byDate = new Map<string, number>();
  for (const d of daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.load);
  const dates = [...byDate.keys()].sort();
  const end = until && until > dates[dates.length - 1] ? until : dates[dates.length - 1];
  const aA = 1 - Math.exp(-1 / CONFIG.load.atlDays);
  const aC = 1 - Math.exp(-1 / CONFIG.load.ctlDays);
  const out: LoadPoint[] = [];
  let atl = 0; let ctl = 0;
  const window: number[] = [];
  for (let d = dates[0]; d <= end; d = nextDay(d)) {
    const load = byDate.get(d) ?? 0;
    const tsb = ctl - atl;
    atl += (load - atl) * aA;
    ctl += (load - ctl) * aC;
    window.push(load);
    if (window.length > 28) window.shift();
    const sum7 = window.slice(-7).reduce((a, b) => a + b, 0);
    const sum28 = window.reduce((a, b) => a + b, 0);
    out.push({ date: d, load, atl, ctl, tsb, acwr: sum28 === 0 ? null : sum7 / (sum28 / 4) });
  }
  return out;
}

/** Foster monotony (mean / sd) and strain (weekly sum × monotony). */
export function monotonyStrain(weekLoads: number[]): { monotony: number | null; strain: number | null } {
  const s = sd(weekLoads);
  if (!weekLoads.length || s === 0) return { monotony: null, strain: null };
  const monotony = mean(weekLoads) / s;
  return { monotony, strain: weekLoads.reduce((a, b) => a + b, 0) * monotony };
}

/** Highest workout max HR over the last 12 months (≥ 5 workouts), else 220 − age, else null. */
export function estimateHrMax(workoutMaxHrs: number[], age: number | null): number | null {
  const xs = workoutMaxHrs.filter((x) => Number.isFinite(x) && x > 80 && x < 240);
  if (xs.length >= 5) return Math.max(...xs);
  if (age !== null) return 220 - age;
  return xs.length ? Math.max(...xs) : null;
}
