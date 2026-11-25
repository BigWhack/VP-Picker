// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Setup } from '../../web/pages/Setup';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Setup checklist', () => {
  it('leads with Health Auto Export and marks Strava as optional', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stravaConfigured: false, stravaConnected: false, haeFolder: null, haeFilesSeen: 0, backfillRemaining: 0, backfillDone: false, daysOfData: 0 }))));
    render(<QueryClientProvider client={new QueryClient()}><Setup /></QueryClientProvider>);
    const steps = await screen.findAllByRole('heading', { level: 3 });
    expect(steps[0].textContent).toMatch(/Health Auto Export/);
    expect(screen.getByText(/Strava \(optional\)/)).toBeTruthy();
    expect(screen.getByText(/Not needed/)).toBeTruthy();
  });
});
