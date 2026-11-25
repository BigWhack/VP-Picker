import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import type { Streams } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { getExtras, getGear, getWorkout, listWorkouts, workoutStreams } from '../repo/workouts.js';
import { getAnalysis, getPersonalRecords } from '../repo/derived.js';
import { localDate, weekStart, addDays, dateRange } from '../analytics/dates.js';
import { recordsBoard } from '../analytics/records.js';
import { todayOf, tzOf } from './common.js';

/** Downsample aligned stream arrays to at most `max` points for the browser. */
export function downsample(s: Streams, max = 1500): Streams {
  const n = s.time.length;
  if (n <= max) return s;
  const step = n / max;
  const idx = Array.from({ length: max }, (_, i) => Math.floor(i * step));
  idx[max - 1] = n - 1;
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(s)) if (Array.isArray(v) && v.length === n) out[k] = idx.map((i) => v[i]);
  return out as unknown as Streams;
}

export function registerWorkoutRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.get('/api/workouts', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const { items, total } = listWorkouts(db, { sport: q.sport || undefined, q: q.q || undefined, from: q.from, to: q.to, limit: 30, offset: (page - 1) * 30 });
    const tz = tzOf(deps); const today = todayOf(deps);
    const since = addDays(today, -364);
    const recent = listWorkouts(db, { from: `${addDays(since, -1)}T00:00:00Z` }).items;
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(weekStart(today), -7 * (11 - i)));
    const weekly = weeks.map((week) => ({ week, bySport: {} as Record<string, number> }));
    const cal = new Map(dateRange(since, today).map((d) => [d, 0]));
    for (const w of recent) {
      const d = localDate(w.start, tz);
      if (cal.has(d)) cal.set(d, cal.get(d)! + w.durationS / 60);
      const wk = weekly.find((x) => x.week === weekStart(d));
      if (wk) wk.bySport[w.sport] = (wk.bySport[w.sport] ?? 0) + w.durationS / 60;
    }
    return {
      items: items.map((w) => ({ id: w.id, name: w.name ?? w.sport, sport: w.sport, start: w.start, distanceM: w.distanceM ?? null,
        durationS: w.durationS, avgHr: w.avgHr ?? null, load: getAnalysis<{ load: number }>(db, w.id)?.load ?? null, sources: w.sources })),
      total, page, pageSize: 30, weekly, calendar: [...cal.entries()].map(([date, minutes]) => ({ date, minutes })),
    };
  });

  app.get('/api/workouts/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const w = getWorkout(db, id);
    if (!w) return reply.code(404).send({ error: 'Workout not found' });
    const analysis = getAnalysis<Record<string, unknown>>(db, id);
    const streams = workoutStreams(db, w);
    const gear = w.gearId ? getGear(db, w.gearId) : null;
    // Similar sessions: same sport in the 90 days before; within ±10% distance, or ±15% duration when there's no distance
    const t = Date.parse(w.start);
    const similar = listWorkouts(db, { sport: w.sport, from: new Date(t - 90 * 86400000).toISOString(), to: w.start }).items
      .filter((r) => r.id !== id && (w.distanceM
        ? !!r.distanceM && Math.abs(r.distanceM - w.distanceM) <= w.distanceM * 0.1
        : Math.abs(r.durationS - w.durationS) <= w.durationS * 0.15))
      .slice(0, 8)
      .map((r) => {
        const a = getAnalysis<{ paceS?: number | null; ef?: number | null; efficiency?: number | null; load?: number }>(db, r.id);
        const moving = r.movingS ?? r.durationS;
        return { id: r.id, name: r.name, start: r.start, distanceM: r.distanceM ?? null, durationS: r.durationS, avgHr: r.avgHr ?? null,
          paceS: r.distanceM ? moving / (r.distanceM / 1000) : null, speedKmh: r.distanceM ? (r.distanceM / 1000) / (moving / 3600) : null,
          ef: a?.ef ?? a?.efficiency ?? null, load: a?.load ?? null };
      });
    const extras = w.stravaId ? getExtras(db, w.stravaId) : null;
    return {
      workout: w, sources: w.sources, analysis, streams: streams ? downsample(streams) : null, weather: w.weather ?? null,
      gear: gear ? { name: gear.name, kind: gear.kind, distanceKm: gear.distanceM / 1000, warn: gear.kind === 'shoe' && gear.distanceM / 1000 >= CONFIG.gear.shoeWarnKm } : null,
      similar, prs: getPersonalRecords(db).filter((r) => r.workoutId === id), laps: extras?.laps ?? null, segments: extras?.segments ?? null,
    };
  });

  app.get('/api/records', async () => recordsBoard(db, todayOf(deps)));
}
