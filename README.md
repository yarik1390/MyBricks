# MyBricks — LEGO Portfolio Tracker

A mobile-first PWA where LEGO collectors log sets they own, track current market value, see ROI, get AI-powered price forecasts, and manage a wishlist with automatic price-drop alerts.

## Live App
https://mybricks.hatchable.site

## Features
- Portfolio tracking with sparkline charts and ROI
- AI-powered price valuation (GPT-4o-mini)
- Camera barcode scanner + AI photo identification (GPT-4o)  
- Wishlist with automatic price-drop alerts
- Full Rebrickable catalog integration (~20,000 sets)
- Blind bag minifig tracker
- PWA with offline support

## Stack
- **Platform:** Hatchable (PostgreSQL + serverless JS)
- **AI:** OpenAI GPT-4o (photo ID) + GPT-4o-mini (valuation)
- **Frontend:** Vanilla JS SPA, hash routing, no framework
- **Design:** LEGO-inspired — cream palette, hard offset box shadows, Fraunces serif + Geist sans + IBM Plex Mono
- **Fonts:** Fraunces, Geist, IBM Plex Mono (Google Fonts)

## Architecture

### Database (7 migrations)
- `lego_sets` — full LEGO catalog with AI valuations
- `user_collection` — per-user set tracking with soft delete
- `portfolio_snapshots` — daily portfolio value history
- `user_wishlist` + `wishlist_alerts` — wishlist with price-drop notifications
- `minifigs` + `user_minifigs` — blind bag tracker
- `user_prefs` — display name, currency, notification settings
- `rate_limits`, `import_runs`, `lego_themes`

### API Endpoints
- `GET/POST /api/collection` — collection CRUD with ETag
- `GET/PATCH/DELETE /api/collection/:id` — item management
- `GET /api/collection/history` — portfolio value history
- `GET /api/sets/search` — catalog search (local + Rebrickable)
- `GET /api/sets/:setnum` — set detail with auto-cache
- `POST /api/scan/identify` — barcode or AI photo identification
- `GET/POST /api/wishlist` — wishlist management
- `DELETE/POST /api/wishlist/:id` — remove item or mark alert read
- `GET/PATCH /api/me` — user profile and stats
- `GET /api/themes` — theme list for filters
- `GET /api/minifigs` — minifig catalog
- Cron: valuate-sets, snapshot-portfolios, wishlist-alerts
- Admin: import-rebrickable (full catalog import from CSV.gz)

### Frontend Pages
1. **Portfolio** (`/`) — hero sparkline, set list, ROI badges, search, long-press actions
2. **Catalog** (`/add`) — scan CTA, search, theme/year/retired filters, 2-col grid
3. **Set Detail** (`/set/:num`) — hero image, Info/Forecast/Manage tabs, qty stepper
4. **Wishlist** (`/wishlist`) — price-drop alerts, target price, forecast badges
5. **Profile** (`/me`) — display name, stats, currency, notifications
6. **Pile Scanner** (`/pile`) — camera capture + AI identification
7. **Blind Bag** (`/blind`) — minifig grid with rarity-colored cards

## Development

The app is deployed on Hatchable. Edit files via the Hatchable MCP tools or at https://hatchable.com/console/projects/mybricks
