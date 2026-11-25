export function RecoveryRing({ score, band, delta }: { score: number | null; band: 'well' | 'moderate' | 'low' | null; delta?: number | null }) {
  const r = 86; const c = 2 * Math.PI * r;
  const color = band === 'low' ? 'var(--worse)' : band === 'moderate' ? '#C8E06B' : 'var(--good)';
  return (
    <div style={{ position: 'relative', width: 200, height: 200 }}>
      <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={score === null ? 'Recovery not available yet' : `Recovery ${score} out of 100`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--track)" strokeWidth="14" />
        {score !== null && (
          <circle data-testid="arc" cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 100 100)" />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="tiny muted" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recovery</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 60, fontWeight: 600, lineHeight: 1 }}>{score === null ? '—' : score}</span>
        {delta !== undefined && delta !== null && (
          <span className={`small ${delta >= 0 ? 'good-text' : 'worse-text'}`} style={{ fontWeight: 600 }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))} on yesterday
          </span>
        )}
      </div>
    </div>
  );
}
