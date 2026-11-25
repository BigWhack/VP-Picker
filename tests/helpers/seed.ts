import type { Db } from '../../server/db/client.js';
import type { Sample, SleepSegment, SleepStage, Streams, WorkoutRecord } from '../../shared/types.js';
import { upsertSamples } from '../../server/repo/samples.js';
import { upsertSleep } from '../../server/repo/sleep.js';
import { upsertRecord } from '../../server/repo/workouts.js';
import { updateSettings } from '../../server/repo/settings.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WATCH = 'Demo Apple Watch';
const iso = (ms: number) => new Date(ms).toISOString();

function syntheticStreams(kind: 'run' | 'ride', durationS: number, rnd: () => number): Streams {
  const time: number[] = []; const distance: number[] = []; const latlng: [number, number][] = [];
  const altitude: number[] = []; const speed: number[] = []; const heartrate: number[] = []; const cadence: number[] = []; const grade: number[] = [];
  const base = kind === 'run' ? 3.3 : 7.5;
  let d = 0; let lat = 51.5007; let lon = -0.1246;
  for (let t = 0; t <= durationS; t += 5) {
    const alt = 20 + 15 * Math.sin(t / 600);
    const g = t === 0 ? 0 : (alt - altitude[altitude.length - 1]) / Math.max(1, base * 5);
    const v = base * (1 - 2 * g) + (rnd() - 0.5) * 0.2;
    if (t > 0) d += v * 5;
    const heading = (t / durationS) * 2 * Math.PI;
    lat += (Math.cos(heading) * v * 5) / 111320; lon += (Math.sin(heading) * v * 5) / (111320 * Math.cos((lat * Math.PI) / 180));
    time.push(t); distance.push(d); latlng.push([Number(lat.toFixed(6)), Number(lon.toFixed(6))]); altitude.push(alt);
    speed.push(v); grade.push(Number((g * 100).toFixed(2)));
    heartrate.push(Math.round((kind === 'run' ? 140 : 128) + 12 * (t / durationS) + (rnd() - 0.5) * 6));
    cadence.push(kind === 'run' ? 84 + Math.round(rnd() * 3) : 85 + Math.round(rnd() * 6));
  }
  return { time, distance, latlng, altitude, speed, heartrate, cadence, grade };
}

/** Deterministic synthetic history: sleep, heart, activity samples and ~4 workouts a week. */
export function seedDemo(db: Db, days = 60, now = new Date('2026-11-24T08:00:00Z')): void {
  const rnd = mulberry32(42);
  updateSettings(db, { tz: 'Europe/London', dob: '1994-06-01', sex: 'male' });
  const samples: Sample[] = []; const sleep: SleepSegment[] = [];
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const push = (metric: string, ms: number, value: number, unit: string) =>
    samples.push({ metric, start: iso(ms), end: iso(ms), value, unit, source: WATCH });

  for (let i = days - 1; i >= 0; i--) {
    const day = todayMs - i * 86400000;
    // Sleep: bed ~23:00 ± 40 min the evening before, 6.2–8.3 h
    const late = (rnd() - 0.5) * 80;
    const bed = day - 60 * 60000 + late * 60000;
    const asleep = 372 + rnd() * 126 - Math.max(0, late) * 0.5;
    let t = bed; const end = bed + asleep * 60000;
    const cycle: [SleepStage, number][] = [['core', 20], ['deep', 40], ['core', 25], ['rem', 20], ['awake', 3]];
    let c = 0;
    while (t < end) {
      const [stage, len] = cycle[c % cycle.length];
      const scaled = stage === 'deep' ? len * (c < 10 ? 1 : 0.4) : stage === 'rem' ? len * (c < 10 ? 1 : 1.6) : len;
      const segEnd = Math.min(end, t + scaled * 60000);
      sleep.push({ start: iso(t), end: iso(segEnd), stage, source: WATCH });
      t = segEnd; c++;
    }
    const sleepEffect = (asleep - 450) / 60;
    for (let k = 1; k <= 3; k++) push('hrv', bed + k * 100 * 60000, Math.round(50 + sleepEffect * 3 - late / 15 + (rnd() - 0.5) * 10), 'ms');
    push('rhr', day + 8 * 3600000, Math.round(53 - sleepEffect + (rnd() - 0.5) * 3), 'bpm');
    push('resp', bed + 200 * 60000, Number((14.2 + (rnd() - 0.5) * 0.6).toFixed(1)), '/min');
    push('walkHr', day + 18 * 3600000, Math.round(98 + (rnd() - 0.5) * 6), 'bpm');
    if (i % 7 === 0) push('vo2max', day + 12 * 3600000, Number((48.5 + (days - i) * 0.015).toFixed(1)), 'ml/kg/min');
    for (let h = 7; h <= 21; h++) {
      const ms = day + h * 3600000;
      push('steps', ms, Math.round(400 + rnd() * 700), 'steps');
      push('activeKcal', ms, Math.round(20 + rnd() * 40), 'kcal');
      push('basalKcal', ms, 70, 'kcal');
      push('hr', ms, Math.round(70 + rnd() * 25), 'bpm');
      if (h >= 8 && h <= 20 && rnd() > 0.15) push('standHours', ms, 1, 'h');
      if (rnd() > 0.7) push('exerciseMin', ms, Math.round(5 + rnd() * 10), 'min');
    }
    // Overnight HR minimum
    samples.push({ metric: 'hrMin', start: iso(bed + 240 * 60000), end: iso(bed + 240 * 60000), value: Math.round(46 + rnd() * 4), unit: 'bpm', source: WATCH });

    const dow = new Date(day).getUTCDay();
    const addWorkout = (sport: WorkoutRecord['sport'], name: string, hour: number, durationS: number, withStreams: boolean) => {
      const start = day + hour * 3600000;
      const streams = withStreams && (sport === 'run' || sport === 'ride') ? syntheticStreams(sport, durationS, rnd) : null;
      const distanceM = streams?.distance ? streams.distance[streams.distance.length - 1] : undefined;
      const hr = streams?.heartrate ?? [];
      const rec: WorkoutRecord = {
        source: 'apple', sourceId: `demo-${sport}-${i}`, sport, name, start: iso(start), end: iso(start + durationS * 1000),
        tzOffsetMin: 0, durationS, distanceM, energyKcal: Math.round(durationS / 60 * (sport === 'ride' ? 9 : 11)),
        avgHr: hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : 112, maxHr: hr.length ? Math.max(...hr) : 138,
        elevGainM: streams ? 60 : undefined,
      };
      upsertRecord(db, rec, { demo: true }, streams);
    };
    if (dow === 1) addWorkout('run', 'Morning run', 7, 3000 + Math.round(rnd() * 300), true);
    if (dow === 3) addWorkout('ride', 'Evening ride', 18, 4200 + Math.round(rnd() * 600), true);
    if (dow === 4) addWorkout('strength', 'Strength', 19, 2700, false);
    if (dow === 6) addWorkout('run', 'Long run', 9, 4800 + Math.round(rnd() * 900), true);
  }
  upsertSamples(db, samples);
  upsertSleep(db, sleep);
}
