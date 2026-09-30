import { describe, expect, it } from 'vitest';
import { messages } from '@hazir/i18n';
import { translator } from './i18n';

describe('translator', () => {
  it('returns the string for the requested language', () => {
    expect(translator('en', 'common')('save')).toBe(messages.en.common.save);
    expect(translator('hi', 'common')('save')).toBe(messages.hi.common.save);
    expect(translator('te', 'common')('save')).toBe(messages.te.common.save);
  });

  it('fails loudly on a missing key instead of showing a blank or the key', () => {
    expect(() => translator('en', 'common')('doesNotExist')).toThrow(/Missing message/);
  });
});
