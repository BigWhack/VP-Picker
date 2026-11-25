import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

const STYLE = 'https://tiles.openfreemap.org/styles/dark';

function quantileColors(values: number[]): string[] {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  const [a, b, c, d] = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const palette = ['#3346C8', '#6F86FF', '#3DDC97', '#FFB547', '#FF8FA3'];
  return values.map((v) => palette[v < a ? 0 : v < b ? 1 : v < c ? 2 : v < d ? 3 : 4]);
}

/** Route on an OpenFreeMap dark basemap, optionally coloured by HR/pace quintiles. */
export function RouteMap({ latlng, colorBy, label }: { latlng: [number, number][]; colorBy?: number[] | null; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || latlng.length < 2) return;
    let map: { remove: () => void } | null = null; let cancelled = false;
    import('maplibre-gl').then((mod) => {
      const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
      maplibregl.setWorkerUrl(workerUrl);
      if (cancelled || !ref.current) return;
      const coords = latlng.map(([la, lo]) => [lo, la] as [number, number]);
      const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      const m = new maplibregl.Map({ container: ref.current, style: STYLE, bounds, fitBoundsOptions: { padding: 30 }, attributionControl: { compact: true } });
      map = m;
      m.on('load', () => {
        const colors = colorBy && colorBy.length === coords.length ? quantileColors(colorBy) : null;
        const features = colors
          ? coords.slice(1).map((c, i) => ({ type: 'Feature' as const, properties: { color: colors[i] }, geometry: { type: 'LineString' as const, coordinates: [coords[i], c] } }))
          : [{ type: 'Feature' as const, properties: { color: '#3DDC97' }, geometry: { type: 'LineString' as const, coordinates: coords } }];
        m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features } });
        m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ['get', 'color'], 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      });
    }).catch(() => undefined);
    return () => { cancelled = true; map?.remove(); };
  }, [latlng, colorBy]);
  return <div ref={ref} data-testid="route-map" role="img" aria-label={label} style={{ height: 340, borderRadius: 14, overflow: 'hidden', background: 'var(--card-2)' }} />;
}
