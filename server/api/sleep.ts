import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { getDaily, getScores } from '../repo/derived.js';
import { getSettings } from '../repo/settings.js';
import { nightsBetween } from '../analytics/daily.js';
import { summarizeNight } from '../analytics/sleep.js';
import { lastNightPayload, sleepWindow } from './today.js';
import { addDays, avgOf, num, todayOf, tzOf, validDate } from './common.js';

export function registerSleepRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/sleep', async (req) => {
    const date = validDate((req.query as Record<string, unknown>).date, todayOf(deps));
    const s = getSettings(deps.db);
    const night = lastNightPayload(deps, date);
    const scores = getScores(deps.db, date);
    const rows = getDaily(deps.db, addDays(date, -29), date);
    const row = rows.find((r) => r.date === date);
    const windowNights = sleepWindow(deps, addDays(date, -29), date);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const { naps } = nightsBetween(deps.db, date, date, tzOf(deps));
    const prior = getDaily(deps.db, addDays(date, -30), addDays(date, -1));
    const sj = scores?.sleepJson as { score: number; components: Record<string, number>; debtMin: number; regularitySdMin: number | null } | null;
    return {
      date,
      night: night ? {
        ...night, score: sj?.score ?? null, scoreComponents: sj?.components ?? null,
        overnight: { lowestHr: num(row?.lowestHr), avgResp: num(row?.respNight) ?? num(row?.resp), hrv: num(row?.hrvNight) },
      } : null,
      naps: naps.map(summarizeNight),
      history: Array.from({ length: 30 }, (_, i) => addDays(date, -29 + i)).map((d) => {
        const r = byDate.get(d); const w = windowNights.find((n) => n.date === d);
        return { date: d, asleepMin: num(r?.asleepMin), score: num(r?.sleepScore), deepMin: num(r?.deepMin), remMin: num(r?.remMin), coreMin: num(r?.coreMin),
          awakeMin: num(r?.awakeMin), bedtime: w?.bedtime ?? null, wake: w?.wake ?? null };
      }),
      window: windowNights,
      debtMin: sj?.debtMin ?? num(row?.sleepDebt) ?? 0,
      regularitySdMin: sj?.regularitySdMin ?? num(row?.regularitySd),
      needMin: s.sleepNeedMin,
      avgAsleepMin: avgOf(rows, (r) => num(r.asleepMin)),
      stageAvg: { deep: avgOf(prior, (r) => num(r.deepMin)) ?? 0, core: avgOf(prior, (r) => num(r.coreMin)) ?? 0, rem: avgOf(prior, (r) => num(r.remMin)) ?? 0, awake: avgOf(prior, (r) => num(r.awakeMin)) ?? 0 },
      tz: tzOf(deps),
    };
  });
}
