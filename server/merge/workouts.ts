import type { Db } from '../db/client.js';
import type { Sport, WorkoutRecord } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { getWorkoutRecords, replaceWorkouts, type MergedWorkout } from '../repo/workouts.js';

export function sportFamily(s: Sport): 'foot' | 'ride' | 'swim' | 'other' {
  if (s === 'run' || s === 'walk' || s === 'hike') return 'foot';
  if (s === 'ride' || s === 'swim') return s;
  return 'other';
}

/** Pair Apple and Strava records of the same session (same family, start ±120 s, duration within 10%). */
export function matchWorkouts(apple: WorkoutRecord[], strava: WorkoutRecord[]): { appleId?: string; stravaId?: string }[] {
  const M = CONFIG.merge;
  const pairs: { a: WorkoutRecord; s: WorkoutRecord; diff: number }[] = [];
  for (const a of apple) for (const s of strava) {
    const diff = Math.abs(Date.parse(a.start) - Date.parse(s.start)) / 1000;
    const longer = Math.max(a.durationS, s.durationS);
    if (sportFamily(a.sport) === sportFamily(s.sport) && diff <= M.startToleranceS && Math.abs(a.durationS - s.durationS) <= longer * M.durationTolerance) {
      pairs.push({ a, s, diff });
    }
  }
  pairs.sort((x, y) => x.diff - y.diff);
  const usedA = new Set<string>(); const usedS = new Set<string>();
  const out: { appleId?: string; stravaId?: string }[] = [];
  for (const p of pairs) {
    if (usedA.has(p.a.sourceId) || usedS.has(p.s.sourceId)) continue;
    usedA.add(p.a.sourceId); usedS.add(p.s.sourceId);
    out.push({ appleId: p.a.sourceId, stravaId: p.s.sourceId });
  }
  for (const a of apple) if (!usedA.has(a.sourceId)) out.push({ appleId: a.sourceId });
  for (const s of strava) if (!usedS.has(s.sourceId)) out.push({ stravaId: s.sourceId });
  return out;
}

function merge(a: WorkoutRecord | undefined, s: WorkoutRecord | undefined): MergedWorkout {
  const base = (s ?? a)!;
  const first = <K extends keyof WorkoutRecord>(k: K, primary: WorkoutRecord | undefined, secondary: WorkoutRecord | undefined) =>
    (primary?.[k] ?? secondary?.[k]) as WorkoutRecord[K];
  const w: MergedWorkout = {
    id: s ? `strava:${s.sourceId}` : `apple:${a!.sourceId}`,
    appleId: a?.sourceId, stravaId: s?.sourceId,
    sources: [...(a ? ['apple' as const] : []), ...(s ? ['strava' as const] : [])],
    sport: s && s.sport !== 'other' ? s.sport : base.sport,
    start: base.start, end: base.end, tzOffsetMin: base.tzOffsetMin, durationS: base.durationS,
    movingS: first('movingS', s, a),
    avgHr: first('avgHr', a, s), maxHr: first('maxHr', a, s), energyKcal: first('energyKcal', a, s),
    name: first('name', s, a), gearId: s?.gearId, polyline: s?.polyline,
    distanceM: first('distanceM', s, a), elevGainM: first('elevGainM', s, a),
  };
  for (const k of Object.keys(w) as (keyof MergedWorkout)[]) if (w[k] === undefined) delete w[k];
  return w;
}

/** Rebuild the merged `workouts` table from all source records. Ids are stable across rebuilds. */
export function rebuildWorkouts(db: Db): number {
  const from = '1970-01-01T00:00:00Z'; const to = '2999-01-01T00:00:00Z';
  const apple = getWorkoutRecords(db, from, to, 'apple');
  const strava = getWorkoutRecords(db, from, to, 'strava');
  const aBy = new Map(apple.map((r) => [r.sourceId, r]));
  const sBy = new Map(strava.map((r) => [r.sourceId, r]));
  // Keep each workout's id once assigned (e.g. an Apple workout keeps its id when its Strava copy arrives later).
  const prev = db.prepare(`SELECT id, apple_id, strava_id FROM workouts`).all() as { id: string; apple_id: string | null; strava_id: string | null }[];
  const byApple = new Map(prev.filter((r) => r.apple_id).map((r) => [r.apple_id!, r.id]));
  const byStrava = new Map(prev.filter((r) => r.strava_id).map((r) => [r.strava_id!, r.id]));
  const used = new Set<string>();
  const list = matchWorkouts(apple, strava).map((m) => {
    const w = merge(m.appleId ? aBy.get(m.appleId) : undefined, m.stravaId ? sBy.get(m.stravaId) : undefined);
    const keep = (m.appleId && byApple.get(m.appleId)) || (m.stravaId && byStrava.get(m.stravaId));
    if (keep && !used.has(keep)) w.id = keep;
    used.add(w.id);
    return w;
  });
  replaceWorkouts(db, list);
  db.prepare(`DELETE FROM workout_analysis WHERE workout_id NOT IN (SELECT id FROM workouts)`).run();
  return list.length;
}
