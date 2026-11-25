export function Sparkline({ values, color = 'var(--good)', width = 132, height = 36, label }: { values: (number | null)[]; color?: string; width?: number; height?: number; label: string }) {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const lo = Math.min(...v); const hi = Math.max(...v); const span = hi - lo || 1;
  const pts = values.map((x, i) => (x === null ? null : `${(i / (values.length - 1)) * (width - 4) + 2},${height - 4 - ((x - lo) / span) * (height - 8)}`)).filter(Boolean).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={pts} />
    </svg>
  );
}
