import { fmtDuration } from '../../shared/format';

type Stages = { deep: number; core: number; rem: number; awake: number };
const ROWS: { key: keyof Stages; label: string; color: string; lessIsBetter?: boolean }[] = [
  { key: 'deep', label: 'Deep', color: 'var(--deep)' }, { key: 'core', label: 'Core', color: 'var(--core)' },
  { key: 'rem', label: 'REM', color: 'var(--rem)' }, { key: 'awake', label: 'Awake', color: 'var(--awake)', lessIsBetter: true },
];

export function StageCompare({ stages, avg }: { stages: Stages; avg: Stages }) {
  const max = Math.max(...ROWS.map((r) => Math.max(stages[r.key], avg[r.key])), 1);
  return (
    <div className="stagecmp" role="table" aria-label="Sleep stages compared with your 30-night average">
      {ROWS.map((r) => {
        const diff = Math.round(stages[r.key] - avg[r.key]);
        const good = r.lessIsBetter ? diff <= 0 : diff >= 0;
        return [
          <span key={`${r.key}-l`} className="muted-2">{r.label}</span>,
          <div key={`${r.key}-b`} className="bars" aria-hidden="true">
            <div className="now" style={{ width: `${(stages[r.key] / max) * 100}%`, background: r.color }} />
            <div className="avg" style={{ width: `${(avg[r.key] / max) * 100}%` }} />
          </div>,
          <span key={`${r.key}-v`}>
            <strong>{fmtDuration(stages[r.key])}</strong>{' '}
            {avg[r.key] > 0 && <span className={good ? 'good-text' : 'worse-text'}>{diff >= 0 ? '+' : '−'}{Math.abs(diff)}m</span>}
          </span>,
        ];
      })}
    </div>
  );
}
