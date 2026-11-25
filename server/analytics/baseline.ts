import type { Baseline } from '../../shared/types.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { quantile } from './stats.js';

/** Rolling-window baseline: median and IQR; "usual range" is median ± IQR/2. */
export function computeBaseline(values: number[], minN: number = CONFIG.baseline.minN): Baseline | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < minN) return null;
  const median = quantile(xs, 0.5);
  const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);
  return { median, iqr, low: median - iqr / 2, high: median + iqr / 2, n: xs.length };
}

/** (value − median) / (IQR / 1.35), clipped to ±3; 0 when there is no spread. */
export function robustZ(value: number, b: Baseline): number {
  if (b.iqr === 0) return 0;
  const z = (value - b.median) / (b.iqr / 1.35);
  return Math.max(-3, Math.min(3, z));
}
