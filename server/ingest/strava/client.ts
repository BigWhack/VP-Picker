import type { Db } from '../../db/client.js';
import { CONFIG } from '../../../shared/analytics-config.js';
import { deleteTokens, getTokens, saveTokens } from '../../repo/strava.js';
import { tokenRequest } from './oauth.js';

export class RateLimitedError extends Error { constructor(msg = 'Strava rate limit reached; will continue next sync') { super(msg); } }
export class StravaAuthError extends Error { constructor(msg = 'Strava access was revoked or expired — reconnect Strava in Settings.') { super(msg); } }

export interface StravaCreds { clientId: string; clientSecret: string }

/** Thin Strava API client: refreshes tokens, tracks rate-limit usage and stops before the configured budget. */
export class StravaClient {
  private usage = { q15: 0, day: 0, bucket15: -1, dayKey: '' };
  constructor(private db: Db, private creds: StravaCreds, private fetchFn: typeof fetch = fetch, private now: () => Date = () => new Date()) {}

  connected(): boolean { return !!getTokens(this.db); }

  private resetWindows() {
    const n = this.now();
    const bucket = Math.floor(n.getTime() / (15 * 60000));
    const dayKey = n.toISOString().slice(0, 10);
    if (bucket !== this.usage.bucket15) { this.usage.q15 = 0; this.usage.bucket15 = bucket; }
    if (dayKey !== this.usage.dayKey) { this.usage.day = 0; this.usage.dayKey = dayKey; }
  }

  private recordUsage(res: Response) {
    for (const h of ['x-ratelimit-usage', 'x-readratelimit-usage']) {
      const v = res.headers.get(h);
      if (!v) continue;
      const [a, b] = v.split(',').map(Number);
      if (Number.isFinite(a)) this.usage.q15 = Math.max(this.usage.q15, a);
      if (Number.isFinite(b)) this.usage.day = Math.max(this.usage.day, b);
    }
  }

  private async accessToken(): Promise<string> {
    const t = getTokens(this.db);
    if (!t) throw new StravaAuthError('Strava is not connected.');
    if (t.expiresAt - this.now().getTime() / 1000 > 300) return t.access;
    const r = await tokenRequest(this.fetchFn, { client_id: this.creds.clientId, client_secret: this.creds.clientSecret, grant_type: 'refresh_token', refresh_token: t.refresh });
    if (!r.ok) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { deleteTokens(this.db); throw new StravaAuthError(); }
      throw new Error(`Strava token refresh failed: ${r.status} ${r.message}`);
    }
    saveTokens(this.db, { access: r.data.access_token, refresh: r.data.refresh_token, expiresAt: r.data.expires_at });
    return r.data.access_token;
  }

  async get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    this.resetWindows();
    if (this.usage.q15 >= CONFIG.strava.budget15 || this.usage.day >= CONFIG.strava.budgetDay) throw new RateLimitedError();
    const token = await this.accessToken();
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v));
    const url = `https://www.strava.com/api/v3${path}${q.size ? `?${q}` : ''}`;
    const res = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    this.recordUsage(res);
    if (res.status === 429) throw new RateLimitedError();
    if (res.status === 401) { deleteTokens(this.db); throw new StravaAuthError(); }
    if (!res.ok) throw new Error(`Strava ${path}: ${res.status}`);
    return (await res.json()) as T;
  }
}
