import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../server/app.js';
import { testDb } from '../helpers/db.js';
import { enableLan, hashPasscode, verifyPasscode } from '../../server/api/lan-auth.js';

const LAN = '192.168.1.20';
function setup() {
  const db = testDb(); const dir = mkdtempSync(join(tmpdir(), 'lan-'));
  const { ingestToken } = enableLan(db, 'correct horse');
  const app = buildApp({ db, dataDir: dir, home: dir });
  return { app, dir, ingestToken };
}

describe('LAN mode', () => {
  it('hashes and verifies passcodes', () => {
    const h = hashPasscode('secret');
    expect(verifyPasscode('secret', h)).toBe(true);
    expect(verifyPasscode('nope', h)).toBe(false);
  });

  it('requires login from other devices but not from this Mac', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/api/today', remoteAddress: LAN })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/today', remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/login', remoteAddress: LAN, payload: { passcode: 'wrong' } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/login', remoteAddress: LAN, payload: { passcode: 'correct horse' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ url: '/api/today', remoteAddress: LAN, headers: { cookie } })).statusCode).toBe(200);
  });

  it('accepts HAE pushes only with the ingest token', async () => {
    const { app, dir, ingestToken } = setup();
    const body = { data: { metrics: [] } };
    expect((await app.inject({ method: 'POST', url: '/api/ingest/hae', remoteAddress: LAN, payload: body, headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/ingest/hae', remoteAddress: LAN, payload: body, headers: { authorization: `Bearer ${ingestToken}` } });
    expect(ok.statusCode).toBe(202);
    const files = readdirSync(join(dir, 'inbox'));
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, 'inbox', files[0]), 'utf8'))).toEqual(body);
  });
});
