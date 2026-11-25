export const STRAVA_SCOPE = 'read,activity:read_all,profile:read_all';

export function redirectUri(port: number): string {
  return `http://localhost:${port}/auth/strava/callback`;
}

export function authorizeUrl(clientId: string, port: number): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(port), response_type: 'code', approval_prompt: 'auto', scope: STRAVA_SCOPE });
  return `https://www.strava.com/oauth/authorize?${q.toString()}`;
}

export interface TokenResponse { access_token: string; refresh_token: string; expires_at: number; athlete?: unknown }

export async function tokenRequest(fetchFn: typeof fetch, body: Record<string, string>): Promise<{ ok: true; data: TokenResponse } | { ok: false; status: number; message: string }> {
  const res = await fetchFn('https://www.strava.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, message: (data as { message?: string }).message ?? res.statusText };
  return { ok: true, data: data as TokenResponse };
}
