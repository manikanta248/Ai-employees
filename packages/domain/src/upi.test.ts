import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { buildUpiLink, isValidVpa } from './upi';

describe('isValidVpa', () => {
  it.each(['cafe.alpha@okhdfcbank', 'name-1_2@ybl', '9876543210@paytm'])('accepts %s', (v) => {
    expect(isValidVpa(v)).toBe(true);
  });
  it.each(['nohandle', 'a@', '@bank', 'has space@upi', 'x@1bank', 'a@b@c', ''])(
    'rejects %j',
    (v) => {
      expect(isValidVpa(v)).toBe(false);
    },
  );
});

describe('buildUpiLink', () => {
  const base = {
    vpa: 'cafe.alpha@okhdfcbank',
    payeeName: 'Alpha Cafe',
    amount: paise(45_050),
    reference: 'Order 12',
  };

  it('fills in payee, amount, currency and reference', () => {
    const url = new URL(buildUpiLink(base));
    expect(url.protocol).toBe('upi:');
    expect(url.searchParams.get('pa')).toBe('cafe.alpha@okhdfcbank');
    expect(url.searchParams.get('pn')).toBe('Alpha Cafe');
    expect(url.searchParams.get('am')).toBe('450.50');
    expect(url.searchParams.get('cu')).toBe('INR');
    expect(url.searchParams.get('tn')).toBe('Order 12');
  });

  it('formats amounts exactly, with two decimals', () => {
    expect(buildUpiLink({ ...base, amount: paise(100) })).toContain('am=1.00');
    expect(buildUpiLink({ ...base, amount: paise(5) })).toContain('am=0.05');
    expect(buildUpiLink({ ...base, amount: paise(1_234_567) })).toContain('am=12345.67');
  });

  it('encodes spaces as %20 and cannot be broken out of by hostile text', () => {
    const link = buildUpiLink({ ...base, payeeName: 'A&B Cafe', reference: 'x&am=1' });
    expect(link).toContain('pn=A%26B%20Cafe');
    expect(new URL(link).searchParams.get('am')).toBe('450.50');
    expect(link).not.toContain('+');
  });

  it('rejects invalid input', () => {
    expect(() => buildUpiLink({ ...base, vpa: 'bad' })).toThrow();
    expect(() => buildUpiLink({ ...base, amount: paise(0) })).toThrow();
    expect(() => buildUpiLink({ ...base, payeeName: '  ' })).toThrow();
  });
});
