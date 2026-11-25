import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Env {
  PORT: number;
  HOST: string;
  DATA_DIR: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  OFFLINE: boolean;
}

/** Minimal .env reader (KEY=value lines); real env vars win. */
function readDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env, dotenvPath = resolve('.env')): Env {
  const merged = { ...readDotEnv(dotenvPath), ...env };
  return {
    PORT: Number(merged.PORT || 4321),
    HOST: merged.HOST || '127.0.0.1',
    DATA_DIR: resolve(merged.DATA_DIR || './data'),
    STRAVA_CLIENT_ID: merged.STRAVA_CLIENT_ID || undefined,
    STRAVA_CLIENT_SECRET: merged.STRAVA_CLIENT_SECRET || undefined,
    OFFLINE: merged.OFFLINE === '1',
  };
}
