import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { CONFIG } from '../../shared/analytics-config.js';
import { listWorkouts } from '../repo/workouts.js';
import { getSettings } from '../repo/settings.js';
import { localDate } from '../analytics/dates.js';

/** A shoe added in Settings. distanceM holds the starting distance (what it had done before being added). */
export interface LocalShoe { id: string; name: string; startM: number; inUseFrom: string; retiredFrom: string | null }

export function listLocalShoes(db: Db): LocalShoe[] {
  return db.prepare(`SELECT id, name, distance_m AS startM, in_use_from AS inUseFrom, retired_from AS retiredFrom FROM gear WHERE local = 1 ORDER BY in_use_from DESC`)
    .all() as LocalShoe[];
}

/** The shoe in use on a date: the most recently started one whose in-use period covers the date. */
export function shoeForDate(shoes: LocalShoe[], date: string): LocalShoe | null {
  const active = shoes.filter((s) => s.inUseFrom <= date && (!s.retiredFrom || date < s.retiredFrom));
  return active.sort((a, b) => b.inUseFrom.localeCompare(a.inUseFrom))[0] ?? null;
}

/** Mileage per local shoe from runs without a Strava shoe. */
export function shoeTotals(db: Db): Map<string, { distanceM: number; runs: number }> {
  const tz = getSettings(db).tz;
  const shoes = listLocalShoes(db);
  const totals = new Map(shoes.map((s) => [s.id, { distanceM: s.startM, runs: 0 }]));
  if (!shoes.length) return totals;
  for (const w of listWorkouts(db, { sport: 'run' }).items) {
    if (w.gearId || !w.distanceM) continue;
    const shoe = shoeForDate(shoes, localDate(w.start, tz));
    if (!shoe) continue;
    const t = totals.get(shoe.id)!;
    t.distanceM += w.distanceM; t.runs++;
  }
  return totals;
}

export function shoeView(s: LocalShoe, t: { distanceM: number; runs: number } | undefined) {
  const distanceKm = Math.round(((t?.distanceM ?? s.startM) / 1000) * 10) / 10;
  return { id: s.id, name: s.name, kind: 'shoe' as const, inUseFrom: s.inUseFrom, retiredFrom: s.retiredFrom, startKm: s.startM / 1000,
    distanceKm, runs: t?.runs ?? 0, warn: distanceKm >= CONFIG.gear.shoeWarnKm };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-01');
const createSchema = z.object({ name: z.string().trim().min(1, 'Give the shoe a name').max(80), inUseFrom: date, startKm: z.number().min(0).max(5000).default(0) }).strict();
const patchSchema = z.object({ name: z.string().trim().min(1).max(80), inUseFrom: date, startKm: z.number().min(0).max(5000), retiredFrom: date.nullable() }).partial().strict();

function fieldErrors(issues: z.ZodError['issues']) {
  const fields: Record<string, string> = {};
  for (const i of issues) fields[String(i.path[0] ?? '_')] = i.message;
  return { error: 'Invalid shoe', fields };
}

export function registerGearRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db } = deps;
  const view = (id: string) => {
    const s = listLocalShoes(db).find((x) => x.id === id);
    return s ? shoeView(s, shoeTotals(db).get(id)) : null;
  };

  app.get('/api/gear', async () => {
    const totals = shoeTotals(db);
    return { shoes: listLocalShoes(db).map((s) => shoeView(s, totals.get(s.id))) };
  });

  app.post('/api/gear', async (req, reply) => {
    const p = createSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send(fieldErrors(p.error.issues));
    const id = `local:${randomUUID()}`;
    db.prepare(`INSERT INTO gear (id, name, kind, distance_m, local, in_use_from) VALUES (?, ?, 'shoe', ?, 1, ?)`)
      .run(id, p.data.name, p.data.startKm * 1000, p.data.inUseFrom);
    return reply.code(201).send({ shoe: view(id) });
  });

  app.patch('/api/gear/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!listLocalShoes(db).some((s) => s.id === id)) return reply.code(404).send({ error: 'Shoe not found' });
    const p = patchSchema.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send(fieldErrors(p.error.issues));
    const d = p.data;
    if (d.name !== undefined) db.prepare(`UPDATE gear SET name = ? WHERE id = ?`).run(d.name, id);
    if (d.inUseFrom !== undefined) db.prepare(`UPDATE gear SET in_use_from = ? WHERE id = ?`).run(d.inUseFrom, id);
    if (d.startKm !== undefined) db.prepare(`UPDATE gear SET distance_m = ? WHERE id = ?`).run(d.startKm * 1000, id);
    if (d.retiredFrom !== undefined) db.prepare(`UPDATE gear SET retired_from = ? WHERE id = ?`).run(d.retiredFrom, id);
    return { shoe: view(id) };
  });

  app.delete('/api/gear/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const r = db.prepare(`DELETE FROM gear WHERE id = ? AND local = 1`).run(id);
    if (!r.changes) return reply.code(404).send({ error: 'Shoe not found' });
    return { ok: true };
  });
}
