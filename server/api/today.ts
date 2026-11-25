import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import type { DailyRow } from '../../shared/types.js';
import { getDaily, getBaselines, getScores, getInsights, getLoad } from '../repo/derived.js';
import { listWorkouts } from '../repo/workouts.js';
import { nightsBetween } from '../analytics/daily.js';
import { summarizeNight } from '../analytics/sleep.js';
import { localHHmm, weekStart } from '../analytics/dates.js';
import { syncStatus } from './sync.js';
import { addDays, avgOf, hrvVal, minutesToHHmm, num, seriesFrom, sumOf, todayOf, tzOf, validDate } from './common.js';

export function lastNightPayload(deps: AppDeps, date: string) {
  const tz = tzOf(deps);
  const { nights } = nightsBetween(deps.db, date, date, tz);
  if (!nights.length) return null;
  const n = nights[0];
  const prior = getDaily(deps.db, addDays(date, -30), addDays(date, -1));
  const a = (k: string) => avgOf(prior, (r) => num(r[k])) ?? 0;
  return {
    ...summarizeNight(n),
    segments: n.segments.filter((s) => s.stage !== 'inBed').map((s) => ({ start: s.start, end: s.end, stage: s.stage })),
    stageAvg: { deep: a('deepMin'), core: a('coreMin'), rem: a('remMin'), awake: a('awakeMin') },
  };
}

export function sleepWindow(deps: AppDeps, from: string, to: string) {
  const tz = tzOf(deps);
  return nightsBetween(deps.db, from, to, tz).nights.map((n) => {
    const s = summarizeNight(n);
    return { date: n.date, bedtime: localHHmm(s.bedtime, tz), wake: localHHmm(s.wake, tz), asleepMin: s.asleepMin };
  });
}

export function weekCompare(rows: DailyRow[], date: string) {
  const by = new Map(rows.map((r) => [r.date, r]));
  const ws = weekStart(date);
  const days = Math.round((Date.parse(date) - Date.parse(ws)) / 86400000) + 1;
  const pick = (start: string) => Array.from({ length: days }, (_, i) => by.get(addDays(start, i))).filter((r): r is DailyRow => !!r);
  const tw = pick(ws); const lw = pick(addDays(ws, -7));
  const metric = (key: string, label: string, unit: string, better: 'up' | 'down' | 'none', f: (rs: DailyRow[]) => number | null) =>
    ({ key, label, unit, better, thisWeek: f(tw), lastWeek: f(lw) });
  return [
    metric('sleep', 'Avg sleep', 'min', 'up', (rs) => avgOf(rs, (r) => num(r.asleepMin))),
    metric('hrv', 'Avg HRV', 'ms', 'up', (rs) => avgOf(rs, hrvVal)),
    metric('rhr', 'Avg resting HR', 'bpm', 'down', (rs) => avgOf(rs, (r) => num(r.rhr))),
    metric('steps', 'Avg steps', 'steps', 'up', (rs) => avgOf(rs, (r) => num(r.steps))),
    metric('trainingMin', 'Training time', 'min', 'up', (rs) => sumOf(rs, (r) => num(r.trainingMin))),
    metric('runKm', 'Running', 'km', 'up', (rs) => sumOf(rs, (r) => num(r.runKm))),
    metric('rideKm', 'Cycling', 'km', 'up', (rs) => sumOf(rs, (r) => num(r.rideKm))),
  ];
}

export function todayPayload(deps: AppDeps, date: string) {
  const { db } = deps;
  const scores = getScores(db, date);
  const recovery = (scores?.recoveryJson as { score: number | null } | null) ?? { score: null, band: null, components: [] };
  const b = getBaselines(db, date);
  const rows = getDaily(db, addDays(date, -40), date);
  const row = rows.find((r) => r.date === date);
  const vs = (key: string, label: string, unit: string, value: number | null, baseKey: string) => {
    const base = b[baseKey];
    return { key, label, unit, value, low: base?.low ?? null, high: base?.high ?? null, median: base?.median ?? null, calibrating: !base };
  };
  const yesterday = rows.find((r) => r.date === addDays(date, -1));
  const load = getLoad(db, date, date)[0] ?? null;
  const w = listWorkouts(db, { to: `${addDays(date, 1)}T12:00:00Z`, limit: 1 }).items[0];
  return {
    date,
    tz: tzOf(deps),
    headline: scores?.headline ?? 'Not enough data yet to judge recovery.',
    detail: scores?.detail ?? '',
    recovery,
    recoveryDelta: num(row?.recovery) !== null && num(yesterday?.recovery) !== null ? (row!.recovery as number) - (yesterday!.recovery as number) : null,
    sleepScore: scores?.sleepScore ?? null,
    vsNormal: [
      vs('hrv', 'HRV', 'ms', hrvVal(row), 'hrv'),
      vs('rhr', 'Resting HR', 'bpm', num(row?.rhr), 'rhr'),
      vs('sleep', 'Sleep', 'min', num(row?.asleepMin), 'asleepMin'),
      vs('resp', 'Breathing rate', '/min', num(row?.respNight) ?? num(row?.resp), 'resp'),
    ],
    load: load ? { fitness: load.ctl, fatigue: load.atl, form: load.tsb, acwr: load.acwr } : null,
    lastNight: lastNightPayload(deps, date),
    sleepWindow: sleepWindow(deps, addDays(date, -6), date),
    usualBedtime: b.bedtime ? minutesToHHmm(18 * 60 + b.bedtime.median) : null,
    trends: {
      hrv: seriesFrom(rows, addDays(date, -13), date, hrvVal, b.hrv),
      rhr: seriesFrom(rows, addDays(date, -13), date, (r) => num(r.rhr), b.rhr),
    },
    weekCompare: weekCompare(rows, date),
    lastWorkout: w ? { id: w.id, name: w.name ?? w.sport, sport: w.sport, start: w.start, distanceM: w.distanceM ?? null,
      durationS: w.durationS, avgHr: w.avgHr ?? null } : null,
    flags: getInsights(db, date, date),
    sync: syncStatus(deps),
  };
}

export function registerTodayRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/today', async (req) => todayPayload(deps, validDate((req.query as Record<string, unknown>).date, todayOf(deps))));
}
