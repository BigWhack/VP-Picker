import { gzipSync, gunzipSync } from 'node:zlib';
import type { Db } from '../db/client.js';
import type { Streams, WorkoutRecord } from '../../shared/types.js';
import { iso } from './samples.js';

const COLS = ['sport', 'start', 'end', 'tz_offset_min', 'duration_s', 'moving_s', 'distance_m', 'elev_gain_m',
  'energy_kcal', 'avg_hr', 'max_hr', 'name', 'gear_id', 'polyline'] as const;

export function recordValues(r: Omit<WorkoutRecord, 'source' | 'sourceId'>): unknown[] {
  return [r.sport, r.start, r.end, r.tzOffsetMin, r.durationS, r.movingS ?? null, r.distanceM ?? null,
    r.elevGainM ?? null, r.energyKcal ?? null, r.avgHr ?? null, r.maxHr ?? null, r.name ?? null, r.gearId ?? null,
    r.polyline ?? null];
}

export function rowToRecord(row: Record<string, unknown>): WorkoutRecord {
  const out: Record<string, unknown> = {
    source: row.source, sourceId: row.source_id, sport: row.sport, start: row.start, end: row.end,
    tzOffsetMin: row.tz_offset_min, durationS: row.duration_s, movingS: row.moving_s, distanceM: row.distance_m,
    elevGainM: row.elev_gain_m, energyKcal: row.energy_kcal, avgHr: row.avg_hr, maxHr: row.max_hr, name: row.name,
    gearId: row.gear_id, polyline: row.polyline,
  };
  for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined) delete out[k];
  return out as unknown as WorkoutRecord;
}

export function packStreams(s: Streams): Buffer { return gzipSync(JSON.stringify(s)); }
export function unpackStreams(b: Buffer): Streams { return JSON.parse(gunzipSync(b).toString('utf8')); }

export function upsertRecord(db: Db, r: WorkoutRecord, raw: unknown, streams?: Streams | null): void {
  const cols = ['source', 'source_id', ...COLS, 'raw_json'];
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const sets = [...COLS, 'raw_json'].map((c) => `"${c}" = excluded."${c}"`).join(', ');
  db.prepare(`INSERT INTO workout_records (${quoted}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT(source, source_id) DO UPDATE SET ${sets}`)
    .run(r.source, r.sourceId, ...recordValues(r), raw === undefined ? null : JSON.stringify(raw));
  if (streams) {
    db.prepare(`INSERT INTO record_streams (source, source_id, json_gz) VALUES (?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET json_gz = excluded.json_gz`).run(r.source, r.sourceId, packStreams(streams));
  }
}

