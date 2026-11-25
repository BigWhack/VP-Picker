import type { DailyRow } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { spearman } from './stats.js';

export interface Pattern { driver: string; outcome: string; rho: number; n: number; text: string; points: [number, number][] }

// Sleep drivers describe the night that ends on the row's date, so they pair with the same row's outcomes.
// Daytime drivers pair with the following day's outcomes.
const DRIVERS = [
  { key: 'bedtime', phrase: 'go to bed later', unit: 'nights', sameRow: true },
  { key: 'asleepMin', phrase: 'sleep longer', unit: 'nights', sameRow: true },
  { key: 'load', phrase: 'train harder', unit: 'days', sameRow: false },
  { key: 'lateWorkout', phrase: 'work out after 7pm', unit: 'days', sameRow: false },
  { key: 'steps', phrase: 'walk more', unit: 'days', sameRow: false },
] as const;
const OUTCOMES = [
  { key: 'hrv', label: 'HRV', get: (r: DailyRow) => (r.hrvNight ?? r.hrv ?? null) as number | null },
  { key: 'rhr', label: 'resting heart rate', get: (r: DailyRow) => r.rhr ?? null },
  { key: 'efficiency', label: 'sleep efficiency', get: (r: DailyRow) => r.efficiency ?? null },
  { key: 'recovery', label: 'recovery', get: (r: DailyRow) => r.recovery ?? null },
] as const;

export function findPatterns(daily: DailyRow[]): Pattern[] {
  const rows = [...daily].sort((a, b) => a.date.localeCompare(b.date)).slice(-CONFIG.patterns.windowDays - 1);
  const out: Pattern[] = [];
  for (const d of DRIVERS) for (const o of OUTCOMES) {
    if (d.key === 'asleepMin' && o.key === 'efficiency') continue;
    const points: [number, number][] = [];
    for (let i = d.sameRow ? 0 : 1; i < rows.length; i++) {
      const x = rows[d.sameRow ? i : i - 1][d.key]; const y = o.get(rows[i]);
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    }
    if (points.length < CONFIG.patterns.minN) continue;
    const rho = spearman(points.map((p) => p[0]), points.map((p) => p[1]));
    if (rho === null || Math.abs(rho) < CONFIG.patterns.minAbsRho) continue;
    const when = d.unit === 'nights' ? 'nights' : 'days';
    const rhoTxt = `${rho < 0 ? '−' : ''}${Math.abs(rho).toFixed(2)}`;
    out.push({ driver: d.key, outcome: o.key, rho, n: points.length, points,
      text: `On ${when} you ${d.phrase}, your next-day ${o.label} tends to be ${rho < 0 ? 'lower' : 'higher'} (ρ = ${rhoTxt}, ${points.length} ${when}).` });
  }
  return out.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}
