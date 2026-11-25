import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/client.js';
import { SyncController, type StravaSync } from './sync/job.js';
import { registerSyncRoutes } from './api/sync.js';
import { registerTodayRoutes } from './api/today.js';
import { registerStravaAuthRoutes } from './api/strava-auth.js';
import { registerWorkoutRoutes } from './api/workouts.js';
import { registerSleepRoutes } from './api/sleep.js';
import { StravaClient } from './ingest/strava/client.js';
import { createStravaSync } from './ingest/strava/sync.js';
import { enrichWeather } from './ingest/weather.js';

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
  if (deps.strava === undefined && deps.env?.STRAVA_CLIENT_ID && deps.env.STRAVA_CLIENT_SECRET && !deps.env.OFFLINE) {
    const client = new StravaClient(deps.db, { clientId: deps.env.STRAVA_CLIENT_ID, clientSecret: deps.env.STRAVA_CLIENT_SECRET }, deps.fetchFn ?? fetch, deps.now);
    deps.strava = createStravaSync(deps.db, client);
  }
  if (deps.weather === undefined && deps.env && !deps.env.OFFLINE) {
    deps.weather = () => enrichWeather(deps.db, deps.fetchFn ?? fetch, 50, (deps.now ?? (() => new Date()))());
  }
  if (!deps.sync) {
    deps.sync = new SyncController(() => ({ db: deps.db, dataDir: deps.dataDir, home: deps.home, now: deps.now, strava: deps.strava ?? null, weather: deps.weather ?? null }));
  }
  app.get('/api/health', async () => ({ ok: true }));
  registerSyncRoutes(app, deps);
  registerTodayRoutes(app, deps);
  registerStravaAuthRoutes(app, deps);
  registerWorkoutRoutes(app, deps);
  registerSleepRoutes(app, deps);
  return app;
}
