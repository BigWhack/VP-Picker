import type { Db } from '../../db/client.js';
import type { StravaSync } from '../../sync/job.js';
import { getSettings, getState, setState } from '../../repo/settings.js';
import { queueAdd, queueDone, queueFail, queueNext, queueSetStep } from '../../repo/strava.js';
import { deleteRecord, getGear, saveExtras, saveGear, updateStravaSummary, upsertRecord } from '../../repo/workouts.js';
import { localDate } from '../../analytics/dates.js';
import { RateLimitedError, StravaAuthError, StravaHttpError, type StravaClient } from './client.js';
import { mapActivity, mapStreams, type StravaActivity } from './map.js';

const STREAM_KEYS = 'time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth';
const RECENT_DAYS = 30;
const PER_PAGE = 200;

export function createStravaSync(db: Db, client: StravaClient): StravaSync {
  const exists = (id: string) => !!db.prepare(`SELECT 1 FROM workout_records WHERE source = 'strava' AND source_id = ?`).get(id);
  const latestStart = () => (db.prepare(`SELECT MAX(start) AS m FROM workout_records WHERE source = 'strava'`).get() as { m: string | null }).m;

  /** All activities matching `query`, following page numbers (never re-requests the same page). */
  async function listAll(query: Record<string, number>): Promise<StravaActivity[]> {
    const out: StravaActivity[] = [];
    for (let page = 1; ; page++) {
      const list = await client.get<StravaActivity[]>('/athlete/activities', { per_page: PER_PAGE, page, ...query });
      out.push(...list);
      if (list.length < PER_PAGE) return out;
    }
  }

  return {
    async poll() {
      const result = { newActivities: 0, queued: 0, processed: 0, affectedDates: [] as string[] };
      if (!client.connected()) return result;
      const tz = getSettings(db).tz;
      const now = client.nowDate();
      const remember = (acts: StravaActivity[]) => {
        const fresh = acts.filter((a) => !exists(String(a.id)));
        for (const a of fresh) {
          const r = mapActivity(a);
          upsertRecord(db, r, a);
          result.affectedDates.push(localDate(r.start, tz));
        }
        queueAdd(db, fresh.map((a) => String(a.id)));
        result.newActivities += fresh.length;
        result.queued += fresh.length;
      };
      try {
        // New activities plus edits/deletions in the recent window. One fixed `after` with page numbers, so the
        // loop always ends even if Strava treats `after` as inclusive.
        const latest = latestStart();
        if (latest) {
          const recentFrom = Math.floor(now.getTime() / 1000) - RECENT_DAYS * 86400;
          const after = Math.min(recentFrom, Math.floor(Date.parse(latest) / 1000) - 1);
          const listed = await listAll({ after });
          remember(listed);
          for (const a of listed) {
            if (!exists(String(a.id))) continue;
            updateStravaSummary(db, mapActivity(a));
          }
          const listedIds = new Set(listed.map((a) => String(a.id)));
          const stored = db.prepare(`SELECT source_id, start FROM workout_records WHERE source = 'strava' AND start >= ?`)
            .all(new Date(after * 1000 + 1000).toISOString()) as { source_id: string; start: string }[];
          for (const r of stored) {
            if (!listedIds.has(r.source_id)) { deleteRecord(db, 'strava', r.source_id); result.affectedDates.push(localDate(r.start, tz)); }
          }
        }
        // Backfill older history with a persisted `before` cursor (newest first), resumable across runs
        if (!getState<boolean>(db, 'strava.backfillDone')) {
          let before = getState<number>(db, 'strava.backfillBefore') ?? Math.floor(now.getTime() / 1000) + 86400;
          for (;;) {
            const page = await client.get<StravaActivity[]>('/athlete/activities', { per_page: PER_PAGE, page: 1, before });
            if (!page.length) { setState(db, 'strava.backfillDone', true); break; }
            remember(page);
            const oldest = Math.min(...page.map((a) => Math.floor(Date.parse(a.start_date) / 1000)));
            if (oldest >= before) { setState(db, 'strava.backfillDone', true); break; } // no progress: stop rather than loop
            before = oldest;
            setState(db, 'strava.backfillBefore', before);
          }
        }
        // Detail (laps, splits, best efforts, gear) then streams for each queued activity. Each item is tried at
        // most once per sync, so a failing one waits for the next sync instead of burning its retries at once.
        const tried = new Set<string>();
        for (let item = queueNext(db, tried); item; item = queueNext(db, tried)) {
          const { id } = item;
          tried.add(id);
          try {
            if (item.step === 'detail') {
              const detail = await client.get<StravaActivity & Record<string, unknown>>(`/activities/${id}`, { include_all_efforts: true });
              const record = mapActivity(detail);
              const { laps, splits_metric, best_efforts, segment_efforts, ...rest } = detail as Record<string, unknown>;
              upsertRecord(db, record, rest);
              saveExtras(db, id, { laps, splits: splits_metric, bestEfforts: best_efforts, segments: segment_efforts });
              if (record.gearId && !getGear(db, record.gearId)) {
                const g = await client.get<{ id: string; name: string; distance: number }>(`/gear/${record.gearId}`);
                saveGear(db, { id: g.id, name: g.name, kind: record.gearId.startsWith('b') ? 'bike' : 'shoe', distanceM: g.distance });
              }
              queueSetStep(db, id, 'streams');
            }
            try {
              const streams = await client.get<Record<string, { data: unknown[] }>>(`/activities/${id}/streams`, { keys: STREAM_KEYS, key_by_type: true });
              const rec = db.prepare(`SELECT raw_json FROM workout_records WHERE source = 'strava' AND source_id = ?`).get(id) as { raw_json: string | null } | undefined;
              const raw = rec?.raw_json ? (JSON.parse(rec.raw_json) as StravaActivity) : null;
              if (raw) upsertRecord(db, mapActivity(raw), raw, mapStreams(streams));
            } catch (e) {
              if (!(e instanceof StravaHttpError && e.status === 404)) throw e; // manual/indoor activity without streams
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
