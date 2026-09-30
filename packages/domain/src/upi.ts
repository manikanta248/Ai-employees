import { paise, type Paise } from './money';

/** UPI ID (VPA) shape used by the database check: handle@provider. */
const VPA = /^[a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9]{1,64}$/;

export function isValidVpa(vpa: string): boolean {
  return VPA.test(vpa);
}

export interface UpiLinkInput {
  vpa: string;
  payeeName: string;
  amount: Paise;
  /** Short reference shown in the payer's UPI app, e.g. the order number. */
  reference: string;
}

/**
 * Build a UPI deep link with the amount already filled in, so customers never type it.
 * Only the standard fields are used: pa (payee), pn (name), am (amount), cu, tn (note).
 */
export function buildUpiLink({ vpa, payeeName, amount, reference }: UpiLinkInput): string {
  if (!isValidVpa(vpa)) throw new Error(`Invalid UPI ID: ${vpa}`);
  if (paise(amount) <= 0) throw new Error('Amount must be greater than zero');
  const name = payeeName.trim();
  if (name.length < 1 || name.length > 99) throw new Error('Payee name must be 1 to 99 characters');
  const note = reference.trim().slice(0, 50);
  const rupees = Math.floor(amount / 100);
  const fraction = String(amount % 100).padStart(2, '0');
  const params = new URLSearchParams();
  params.set('pa', vpa);
  params.set('pn', name);
  params.set('am', `${rupees}.${fraction}`);
  params.set('cu', 'INR');
  if (note) params.set('tn', note);
  // URLSearchParams encodes spaces as "+"; UPI apps expect %20.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}
