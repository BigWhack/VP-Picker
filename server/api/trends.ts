import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import type { DailyRow } from '../../shared/types.js';
import { getDaily, getLoad } from '../repo/derived.js';
import { findPatterns } from '../analytics/patterns.js';
import { monotonyStrain } from '../analytics/load.js';
import { weekStart } from '../analytics/dates.js';
import { METRICS } from '../../shared/metrics.js';
import { addDays, avgOf, hrvVal, num, seriesFrom, todayOf } from './common.js';
import { rangeStart } from './heart-activity.js';

export const TREND_METRICS: Record<string, { label: string; unit: string; get: (r: DailyRow) => number | null }> = {
  recovery: { label: 'Recovery', unit: '', get: (r) => num(r.recovery) },
  sleepScore: { label: 'Sleep score', unit: '', get: (r) => num(r.sleepScore) },
  asleepMin: { label: 'Sleep duration', unit: 'min', get: (r) => num(r.asleepMin) },
  efficiency: { label: 'Sleep efficiency', unit: '%', get: (r) => (num(r.efficiency) === null ? null : (r.efficiency as number) * 100) },
  deepMin: { label: 'Deep sleep', unit: 'min', get: (r) => num(r.deepMin) },
  remMin: { label: 'REM sleep', unit: 'min', get: (r) => num(r.remMin) },
  hrv: { label: 'HRV', unit: 'ms', get: hrvVal },
  load: { label: 'Training load', unit: '', get: (r) => num(r.load) },
  trainingMin: { label: 'Training time', unit: 'min', get: (r) => num(r.trainingMin) },
  runKm: { label: 'Running distance', unit: 'km', get: (r) => num(r.runKm) },
  rideKm: { label: 'Cycling distance', unit: 'km', get: (r) => num(r.rideKm) },
  ...Object.fromEntries(Object.entries(METRICS).filter(([k]) => k !== 'hrv' && k !== 'hr').map(([k, d]) => [k, { label: d.label, unit: d.unit, get: (r: DailyRow) => num(r[k]) }])),
};

export function registerTrendRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;
  app.get('/api/trends/metrics', async () => Object.entries(TREND_METRICS).map(([key, m]) => ({ key, label: m.label, unit: m.unit })));

  app.get('/api/trends', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const metric = TREND_METRICS[q.metric ?? 'recovery'];
    if (!metric) return reply.code(400).send({ error: `Unknown metric ${q.metric}` });
    const today = todayOf(deps);
    const from = rangeStart(db, q.range, today);
    const days = Math.round((Date.parse(today) - Date.parse(from)) / 86400000) + 1;
    const shift = q.compareTo === 'lastYear' ? 364 : q.compareTo === 'previous' ? days : 0;
    const rows = getDaily(db, shift ? addDays(from, -shift) : from, today);
    const series = seriesFrom(rows.filter((r) => r.date >= from), from, today, metric.get, null);
    const compareSeries = shift ? seriesFrom(rows, addDays(from, -shift), addDays(today, -shift), metric.get, null) : null;
    const mean = avgOf(rows.filter((r) => r.date >= from), metric.get);
    const prevMean = compareSeries ? avgOf(rows.filter((r) => r.date < from && r.date >= addDays(from, -shift)), metric.get) : null;
    return { metric: q.metric ?? 'recovery', label: metric.label, unit: metric.unit, series, compareSeries,
      summary: { mean, previousMean: prevMean, change: mean !== null && prevMean !== null ? mean - prevMean : null } };
  });

  app.get('/api/trends/load', async (req) => {
    const today = todayOf(deps);
    const from = rangeStart(db, (req.query as Record<string, unknown>).range, today);
    const rows = getLoad(db, from, today);
    const byWeek = new Map<string, number[]>();
    for (const r of rows) { const w = weekStart(r.date); (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(r.load); }
    return {
      days: rows,
      weeks: [...byWeek.entries()].map(([week, loads]) => ({ week, load: loads.reduce((a, b) => a + b, 0), ...monotonyStrain(loads.length === 7 ? loads : [...loads, ...Array(7 - loads.length).fill(0)]) })),
    };
  });

  app.get('/api/patterns', async () => {
    const today = todayOf(deps);
    return { patterns: findPatterns(getDaily(db, addDays(today, -95), today)).slice(0, 8) };
  });
}
