import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

/** Mirrors the database rule: English required, hi/te optional, no other keys. */
export const localizedText = (max: number) =>
  z
    .object({
      en: text(max),
      hi: text(max).optional(),
      te: text(max).optional(),
    })
    .strict();

const pricePaise = z.number().int().min(0).max(10_000_000);

export const dietSchema = z.enum(['veg', 'non_veg', 'egg']);

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const menuCategoryInput = z
  .object({
    name: localizedText(80),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export const menuItemInput = z
  .object({
    categoryId: z.uuid(),
    name: localizedText(120),
    description: localizedText(500).optional(),
    pricePaise,
    taxRateBps: z.number().int().min(0).max(2800).default(500),
    // No default on purpose: the owner must state veg / non-veg / egg for every item.
    diet: dietSchema,
    imagePath: z.string().max(300).optional(),
    availableFrom: timeOfDay.optional(),
    availableUntil: timeOfDay.optional(),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((v) => (v.availableFrom === undefined) === (v.availableUntil === undefined), {
    message: 'Set both ends of the availability window, or neither',
    path: ['availableFrom'],
  });

export const modifierGroupInput = z
  .object({
    itemId: z.uuid(),
    name: localizedText(80),
    minSelect: z.number().int().min(0).default(0),
    maxSelect: z.number().int().min(1).default(1),
    sortOrder: z.number().int().default(0),
  })
  .strict()
  .refine((v) => v.maxSelect >= v.minSelect, {
    message: 'Maximum must be at least the minimum',
    path: ['maxSelect'],
  });

export const modifierInput = z
  .object({
    groupId: z.uuid(),
    name: localizedText(80),
    priceDeltaPaise: pricePaise.default(0),
    isAvailable: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .strict();

export const diningTableInput = z
  .object({
    outletId: z.uuid(),
    label: z.string().trim().min(1).max(30),
  })
  .strict();

export type MenuItemInput = z.infer<typeof menuItemInput>;