export function getWorkoutRecords(db: Db, fromIso: string, toIso: string, source?: 'apple' | 'strava'): WorkoutRecord[] {
  const rows = db.prepare(`SELECT * FROM workout_records WHERE start >= ? AND start < ? ${source ? 'AND source = ?' : ''} ORDER BY start`)
    .all(...[iso(fromIso), iso(toIso), ...(source ? [source] : [])]) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function getRecordRaw(db: Db, source: string, id: string): unknown | null {
  const r = db.prepare(`SELECT raw_json FROM workout_records WHERE source = ? AND source_id = ?`).get(source, id) as { raw_json: string | null } | undefined;
  return r?.raw_json ? JSON.parse(r.raw_json) : null;
}

export function getRecordStreams(db: Db, source: string, id: string): Streams | null {
  const r = db.prepare(`SELECT json_gz FROM record_streams WHERE source = ? AND source_id = ?`).get(source, id) as { json_gz: Buffer } | undefined;
  return r ? unpackStreams(r.json_gz) : null;
}

export interface MergedWorkout extends Omit<WorkoutRecord, 'source' | 'sourceId'> {
  id: string; appleId?: string; stravaId?: string; sources: ('apple' | 'strava')[]; weather?: Weather | null;
}
export interface Weather { tempC: number; humidity: number; windKmh: number; windFromDeg: number; precipMm: number }

function rowToWorkout(row: Record<string, unknown>): MergedWorkout {
  const base = rowToRecord({ ...row, source: 'x', source_id: 'x' }) as unknown as Record<string, unknown>;
  delete base.source; delete base.sourceId;
  return {
    ...(base as unknown as MergedWorkout), id: row.id as string,
    appleId: (row.apple_id as string) ?? undefined, stravaId: (row.strava_id as string) ?? undefined,
    sources: JSON.parse(row.sources as string), weather: row.weather_json ? JSON.parse(row.weather_json as string) : null,
  };
}

export function replaceWorkouts(db: Db, list: MergedWorkout[]): void {
  const keepWeather = new Map((db.prepare(`SELECT id, weather_json FROM workouts`).all() as { id: string; weather_json: string | null }[])
    .map((r) => [r.id, r.weather_json]));
  const cols = ['id', 'apple_id', 'strava_id', ...COLS, 'sources', 'weather_json'];
  const stmt = db.prepare(`INSERT INTO workouts (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  db.transaction(() => {
    db.prepare(`DELETE FROM workouts`).run();
    for (const w of list) {
      stmt.run(w.id, w.appleId ?? null, w.stravaId ?? null, ...recordValues(w), JSON.stringify(w.sources), keepWeather.get(w.id) ?? null);
    }
  })();
}

export function getWorkout(db: Db, id: string): MergedWorkout | null {
  const r = db.prepare(`SELECT * FROM workouts WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToWorkout(r) : null;
}

export interface WorkoutFilter { sport?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number }

export function listWorkouts(db: Db, f: WorkoutFilter = {}): { items: MergedWorkout[]; total: number } {
  const where: string[] = []; const args: unknown[] = [];
  if (f.sport) { where.push('sport = ?'); args.push(f.sport); }
  if (f.q) { where.push('name LIKE ?'); args.push(`%${f.q}%`); }
  if (f.from) { where.push('start >= ?'); args.push(iso(f.from)); }
  if (f.to) { where.push('start < ?'); args.push(iso(f.to)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM workouts ${w}`).get(...args) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM workouts ${w} ORDER BY start DESC LIMIT ? OFFSET ?`)
    .all(...args, f.limit ?? 1000000, f.offset ?? 0) as Record<string, unknown>[];
  return { items: rows.map(rowToWorkout), total };
}

export function setWeather(db: Db, id: string, w: Weather): void {
  db.prepare(`UPDATE workouts SET weather_json = ? WHERE id = ?`).run(JSON.stringify(w), id);
}

export function workoutStreams(db: Db, w: MergedWorkout): Streams | null {
  // Apple streams carry HR; Strava streams carry the cleaned GPS/distance. Combine where both exist.
  const apple = w.appleId ? getRecordStreams(db, 'apple', w.appleId) : null;
  const strava = w.stravaId ? getRecordStreams(db, 'strava', w.stravaId) : null;
  if (strava && apple && !strava.heartrate && apple.heartrate) {
    return { ...strava, heartrate: resample(apple.time, apple.heartrate, strava.time) };
  }
  return strava ?? apple;
}

function resample(t: number[], v: number[], target: number[]): number[] {
  const out: number[] = []; let j = 0;
  for (const x of target) {
    while (j < t.length - 1 && t[j + 1] <= x) j++;
    out.push(v[j]);
  }
  return out;
}

export function saveGear(db: Db, g: { id: string; name: string; kind: string; distanceM: number }): void {
  db.prepare(`INSERT INTO gear (id, name, kind, distance_m) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, kind = excluded.kind, distance_m = excluded.distance_m`).run(g.id, g.name, g.kind, g.distanceM);
}

export function getGear(db: Db, id: string): { id: string; name: string; kind: string; distanceM: number } | null {
  const r = db.prepare(`SELECT id, name, kind, distance_m AS distanceM FROM gear WHERE id = ?`).get(id);
  return (r as never) ?? null;
}

export function saveExtras(db: Db, stravaId: string, e: { laps?: unknown; splits?: unknown; bestEfforts?: unknown; segments?: unknown }): void {
  db.prepare(`INSERT INTO workout_extras (strava_id, laps_json, splits_json, best_efforts_json, segments_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(strava_id) DO UPDATE SET laps_json = excluded.laps_json, splits_json = excluded.splits_json,
    best_efforts_json = excluded.best_efforts_json, segments_json = excluded.segments_json`)
    .run(stravaId, j(e.laps), j(e.splits), j(e.bestEfforts), j(e.segments));
}

export function getExtras(db: Db, stravaId: string): { laps: unknown; splits: unknown; bestEfforts: unknown; segments: unknown } | null {
  const r = db.prepare(`SELECT * FROM workout_extras WHERE strava_id = ?`).get(stravaId) as Record<string, string | null> | undefined;
  if (!r) return null;
  const p = (s: string | null) => (s ? JSON.parse(s) : null);
  return { laps: p(r.laps_json), splits: p(r.splits_json), bestEfforts: p(r.best_efforts_json), segments: p(r.segments_json) };
}

const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/** Refresh summary fields of an existing Strava record (rename, sport or gear change) without touching detail data. */
export function updateStravaSummary(db: Db, r: WorkoutRecord): void {
  db.prepare(`UPDATE workout_records SET name = ?, sport = ?, gear_id = ?, distance_m = COALESCE(?, distance_m), duration_s = ?, moving_s = COALESCE(?, moving_s),
    "end" = ?, elev_gain_m = COALESCE(?, elev_gain_m) WHERE source = 'strava' AND source_id = ?`)
    .run(r.name ?? null, r.sport, r.gearId ?? null, r.distanceM ?? null, r.durationS, r.movingS ?? null, r.end, r.elevGainM ?? null, r.sourceId);
}

/** Remove a source record with its streams and extras (e.g. an activity deleted on Strava). */
export function deleteRecord(db: Db, source: 'apple' | 'strava', id: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM workout_records WHERE source = ? AND source_id = ?`).run(source, id);
    db.prepare(`DELETE FROM record_streams WHERE source = ? AND source_id = ?`).run(source, id);
    if (source === 'strava') {
      db.prepare(`DELETE FROM workout_extras WHERE strava_id = ?`).run(id);
      db.prepare(`DELETE FROM strava_queue WHERE activity_id = ?`).run(id);
    }
  })();
}
