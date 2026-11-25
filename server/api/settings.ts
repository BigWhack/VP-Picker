import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { Settings } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { getSettings, updateSettings, getState } from '../repo/settings.js';
import { listImports } from '../repo/imports.js';
import { getTokens, queueSize } from '../repo/strava.js';
import { discoverHaeFolder } from '../ingest/hae/folder.js';
import { recompute } from '../analytics/recompute.js';
import { getDaily } from '../repo/derived.js';

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; } };

const schema = z.object({
  tz: z.string().refine(validTz, 'Unknown time zone'),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable(),
  sex: z.enum(['male', 'female']).nullable(),
  hrMax: z.number().int().min(120).max(230).nullable(),
  hrRestOverride: z.number().int().min(30).max(100).nullable(),
  sleepNeedMin: z.number().int().min(240).max(720),
  goals: z.object({ steps: z.number().int().min(1000).max(50000), activeKcal: z.number().int().min(50).max(3000), exerciseMin: z.number().int().min(5).max(300), standHours: z.number().int().min(1).max(24) }),
  ftp: z.number().int().min(50).max(600).nullable(),
  zoneModel: z.enum(['hrr', 'pctMax']),
  units: z.enum(['metric', 'imperial']),
  haeFolder: z.string().min(1).nullable(),
}).partial().strict();

const ANALYTIC_KEYS = ['tz', 'dob', 'sex', 'hrMax', 'hrRestOverride', 'sleepNeedMin', 'ftp', 'zoneModel'];
const EXPORT_TABLES = new Set(['daily', 'workouts', 'scores', 'load']);

export function publicSettings(s: Settings) {
  const { passcodeHash, ingestToken, ...rest } = s;
  return { ...rest, hasPasscode: !!passcodeHash, ingestToken: ingestToken ?? null };
}

function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;
  const rebuild = () => { void recompute(db, { from: 'all', now: deps.now?.() }).catch(() => undefined); };

  app.get('/api/settings', async () => ({
    settings: publicSettings(getSettings(db)),
    discoveredHaeFolder: discoverHaeFolder(deps.home),
    imports: listImports(db, 20),
    config: { recoveryWeights: CONFIG.recovery.weights, sleepScore: CONFIG.sleepScore, bands: CONFIG.recovery.bands },
  }));

  app.put('/api/settings', async (req, reply) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[String(i.path[0] ?? '_')] = i.message;
      return reply.code(400).send({ error: 'Invalid settings', fields });
    }
    const before = getSettings(db);
    const after = updateSettings(db, parsed.data as Partial<Settings>);
    if (ANALYTIC_KEYS.some((k) => JSON.stringify((before as never)[k]) !== JSON.stringify((after as never)[k]))) rebuild();
    return { settings: publicSettings(after) };
  });

  app.post('/api/analytics/rebuild', async (_req, reply) => { rebuild(); return reply.code(202).send({ started: true }); });

  app.get('/api/setup', async () => {
    const s = getSettings(db);
    const withData = getDaily(db, '1970-01-01', '2999-12-31').filter((r) => [r.steps, r.asleepMin, r.rhr, r.workouts].some((v) => typeof v === 'number' && v > 0)).length;
    return {
      stravaConfigured: !!(deps.env?.STRAVA_CLIENT_ID && deps.env.STRAVA_CLIENT_SECRET), stravaConnected: !!getTokens(db),
      haeFolder: s.haeFolder ?? discoverHaeFolder(deps.home), haeFilesSeen: listImports(db, 1000).filter((i) => i.source === 'hae' && i.status === 'ok').length,
      backfillRemaining: queueSize(db), backfillDone: !!getState(db, 'strava.backfillDone'), daysOfData: withData,
    };
  });

  app.get('/api/export/db', async (_req, reply) => {
    const dir = mkdtempSync(join(tmpdir(), 'health-export-'));
    const file = join(dir, 'health.db');
    try {
      db.prepare('VACUUM INTO ?').run(file);
      const buf = readFileSync(file);
      return reply.header('content-type', 'application/vnd.sqlite3').header('content-disposition', 'attachment; filename="health.db"').send(buf);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  app.get('/api/export/csv/:table', async (req, reply) => {
    const table = (req.params as { table: string }).table;
    if (!EXPORT_TABLES.has(table)) return reply.code(404).send({ error: 'Unknown table' });
    const rows = table === 'daily'
      ? getDaily(db, '1970-01-01', '2999-12-31') as Record<string, unknown>[]
      : db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as Record<string, unknown>[];
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${table}.csv"`).send(toCsv(rows));
  });
}
