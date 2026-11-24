# Personal Health Dashboard — Design

**Date:** 2026-11-24
**Status:** Draft, awaiting approval
**Visual reference:** mockup **D · Dark & sleek** on the canvas at
https://claude.ai/artifact/5pFSBCwd1wsk5LEjYiHNuj (all numbers on it are sample data)

---

## 1. Intent

A private, browser-based health dashboard fed by an Apple Watch SE. It is an
**overall health monitor first** (recovery, sleep, heart, daily activity), with a
**workouts section** that gives deep breakdowns of each run, ride or other session.

When the owner opens it in the morning it must answer two questions before anything
else: **"How recovered am I?"** and **"How did I sleep?"**. It should use every metric
the watch records, compare each one against the owner's own normal, and explain what
it means in plain English. It should feel original, clean and easy to read, with
plenty of graphs and comparisons.

It runs **locally on the owner's MacBook Air** for now. Hosting it on a website is a
later step, and the design keeps that move cheap.

## 2. Goals, non-goals, anti-goals

**Goals**
- Pull in Apple Health data (via Health Auto Export) and Strava data automatically,
  roughly every hour, with no manual steps once set up.
- Import the owner's full history on first run, so baselines and trends work from day one.
- A daily **recovery score** and **sleep analysis**, each broken into the factors behind it.
- Show every metric against the owner's personal baseline (usual range), not just as a raw number.
- Detailed per-workout breakdowns for running and cycling, and sensible breakdowns for walks, hikes, strength and other sessions.
- Training load (fitness, fatigue, form), personal bests and race predictions.
- Trends over any period, period-vs-period comparisons, and plain-English "patterns" (for example, late bedtimes tracking with lower recovery).
- Dark, sleek UI matching mockup D, readable on a laptop and a phone-width window.

**Non-goals (for this version)**
- Hosting on the public internet. It runs on localhost; hosting comes later.
- Multiple users, sharing or social features.
- A native iPhone or Watch app.
- Writing data back to Apple Health or Strava.
- Push notifications or email digests.
- An AI chat or LLM-written summaries. The plain-English text is generated from deterministic templates.
- Medical diagnosis. Wording stays non-clinical ("higher than your usual"), with a short disclaimer.

