import type { Db } from '../db/client.js';
import type { SleepSegment } from '../../shared/types.js';
import { iso } from './samples.js';

export function upsertSleep(db: Db, s: SleepSegment[]): number {
  const stmt = db.prepare(`INSERT INTO sleep_segments (start, "end", stage, source) VALUES (?, ?, ?, ?)
    ON CONFLICT(start, stage, source) DO UPDATE SET "end" = excluded."end"`);
  db.transaction((rows: SleepSegment[]) => { for (const r of rows) stmt.run(r.start, r.end, r.stage, r.source); })(s);
  return s.length;
}

export function getSleep(db: Db, fromIso: string, toIso: string): SleepSegment[] {
  return db.prepare(`SELECT start, "end", stage, source FROM sleep_segments WHERE start >= ? AND start < ? ORDER BY start`)
    .all(iso(fromIso), iso(toIso)) as SleepSegment[];
}
