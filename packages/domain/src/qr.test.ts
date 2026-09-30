import { describe, expect, it } from 'vitest';
import { signTableToken, verifyTableToken } from './qr';

const secret = 'a-test-secret-that-is-at-least-32-characters-long';
const tableId = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';

describe('table QR tokens', () => {
  it('round-trips', async () => {
    const token = await signTableToken({ tableId, version: 3 }, secret);
    expect(await verifyTableToken(token, secret)).toEqual({ tableId, version: 3 });
  });

  it('is deterministic for the same input', async () => {
    expect(await signTableToken({ tableId, version: 1 }, secret)).toBe(
      await signTableToken({ tableId, version: 1 }, secret),
    );
  });

  it('rejects a different secret', async () => {
    const token = await signTableToken({ tableId, version: 1 }, secret);
    expect(await verifyTableToken(token, 'another-secret-that-is-also-32-characters!!')).toBeNull();
  });

  it('rejects tampering with the table, the version or the signature', async () => {
    const token = await signTableToken({ tableId, version: 1 }, secret);
    const [v, id, ver, sig] = token.split('.') as [string, string, string, string];
    expect(
      await verifyTableToken([v, id.replace('3f2b', '4f2b'), ver, sig].join('.'), secret),
    ).toBeNull();
    expect(await verifyTableToken([v, id, '2', sig].join('.'), secret)).toBeNull();
    expect(
      await verifyTableToken([v, id, ver, sig.slice(0, -2) + 'AA'].join('.'), secret),
    ).toBeNull();
  });

  it.each([
    '',
    'garbage',
    'v1.x.y.z',
    'v2.a.b.c',
    `v1.${tableId}.0.abc`,
    `v1.${tableId}.1.`,
    `v1.${tableId}.1.***`,
    `v1.${tableId}.1.a.b`,
  ])('returns null (never throws) for malformed token %j', async (bad) => {
    expect(await verifyTableToken(bad, secret)).toBeNull();
  });

  it('refuses short secrets and invalid inputs when signing', async () => {
    await expect(signTableToken({ tableId, version: 1 }, 'short')).rejects.toThrow();
    await expect(signTableToken({ tableId: 'nope', version: 1 }, secret)).rejects.toThrow();
    await expect(signTableToken({ tableId, version: 0 }, secret)).rejects.toThrow();
  });
});
