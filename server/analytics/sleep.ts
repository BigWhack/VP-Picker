import type { SleepSegment } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { clamp } from './stats.js';

export interface Night { date: string; start: string; end: string; segments: SleepSegment[] }
export interface NightSummary {
  date: string; bedtime: string; wake: string; asleepMin: number; inBedMin: number; efficiency: number;
  stages: { deep: number; core: number; rem: number; awake: number }; awakenings: number;
}

const ms = (iso: string) => Date.parse(iso);
const minutes = (a: string, b: string) => (ms(b) - ms(a)) / 60000;
const isWatch = (s: SleepSegment) => /watch/i.test(s.source);
const ASLEEP = new Set(['deep', 'core', 'rem', 'asleep']);

function localParts(iso: string, tz: string): { date: string; hour: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
}

/** Group segments into sessions (gaps < 45 min merge); sessions centred in 18:00–14:00 are nights dated by wake day. */
export function assignNights(segs: SleepSegment[], tz: string): { nights: Night[]; naps: Night[] } {
  const sorted = [...segs].sort((a, b) => ms(a.start) - ms(b.start));
  const sessions: SleepSegment[][] = [];
  let cur: SleepSegment[] = []; let curEnd = -Infinity;
  const gap = CONFIG.sleep.mergeGapMin * 60000;
  for (const s of sorted) {
    if (cur.length && ms(s.start) - curEnd >= gap) { sessions.push(cur); cur = []; curEnd = -Infinity; }
    cur.push(s);
    curEnd = Math.max(curEnd, ms(s.end));
  }
  if (cur.length) sessions.push(cur);

  const candidates: Night[] = [];
  for (const raw of sessions) {
    const hasWatch = raw.some((s) => s.stage !== 'inBed' && isWatch(s));
    const segments = raw.filter((s) => s.stage === 'inBed' || !hasWatch || isWatch(s));
    const stages = segments.filter((s) => s.stage !== 'inBed');
    if (!stages.length) continue;
    const start = stages[0].start;
    const end = stages.reduce((m, s) => (ms(s.end) > ms(m) ? s.end : m), stages[0].end);
    candidates.push({ date: localParts(end, tz).date, start, end, segments });
  }

  const nights: Night[] = []; const naps: Night[] = [];
  const byDate = new Map<string, Night[]>();
  for (const n of candidates) {
    const mid = new Date((ms(n.start) + ms(n.end)) / 2).toISOString();
    const h = localParts(mid, tz).hour;
    if (h >= CONFIG.sleep.nightStartHour || h < CONFIG.sleep.nightEndHour) {
      const list = byDate.get(n.date) ?? [];
      list.push(n); byDate.set(n.date, list);
    } else naps.push(n);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => asleepOf(b) - asleepOf(a));
    nights.push(list[0]);
    naps.push(...list.slice(1));
  }
  nights.sort((a, b) => a.date.localeCompare(b.date));
  naps.sort((a, b) => ms(a.start) - ms(b.start));
  return { nights, naps };
}

const asleepOf = (n: Night) => n.segments.filter((s) => ASLEEP.has(s.stage)).reduce((a, s) => a + minutes(s.start, s.end), 0);

function unionMinutes(segs: SleepSegment[]): number {
  const iv = segs.map((s) => [ms(s.start), ms(s.end)]).sort((a, b) => a[0] - b[0]);
  let total = 0; let cs = -Infinity; let ce = -Infinity;
  for (const [s, e] of iv) {
    if (s > ce) { if (ce > cs) total += ce - cs; cs = s; ce = e; } else ce = Math.max(ce, e);
  }
  if (ce > cs) total += ce - cs;
  return total / 60000;
}

export function summarizeNight(n: Night): NightSummary {
  const stagesSegs = n.segments.filter((s) => s.stage !== 'inBed').sort((a, b) => ms(a.start) - ms(b.start));
  const stages = { deep: 0, core: 0, rem: 0, awake: 0 };
  let asleepMin = 0;
  for (const s of stagesSegs) {
    const m = minutes(s.start, s.end);
    if (s.stage in stages) stages[s.stage as keyof typeof stages] += m;
    if (ASLEEP.has(s.stage)) asleepMin += m;
  }
  let awakenings = 0;
  stagesSegs.forEach((s, i) => {
    if (s.stage !== 'awake' || minutes(s.start, s.end) < 2) return;
    const before = stagesSegs.slice(0, i).some((x) => ASLEEP.has(x.stage));
    const after = stagesSegs.slice(i + 1).some((x) => ASLEEP.has(x.stage));
    if (before && after) awakenings++;
  });
  const inBed = n.segments.filter((s) => s.stage === 'inBed');
  const inBedMin = inBed.length ? unionMinutes(inBed) : minutes(n.start, n.end);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    date: n.date, bedtime: n.start, wake: n.end, asleepMin: round(asleepMin), inBedMin: round(inBedMin),
    efficiency: inBedMin > 0 ? Math.min(1, asleepMin / inBedMin) : 0,
    stages: { deep: round(stages.deep), core: round(stages.core), rem: round(stages.rem), awake: round(stages.awake) },
    awakenings,
  };
}

/** Σ(need − asleep), each surplus night repaying at most `surplusCapMin`, floored at 0. */
export function sleepDebt(asleepMin: number[], needMin: number): number {
  const total = asleepMin.reduce((a, s) => a + Math.max(needMin - s, -CONFIG.sleep.surplusCapMin), 0);
  return Math.max(0, total);
}

/** Circular standard deviation, in minutes, of local clock times "HH:mm" (handles midnight wrap). */
export function circularSdMin(localTimesHHmm: string[]): number {
  if (localTimesHHmm.length < 2) return 0;
  const angles = localTimesHHmm.map((t) => { const [h, m] = t.split(':').map(Number); return ((h * 60 + m) / 1440) * 2 * Math.PI; });
  const c = angles.reduce((a, x) => a + Math.cos(x), 0) / angles.length;
  const s = angles.reduce((a, x) => a + Math.sin(x), 0) / angles.length;
  const R = Math.min(1, Math.sqrt(c * c + s * s));
  if (R <= 0) return 720;
  return Math.sqrt(-2 * Math.log(R)) * (1440 / (2 * Math.PI));
}

/** Sleep-schedule regularity: the average of the circular SDs of bedtimes and wake times (minutes). */
export function regularitySdMin(beds: string[], wakes: string[]): number {
  return (circularSdMin(beds) + circularSdMin(wakes)) / 2;
}

export function sleepScore(i: { asleepMin: number; needMin: number; efficiency: number; restorativeShare: number;
  baselineRestorativeShare: number | null; regularitySdMin: number | null }): { score: number; components: Record<string, number> } {
  const c = CONFIG.sleepScore;
  const components = {
    duration: c.duration * Math.min(1, i.asleepMin / i.needMin),
    efficiency: c.efficiency * clamp((i.efficiency - c.effFloor) / (c.effFull - c.effFloor), 0, 1),
    restorative: i.baselineRestorativeShare ? c.restorative * clamp(i.restorativeShare / i.baselineRestorativeShare, 0, 1) : c.restorative,
    regularity: i.regularitySdMin === null ? c.regularity
      : c.regularity * clamp(1 - (i.regularitySdMin - c.sdFullMin) / (c.sdZeroMin - c.sdFullMin), 0, 1),
  };
  const score = Math.round(Object.values(components).reduce((a, b) => a + b, 0));
  return { score, components };
}
