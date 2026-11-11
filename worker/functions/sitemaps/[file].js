// bricksvault.app/sitemaps/static.xml and /sitemaps/sets-N.xml (see og/sitemap.js).
import { handleSitemapFile } from '../../og/sitemap.js';

export const onRequestGet = (context) => handleSitemapFile(context);
