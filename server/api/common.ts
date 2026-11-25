import type { AppDeps } from '../app.js';
import type { Baseline, DailyRow, Series } from '../../shared/types.js';
import { getSettings } from '../repo/settings.js';
import { localDate, dateRange, addDays } from '../analytics/dates.js';
import { mean } from '../analytics/stats.js';

export const nowOf = (deps: AppDeps) => (deps.now ?? (() => new Date()))();
export const tzOf = (deps: AppDeps) => getSettings(deps.db).tz;
export const todayOf = (deps: AppDeps) => localDate(nowOf(deps).toISOString(), tzOf(deps));

export function validDate(q: unknown, fallback: string): string {
  return typeof q === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : fallback;
}

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const hrvVal = (r: DailyRow | undefined) => (r ? num(r.hrvNight) ?? num(r.hrv) : null);

export function seriesFrom(rows: DailyRow[], from: string, to: string, value: (r: DailyRow) => number | null, band: Baseline | null | undefined): Series {
  const by = new Map(rows.map((r) => [r.date, r]));
  return {
    points: dateRange(from, to).map((d) => ({ date: d, value: by.has(d) ? value(by.get(d)!) : null })),
    band: band ? { low: band.low, high: band.high } : null,
  };
}

export function avgOf(rows: DailyRow[], f: (r: DailyRow) => number | null): number | null {
  const xs = rows.map(f).filter((v): v is number => v !== null);
  return xs.length ? mean(xs) : null;
}

export function sumOf(rows: DailyRow[], f: (r: DailyRow) => number | null): number {
  return rows.map(f).filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
}

export const minutesToHHmm = (m: number) => {
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export { addDays, dateRange };
