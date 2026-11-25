import { describe, it, expect } from 'vitest';
import { fmtDuration, fmtPace, fmtKm, fmtDay, sleepPhrase } from '../../shared/format.js';

describe('format', () => {
  it('formats durations', () => {
    expect(fmtDuration(424)).toBe('7h 04m');
    expect(fmtDuration(18)).toBe('18m');
  });
  it('formats pace and distance', () => {
    expect(fmtPace(307)).toBe('5:07 /km');
    expect(fmtKm(10234)).toBe('10.2 km');
  });
  it('formats a day in the owner time zone', () => {
    expect(fmtDay('2026-11-24T07:00:00Z', 'Europe/London')).toBe('Tue 24 Nov');
  });
  it('phrases sleep length for the headline', () => {
    expect(sleepPhrase(424)).toBe('7 hours');
    expect(sleepPhrase(452)).toBe('7½ hours');
    expect(sleepPhrase(468)).toBe('nearly 8 hours');
  });
});
