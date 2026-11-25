import type { Sample, Streams } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { hrZoneBounds, timeInZones } from './zones.js';
import { trimpFromAverage, trimpFromStream } from './load.js';
import { avg, gradeSeries, speedSeries, timeMean } from './streams.js';
import { clamp } from './stats.js';

export interface AnalysisContext { hrRest: number; hrMax: number; sex: 'male' | 'female'; zoneModel: 'hrr' | 'pctMax'; ftp?: number; tz?: string }

export function minettiCost(grade: number): number {
  const i = clamp(grade, -0.45, 0.45);
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}
export const gapFactor = (grade: number) => minettiCost(grade) / 3.6;

export interface Split { km: number; distanceKm: number; timeS: number; paceS: number; gapPaceS: number | null; avgHr: number | null;
  cadenceSpm: number | null; elevDeltaM: number | null; avgPower: number | null }

export function kmSplits(s: Streams, cadenceMultiplier = 2): Split[] | null {
  const d = s.distance; const t = s.time;
  if (!d || d.length < 2 || d[d.length - 1] < 100) return null;
  const g = gradeSeries(s);
  const out: Split[] = [];
  let startIdx = 0; let startT = t[0]; let startD = d[0];
  const interpT = (i: number, target: number) => {
    const dd = d[i] - d[i - 1];
    return dd > 0 ? t[i - 1] + ((target - d[i - 1]) / dd) * (t[i] - t[i - 1]) : t[i];
  };
  const close = (endIdx: number, endT: number, endD: number) => {
    const distKm = (endD - startD) / 1000;
    if (distKm <= 0.01) return;
    const timeS = endT - startT;
    let gapDist = 0;
    if (g) for (let i = Math.max(1, startIdx + 1); i <= endIdx; i++) gapDist += (d[i] - d[i - 1]) * gapFactor(g[i]);
    const slice = <T>(v?: T[]) => v?.slice(startIdx, endIdx + 1);
    const cad = avg(slice(s.cadence) ?? []);
    out.push({
      km: out.length + 1, distanceKm: Math.round(distKm * 1000) / 1000, timeS, paceS: timeS / distKm,
      gapPaceS: g && gapDist > 0 ? timeS / (gapDist / 1000) : null,
      avgHr: avg(slice(s.heartrate) ?? []), cadenceSpm: cad === null ? null : Math.round(cad * cadenceMultiplier),
      elevDeltaM: s.altitude ? s.altitude[endIdx] - s.altitude[startIdx] : null, avgPower: avg(slice(s.watts) ?? []),
    });
  };
  let nextMark = Math.floor(d[0] / 1000) * 1000 + 1000;
  for (let i = 1; i < d.length; i++) {
    while (d[i] >= nextMark) {
      const tm = interpT(i, nextMark);
      close(i, tm, nextMark);
      startIdx = i; startT = tm; startD = nextMark; nextMark += 1000;
    }
  }
  close(d.length - 1, t[t.length - 1], d[d.length - 1]);
  return out;
}

/** Pa:HR decoupling: (EF first half − EF second half) / EF first half × 100, halves by elapsed time. */
export function decouplingPct(s: Streams): number | null {
  const sp = speedSeries(s);
  if (!sp || !s.heartrate || s.time.length < 10) return null;
  const mid = s.time[0] + (s.time[s.time.length - 1] - s.time[0]) / 2;
  const m = s.time.findIndex((x) => x >= mid);
  const ef = (a: number, b: number) => { const v = timeMean(s.time, sp, a, b); const h = timeMean(s.time, s.heartrate, a, b); return v && h ? v / h : null; };
  const e1 = ef(0, m + 1); const e2 = ef(m, s.time.length);
  return e1 && e2 ? ((e1 - e2) / e1) * 100 : null;
}

/** Mean grade-adjusted speed (m/min) divided by mean HR. */
export function efficiencyFactor(s: Streams): number | null {
  const sp = speedSeries(s);
  if (!sp || !s.heartrate) return null;
  const g = gradeSeries(s);
  const gap = sp.map((v, i) => v * (g ? gapFactor(g[i]) : 1));
  const v = timeMean(s.time, gap); const h = timeMean(s.time, s.heartrate);
  return v && h ? (v * 60) / h : null;
}

