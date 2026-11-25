// Writes a demo database with 120 days of synthetic data so the UI can be developed without real exports.
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../server/db/client.js';
import { loadEnv } from '../server/config.js';
import { seedDemo } from '../tests/helpers/seed.js';
import { recompute } from '../server/analytics/recompute.js';

const env = loadEnv();
const file = join(env.DATA_DIR, 'health.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
const db = openDb(file);
const now = new Date();
seedDemo(db, 120, now);
await recompute(db, { from: 'all', now });
console.log(`Seeded demo data into ${file}`);
