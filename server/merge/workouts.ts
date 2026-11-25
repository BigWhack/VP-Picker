import type { Db } from '../db/client.js';
import { getWorkoutRecords, replaceWorkouts, type MergedWorkout } from '../repo/workouts.js';

/** Initial version: every Apple record becomes one workout. Task 16 replaces this with Apple/Strava matching. */
export function rebuildWorkouts(db: Db): number {
  const recs = getWorkoutRecords(db, '1970-01-01T00:00:00Z', '2999-01-01T00:00:00Z');
  const list: MergedWorkout[] = recs.map((r) => {
    const { source, sourceId, ...rest } = r;
    return { ...rest, id: `${source}:${sourceId}`, ...(source === 'apple' ? { appleId: sourceId } : { stravaId: sourceId }), sources: [source] };
  });
  replaceWorkouts(db, list);
  return list.length;
}
