import type { Db } from '../db/client.js';
import type { Baseline, DailyRow } from '../../shared/types.js';

export function saveDaily(db: Db, rows: DailyRow[]): void {
  const stmt = db.prepare(`INSERT INTO daily (date, json) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET json = excluded.json`);
  db.transaction(() => { for (const r of rows) stmt.run(r.date, JSON.stringify(r)); })();
}

export function getDaily(db: Db, from: string, to: string): DailyRow[] {
  return (db.prepare(`SELECT json FROM daily WHERE date >= ? AND date <= ? ORDER BY date`).all(from, to) as { json: string }[])
    .map((r) => JSON.parse(r.json));
}

export function saveBaselines(db: Db, date: string, b: Record<string, Baseline | null>): void {
  const stmt = db.prepare(`INSERT INTO baselines (date, metric, median, iqr, n) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, metric) DO UPDATE SET median = excluded.median, iqr = excluded.iqr, n = excluded.n`);
  const del = db.prepare(`DELETE FROM baselines WHERE date = ? AND metric = ?`);
  db.transaction(() => {
    for (const [m, v] of Object.entries(b)) { if (v) stmt.run(date, m, v.median, v.iqr, v.n); else del.run(date, m); }
  })();
}

export function getBaselines(db: Db, date: string): Record<string, Baseline> {
  const rows = db.prepare(`SELECT metric, median, iqr, n FROM baselines WHERE date = ?`).all(date) as { metric: string; median: number; iqr: number; n: number }[];
  const out: Record<string, Baseline> = {};
  for (const r of rows) out[r.metric] = { median: r.median, iqr: r.iqr, n: r.n, low: r.median - r.iqr / 2, high: r.median + r.iqr / 2 };
  return out;
}

export interface ScoreRow { date: string; recovery: number | null; recoveryJson: unknown; sleepScore: number | null; sleepJson: unknown; headline: string | null; detail: string | null }

export function saveScores(db: Db, rows: ScoreRow[]): void {
  const stmt = db.prepare(`INSERT INTO scores (date, recovery, recovery_json, sleep_score, sleep_json, headline, detail) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET recovery = excluded.recovery, recovery_json = excluded.recovery_json, sleep_score = excluded.sleep_score,
    sleep_json = excluded.sleep_json, headline = excluded.headline, detail = excluded.detail`);
  db.transaction(() => {
    for (const r of rows) stmt.run(r.date, r.recovery, JSON.stringify(r.recoveryJson ?? null), r.sleepScore, JSON.stringify(r.sleepJson ?? null), r.headline, r.detail);
  })();
}

export function getScores(db: Db, date: string): ScoreRow | null {
  const r = db.prepare(`SELECT * FROM scores WHERE date = ?`).get(date) as Record<string, unknown> | undefined;
  return r ? toScore(r) : null;
}

export function getScoreRange(db: Db, from: string, to: string): ScoreRow[] {
  return (db.prepare(`SELECT * FROM scores WHERE date >= ? AND date <= ? ORDER BY date`).all(from, to) as Record<string, unknown>[]).map(toScore);
}

function toScore(r: Record<string, unknown>): ScoreRow {
  return { date: r.date as string, recovery: r.recovery as number | null, recoveryJson: JSON.parse((r.recovery_json as string) ?? 'null'),
    sleepScore: r.sleep_score as number | null, sleepJson: JSON.parse((r.sleep_json as string) ?? 'null'),
    headline: r.headline as string | null, detail: r.detail as string | null };
}

export interface LoadRow { date: string; load: number; atl: number; ctl: number; tsb: number; acwr: number | null }

export function saveLoad(db: Db, rows: LoadRow[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM load`).run();
    const stmt = db.prepare(`INSERT INTO load (date, load, atl, ctl, tsb, acwr) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const r of rows) stmt.run(r.date, r.load, r.atl, r.ctl, r.tsb, r.acwr);
  })();
}

export function getLoad(db: Db, from: string, to: string): LoadRow[] {
  return db.prepare(`SELECT * FROM load WHERE date >= ? AND date <= ? ORDER BY date`).all(from, to) as LoadRow[];
}

export function saveAnalysis(db: Db, workoutId: string, json: unknown): void {
  db.prepare(`INSERT INTO workout_analysis (workout_id, json) VALUES (?, ?) ON CONFLICT(workout_id) DO UPDATE SET json = excluded.json`)
    .run(workoutId, JSON.stringify(json));
}

export function getAnalysis<T = unknown>(db: Db, workoutId: string): T | null {
  const r = db.prepare(`SELECT json FROM workout_analysis WHERE workout_id = ?`).get(workoutId) as { json: string } | undefined;
  return r ? JSON.parse(r.json) : null;
}

export interface PersonalRecordRow { kind: string; distanceM: number; workoutId: string; timeS: number; date: string }

export function savePersonalRecords(db: Db, rows: PersonalRecordRow[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM records`).run();
    const stmt = db.prepare(`INSERT OR REPLACE INTO records (kind, distance_m, workout_id, time_s, date) VALUES (?, ?, ?, ?, ?)`);
    for (const r of rows) stmt.run(r.kind, r.distanceM, r.workoutId, r.timeS, r.date);
  })();
}

export function getPersonalRecords(db: Db): PersonalRecordRow[] {
  return db.prepare(`SELECT kind, distance_m AS distanceM, workout_id AS workoutId, time_s AS timeS, date FROM records ORDER BY distance_m, time_s`).all() as PersonalRecordRow[];
}

export interface InsightRow { date: string; kind: string; severity: string; text: string; evidence?: unknown }

export function saveInsights(db: Db, date: string, rows: InsightRow[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM insights WHERE date = ?`).run(date);
    const stmt = db.prepare(`INSERT INTO insights (date, kind, severity, text, evidence_json) VALUES (?, ?, ?, ?, ?)`);
    for (const r of rows) stmt.run(date, r.kind, r.severity, r.text, JSON.stringify(r.evidence ?? null));
  })();
}

export function getInsights(db: Db, from: string, to: string): InsightRow[] {
  return (db.prepare(`SELECT * FROM insights WHERE date >= ? AND date <= ? ORDER BY date DESC`).all(from, to) as Record<string, string>[])
    .map((r) => ({ date: r.date, kind: r.kind, severity: r.severity, text: r.text, evidence: JSON.parse(r.evidence_json ?? 'null') }));
}
