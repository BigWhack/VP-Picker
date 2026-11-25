import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import type { DailyRow } from '../../shared/types.js';
import { getBaselines, getDaily, getInsights } from '../repo/derived.js';
import { getSettings } from '../repo/settings.js';
import { vo2Category } from '../../shared/vo2-categories.js';
import { addDays, avgOf, hrvVal, num, nowOf, seriesFrom, sumOf, todayOf } from './common.js';
import { weekStart } from '../analytics/dates.js';

const HEART_FLAGS = new Set(['rhr_elevated', 'hrv_low', 'resp_elevated']);

/** Heart-related flags with consecutive days of the same kind collapsed into one episode, newest first. */
export function flagEpisodes(rows: { date: string; kind: string; text: string }[]) {
  const sorted = rows.filter((r) => HEART_FLAGS.has(r.kind)).sort((a, b) => a.kind.localeCompare(b.kind) || a.date.localeCompare(b.date));
  const out: { kind: string; from: string; to: string; text: string }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.kind === r.kind && addDays(last.to, 1) === r.date) last.to = r.date;
    else out.push({ kind: r.kind, from: r.date, to: r.date, text: r.text });
  }
  return out.sort((a, b) => b.to.localeCompare(a.to));
}

export function rangeStart(db: AppDeps['db'], range: unknown, today: string): string {
  const days = range === '90d' ? 90 : range === '1y' ? 365 : range === 'all' ? null : 30;
  if (days) return addDays(today, -(days - 1));
  const r = db.prepare(`SELECT MIN(date) AS m FROM daily`).get() as { m: string | null };
  return r.m ?? addDays(today, -29);
}

export function registerHeartActivityRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.get('/api/heart', async (req) => {
    const today = todayOf(deps);
    const from = rangeStart(db, (req.query as Record<string, unknown>).range, today);
    const rows = getDaily(db, from, today);
    const b = getBaselines(db, today);
    const s = getSettings(db);
    const latestVo2 = [...rows].reverse().find((r) => num(r.vo2max) !== null)?.vo2max as number | undefined;
    const age = s.dob ? Math.floor((nowOf(deps).getTime() - Date.parse(s.dob)) / (365.25 * 86400000)) : null;
    return {
      range: { from, to: today },
      series: {
        rhr: seriesFrom(rows, from, today, (r) => num(r.rhr), b.rhr),
        hrv: seriesFrom(rows, from, today, hrvVal, b.hrv),
        walkHr: seriesFrom(rows, from, today, (r) => num(r.walkHr), b.walkHr),
        hrRecovery: seriesFrom(rows, from, today, (r) => num(r.hrRecovery), b.hrRecovery),
        vo2max: seriesFrom(rows, from, today, (r) => num(r.vo2max), null),
        lowestHr: seriesFrom(rows, from, today, (r) => num(r.lowestHr), b.lowestHr),
      },
      latest: { rhr: num(rows.at(-1)?.rhr), hrv: hrvVal(rows.at(-1)), vo2max: latestVo2 ?? null },
      vo2Category: latestVo2 && age !== null && s.sex ? vo2Category(latestVo2, age, s.sex) : null,
      notifications: [] as { at: string; kind: string }[],
      flagEpisodes: flagEpisodes(getInsights(db, from, today)),
    };
  });

  app.get('/api/activity', async (req) => {
    const today = todayOf(deps);
    const from = rangeStart(db, (req.query as Record<string, unknown>).range, today);
    const rows = getDaily(db, from, today);
    const by = new Map(rows.map((r) => [r.date, r]));
    const s = getSettings(db);
    const days: { date: string; steps: number | null; activeKcal: number | null; exerciseMin: number | null; standHours: number | null; flights: number | null; distanceM: number | null; trainingMin: number | null }[] = [];
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const r = by.get(d);
      days.push({ date: d, steps: num(r?.steps), activeKcal: num(r?.activeKcal), exerciseMin: num(r?.exerciseMin), standHours: num(r?.standHours),
        flights: num(r?.flights), distanceM: num(r?.distance) !== null ? (r!.distance as number) * 1000 : null, trainingMin: num(r?.trainingMin) });
    }
    const wk = getDaily(db, addDays(weekStart(today), -7), today);
    const ws = weekStart(today); const n = Math.round((Date.parse(today) - Date.parse(ws)) / 86400000) + 1;
    const tw = wk.filter((r) => r.date >= ws); const lw = wk.filter((r) => r.date < ws && r.date < addDays(ws, -7 + n));
    const cmp = (key: string, label: string, unit: string) => ({ key, label, unit, better: 'up' as const,
      thisWeek: avgOf(tw, (r: DailyRow) => num(r[key])), lastWeek: avgOf(lw, (r: DailyRow) => num(r[key])) });
    const months = new Map<string, DailyRow[]>();
    for (const r of getDaily(db, addDays(today, -365), today)) { const m = r.date.slice(0, 7); (months.get(m) ?? months.set(m, []).get(m)!).push(r); }
    return {
      range: { from, to: today }, days, goals: s.goals,
      weekCompare: [cmp('steps', 'Avg steps', 'steps'), cmp('activeKcal', 'Avg active energy', 'kcal'), cmp('exerciseMin', 'Avg exercise', 'min'), cmp('standHours', 'Avg stand hours', 'h')],
      monthTotals: [...months.entries()].map(([month, rs]) => ({ month, steps: sumOf(rs, (r) => num(r.steps)), activeKcal: sumOf(rs, (r) => num(r.activeKcal)),
        exerciseMin: sumOf(rs, (r) => num(r.exerciseMin)), trainingMin: sumOf(rs, (r) => num(r.trainingMin)), days: rs.length })),
    };
  });
}
