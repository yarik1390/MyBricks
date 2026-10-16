// bricksvault.app/s/:set: link preview for a set (see og/og-page.js).
import { handleShareLink } from '../../og/og-page.js';

export const onRequestGet = (context) => handleShareLink('s', context);
