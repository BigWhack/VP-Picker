import type { Db } from '../db/client.js';
import type { Settings } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';

export function defaultSettings(): Settings {
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London',
    sleepNeedMin: CONFIG.sleep.defaultNeedMin,
    goals: { steps: 10000, activeKcal: 600, exerciseMin: 30, standHours: 12 },
    zoneModel: 'hrr',
    units: 'metric',
    lanMode: false,
  };
}

export function getSettings(db: Db): Settings {
  const rows = db.prepare(`SELECT key, value_json FROM settings`).all() as { key: string; value_json: string }[];
  const s = defaultSettings() as unknown as Record<string, unknown>;
  for (const r of rows) if (!r.key.includes('.')) s[r.key] = JSON.parse(r.value_json);
  return s as unknown as Settings;
}

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  const stmt = db.prepare(`INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`);
  const del = db.prepare(`DELETE FROM settings WHERE key = ?`);
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) del.run(k);
      else stmt.run(k, JSON.stringify(v));
    }
  })();
  return getSettings(db);
}

/** Internal key/value state (keys contain a dot so they never appear in Settings). */
export function getState<T>(db: Db, key: string): T | null {
  const r = db.prepare(`SELECT value_json FROM settings WHERE key = ?`).get(key) as { value_json: string } | undefined;
  return r ? (JSON.parse(r.value_json) as T) : null;
}

export function setState(db: Db, key: string, value: unknown): void {
  if (!key.includes('.')) throw new Error('state keys must contain a dot');
  if (value === null || value === undefined) db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  else db.prepare(`INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(key, JSON.stringify(value));
}
