import { useEffect, useRef } from 'react';
import type { Streams } from '../../shared/types';
import 'uplot/dist/uPlot.min.css';

export type SeriesKey = 'hr' | 'pace' | 'speed' | 'elevation' | 'cadence' | 'power';
const DEF: Record<SeriesKey, { label: string; color: string; get: (s: Streams) => (number | null)[] | undefined; fmt: (v: number) => string }> = {
  hr: { label: 'Heart rate', color: '#FF8FA3', get: (s) => s.heartrate, fmt: (v) => `${Math.round(v)} bpm` },
  pace: { label: 'Pace', color: '#3DDC97', get: (s) => s.speed?.map((v) => (v > 0.8 ? 1000 / v / 60 : null)), fmt: (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')} /km` },
  speed: { label: 'Speed', color: '#3DDC97', get: (s) => s.speed?.map((v) => v * 3.6), fmt: (v) => `${v.toFixed(1)} km/h` },
  elevation: { label: 'Elevation', color: '#9AA4B2', get: (s) => s.altitude, fmt: (v) => `${Math.round(v)} m` },
  cadence: { label: 'Cadence', color: '#B9C6FF', get: (s) => s.cadence, fmt: (v) => `${Math.round(v)}` },
  power: { label: 'Power', color: '#FFB547', get: (s) => s.watts, fmt: (v) => `${Math.round(v)} W` },
};

/** One small synced chart per series (uPlot), x axis = elapsed minutes. */
export function StreamChart({ streams, series }: { streams: Streams; series: SeriesKey[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const available = series.filter((k) => (DEF[k].get(streams) ?? []).some((v) => v !== null && v !== undefined));
  useEffect(() => {
    if (!ref.current || !available.length) return;
    let disposed = false; const plots: { destroy: () => void }[] = [];
    import('uplot').then(({ default: uPlot }) => {
      if (disposed || !ref.current) return;
      const x = streams.time.map((t) => t / 60);
      const width = ref.current.clientWidth || 600;
      const sync = uPlot.sync('workout');
      for (const k of available) {
        const d = DEF[k];
        const el = document.createElement('div');
        ref.current.appendChild(el);
        plots.push(new uPlot({
          width, height: 120, cursor: { sync: { key: sync.key } }, legend: { show: true },
          scales: { x: { time: false }, y: k === 'pace' ? { dir: -1 } : {} },
          axes: [
            { stroke: '#9AA4B2', grid: { stroke: '#1F2733' }, values: (_u, v) => v.map((m) => `${Math.round(m)}′`) },
            { stroke: '#9AA4B2', grid: { stroke: '#1F2733' }, size: 64, values: (_u, v) => v.map((n) => d.fmt(n).split(' ')[0]) },
          ],
          series: [{ label: 'min' , value: (_u, v) => (v == null ? '—' : `${v.toFixed(1)}′`) },
            { label: d.label, stroke: d.color, width: 1.5, value: (_u, v) => (v == null ? '—' : d.fmt(v)) }],
        }, [x, d.get(streams)! as number[]], el));
      }
    });
    return () => { disposed = true; plots.forEach((p) => p.destroy()); if (ref.current) ref.current.innerHTML = ''; };
  }, [streams, available.join(',')]);
  if (!available.length) return null;
  return <div ref={ref} className="stream-chart" role="img" aria-label={`Charts of ${available.map((k) => DEF[k].label.toLowerCase()).join(', ')} over the workout`} />;
}
