import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb } from '../helpers/db.js';
import { seedDemo } from '../helpers/seed.js';
import { upsertRecord, listWorkouts, getWorkout } from '../../server/repo/workouts.js';
import { saveAnalysis, getAnalysis } from '../../server/repo/derived.js';
import { saveExtras } from '../../server/repo/workouts.js';
import { rebuildWorkouts } from '../../server/merge/workouts.js';
import { recompute } from '../../server/analytics/recompute.js';
import { recordsBoard } from '../../server/analytics/records.js';
import { enrichWeather } from '../../server/ingest/weather.js';
import { updateSettings } from '../../server/repo/settings.js';
import type { WorkoutRecord } from '../../shared/types.js';

const NOW = new Date('2026-11-24T08:00:00Z');
const rec = (source: 'apple' | 'strava', id: string, start: string, extra: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
  source, sourceId: id, sport: 'run', start, end: new Date(Date.parse(start) + 3000000).toISOString(), tzOffsetMin: 0, durationS: 3000, ...extra,
});

describe('M5: stable workout ids', () => {
  it('keeps the id when the Strava copy arrives and removes orphaned analyses', () => {
    const db = testDb();
    upsertRecord(db, rec('apple', 'a1', '2026-11-23T07:00:00.000Z'), null);
    rebuildWorkouts(db);
    expect(listWorkouts(db).items[0].id).toBe('apple:a1');
    saveAnalysis(db, 'apple:a1', { kind: 'run', load: 1 });
    saveAnalysis(db, 'apple:gone', { kind: 'run', load: 1 });
    upsertRecord(db, rec('strava', 's1', '2026-11-23T07:00:30.000Z', { name: 'Morning run' }), null);
    rebuildWorkouts(db);
    const w = listWorkouts(db).items;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: 'apple:a1', stravaId: 's1', name: 'Morning run' });
    expect(getAnalysis(db, 'apple:a1')).not.toBeNull();
    expect(getAnalysis(db, 'apple:gone')).toBeNull();
  });
});

describe('M6/M10: records come from cached analyses and use local dates', () => {
  it('serves personal bests without reading streams, dated in the owner time zone', async () => {
    const db = testDb();
    seedDemo(db, 40, NOW);
    updateSettings(db, { tz: 'America/New_York' });
    // 22:00 in New York on the 23rd is 03:00 UTC on the 24th
    upsertRecord(db, rec('strava', 'late', '2026-11-24T03:00:00.000Z', { distanceM: 5000 }), null);
    saveExtras(db, 'late', { bestEfforts: [{ name: '5K', distance: 5000, elapsed_time: 900, moving_time: 900 }] });
    await recompute(db, { now: NOW });
    db.prepare('DELETE FROM record_streams').run();
    const board = recordsBoard(db, '2026-11-24');
    const fiveK = board.current.find((r) => r.label === '5K')!;
    expect(fiveK.best!.timeS).toBe(900);
    expect(fiveK.best!.date).toBe('2026-11-23');
    // efforts from Apple-only runs (which need streams) still count after streams are gone: they come from cached analyses
    const oneK = board.current.find((r) => r.label === '1 km')!;
    expect(oneK.history.some((h) => h.workoutId.startsWith('apple:'))).toBe(true);
    expect(board.predictions.length).toBe(4);
  });

  it('has an index for latest/earliest sample lookups', () => {
    const db = testDb();
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT MAX(start) AS m FROM samples').all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/idx_samples_start/);
  });
});

describe('M7: indoor workouts are not re-checked for weather every sync', () => {
  it('marks workouts without GPS and checks again only if a route appears', async () => {
    const db = testDb();
    upsertRecord(db, rec('apple', 'in1', '2026-11-22T18:00:00.000Z', { sport: 'strength' }), null);
    rebuildWorkouts(db);
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify({ hourly: { time: ['2026-11-22T18:00'], temperature_2m: [5], relative_humidity_2m: [80], wind_speed_10m: [10], wind_direction_10m: [180], precipitation: [0] } })); }) as typeof fetch;
    await enrichWeather(db, f, 50, NOW);
    expect((db.prepare(`SELECT weather_json FROM workouts`).get() as { weather_json: string | null }).weather_json).toBe('false');
    expect(getWorkout(db, 'apple:in1')!.weather).toBeNull();
    expect(calls).toBe(0);
    db.prepare(`UPDATE workouts SET polyline = '_p~iF~ps|U'`).run();
    await enrichWeather(db, f, 50, NOW);
    expect(calls).toBe(1);
  });
});
