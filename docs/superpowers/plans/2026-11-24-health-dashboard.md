# Personal Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, browser-based health dashboard on the owner's MacBook that imports Apple Watch data (via Health Auto Export files in iCloud Drive) and Strava activities hourly, and presents recovery, sleep, heart, activity, workout and trend analysis in the dark "D" design.

**Architecture:** One Node 22 process: Fastify serves a JSON API and the built React app on `127.0.0.1:4321`; an in-process scheduler runs the hourly sync (HAE folder scan → Strava poll/backfill → weather → analytics recompute). Raw data lands in SQLite (`data/health.db`); a pure-function analytics layer writes derived tables the API reads.

**Tech Stack:** Node 22, TypeScript (strict), Fastify 5, better-sqlite3 + Drizzle ORM/drizzle-kit, stream-json, React 18 + Vite 6 + React Router 7 + TanStack Query 5, uPlot, MapLibre GL + OpenFreeMap, Vitest, Playwright, tsx.

**Spec:** `docs/superpowers/specs/2026-11-24-health-dashboard-design.md` (visual reference: mockup D in https://claude.ai/artifact/5pFSBCwd1wsk5LEjYiHNuj, file `project/Night.dc.html`).

## Global Constraints

- Node.js **22 LTS**; TypeScript `strict: true`; ESM (`"type": "module"`).
- Server binds **`127.0.0.1:4321`** unless LAN mode is enabled in Settings.
- All data under `data/` (gitignored); secrets in `.env` (gitignored); `.env.example` committed.
- Store all timestamps as **UTC ISO strings**; bucket days in the owner's time zone (`settings.tz`, default from `Intl.DateTimeFormat().resolvedOptions().timeZone`).
- Every analytics threshold/weight lives in **`shared/analytics-config.ts`** — no magic numbers elsewhere.
- Defaults: metric units, 24-hour time, UK date format (`24 Nov`), sleep need **450 min**.
- Outbound network only to: `www.strava.com`, `api.open-meteo.com`, `archive-api.open-meteo.com`, `tiles.openfreemap.org`, Google Fonts.
- Copy is non-medical ("higher than your usual"); footer/settings disclaimer: **"Not a medical device. For personal insight only."**
- Design tokens (from mockup D): bg `#0B0F14`, card `#121821`, border `#1F2733`, radius 20px, text `#E8ECF1`, text-2 `#AEB7C4`, text-3 `#9AA4B2`, good `#3DDC97`, worse `#FFB547`, heart `#FF8FA3`, deep `#3346C8`, core `#6F86FF`, rem `#B9C6FF`, awake `#FFB547`; fonts Space Grotesk (headlines/big numbers) + Inter (body).
- Panels whose source data is absent are hidden, never rendered empty; metrics with < 7 baseline points show **"Calibrating"**.
- Functions that can't compute (missing streams/HR) return `null`, never `NaN`.

## Review Focus

1. **Overlapping HAE files** (rolling 7-day windows re-send the same hours) — daily step/energy totals must not double. Test in Task 5.
2. **Sleep across midnight, DST and travel** — a night spanning the 25 Oct 2026 clock change is one night with correct duration. Test in Task 7.
3. **Missing inputs on a day** (watch not worn overnight, no HRV sample) — recovery re-normalises over available components and marks the missing ones; no crash, no NaN. Test in Task 8.
4. **Strava 429 / expired token mid-backfill** — the queue is kept and resumes next run. Test in Task 15.
5. **Workouts without GPS or HR** (treadmill run, strength) — analysis returns nulls and the detail page renders without map/zones. Tests in Tasks 18 and 21.

---

## File Structure

```
package.json  tsconfig.json  vite.config.ts  vitest.config.ts  playwright.config.ts
drizzle.config.ts  .env.example  README.md
shared/
  types.ts              domain types shared by server and web
  analytics-config.ts   every threshold/weight (CONFIG)
  metrics.ts            metric catalogue + HAE name aliases
  format.ts             duration/pace/distance/date formatting
server/
  index.ts              entry: open db, build app, start scheduler, listen
  app.ts                buildApp(deps): Fastify instance with routes
  config.ts             loadEnv()
  db/schema.ts  db/client.ts  db/migrations/*
  repo/                 samples.ts sleep.ts workouts.ts settings.ts imports.ts derived.ts strava.ts
  ingest/hae/           parse.ts normalize.ts folder.ts importer.ts
  ingest/strava/        oauth.ts client.ts map.ts sync.ts
  ingest/weather.ts
  merge/workouts.ts
  analytics/            stats.ts baseline.ts sleep.ts recovery.ts load.ts zones.ts run.ts ride.ts
                        records.ts insights.ts patterns.ts daily.ts recompute.ts
  sync/                 job.ts scheduler.ts
  api/                  today.ts sleep.ts heart.ts activity.ts workouts.ts trends.ts
                        settings.ts sync.ts strava-auth.ts ingest.ts export.ts lan-auth.ts
scripts/ setup.ts install-service.ts
web/
  index.html main.tsx App.tsx theme.css api.ts
  components/ Card RangeBar RecoveryRing Hypnogram StageCompare SleepWindow BandTrend
              Sparkline CompareTable BarChart CalendarHeatmap StreamChart RouteMap
              SyncStatus Nav Calibrating
  pages/ Today Sleep Heart Activity Workouts WorkoutDetail Trends Settings Setup
tests/
  fixtures/hae/*.json  fixtures/strava/*.json  helpers/seed.ts
  server/**.test.ts  shared/**.test.ts  web/**.test.tsx  e2e/*.spec.ts
```

---

## Milestone 1 — Foundation

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.env.example`, `server/index.ts`, `server/app.ts`, `server/config.ts`, `web/index.html`, `web/main.tsx`, `web/App.tsx`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Produces: `buildApp(deps: AppDeps): FastifyInstance` in `server/app.ts` where `AppDeps = { db: Db; settings: () => Settings; now?: () => Date }` (Db/Settings arrive in Task 3; type them as `unknown` placeholders until then). `GET /api/health → { ok: true }`. `loadEnv(): { PORT: number; HOST: string; STRAVA_CLIENT_ID?: string; STRAVA_CLIENT_SECRET?: string; DATA_DIR: string }` (defaults `4321`, `127.0.0.1`, `./data`).
- npm scripts: `dev` (tsx watch server + vite dev with `/api` proxy), `build` (vite build → `dist/web`, tsc → `dist/server`), `start` (node dist/server/index.js), `test` (vitest run), `e2e` (playwright test --trace off), `db:generate` (drizzle-kit generate).

- [ ] **Step 1: Write failing test** — `GET /api/health` via `app.inject` returns 200 and `{ ok: true }`.
- [ ] **Step 2: Run** `npx vitest run tests/server/app.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** package.json (deps per Tech Stack), tsconfig (strict, `paths` alias `@shared/*`), `buildApp`, `loadEnv`, `server/index.ts` (listen on HOST:PORT, serve `dist/web` via `@fastify/static` with SPA fallback), Vite app rendering "Health" placeholder.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS. Run `npm run build` — Expected: exits 0.
- [ ] **Step 5: Commit** `chore: scaffold node/ts/vite project`

### Task 2: Shared types, config, metric catalogue, formatting

**Files:**
- Create: `shared/types.ts`, `shared/analytics-config.ts`, `shared/metrics.ts`, `shared/format.ts`
- Test: `tests/shared/format.test.ts`, `tests/shared/metrics.test.ts`

**Interfaces — Produces:**
```ts
// shared/types.ts
export type Sport = 'run'|'ride'|'walk'|'hike'|'swim'|'strength'|'hiit'|'other';
export type SleepStage = 'awake'|'rem'|'core'|'deep'|'inBed'|'asleep';
export interface Sample { metric: string; start: string; end: string; value: number; unit: string; source: string }
export interface SleepSegment { start: string; end: string; stage: SleepStage; source: string }
export interface Streams { time: number[]; distance?: number[]; latlng?: [number, number][]; altitude?: number[];
  speed?: number[]; heartrate?: number[]; cadence?: number[]; watts?: number[]; grade?: number[]; moving?: boolean[] }
export interface WorkoutRecord { source: 'apple'|'strava'; sourceId: string; sport: Sport; start: string; end: string;
  tzOffsetMin: number; durationS: number; movingS?: number; distanceM?: number; elevGainM?: number; energyKcal?: number;
  avgHr?: number; maxHr?: number; name?: string; gearId?: string; polyline?: string }
export interface Baseline { median: number; iqr: number; low: number; high: number; n: number }
export interface Settings { tz: string; dob?: string; sex?: 'male'|'female'; hrMax?: number; hrRestOverride?: number;
  sleepNeedMin: number; goals: { steps: number; activeKcal: number; exerciseMin: number; standHours: number };
  ftp?: number; zoneModel: 'hrr'|'pctMax'; units: 'metric'|'imperial'; haeFolder?: string;
  lanMode: boolean; passcodeHash?: string; ingestToken?: string }
export type DailyRow = { date: string } & Record<string, number | null>;
```
- `CONFIG` in `shared/analytics-config.ts` with exactly: `baseline {windowDays:30, minN:7}`, `recovery {weights {hrv:40, rhr:25, sleep:25, resp:5, form:5}, scale:16, bands {well:67, moderate:34}, sleepZPerTenPct:1}`, `sleep {nightStartHour:18, nightEndHour:14, mergeGapMin:45, defaultNeedMin:450, debtWindowNights:14, surplusCapMin:60, regularityNights:14}`, `sleepScore {duration:50, efficiency:15, restorative:20, regularity:15, effFloor:0.70, effFull:0.95, sdFullMin:15, sdZeroMin:60}`, `load {atlDays:7, ctlDays:42, acwrFlag:1.5}`, `flags {rhrDelta:5, rhrDays:2, respDelta:1.5, hrvLowDays:3, debtMin:300}`, `merge {startToleranceS:120, durationTolerance:0.10}`, `patterns {minAbsRho:0.3, minN:30, windowDays:90}`, `climbs {minGrade:0.03, minLengthM:500}`, `strava {budget15:90, budgetDay:900}`, `sync {intervalMin:55, tickMin:5, staleHours:3, haeWindowDays:7}`, `gear {shoeWarnKm:600}`, `decoupling {flagPct:5}`.
- `shared/metrics.ts`: `METRICS: Record<MetricKey, { label: string; unit: string; better: 'up'|'down'|'none'; daily: 'sum'|'avg'|'min'|'max'|'last'; hae: string[] }>` covering keys `hr, rhr, hrv, resp, vo2max, walkHr, hrRecovery, steps, distance, flights, activeKcal, basalKcal, exerciseMin, standHours, runPower, runSpeed, strideLength, groundContact, vertOsc, weight, daylightMin`, with HAE aliases e.g. `hrv: ['heart_rate_variability']`, `rhr: ['resting_heart_rate']`, `steps: ['step_count']`, `exerciseMin: ['apple_exercise_time']`, `standHours: ['apple_stand_hour']`, `activeKcal: ['active_energy']`, `basalKcal: ['basal_energy_burned']`, `distance: ['walking_running_distance']`, `resp: ['respiratory_rate']`, `vo2max: ['vo2_max']`, `walkHr: ['walking_heart_rate_average']`, `hrRecovery: ['cardio_recovery']`, `runPower: ['running_power']`, `strideLength: ['running_stride_length']`, `groundContact: ['running_ground_contact_time']`, `vertOsc: ['running_vertical_oscillation']`, `runSpeed: ['running_speed']`, `daylightMin: ['time_in_daylight']`, `weight: ['weight_body_mass']`, `flights: ['flights_climbed']`, `hr: ['heart_rate']`. `metricFromHae(name: string): MetricKey | null`.
- `shared/format.ts`: `fmtDuration(min: number): string`, `fmtPace(secPerKm: number): string`, `fmtKm(m: number): string`, `fmtDay(iso: string, tz: string): string`, `sleepPhrase(min: number): string`.

- [ ] **Step 1: Write failing tests**
```ts
expect(fmtDuration(424)).toBe('7h 04m'); expect(fmtDuration(18)).toBe('18m');
expect(fmtPace(307)).toBe('5:07 /km'); expect(fmtKm(10234)).toBe('10.2 km');
expect(fmtDay('2026-11-24T07:00:00Z', 'Europe/London')).toBe('Tue 24 Nov');
expect(sleepPhrase(424)).toBe('7 hours');      // <15 min over → floor
expect(sleepPhrase(452)).toBe('7½ hours');     // 15–44 min over
expect(sleepPhrase(468)).toBe('nearly 8 hours'); // ≥45 min over
expect(metricFromHae('heart_rate_variability')).toBe('hrv');
expect(metricFromHae('something_new')).toBeNull();
```
- [ ] **Step 2: Run** `npx vitest run tests/shared` — Expected: FAIL.
- [ ] **Step 3: Implement** the four modules as specified.
- [ ] **Step 4: Run** `npx vitest run tests/shared` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared types, analytics config, metric catalogue, formatting`

### Task 3: Database schema, migrations and repositories

**Files:**
- Create: `drizzle.config.ts`, `server/db/schema.ts`, `server/db/client.ts`, `server/repo/{samples,sleep,workouts,settings,imports,derived,strava}.ts`, `tests/helpers/db.ts`
- Test: `tests/server/repo.test.ts`

**Interfaces — Produces:**
- `openDb(file: string): Db` (`':memory:'` allowed; runs migrations; WAL mode). `tests/helpers/db.ts`: `testDb(): Db`.
- Tables: `imports(id, source, path, hash UNIQUE, received_at, status, error)`, `samples(metric, start, end, value, unit, source, PK(metric,start,end,source))`, `sleep_segments(start, end, stage, source, PK(start,stage,source))`, `workout_records(source, source_id, sport, start, end, tz_offset_min, duration_s, moving_s, distance_m, elev_gain_m, energy_kcal, avg_hr, max_hr, name, gear_id, polyline, raw_json, PK(source,source_id))`, `record_streams(source, source_id, json_gz BLOB)`, `workouts(id TEXT PK, apple_id, strava_id, sport, start, end, …merged fields…, weather_json)`, `workout_extras(strava_id, laps_json, splits_json, best_efforts_json, segments_json)`, `gear(id PK, name, kind, distance_m)`, `settings(key PK, value_json)`, `oauth_tokens(provider PK, access, refresh, expires_at)`, `strava_queue(activity_id PK, step, attempts, last_error)`, `sync_runs(id, started_at, finished_at, status, counts_json, error)`, `daily(date PK, json)`, `baselines(date, metric, median, iqr, n, PK(date,metric))`, `scores(date PK, recovery, recovery_json, sleep_score, sleep_json, headline, detail)`, `load(date PK, load, atl, ctl, tsb, acwr)`, `workout_analysis(workout_id PK, json)`, `records(kind, distance_m, workout_id, time_s, date, PK(kind,distance_m,workout_id))`, `insights(date, kind, severity, text, evidence_json, PK(date,kind))`.
- Repos (all take `db` first): `upsertSamples(db, s: Sample[]): number`, `getSamples(db, metric, fromIso, toIso): Sample[]`, `upsertSleep(db, s: SleepSegment[]): number`, `getSleep(db, fromIso, toIso): SleepSegment[]`, `upsertRecord(db, r: WorkoutRecord, raw: unknown, streams?: Streams): void`, `getWorkoutRecords(db, fromIso, toIso): WorkoutRecord[]`, `getRecordStreams(db, source, id): Streams | null`, `getSettings(db): Settings` (defaults filled), `updateSettings(db, patch: Partial<Settings>): Settings`, `isImported(db, hash): boolean`, `recordImport(db, row)`, `saveDaily/getDaily`, `saveBaselines/getBaselines`, `saveScores/getScores`, `saveLoad/getLoad`, `saveAnalysis/getAnalysis`, `savePersonalRecords/getPersonalRecords`, `saveInsights/getInsights`, `getTokens/saveTokens`, `queue{Add,Next,Done,Fail}`.

- [ ] **Step 1: Write failing tests** — upserting the same 3 samples twice leaves 3 rows; `getSettings` on empty db returns `sleepNeedMin: 450`, `zoneModel: 'hrr'`, `units: 'metric'`, `lanMode: false`; `updateSettings({sleepNeedMin: 480})` persists; streams round-trip through gzip equal the input.
- [ ] **Step 2: Run** `npx vitest run tests/server/repo.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, `npm run db:generate` to create the first migration, client and repos.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: sqlite schema, migrations and repositories`

---

## Milestone 2 — Apple Health ingest

### Task 4: HAE JSON parser and normaliser

**Files:**
- Create: `server/ingest/hae/parse.ts`, `server/ingest/hae/normalize.ts`, `tests/fixtures/hae/metrics-hourly.json`, `tests/fixtures/hae/sleep-raw.json`, `tests/fixtures/hae/workouts.json`
- Test: `tests/server/hae-parse.test.ts`

**Interfaces:**
- Produces: `parseHaeFile(path: string): AsyncIterable<HaeItem>` streaming via `stream-json` over `data.metrics[]` and `data.workouts[]`, where `HaeItem = { kind: 'metric'; name: string; units: string; point: Record<string, unknown> } | { kind: 'workout'; w: Record<string, unknown> }`. `normalizeMetric(name, units, point): { samples: Sample[]; sleep: SleepSegment[] }` and `normalizeWorkout(w): { record: WorkoutRecord; streams: Streams | null; samples: Sample[] }`. `parseHaeDate(s: string): { iso: string; offsetMin: number }` for `"2026-11-24 06:34:00 +0000"`.
- Rules: `qty` points → one sample (start=`date`, end=`date`+1h for hourly-aggregated, = `date` for raw); HR points with `Min/Avg/Max` → three samples `hr`,`hrMin`,`hrMax` (value from Avg/Min/Max); `sleep_analysis` raw points (`startDate,endDate,value`) → `SleepSegment` with value map `Core→core, Deep→deep, REM→rem, Awake→awake, In Bed→inBed, Asleep→asleep`; aggregated sleep points are ignored (logged once); unknown metric names stored with `metric = 'hae:' + name`. Workouts: sport map `Running*→run, Cycling*→ride, Walking→walk, Hiking→hike, Swimming*→swim, *Strength*→strength, *High Intensity*→hiit, else other`; `heartRateData[]` → streams.heartrate on seconds since start; `route[]` → latlng/altitude/speed.
- Fixtures are hand-built from the HAE wiki format and must be **replaced/augmented with anonymised real files** after first run (see Task 26 Step 4).

- [ ] **Step 1: Write failing tests** — fixture `metrics-hourly.json` yields `steps` samples with exact values; HR point `{Min:48,Avg:61,Max:92}` → 3 samples; `parseHaeDate('2026-11-24 06:34:00 +0000').iso === '2026-11-24T06:34:00.000Z'`; `sleep-raw.json` yields segments whose stages are only from the stage map; workout fixture → `sport: 'run'`, `streams.latlng.length > 0`; unknown metric → `metric: 'hae:mystery_metric'`.
- [ ] **Step 2: Run** `npx vitest run tests/server/hae-parse.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** parser and normaliser.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: health auto export parser and normaliser`

### Task 5: HAE folder discovery and idempotent importer

**Files:**
- Create: `server/ingest/hae/folder.ts`, `server/ingest/hae/importer.ts`
- Test: `tests/server/hae-import.test.ts`

**Interfaces:**
- Consumes: Task 3 repos, Task 4 parser.
- Produces: `discoverHaeFolder(home: string): string | null` — first match of `~/Library/Mobile Documents/*/Documents` whose path contains `HealthExport` or `Health Auto Export` (case-insensitive), else null. `importHaeFolder(db, folder: string, rawDir: string): Promise<{ files: number; samples: number; sleep: number; workouts: number; errors: string[] }>` — scans `*.json` recursively, skips by SHA-256 already in `imports`, copies new files to `rawDir/hae/<hash>.json`, writes in one transaction per file, records import status (`ok` | `error`). Returns the set of affected local dates via `affectedDates: string[]`.

- [ ] **Step 1: Write failing tests** — (a) importing the fixture folder twice → second run `files: 0`; (b) **Review Focus 1:** two files whose hourly `step_count` windows overlap by 3 days → sum of `steps` samples for an overlapping day equals the single-file total; (c) a malformed JSON file → `errors.length === 1`, other files still imported, import row `status: 'error'`; (d) `discoverHaeFolder` on a temp home with `Library/Mobile Documents/iCloud~com~ifunography~HealthExport/Documents` returns that path.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: idempotent HAE folder importer`

---

## Milestone 3 — Health analytics

### Task 6: Statistics and baselines

**Files:**
- Create: `server/analytics/stats.ts`, `server/analytics/baseline.ts`
- Test: `tests/server/baseline.test.ts`

**Interfaces — Produces:** `quantile(sorted: number[], q: number): number` (linear interpolation, R type 7); `computeBaseline(values: number[], minN = CONFIG.baseline.minN): Baseline | null` (`low = median − iqr/2`, `high = median + iqr/2`); `robustZ(value: number, b: Baseline): number` = `(value − median) / (iqr / 1.35)`, clipped to ±3, and `0` when `iqr === 0`; `spearman(x: number[], y: number[]): number | null` (null when n < 3).

- [ ] **Step 1: Write failing tests**
```ts
const b = computeBaseline([1,2,3,4,5,6,7,8,9])!;
expect(b).toMatchObject({ median: 5, iqr: 4, low: 3, high: 7, n: 9 });
expect(robustZ(9, b)).toBeCloseTo(1.35, 5);
expect(robustZ(100, b)).toBe(3);
expect(computeBaseline([1,2,3])).toBeNull();
expect(spearman([1,2,3,4],[10,20,30,40])).toBeCloseTo(1);
expect(spearman([1,2,3,4],[4,3,2,1])).toBeCloseTo(-1);
```
- [ ] **Step 2: Run** `npx vitest run tests/server/baseline.test.ts` — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: robust baselines and stats helpers`

### Task 7: Sleep analytics

**Files:**
- Create: `server/analytics/sleep.ts`
- Test: `tests/server/sleep.test.ts`

**Interfaces — Produces:**
```ts
export interface Night { date: string; start: string; end: string; segments: SleepSegment[] }
export interface NightSummary { date: string; bedtime: string; wake: string; asleepMin: number; inBedMin: number;
  efficiency: number; stages: { deep: number; core: number; rem: number; awake: number }; awakenings: number }
assignNights(segs: SleepSegment[], tz: string): { nights: Night[]; naps: Night[] }
summarizeNight(n: Night): NightSummary
sleepDebt(asleepMin: number[], needMin: number): number
circularSdMin(localTimesHHmm: string[]): number
sleepScore(i: { asleepMin: number; needMin: number; efficiency: number; restorativeShare: number;
  baselineRestorativeShare: number | null; regularitySdMin: number | null }): { score: number; components: Record<string, number> }
```
- Rules: prefer segments whose `source` contains "Watch" when sources overlap; merge segments with gaps < 45 min into a session; a session whose midpoint falls between 18:00 and 14:00(+1) local is a night dated by its local wake date, else a nap; if two sessions qualify for the same date, the longer is the night and the other a nap. `inBedMin` = sum of `inBed` segments if present, else `end − start`. `asleepMin` = deep+core+rem+asleep. `awakenings` = count of awake segments ≥ 2 min between asleep segments. Debt: Σ(need − asleep) over the last `debtWindowNights`, each surplus night capped at −`surplusCapMin`, floored at 0. Circular SD: `sqrt(−2 ln R)` in radians × 1440/2π. Score components per `CONFIG.sleepScore`: duration `50 × min(1, asleep/need)`; efficiency `15 × clamp((eff − 0.70)/0.25, 0, 1)`; restorative `20 × clamp(share / baselineShare, 0, 1)` (full 20 if baseline null); regularity `15 × clamp(1 − (sd − 15)/45, 0, 1)` (full 15 if null); score rounded.

- [ ] **Step 1: Write failing tests**
```ts
// segments 23:12 → 06:34 Europe/London on 23/24 Nov 2026, mockup D sequence
expect(summarizeNight(night)).toMatchObject({ date: '2026-11-24', asleepMin: 424, inBedMin: 442,
  stages: { deep: 66, core: 252, rem: 106, awake: 18 }, awakenings: 3 });
// nap 14:30–15:10 same day → in naps, not nights
// Review Focus 2: 23:00 BST 24 Oct → 07:00 GMT 25 Oct 2026 is one night dated 2026-10-25 with inBedMin 540
expect(sleepDebt([420, 480, 400], 450)).toBe(50);
expect(circularSdMin(['23:30', '00:30'])).toBeCloseTo(30, 0);
expect(sleepScore({ asleepMin: 450, needMin: 450, efficiency: 0.95, restorativeShare: 0.4,
  baselineRestorativeShare: 0.4, regularitySdMin: 15 }).score).toBe(100);
// gap of 30 min between two blocks → one session; gap of 60 → two sessions
```
- [ ] **Step 2: Run** `npx vitest run tests/server/sleep.test.ts` — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: sleep night assignment, summaries, debt, regularity, score`

### Task 8: Recovery score

**Files:**
- Create: `server/analytics/recovery.ts`
- Test: `tests/server/recovery.test.ts`

**Interfaces — Produces:**
```ts
export interface RecoveryInput { hrv: number|null; rhr: number|null; asleepMin: number|null; needMin: number;
  resp: number|null; tsb: number|null;
  baselines: { hrv: Baseline|null; rhr: Baseline|null; resp: Baseline|null; tsb: Baseline|null } }
export interface RecoveryComponent { key: 'hrv'|'rhr'|'sleep'|'resp'|'form'; value: number|null; z: number|null;
  weight: number; contribution: number|null; missing: boolean }
export interface RecoveryResult { score: number|null; band: 'well'|'moderate'|'low'|null; components: RecoveryComponent[] }
recoveryScore(i: RecoveryInput): RecoveryResult
```
- Rules: z per component — hrv `+robustZ`, rhr `−robustZ`, sleep `clamp((asleep/need − 1)/0.10, −3, 3)`, resp `−|robustZ|`, form `+robustZ(tsb)`. A component is missing if its value or baseline is null. Weighted z = Σ(w·z)/Σ(w) over present components; `score = round(clamp(50 + 16·wz, 0, 100))`. If HRV **and** RHR are both missing → `score: null, band: null`. Bands: ≥67 well, ≥34 moderate, else low. `contribution = w·z/Σw·16`.

- [ ] **Step 1: Write failing tests**
```ts
// all components at their median, sleep = need → 50, moderate
// hrv z=+2, rhr z=−2, sleep 1.2×need, resp at median, tsb z=+2 → wz 1.9 → 80, 'well'
expect(r.score).toBe(80); expect(r.band).toBe('well');
// Review Focus 3: hrv null, others present → score from remaining weights, hrv component missing: true, no NaN
// hrv null and rhr null → score null, band null
// huge outlier hrv → z clipped to 3, score ≤ 100
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: recovery score with transparent components`

### Task 9: Training load and HR zones

**Files:**
- Create: `server/analytics/load.ts`, `server/analytics/zones.ts`
- Test: `tests/server/load.test.ts`

**Interfaces — Produces:**
```ts
trimpFromStream(t: number[], hr: number[], hrRest: number, hrMax: number, sex: 'male'|'female'): number
trimpFromAverage(avgHr: number, durationS: number, hrRest: number, hrMax: number, sex: 'male'|'female'): number
loadSeries(daily: { date: string; load: number }[]): { date: string; load: number; atl: number; ctl: number; tsb: number; acwr: number|null }[]
monotonyStrain(weekLoads: number[]): { monotony: number|null; strain: number|null }
hrZoneBounds(hrRest: number, hrMax: number, model: 'hrr'|'pctMax'): number[]   // 6 edges, Z1..Z5
timeInZones(t: number[], hr: number[], bounds: number[]): number[]              // seconds per zone, length 5
estimateHrMax(workoutMaxHrs: number[], age: number|null): number|null
```
- Rules: Banister TRIMP per minute `HRr·k·e^(b·HRr)` with male `k=0.64,b=1.92`, female `k=0.86,b=1.67`, `HRr=(hr−rest)/(max−rest)` clamped 0–1; unknown sex → male constants. EWMA with `α = 1 − e^(−1/days)` from zero, filling missing dates with load 0; `tsb[d] = ctl[d−1] − atl[d−1]`; `acwr = sum7 / (sum28/4)`, null if sum28 = 0. HRR zones at 50/60/70/80/90/100% of reserve (+rest); pctMax at 50/60/70/80/90/100% of max; HR below Z1 counts as Z1. `estimateHrMax` = max of last-12-month workout max HRs if ≥ 5 workouts, else `220 − age`, else null. Monotony = mean/sd of 7 daily loads; strain = sum × monotony.

- [ ] **Step 1: Write failing tests**
```ts
expect(trimpFromAverage(150, 3600, 50, 190, 'male')).toBeCloseTo(108.10, 1);
expect(trimpFromAverage(150, 3600, 50, 190, 'female')).toBeCloseTo(121.50, 1);
const s = loadSeries([{ date: '2026-01-01', load: 100 }]);
expect(s[0].atl).toBeCloseTo(13.31, 2); expect(s[0].ctl).toBeCloseTo(2.35, 2);
// 200 days constant 100 → last atl≈ctl≈100 (±0.5), tsb≈0, acwr = 1
expect(hrZoneBounds(50, 190, 'hrr')).toEqual([120, 134, 148, 162, 176, 190]);
// constant HR stream at 140 for 600 s → timeInZones = [0, 600, 0, 0, 0]
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: training load (TRIMP, ATL/CTL/TSB, ACWR) and HR zones`

### Task 10: Insights — flags and headline copy

**Files:**
- Create: `server/analytics/insights.ts`
- Test: `tests/server/insights.test.ts`

**Interfaces — Produces:**
```ts
export interface Flag { kind: 'rhr_elevated'|'resp_elevated'|'hrv_low'|'sleep_debt'|'ramping'; severity: 'info'|'warn'; text: string }
computeFlags(recentDaily: DailyRow[], baselines: Record<string, Baseline|null>, debtMin: number, acwr: number|null): Flag[]
headline(r: RecoveryResult, asleepMin: number|null): { headline: string; detail: string }
```
- Exact copy: band well → `"You're well recovered after {sleepPhrase} of sleep. A good day to train hard."`; moderate → `"You're moderately recovered after {sleepPhrase} of sleep. Keep today steady."`; low → `"Recovery is low after {sleepPhrase} of sleep. Take it easy today."`; score null → `"Not enough data yet to judge recovery."` (no sleep → drop the "after … of sleep" clause). Detail: up to two sentences for the two components with the largest |contribution|, e.g. `"HRV is 12% above your 30-day baseline."`, `"Resting heart rate is at the low end of your range."`, `"You slept 26 minutes less than you need."`. Flag text e.g. rhr: `"Resting heart rate has been 5+ bpm above your usual for 2 days — your body may be under extra strain."`
- Flag rules from `CONFIG.flags`: rhr ≥ median+5 on each of the last 2 days; resp ≥ median+1.5 today; hrv < baseline.low on each of the last 3 days; debt > 300; acwr > 1.5.

- [ ] **Step 1: Write failing tests** — exact headline strings for each band with asleep 424 (`"7 hours"`); null-score copy; rhr flag fires on two elevated days and not on one; debt 301 → `sleep_debt`, 300 → none.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: flags and plain-English headline`

### Task 11: Daily rollup and recompute orchestrator

**Files:**
- Create: `server/analytics/daily.ts`, `server/analytics/recompute.ts`, `server/merge/workouts.ts` (initial version)
- Test: `tests/server/recompute.test.ts`, `tests/helpers/seed.ts`

**Interfaces:**
- Consumes: Tasks 3, 6–10.
- Produces: `buildDailyRows(db, fromDate: string, toDate: string, tz: string): DailyRow[]` — one row per date with each METRICS key aggregated by its `daily` rule, plus sleep fields `asleepMin, inBedMin, efficiency, deepMin, coreMin, remMin, awakeMin, bedtime (minutes after 18:00), wake (minutes after midnight)`, `hrvNight` (mean of HRV samples inside the night window, else daily mean). `recompute(db, opts: { from?: string; to?: string; now?: Date }): Promise<{ days: number }>` — rebuilds `daily`, `baselines` (30 days before each date, excluding it), `load` (per workout via `trimpFromAverage`; Task 18 swaps in stream-based `workoutLoad(db, id)`), `scores` (recovery, sleep score, headline/detail), `insights`. Default range: last 45 days; `from: 'all'` rebuilds everything.
- `rebuildWorkouts(db): number` in `server/merge/workouts.ts` — initial version copies each Apple record 1:1 into `workouts` (id `apple:<id>`); Task 16 replaces the body with matching/merging. `recompute` calls it first.
- `tests/helpers/seed.ts`: `seedDemo(db, days = 60, now = new Date('2026-11-24T08:00:00Z'))` writing deterministic synthetic samples, sleep and 3 workouts/week (seeded PRNG) — reused by API and e2e tests.

- [ ] **Step 1: Write failing tests** — after `seedDemo` + `recompute`, `getScores(db,'2026-11-24')` has a numeric recovery between 0–100 and non-empty headline; `baselines` for date `2026-11-24` metric `hrv` has `n === 30`; running `recompute` twice yields identical rows; a day with no data produces a row with nulls and `scores.recovery === null`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: daily rollup and analytics recompute`

---

## Milestone 4 — Sync loop, API and the Today page

### Task 12: Sync job, scheduler and sync API

**Files:**
- Create: `server/sync/job.ts`, `server/sync/scheduler.ts`, `server/api/sync.ts`
- Modify: `server/app.ts`, `server/index.ts`
- Test: `tests/server/sync.test.ts`

**Interfaces:**
- Produces: `runSyncJob(ctx: { db: Db; dataDir: string; home: string; strava?: StravaSync; now?: () => Date }): Promise<SyncRunResult>` where `SyncRunResult = { status: 'ok'|'partial'|'error'; hae: {...}; strava?: {...}; weather?: {...}; recomputedDays: number; errors: string[] }`; each stage's error is caught and recorded so later stages still run. `startScheduler(run: () => Promise<unknown>, opts?: { tickMs?: number; intervalMs?: number; lastRun: () => Date|null }): () => void` — ticks every 5 min; runs if no run in 55 min; never overlaps (in-flight guard); runs once immediately on start. `StravaSync` is the interface Task 15 implements: `{ poll(): Promise<{ newActivities: number; queued: number; processed: number }> }`.
- Routes: `GET /api/sync/status → { lastRun, running, sources: { hae: { lastDataAt, stale: boolean }, strava: { connected, lastActivityAt, backfill: { remaining } } } }` (stale = no HAE sample newer than 3 h); `POST /api/sync/run → 202` (starts job if not running).

- [ ] **Step 1: Write failing tests** — scheduler with fake timers: starts immediately, does not re-run within 55 min, runs after 55 min, skips tick while previous run in flight; job: HAE stage throwing still runs recompute and returns `status: 'partial'`; `/api/sync/status` reports `stale: true` when newest HAE sample is 4 h old.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: hourly sync job, scheduler and sync API`

### Task 13: Today API

**Files:**
- Create: `server/api/today.ts`
- Modify: `server/app.ts`
- Test: `tests/server/api-today.test.ts`

**Interfaces — Produces:** `Series = { points: { date: string; value: number|null }[]; band: { low: number; high: number } | null }` added to `shared/types.ts`. `GET /api/today?date=YYYY-MM-DD` (default today in tz) →
```ts
{ date; headline; detail; recovery: RecoveryResult;
  vsNormal: { key; label; value; unit; low; high; median; calibrating: boolean }[];   // hrv, rhr, sleep, resp
  lastNight: NightSummary & { stageAvg: { deep; core; rem; awake } } | null;          // 30-night averages
  sleepWindow: { date; bedtime: string; wake: string }[];                             // 7 nights, local HH:mm
  usualBedtime: string | null;
  trends: { hrv: Series; rhr: Series };   // 14 days
  weekCompare: { key; label; thisWeek; lastWeek; better: 'up'|'down'|'none'; unit }[];  // sleep, hrv, rhr, steps, trainingMin, runKm, rideKm (Mon–today vs same days last week)
  lastWorkout: { id; name; sport; start; distanceM; durationS; paceOrSpeed; avgHr } | null;
  flags: Flag[]; sync: SyncStatus }
```

- [ ] **Step 1: Write failing tests** (seeded db) — response shape keys present; `trends.hrv.points.length === 14`; `sleepWindow.length === 7`; `weekCompare` contains `runKm` and `rideKm`; a fresh empty db returns 200 with `recovery.score === null`, `lastNight === null`, `vsNormal[*].calibrating === true`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: today API`

### Task 14: Web shell, theme and Today page

**Files:**
- Create: `web/theme.css`, `web/api.ts`, `web/components/{Card,Nav,SyncStatus,RecoveryRing,RangeBar,Hypnogram,StageCompare,SleepWindow,BandTrend,CompareTable,Calibrating}.tsx`, `web/pages/Today.tsx`
- Modify: `web/App.tsx`, `web/main.tsx`
- Test: `tests/web/components.test.tsx` (Vitest + @testing-library/react, jsdom)

**Interfaces:**
- Consumes: `/api/today`, `/api/sync/status`, `POST /api/sync/run`.
- Produces (used by later pages): `useApi<T>(path: string)` (TanStack Query wrapper) and `postApi(path, body?)` in `web/api.ts`; components with props:
  `RecoveryRing({ score: number|null; band; delta?: number })`, `RangeBar({ label; value; unit; low; high; min; max; calibrating })`, `Hypnogram({ segments: { start; end; stage }[]; start; end; tz })`, `StageCompare({ stages; avg })`, `SleepWindow({ nights: { date; bedtime; wake }[]; usualBedtime })`, `BandTrend({ series: Series; color; label; better })`, `CompareTable({ rows })`, `Card({ title; aside?; children })`, `Calibrating()`.
- Layout and styling follow mockup D exactly (structure, spacing, colours, type); routes `/`, `/sleep`, `/heart`, `/activity`, `/workouts`, `/workouts/:id`, `/trends`, `/settings`, `/setup` (non-Today pages are stubs until their tasks). Header: pill nav, sync status ("Synced 07:00 · next 08:00", amber "HAE data is 4h old" when stale), "Sync now" button. Footer disclaimer copy from Global Constraints. Single-column below 720 px. Every SVG chart has `role="img"` and an `aria-label` describing the data.

- [ ] **Step 1: Write failing component tests** — `RangeBar` positions the marker at `(value−min)/(max−min)` %; `RecoveryRing` with `score: null` renders "—" and no arc; `Hypnogram` renders one bar per segment in the matching stage row; `Calibrating` text is "Calibrating".
- [ ] **Step 2: Run** `npx vitest run tests/web` — FAIL.
- [ ] **Step 3: Implement** theme tokens, components and Today page (sections in mockup D order; sections with null data hidden).
- [ ] **Step 4: Run** tests — PASS. Run `npm run dev` with a seeded db (`tsx scripts/seed-dev.ts` writing `data/health.db` via `seedDemo`) and visually compare with mockup D.
- [ ] **Step 5: Commit** `feat: web shell, theme and Today page`

---

## Milestone 5 — Strava, merging and weather

### Task 15: Strava OAuth, API client and sync/backfill

**Files:**
- Create: `server/ingest/strava/{oauth,client,map,sync}.ts`, `server/api/strava-auth.ts`, `tests/fixtures/strava/{activities,activity,streams,gear}.json`
- Modify: `server/app.ts`, `server/sync/job.ts`
- Test: `tests/server/strava.test.ts`

**Interfaces:**
- Produces: `GET /auth/strava/start` → 302 to `https://www.strava.com/oauth/authorize?client_id…&redirect_uri=http://localhost:4321/auth/strava/callback&response_type=code&approval_prompt=auto&scope=read,activity:read_all,profile:read_all`; `GET /auth/strava/callback?code=` exchanges at `https://www.strava.com/oauth/token`, saves tokens, redirects to `/settings`. `class StravaClient { constructor(db, fetchFn = fetch, now = () => new Date()); get<T>(path, query?): Promise<T> }` — refreshes the token when `expires_at` is < 5 min away; tracks usage from `X-RateLimit-Usage`/`X-ReadRateLimit-Usage` headers; throws `RateLimitedError` when usage ≥ `CONFIG.strava.budget15`/`budgetDay` or on HTTP 429. `mapActivity(a): WorkoutRecord` (sport map `Run/TrailRun/VirtualRun→run`, `Ride/VirtualRide/GravelRide/MountainBikeRide/EBikeRide→ride`, `Walk→walk`, `Hike→hike`, `Swim→swim`, `WeightTraining→strength`, `HighIntensityIntervalTraining|Crossfit→hiit`, else other), `mapStreams(s): Streams` (cadence kept as Strava's value; analytics doubles for runs). `createStravaSync(db, client): StravaSync` — `poll()`: list `/athlete/activities?after=<latest start>&per_page=200` (all pages on first run), queue each id, then process queue items (`/activities/{id}?include_all_efforts=true`, `/activities/{id}/streams?keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth&key_by_type=true`, `/gear/{gear_id}` once per gear) until the queue is empty or `RateLimitedError`; queue items are only removed after their data is saved.

- [ ] **Step 1: Write failing tests** (mock `fetchFn`) — authorize URL exact; expired token triggers one refresh call and retries; `mapActivity` on fixture gives `sport: 'run'`, `distanceM`, `polyline`; **Review Focus 4:** the 3rd activity's streams call returns 429 → `poll()` resolves (no throw) with `processed: 2`, the queue still holds the remaining ids, and the next `poll()` resumes from activity 3; a 401 on refresh marks Strava disconnected in `/api/sync/status`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; wire into `runSyncJob` when tokens exist. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: strava oauth, rate-limited client, sync and resumable backfill`

### Task 16: Merge Apple and Strava workouts

**Files:**
- Create: `server/merge/workouts.ts`
- Modify: `server/merge/workouts.ts` (replace the 1:1 body from Task 11)
- Test: `tests/server/merge.test.ts`

**Interfaces — Produces:** `sportFamily(s: Sport): 'foot'|'ride'|'swim'|'other'` (run/walk/hike → foot); `matchWorkouts(apple: WorkoutRecord[], strava: WorkoutRecord[]): { appleId?: string; stravaId?: string }[]`; `rebuildWorkouts(db): number` writes `workouts` with field precedence: physiology (avgHr, maxHr, energyKcal, HR stream) Apple; name, gearId, polyline Strava; distance/elevation Strava if present else Apple; id = `strava:<id>` or `apple:<id>`, stable across rebuilds.
- Match rule: same family, |start diff| ≤ 120 s, |duration diff| ≤ 10% of the longer; greedy by smallest start diff; each record used once.

- [ ] **Step 1: Write failing tests** — Apple 07:00:00/3134 s run vs Strava 07:00:40/3100 s run → matched; Strava at 07:05:00 → not matched; run vs ride same time → not matched; merged row has Apple `avgHr` and Strava `name`; rebuilding twice keeps ids.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: merge apple and strava workouts`

### Task 17: Weather enrichment

**Files:**
- Create: `server/ingest/weather.ts`
- Modify: `server/sync/job.ts`
- Test: `tests/server/weather.test.ts`

**Interfaces — Produces:** `weatherUrl(lat: number, lon: number, startIso: string, now: Date): string` — `archive-api.open-meteo.com/v1/archive` when the workout is ≥ 6 days old, else `api.open-meteo.com/v1/forecast?past_days=7`; both with `hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation&timezone=UTC&wind_speed_unit=kmh`. `enrichWeather(db, fetchFn, limit = 50): Promise<number>` — for workouts with a polyline/latlng and null `weather_json`, picks the hour nearest the start and saves `{ tempC, humidity, windKmh, windFromDeg, precipMm }`.

- [ ] **Step 1: Write failing tests** — URL choice by age; parser picks the nearest hour; workouts without GPS are skipped; fetch failure leaves `weather_json` null and doesn't throw.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: open-meteo weather enrichment`

---

## Milestone 6 — Workouts

### Task 18: Running analytics

**Files:**
- Create: `server/analytics/run.ts`
- Test: `tests/server/run.test.ts`

**Interfaces — Produces:**
```ts
minettiCost(grade: number): number            // 155.4i^5 − 30.4i^4 − 43.3i^3 + 46.3i^2 + 19.5i + 3.6, grade clamped ±0.45
gapFactor(grade: number): number              // minettiCost(grade) / 3.6
kmSplits(s: Streams): { km: number; timeS: number; paceS: number; gapPaceS: number|null; avgHr: number|null;
  cadenceSpm: number|null; elevDeltaM: number|null; avgPower: number|null }[] | null   // null without distance
decouplingPct(s: Streams): number|null        // (EF1 − EF2)/EF1 × 100, halves by elapsed time, EF = speed/HR
efficiencyFactor(s: Streams): number|null     // mean GAP speed (m/min) / mean HR
strideLengthM(speedMs: number, cadenceSpm: number): number|null
runForm(samples: Sample[], start: string, end: string): { power; strideLength; groundContactMs; vertOscCm } // averages of Apple samples in window, nulls if none
similarRuns(target: { distanceM: number; start: string }, all: { id; distanceM; start; paceS; avgHr; ef }[]): typeof all // ±10% distance, last 90 days
analyzeRun(w, streams: Streams|null, samples: Sample[], ctx): RunAnalysis   // composes the above + zones + load
```
- Strava run cadence is per-leg: `cadenceSpm = cadence × 2`. Also export `workoutLoad(db, id): number` (stream TRIMP if HR stream else average-based) and switch `recompute` to it.

- [ ] **Step 1: Write failing tests**
```ts
expect(gapFactor(0.1)).toBeCloseTo(1.6578, 3);
expect(gapFactor(-0.1)).toBeCloseTo(0.5977, 3);
// halves: speed 3 m/s @ HR 140 then 3 m/s @ HR 147 → 4.76
expect(decouplingPct(streams)).toBeCloseTo(4.76, 2);
// 10.2 km synthetic stream → 11 splits, last one 0.2 km with pace scaled per km
// Review Focus 5: treadmill run (no latlng, no distance stream) → kmSplits null, decouplingPct null, no NaN in analyzeRun
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: running analytics (splits, GAP, decoupling, EF, form)`

### Task 19: Cycling analytics

**Files:**
- Create: `server/analytics/ride.ts`
- Test: `tests/server/ride.test.ts`

**Interfaces — Produces:** `detectClimbs(s: Streams): { startKm; lengthM; gainM; avgGrade; vamMh: number|null }[]` (contiguous stretches with grade ≥ 3% lasting ≥ 500 m; grade from altitude/distance when no grade stream, smoothed over 100 m); `windShare(latlng: [number,number][], windFromDeg: number): { head: number; tail: number; cross: number }` (distance-weighted shares; head when |bearing − windFrom| < 45°, tail when > 135°); `normalizedPower(t: number[], watts: number[]): number|null` (30 s rolling mean, 4th-power mean, 4th root); `tss(npW, ftpW, durationS): number`; `analyzeRide(w, streams, ctx): RideAnalysis`.

- [ ] **Step 1: Write failing tests** — 1 km at 5% then flat → one climb, gain 50 m; 300 m at 8% → no climb; route due north with wind from 0° → `head ≈ 1`; due south → `tail ≈ 1`; constant 200 W for 1 h → NP 200, `tss(200, 200, 3600) === 100`; no watts → NP null and analysis omits power.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: cycling analytics (climbs, VAM, wind, NP/TSS)`

### Task 20: Personal records and race predictions

**Files:**
- Create: `server/analytics/records.ts`
- Modify: `server/analytics/recompute.ts`
- Test: `tests/server/records.test.ts`

**Interfaces — Produces:** `riegel(t1S: number, d1M: number, d2M: number, exp = 1.06): number`; `vdot(distM: number, timeS: number): number` (Daniels: VO2 = −4.60 + 0.182258v + 0.000104v², %max = 0.8 + 0.1894393e^(−0.012778t) + 0.2989558e^(−0.1932605t), v m/min, t min); `timeForVdot(v: number, distM: number): number` (bisection on `vdot`); `bestEfforts(...)` from Strava `best_efforts` (names 400m, 1K, 1 mile, 5K, 10K, Half-Marathon, Marathon) plus Apple-only runs via fastest rolling window on the distance stream; `predictions(efforts in last 90 days): { distanceM; riegelS; vdotS }[]` for 5K, 10K, half, marathon, using the effort with the highest VDOT as the source.

- [ ] **Step 1: Write failing tests**
```ts
expect(riegel(1200, 5000, 10000)).toBeCloseTo(2501.9, 1);
expect(vdot(5000, 1200)).toBeCloseTo(49.81, 2);
expect(timeForVdot(vdot(5000, 1200), 5000)).toBeCloseTo(1200, 0);
// new faster 5K replaces PR; slower one doesn't; PR history keeps both dates
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: personal records and race predictions`

### Task 21: Workouts API and pages

**Files:**
- Create: `server/api/workouts.ts`, `web/pages/Workouts.tsx`, `web/pages/WorkoutDetail.tsx`, `web/components/{StreamChart,RouteMap,BarChart,CalendarHeatmap,Sparkline}.tsx`
- Modify: `server/app.ts`, `web/App.tsx`
- Test: `tests/server/api-workouts.test.ts`, `tests/web/workout-detail.test.tsx`

**Interfaces:**
- Produces: `GET /api/workouts?sport=&q=&from=&to=&page=` → `{ items: { id; name; sport; start; distanceM; durationS; avgHr; load }[]; total; weekly: { week; bySport: Record<Sport, number> }[]; calendar: { date; minutes }[] }`; `GET /api/workouts/:id` → `{ workout; sources: ('apple'|'strava')[]; analysis: RunAnalysis|RideAnalysis|GenericAnalysis; streams: Streams|null; weather; gear: { name; distanceKm; warn: boolean }|null; similar; prs }`; `GET /api/records` → PR board + predictions (used by Trends).
- Components: `StreamChart({ streams, series: ('hr'|'pace'|'speed'|'elevation'|'cadence'|'power')[] })` (uPlot, synced cursor, `role="img"` wrapper with summary label); `RouteMap({ latlng, colorBy: number[]|null })` (MapLibre, style `https://tiles.openfreemap.org/styles/dark`, line coloured by HR/pace quantiles); `BarChart`, `CalendarHeatmap`, `Sparkline`.
- Detail page sections by sport per spec §8.7; panels hidden when their data is null.

- [ ] **Step 1: Write failing tests** — API list filters by `sport=ride`; detail for a seeded run includes `analysis.splits`; **Review Focus 5:** detail page for a strength workout (no streams) renders summary + HR card text and no element with `data-testid="route-map"` or `"splits"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: workouts list and sport-specific detail pages`

---

## Milestone 7 — Remaining pages

### Task 22: Sleep page

**Files:**
- Create: `server/api/sleep.ts`, `web/pages/Sleep.tsx`
- Test: `tests/server/api-sleep.test.ts`

**Interfaces — Produces:** `GET /api/sleep?date=` → `{ night: NightSummary & { segments; score; scoreComponents; overnight: { lowestHr; avgResp; hrvSamples } } | null; naps: NightSummary[]; history: { date; asleepMin; score; bedtime; wake }[] /* 30 nights */; debtMin; regularitySdMin; needMin; stageAvg }`. Page: night picker (prev/next), Hypnogram, StageCompare, score with component bars, 30-night SleepWindow, duration vs need BarChart with a need line, debt and regularity tiles, naps list.

- [ ] **Step 1: Write failing test** — seeded `GET /api/sleep?date=2026-11-24` has `history.length === 30` and `night.score` 0–100; a date with no sleep returns `night: null` with 200.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement API + page.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: sleep page`

