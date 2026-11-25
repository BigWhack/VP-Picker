import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export type Db = Database.Database;

function migrationsFolder(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'server', 'db', 'migrations');
    if (existsSync(join(dir, 'migrations', 'meta'))) return join(dir, 'migrations');
    if (existsSync(join(candidate, 'meta'))) return candidate;
    dir = dirname(dir);
  }
  return resolve('server/db/migrations');
}

/** Open (or create) the SQLite database and apply migrations. ':memory:' is allowed. */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(drizzle(db), { migrationsFolder: migrationsFolder() });
  return db;
}
