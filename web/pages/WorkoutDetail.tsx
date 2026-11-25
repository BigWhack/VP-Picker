import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api';
import { Card } from '../components/Card';
import { StreamChart, type SeriesKey } from '../components/StreamChart';
import { RouteMap } from '../components/RouteMap';
import { fmtClock, fmtDuration, fmtKm, fmtPace } from '../../shared/format';
import type { Streams } from '../../shared/types';
import { SPORT_COLOR, SPORT_LABEL } from '../sport';

interface Zones { bounds: number[]; seconds: number[] }
interface Split { km: number; distanceKm: number; timeS: number; paceS: number; gapPaceS: number | null; avgHr: number | null; cadenceSpm: number | null; elevDeltaM: number | null; avgPower: number | null }
interface Detail {
  workout: { id: string; name?: string; sport: string; start: string; durationS: number; movingS?: number; distanceM?: number; avgHr?: number; maxHr?: number; elevGainM?: number; energyKcal?: number };
  sources: string[];
  analysis: null | ({ kind: string; load: number; zones?: Zones | null } & Record<string, unknown>);
  streams: Streams | null;
  weather: { tempC: number; humidity: number; windKmh: number; windFromDeg: number; precipMm: number } | null;
  gear: { name: string; kind: string; distanceKm: number; warn: boolean } | null;
  similar: { id: string; name?: string; start: string; distanceM: number; paceS: number | null; avgHr: number | null; ef: number | null }[];
  prs: { distanceM: number; timeS: number }[];
}

const PR_LABEL: Record<number, string> = { 400: '400 m', 1000: '1 km', 1609: '1 mile', 5000: '5K', 10000: '10K', 21098: 'Half marathon', 42195: 'Marathon' };
const ZONE_COLORS = ['#6F86FF', '#3DDC97', '#C8E06B', '#FFB547', '#FF8FA3'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="tile"><p className="label">{label}</p><p className="value">{value}</p>{sub && <p className="sub">{sub}</p>}</div>;
}

