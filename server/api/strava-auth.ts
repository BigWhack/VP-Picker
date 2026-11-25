import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { authorizeUrl, tokenRequest } from '../ingest/strava/oauth.js';
import { deleteTokens, saveTokens } from '../repo/strava.js';

export function registerStravaAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  const port = deps.env?.PORT ?? 4321;
  app.get('/auth/strava/start', async (_req, reply) => {
    if (!deps.env?.STRAVA_CLIENT_ID) {
      return reply.code(400).type('text/html').send('<p>Strava is not set up yet. Run <code>npm run setup</code> and add your Strava API client ID and secret, then restart.</p>');
    }
    return reply.redirect(authorizeUrl(deps.env.STRAVA_CLIENT_ID, port));
  });
  app.get('/auth/strava/callback', async (req, reply) => {
    const q = req.query as { code?: string; error?: string; scope?: string };
    if (q.error || !q.code) return reply.redirect(`/settings?strava=${encodeURIComponent(q.error ?? 'denied')}`);
    if (!q.scope?.includes('activity:read_all')) return reply.redirect('/settings?strava=missing-scope');
    const r = await tokenRequest(deps.fetchFn ?? fetch, {
      client_id: deps.env?.STRAVA_CLIENT_ID ?? '', client_secret: deps.env?.STRAVA_CLIENT_SECRET ?? '', code: q.code, grant_type: 'authorization_code',
    });
    if (!r.ok) return reply.redirect(`/settings?strava=${encodeURIComponent(`error: ${r.message}`)}`);
    saveTokens(deps.db, { access: r.data.access_token, refresh: r.data.refresh_token, expiresAt: r.data.expires_at, athlete: r.data.athlete });
    if (deps.sync) void deps.sync.run().catch(() => undefined);
    return reply.redirect('/settings?strava=connected');
  });
  app.post('/api/strava/disconnect', async () => { deleteTokens(deps.db); return { ok: true }; });
}
