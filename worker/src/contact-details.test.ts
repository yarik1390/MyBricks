import { describe, expect, it } from 'vitest';
import { findContactDetails } from './lib/contact-details';

describe('findContactDetails', () => {
  it('spots emails, phones, links and messenger names', () => {
    expect(findContactDetails('Send me a message to my email: someone@gmail.com')).toEqual(['email']);
    expect(findContactDetails('john (at) mail (dot) com')).toEqual(['email']);
    expect(findContactDetails('ring 0044 7700-900-123')).toEqual(['phone']);
    expect(findContactDetails('+380 67 123 45 67')).toEqual(['phone']);
    expect(findContactDetails('see https://example.org/x')).toContain('link');
    expect(findContactDetails('add me on Telegram')).toEqual(['messenger']);
    expect(findContactDetails('пиши у вайбер')).toEqual(['messenger']);
  });

  it('leaves set numbers and ordinary notes alone', () => {
    expect(findContactDetails('I can swap 75258-1 10497-1 21318-1 for 6086-1')).toEqual([]);
    expect(findContactDetails('Box is a bit dented, pieces complete. 2 bags opened.')).toEqual([]);
    expect(findContactDetails('')).toEqual([]);
    expect(findContactDetails(null)).toEqual([]);
  });
});
