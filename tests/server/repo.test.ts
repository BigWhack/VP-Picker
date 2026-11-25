import { describe, it, expect } from 'vitest';
import { testDb } from '../helpers/db.js';
import { upsertSamples, getSamples } from '../../server/repo/samples.js';
import { getSettings, updateSettings } from '../../server/repo/settings.js';
import { upsertRecord, getRecordStreams, getWorkoutRecords } from '../../server/repo/workouts.js';
import type { Sample, Streams, WorkoutRecord } from '../../shared/types.js';

const samples: Sample[] = [0, 1, 2].map((i) => ({
  metric: 'steps', start: `2026-11-24T0${i}:00:00.000Z`, end: `2026-11-24T0${i + 1}:00:00.000Z`,
  value: 100 + i, unit: 'count', source: 'Watch',
}));

describe('repositories', () => {
  it('upserting the same samples twice keeps one row each', () => {
    const db = testDb();
    upsertSamples(db, samples);
    upsertSamples(db, samples);
    expect(getSamples(db, 'steps', '2026-11-24T00:00:00Z', '2026-11-25T00:00:00Z')).toHaveLength(3);
  });

  it('returns default settings and persists updates', () => {
    const db = testDb();
    const s = getSettings(db);
    expect(s).toMatchObject({ sleepNeedMin: 450, zoneModel: 'hrr', units: 'metric', lanMode: false });
    updateSettings(db, { sleepNeedMin: 480 });
    expect(getSettings(db).sleepNeedMin).toBe(480);
  });

  it('round-trips workout streams through compression', () => {
    const db = testDb();
    const rec: WorkoutRecord = { source: 'apple', sourceId: 'a1', sport: 'run', start: '2026-11-23T07:00:00.000Z',
      end: '2026-11-23T07:52:14.000Z', tzOffsetMin: 0, durationS: 3134, distanceM: 10200 };
    const streams: Streams = { time: [0, 1, 2], heartrate: [120, 121, 122], latlng: [[51.5, -0.1], [51.5, -0.1], [51.5, -0.1]] };
    upsertRecord(db, rec, { raw: true }, streams);
    expect(getRecordStreams(db, 'apple', 'a1')).toEqual(streams);
    expect(getWorkoutRecords(db, '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z')[0]).toMatchObject({ sourceId: 'a1', distanceM: 10200 });
  });
});