function ZonesCard({ zones }: { zones: Zones }) {
  const total = zones.seconds.reduce((a, b) => a + b, 0) || 1;
  return (
    <Card title="Heart-rate zones" aside="Time in each zone" testId="zones">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {zones.seconds.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) 70px', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span className="muted-2">Z{i + 1} · {zones.bounds[i]}–{zones.bounds[i + 1]}</span>
            <div style={{ height: 10, background: 'var(--track)', borderRadius: 999 }}><div style={{ width: `${(s / total) * 100}%`, height: '100%', background: ZONE_COLORS[i], borderRadius: 999 }} /></div>
            <span><strong>{fmtDuration(s / 60)}</strong></span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RunSection({ a, d }: { a: Record<string, unknown>; d: Detail }) {
  const splits = a.splits as Split[] | null;
  const form = a.form as { power: number | null; strideLength: number | null; groundContactMs: number | null; vertOscCm: number | null };
  const dec = a.decouplingPct as number | null;
  return (
    <>
      <div className="tiles">
        {a.gapPaceS ? <Tile label="Grade-adjusted pace" value={fmtPace(a.gapPaceS as number)} sub="Effort-equivalent on the flat" /> : null}
        {dec !== null && <Tile label="Heart-rate drift (Pa:HR)" value={`${dec.toFixed(1)}%`} sub={(a.decouplingFlag as boolean) ? 'Above 5% — aerobic fitness limited this run' : 'Under 5% — well within your aerobic base'} />}
        {a.ef ? <Tile label="Efficiency factor" value={(a.ef as number).toFixed(2)} sub="Graded speed per heartbeat; higher is fitter" /> : null}
        {a.cadenceSpm ? <Tile label="Cadence" value={`${a.cadenceSpm} spm`} sub={a.strideLengthM ? `Stride ${(a.strideLengthM as number).toFixed(2)} m` : undefined} /> : null}
        {form.power !== null && <Tile label="Running power" value={`${Math.round(form.power)} W`} />}
        {form.groundContactMs !== null && <Tile label="Ground contact" value={`${Math.round(form.groundContactMs)} ms`} />}
        {form.vertOscCm !== null && <Tile label="Vertical oscillation" value={`${form.vertOscCm.toFixed(1)} cm`} />}
        {form.strideLength !== null && <Tile label="Stride length (Apple)" value={`${form.strideLength.toFixed(2)} m`} />}
      </div>
      {splits && splits.length > 0 && (
        <Card title="Splits" aside="Per kilometre" testId="splits">
          <div className="scroll-x">
            <table className="compare">
              <thead><tr><th>Km</th><th>Pace</th><th>Hill-adjusted</th><th>HR</th><th>Cadence</th><th>Elev</th>{splits.some((s) => s.avgPower) && <th>Power</th>}</tr></thead>
              <tbody>
                {splits.map((s) => {
                  const fastest = Math.min(...splits.filter((x) => x.distanceKm > 0.5).map((x) => x.paceS));
                  return (
                    <tr key={s.km}>
                      <td>{s.distanceKm < 0.99 ? `${s.km} (${s.distanceKm.toFixed(2)})` : s.km}</td>
                      <td style={{ fontWeight: 600 }} className={s.paceS === fastest ? 'good-text' : ''}>{fmtPace(s.paceS)}</td>
                      <td className="muted-2">{s.gapPaceS ? fmtPace(s.gapPaceS) : '—'}</td>
                      <td>{s.avgHr ? Math.round(s.avgHr) : '—'}</td>
                      <td>{s.cadenceSpm ?? '—'}</td>
                      <td>{s.elevDeltaM !== null ? `${s.elevDeltaM > 0 ? '+' : ''}${Math.round(s.elevDeltaM)} m` : '—'}</td>
                      {splits.some((x) => x.avgPower) && <td>{s.avgPower ? `${Math.round(s.avgPower)} W` : '—'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {d.similar.length > 0 && (
        <Card title="Compared with similar runs" aside="±10% distance, last 90 days">
          <div className="scroll-x">
            <table className="compare">
              <thead><tr><th>Run</th><th>Distance</th><th>Pace</th><th>HR</th><th>Efficiency</th></tr></thead>
              <tbody>
                <tr><td><strong>This run</strong></td><td>{fmtKm(d.workout.distanceM ?? 0)}</td><td style={{ fontWeight: 600 }}>{a.paceS ? fmtPace(a.paceS as number) : '—'}</td><td>{d.workout.avgHr ? Math.round(d.workout.avgHr) : '—'}</td><td>{a.ef ? (a.ef as number).toFixed(2) : '—'}</td></tr>
                {d.similar.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/workouts/${encodeURIComponent(r.id)}`}>{new Date(r.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Link></td>
                    <td className="muted-2">{fmtKm(r.distanceM)}</td><td className="muted-2">{r.paceS ? fmtPace(r.paceS) : '—'}</td>
                    <td className="muted-2">{r.avgHr ? Math.round(r.avgHr) : '—'}</td><td className="muted-2">{r.ef ? r.ef.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function RideSection({ a, weather }: { a: Record<string, unknown>; weather: Detail['weather'] }) {
  const climbs = a.climbs as { startKm: number; lengthM: number; gainM: number; avgGrade: number; vamMh: number | null }[];
  const wind = a.wind as { head: number; tail: number; cross: number } | null;
  const power = a.power as { avgW: number | null; npW: number | null; intensity: number | null; tss: number | null } | null;
  return (
    <>
      <div className="tiles">
        {wind && weather && <Tile label="Headwind share" value={`${Math.round(wind.head * 100)}%`} sub={`Tailwind ${Math.round(wind.tail * 100)}% · cross ${Math.round(wind.cross * 100)}%`} />}
        {a.efficiency ? <Tile label="Efficiency" value={(a.efficiency as number).toFixed(3)} sub="km/h per bpm (terrain-dependent)" /> : null}
        {a.decouplingPct !== null && a.decouplingPct !== undefined && <Tile label="Heart-rate drift" value={`${(a.decouplingPct as number).toFixed(1)}%`} />}
        {a.cadenceRpm ? <Tile label="Cadence" value={`${Math.round(a.cadenceRpm as number)} rpm`} /> : null}
        {power?.avgW ? <Tile label="Average power" value={`${Math.round(power.avgW)} W`} sub={power.npW ? `Normalised ${Math.round(power.npW)} W` : undefined} /> : null}
        {power?.tss ? <Tile label="Training stress (TSS)" value={`${Math.round(power.tss)}`} sub={power.intensity ? `Intensity ${power.intensity.toFixed(2)}` : undefined} /> : null}
      </div>
      {climbs.length > 0 && (
        <Card title="Climbs" aside="≥ 3% for ≥ 500 m">
          <div className="scroll-x">
            <table className="compare">
              <thead><tr><th>From km</th><th>Length</th><th>Gain</th><th>Gradient</th><th>VAM</th></tr></thead>
              <tbody>{climbs.map((c) => (
                <tr key={c.startKm}><td>{c.startKm.toFixed(1)}</td><td>{(c.lengthM / 1000).toFixed(2)} km</td><td>{Math.round(c.gainM)} m</td><td>{(c.avgGrade * 100).toFixed(1)}%</td><td>{c.vamMh ? `${Math.round(c.vamMh)} m/h` : '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

export function WorkoutDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useApi<Detail>(`/api/workouts/${encodeURIComponent(id)}`);
  if (isLoading) return <p className="empty">Loading…</p>;
  if (error || !data) return <p className="empty">Workout not found. <Link to="/workouts">Back to workouts</Link></p>;
  const w = data.workout; const a = data.analysis;
  const moving = w.movingS ?? w.durationS;
  const s = data.streams;
  const series: SeriesKey[] = w.sport === 'run' || w.sport === 'walk' || w.sport === 'hike' ? ['pace', 'hr', 'elevation', 'cadence', 'power'] : w.sport === 'ride' ? ['speed', 'hr', 'elevation', 'power', 'cadence'] : ['hr'];
  return (
    <>
      <div>
        <Link to="/workouts" className="small">← Workouts</Link>
        <p className="eyebrow" style={{ marginTop: 12 }}><span style={{ color: SPORT_COLOR[w.sport] }}>●</span> {SPORT_LABEL[w.sport]} · {new Date(w.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {new Date(w.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
        <h1 className="headline">{w.name ?? SPORT_LABEL[w.sport]}</h1>
        <p className="small muted" style={{ margin: '6px 0 0' }}>From {data.sources.map((x) => (x === 'apple' ? 'Apple Watch' : 'Strava')).join(' + ')}</p>
      </div>
      {data.prs.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{data.prs.map((p) => <span key={p.distanceM} className="pill good">🏅 New {PR_LABEL[Math.round(p.distanceM)] ?? `${p.distanceM} m`} PR · {fmtClock(p.timeS)}</span>)}</div>}
      <div className="tiles">
        {w.distanceM ? <Tile label="Distance" value={fmtKm(w.distanceM)} /> : null}
        <Tile label={w.movingS ? 'Moving time' : 'Time'} value={fmtClock(moving)} sub={w.movingS && w.movingS !== w.durationS ? `Elapsed ${fmtClock(w.durationS)}` : undefined} />
        {w.distanceM && w.sport !== 'ride' ? <Tile label="Pace" value={fmtPace(moving / (w.distanceM / 1000))} /> : null}
        {w.distanceM && w.sport === 'ride' ? <Tile label="Speed" value={`${((w.distanceM / 1000) / (moving / 3600)).toFixed(1)} km/h`} /> : null}
        {w.avgHr ? <Tile label="Avg heart rate" value={`${Math.round(w.avgHr)} bpm`} sub={w.maxHr ? `Max ${Math.round(w.maxHr)} bpm` : undefined} /> : null}
        {w.elevGainM ? <Tile label="Elevation gain" value={`${Math.round(w.elevGainM)} m`} /> : null}
        {w.energyKcal ? <Tile label="Energy" value={`${Math.round(w.energyKcal)} kcal`} /> : null}
        {a ? <Tile label="Training load" value={`${Math.round(a.load)}`} sub="Heart-rate based (TRIMP)" /> : null}
        {data.weather && <Tile label="Weather at start" value={`${Math.round(data.weather.tempC)}°C`} sub={`Wind ${Math.round(data.weather.windKmh)} km/h from ${COMPASS[Math.round(data.weather.windFromDeg / 45) % 8]} · ${data.weather.humidity}% humidity`} />}
        {data.gear && <Tile label={data.gear.kind === 'shoe' ? 'Shoes' : 'Bike'} value={data.gear.name} sub={`${Math.round(data.gear.distanceKm)} km${data.gear.warn ? ' — nearing replacement' : ''}`} />}
      </div>
      {s?.latlng && s.latlng.length > 1 && (
        <Card title="Route" aside={s.heartrate ? 'Coloured by heart rate' : undefined}>
          <RouteMap latlng={s.latlng} colorBy={s.heartrate ?? null} label={`Map of the ${SPORT_LABEL[w.sport].toLowerCase()} route`} />
        </Card>
      )}
      {s && s.time.length > 1 && <Card title="Through the session"><StreamChart streams={s} series={series} /></Card>}
      {a?.kind === 'run' && <RunSection a={a} d={data} />}
      {a?.kind === 'ride' && <RideSection a={a} weather={data.weather} />}
      {a?.zones && <ZonesCard zones={a.zones} />}
    </>
  );
}
