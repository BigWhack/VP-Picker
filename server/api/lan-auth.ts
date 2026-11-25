import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { getSettings, updateSettings, getState, setState } from '../repo/settings.js';

const COOKIE = 'hd_session';
const SESSION_DAYS = 30;

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(passcode, salt, 32).toString('hex')}`;
}

/** Non-blocking variant used by the login route. */
export async function verifyPasscodeAsync(passcode: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = await scryptAsync(passcode, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = scryptSync(passcode, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function secret(db: Db): string {
  let s = getState<string>(db, 'auth.secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    setState(db, 'auth.secret', s);
  }
  return s;
}

const sign = (db: Db, payload: string) => createHmac('sha256', secret(db)).update(payload).digest('hex');

export function makeSession(db: Db, now = Date.now()): string {
  const exp = String(now + SESSION_DAYS * 86400000);
  return `${exp}.${sign(db, exp)}`;
}

export function validSession(db: Db, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < now) return false;
  const expected = sign(db, exp);
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** Turn on home-network mode with a passcode; returns the token Health Auto Export must send. */
export function enableLan(db: Db, passcode: string): { ingestToken: string } {
  const ingestToken = getSettings(db).ingestToken ?? randomBytes(24).toString('base64url');
  updateSettings(db, { lanMode: true, passcodeHash: hashPasscode(passcode), ingestToken });
  setState(db, 'auth.secret', randomBytes(32).toString('hex')); // new passcode signs out every existing session
  return { ingestToken };
}

export function isLoopback(ip: string): boolean {
  return ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('127.');
}

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const hostnameOf = (hostHeader: string) => (hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0]).toLowerCase();

/** Hostnames this app answers to: loopback names, plus .local names and private IPs in home-network mode. Blocks DNS rebinding. */
export function allowedHostname(hostname: string, lanMode: boolean): boolean {
  if (LOCAL_NAMES.has(hostname)) return true;
  if (!lanMode) return false;
  return hostname.endsWith('.local') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(\.\d+)?$/.test(hostname);
}

const cookieValue = (req: FastifyRequest, name: string) =>
  (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

export function registerLanAuth(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;

  app.addHook('onRequest', async (req, reply) => {
    const lanMode = getSettings(db).lanMode;
    if (!allowedHostname(hostnameOf(req.headers.host ?? 'localhost'), lanMode)) return reply.code(403).send({ error: 'Unknown host' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && req.url.split('?')[0] !== '/api/ingest/hae') {
      let ok = false;
      try { ok = allowedHostname(new URL(req.headers.origin).hostname.toLowerCase(), lanMode); } catch { ok = false; }
      if (!ok) return reply.code(403).send({ error: 'Cross-site request refused' });
    }
    if (isLoopback(req.ip)) return;
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api') && !path.startsWith('/auth')) return; // web app assets, including the login page
    if (path === '/api/login' || path === '/api/ingest/hae' || path === '/api/health') return;
    if (!lanMode) return reply.code(403).send({ error: 'Only available on this Mac. Turn on home-network mode in Settings.' });
    if (!validSession(db, cookieValue(req, COOKIE))) return reply.code(401).send({ error: 'Login required' });
  });

  const failures = new Map<string, number[]>();
  const WINDOW_MS = 15 * 60000; const MAX_FAILURES = 5;
  app.post('/api/login', async (req, reply) => {
    const now = Date.now();
    const recent = (failures.get(req.ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_FAILURES) return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    const s = getSettings(db);
    const passcode = (req.body as { passcode?: string } | undefined)?.passcode ?? '';
    if (!s.passcodeHash || !(await verifyPasscodeAsync(passcode, s.passcodeHash))) {
      failures.set(req.ip, [...recent, now]);
      return reply.code(401).send({ error: 'Wrong passcode' });
    }
    failures.delete(req.ip);
    return reply
      .header('set-cookie', `${COOKIE}=${makeSession(db)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`)
      .send({ ok: true });
  });

  app.post('/api/lan', async (req, reply) => {
    if (!isLoopback(req.ip)) return reply.code(403).send({ error: 'Change this on the Mac itself' });
    const body = (req.body ?? {}) as { enabled?: boolean; passcode?: string };
    if (body.enabled) {
      if (!body.passcode || body.passcode.length < 6) {
        return reply.code(400).send({ error: 'Passcode must be at least 6 characters', fields: { passcode: 'At least 6 characters' } });
      }
      const { ingestToken } = enableLan(db, body.passcode);
      return { lanMode: true, ingestToken, restartRequired: true };
    }
    updateSettings(db, { lanMode: false });
    return { lanMode: false, restartRequired: true };
  });
}
