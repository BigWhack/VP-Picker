import type { Sport, Streams, WorkoutRecord } from '../../../shared/types.js';

export interface StravaActivity {
  id: number; name: string; sport_type?: string; type?: string; start_date: string; utc_offset?: number;
  elapsed_time: number; moving_time?: number; distance?: number; total_elevation_gain?: number;
  average_heartrate?: number; max_heartrate?: number; calories?: number; kilojoules?: number; gear_id?: string | null;
  map?: { polyline?: string | null; summary_polyline?: string | null };
}

const SPORTS: Record<string, Sport> = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Ride: 'ride', VirtualRide: 'ride', GravelRide: 'ride', MountainBikeRide: 'ride', EBikeRide: 'ride', EMountainBikeRide: 'ride',
  Walk: 'walk', Hike: 'hike', Swim: 'swim', WeightTraining: 'strength', HighIntensityIntervalTraining: 'hiit', Crossfit: 'hiit',
};

export function mapActivity(a: StravaActivity): WorkoutRecord {
  const start = new Date(a.start_date).toISOString();
  const r: WorkoutRecord = {
    source: 'strava', sourceId: String(a.id), sport: SPORTS[a.sport_type ?? a.type ?? ''] ?? 'other', start,
    end: new Date(Date.parse(start) + a.elapsed_time * 1000).toISOString(), tzOffsetMin: Math.round((a.utc_offset ?? 0) / 60),
    durationS: a.elapsed_time, name: a.name,
  };
  if (a.moving_time !== undefined) r.movingS = a.moving_time;
  if (a.distance) r.distanceM = a.distance;
  if (a.total_elevation_gain !== undefined) r.elevGainM = a.total_elevation_gain;
  if (a.average_heartrate) r.avgHr = a.average_heartrate;
  if (a.max_heartrate) r.maxHr = a.max_heartrate;
  if (a.calories) r.energyKcal = a.calories;
  else if (a.kilojoules) r.energyKcal = a.kilojoules; // kJ of mechanical work ≈ kcal burned (≈24% efficiency cancels 4.184 kJ/kcal)
  if (a.gear_id) r.gearId = a.gear_id;
  const poly = a.map?.polyline || a.map?.summary_polyline;
  if (poly) r.polyline = poly;
  return r;
}

type KeyedStreams = Record<string, { data: unknown[] }>;

export function mapStreams(s: KeyedStreams): Streams {
  const d = <T>(k: string) => (s[k]?.data as T[] | undefined);
  const out: Streams = { time: d<number>('time') ?? [] };
  const set = <K extends keyof Streams>(k: K, v: Streams[K] | undefined) => { if (v && (v as unknown[]).length) out[k] = v; };
  set('distance', d<number>('distance'));
  set('latlng', d<[number, number]>('latlng'));
  set('altitude', d<number>('altitude'));
  set('speed', d<number>('velocity_smooth'));
  set('heartrate', d<number>('heartrate'));
  set('cadence', d<number>('cadence'));
  set('watts', d<number>('watts'));
  set('grade', d<number>('grade_smooth'));
  set('moving', d<boolean>('moving'));
  return out;
}
