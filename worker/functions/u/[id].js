// bricksvault.app/u/:handle: link preview for a public profile (see og/og-page.js).
import { handleShareLink } from '../../og/og-page.js';

export const onRequestGet = (context) => handleShareLink('u', context);
