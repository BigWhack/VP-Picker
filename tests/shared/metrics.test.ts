import { describe, it, expect } from 'vitest';
import { metricFromHae, METRICS } from '../../shared/metrics.js';
import { CONFIG } from '../../shared/analytics-config.js';

describe('metrics catalogue', () => {
  it('maps HAE names to metric keys', () => {
    expect(metricFromHae('heart_rate_variability')).toBe('hrv');
    expect(metricFromHae('step_count')).toBe('steps');
    expect(metricFromHae('something_new')).toBeNull();
  });
  it('declares direction for headline metrics', () => {
    expect(METRICS.rhr.better).toBe('down');
    expect(METRICS.hrv.better).toBe('up');
  });
  it('config weights sum to 100', () => {
    const w = CONFIG.recovery.weights;
    expect(w.hrv + w.rhr + w.sleep + w.resp + w.form).toBe(100);
  });
});
