import type { Db } from '../../db/client.js';
import type { StravaSync } from '../../sync/job.js';
import { getState, setState } from '../../repo/settings.js';
import { queueAdd, queueDone, queueFail, queueNext } from '../../repo/strava.js';
import { getGear, saveExtras, saveGear, upsertRecord } from '../../repo/workouts.js';
import { RateLimitedError, StravaAuthError, type StravaClient } from './client.js';
import { mapActivity, mapStreams, type StravaActivity } from './map.js';

const STREAM_KEYS = 'time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth';

export function createStravaSync(db: Db, client: StravaClient): StravaSync {
  const exists = (id: string) => !!db.prepare(`SELECT 1 FROM workout_records WHERE source = 'strava' AND source_id = ?`).get(id);
  const latestStart = () => (db.prepare(`SELECT MAX(start) AS m FROM workout_records WHERE source = 'strava'`).get() as { m: string | null }).m;

  async function listPage(query: Record<string, number>): Promise<StravaActivity[]> {
    return client.get<StravaActivity[]>('/athlete/activities', { per_page: 200, page: 1, ...query });
  }

  return {
    async poll() {
      const result = { newActivities: 0, queued: 0, processed: 0, affectedDates: [] as string[] };
      if (!client.connected()) return result;
      const remember = (acts: StravaActivity[]) => {
        const fresh = acts.filter((a) => !exists(String(a.id)));
        for (const a of fresh) {
          const r = mapActivity(a);
          upsertRecord(db, r, a);
          result.affectedDates.push(r.start.slice(0, 10));
        }
        queueAdd(db, fresh.map((a) => String(a.id)));
        result.newActivities += fresh.length;
        result.queued += fresh.length;
      };
      try {
        // New activities since the latest one we know (ascending order when `after` is used)
        const latest = latestStart();
        if (latest) {
          let after = Math.floor(Date.parse(latest) / 1000);
          for (;;) {
            const page = await listPage({ after });
            if (!page.length) break;
            remember(page);
            after = Math.max(...page.map((a) => Math.floor(Date.parse(a.start_date) / 1000)));
          }
        }
        // Backfill older history with a `before` cursor (newest first), resumable across runs
        if (!getState<boolean>(db, 'strava.backfillDone')) {
          let before = getState<number>(db, 'strava.backfillBefore') ?? Math.floor(Date.now() / 1000) + 86400;
          for (;;) {
            const page = await listPage({ before });
            if (!page.length) { setState(db, 'strava.backfillDone', true); break; }
            remember(page);
            before = Math.min(...page.map((a) => Math.floor(Date.parse(a.start_date) / 1000)));
            setState(db, 'strava.backfillBefore', before);
          }
        }
        // Detail, streams and gear for each queued activity
        for (let id = queueNext(db); id; id = queueNext(db)) {
          try {
            const detail = await client.get<StravaActivity & Record<string, unknown>>(`/activities/${id}`, { include_all_efforts: true });
            const streams = await client.get<Record<string, { data: unknown[] }>>(`/activities/${id}/streams`, { keys: STREAM_KEYS, key_by_type: true });
            const record = mapActivity(detail);
            const { laps, splits_metric, best_efforts, segment_efforts, ...rest } = detail as Record<string, unknown>;
            upsertRecord(db, record, rest, mapStreams(streams));
            saveExtras(db, id, { laps, splits: splits_metric, bestEfforts: best_efforts, segments: segment_efforts });
            if (record.gearId && !getGear(db, record.gearId)) {
              const g = await client.get<{ id: string; name: string; distance: number; frame_type?: number }>(`/gear/${record.gearId}`);
              saveGear(db, { id: g.id, name: g.name, kind: record.gearId.startsWith('b') ? 'bike' : 'shoe', distanceM: g.distance });
            }
            queueDone(db, id);
            result.processed++;
          } catch (e) {
            if (e instanceof RateLimitedError || e instanceof StravaAuthError) throw e;
            queueFail(db, id, (e as Error).message);
          }
        }
      } catch (e) {
        if (e instanceof RateLimitedError) return result;
        throw e;
      }
      return result;
    },
  };
}
