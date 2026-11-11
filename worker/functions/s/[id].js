// bricksvault.app/s/:set: crawlable set page for everyone (see og/set-page.js).
import { handleSetPage } from '../../og/set-page.js';

export const onRequestGet = (context) => handleSetPage(context);
