import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/client.js';
import { SyncController, type StravaSync } from './sync/job.js';
import { registerSyncRoutes } from './api/sync.js';
import { registerTodayRoutes } from './api/today.js';

export interface AppDeps {
  db: Db;
  dataDir: string;
  home: string;
  now?: () => Date;
  strava?: StravaSync | null;
  sync?: SyncController;
  env?: { STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; PORT?: number; OFFLINE?: boolean };
  fetchFn?: typeof fetch;
  weather?: (() => Promise<number>) | null;
  listenHost?: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 200 * 1024 * 1024 });
  if (!deps.sync) {
    deps.sync = new SyncController(() => ({ db: deps.db, dataDir: deps.dataDir, home: deps.home, now: deps.now, strava: deps.strava ?? null }));
  }
  app.get('/api/health', async () => ({ ok: true }));
  registerSyncRoutes(app, deps);
  registerTodayRoutes(app, deps);
  return app;
}
