import { describe, expect, it } from 'vitest';
import { diningTableInput, menuItemInput, modifierGroupInput, modifierInput } from './menu';

const id = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const valid = {
  categoryId: id,
  name: { en: 'Cappuccino', hi: 'कैपुचीनो' },
  pricePaise: 12_000,
  diet: 'veg',
};

describe('menuItemInput', () => {
  it('accepts a valid item and applies safe defaults', () => {
    const r = menuItemInput.parse(valid);
    expect(r).toMatchObject({ taxRateBps: 500, sortOrder: 0, isActive: true });
  });

  it('requires diet, with no default', () => {
    const rest: Partial<typeof valid> = { ...valid };
    delete rest.diet;
    expect(menuItemInput.safeParse(rest).success).toBe(false);
  });

  it.each([
    ['negative price', { pricePaise: -1 }],
    ['fractional price', { pricePaise: 100.5 }],
    ['price too high', { pricePaise: 10_000_001 }],
    ['tax above 28%', { taxRateBps: 2801 }],
    ['unknown diet', { diet: 'vegan' }],
    ['missing English name', { name: { hi: 'चाय' } }],
    ['unknown language', { name: { en: 'Tea', fr: 'Thé' } }],
    ['blank translation', { name: { en: 'Tea', hi: '  ' } }],
    ['name too long', { name: { en: 'x'.repeat(121) } }],
    ['half a window', { availableFrom: '07:00' }],
    ['bad time', { availableFrom: '25:00', availableUntil: '11:00' }],
    ['extra field', { restaurantId: id }],
    ['bad category id', { categoryId: 'nope' }],
  ])('rejects %s', (_label, patch) => {
    expect(menuItemInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('accepts a full availability window, including overnight', () => {
    expect(
      menuItemInput.safeParse({ ...valid, availableFrom: '22:00', availableUntil: '02:00' })
        .success,
    ).toBe(true);
  });

  it('trims names', () => {
    expect(menuItemInput.parse({ ...valid, name: { en: '  Tea  ' } }).name.en).toBe('Tea');
  });
});

describe('modifiers and tables', () => {
  it('rejects a group whose max is below its min', () => {
    expect(
      modifierGroupInput.safeParse({ itemId: id, name: { en: 'Size' }, minSelect: 2, maxSelect: 1 })
        .success,
    ).toBe(false);
    expect(
      modifierGroupInput.safeParse({ itemId: id, name: { en: 'Size' }, minSelect: 1, maxSelect: 1 })
        .success,
    ).toBe(true);
  });
  it('rejects a negative modifier price', () => {
    expect(
      modifierInput.safeParse({ groupId: id, name: { en: 'Large' }, priceDeltaPaise: -5 }).success,
    ).toBe(false);
  });
  it('validates table labels', () => {
    expect(diningTableInput.safeParse({ outletId: id, label: 'T1' }).success).toBe(true);
    expect(diningTableInput.safeParse({ outletId: id, label: '   ' }).success).toBe(false);
    expect(diningTableInput.safeParse({ outletId: id, label: 'x'.repeat(31) }).success).toBe(false);
  });
});