export function strideLengthM(speedMs: number, cadenceSpm: number): number | null {
  return cadenceSpm > 0 && speedMs > 0 ? (speedMs * 60) / cadenceSpm : null;
}

export function runForm(samples: Sample[], start: string, end: string) {
  const inW = (m: string) => samples.filter((x) => x.metric === m && x.start >= new Date(start).toISOString() && x.start <= new Date(end).toISOString()).map((x) => x.value);
  return { power: avg(inW('runPower')), strideLength: avg(inW('strideLength')), groundContactMs: avg(inW('groundContact')), vertOscCm: avg(inW('vertOsc')) };
}

export interface RunSummary { id: string; distanceM: number; start: string; paceS: number | null; avgHr: number | null; ef: number | null }

export function similarRuns<T extends { distanceM: number; start: string }>(target: { distanceM: number; start: string }, all: T[]): T[] {
  const t = Date.parse(target.start);
  return all.filter((r) => Math.abs(r.distanceM - target.distanceM) <= target.distanceM * 0.1
    && Date.parse(r.start) < t && t - Date.parse(r.start) <= 90 * 86400000)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

export interface WorkoutLike { start: string; end: string; durationS: number; movingS?: number; distanceM?: number; avgHr?: number; maxHr?: number; elevGainM?: number }

export function zonesFor(streams: Streams | null, ctx: AnalysisContext) {
  if (!streams?.heartrate || streams.heartrate.length < 2) return null;
  const bounds = hrZoneBounds(ctx.hrRest, ctx.hrMax, ctx.zoneModel);
  return { bounds, seconds: timeInZones(streams.time, streams.heartrate, bounds) };
}

export function loadFor(w: WorkoutLike, streams: Streams | null, ctx: AnalysisContext): number {
  if (streams?.heartrate && streams.heartrate.length > 10) return trimpFromStream(streams.time, streams.heartrate, ctx.hrRest, ctx.hrMax, ctx.sex);
  return w.avgHr ? trimpFromAverage(w.avgHr, w.durationS, ctx.hrRest, ctx.hrMax, ctx.sex) : 0;
}

export interface RunAnalysis {
  kind: 'run'; paceS: number | null; gapPaceS: number | null; splits: Split[] | null; decouplingPct: number | null; decouplingFlag: boolean;
  ef: number | null; cadenceSpm: number | null; strideLengthM: number | null;
  form: ReturnType<typeof runForm>; zones: ReturnType<typeof zonesFor>; load: number; hrDriftBpm: number | null;
}

export function analyzeRun(w: WorkoutLike, streams: Streams | null, samples: Sample[], ctx: AnalysisContext): RunAnalysis {
  const moving = w.movingS ?? w.durationS;
  const paceS = w.distanceM && w.distanceM > 0 ? moving / (w.distanceM / 1000) : null;
  const splits = streams ? kmSplits(streams) : null;
  const totalGap = splits?.every((s) => s.gapPaceS !== null)
    ? splits.reduce((a, s) => a + s.timeS, 0) / splits.reduce((a, s) => a + s.timeS / (s.gapPaceS as number), 0) : null;
  const dec = streams ? decouplingPct(streams) : null;
  const cad = streams?.cadence ? timeMean(streams.time, streams.cadence) : null;
  const cadenceSpm = cad ? Math.round(cad * 2) : null;
  const speed = paceS ? 1000 / paceS : null;
  const hr = streams?.heartrate;
  const hrDriftBpm = hr && hr.length > 20 ? (avg(hr.slice(Math.floor(hr.length / 2))) ?? 0) - (avg(hr.slice(0, Math.floor(hr.length / 2))) ?? 0) : null;
  return {
    kind: 'run', paceS, gapPaceS: totalGap, splits, decouplingPct: dec, decouplingFlag: dec !== null && dec > CONFIG.decoupling.flagPct,
    ef: streams ? efficiencyFactor(streams) : null, cadenceSpm, strideLengthM: speed && cadenceSpm ? strideLengthM(speed, cadenceSpm) : null,
    form: runForm(samples, w.start, w.end), zones: zonesFor(streams, ctx), load: loadFor(w, streams, ctx), hrDriftBpm,
  };
}
