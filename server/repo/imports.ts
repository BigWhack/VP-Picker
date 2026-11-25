import type { Db } from '../db/client.js';

export interface ImportRow { source: string; path: string; hash: string; status: 'ok' | 'error'; error?: string }

export function isImported(db: Db, hash: string): boolean {
  return !!db.prepare(`SELECT 1 FROM imports WHERE hash = ? AND status = 'ok'`).get(hash);
}

export function recordImport(db: Db, row: ImportRow, now = new Date()): void {
  db.prepare(`INSERT INTO imports (source, path, hash, received_at, status, error) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(hash) DO UPDATE SET status = excluded.status, error = excluded.error, received_at = excluded.received_at`)
    .run(row.source, row.path, row.hash, now.toISOString(), row.status, row.error ?? null);
}

export function listImports(db: Db, limit = 50): (ImportRow & { receivedAt: string })[] {
  return db.prepare(`SELECT source, path, hash, status, error, received_at AS receivedAt FROM imports ORDER BY id DESC LIMIT ?`).all(limit) as never;
}

export function importCount(db: Db, source: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM imports WHERE source = ? AND status = 'ok'`).get(source) as { c: number }).c;
}
