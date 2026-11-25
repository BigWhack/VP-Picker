import { describe, it, expect } from 'vitest';
import { matchWorkouts, rebuildWorkouts, sportFamily } from '../../server/merge/workouts.js';
import { testDb } from '../helpers/db.js';
import { upsertRecord, listWorkouts } from '../../server/repo/workouts.js';
import type { WorkoutRecord } from '../../shared/types.js';

const rec = (source: 'apple' | 'strava', id: string, sport: WorkoutRecord['sport'], start: string, durationS: number, extra: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
  source, sourceId: id, sport, start: new Date(start).toISOString(), end: new Date(Date.parse(start) + durationS * 1000).toISOString(), tzOffsetMin: 0, durationS, ...extra,
});

describe('workout merging', () => {
  it('groups run/walk/hike as on-foot', () => {
    expect(sportFamily('walk')).toBe('foot');
    expect(sportFamily('ride')).toBe('ride');
  });

  it('matches the same session from both sources', () => {
    const m = matchWorkouts([rec('apple', 'a1', 'run', '2026-11-23T07:00:00Z', 3134)], [rec('strava', 's1', 'run', '2026-11-23T07:00:40Z', 3100)]);
    expect(m).toEqual([{ appleId: 'a1', stravaId: 's1' }]);
  });

  it('does not match when starts are more than 2 minutes apart', () => {
    const m = matchWorkouts([rec('apple', 'a1', 'run', '2026-11-23T07:00:00Z', 3134)], [rec('strava', 's1', 'run', '2026-11-23T07:05:00Z', 3100)]);
    expect(m).toHaveLength(2);
  });

  it('does not match different sports or very different durations', () => {
    expect(matchWorkouts([rec('apple', 'a1', 'run', '2026-11-23T07:00:00Z', 3134)], [rec('strava', 's1', 'ride', '2026-11-23T07:00:00Z', 3134)])).toHaveLength(2);
    expect(matchWorkouts([rec('apple', 'a1', 'run', '2026-11-23T07:00:00Z', 3134)], [rec('strava', 's1', 'run', '2026-11-23T07:00:00Z', 2000)])).toHaveLength(2);
  });

  it('merges fields by precedence and keeps ids stable', () => {
    const db = testDb();
    upsertRecord(db, rec('apple', 'a1', 'run', '2026-11-23T07:00:00Z', 3134, { avgHr: 148, maxHr: 171, energyKcal: 640, distanceM: 10150, name: 'Outdoor Run' }), null);
    upsertRecord(db, rec('strava', 's1', 'run', '2026-11-23T07:00:40Z', 3100, { avgHr: 150, name: 'Morning run', gearId: 'g1', polyline: 'abc', distanceM: 10200, elevGainM: 45 }), null);
    upsertRecord(db, rec('apple', 'a2', 'strength', '2026-11-22T18:00:00Z', 2700), null);
    expect(rebuildWorkouts(db)).toBe(2);
    const run = listWorkouts(db, { sport: 'run' }).items[0];
    expect(run).toMatchObject({ id: 'strava:s1', appleId: 'a1', stravaId: 's1', avgHr: 148, maxHr: 171, energyKcal: 640, name: 'Morning run',
      gearId: 'g1', polyline: 'abc', distanceM: 10200, elevGainM: 45, sources: ['apple', 'strava'] });
    rebuildWorkouts(db);
    expect(listWorkouts(db).items.map((w) => w.id).sort()).toEqual(['apple:a2', 'strava:s1']);
  });
});
