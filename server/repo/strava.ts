import type { Db } from '../db/client.js';

export interface Tokens { access: string; refresh: string; expiresAt: number; athlete?: unknown }

export function getTokens(db: Db, provider = 'strava'): Tokens | null {
  const r = db.prepare(`SELECT access, refresh, expires_at AS expiresAt, athlete_json FROM oauth_tokens WHERE provider = ?`).get(provider) as
    { access: string; refresh: string; expiresAt: number; athlete_json: string | null } | undefined;
  return r ? { access: r.access, refresh: r.refresh, expiresAt: r.expiresAt, athlete: r.athlete_json ? JSON.parse(r.athlete_json) : undefined } : null;
}

export function saveTokens(db: Db, t: Tokens, provider = 'strava'): void {
  db.prepare(`INSERT INTO oauth_tokens (provider, access, refresh, expires_at, athlete_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET access = excluded.access, refresh = excluded.refresh, expires_at = excluded.expires_at,
    athlete_json = COALESCE(excluded.athlete_json, oauth_tokens.athlete_json)`)
    .run(provider, t.access, t.refresh, t.expiresAt, t.athlete ? JSON.stringify(t.athlete) : null);
}

export function deleteTokens(db: Db, provider = 'strava'): void {
  db.prepare(`DELETE FROM oauth_tokens WHERE provider = ?`).run(provider);
}

export function queueAdd(db: Db, ids: string[], now = new Date()): void {
  const stmt = db.prepare(`INSERT OR IGNORE INTO strava_queue (activity_id, step, attempts, added_at) VALUES (?, 'detail', 0, ?)`);
  db.transaction(() => { for (const id of ids) stmt.run(id, now.toISOString()); })();
}

/** Next queued activity, skipping ids already tried in this pass. */
export function queueNext(db: Db, exclude: Set<string> = new Set()): { id: string; step: string } | null {
  const rows = db.prepare(`SELECT activity_id, step FROM strava_queue WHERE attempts < 5 ORDER BY added_at, activity_id`).all() as { activity_id: string; step: string }[];
  const r = rows.find((x) => !exclude.has(x.activity_id));
  return r ? { id: r.activity_id, step: r.step } : null;
}

export function queueSetStep(db: Db, id: string, step: string): void {
  db.prepare(`UPDATE strava_queue SET step = ? WHERE activity_id = ?`).run(step, id);
}

export function queueDone(db: Db, id: string): void { db.prepare(`DELETE FROM strava_queue WHERE activity_id = ?`).run(id); }

export function queueFail(db: Db, id: string, error: string): void {
  db.prepare(`UPDATE strava_queue SET attempts = attempts + 1, last_error = ? WHERE activity_id = ?`).run(error, id);
}

export function queueSize(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM strava_queue WHERE attempts < 5`).get() as { c: number }).c;
}
