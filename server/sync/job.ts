import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/client.js';
import { getSettings } from '../repo/settings.js';
import { discoverHaeFolder } from '../ingest/hae/folder.js';
import { importHaeFolder, type HaeImportResult } from '../ingest/hae/importer.js';
import { recompute } from '../analytics/recompute.js';
import { localDate, addDays } from '../analytics/dates.js';

export interface StravaSync { poll(): Promise<{ newActivities: number; queued: number; processed: number; affectedDates?: string[] }> }

export interface SyncContext {
  db: Db; dataDir: string; home: string; now?: () => Date;
  strava?: StravaSync | null;
  weather?: (() => Promise<number>) | null;
}

export interface SyncRunResult {
  status: 'ok' | 'partial' | 'error';
  hae: Omit<HaeImportResult, 'affectedDates'> | null;
  strava: { newActivities: number; queued: number; processed: number } | null;
  weather: number | null;
  recomputedDays: number;
  errors: string[];
}

/** One sync pass: HAE folders → Strava → weather → analytics. Each stage's failure is recorded and later stages still run. */
export async function runSyncJob(ctx: SyncContext): Promise<SyncRunResult> {
  const { db } = ctx;
  const now = ctx.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = Number(db.prepare(`INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`).run(startedAt).lastInsertRowid);
  const result: SyncRunResult = { status: 'ok', hae: null, strava: null, weather: null, recomputedDays: 0, errors: [] };
  const affected: string[] = [];

  try {
    const s = getSettings(db);
    const inbox = join(ctx.dataDir, 'inbox');
    const folders = [s.haeFolder ?? discoverHaeFolder(ctx.home), inbox].filter((f): f is string => !!f && existsSync(f));
    const total = { files: 0, samples: 0, sleep: 0, workouts: 0, errors: [] as string[] };
    for (const f of folders) {
      const r = await importHaeFolder(db, f, join(ctx.dataDir, 'raw'), { deleteAfterImport: f === inbox });
      total.files += r.files; total.samples += r.samples; total.sleep += r.sleep; total.workouts += r.workouts;
      total.errors.push(...r.errors); affected.push(...r.affectedDates);
    }
    result.hae = total;
    result.errors.push(...total.errors.map((e) => `hae: ${e}`));
  } catch (e) { result.errors.push(`hae: ${(e as Error).message}`); }

  if (ctx.strava) {
    try {
      const r = await ctx.strava.poll();
      result.strava = { newActivities: r.newActivities, queued: r.queued, processed: r.processed };
      affected.push(...(r.affectedDates ?? []));
    } catch (e) { result.errors.push(`strava: ${(e as Error).message}`); }
  }

  let recomputeOk = true;
  try {
    const tz = getSettings(db).tz;
    const today = localDate(now().toISOString(), tz);
    const earliest = affected.sort()[0];
    const from = earliest && earliest < addDays(today, -45) ? earliest : undefined;
    result.recomputedDays = (await recompute(db, { from, now: now() })).days;
  } catch (e) { recomputeOk = false; result.errors.push(`analytics: ${(e as Error).message}`); }

  if (ctx.weather) {
    try { result.weather = await ctx.weather(); } catch (e) { result.errors.push(`weather: ${(e as Error).message}`); }
  }

  result.status = !recomputeOk ? 'error' : result.errors.length ? 'partial' : 'ok';
  db.prepare(`UPDATE sync_runs SET finished_at = ?, status = ?, counts_json = ?, error = ? WHERE id = ?`)
    .run(now().toISOString(), result.status, JSON.stringify(result), result.errors.join('\n') || null, runId);
  return result;
}

export function lastRunAt(db: Db): Date | null {
  const r = db.prepare(`SELECT MAX(started_at) AS m FROM sync_runs WHERE status != 'running'`).get() as { m: string | null };
  return r.m ? new Date(r.m) : null;
}

/** Wraps the job so the API and the scheduler share one in-flight guard. */
export class SyncController {
  running: Promise<SyncRunResult> | null = null;
  last: SyncRunResult | null = null;
  constructor(private ctx: () => SyncContext) {}
  run(): Promise<SyncRunResult> {
    if (this.running) return this.running;
    this.running = runSyncJob(this.ctx()).then((r) => { this.last = r; return r; }).finally(() => { this.running = null; });
    return this.running;
  }
}
