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
```
BricksVault turns your brick collection into a portfolio.

Add sets by scanning them with your camera, searching the catalog, or scanning
a barcode — then track quantities, condition, purchase prices, and current market
value in one place.

FEATURES
• AI photo scan — point your camera at a set and BricksVault identifies it.
• Live valuations — market values blended from multiple pricing sources.
• Forecasts — see how a set's value has trended and where it may be heading.
• Wishlist & price-drop alerts — get notified when a set hits your target.
• Showcase & public profile — share your collection if you want to (private by default).
• "What Can I Build?" — discover models you can build from sets you already own.
• Works offline — your vault is always in hand.

Estimated values and forecasts are for information only and are not financial advice.

LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this app.
Catalog data & images from Rebrickable. Pricing from BrickLink, eBay, PriceCharting & Brickset.
```

## Category
- Play: primary **Lifestyle** or **Finance**; Apple: **Lifestyle** (secondary Finance).

## Privacy policy URL
- `https://brickvault-5ub.pages.dev/privacy.html`

---

## Google Play — Data Safety form (draft)
Data **collected** and linked to the user:
- **Personal info:** Email address (account management, sign-in).
- **App activity / other:** Your collection & wishlist content, uploaded photos, reviews.
- **Photos:** Images you upload or scan (scan images sent to AI providers for identification).
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