**Anti-goals (would count as failure even if it technically works)**
- A cluttered wall of numbers. Every number carries context: a usual range, a comparison or a trend.
- Black-box scores. Recovery and sleep scores always show their components and how they were calculated.
- Health data leaking off the machine. Nothing is sent to third parties except the
  Strava API (the owner's own account) and anonymous weather lookups (coordinates and time only).
- Silently stale data. If a source hasn't synced recently, the UI says so.

## 3. Constraints

**What the Apple Watch SE can and can't measure**
- Available: heart rate, resting HR, walking HR average, HRV (SDNN), heart-rate
  recovery (cardio recovery), VO₂ max, respiratory rate during sleep, sleep stages
  (awake / REM / core / deep), steps, distance, flights climbed, active and resting
  energy, exercise minutes, stand hours, workouts with GPS routes. Running workouts
  also record running power, stride length, ground contact time and vertical oscillation.
  Cycling power and cadence need a paired Bluetooth sensor.
- Not available on the SE: blood oxygen, ECG, wrist temperature. The UI must not
  show empty panels for these. If a future watch provides them, they should appear
  automatically, because ingestion is metric-agnostic.
- Apple's HRV is **SDNN sampled a few times a day**, not continuous. Recovery uses the
  samples taken during the sleep window when they exist, and the daily mean otherwise.

**Health Auto Export (HAE)**
- Apple offers no web API for Health data. HAE is an iPhone app that exports Health data
  on a schedule. Its **automations need HAE Premium** (US prices: $6.99/yr or $24.99 lifetime).
- Background runs are "best effort", and iOS decides when they happen. Health data
  is only readable while the phone is unlocked. "Hourly" is therefore approximate.
  Mitigations: each export covers a rolling window (the last 7 days), so a missed run
  is filled by the next one. Imports are idempotent. The UI shows the time of the last
  HAE data and warns when it's older than 3 hours.
- Export JSON schema: https://github.com/Lybron/health-auto-export/wiki/API-Export---JSON-Format.
  The parser must be validated against **real files captured from the owner's phone**, not just the wiki.

**Strava**
- OAuth with `localhost` as the callback domain works for a local app.
- Webhooks need a public URL, so they aren't used locally; Strava is polled hourly instead.
- Rate limits: 100 requests per 15 minutes and 1,000 per day by default. Backfilling the
  history (1 summary page per 200 activities, plus about 3 requests per activity for
  detail, streams and laps) must be throttled and resumable across runs.
- Use is limited to the owner's own account, under the Strava API Agreement.

**Running on a MacBook Air**
- The app only syncs while the Mac is awake and the app is running. On wake or
  start-up it catches up straight away. Optionally, a `launchd` agent starts it at login.
- The server binds to `127.0.0.1` by default, so only the Mac itself can reach it.

## 4. Approaches considered

| Approach | Trade-offs | Outcome |
|---|---|---|
| Strava only | Free and simple, but loses running form, power, VO₂ max, HRV, sleep and all daily health data | Rejected: the owner wants all available data and a full health monitor |
| **Strava + Health Auto Export** | Full data; costs HAE Premium; iOS background timing is approximate | **Chosen by owner** |
| Cloudflare Workers + D1 (hosted) | One place, always on; the free tier's 10 ms CPU limit is too small for big health files, so it needs the $5/mo plan | Rejected: owner wants free for now |
| Supabase + Cloudflare Pages (hosted, free) | Free, but more moving parts, a 500 MB cap, and idle projects can pause | Deferred: a candidate for the later hosting step |
| **Local on the MacBook (Node + SQLite)** | Free; data stays on the Mac; only syncs while the Mac is awake; no Strava webhooks | **Chosen by owner** for this version |

HAE delivery, for the local setup:

| Option | Trade-offs | Outcome |
|---|---|---|
| **HAE → iCloud Drive automation → app watches the folder** | Works from anywhere (no shared Wi-Fi needed); files also serve as a raw backup | **Primary** (builder's call) |
| HAE → REST API automation → `http://<mac>.local:port` | Near-instant, but only when the phone and Mac are on the same network and the Mac is awake | Supported as an option, off by default |

## 5. Architecture

```
iPhone (Apple Health) ──HAE automation──▶ iCloud Drive/…/Health Auto Export/*.json
                                                  │  (synced to the Mac by iCloud)
                                                  ▼
                       ┌──────────────── MacBook (Node 22 app) ────────────────┐
Strava API ◀──hourly── │  Sync scheduler ─▶ Importers ─▶ SQLite (data/health.db) │
Open-Meteo ◀──per run─ │                      │              ▲                   │
                       │                      ▼              │                   │
                       │                Analytics engine ────┘ (derived tables)  │
                       │                      │                                  │
                       │                 HTTP API (Fastify, 127.0.0.1:4321)      │
                       │                      │                                  │
                       │             React web app (served by the same server)   │
                       └──────────────────────────────────────────────────────────┘
```

**Stack (builder's calls)**
- **Runtime:** Node.js 22 LTS, TypeScript throughout, npm.
- **Server:** Fastify. It serves the JSON API and the built front end from a single process.
- **Database:** SQLite via `better-sqlite3`, with Drizzle ORM and versioned migrations.
  The file is `data/health.db`; the `data/` folder is gitignored.
- **Front end:** React + Vite + TypeScript, React Router, and TanStack Query for data fetching.
- **Charts:** hand-built SVG components for the small, designed charts in mockup D
  (range bars, hypnogram, sleep window, sparklines), and **uPlot** for dense time series
  (workout streams, long trends) with synced hover.
- **Maps:** MapLibre GL with OpenFreeMap's dark vector style (free, no API key).
- **Large JSON:** stream-parse HAE files (`stream-json`) so multi-hundred-MB history exports don't exhaust memory.
- **Tests:** Vitest for parsers and analytics, Playwright for page smoke tests.
- **Layout:** `server/` (sync, importers, analytics, API), `web/` (React app),
  `shared/` (types, metric definitions, formatting), and `scripts/` (setup, launchd install).

Commands: `npm install`, `npm run setup` (interactive first run), `npm start`
(production build at http://localhost:4321), `npm run dev`, `npm test`.

## 6. Data sources and sync

Each source works without the other: with only Strava connected the workouts, training
load and PR features work; with only HAE everything works except Strava-specific extras
(names, gear, segments, Strava best efforts). Pages hide panels whose data source is missing.

### 6.1 Health Auto Export

**HAE configuration**: the README will give exact steps.
- Automation A, **Health Metrics**: JSON, iCloud Drive, interval hourly, date range
  "last 7 days". Every metric is selected. High-frequency metrics are sent unsummarised
  (heart rate, HRV, respiratory rate, running power/speed/stride/GCT/vertical oscillation)
  and the rest are aggregated hourly (steps, energy, distance, flights, exercise/stand minutes).
- Automation B, **Sleep**: sleep analysis, **unsummarised** (individual stage segments are needed for the hypnogram).
- Automation C, **Workouts**: JSON, including route and heart-rate data.
- **History backfill:** a one-off manual export over the full date range, done in monthly
  chunks if the app requires it, into the same folder.

**Importer**
- Watches the HAE folder (path auto-discovered under `~/Library/Mobile Documents/`
  and overridable in Settings) and also scans it on start-up and every 5 minutes.
- Each file is hashed. Files already imported are skipped, and each import is recorded in `imports`.
- Raw files are copied to `data/raw/hae/` so everything can be re-parsed if the parser improves.
- Upserts are keyed by `(metric, start, source)`. Samples from iPhone and Watch are kept
  separately; analytics prefer the Watch for HR, HRV and sleep, and the iPhone for walking steadiness if present.
- Unknown metrics are stored generically, so nothing is dropped.
- **Optional REST endpoint**, `POST /api/ingest/hae`: off by default. When enabled it
  requires a bearer token and the server binds to the LAN interface (the dashboard
  then also needs a passcode; see §11).

### 6.2 Strava
- `npm run setup` walks the owner through creating a Strava API app (callback domain
  `localhost`) and stores the client ID and secret in `.env`.
- Settings → Connect Strava runs OAuth with scopes `read,activity:read_all,profile:read_all`.
  Tokens are stored in SQLite and refreshed automatically.
- **Hourly:** fetch activities after the latest known start time. For each new or updated
  activity, fetch the detail (laps, splits, best efforts, segment efforts, gear), streams
  (`time, distance, latlng, altitude, velocity_smooth, heartrate, cadence, watts, temp,
  moving, grade_smooth`) and gear.
- **Backfill:** page through all history, queue the detail and stream fetches, and process
  them under a rate-limit budget (stay below 90 requests per 15 minutes and 900 per day).
  Progress is resumable and shown in Settings.

### 6.3 Weather (Open-Meteo)
For each outdoor workout with GPS, fetch the hourly temperature, humidity, wind speed
and direction, and precipitation at the start point. This uses the free historical API
with no key, and the result is cached on the workout.

### 6.4 Merging Apple and Strava workouts
The same session usually arrives from both sources. Two records are **one workout** if
their start times are within 2 minutes, their durations are within 10%, and their
sport families match (run/walk/hike/ride/swim/other).
- Physiology (HR series, running power and form, energy): Apple is primary.
- Name, description, gear, segments, best efforts and the cleaned GPS polyline: Strava is primary.
- Distance and elevation: Strava when present (better smoothing), otherwise Apple.
- Unmatched records stand alone. The source badges on each workout show where its data came from.

### 6.5 Scheduler
- A loop inside the server checks every 5 minutes and runs the hourly job if the last
  successful run was more than 55 minutes ago. This also covers catching up after the Mac wakes.
- Hourly job: scan the HAE folder → Strava poll and backfill slice → weather enrichment →
  recompute analytics for affected days → write a `sync_runs` row (status, counts, errors).
- "Sync now" button in the header and in Settings.
- Optional `npm run install-service` installs a `launchd` agent that starts the app at login.

## 7. Data model (outline)

Raw and normalised:
- `imports` (file/source, hash, received_at, status, error)
- `samples` (metric, start, end, value, unit, source, device): all quantity samples
- `sleep_segments` (start, end, stage, source)
- `workouts` (id, sport, start, end, duration, moving_time, distance, elevation_gain,
  energy, avg/max HR, name, strava_id, apple_id, gear_id, polyline, weather JSON, sources)
- `workout_streams` (workout_id, compressed JSON of aligned arrays)
- `workout_laps`, `workout_splits`, `best_efforts`, `segment_efforts`, `gear`
- `oauth_tokens`, `settings`, `sync_runs`, `strava_backfill_queue`

Derived (recomputed by the analytics engine, safe to rebuild from raw):
- `daily_summary` (date → every daily metric: steps, energy, RHR, HRV, sleep metrics, …)
- `baselines` (date, metric → median, IQR, n)
- `daily_scores` (date → recovery, sleep score, components JSON, headline text, flags)
- `training_load` (date → daily load, ATL, CTL, TSB, ACWR, monotony, strain)
- `workout_analysis` (workout_id → zones, decoupling, EF, GAP splits, climbs, comparisons, …)
- `personal_records`, `insights` (date, kind, text, severity, evidence JSON)

All times are stored as UTC. Days are bucketed in the owner's local time zone (from the
system; settable), and each workout and sample keeps its original offset so travel displays correctly.

## 8. Analytics

All thresholds and weights live in one config module (`shared/analytics-config.ts`)
so they're easy to tune. These are builder's calls, set to sensible defaults.

### 8.1 Baselines
- For each metric: a rolling **30-day median and IQR**, excluding today.
- With fewer than 7 data points the metric shows "Calibrating" instead of a comparison.
- "Usual range" = median ± IQR/2 (the shaded band in mockup D).

### 8.2 Recovery score (0–100)
- Components, as robust z-scores (z = (today − median) / (IQR / 1.35)), clipped to ±3:
  - HRV, overnight: weight 40, higher is better
  - Resting HR: weight 25, lower is better
  - Sleep, asleep ÷ personal sleep need (default 7h30, settable): weight 25
  - Respiratory rate, deviation from baseline in either direction: weight 5
  - Training form, TSB: weight 5
- Score = clamp(50 + 16 × weighted z, 0, 100).
- Bands: ≥ 67 **well recovered**; 34–66 **moderately recovered**; < 34 **take it easy**.
- The UI always shows each component's value, usual range and contribution.

### 8.3 Sleep
- **Night assignment:** sleep between 18:00 and 14:00 next day belongs to the wake date.
  Segments with gaps under 45 minutes are merged into one session. Other sessions are naps,
  reported separately and not counted towards the night.
- **Per night:** total asleep, time in bed (in-bed samples if present, otherwise first-to-last
  segment), efficiency, minutes and % per stage, number of awakenings, bedtime, wake time,
  lowest overnight HR, average respiratory rate, and HRV samples within the window.
- **Comparisons:** each stage against its 30-night average (mockup D), and duration against the sleep need.
- **Sleep debt:** sum of (need − asleep) over the last 14 nights; surplus nights pay back at most 1 hour each.
- **Regularity:** the circular standard deviation of bedtime and wake time over 14 nights (handles midnight wrap).
- **Sleep score (0–100):** duration vs need 50, efficiency 15, deep+REM share vs baseline 20, regularity 15.

### 8.4 Heart
- Resting HR, HRV, walking HR average, HR recovery (Apple's cardio recovery) and VO₂ max,
  each with its trend and usual range.
- VO₂ max category by age and sex, using Apple's published bands; needs date of birth and sex in Settings.
- If HAE exports HR notifications (high, low, irregular rhythm), they're listed with timestamps.

### 8.5 Activity
- Steps, distance, flights, active and resting energy, exercise minutes and stand hours,
  shown against goals (settable, with defaults from the Apple activity summary if exported).
- Daily bars, a calendar heatmap, and this week vs last week.

### 8.6 Training load
- **Per-workout load:** Banister TRIMP, computed second by second from the HR stream where
  available, otherwise from average HR × duration. Uses HRmax (default: the highest HR
  observed in a workout over the last 12 months, overridable) and resting HR (the 30-day baseline).
- **ATL** = 7-day exponentially weighted average; **CTL** = 42-day; **TSB (form)** = CTL − ATL (yesterday's values).
- **ACWR** = 7-day load ÷ (28-day load ÷ 4). Above 1.5 it shows a "ramping fast" flag.
- **Weekly monotony and strain** (Foster).

### 8.7 Workout breakdowns
**All workouts:** summary, map coloured by HR or pace/speed, a stream chart (HR, pace/speed,
elevation, cadence, power) with synced hover, HR time-in-zone (5 zones on heart-rate reserve
by default; zone model settable), training load, weather, and comparison with similar past
sessions (same sport, distance within ±10%, last 90 days: pace/speed, HR, efficiency).

**Running, in addition:**
- Per-km splits: pace, grade-adjusted pace (Minetti energy-cost model on the `grade_smooth`
  stream), HR, cadence (Strava reports per-leg cadence; ×2 for steps/min), elevation and power.
- **Aerobic decoupling (Pa:HR):** first half vs second half, flagged above 5%. **Efficiency
  factor:** normalised graded pace ÷ average HR, tracked as a trend over all runs.
- **Running form:** stride length, ground contact time, vertical oscillation and running power,
  using Apple samples within the workout window, with averages and trends.
- Best efforts (400 m, 1 km, 1 mile, 5 km, 10 km, half, marathon), with a PR badge and PR history.
- **Race predictions:** Riegel (t₂ = t₁ × (d₂/d₁)^1.06) from the best efforts of the last 90 days,
  shown alongside a VDOT-based estimate.
- Shoe mileage from Strava gear, with a "nearing 600 km" note.

**Cycling, in addition:**
- Speed, moving time, elevation, climbs (detected where grade is ≥ 3% for ≥ 500 m) with VAM per climb.
- Headwind/tailwind share, from the route heading against the weather wind direction.
- HR decoupling and efficiency (speed ÷ HR, with a terrain caveat).
- With a power meter: normalised power, intensity factor and TSS (needs FTP in Settings).
  Without one, these panels are hidden, not shown empty.
- Bike mileage from Strava gear.

**Walk / hike:** pace, HR, elevation, map. **Strength, HIIT and other:** duration, HR curve, zones, energy, load.

### 8.8 Insights and plain-English text
- **Headline** (Today page): built from templates using the recovery band, the
  biggest-contributing component and a suggestion, e.g. *"You're well recovered after
  7 hours of sleep. A good day to train hard."*
- **Flags:** resting HR ≥ usual + 5 bpm for 2 days; respiratory rate ≥ usual + 1.5; HRV
  below the usual range for 3 days; sleep debt > 5 h; ACWR > 1.5. Wording stays non-medical.
- **Patterns** (Trends page): Spearman correlations over the last 90 days between drivers
  (bedtime, sleep duration, training load, late workouts after 19:00, steps) and next-day
  outcomes (HRV, resting HR, sleep efficiency, recovery). Shown when |ρ| ≥ 0.3 and n ≥ 30,
  as a sentence with a small scatter plot, and labelled as a pattern, not a cause.

## 9. Pages and UI

**Design language** (from mockup D): near-black background `#0B0F14`, cards `#121821` with
`#1F2733` borders and 20 px radius; text `#E8ECF1`, secondary text `#AEB7C4` and `#9AA4B2`;
green `#3DDC97` for "good / recovered"; amber `#FFB547` for "worse than usual"; pink `#FF8FA3`
for heart rate; sleep stages deep `#3346C8`, core `#6F86FF`, REM `#B9C6FF`, awake `#FFB547`.
Space Grotesk for headlines and big numbers, Inter for body text. Pill navigation. Every
number sits next to its usual range, comparison or trend. Layouts reflow to a single
column at phone width. Charts have text alternatives, and colours that must be told apart
also differ in lightness.

**Header (all pages):** navigation (Today, Sleep, Heart, Activity, Workouts, Trends, Settings),
last-sync time per source, a stale-data warning, and "Sync now".

1. **Today:** as mockup D. Headline and recovery ring; "today vs your normal" range bars;
   last night (hypnogram and stages vs average); sleep window over 7 nights; HRV and
   resting HR over 14 days; this week vs last week; last workout; active flags.
2. **Sleep:** night picker; hypnogram; stage breakdown vs average; sleep score with components;
   sleep window over 30 nights; duration vs need; sleep debt; regularity; overnight HR and
   breathing; naps.
3. **Heart:** resting HR, HRV, walking HR, HR recovery and VO₂ max (with category), each as a
   trend with usual-range band; HR notifications; flags history.
4. **Activity:** today's and yesterday's totals vs goals; daily bars; calendar heatmap;
   weekly and monthly totals; this period vs last.
5. **Workouts:** list with sport filter and search; weekly volume by sport (stacked bars);
   calendar heatmap. **Workout detail:** sport-specific breakdown as in §8.7.
6. **Trends:** any metric over 30 d / 90 d / 1 y / all, with baseline band; compare two
   periods side by side; training load chart (fitness, fatigue, form); PR board and race
   predictions; patterns.
7. **Settings and Sync:** source status and import history; Strava connect and backfill
   progress; HAE folder path; profile (date of birth, sex, HRmax, resting HR override, sleep
   need, activity goals, FTP, zone model, units — metric and 24-hour by default); score
   explanations; data export (download the SQLite file, CSV per table); "Rebuild analytics".

Empty and loading states: first run shows a setup checklist (Strava connected? HAE files
seen? backfill progress) instead of empty charts.

## 10. First-run experience
0. Install Node.js 22 LTS on the Mac (Homebrew `brew install node@22` or the nodejs.org installer) — the README covers this.
1. `npm install && npm run setup`. This checks the Node version, creates `.env` and `data/`,
   guides Strava API app creation, and prints the HAE automation steps.
2. `npm start` → open http://localhost:4321 → setup checklist.
3. Connect Strava → backfill starts in the background, with progress shown.
4. In HAE: create the automations and run the full-history manual export. The app imports
   the files as they appear in iCloud Drive.
5. Baselines become available after 7 days of history, which is immediate with a backfill.

## 11. Privacy and security
- All data lives in `data/` on the Mac (gitignored). Secrets (Strava client secret) live in `.env` (gitignored).
- The server binds to `127.0.0.1` only. LAN mode (for the HAE REST option or for viewing on
  the phone at home) is opt-in: it binds to the LAN, requires a passcode for the dashboard
  (session cookie) and a bearer token for ingestion.
- Outbound calls: Strava API (owner's account) and Open-Meteo (coordinates and time only). Map tiles from OpenFreeMap.
- A short disclaimer in Settings and the footer: not a medical device.

## 12. Path to hosting later (not built now)
The server is plain Node + SQLite, and storage sits behind a thin repository layer. Moving
to a hosted site later means: deploying the same server to a small host (or porting storage
to Postgres), adding a passcode login, switching HAE to the REST automation, and enabling
Strava webhooks. No rewrite of analytics or UI is needed.

## 13. Testing
- Parsers: fixtures built from the HAE wiki examples **plus real files captured from the
  owner's phone** (anonymised before committing), and Strava API fixtures.
- Analytics: pure functions with unit tests (baselines, recovery, sleep night assignment
  across midnight and DST, TRIMP/ATL/CTL, decoupling, GAP, Riegel, merge logic).
- API: route tests against a seeded SQLite file.
- UI: Playwright smoke tests for every page on seeded data, at desktop and phone width.

## 14. Who decided what

**Decided by the owner**
- Data sources: Strava + Health Auto Export.
- An overall health dashboard, with workouts as one section giving per-sport breakdowns.
- Home screen leads with recovery and sleep.
- Look: mockup D (dark & sleek): C's plain-English summary plus graphs and comparisons.
- Free for now; run locally on the MacBook Air; hosting later.

**Builder's calls (open to change)**
- Node/TypeScript, Fastify, SQLite (Drizzle), React/Vite, uPlot, MapLibre + OpenFreeMap.
- HAE via iCloud Drive as primary, REST optional.
- Strava polling (no webhooks locally) with throttled, resumable backfill.
- Recovery and sleep score formulas, weights, bands and flag thresholds (§8), all in one config file.
- Merge rules for Apple and Strava workouts (§6.4).
- Weather enrichment via Open-Meteo.
- Metric units, 24-hour time and UK date format by default (settable).
- App port 4321, localhost-only by default, optional `launchd` start-at-login.

**Left to the builder**
- Exact HAE metric names and per-metric aggregation, confirmed from real captured files.
- The exact iCloud folder path (auto-discovery with a Settings override).
- Component structure, API route shapes and chart details beyond mockup D.

## 15. Risks
- **iOS background timing** may make HAE sync less than hourly. Mitigated by rolling
  7-day windows, a stale-data warning, and the HAE home-screen widget.
- **HAE schema drift** between app versions. Mitigated by keeping raw files, validating
  the parser, storing unknown metrics generically, and offering "rebuild analytics".
- **Large first import** (years of heart-rate data). Mitigated by stream parsing, batched
  transactions and monthly export chunks.
- **Strava rate limits** on long histories. Mitigated by throttled, resumable backfill,
  which may take a day or two for very large histories.
