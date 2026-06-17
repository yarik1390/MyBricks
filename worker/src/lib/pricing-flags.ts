// Central kill-switches for pricing sources that currently lack provider
// access. Flip a flag to true and redeploy once access is restored — every
// call site reads these, so re-enabling needs no other code change.
//
//  - EBAY_SOLD_COMPS_ENABLED: eBay Marketplace Insights (sold comps) needs
//    Buy-API approval for the keyset; until granted it 400s (invalid_scope).
//    The basic-scope Browse *ask* path is independent and stays ON.
//  - BRICKOWL_ENABLED: BrickOwl pricing + barcode lookups need a valid API
//    key; the current key returns HTTP 403, so both are disabled.
export const EBAY_SOLD_COMPS_ENABLED = false;
export const BRICKOWL_ENABLED = false;
