import type { Baseline, DailyRow } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { fmtDuration, sleepPhrase } from '../../shared/format.js';
import type { RecoveryResult, RecoveryComponent } from './recovery.js';

export type FlagKind = 'rhr_elevated' | 'resp_elevated' | 'hrv_low' | 'sleep_debt' | 'ramping';
export interface Flag { kind: FlagKind; severity: 'info' | 'warn'; text: string }

const val = (r: DailyRow | undefined, k: string) => (r && typeof r[k] === 'number' ? (r[k] as number) : null);

/** Non-medical warning flags. `recentDaily` is ascending by date; the last row is today. */
export function computeFlags(recentDaily: DailyRow[], baselines: Record<string, Baseline | null | undefined>, debtMin: number, acwr: number | null): Flag[] {
  const F = CONFIG.flags; const out: Flag[] = [];
  const last = (n: number) => recentDaily.slice(-n);
  const rhrB = baselines.rhr;
  if (rhrB) {
    const days = last(F.rhrDays);
    if (days.length === F.rhrDays && days.every((d) => (val(d, 'rhr') ?? -Infinity) >= rhrB.median + F.rhrDelta)) {
      out.push({ kind: 'rhr_elevated', severity: 'warn',
        text: `Resting heart rate has been ${F.rhrDelta}+ bpm above your usual for ${F.rhrDays} days — your body may be under extra strain.` });
    }
  }
  const respB = baselines.resp; const today = recentDaily[recentDaily.length - 1];
  if (respB && (val(today, 'resp') ?? -Infinity) >= respB.median + F.respDelta) {
    out.push({ kind: 'resp_elevated', severity: 'warn', text: 'Breathing rate overnight was higher than your usual. Worth taking it easy if you feel run down.' });
  }
  const hrvB = baselines.hrv;
  if (hrvB) {
    const days = last(F.hrvLowDays);
    const hv = (d: DailyRow) => val(d, 'hrvNight') ?? val(d, 'hrv');
    if (days.length === F.hrvLowDays && days.every((d) => { const v = hv(d); return v !== null && v < hrvB.low; })) {
      out.push({ kind: 'hrv_low', severity: 'warn', text: `HRV has been below your usual range for ${F.hrvLowDays} days. Prioritise sleep and easier sessions.` });
    }
  }
  if (debtMin > F.debtMin) {
    out.push({ kind: 'sleep_debt', severity: 'info', text: `You're carrying about ${fmtDuration(debtMin)} of sleep debt over the last two weeks.` });
  }
  if (acwr !== null && acwr > CONFIG.load.acwrFlag) {
    out.push({ kind: 'ramping', severity: 'warn', text: `Your training load is ramping fast (this week is ${acwr.toFixed(1)}× your recent average).` });
  }
  return out;
}

const COPY = {
  well: ["You're well recovered", 'A good day to train hard.'],
  moderate: ["You're moderately recovered", 'Keep today steady.'],
  low: ['Recovery is low', 'Take it easy today.'],
} as const;

function sentence(c: RecoveryComponent, ctx: { baselines?: Record<string, Baseline | null | undefined>; needMin?: number }): string | null {
  const b = ctx.baselines?.[c.key === 'form' ? 'tsb' : c.key];
  if (c.value === null) return null;
  switch (c.key) {
    case 'hrv': {
      if (!b || b.median === 0) return null;
      const pct = Math.round(((c.value - b.median) / b.median) * 100);
      if (pct === 0) return 'HRV is right on your 30-day baseline.';
      return `HRV is ${Math.abs(pct)}% ${pct > 0 ? 'above' : 'below'} your 30-day baseline.`;
    }
    case 'rhr':
      if (!b) return null;
      if (c.value <= b.low) return 'Resting heart rate is at the low end of your range.';
      if (c.value >= b.high) return 'Resting heart rate is higher than your usual.';
      return 'Resting heart rate is within your usual range.';
    case 'sleep': {
      if (!ctx.needMin) return null;
      const diff = Math.round(c.value - ctx.needMin);
      if (Math.abs(diff) < 5) return 'You slept about as much as you need.';
      const amount = Math.abs(diff) >= 60 ? fmtDuration(Math.abs(diff)) : `${Math.abs(diff)} minutes`;
      return `You slept ${amount} ${diff < 0 ? 'less' : 'more'} than you need.`;
    }
    case 'resp':
      return b && c.value >= b.high ? 'Breathing rate overnight was higher than usual.' : 'Breathing rate overnight was normal.';
    case 'form':
      return c.value < 0 ? 'Recent training has left you a little fatigued.' : "You're fresh from recent training.";
  }
}

export function headline(r: RecoveryResult, asleepMin: number | null,
  ctx: { baselines?: Record<string, Baseline | null | undefined>; needMin?: number } = {}): { headline: string; detail: string } {
  if (r.score === null || r.band === null) return { headline: 'Not enough data yet to judge recovery.', detail: '' };
  const [lead, advice] = COPY[r.band];
  const h = asleepMin !== null && asleepMin > 0 ? `${lead} after ${sleepPhrase(asleepMin)} of sleep. ${advice}` : `${lead}. ${advice}`;
  const top = r.components.filter((c) => c.contribution !== null)
    .sort((a, b) => Math.abs(b.contribution as number) - Math.abs(a.contribution as number)).slice(0, 2);
  const detail = top.map((c) => sentence(c, ctx)).filter(Boolean).join(' ');
  return { headline: h, detail };
}
