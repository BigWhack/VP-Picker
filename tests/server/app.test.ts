import { describe, it, expect } from 'vitest';
import { buildApp } from '../../server/app.js';

describe('app', () => {
  it('GET /api/health returns ok', async () => {
    const app = buildApp({ db: undefined as never, settings: () => undefined as never });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
