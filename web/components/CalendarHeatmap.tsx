/** GitHub-style year heatmap: columns are weeks, rows Mon–Sun. */
export function CalendarHeatmap({ days, color = '61, 220, 151', label, unit }: { days: { date: string; value: number }[]; color?: string; label: string; unit: string }) {
  if (!days.length) return null;
  const max = Math.max(1, ...days.map((d) => d.value));
  const first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const pad = (first + 6) % 7;
  const cells = [...Array.from({ length: pad }, () => null), ...days];
  const weeks = Math.ceil(cells.length / 7);
  return (
    <div className="scroll-x" role="img" aria-label={label}>
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gridAutoFlow: 'column', gridAutoColumns: '11px', gap: 3, minWidth: weeks * 14 }}>
        {cells.map((c, i) => (
          <div key={i} title={c ? `${c.date}: ${Math.round(c.value)} ${unit}` : undefined}
            style={{ width: 11, height: 11, borderRadius: 2, background: !c ? 'transparent' : c.value <= 0 ? 'var(--track)' : `rgba(${color}, ${0.25 + 0.75 * (c.value / max)})` }} />
        ))}
      </div>
    </div>
  );
}
