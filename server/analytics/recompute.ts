import type { Db } from '../db/client.js';
import type { Baseline, DailyRow, Settings } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { getSettings } from '../repo/settings.js';
import { saveDaily, saveBaselines, saveScores, saveLoad, saveInsights, getDaily, type ScoreRow } from '../repo/derived.js';
import { listWorkouts } from '../repo/workouts.js';
import { rebuildWorkouts } from '../merge/workouts.js';
import { buildDailyRows } from './daily.js';
import { computeBaseline } from './baseline.js';
import { recoveryScore } from './recovery.js';
import { sleepScore, sleepDebt, circularSdMin } from './sleep.js';
import { loadSeries, estimateHrMax } from './load.js';
import { analyzeAllWorkouts } from './workouts.js';
import { rebuildRecords } from './records.js';
import { computeFlags, headline } from './insights.js';
import { addDays, dateRange, localDate } from './dates.js';

export const BASELINE_KEYS = ['hrv', 'rhr', 'resp', 'tsb', 'asleepMin', 'efficiency', 'deepMin', 'coreMin', 'remMin', 'awakeMin',
  'restorativeShare', 'bedtime', 'wake', 'lowestHr', 'walkHr', 'vo2max', 'hrRecovery', 'steps', 'activeKcal', 'exerciseMin',
  'standHours', 'recovery', 'sleepScore'] as const;

export interface PhysioContext { hrRest: number; hrMax: number; sex: 'male' | 'female' }

/** Value used for the HRV baseline/recovery: the overnight mean when available, else the day's mean. */
export const hrvOf = (r: DailyRow | undefined) => (r ? (r.hrvNight ?? r.hrv ?? null) : null);
const pick = (r: DailyRow, k: string) => (k === 'hrv' ? hrvOf(r) : (r[k] ?? null));

function earliestDate(db: Db, tz: string): string | null {
  const q = (sql: string) => (db.prepare(sql).get() as { m: string | null }).m;
  const mins = [q('SELECT MIN(start) AS m FROM samples'), q('SELECT MIN(start) AS m FROM sleep_segments'), q('SELECT MIN(start) AS m FROM workout_records')]
    .filter((x): x is string => !!x).sort();
  return mins.length ? localDate(mins[0], tz) : null;
}

export function physioContext(db: Db, s: Settings, recent: DailyRow[], now: Date): PhysioContext {
  const rhrs = recent.map((r) => r.rhr).filter((x): x is number => typeof x === 'number');
  const hrRest = s.hrRestOverride ?? (rhrs.length ? computeBaseline(rhrs, 1)!.median : 60);
  const yearAgo = new Date(now.getTime() - 365 * 86400000).toISOString();
  const maxes = listWorkouts(db, { from: yearAgo }).items.map((w) => w.maxHr).filter((x): x is number => typeof x === 'number');
  const age = s.dob ? Math.floor((now.getTime() - Date.parse(s.dob)) / (365.25 * 86400000)) : null;
  const hrMax = s.hrMax ?? estimateHrMax(maxes, age) ?? 190;
  return { hrRest, hrMax, sex: s.sex ?? 'male' };
}

