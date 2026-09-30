import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from './logger';

afterEach(() => vi.restoreAllMocks());

describe('log', () => {
  it('writes one JSON line with level, event and time', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    log('info', 'order.created', { orderId: 'o1' });
    const line = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, string>;
    expect(line).toMatchObject({ level: 'info', event: 'order.created', orderId: 'o1' });
    expect(Number.isNaN(Date.parse(line.time ?? ''))).toBe(false);
  });

  it('sends errors to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log('error', 'boom');
    expect(spy).toHaveBeenCalledOnce();
  });
});
