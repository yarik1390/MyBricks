import { describe, expect, it } from 'vitest';
import { isMaintenanceRedirect } from './lib/http';

describe('isMaintenanceRedirect', () => {
  it('flags a followed redirect to a maintenance host or path', () => {
    expect(isMaintenanceRedirect({ redirected: true, url: 'https://maintenance.bricklink.com/recovery.html' })).toBe(true);
    expect(isMaintenanceRedirect({ redirected: true, url: 'https://example.com/maintenance' })).toBe(true);
  });
  it('ignores ordinary responses and ordinary redirects', () => {
    expect(isMaintenanceRedirect({ redirected: false, url: 'https://maintenance.bricklink.com/recovery.html' })).toBe(false);
    expect(isMaintenanceRedirect({ redirected: true, url: 'https://api.bricklink.com/api/store/v1/items/SET/75192-1/price' })).toBe(false);
    expect(isMaintenanceRedirect({ redirected: true, url: '' })).toBe(false);
  });
});
