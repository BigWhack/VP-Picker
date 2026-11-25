import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { loadEnv } from './config.js';

const env = loadEnv();
const app = buildApp({ db: undefined, settings: () => undefined });

const webDir = resolve('dist/web');
if (existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/auth')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
console.log(`Health dashboard running at http://localhost:${env.PORT}`);
