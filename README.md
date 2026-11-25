# Health — a personal Apple Watch + Strava dashboard

A private health dashboard that runs on your Mac. It pulls in everything your Apple Watch records (through the
**Health Auto Export** iPhone app) and your **Strava** activities, refreshes about once an hour, and shows:

- **Today** — a plain-English summary of how recovered you are and how you slept, your numbers against your own
  30-day normal, last night's sleep stages, your sleep window, HRV and resting-heart-rate trends, and this week vs last.
- **Sleep** — stage timeline, sleep score, sleep debt, bedtime regularity, 30-night history.
- **Heart** — resting HR, HRV, VO₂ max (with fitness category), walking HR, overnight low, HR recovery.
- **Activity** — move/exercise/stand/steps against goals, daily charts, a year heatmap.
- **Workouts** — every run, ride, walk and gym session; runs get per-km splits, hill-adjusted pace, heart-rate drift,
  running form and power, personal bests; rides get climbs, headwind share and power; all get maps, zones, weather and load.
- **Trends** — any metric over any period, comparisons, fitness/fatigue/form, race predictions and "patterns"
  (for example, late bedtimes going with lower recovery).

Everything is stored in the `data/` folder on your Mac. Nothing is uploaded anywhere except requests to Strava (your own
account) and anonymous weather look-ups (a location and time).

> Not a medical device. For personal insight only.

---

## 1. Install

You need **Node.js 22 or newer**. The easiest way on a Mac is [Homebrew](https://brew.sh):

```bash
brew install node@22
```

(or download the installer from [nodejs.org](https://nodejs.org)). Then, in this folder:

```bash
npm install
npm run setup      # checks Node, creates .env and data/, asks for your Strava keys
npm run build
npm start          # then open http://localhost:4321
```

The first time, the home page shows a setup checklist instead of the dashboard.

## 2. Connect Strava

1. Go to <https://www.strava.com/settings/api> and create an application (any name/website).
2. Set **Authorization Callback Domain** to `localhost`.
3. Put the **Client ID** and **Client Secret** in `.env` (`npm run setup` does this for you) and restart.
4. In the dashboard, open **Settings → Connect Strava** and allow all the permissions.

Your whole Strava history is imported in the background. Strava limits how fast apps can download, so a long
history can take a day or two; progress is shown in Settings.

## 3. Set up Health Auto Export (iPhone)

Health Auto Export reads Apple Health on your iPhone and saves it as files. Its automations need **Premium**.
Create three automations, each with **Automation Type: iCloud Drive**, **Format: JSON**, **Export version 2**, a
**date range of the last 7 days**, and an **hourly** interval:

| Automation | Data | Settings |
|---|---|---|
| A — Health Metrics | Select **all** health metrics | Summarise data **on**, aggregation **hourly**, *except* heart rate, HRV, respiratory rate and the running metrics (power, speed, stride length, ground contact time, vertical oscillation), which should be sent **unsummarised** if the app lets you choose per metric (otherwise a separate automation for them with Summarise **off**) |
| B — Sleep | Sleep Analysis only | Summarise data **off** (the dashboard needs each sleep stage) |
| C — Workouts | Workouts | Include **route** data and **heart-rate** data |

Then run a **one-off manual export of your full history** (same formats) into the same iCloud Drive folder. If the
app struggles with years of data, export a few months at a time.

Tips:
- iOS decides when background exports run, and Health data can only be read while your phone has been unlocked
  recently, so "hourly" is approximate. Adding the Health Auto Export widget to your Home Screen helps.
- Because every export covers the last 7 days, a missed hour fills itself in next time. Duplicate data is ignored.
- The dashboard finds the iCloud folder automatically (under `~/Library/Mobile Documents`). If it doesn't, set the
  path in **Settings**.

## 4. Keep it running (optional)

```bash
npm run install-service     # start automatically when you log in (macOS launchd)
npm run uninstall-service   # remove it again
```

The dashboard syncs every hour while your Mac is awake, and catches up straight away after it wakes. You can always
press **Sync now**.

## 5. Home-network mode (optional)

In **Settings → Home-network mode** you can choose a passcode to open the dashboard from your phone on the same Wi-Fi
(`http://<your-mac-name>.local:4321`). This also gives you a URL and token for Health Auto Export's **REST API**
automation, as an alternative to iCloud Drive. Restart the app after turning it on or off.

## What your watch can and can't measure

The Apple Watch SE records heart rate, resting HR, HRV, VO₂ max, breathing rate, sleep stages, steps, energy,
exercise and stand time, workouts with GPS, and running power/form. It has no blood-oxygen sensor, ECG or wrist
temperature, so those don't appear — if you upgrade your watch, extra metrics are picked up automatically.

## How the scores work

- **Recovery (0–100)** compares last night with your own last 30 days: HRV 40%, resting HR 25%, sleep vs need 25%,
  breathing rate 5%, training form 5%. 67+ is well recovered, 34–66 moderate, below 34 low.
- **Sleep score**: duration vs need 50, efficiency 15, deep + REM share 20, bedtime regularity 15.
- **Training load** is Banister TRIMP from heart rate; fitness = 42-day average, fatigue = 7-day, form = fitness − fatigue.
- Every comparison needs 7 days of history first ("Calibrating").

All weights and thresholds live in `shared/analytics-config.ts`.

## Your data

- Everything is in `data/` (the SQLite database `health.db`, raw copies of imported files in `data/raw/`).
  Back up by copying that folder.
- **Settings → Your data** downloads the database or CSVs, and can rebuild all analytics.

## Development

```bash
npm run dev        # API on :4321 with reload, web app on :5173
npm test           # unit and API tests (Vitest)
npm run e2e        # browser smoke tests (Playwright)
npm run seed:dev   # fill data/health.db with 120 days of demo data
```

Project layout: `server/` (sync, importers, analytics, API), `web/` (React app), `shared/` (types, metric catalogue,
config), `scripts/` (setup, start-at-login), `docs/superpowers/` (design and build plan).
