import type { Db } from '../db/client.js';
import { setWeather, getRecordStreams, type Weather } from '../repo/workouts.js';

const HOURLY = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation';

export function weatherUrl(lat: number, lon: number, startIso: string, now: Date): string {
  const day = startIso.slice(0, 10);
  const ageDays = (now.getTime() - Date.parse(startIso)) / 86400000;
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), hourly: HOURLY, timezone: 'UTC', wind_speed_unit: 'kmh' });
  if (ageDays >= 6) {
    q.set('start_date', day); q.set('end_date', day);
    return `https://archive-api.open-meteo.com/v1/archive?${q}`;
  }
  q.set('past_days', '7'); q.set('forecast_days', '1');
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

type Hourly = { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[]; wind_speed_10m: number[]; wind_direction_10m: number[]; precipitation: number[] };

export function nearestHour(h: Hourly, startIso: string): Weather | null {
  if (!h?.time?.length) return null;
  const t = Date.parse(startIso);
  let best = 0; let bestDiff = Infinity;
  h.time.forEach((s, i) => { const d = Math.abs(Date.parse(`${s}:00Z`) - t); if (d < bestDiff) { bestDiff = d; best = i; } });
  if (bestDiff > 2 * 3600000 || h.temperature_2m[best] === null) return null;
  return { tempC: h.temperature_2m[best], humidity: h.relative_humidity_2m[best], windKmh: h.wind_speed_10m[best], windFromDeg: h.wind_direction_10m[best], precipMm: h.precipitation[best] };
}

/** Decode a Google-encoded polyline into [lat, lng] pairs (5-decimal precision). */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0; let lat = 0; let lng = 0;
  const next = () => {
    let result = 0; let shift = 0; let b: number;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && index < str.length + 1);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    lat += next(); lng += next();
    out.push([Math.round(lat) / 1e5, Math.round(lng) / 1e5]);
  }
  return out;
}

/** Add start-of-workout weather to GPS workouts that don't have it yet. Returns how many were enriched. */
export async function enrichWeather(db: Db, fetchFn: typeof fetch = fetch, limit = 50, now = new Date()): Promise<number> {
  const rows = db.prepare(`SELECT id, start, polyline, apple_id, strava_id FROM workouts WHERE weather_json IS NULL ORDER BY start DESC`).all() as
    { id: string; start: string; polyline: string | null; apple_id: string | null; strava_id: string | null }[];
  let done = 0; let tried = 0;
  for (const w of rows) {
    if (tried >= limit) break;
    let point: [number, number] | undefined = w.polyline ? decodePolyline(w.polyline)[0] : undefined;
    if (!point) {
      const s = (w.strava_id && getRecordStreams(db, 'strava', w.strava_id)) || (w.apple_id && getRecordStreams(db, 'apple', w.apple_id)) || null;
      point = s?.latlng?.[0];
    }
    if (!point) continue;
    tried++;
    try {
      const res = await fetchFn(weatherUrl(point[0], point[1], w.start, now));
      if (!res.ok) continue;
      const body = (await res.json()) as { hourly: Hourly };
      const wx = nearestHour(body.hourly, w.start);
      if (wx) { setWeather(db, w.id, wx); done++; }
    } catch { /* offline or API error: try again next sync */ }
  }
  return done;
}
