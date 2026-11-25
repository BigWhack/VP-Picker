export function fmtDuration(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return `${h}h ${String(r).padStart(2, '0')}m`;
}

export function fmtClock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtPace(secPerKm: number): string {
  return `${fmtClock(secPerKm)} /km`;
}

export function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

export function fmtDay(iso: string, tz: string): string {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(d);
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(d);
  return `${wd} ${day}`;
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));
}

/** "7 hours", "7½ hours", "nearly 8 hours" for headline copy. */
export function sleepPhrase(min: number): string {
  const h = Math.floor(min / 60);
  const over = min - h * 60;
  if (over < 15) return `${h} hours`;
  if (over < 45) return `${h}½ hours`;
  return `nearly ${h + 1} hours`;
}
