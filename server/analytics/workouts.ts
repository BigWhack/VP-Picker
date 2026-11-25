import type { Db } from '../db/client.js';
import type { Sample, Settings } from '../../shared/types.js';
import { getSamples } from '../repo/samples.js';
import { getAnalysis, saveAnalysis } from '../repo/derived.js';
import { listWorkouts, workoutStreams, type MergedWorkout } from '../repo/workouts.js';
import { analyzeRun, loadFor, zonesFor, type AnalysisContext, type RunAnalysis } from './run.js';
import type { PhysioContext } from './recompute.js';
import { analyzeRide, type RideAnalysis } from './ride.js';

export interface GenericAnalysis { kind: 'generic'; zones: ReturnType<typeof zonesFor>; load: number; paceS: number | null }
export type AnyAnalysis = (RunAnalysis | RideAnalysis | GenericAnalysis | { kind: string; load: number; [k: string]: unknown }) & { sig?: string };

type Analyzer = (db: Db, w: MergedWorkout, ctx: AnalysisContext) => AnyAnalysis;
const extra: Record<string, Analyzer> = {};
/** Sport-specific analyzers (e.g. cycling) register here. */
export function registerAnalyzer(sport: string, fn: Analyzer): void { extra[sport] = fn; }

const FORM_METRICS = ['runPower', 'strideLength', 'groundContact', 'vertOsc'];

export function analyzeWorkout(db: Db, w: MergedWorkout, ctx: AnalysisContext): AnyAnalysis {
  if (extra[w.sport]) return extra[w.sport](db, w, ctx);
  const streams = workoutStreams(db, w);
  if (w.sport === 'ride') return analyzeRide(w, streams, w.weather ?? null, ctx, ctx.ftp);
  if (w.sport === 'run') {
    const samples: Sample[] = FORM_METRICS.flatMap((m) => getSamples(db, m, w.start, new Date(Date.parse(w.end) + 1000).toISOString()));
    return analyzeRun(w, streams, samples, ctx);
  }
  const paceS = w.distanceM && w.distanceM > 0 ? (w.movingS ?? w.durationS) / (w.distanceM / 1000) : null;
  return { kind: 'generic', zones: zonesFor(streams, ctx), load: loadFor(w, streams, ctx), paceS };
}

/** Analyse every workout whose inputs changed since the last run; returns load per workout id. */
export function analyzeAllWorkouts(db: Db, physio: PhysioContext, s: Settings): Map<string, number> {
  const ctx: AnalysisContext = { ...physio, zoneModel: s.zoneModel, ftp: s.ftp };
  const loads = new Map<string, number>();
  for (const w of listWorkouts(db).items) {
    const streamsKey = db.prepare(`SELECT COUNT(*) AS c FROM record_streams WHERE (source = 'apple' AND source_id = ?) OR (source = 'strava' AND source_id = ?)`)
      .get(w.appleId ?? '', w.stravaId ?? '') as { c: number };
    const sig = `v3|${w.weather ? 'wx' : ''}|${w.appleId}|${w.stravaId}|${streamsKey.c}|${w.durationS}|${ctx.hrRest}|${ctx.hrMax}|${ctx.sex}|${ctx.zoneModel}|${s.ftp ?? ''}`;
    const prev = getAnalysis<AnyAnalysis>(db, w.id);
    if (prev && prev.sig === sig) { loads.set(w.id, prev.load); continue; }
    const a = { ...analyzeWorkout(db, w, ctx), sig };
    saveAnalysis(db, w.id, a);
    loads.set(w.id, a.load);
  }
  return loads;
}
