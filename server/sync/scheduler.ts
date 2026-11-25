import { CONFIG } from '../../shared/analytics-config.js';

/**
 * Ticks every 5 minutes and runs the job when the last run is more than 55 minutes old (or never ran).
 * Runs once immediately on start. Never starts a run while another is in flight. Returns a stop function.
 */
export function startScheduler(run: () => Promise<unknown>, opts: { tickMs?: number; intervalMs?: number; lastRun: () => Date | null }): () => void {
  const tickMs = opts.tickMs ?? CONFIG.sync.tickMin * 60000;
  const intervalMs = opts.intervalMs ?? CONFIG.sync.intervalMin * 60000;
  let inFlight = false;
  const tick = () => {
    if (inFlight) return;
    const last = opts.lastRun();
    if (last && Date.now() - last.getTime() < intervalMs) return;
    inFlight = true;
    Promise.resolve().then(run).catch(() => undefined).finally(() => { inFlight = false; });
  };
  const first = setTimeout(tick, 0);
  const timer = setInterval(tick, tickMs);
  return () => { clearTimeout(first); clearInterval(timer); };
}
