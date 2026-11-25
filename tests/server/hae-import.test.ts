import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDb } from '../helpers/db.js';
import { importHaeFolder, } from '../../server/ingest/hae/importer.js';
import { discoverHaeFolder } from '../../server/ingest/hae/folder.js';
import { getSamples } from '../../server/repo/samples.js';
import { listImports } from '../../server/repo/imports.js';

const fx = (f: string) => new URL(`../fixtures/hae/${f}`, import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), 'hae-'));

function stepsFile(days: string[]): string {
  const data = days.flatMap((d) => [7, 8, 9].map((h) => ({ qty: 100 * h, date: `${d} 0${h}:00:00 +0000`, source: 'Watch' })));
  return JSON.stringify({ data: { metrics: [{ name: 'step_count', units: 'count', data }] } });
}

const daySum = (db: ReturnType<typeof testDb>, day: string) =>
  getSamples(db, 'steps', `${day}T00:00:00Z`, `${day}T23:59:59Z`).reduce((a, s) => a + s.value, 0);

describe('HAE importer', () => {
  it('imports each file once', async () => {
    const db = testDb(); const dir = tmp(); const raw = tmp();
    for (const f of ['metrics-hourly.json', 'sleep-raw.json', 'workouts.json']) copyFileSync(fx(f), join(dir, f));
    const first = await importHaeFolder(db, dir, raw);
    expect(first).toMatchObject({ files: 3, workouts: 2 });
    expect(first.samples).toBeGreaterThan(0);
    expect(first.affectedDates).toContain('2026-11-24');
    const second = await importHaeFolder(db, dir, raw);
    expect(second.files).toBe(0);
  });

  it('does not double count overlapping rolling-window exports', async () => {
    const db = testDb(); const dir = tmp(); const raw = tmp();
    writeFileSync(join(dir, 'a.json'), stepsFile(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']));
    await importHaeFolder(db, dir, raw);
    const single = daySum(db, '2026-11-22');
    writeFileSync(join(dir, 'b.json'), stepsFile(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']));
    await importHaeFolder(db, dir, raw);
    expect(single).toBe(2400);
    expect(daySum(db, '2026-11-22')).toBe(single);
  });

  it('records malformed files as errors and keeps importing others', async () => {
    const db = testDb(); const dir = tmp(); const raw = tmp();
    writeFileSync(join(dir, 'bad.json'), '{"data": {"metrics": [');
    copyFileSync(fx('metrics-hourly.json'), join(dir, 'good.json'));
    const r = await importHaeFolder(db, dir, raw);
    expect(r.errors).toHaveLength(1);
    expect(r.files).toBe(1);
    expect(listImports(db).find((i) => i.path.endsWith('bad.json'))!.status).toBe('error');
  });

  it('discovers the HAE iCloud folder', () => {
    const home = tmp();
    const target = join(home, 'Library', 'Mobile Documents', 'iCloud~com~ifunography~HealthExport', 'Documents');
    mkdirSync(target, { recursive: true });
    expect(discoverHaeFolder(home)).toBe(target);
    expect(discoverHaeFolder(tmp())).toBeNull();
  });
});
