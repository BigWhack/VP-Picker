export const RANGES = [['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['all', 'All']] as const;
export type RangeKey = (typeof RANGES)[number][0];

export function RangeTabs({ value, onChange }: { value: string; onChange: (r: RangeKey) => void }) {
  return (
    <div className="tabs" role="group" aria-label="Time range">
      {RANGES.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
