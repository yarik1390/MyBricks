# MyBricks — LEGO Portfolio Tracker

A mobile-first PWA where LEGO collectors log sets they own, track current market value, see ROI, get AI-powered price forecasts, and manage a wishlist with automatic price-drop alerts.

## Live App
https://brickvault-5ub.pages.dev

## Features
- Portfolio tracking with sparkline charts and ROI
- AI-powered price valuation (Gemini + multi-source)
- Camera barcode scanner + AI photo identification
- Wishlist with automatic price-drop alerts
- Full Rebrickable catalog integration (~20,000 sets)
- Blind bag minifig tracker
- Multi-currency support (USD/GBP/EUR/CAD/AUD)
- Public profile + Trophy Shelf sharing
- CSV import/export + Google Sheets sync
- PWA with offline support & background sync

## Stack
- **Worker:** Cloudflare Workers (TypeScript, Hono framework)
- **Database:** Cloudflare D1 (SQLite)
- **Auth:** Supabase (email/password + OAuth, JWT verification)
- **AI:** Google Gemini (photo ID, valuations, advisor)
- **Pricing:** BrickLink, BrickEconomy, eBay Browse API, formula-based valuation
- **Frontend:** Vanilla JS SPA, hash routing, no framework
- **Hosting:** Cloudflare Pages (static assets) + Cloudflare Workers (API)
- **CI/CD:** GitHub Actions (auto-deploy on push)
- **Design:** LEGO-inspired — cream palette, hard offset box shadows, Fraunces serif + Geist sans + IBM Plex Mono

## Architecture

### Database (D1 SQLite)
- `lego_sets` — full LEGO catalog with AI valuations, BrickLink/eBay/BrickEconomy prices
- `lego_themes` — theme hierarchy for catalog filters
- `user_collection` — per-user set tracking with soft delete, storage location, condition
- `portfolio_snapshots` — daily portfolio value history
- `set_value_history` — daily per-set price history for trend analysis
- `user_wishlist` + `wishlist_alerts` — wishlist with price-drop notifications
- `minifigs` + `user_minifigs` — blind bag / minifig tracker
- `user_prefs` — display name, handle, currency, public profile, Google Sheets sync
- `rate_limits` — per-user per-endpoint rate limiting

### API Routes (Cloudflare Worker)
| Route | Description |
|-------|-------------|
| `GET/POST /api/collection` | Collection CRUD |
| `GET/PATCH/DELETE /api/collection/:id` | Item management |
| `GET /api/collection/export` | CSV export |
| `GET /api/collection/history` | Portfolio value history |
| `POST /api/collection/import` | Bulk CSV import |
| `GET /api/sets/search` | Catalog search (local + Rebrickable) |
| `GET /api/sets/:setnum` | Set detail with auto-cache + live pricing |
| `POST /api/scan/identify` | Barcode or AI photo identification |
| `GET/POST /api/wishlist` | Wishlist management |
| `DELETE /api/wishlist/:id` | Remove wishlist item |
| `GET/PATCH /api/me` | User profile and stats |
| `GET /api/themes` | Theme list for filters |
| `GET/POST /api/minifigs` | Minifig catalog & user collection |
| `GET/POST /api/advisor` | AI advisor (streaming) |
| `GET /api/users/:handle` | Public profile |
| `GET/POST /api/google/*` | Google Sheets OAuth & sync |

### Background Jobs (Cron Triggers)
| Schedule | Job |
|----------|-----|
| Every hour | `valuate-sets` — refresh market valuations |
| Daily 2 AM | `snapshot-portfolios` — daily portfolio snapshots |
| Daily 3 AM | `snapshot-set-values` — daily per-set price snapshots |
| Daily 8 AM | `wishlist-alerts` — check for price-drop alerts |
| Weekly Sun 4 AM | `import-catalog` — sync Rebrickable catalog + UPC backfill |

### Frontend Pages
1. **Portfolio** (`/`) — hero sparkline, set list, ROI badges, search, filter, long-press actions, bulk selection
2. **Catalog** (`/add`) — scan CTA, search, theme/year/retired/value filters, grid layout
3. **Set Detail** (`/set/:num`) — hero image, Info/Forecast/Manage tabs, qty stepper, eBay listing generator
4. **Wishlist** (`/wishlist`) — price-drop alerts, target price, forecast badges
5. **Profile** (`/me`) — display name, handle, currency selector, public profile, Google Sheets, CSV import/export, Trophy Shelf
6. **Minifigs** (`/minifigs`) — minifig grid with rarity-colored cards
7. **Public Profile** (`/u/:handle`) — shared portfolio view with Trophy Shelf
8. **AI Advisor** — floating drawer with streaming chat, portfolio-aware

## Development

### Prerequisites
- Node.js 22+
- Cloudflare account with Workers & D1 enabled
- Supabase project (for auth)

### Local Development
```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # fill in secrets
npx wrangler dev
```

### Deployment
Push to the `main` or `claude/mybricks-lego-app-EdTPX` branch. GitHub Actions will:
1. Install dependencies
2. Create/find the D1 database
3. Apply schema + migrations
4. Upload secrets
5. Deploy the Worker
6. Deploy Pages (static frontend with Worker URL injected)

See [`.github/workflows/deploy-worker.yml`](.github/workflows/deploy-worker.yml) for the full CI/CD pipeline.
