import type { Streams } from '../../shared/types.js';

export const finite = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
export const avg = (xs: (number | null | undefined)[]) => { const f = finite(xs); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null; };

/** Grade as a fraction per sample: from the grade stream (percent), else derived from altitude over ~100 m. */
export function gradeSeries(s: Streams): number[] | null {
  if (s.grade && s.grade.length === s.time.length) return s.grade.map((g) => (Number.isFinite(g) ? g / 100 : 0));
  if (!s.altitude || !s.distance) return null;
  const d = s.distance; const a = s.altitude;
  return d.map((_, i) => {
    let j = i;
    while (j > 0 && d[i] - d[j] < 100) j--;
    const dd = d[i] - d[j];
    return dd > 20 ? (a[i] - a[j]) / dd : 0;
  });
}

/** Time-weighted mean of a stream over samples [from, to). */
export function timeMean(t: number[], v: number[] | undefined, from = 0, to = t.length): number | null {
  if (!v) return null;
  let sum = 0; let w = 0;
  for (let i = Math.max(1, from + 1); i < to; i++) {
    const dt = Math.min(t[i] - t[i - 1], 30);
    if (dt <= 0 || !Number.isFinite(v[i - 1])) continue;
    sum += v[i - 1] * dt; w += dt;
  }
  return w > 0 ? sum / w : null;
}

/** Speed per sample: speed stream, else derived from distance/time. */
export function speedSeries(s: Streams): number[] | null {
  if (s.speed && s.speed.length === s.time.length) return s.speed;
  if (!s.distance) return null;
  return s.distance.map((d, i) => (i === 0 ? 0 : (d - s.distance![i - 1]) / Math.max(1, s.time[i] - s.time[i - 1])));
}
