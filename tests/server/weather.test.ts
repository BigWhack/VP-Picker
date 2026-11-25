import { describe, it, expect } from 'vitest';
import { weatherUrl, enrichWeather, nearestHour, decodePolyline } from '../../server/ingest/weather.js';
import { testDb } from '../helpers/db.js';
import { upsertRecord, getWorkout } from '../../server/repo/workouts.js';
import { rebuildWorkouts } from '../../server/merge/workouts.js';

const NOW = new Date('2026-11-24T08:00:00Z');
const hourly = {
  time: ['2026-11-23T06:00', '2026-11-23T07:00', '2026-11-23T08:00'],
  temperature_2m: [5, 6.5, 8], relative_humidity_2m: [90, 85, 80], wind_speed_10m: [10, 12, 14], wind_direction_10m: [200, 210, 220], precipitation: [0, 0.2, 0],
};

describe('weather', () => {
  it('uses the archive API for old workouts and the forecast API for recent ones', () => {
    expect(weatherUrl(51.5, -0.1, '2026-11-01T07:00:00Z', NOW)).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?/);
    const recent = weatherUrl(51.5, -0.1, '2026-11-23T07:00:00Z', NOW);
    expect(recent).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    expect(recent).toContain('past_days=7');
    expect(recent).toContain('hourly=temperature_2m%2Crelative_humidity_2m%2Cwind_speed_10m%2Cwind_direction_10m%2Cprecipitation');
  });

  it('picks the hour nearest the start', () => {
    expect(nearestHour(hourly, '2026-11-23T07:20:00Z')).toEqual({ tempC: 6.5, humidity: 85, windKmh: 12, windFromDeg: 210, precipMm: 0.2 });
  });

  it('decodes a Google polyline', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });

  it('enriches GPS workouts, skips indoor ones and survives fetch failures', async () => {
    const db = testDb();
    upsertRecord(db, { source: 'strava', sourceId: 's1', sport: 'run', start: '2026-11-23T07:00:00.000Z', end: '2026-11-23T07:50:00.000Z', tzOffsetMin: 0, durationS: 3000, polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }, null);
    upsertRecord(db, { source: 'apple', sourceId: 'a2', sport: 'strength', start: '2026-11-22T18:00:00.000Z', end: '2026-11-22T18:45:00.000Z', tzOffsetMin: 0, durationS: 2700 }, null);
    rebuildWorkouts(db);
    const calls: string[] = [];
    const ok = (async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify({ hourly })); }) as typeof fetch;
    expect(await enrichWeather(db, ok, 50, NOW)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('latitude=38.5');
    expect(getWorkout(db, 'strava:s1')!.weather).toMatchObject({ tempC: 6.5 });
    expect(getWorkout(db, 'apple:a2')!.weather).toBeNull();

    const db2 = testDb();
    upsertRecord(db2, { source: 'strava', sourceId: 's1', sport: 'run', start: '2026-11-23T07:00:00.000Z', end: '2026-11-23T07:50:00.000Z', tzOffsetMin: 0, durationS: 3000, polyline: '_p~iF~ps|U' }, null);
    rebuildWorkouts(db2);
    const bad = (async () => { throw new Error('offline'); }) as typeof fetch;
    expect(await enrichWeather(db2, bad, 50, NOW)).toBe(0);
    expect(getWorkout(db2, 'strava:s1')!.weather).toBeNull();
  });
});