### Task 23: Heart and Activity pages

**Files:**
- Create: `server/api/heart.ts`, `server/api/activity.ts`, `web/pages/Heart.tsx`, `web/pages/Activity.tsx`
- Test: `tests/server/api-heart-activity.test.ts`

**Interfaces — Produces:** `GET /api/heart?range=30d|90d|1y|all` → `{ series: Record<'rhr'|'hrv'|'walkHr'|'hrRecovery'|'vo2max', Series>; vo2Category: string|null; notifications: { at; kind }[]; flagsHistory: Flag[] }` — VO₂ max category from age/sex using a table in `shared/vo2-categories.ts` (bands Low/Below average/Above average/High per Apple's published ranges; null without dob/sex). `GET /api/activity?range=` → `{ days: { date; steps; activeKcal; exerciseMin; standHours; flights; distanceM }[]; goals; weekCompare; monthTotals }`. Pages: BandTrend per metric with range tabs; Activity: goal progress, daily BarCharts with goal line, CalendarHeatmap of steps, week/month comparison.

- [ ] **Step 1: Write failing tests** — heart series lengths match range; `vo2Category` null without dob; activity day totals equal the seeded sums.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: heart and activity pages`

### Task 24: Trends, training load and patterns

**Files:**
- Create: `server/analytics/patterns.ts`, `server/api/trends.ts`, `web/pages/Trends.tsx`
- Test: `tests/server/patterns.test.ts`

**Interfaces — Produces:** `findPatterns(daily: DailyRow[], loads: { date; load }[]): Pattern[]` where `Pattern = { driver; outcome; rho; n; text; points: [number, number][] }` — drivers `bedtime, asleepMin, load, lateWorkout (1 if a workout ended after 19:00), steps` vs **next-day** outcomes `hrvNight, rhr, efficiency, recovery`; kept when |ρ| ≥ 0.3 and n ≥ 30 over the last 90 days; text e.g. `"On nights you go to bed later, your next-day recovery tends to be lower (ρ = −0.42, 64 nights)."`. `GET /api/trends?metric=&range=&compareTo=previous|lastYear` → `{ series; compareSeries; summary: { mean; change } }`; `GET /api/trends/load` → load series (ATL/CTL/TSB/ACWR) + weekly monotony/strain; `GET /api/patterns`. Page: metric picker (all METRICS keys + scores), range tabs, comparison overlay, fitness/fatigue/form chart, PR board + race predictions (from `/api/records`), pattern cards with small scatter plots, labelled "Pattern, not proof".

- [ ] **Step 1: Write failing tests** — synthetic data where later bedtime lowers next-day recovery → a pattern with `rho < −0.3` and text containing "bed"; random noise → no patterns; n = 20 → no patterns.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: trends, training load chart and patterns`

### Task 25: Settings, setup checklist and data export

**Files:**
- Create: `server/api/settings.ts`, `server/api/export.ts`, `web/pages/Settings.tsx`, `web/pages/Setup.tsx`
- Test: `tests/server/api-settings.test.ts`

**Interfaces — Produces:** `GET /api/settings`, `PUT /api/settings` (validates with zod: `sleepNeedMin` 240–720, `hrMax` 120–230, `ftp` 50–600, `tz` valid IANA; returns 400 with field errors) and triggers `recompute({ from: 'all' })` in the background when profile/score inputs change; `POST /api/analytics/rebuild`; `GET /api/setup` → `{ stravaConfigured; stravaConnected; haeFolder; haeFilesSeen; backfillRemaining; daysOfData }`; `GET /api/export/db` (streams a consistent `VACUUM INTO` copy), `GET /api/export/csv/:table` for `daily, workouts, scores, load`. Settings page sections: Sources (status, import history, Connect Strava, HAE folder override, Sync now), Profile, Goals, Zones, Units, How scores work (component weights read from CONFIG), Data (export, rebuild), Disclaimer. Setup page: checklist shown at `/` instead of Today while `daysOfData === 0`.

- [ ] **Step 1: Write failing tests** — invalid `sleepNeedMin: 100` → 400; valid update persists; CSV export of `daily` has a header row and one row per seeded day.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: settings, setup checklist and data export`

---

## Milestone 8 — Running it on the Mac

### Task 26: Setup script, start-at-login, LAN mode and README

**Files:**
- Create: `scripts/setup.ts`, `scripts/install-service.ts`, `server/api/lan-auth.ts`, `server/api/ingest.ts`, `README.md`
- Modify: `server/index.ts`, `server/app.ts`
- Test: `tests/server/lan.test.ts`

**Interfaces — Produces:**
- `npm run setup`: checks `process.versions.node` major ≥ 22 (prints install instructions otherwise), creates `data/` and `.env` from `.env.example`, prompts for Strava client ID/secret (with the exact steps: strava.com/settings/api, "Authorization Callback Domain" = `localhost`), tries `discoverHaeFolder` and prints the found path or instructions.
- `npm run install-service` / `uninstall-service`: writes/removes `~/Library/LaunchAgents/com.local.health-dashboard.plist` (`RunAtLoad`, `KeepAlive`, `WorkingDirectory` = repo, logs to `data/logs/`), then `launchctl load/unload`.
- LAN mode (`settings.lanMode`): server binds `0.0.0.0`; requests from non-loopback addresses need a session cookie from `POST /api/login { passcode }` (scrypt hash in settings) — except `POST /api/ingest/hae` which needs `Authorization: Bearer <ingestToken>` and writes the body to the HAE folder pipeline (`data/inbox/`), returning 202.
- README: what it is; install Node 22 (Homebrew `brew install node@22` or nodejs.org); `npm install`, `npm run setup`, `npm start`, open http://localhost:4321; Health Auto Export setup — Premium, Automations A/B/C exactly as spec §6.1 (iCloud Drive, JSON, last 7 days, hourly, which metrics are unsummarised), one-off full-history export, home-screen widget tip; Strava connect; start-at-login; LAN mode; backup = copy `data/`; privacy notes; disclaimer.

- [ ] **Step 1: Write failing tests** — with `lanMode: true`, a request with `remoteAddress` 192.168.1.20 to `/api/today` → 401, after login → 200; loopback → 200 without login; `/api/ingest/hae` with wrong token → 401, right token → 202 and file appears in `data/inbox/`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5 (owner-assisted, after first real sync):** capture one real file per HAE automation from the owner's iCloud folder, anonymise (shift dates, round GPS to 2 dp), add under `tests/fixtures/hae/real-*.json`, add parser assertions, fix any mismatches in Task 4's mappings.
- [ ] **Step 6: Commit** `feat: setup script, launchd service, LAN mode and README`

### Task 27: End-to-end smoke tests and final verification

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/pages.spec.ts`, `scripts/seed-dev.ts` (if not already from Task 14)
- Test: `tests/e2e/pages.spec.ts`

**Interfaces:** Consumes everything. Playwright starts the built server against a temp `DATA_DIR` seeded with `seedDemo` (Strava/weather network disabled via env `OFFLINE=1`, which makes those stages no-ops).

- [ ] **Step 1: Write the smoke spec** — for each route (`/`, `/sleep`, `/heart`, `/activity`, `/workouts`, first workout detail, `/trends`, `/settings`) at 1280×900 and 390×844: page loads with no console errors, main heading visible, no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`); Today shows the headline and a recovery number; empty-db run shows the Setup checklist at `/`.
- [ ] **Step 2: Run** `npm run build && npm run e2e` — fix failures until PASS.
- [ ] **Step 3: Run the full suite** `npm test && npm run e2e` — Expected: all PASS.
- [ ] **Step 4: Commit** `test: end-to-end smoke tests`

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| §5 Architecture & stack | 1, 3, 12 |
| §6.1 HAE (iCloud + REST) | 4, 5, 26 |
| §6.2 Strava | 15 |
| §6.3 Weather | 17 |
| §6.4 Merge | 16 |
| §6.5 Scheduler / sync now / launchd | 12, 14, 26 |
| §7 Data model | 3 |
| §8.1–8.3 Baselines, recovery, sleep | 6, 7, 8, 11 |
| §8.4–8.5 Heart, activity | 11, 23 |
| §8.6 Training load | 9, 18, 24 |
| §8.7 Workout breakdowns | 18, 19, 20, 21 |
| §8.8 Insights, headline, patterns | 10, 24 |
| §9 Pages & design | 14, 21, 22, 23, 24, 25 |
| §10 First run | 25, 26 |
| §11 Privacy & security | 1 (bind), 26 (LAN) |
| §13 Testing | every task, 27 |