/** Rebuild derived tables (daily, baselines, load, scores, insights) for a date range. Safe to re-run. */
export async function recompute(db: Db, opts: { from?: string | 'all'; to?: string; now?: Date } = {}): Promise<{ days: number }> {
  const now = opts.now ?? new Date();
  const s = getSettings(db);
  const tz = s.tz;
  const today = localDate(now.toISOString(), tz);
  rebuildWorkouts(db);

  const to = opts.to ?? today;
  const from = opts.from === 'all' ? (earliestDate(db, tz) ?? to) : (opts.from ?? addDays(to, -45));
  const W = CONFIG.baseline.windowDays;
  const rows = buildDailyRows(db, addDays(from, -W - 1), to, tz);
  const byDate = new Map(rows.map((r) => [r.date, r]));

  // Training load over the full workout history
  const ctx = physioContext(db, s, rows.slice(-W), now);
  const loads = analyzeAllWorkouts(db, ctx, s);
  const perDay = new Map<string, number>();
  for (const w of listWorkouts(db).items) {
    const d = localDate(w.start, tz);
    perDay.set(d, (perDay.get(d) ?? 0) + (loads.get(w.id) ?? 0));
  }
  const series = loadSeries([...perDay.entries()].map(([date, load]) => ({ date, load })), today);
  saveLoad(db, series.map((p) => ({ ...p })));
  const loadBy = new Map(series.map((p) => [p.date, p]));
  for (const r of rows) { const l = loadBy.get(r.date); r.load = l?.load ?? 0; r.tsb = l ? l.tsb : null; r.acwr = l?.acwr ?? null; }
  // Keep previously computed scores for dates before `from` so their baselines are available (fixed key order for stable output).
  const previous = new Map(getDaily(db, addDays(from, -W - 1), addDays(from, -1)).map((r) => [r.date, r]));
  for (const r of rows) {
    const old = previous.get(r.date);
    r.recovery = old?.recovery ?? null; r.sleepScore = old?.sleepScore ?? null;
    r.sleepDebt = old?.sleepDebt ?? null; r.regularitySd = old?.regularitySd ?? null;
  }

  const scores: ScoreRow[] = [];
  const target = dateRange(from, to);
  for (const date of target) {
    const row = byDate.get(date)!;
    const window = dateRange(addDays(date, -W), addDays(date, -1)).map((d) => byDate.get(d)).filter((x): x is DailyRow => !!x);
    const baselines: Record<string, Baseline | null> = {};
    for (const k of BASELINE_KEYS) {
      baselines[k] = computeBaseline(window.map((r) => pick(r, k)).filter((v): v is number => typeof v === 'number'));
    }

    const rec = recoveryScore({
      hrv: hrvOf(row), rhr: row.rhr ?? null, asleepMin: row.asleepMin ?? null, needMin: s.sleepNeedMin,
      resp: row.respNight ?? row.resp ?? null, tsb: row.tsb ?? null,
      baselines: { hrv: baselines.hrv, rhr: baselines.rhr, resp: baselines.resp, tsb: baselines.tsb },
    });

    const lastNights = dateRange(addDays(date, -CONFIG.sleep.debtWindowNights + 1), date).map((d) => byDate.get(d)?.asleepMin)
      .filter((v): v is number => typeof v === 'number');
    const debt = sleepDebt(lastNights, s.sleepNeedMin);
    const beds = dateRange(addDays(date, -CONFIG.sleep.regularityNights + 1), date).map((d) => byDate.get(d)?.bedtime)
      .filter((v): v is number => typeof v === 'number')
      .map((m) => { const t = (18 * 60 + m) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; });
    const regularity = beds.length >= 3 ? circularSdMin(beds) : null;
    let sleepRes: { score: number; components: Record<string, number> } | null = null;
    if (typeof row.asleepMin === 'number' && row.asleepMin > 0) {
      sleepRes = sleepScore({ asleepMin: row.asleepMin, needMin: s.sleepNeedMin, efficiency: row.efficiency ?? 0,
        restorativeShare: row.restorativeShare ?? 0, baselineRestorativeShare: baselines.restorativeShare?.median ?? null, regularitySdMin: regularity });
    }
    row.recovery = rec.score; row.sleepScore = sleepRes?.score ?? null; row.sleepDebt = debt; row.regularitySd = regularity;
    const text = headline(rec, row.asleepMin ?? null, { baselines, needMin: s.sleepNeedMin });
    scores.push({ date, recovery: rec.score, recoveryJson: rec, sleepScore: sleepRes?.score ?? null,
      sleepJson: sleepRes ? { ...sleepRes, debtMin: debt, regularitySdMin: regularity } : null, headline: text.headline, detail: text.detail });

    saveBaselines(db, date, baselines);
    const recent = dateRange(addDays(date, -2), date).map((d) => byDate.get(d)).filter((x): x is DailyRow => !!x);
    const flags = computeFlags(recent, { rhr: baselines.rhr, resp: baselines.resp, hrv: baselines.hrv }, debt, row.acwr ?? null);
    saveInsights(db, date, flags.map((f) => ({ date, kind: f.kind, severity: f.severity, text: f.text })));
  }
  saveDaily(db, rows);
  saveScores(db, scores);
  rebuildRecords(db);
  return { days: target.length };
}
