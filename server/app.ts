import Fastify, { type FastifyInstance } from 'fastify';

export interface AppDeps {
  db: unknown;
  settings: () => unknown;
  now?: () => Date;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('deps', deps);
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}
