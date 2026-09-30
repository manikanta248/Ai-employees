/**
 * Money is always an integer number of paise. Floats never represent money.
 * 1 rupee = 100 paise.
 */
export type Paise = number & { readonly __brand: 'Paise' };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Paise must be a safe integer, got ${value}`);
  }
  return value as Paise;
}

export const ZERO: Paise = paise(0);

export function add(...values: Paise[]): Paise {
  return paise(values.reduce<number>((sum, v) => sum + v, 0));
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

export function multiply(amount: Paise, quantity: number): Paise {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer, got ${quantity}`);
  }
  return paise(amount * quantity);
}

/**
 * Percentage expressed in basis points (1% = 100 bps, 5% GST = 500 bps).
 * Rounds half away from zero, once, so results are deterministic.
 */
export function percentOf(amount: Paise, basisPoints: number): Paise {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new MoneyError(`Basis points must be a non-negative integer, got ${basisPoints}`);
  }
  const product = amount * basisPoints;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('Amount too large for percentage calculation');
  }
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  const quotient = Math.floor(abs / 10_000);
  const remainder = abs % 10_000;
  return paise(sign * (remainder >= 5_000 ? quotient + 1 : quotient));
}

/**
 * Parse a rupee string such as "120", "120.5" or "1,250.00" into paise.
 * Rejects more than two decimals, negatives and anything that is not a plain number.
 */
export function parseRupees(input: string): Paise {
  const cleaned = input.trim().replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`Invalid rupee amount: "${input}"`);
  const rupees = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0') || '0');
  return paise(rupees * 100 + fraction);
}

/** Format for display: "₹1,250.50" (Indian digit grouping) or "₹120" when there are no paise. */
export function formatRupees(amount: Paise, locale = 'en-IN'): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(rupees);
  const body = fraction === 0 ? grouped : `${grouped}.${String(fraction).padStart(2, '0')}`;
  return `${negative ? '-' : ''}₹${body}`;
}
