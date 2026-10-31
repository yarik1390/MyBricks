# BricksVault — store listing copy & privacy answers

Finalized for the Play submission (2026-07); the Data Safety answers below were
verified against the shipped code (email + user content collected, encrypted in
transit, in-app deletion at Me → Delete account). Assets: 4 phone screenshots +
the 1024×500 feature graphic live in `store/play/`.

## App name
- **BricksVault** (Play title ≤ 30 chars; Apple name ≤ 30 chars — "BricksVault" fits.)

## Subtitle / short description
- Apple subtitle (≤ 30): `Track & value your brick sets`
- Play short description (≤ 80): `Track, value, and forecast your LEGO collection — with AI set scanning.`

## Keywords (Apple, ≤ 100 chars, comma-separated)
`brick,sets,minifig,collection,tracker,portfolio,value,scanner,wishlist,catalog,invest,retire`

## Full description (Play ≤ 4000 / Apple ≤ 4000)
Expanded 2026-10-31 after the closed-test feedback report ("description lacks
text and keywords"). Keywords worked in naturally: LEGO collection tracker,
set value, price guide, minifigures, retiring sets, barcode scanner, wishlist,
price alerts, portfolio, collectors, investing. Keep "LEGO" out of the short
description and title (trademark); the trademark line below stays.
```
Know what your bricks are worth. BricksVault is the collection tracker and price guide for LEGO® fans, collectors and investors: log every set you own, see its current market value, and catch deals and retirements before everyone else.

ADD SETS IN SECONDS
• Scan the barcode on a box, photograph a whole shelf, or search 27,000+ sets by name or set number.
• Track quantity, condition (sealed, opened, built), purchase price and date for every copy.
• Import from CSV, BrickLink or Rebrickable, and export any time.

KNOW WHAT YOUR COLLECTION IS WORTH
• Daily market values for every set, blended from BrickLink, eBay, PriceCharting and Brickset sales data.
• See your total portfolio value, profit and ROI, and which sets moved the most.
• Price history and value forecasts for each set, with a clear explanation of where every number comes from.
• Value in your own currency, with retail prices for your region.

NEVER MISS A DEAL OR A RETIREMENT
• Wishlist with target prices: get an alert when a set drops below what you want to pay.
• Retiring soon: sets about to leave the shelves, with a retirement-risk score.
• Coming soon: new sets and launch dates.
• Promotions: gifts with purchase, double points and sales.

ENJOY YOUR COLLECTION
• Walk through your shelves in the 3D collection room.
• "What can I build?": models you can build from the parts you already own.
• Minifigures tracker, sub-collections and a shareable public profile (private by default).
• Brick Wrapped yearly recap, collector quests and the Price It! daily guessing game.
• Family vault for collecting together, and a kid-safe Kids mode with a PIN.
• Insurance report: a printable inventory of your sets and their value.

BUILT FOR COLLECTORS
• Works offline, syncs across your phone and the web at bricksvault.app.
• Light and dark themes, 9 languages.
• Try it without an account: your guest vault stays on your phone.

BricksVault Pro adds investor tools, full price history and richer exports.

Estimated values and forecasts are for information only and are not financial advice.

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this app.
Catalog data and images from Rebrickable. Market data from BrickLink, eBay, PriceCharting and Brickset.
```

## Category
- Play: primary **Lifestyle** or **Finance**; Apple: **Lifestyle** (secondary Finance).

## Privacy policy URL
- `https://bricksvault.app/privacy.html`

---

## Google Play — Data Safety form (draft)
Data **collected** and linked to the user:
- **Personal info:** Email address (account management, sign-in).
- **App activity / other:** Your collection & wishlist content, uploaded photos, reviews.
- **Photos:** Images you upload or scan (scan images sent to AI providers for identification).
- **Financial info → Purchase history:** BricksVault Pro purchases (Google Play Billing, status recorded via RevenueCat). No card details.
- **Device or other IDs:** Firebase Cloud Messaging push token (only when notifications are allowed).
Practices:
- Data is **encrypted in transit**. ✔
- Users **can request deletion** — and can delete their account in-app (Me → Delete account). ✔
- Data is **not sold**. ✔
- Data **shared** only with processors needed to run the app (hosting, auth, AI identification, pricing sources).

## Apple — App Privacy labels (draft)
- **Data Used to Track You:** None.
- **Data Linked to You:** Contact Info (email); User Content (photos, reviews, collection notes); Identifiers (user ID); Usage Data (diagnostics/aggregate).
- **Data Not Linked to You:** Diagnostics (aggregate performance).
- Purposes: App Functionality; (no Third-Party Advertising; no Tracking).
- Account deletion available in-app: **Yes** (Me → Delete account).

> Confirm these against your live configuration before submitting — declare only what
> you actually collect. If you disable an integration, drop it from the form.
