import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../db/client.js';
import type { Sample, SleepSegment } from '../../../shared/types.js';
import { parseHaeFile } from './parse.js';
import { normalizeMetric, normalizeWorkout } from './normalize.js';
import { listJsonFiles } from './folder.js';
import { upsertSamples } from '../../repo/samples.js';
import { upsertSleep } from '../../repo/sleep.js';
import { upsertRecord } from '../../repo/workouts.js';
import { isImported, recordImport } from '../../repo/imports.js';
import { getSettings } from '../../repo/settings.js';

export interface HaeImportResult { files: number; samples: number; sleep: number; workouts: number; errors: string[]; affectedDates: string[] }

const BATCH = 5000;

export function localDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

async function importFile(db: Db, file: string, tz: string, dates: Set<string>) {
  let samples: Sample[] = []; let sleep: SleepSegment[] = [];
  const counts = { samples: 0, sleep: 0, workouts: 0 };
  const flush = () => {
    db.transaction(() => {
      counts.samples += upsertSamples(db, samples);
      counts.sleep += upsertSleep(db, sleep);
    })();
    samples = []; sleep = [];
  };
  // Each batch is written in its own short synchronous transaction, so no transaction stays open across an
  // await (which would swallow unrelated writes made meanwhile). Writes are idempotent upserts, so a file that
  // fails part-way is simply re-imported on a later scan.
  for await (const item of parseHaeFile(file)) {
    if (item.kind === 'metric') {
      const n = normalizeMetric(item.name, item.units, item.point);
      samples.push(...n.samples); sleep.push(...n.sleep);
      for (const s of n.samples) dates.add(localDate(s.start, tz));
      for (const s of n.sleep) dates.add(localDate(s.end, tz));
    } else {
      const n = normalizeWorkout(item.w);
      upsertRecord(db, n.record, item.w.route ? { ...item.w, route: undefined, heartRateData: undefined } : item.w, n.streams);
      samples.push(...n.samples);
      dates.add(localDate(n.record.start, tz));
      counts.workouts++;
    }
    if (samples.length + sleep.length >= BATCH) flush();
  }
  flush();
  return counts;
}

const hashFile = (file: string) => new Promise<string>((res, rej) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej);
});

/** path → "size:mtime" of files already imported in this process, so unchanged files aren't re-hashed every sync. */
const seen = new Map<string, string>();

/**
 * Import every new HAE JSON file in `folder`. Already-imported files (by content hash) are skipped.
 * With `deleteAfterImport` (the REST inbox) files are removed once imported; a raw copy is kept in rawDir.
 */
export async function importHaeFolder(db: Db, folder: string, rawDir: string, opts: { deleteAfterImport?: boolean } = {}): Promise<HaeImportResult> {
  const tz = getSettings(db).tz;
  const result: HaeImportResult = { files: 0, samples: 0, sleep: 0, workouts: 0, errors: [], affectedDates: [] };
  const dates = new Set<string>();
  mkdirSync(join(rawDir, 'hae'), { recursive: true });
  for (const file of listJsonFiles(folder)) {
    let hash: string; let stamp: string;
    try { const st = statSync(file); stamp = `${st.size}:${st.mtimeMs}`; } catch { continue; }
    if (seen.get(file) === stamp) continue;
    try { hash = await hashFile(file); } catch { continue; }
    if (isImported(db, hash)) {
      seen.set(file, stamp);
      if (opts.deleteAfterImport) try { unlinkSync(file); } catch { /* already gone */ }
      continue;
    }
    try {
      const c = await importFile(db, file, tz, dates);
      copyFileSync(file, join(rawDir, 'hae', `${hash}.json`));
      recordImport(db, { source: 'hae', path: file, hash, status: 'ok' });
      seen.set(file, stamp);
      if (opts.deleteAfterImport) try { unlinkSync(file); } catch { /* already gone */ }
      result.files++; result.samples += c.samples; result.sleep += c.sleep; result.workouts += c.workouts;
    } catch (e) {
      const msg = `${file}: ${(e as Error).message}`;
      result.errors.push(msg);
      recordImport(db, { source: 'hae', path: file, hash, status: 'error', error: (e as Error).message });
    }
  }
  result.affectedDates = [...dates].sort();
  return result;
}
