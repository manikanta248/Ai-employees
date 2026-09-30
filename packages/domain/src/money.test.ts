import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MoneyError,
  add,
  formatRupees,
  multiply,
  paise,
  parseRupees,
  percentOf,
  subtract,
} from './money';

describe('paise()', () => {
  it('accepts integers', () => {
    expect(paise(0)).toBe(0);
    expect(paise(12_345)).toBe(12_345);
  });
  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (v) => {
    expect(() => paise(v)).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly (no float drift)', () => {
    // 0.1 + 0.2 style trap, in paise
    expect(add(paise(10), paise(20))).toBe(30);
    expect(subtract(paise(30), paise(10))).toBe(20);
  });
  it('multiplies by whole quantities only', () => {
    expect(multiply(paise(12_050), 3)).toBe(36_150);
    expect(() => multiply(paise(100), 1.5)).toThrow(MoneyError);
    expect(() => multiply(paise(100), -1)).toThrow(MoneyError);
  });
  it('add is commutative and associative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 0, max: 1e9 }),
        (a, b, c) => {
          const [x, y, z] = [paise(a), paise(b), paise(c)];
          expect(add(x, y)).toBe(add(y, x));
          expect(add(add(x, y), z)).toBe(add(x, add(y, z)));
        },
      ),
    );
  });
});

describe('percentOf()', () => {
  it('computes GST at 5% and 18%', () => {
    expect(percentOf(paise(10_000), 500)).toBe(500);
    expect(percentOf(paise(10_000), 1_800)).toBe(1_800);
  });
  it('rounds half up, once', () => {
    // 5% of 10 paise = 0.5 -> 1
    expect(percentOf(paise(10), 500)).toBe(1);
    // 5% of 9 paise = 0.45 -> 0
    expect(percentOf(paise(9), 500)).toBe(0);
  });
  it('is never more than 1 paise away from the exact value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e8 }),
        fc.integer({ min: 0, max: 10_000 }),
        (amount, bps) => {
          const exact = (amount * bps) / 10_000;
          expect(Math.abs(percentOf(paise(amount), bps) - exact)).toBeLessThanOrEqual(0.5);
        },
      ),
    );
  });
  it('rejects invalid basis points', () => {
    expect(() => percentOf(paise(100), -1)).toThrow(MoneyError);
    expect(() => percentOf(paise(100), 1.5)).toThrow(MoneyError);
  });
});

describe('parseRupees()', () => {
  it.each([
    ['120', 12_000],
    ['120.5', 12_050],
    ['120.50', 12_050],
    ['1,250.00', 125_000],
    ['0.05', 5],
    [' 99 ', 9_900],
  ])('parses %s', (input, expected) => {
    expect(parseRupees(input)).toBe(expected);
  });
  it.each(['', 'abc', '-5', '1.234', '1..2', '₹100', '1e3', '.5'])('rejects %j', (input) => {
    expect(() => parseRupees(input)).toThrow(MoneyError);
  });
});

describe('formatRupees()', () => {
  it('uses Indian digit grouping', () => {
    expect(formatRupees(paise(12_345_600))).toBe('₹1,23,456');
    expect(formatRupees(paise(125_050))).toBe('₹1,250.50');
  });
  it('omits paise when zero and pads single-digit paise', () => {
    expect(formatRupees(paise(12_000))).toBe('₹120');
    expect(formatRupees(paise(12_005))).toBe('₹120.05');
  });
  it('round-trips with parseRupees for two-decimal values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), (n) => {
        const text = formatRupees(paise(n)).replace('₹', '');
        expect(parseRupees(text)).toBe(n);
      }),
    );
  });
});
