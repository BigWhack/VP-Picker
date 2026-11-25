import { sqliteTable, text, integer, real, blob, primaryKey } from 'drizzle-orm/sqlite-core';

export const imports = sqliteTable('imports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  path: text('path').notNull(),
  hash: text('hash').notNull().unique(),
  receivedAt: text('received_at').notNull(),
  status: text('status').notNull(),
  error: text('error'),
});

export const samples = sqliteTable('samples', {
  metric: text('metric').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  value: real('value').notNull(),
  unit: text('unit').notNull(),
  source: text('source').notNull(),
}, (t) => [primaryKey({ columns: [t.metric, t.start, t.end, t.source] })]);

export const sleepSegments = sqliteTable('sleep_segments', {
  start: text('start').notNull(),
  end: text('end').notNull(),
  stage: text('stage').notNull(),
  source: text('source').notNull(),
}, (t) => [primaryKey({ columns: [t.start, t.stage, t.source] })]);

const workoutFields = {
  sport: text('sport').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  tzOffsetMin: integer('tz_offset_min').notNull().default(0),
  durationS: real('duration_s').notNull(),
  movingS: real('moving_s'),
  distanceM: real('distance_m'),
  elevGainM: real('elev_gain_m'),
  energyKcal: real('energy_kcal'),
  avgHr: real('avg_hr'),
  maxHr: real('max_hr'),
  name: text('name'),
  gearId: text('gear_id'),
  polyline: text('polyline'),
};

export const workoutRecords = sqliteTable('workout_records', {
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  ...workoutFields,
  rawJson: text('raw_json'),
}, (t) => [primaryKey({ columns: [t.source, t.sourceId] })]);

export const recordStreams = sqliteTable('record_streams', {
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  jsonGz: blob('json_gz', { mode: 'buffer' }).notNull(),
}, (t) => [primaryKey({ columns: [t.source, t.sourceId] })]);

export const workouts = sqliteTable('workouts', {
  id: text('id').primaryKey(),
  appleId: text('apple_id'),
  stravaId: text('strava_id'),
  ...workoutFields,
  sources: text('sources').notNull(),
  weatherJson: text('weather_json'),
});

export const workoutExtras = sqliteTable('workout_extras', {
  stravaId: text('strava_id').primaryKey(),
  lapsJson: text('laps_json'),
  splitsJson: text('splits_json'),
  bestEffortsJson: text('best_efforts_json'),
  segmentsJson: text('segments_json'),
});

export const gear = sqliteTable('gear', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  distanceM: real('distance_m').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
});

export const oauthTokens = sqliteTable('oauth_tokens', {
  provider: text('provider').primaryKey(),
  access: text('access').notNull(),
  refresh: text('refresh').notNull(),
  expiresAt: integer('expires_at').notNull(),
  athleteJson: text('athlete_json'),
});

export const stravaQueue = sqliteTable('strava_queue', {
  activityId: text('activity_id').primaryKey(),
  step: text('step').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  addedAt: text('added_at').notNull(),
});

export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  countsJson: text('counts_json'),
  error: text('error'),
});

export const daily = sqliteTable('daily', {
  date: text('date').primaryKey(),
  json: text('json').notNull(),
});

export const baselines = sqliteTable('baselines', {
  date: text('date').notNull(),
  metric: text('metric').notNull(),
  median: real('median').notNull(),
  iqr: real('iqr').notNull(),
  n: integer('n').notNull(),
}, (t) => [primaryKey({ columns: [t.date, t.metric] })]);

export const scores = sqliteTable('scores', {
  date: text('date').primaryKey(),
  recovery: real('recovery'),
  recoveryJson: text('recovery_json'),
  sleepScore: real('sleep_score'),
  sleepJson: text('sleep_json'),
  headline: text('headline'),
  detail: text('detail'),
});

export const load = sqliteTable('load', {
  date: text('date').primaryKey(),
  load: real('load').notNull(),
  atl: real('atl').notNull(),
  ctl: real('ctl').notNull(),
  tsb: real('tsb').notNull(),
  acwr: real('acwr'),
});

export const workoutAnalysis = sqliteTable('workout_analysis', {
  workoutId: text('workout_id').primaryKey(),
  json: text('json').notNull(),
});

export const personalRecords = sqliteTable('records', {
  kind: text('kind').notNull(),
  distanceM: real('distance_m').notNull(),
  workoutId: text('workout_id').notNull(),
  timeS: real('time_s').notNull(),
  date: text('date').notNull(),
}, (t) => [primaryKey({ columns: [t.kind, t.distanceM, t.workoutId] })]);

export const insights = sqliteTable('insights', {
  date: text('date').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  text: text('text').notNull(),
  evidenceJson: text('evidence_json'),
}, (t) => [primaryKey({ columns: [t.date, t.kind] })]);
