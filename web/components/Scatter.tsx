export function Scatter({ points, ariaLabel, color = 'var(--core)' }: { points: [number, number][]; ariaLabel: string; color?: string }) {
  if (points.length < 2) return null;
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => 4 + ((v - x0) / (x1 - x0 || 1)) * 192; const sy = (v: number) => 96 - ((v - y0) / (y1 - y0 || 1)) * 92;
  return (
    <svg width="100%" height="110" viewBox="0 0 200 100" preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      {points.map((p, i) => <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r="2.2" fill={color} opacity="0.75" />)}
    </svg>
  );
}
