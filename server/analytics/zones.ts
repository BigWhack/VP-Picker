import { gapCap } from './load.js';

/** Six zone edges (Z1 low … Z5 high) for the chosen model. */
export function hrZoneBounds(hrRest: number, hrMax: number, model: 'hrr' | 'pctMax'): number[] {
  const pcts = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return model === 'hrr'
    ? pcts.map((p) => Math.round(hrRest + p * (hrMax - hrRest)))
    : pcts.map((p) => Math.round(p * hrMax));
}

/** Seconds spent in each of 5 zones. HR below Z1 counts as Z1; above Z5 as Z5. */
export function timeInZones(t: number[], hr: number[], bounds: number[]): number[] {
  const out = [0, 0, 0, 0, 0]; const cap = gapCap(t);
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1];
    if (dt <= 0 || dt > cap) continue;
    const h = hr[i - 1];
    let z = 0;
    for (let k = 1; k < 5; k++) if (h >= bounds[k]) z = k;
    out[z] += dt;
  }
  return out;
}
