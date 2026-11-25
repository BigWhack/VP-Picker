// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RangeBar } from '../../web/components/RangeBar';
import { RecoveryRing } from '../../web/components/RecoveryRing';
import { Hypnogram } from '../../web/components/Hypnogram';
import { Calibrating } from '../../web/components/Calibrating';

afterEach(cleanup);

describe('RangeBar', () => {
  it('places the marker proportionally between min and max', () => {
    render(<RangeBar label="HRV" value={58} unit="ms" low={46} high={58} min={40} max={64} calibrating={false} />);
    expect(screen.getByTestId('marker').style.left).toBe('75%');
    expect(screen.getByText('HRV')).toBeTruthy();
  });
  it('shows Calibrating when there is no baseline', () => {
    render(<RangeBar label="HRV" value={58} unit="ms" low={null} high={null} calibrating />);
    expect(screen.getByText('Calibrating')).toBeTruthy();
    expect(screen.queryByTestId('marker')).toBeNull();
  });
});

describe('RecoveryRing', () => {
  it('renders a dash and no arc without a score', () => {
    const { container } = render(<RecoveryRing score={null} band={null} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(container.querySelector('[data-testid="arc"]')).toBeNull();
  });
  it('renders the score and arc', () => {
    const { container } = render(<RecoveryRing score={82} band="well" delta={7} />);
    expect(screen.getByText('82')).toBeTruthy();
    expect(container.querySelector('[data-testid="arc"]')).not.toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Recovery 82 out of 100');
  });
});

describe('Hypnogram', () => {
  it('draws one bar per segment in the matching stage row', () => {
    const segs = [
      { start: '2026-11-23T23:12:00Z', end: '2026-11-23T23:32:00Z', stage: 'core' },
      { start: '2026-11-23T23:32:00Z', end: '2026-11-24T00:17:00Z', stage: 'deep' },
      { start: '2026-11-24T00:17:00Z', end: '2026-11-24T00:22:00Z', stage: 'awake' },
      { start: '2026-11-24T00:22:00Z', end: '2026-11-24T00:50:00Z', stage: 'asleep' },
    ];
    const { container } = render(<Hypnogram segments={segs} start="2026-11-23T23:12:00Z" end="2026-11-24T00:50:00Z" tz="Europe/London" />);
    expect(container.querySelectorAll('[data-row="core"] [data-seg]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-row="deep"] [data-seg]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-row="awake"] [data-seg]')).toHaveLength(1);
  });
});

describe('Calibrating', () => {
  it('says Calibrating', () => {
    render(<Calibrating />);
    expect(screen.getByText('Calibrating')).toBeTruthy();
  });
});
