/**
 * Signed table QR tokens. A sticker encodes a URL containing the token; the server verifies the
 * signature, then checks the table is active and the version is current (so stickers can be
 * revoked by bumping `qr_version`). Uses Web Crypto so it runs in Node and on the edge.
 *
 * Token format: `v1.<tableId>.<version>.<signature>`; signature is base64url(HMAC-SHA256).
 */
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface TableToken {
  tableId: string;
  version: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const bin = atob(padded);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('QR signing secret must be at least 32 characters');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signTableToken(token: TableToken, secret: string): Promise<string> {
  if (!UUID.test(token.tableId)) throw new Error('Invalid table id');
  if (!Number.isSafeInteger(token.version) || token.version < 1) throw new Error('Invalid version');
  const payload = `v1.${token.tableId}.${token.version}`;
  const sig = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Returns the contents if the signature is valid, otherwise null. Never throws on bad input. */
export async function verifyTableToken(token: string, secret: string): Promise<TableToken | null> {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, tableId, versionText, signature] = parts as [string, string, string, string];
  if (!UUID.test(tableId) || !/^[1-9]\d{0,8}$/.test(versionText)) return null;
  const sigBytes = fromBase64Url(signature);
  if (!sigBytes) return null;
  const payload = `v1.${tableId}.${versionText}`;
  // subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify(
    'HMAC',
    await key(secret, 'verify'),
    sigBytes as BufferSource,
    encoder.encode(payload),
  );
  return ok ? { tableId, version: Number(versionText) } : null;
}
