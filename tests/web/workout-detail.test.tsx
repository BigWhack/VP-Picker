// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkoutDetail } from '../../web/pages/WorkoutDetail';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderWith(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/workouts/apple%3As1']}>
        <Routes><Route path="/workouts/:id" element={<WorkoutDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkoutDetail', () => {
  it('renders a strength session with HR but no map or splits', async () => {
    const { container } = renderWith({
      workout: { id: 'apple:s1', name: 'Strength', sport: 'strength', start: '2026-11-19T19:00:00Z', end: '2026-11-19T19:45:00Z', durationS: 2700, avgHr: 112, maxHr: 138, energyKcal: 280, sources: ['apple'] },
      sources: ['apple'], analysis: { kind: 'generic', zones: null, load: 42, paceS: null }, streams: null, weather: null, gear: null, similar: [], prs: [], laps: null, segments: null,
    });
    expect(await screen.findByText('Strength')).toBeTruthy();
    expect(screen.getByText('112 bpm')).toBeTruthy();
    expect(container.querySelector('[data-testid="route-map"]')).toBeNull();
    expect(container.querySelector('[data-testid="splits"]')).toBeNull();
    expect(container.querySelector('[data-testid="zones"]')).toBeNull();
  });

  it('renders splits for a run', async () => {
    const { container } = renderWith({
      workout: { id: 'strava:1', name: 'Morning run', sport: 'run', start: '2026-11-23T07:00:00Z', end: '2026-11-23T07:52:00Z', durationS: 3134, distanceM: 10200, avgHr: 148, sources: ['apple', 'strava'] },
      sources: ['apple', 'strava'], streams: null, weather: { tempC: 6.5, humidity: 85, windKmh: 12, windFromDeg: 210, precipMm: 0 }, gear: { name: 'Pegasus 41', kind: 'shoe', distanceKm: 612, warn: true },
      analysis: { kind: 'run', paceS: 307, gapPaceS: 300, decouplingPct: 6.1, decouplingFlag: true, ef: 1.3, cadenceSpm: 170, strideLengthM: 1.15, hrDriftBpm: 6,
        form: { power: 260, strideLength: null, groundContactMs: 240, vertOscCm: 8.5 }, load: 96,
        zones: { bounds: [120, 134, 148, 162, 176, 190], seconds: [300, 900, 1500, 400, 34] },
        splits: [{ km: 1, distanceKm: 1, timeS: 305, paceS: 305, gapPaceS: 300, avgHr: 140, cadenceSpm: 170, elevDeltaM: 2, avgPower: null }] },
      similar: [], prs: [{ kind: 'pr', distanceM: 5000, workoutId: 'strava:1', timeS: 1500, date: '2026-11-23' }], laps: null, segments: null,
    });
    expect(await screen.findByText('Morning run')).toBeTruthy();
    expect(container.querySelector('[data-testid="splits"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="zones"]')).not.toBeNull();
    expect(screen.getByText(/Pegasus 41/)).toBeTruthy();
    expect(screen.getByText(/New 5K PR/)).toBeTruthy();
  });
});
