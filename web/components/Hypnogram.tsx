import { fmtTime } from '../../shared/format';

export interface Seg { start: string; end: string; stage: string }
const ROWS = ['awake', 'rem', 'core', 'deep'] as const;
const LABEL: Record<string, string> = { awake: 'Awake', rem: 'REM', core: 'Core', deep: 'Deep' };
const COLOR: Record<string, string> = { awake: 'var(--awake)', rem: 'var(--rem)', core: 'var(--core)', deep: 'var(--deep)' };
const rowOf = (stage: string) => (stage === 'asleep' ? 'core' : stage);

export function Hypnogram({ segments, start, end, tz }: { segments: Seg[]; start: string; end: string; tz: string }) {
  const s = Date.parse(start); const span = Math.max(1, Date.parse(end) - s);
  const pos = (iso: string) => ((Date.parse(iso) - s) / span) * 100;
  const ticks: { label: string; left: number }[] = [];
  const firstHour = Math.ceil(s / 3600000 / 2) * 2 * 3600000;
  for (let t = firstHour; t < s + span; t += 2 * 3600000) {
    const left = ((t - s) / span) * 100;
    if (left > 16 && left < 84) ticks.push({ label: fmtTime(new Date(t).toISOString(), tz), left });
  }
  return (
    <div className="hypno">
      <div className="labels" style={{ height: 108 }}>{ROWS.map((r) => <span key={r}>{LABEL[r]}</span>)}</div>
      <div className="rows" role="img" aria-label={`Sleep stages from ${fmtTime(start, tz)} to ${fmtTime(end, tz)}`}>
        {ROWS.map((row) => (
          <div key={row} className="lane" data-row={row}>
            {segments.filter((g) => rowOf(g.stage) === row).map((g) => (
              <div key={g.start} data-seg className="seg"
                style={{ left: `${pos(g.start)}%`, width: `${Math.max(0.4, pos(g.end) - pos(g.start))}%`, background: COLOR[row] }} />
            ))}
          </div>
        ))}
        <div className="axis">
          <span style={{ position: 'absolute', left: 0 }}>{fmtTime(start, tz)}</span>
          {ticks.map((t) => <span key={t.label} style={{ position: 'absolute', left: `${t.left}%`, transform: 'translateX(-50%)' }}>{t.label}</span>)}
          <span style={{ position: 'absolute', right: 0 }}>{fmtTime(end, tz)}</span>
        </div>
      </div>
    </div>
  );
}
