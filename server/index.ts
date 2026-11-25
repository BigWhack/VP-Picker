import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp, type AppDeps } from './app.js';
import { loadEnv } from './config.js';
import { openDb } from './db/client.js';
import { startScheduler } from './sync/scheduler.js';
import { SyncController, lastRunAt } from './sync/job.js';

const env = loadEnv();
mkdirSync(env.DATA_DIR, { recursive: true });
const db = openDb(join(env.DATA_DIR, 'health.db'));
const deps: AppDeps = { db, dataDir: env.DATA_DIR, home: process.env.HEALTH_HOME ?? homedir(), env };
deps.sync = new SyncController(() => ({ db, dataDir: env.DATA_DIR, home: deps.home, strava: env.OFFLINE ? null : deps.strava ?? null, weather: env.OFFLINE ? null : deps.weather ?? null }));
const app = buildApp(deps);

const webDir = resolve('dist/web');
if (existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/auth')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: env.PORT, host: deps.listenHost ?? env.HOST });
console.log(`Health dashboard running at http://localhost:${env.PORT}`);
if (process.env.NO_SCHEDULER !== '1') startScheduler(() => deps.sync!.run(), { lastRun: () => lastRunAt(db) });
