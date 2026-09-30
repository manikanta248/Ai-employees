import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/health', () => {
  it('reports ok with a timestamp and forbids caching', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { status: string; time: string };
    expect(body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
