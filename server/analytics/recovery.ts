import type { Baseline } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { robustZ } from './baseline.js';
import { clamp } from './stats.js';

export interface RecoveryInput {
  hrv: number | null; rhr: number | null; asleepMin: number | null; needMin: number; resp: number | null; tsb: number | null;
  baselines: { hrv: Baseline | null; rhr: Baseline | null; resp: Baseline | null; tsb: Baseline | null };
}
export type RecoveryKey = 'hrv' | 'rhr' | 'sleep' | 'resp' | 'form';
export interface RecoveryComponent { key: RecoveryKey; value: number | null; z: number | null; weight: number; contribution: number | null; missing: boolean }
export interface RecoveryResult { score: number | null; band: 'well' | 'moderate' | 'low' | null; components: RecoveryComponent[] }

export function recoveryScore(i: RecoveryInput): RecoveryResult {
  const W = CONFIG.recovery.weights;
  const zOf = (v: number | null, b: Baseline | null, f: (z: number) => number) => (v === null || !b ? null : f(robustZ(v, b)));
  const raw: { key: RecoveryKey; value: number | null; z: number | null; weight: number }[] = [
    { key: 'hrv', value: i.hrv, z: zOf(i.hrv, i.baselines.hrv, (z) => z), weight: W.hrv },
    { key: 'rhr', value: i.rhr, z: zOf(i.rhr, i.baselines.rhr, (z) => -z), weight: W.rhr },
    { key: 'sleep', value: i.asleepMin,
      z: i.asleepMin === null ? null : clamp((i.asleepMin / i.needMin - 1) / 0.1 * CONFIG.recovery.sleepZPerTenPct, -3, 3), weight: W.sleep },
    { key: 'resp', value: i.resp, z: zOf(i.resp, i.baselines.resp, (z) => -Math.abs(z)), weight: W.resp },
    { key: 'form', value: i.tsb, z: zOf(i.tsb, i.baselines.tsb, (z) => z), weight: W.form },
  ];
  const present = raw.filter((c) => c.z !== null);
  const wsum = present.reduce((a, c) => a + c.weight, 0);
  const primaryMissing = raw[0].z === null && raw[1].z === null;
  const components: RecoveryComponent[] = raw.map((c) => ({
    ...c, missing: c.z === null,
    contribution: c.z === null || wsum === 0 ? null : (c.weight * (c.z as number) / wsum) * CONFIG.recovery.scale,
  }));
  if (primaryMissing || wsum === 0) return { score: null, band: null, components };
  const wz = present.reduce((a, c) => a + c.weight * (c.z as number), 0) / wsum;
  const score = Math.round(clamp(50 + CONFIG.recovery.scale * wz, 0, 100));
  const band = score >= CONFIG.recovery.bands.well ? 'well' : score >= CONFIG.recovery.bands.moderate ? 'moderate' : 'low';
  return { score, band, components };
}
