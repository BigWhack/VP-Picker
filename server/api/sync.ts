import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { latestSampleStart } from '../repo/samples.js';
import { getTokens, queueSize } from '../repo/strava.js';
import { lastRunAt } from '../sync/job.js';

export function syncStatus(deps: AppDeps) {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const lastDataAt = latestSampleStart(db);
  const stale = !lastDataAt || now.getTime() - Date.parse(lastDataAt) > CONFIG.sync.staleHours * 3600000;
  const lastActivity = (db.prepare(`SELECT MAX(start) AS m FROM workout_records WHERE source = 'strava'`).get() as { m: string | null }).m;
  const last = lastRunAt(db);
  const lastRow = db.prepare(`SELECT status, error FROM sync_runs WHERE status != 'running' ORDER BY id DESC LIMIT 1`).get() as { status: string; error: string | null } | undefined;
  return {
    lastRun: last?.toISOString() ?? null,
    nextRun: last ? new Date(last.getTime() + 60 * 60000).toISOString() : null,
    lastStatus: lastRow?.status ?? null,
    lastErrors: lastRow?.error ? lastRow.error.split('\n') : [],
    running: !!deps.sync?.running,
    sources: {
      hae: { lastDataAt, stale },
      strava: {
        configured: !!deps.strava, connected: !!getTokens(db), lastActivityAt: lastActivity,
        backfill: { remaining: queueSize(db) },
      },
    },
  };
}
export type SyncStatus = ReturnType<typeof syncStatus>;

export function registerSyncRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/sync/status', async () => syncStatus(deps));
  app.post('/api/sync/run', async (_req, reply) => {
    if (deps.sync) void deps.sync.run().catch(() => undefined);
    return reply.code(202).send({ started: true });
  });
}
