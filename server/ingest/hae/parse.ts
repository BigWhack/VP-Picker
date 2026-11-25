import { createReadStream } from 'node:fs';
import { parser } from 'stream-json';

export type HaeItem =
  | { kind: 'metric'; name: string; units: string; point: Record<string, unknown> }
  | { kind: 'workout'; w: Record<string, unknown> };

type Token = { name: string; value?: string };
type Frame = { kind: 'obj' | 'arr'; key: string | null; index: number; target: unknown[] | Record<string, unknown> | null };
type Path = (string | number)[];

const isPoint = (p: Path) => p.length === 5 && p[0] === 'data' && p[1] === 'metrics' && p[3] === 'data' && typeof p[4] === 'number';
const isWorkout = (p: Path) => p.length === 3 && p[0] === 'data' && p[1] === 'workouts' && typeof p[2] === 'number';
const isMetric = (p: Path) => p.length === 3 && p[0] === 'data' && p[1] === 'metrics' && typeof p[2] === 'number';
const isMetricField = (p: Path) => p.length === 4 && p[0] === 'data' && p[1] === 'metrics' && (p[3] === 'name' || p[3] === 'units');

/**
 * Stream a Health Auto Export JSON file, yielding one item per metric data point and one per workout,
 * without ever holding the whole file in memory. Metric points are emitted with their metric's name and
 * units even if `name` appears after `data` in the object.
 */
export async function* parseHaeFile(path: string): AsyncGenerator<HaeItem> {
  const stream = createReadStream(path).pipe(parser.asStream({ packValues: true, streamValues: false }));
  const frames: Frame[] = [];
  let capture: { kind: 'point' | 'workout'; depth: number } | null = null;
  let metric: { name: string | null; units: string | null; buffer: Record<string, unknown>[] } | null = null;
  const out: HaeItem[] = [];

  const currentPath = (): Path => frames.map((f) => (f.kind === 'obj' ? (f.key as string) : f.index));
  const advance = () => {
    const f = frames[frames.length - 1];
    if (!f) return;
    if (f.kind === 'arr') f.index++;
    else f.key = null;
  };
  const attach = (value: unknown) => {
    const f = frames[frames.length - 1];
    if (!f || !f.target) return;
    if (f.kind === 'arr') (f.target as unknown[]).push(value);
    else (f.target as Record<string, unknown>)[f.key as string] = value;
  };
  const emitPoint = (point: Record<string, unknown>) => {
    if (!metric) return;
    if (metric.name) out.push({ kind: 'metric', name: metric.name, units: metric.units ?? '', point });
    else metric.buffer.push(point);
  };

  const onScalar = (value: unknown) => {
    const p = currentPath();
    if (capture) attach(value);
    else if (isMetricField(p) && metric && typeof value === 'string') {
      if (p[3] === 'name') {
        metric.name = value;
        for (const b of metric.buffer) out.push({ kind: 'metric', name: value, units: metric.units ?? '', point: b });
        metric.buffer = [];
      } else metric.units = value;
    }
    advance();
  };

  const onStart = (kind: 'obj' | 'arr') => {
    const p = currentPath();
    const container = kind === 'obj' ? {} : [];
    let target: Frame['target'] = null;
    if (capture) { attach(container); target = container; }
    else if (isPoint(p) || isWorkout(p)) {
      capture = { kind: isPoint(p) ? 'point' : 'workout', depth: frames.length };
      target = container;
    } else if (isMetric(p) && kind === 'obj') metric = { name: null, units: null, buffer: [] };
    frames.push({ kind, key: null, index: 0, target });
  };

  const onEnd = () => {
    const f = frames.pop()!;
    if (capture && frames.length === capture.depth) {
      const value = f.target as Record<string, unknown>;
      if (capture.kind === 'point') emitPoint(value);
      else out.push({ kind: 'workout', w: value });
      capture = null;
    } else if (!capture && metric && isMetric(currentPath()) && f.kind === 'obj') {
      metric = null;
    }
    advance();
  };

  for await (const t of stream as AsyncIterable<Token>) {
    switch (t.name) {
      case 'startObject': onStart('obj'); break;
      case 'startArray': onStart('arr'); break;
      case 'endObject': case 'endArray': onEnd(); break;
      case 'keyValue': frames[frames.length - 1].key = t.value as string; break;
      case 'stringValue': onScalar(t.value); break;
      case 'numberValue': onScalar(Number(t.value)); break;
      case 'nullValue': onScalar(null); break;
      case 'trueValue': onScalar(true); break;
      case 'falseValue': onScalar(false); break;
    }
    while (out.length) yield out.shift()!;
  }
}
