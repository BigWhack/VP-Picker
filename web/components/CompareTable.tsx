export interface CompareRow { key: string; label: string; unit: string; better: 'up' | 'down' | 'none'; thisWeek: number | null; lastWeek: number | null }

export function fmtValue(v: number | null, unit: string): string {
  if (v === null) return '—';
  if (unit === 'min') { const m = Math.round(v); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; }
  if (unit === 'km') return `${v.toFixed(1)} km`;
  if (unit === 'steps') return Math.round(v).toLocaleString('en-GB');
  return `${Math.round(v)} ${unit}`;
}

function fmtDelta(d: number, unit: string): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `${sign}${fmtValue(Math.abs(d), unit)}`;
}

export function CompareTable({ rows, headers = ['This week', 'Last week'] }: { rows: CompareRow[]; headers?: [string, string] | string[] }) {
  return (
    <div className="scroll-x">
      <table className="compare">
        <thead><tr><th>Metric</th><th>{headers[0]}</th><th>{headers[1]}</th><th>Change</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const raw = r.thisWeek !== null && r.lastWeek !== null ? r.thisWeek - r.lastWeek : null;
            const d = raw !== null && Math.abs(raw) < (r.unit === 'km' ? 0.05 : 0.5) ? 0 : raw;
            const good = d === null || r.better === 'none' ? null : r.better === 'up' ? d >= 0 : d <= 0;
            return (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td style={{ fontWeight: 600 }}>{fmtValue(r.thisWeek, r.unit)}</td>
                <td className="muted-2">{fmtValue(r.lastWeek, r.unit)}</td>
                <td style={{ fontWeight: 600 }} className={good === null ? '' : good ? 'good-text' : 'worse-text'}>{d === null ? '—' : fmtDelta(d, r.unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
