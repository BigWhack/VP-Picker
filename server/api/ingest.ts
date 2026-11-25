import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { getSettings } from '../repo/settings.js';

/** Health Auto Export "REST API" automation target: saves the payload for the next import pass. */
export function registerIngestRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post('/api/ingest/hae', { bodyLimit: 200 * 1024 * 1024 }, async (req, reply) => {
    const token = getSettings(deps.db).ingestToken;
    const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
      return reply.code(401).send({ error: 'Bad token' });
    }
    const dir = join(deps.dataDir, 'inbox');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `hae-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(req.body));
    if (deps.sync) setTimeout(() => void deps.sync!.run().catch(() => undefined), 2000);
    return reply.code(202).send({ accepted: true });
  });
}
