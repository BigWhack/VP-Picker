import type { Db } from '../db/client.js';
import type { Sample } from '../../shared/types.js';

export function upsertSamples(db: Db, s: Sample[]): number {
  const stmt = db.prepare(`INSERT INTO samples (metric, start, "end", value, unit, source) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(metric, start, "end", source) DO UPDATE SET value = excluded.value, unit = excluded.unit`);
  const tx = db.transaction((rows: Sample[]) => {
    for (const r of rows) stmt.run(r.metric, r.start, r.end, r.value, r.unit, r.source);
  });
  tx(s);
  return s.length;
}

export function getSamples(db: Db, metric: string, fromIso: string, toIso: string): Sample[] {
  return db.prepare(`SELECT metric, start, "end", value, unit, source FROM samples
    WHERE metric = ? AND start >= ? AND start < ? ORDER BY start`).all(metric, iso(fromIso), iso(toIso)) as Sample[];
}

export function latestSampleStart(db: Db): string | null {
  const r = db.prepare(`SELECT MAX(start) AS m FROM samples`).get() as { m: string | null };
  return r.m;
}

/** Normalise any ISO string to the stored millisecond form so string comparison is correct. */
export function iso(s: string): string {
  return new Date(s).toISOString();
}
