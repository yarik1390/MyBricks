import { describe, expect, it } from 'vitest';
import { earlyAccessPro, hasProAccess } from './early-access';

describe('early-access Pro switch', () => {
  it('is on only for the exact value "1"', () => {
    expect(earlyAccessPro({ EARLY_ACCESS_PRO: '1' })).toBe(true);
    expect(earlyAccessPro({ EARLY_ACCESS_PRO: '0' })).toBe(false);
    expect(earlyAccessPro({})).toBe(false);
    expect(earlyAccessPro(undefined)).toBe(false);
  });

  it('unlocks Pro for everyone while on, and only for buyers while off', () => {
    expect(hasProAccess({ EARLY_ACCESS_PRO: '1' }, 0)).toBe(true);
    expect(hasProAccess({ EARLY_ACCESS_PRO: '1' }, null)).toBe(true);
    expect(hasProAccess({ EARLY_ACCESS_PRO: '0' }, 0)).toBe(false);
    expect(hasProAccess({ EARLY_ACCESS_PRO: '0' }, 1)).toBe(true);
    expect(hasProAccess({}, true)).toBe(true);
  });
});
