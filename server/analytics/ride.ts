import type { Streams } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { gradeSeries, speedSeries, timeMean } from './streams.js';
import { decouplingPct, loadFor, zonesFor, type AnalysisContext, type WorkoutLike } from './run.js';
import type { Weather } from '../repo/workouts.js';

export interface Climb { startKm: number; lengthM: number; gainM: number; avgGrade: number; vamMh: number | null }

/** Contiguous stretches with grade ≥ 3% lasting ≥ 500 m. */
export function detectClimbs(s: Streams): Climb[] {
  const d = s.distance; const a = s.altitude;
  const g = gradeSeries(s);
  if (!d || !a || !g) return [];
  const out: Climb[] = [];
  let i = 0;
  while (i < d.length) {
    if (g[i] < CONFIG.climbs.minGrade) { i++; continue; }
    let j = i;
    while (j + 1 < d.length && g[j + 1] >= CONFIG.climbs.minGrade * 0.67) j++;
    const start = Math.max(0, i - 1);
    const lengthM = d[j] - d[start];
    const gainM = a[j] - a[start];
    if (lengthM >= CONFIG.climbs.minLengthM && gainM / lengthM >= CONFIG.climbs.minGrade) {
      const hours = (s.time[j] - s.time[start]) / 3600;
      out.push({ startKm: d[start] / 1000, lengthM, gainM, avgGrade: gainM / lengthM, vamMh: hours > 0 ? gainM / hours : null });
    }
    i = j + 1;
  }
  return out;
}

const toRad = (x: number) => (x * Math.PI) / 180;
function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function dist(a: [number, number], b: [number, number]): number {
  const R = 6371008.8; const dLat = toRad(b[0] - a[0]); const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance-weighted share of the route ridden into, with, and across the wind (wind direction = where it comes FROM). */
export function windShare(latlng: [number, number][], windFromDeg: number): { head: number; tail: number; cross: number } {
  let head = 0; let tail = 0; let cross = 0;
  for (let i = 1; i < latlng.length; i++) {
    const len = dist(latlng[i - 1], latlng[i]);
    if (len < 1) continue;
    const diff = Math.abs(((bearing(latlng[i - 1], latlng[i]) - windFromDeg + 540) % 360) - 180);
    if (diff < 45) head += len; else if (diff > 135) tail += len; else cross += len;
  }
  const total = head + tail + cross || 1;
  return { head: head / total, tail: tail / total, cross: cross / total };
}

/** 30 s rolling mean, 4th-power mean, 4th root. Null with under 30 s of data. */
export function normalizedPower(t: number[], watts: number[]): number | null {
  if (t.length < 2 || t[t.length - 1] - t[0] < 30) return null;
  // resample to 1 Hz
  const sec: number[] = []; let j = 0;
  for (let x = Math.ceil(t[0]); x <= t[t.length - 1]; x++) { while (j < t.length - 1 && t[j + 1] <= x) j++; sec.push(watts[j] ?? 0); }
  if (sec.length < 30) return null;
  let sum = 0; let acc = 0; let n = 0;
  for (let i = 0; i < sec.length; i++) {
    sum += sec[i]; if (i >= 30) sum -= sec[i - 30];
    if (i >= 29) { acc += (sum / 30) ** 4; n++; }
  }
  return (acc / n) ** 0.25;
}

export const tss = (npW: number, ftpW: number, durationS: number) => ((durationS * npW * (npW / ftpW)) / (ftpW * 3600)) * 100;

export interface RideAnalysis {
  kind: 'ride'; speedKmh: number | null; climbs: Climb[]; wind: ReturnType<typeof windShare> | null; decouplingPct: number | null;
  efficiency: number | null; power: { avgW: number | null; npW: number | null; intensity: number | null; tss: number | null } | null;
  cadenceRpm: number | null; zones: ReturnType<typeof zonesFor>; load: number;
}

export function analyzeRide(w: WorkoutLike, streams: Streams | null, weather: Weather | null, ctx: AnalysisContext, ftp: number | undefined): RideAnalysis {
  const moving = w.movingS ?? w.durationS;
  const speedKmh = w.distanceM ? (w.distanceM / 1000) / (moving / 3600) : null;
  let power: RideAnalysis['power'] = null;
  if (streams?.watts && streams.watts.some((x) => x > 0)) {
    const np = normalizedPower(streams.time, streams.watts);
    const avgW = timeMean(streams.time, streams.watts);
    power = { avgW, npW: np, intensity: np && ftp ? np / ftp : null, tss: np && ftp ? tss(np, ftp, moving) : null };
  }
  const sp = streams ? speedSeries(streams) : null;
  const v = sp && streams ? timeMean(streams.time, sp) : null;
  const h = streams?.heartrate ? timeMean(streams.time, streams.heartrate) : null;
  const cad = streams?.cadence ? timeMean(streams.time, streams.cadence.map((c) => (c > 0 ? c : NaN))) : null;
  return {
    kind: 'ride', speedKmh, climbs: streams ? detectClimbs(streams) : [],
    wind: weather && streams?.latlng && streams.latlng.length > 1 ? windShare(streams.latlng, weather.windFromDeg) : null,
    decouplingPct: streams ? decouplingPct(streams) : null,
    efficiency: v && h ? (v * 3.6) / h : null, power, cadenceRpm: cad, zones: zonesFor(streams, ctx), load: loadFor(w, streams, ctx),
  };
}
