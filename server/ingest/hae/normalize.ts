import type { Sample, SleepSegment, SleepStage, Sport, Streams, WorkoutRecord } from '../../../shared/types.js';
import { METRICS, metricFromHae } from '../../../shared/metrics.js';

/** "2026-11-24 06:34:00 +0000" → UTC ISO + offset minutes. Also accepts ISO strings. */
export function parseHaeDate(s: string): { iso: string; offsetMin: number } {
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-])(\d{2}):?(\d{2})$/);
  if (m) {
    const sign = m[3] === '-' ? -1 : 1;
    const offsetMin = sign * (Number(m[4]) * 60 + Number(m[5]));
    const local = Date.parse(`${m[1]}T${m[2]}Z`);
    return { iso: new Date(local - offsetMin * 60000).toISOString(), offsetMin };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable HAE date: ${s}`);
  return { iso: d.toISOString(), offsetMin: 0 };
}

const STAGES: Record<string, SleepStage> = {
  Core: 'core', Deep: 'deep', REM: 'rem', Awake: 'awake', 'In Bed': 'inBed', Asleep: 'asleep', Unspecified: 'asleep',
};

/** Convert HAE units to the catalogue's canonical unit. Returns null when no conversion is known. */
function convert(value: number, from: string, to: string): number | null {
  const f = from.toLowerCase(); const t = to.toLowerCase();
  if (f === t) return value;
  const table: Record<string, Record<string, number>> = {
    km: { mi: 1.609344, m: 0.001, km: 1 },
    m: { cm: 0.01, mi: 1609.344, km: 1000, ft: 0.3048, m: 1, in: 0.0254 },
    cm: { m: 100, in: 2.54, mm: 0.1 },
    kcal: { kj: 1 / 4.184, cal: 1, kcal: 1 },
    'km/h': { 'mi/hr': 1.609344, 'mi/h': 1.609344, 'm/s': 3.6 },
    kg: { lb: 0.45359237, lbs: 0.45359237 },
    ms: { s: 1000, ms: 1 },
    min: { hr: 60, h: 60, s: 1 / 60 },
  };
  const k = table[t]?.[f];
  return k === undefined ? null : value * k;
}

const source = (p: Record<string, unknown>) => (typeof p.source === 'string' && p.source ? p.source : 'unknown');

export function normalizeMetric(name: string, units: string, point: Record<string, unknown>): { samples: Sample[]; sleep: SleepSegment[] } {
  if (name === 'sleep_analysis') {
    if (typeof point.value !== 'string') return { samples: [], sleep: [] }; // summarised sleep: ignored
    const stage = STAGES[point.value];
    const start = (point.startDate ?? point.start ?? point.date) as string;
    const end = (point.endDate ?? point.end) as string;
    if (!stage || !start || !end) return { samples: [], sleep: [] };
    return { samples: [], sleep: [{ start: parseHaeDate(start).iso, end: parseHaeDate(end).iso, stage, source: source(point) }] };
  }
  const date = point.date as string | undefined;
  if (!date) return { samples: [], sleep: [] };
  const start = parseHaeDate(date).iso;
  const end = point.endDate ? parseHaeDate(point.endDate as string).iso : start;
  const key = metricFromHae(name);
  if (name === 'heart_rate' && typeof point.Avg === 'number') {
    const base = { start, end, unit: 'bpm', source: source(point) };
    const out: Sample[] = [{ ...base, metric: 'hr', value: point.Avg as number }];
    if (typeof point.Min === 'number') out.push({ ...base, metric: 'hrMin', value: point.Min });
    if (typeof point.Max === 'number') out.push({ ...base, metric: 'hrMax', value: point.Max });
    return { samples: out, sleep: [] };
  }
  const raw = typeof point.qty === 'number' ? point.qty : typeof point.Avg === 'number' ? point.Avg : null;
  if (raw === null) return { samples: [], sleep: [] };
  if (!key) return { samples: [{ metric: `hae:${name}`, start, end, value: raw, unit: units, source: source(point) }], sleep: [] };
  const unit = METRICS[key].unit;
  const converted = convert(raw, units, unit);
  return {
    samples: [{ metric: key, start, end, value: converted ?? raw, unit: converted === null ? units : unit, source: source(point) }],
    sleep: [],
  };
}

export function sportFromName(name: string): Sport {
  const n = name.toLowerCase();
  if (n.includes('run')) return 'run';
  if (n.includes('cycl') || n.includes('bik')) return 'ride';
  if (n.includes('hik')) return 'hike';
  if (n.includes('walk')) return 'walk';
  if (n.includes('swim')) return 'swim';
  if (n.includes('strength')) return 'strength';
  if (n.includes('high intensity') || n.includes('hiit')) return 'hiit';
  return 'other';
}

const qty = (v: unknown): { qty: number; units: string } | null =>
  v && typeof v === 'object' && typeof (v as { qty?: unknown }).qty === 'number' ? (v as { qty: number; units: string }) : null;

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8; const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad; const dLon = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function normalizeWorkout(w: Record<string, unknown>): { record: WorkoutRecord; streams: Streams | null; samples: Sample[] } {
  const start = parseHaeDate(w.start as string);
  const end = parseHaeDate(w.end as string);
  const startMs = Date.parse(start.iso);
  const durationS = typeof w.duration === 'number' ? w.duration : (Date.parse(end.iso) - startMs) / 1000;
  const dist = qty(w.distance);
  const energy = qty(w.activeEnergyBurned) ?? qty(w.activeEnergy);
  const elev = qty(w.elevationUp);
  const hrSummary = (w.heartRate ?? {}) as Record<string, unknown>;
  const avgHr = qty(hrSummary.avg) ?? qty(w.avgHeartRate);
  const maxHr = qty(hrSummary.max) ?? qty(w.maxHeartRate);
  const name = String(w.name ?? 'Workout');
  const record: WorkoutRecord = {
    source: 'apple',
    sourceId: String(w.id ?? `${name}-${start.iso}`),
    sport: sportFromName(name),
    start: start.iso,
    end: end.iso,
    tzOffsetMin: start.offsetMin,
    durationS,
    name,
  };
  if (dist) record.distanceM = (convert(dist.qty, dist.units, 'm') ?? dist.qty * 1000);
  if (energy) record.energyKcal = convert(energy.qty, energy.units, 'kcal') ?? energy.qty;
  if (elev) record.elevGainM = convert(elev.qty, elev.units, 'm') ?? elev.qty;
  if (avgHr) record.avgHr = avgHr.qty;
  if (maxHr) record.maxHr = maxHr.qty;
  if (record.distanceM !== undefined) record.distanceM = Math.round(record.distanceM * 1000) / 1000;

  const hrPts = (Array.isArray(w.heartRateData) ? w.heartRateData : []) as Record<string, unknown>[];
  const hr = hrPts
    .map((p) => ({ t: (Date.parse(parseHaeDate(p.date as string).iso) - startMs) / 1000, v: (p.Avg ?? p.qty) as number }))
    .filter((p) => typeof p.v === 'number')
    .sort((a, b) => a.t - b.t);
  const route = (Array.isArray(w.route) ? w.route : []) as Record<string, unknown>[];

  let streams: Streams | null = null;
  if (route.length > 1) {
    const time: number[] = []; const latlng: [number, number][] = []; const altitude: number[] = [];
    const speed: number[] = []; const distance: number[] = [];
    let cum = 0;
    for (const p of route) {
      const ll: [number, number] = [Number(p.latitude ?? p.lat), Number(p.longitude ?? p.lon)];
      if (latlng.length) cum += haversineM(latlng[latlng.length - 1], ll);
      time.push((Date.parse(parseHaeDate(p.timestamp as string).iso) - startMs) / 1000);
      latlng.push(ll); altitude.push(Number(p.altitude ?? 0)); speed.push(Number(p.speed ?? 0)); distance.push(cum);
    }
    streams = { time, latlng, altitude, speed, distance };
    if (hr.length) {
      let j = 0;
      streams.heartrate = time.map((t) => {
        while (j < hr.length - 1 && hr[j + 1].t <= t) j++;
        return hr[j].v;
      });
    }
  } else if (hr.length) {
    streams = { time: hr.map((p) => p.t), heartrate: hr.map((p) => p.v) };
  }
  return { record, streams, samples: [] };
}
