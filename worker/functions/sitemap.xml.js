// bricksvault.app/sitemap.xml: sitemap index (see og/sitemap.js).
import { handleSitemapIndex } from '../og/sitemap.js';

export const onRequestGet = (context) => handleSitemapIndex(context);
