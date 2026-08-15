/**
 * English — the SOURCE catalogue and the fallback for every other language.
 *
 * Every key that exists anywhere must exist here, because t() falls back to
 * English before falling back to the key itself. Adding a string to a
 * translation without adding it here means English users see the raw key.
 * A test enforces this; another enforces that {placeholders} match.
 *
 * Keys are dotted and grouped by surface. Placeholders are {braced}.
 */
export const en = {
  nav: {
    vault: 'Vault',
    catalog: 'Catalog',
    scan: 'Scan',
    minifigs: 'Minifigs',
    me: 'Me',
    badges: 'Badges',
  },
  common: {
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    retry: 'Retry',
    delete: 'Delete',
    edit: 'Edit',
    done: 'Done',
    undo: 'Undo',
    loading: 'Loading…',
    search: 'Search',
    all: 'All',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    error: 'Something went wrong',
    errorWithDetails: 'Error: {error}',
    offlineActionsSyncedOne: '{count} offline action synced', offlineActionsSyncedOther: '{count} offline actions synced',
    offlineActionsDiscardedOne: '{count} offline action couldn’t sync and was discarded', offlineActionsDiscardedOther: '{count} offline actions couldn’t sync and were discarded',
    localItemsSyncedOne: 'Synced {count} local item', localItemsSyncedOther: 'Synced {count} local items',
    // Legacy keys retained until every persisted/older client module has moved
    // to tPlural; new UI code must use the category-specific forms above.
    offlineActionsSynced: '{count} offline actions synced', offlineActionsDiscarded: '{count} offline actions couldn’t sync and were discarded', localItemsSynced: 'Synced {count} local items',
    kidsXp: '+{xp} XP!{details}', kidsXpLevel: ' Level {level}!', kidsXpBadge: ' · Badge: {badge}! 🎉',
    copied: '{label} copied',
    offline: 'You are offline',
    seeAll: 'See all',
    share: 'Share',
    and: 'and',
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    languageDesc: 'Follows your device unless you pick one.',
    languageAuto: 'Automatic ({name})',
    currency: 'Currency',
    currencyDesc: 'Display values in your local currency.',
    currencyUpdated: 'Currency updated to {currency}',
    market: 'Retail market',
    marketDesc: 'Local market for store offers. Resale values remain in USD.',
    appearance: 'Appearance',
    notifications: 'Notifications',
    signOut: 'Sign out',
  },
  detail: {
    value: 'Value',
    retired: 'Retired',
    comingSoon: 'Coming soon',
    retiringSoon: 'Retiring soon',
    pieces: 'pieces',
    minifigs: 'minifigs',
    retail: 'Retail',
    addToVault: 'Add to vault',
    inVault: 'In vault',
    removeFromVault: 'Remove from vault',
    tabInfo: 'Info',
    tabForecast: 'Forecast',
    tabCommunity: 'Community',
    reliablePrice: 'Reliable price',
    pricingDetails: 'Pricing details',
    priceHistory: 'Price history',
    details: 'Details',
    estimated: 'Estimated',
    year: 'Year',
    theme: 'Theme',
    addToWishlist: 'Add to wishlist',
    inWishlist: 'On your wishlist',
    acquired: 'Acquired {date}{source}',
    uploadFailed: 'Upload failed: {error}',
    removeFailed: 'Remove failed: {error}',
    forecastUpside: 'forecast has ~{pct} more upside',
    addToVaultPrice: 'Add to vault · {price}',
    priceHistoryDays: 'Price history · {days} days',
    priceHistoryShort: 'Price history · {days}d',
    fromSources: 'From {n} market sources',
    fromSourcesOne: 'From 1 market source',
    typicalRange: ' · typically {low}–{high}',
    likelyRange: ' · likely {low}-{high}',
    reviews: '{n} reviews',
    reviewsOne: '1 review',
    up: 'Up {pct}%',
    down: 'Down {pct}%',
    tagsMore: '+{n} more',
  },
  deal: {
    // The Worker computes deal_reason as English prose with the percentage
    // baked in, so no dictionary key could ever match it. The client has every
    // input it needs (deal_signal, deal_available_channel, deal_discount_pct,
    // deal_strong), so it rebuilds the sentence here instead.
    buyRetail: 'Available at retail about {pct}% below its market value.',
    buyResale: 'Selling about {pct}% below its market value.',
    retiring: 'Retiring soon — limited buying window.',
    premiumRetail: 'Currently priced above its market value.',
    premiumResale: 'Asking prices sit above its market value.',
    fair: 'Priced in line with its market value.',
    labelBuy: 'BUY',
    labelStrongBuy: 'STRONG BUY',
    labelFair: 'FAIR PRICE',
    labelPremium: 'ABOVE VALUE',
    labelPct: '{label} · {pct}%',
  },
  card: {
    // Catalog / vault card chips. Every one carries a number, so the
    // exact-match dictionary can never reach them.
    pieces: '{n}PC',
    perPiece: '{price}/pc',
    lots: '{n} lots',
    deal: 'DEAL {pct}',
    strongBuy: 'STRONG BUY {pct}',
    forecast2y: '{price} 2yr',
    gamePieces: '{n} pcs',
    gameRetail: 'retail {price}',
  },
  me: {
    trophyShelf: 'Trophy Shelf ({n}/6)',
  },
  kids: {
    xp: '{n} XP',
    xpToLevel: '{n} XP to Level {level}',
    maxLevel: 'Max Level!',
    pcs: '{n} pcs',
    earned: '{n} of {total} earned',
    setsToGo: '{n} sets to go',
    setsToGoOne: '1 set to go!',
  },
  counts: {
    // Interpolated UI: the rendered node contains a value, so the exact-match
    // dictionary can never reach it. These need t() with {placeholders}.
    results: '{n} results',
    resultsOne: '1 result',
    collected: '{owned}/{total} collected',
    owned: '{n} owned',
    ofFigs: 'of {total} figs',
    figs: '{n} figs',
    figsOne: '1 fig',
  },
  market: {
    sellNowLabel: 'Sell now',
    fastSaleAfterFees: 'fast sale after fees',
    pctOfValue: '{pct}% of value',
    pctOfFairValue: '{pct}% of fair value',
    confidentlyPriced: '{pct}% confidently priced',
    families: '{n} independent market families',
    familyOne: '1 independent market family',
    sales: '{n} verified sales',
    saleOne: '1 verified sale',
    estimateUnlocks: '{list} estimate unlocks as more sold data arrives.',
    estimatesUnlock: '{list} estimates unlock as more sold data arrives.',
    // Pricing-details sheet. Each carries a number, so the exact-match
    // dictionary can never reach them.
    sellingAbove: 'Selling about {pct} above this value',
    sellingBelow: 'Selling about {pct} below this value',
    // Sold-evidence card. {sales} and {markets} carry full pluralised
    // phrases, so the headline itself is count-agnostic.
    soldEvidenceHeadline: 'Based on {sales} from {markets}.',
    soldEvidenceFallback: 'No recent verified sales — the estimate relies on asking prices or market guides.',
    soldEvidenceTitle: 'Sold evidence',
    soldEvidenceNewSealed: 'New & sealed',
    soldEvidenceUsedComplete: 'Used & complete',
    soldEvidenceFresh: 'Recent',
    soldEvidenceOlder: 'Older',
    soldEvidenceSalesOne: '1 verified sale',
    soldEvidenceSalesOther: '{n} verified sales',
    soldEvidenceMarketplacesOne: '1 marketplace',
    soldEvidenceMarketplacesOther: '{n} marketplaces',
  },
  time: {
    unknown: 'unknown', today: 'Today', yesterday: 'Yesterday', daysAgo: '{n} days ago',
  },
  fees: {
    marketplace: 'Marketplace Fee ({pct}%)',
    payment: 'Payment Fee ({pct}% + fixed)',
  },
  alerts: {
    priceDrop: 'Price drop · {days}d ago',
    targetWas: '— your target was {price}.',
  },
  game: {
    roundOf: 'Round {n} of {total}',
    pctOff: 'You were {pct}% off',
    streakLine: '{day} · streak {streak} · best {best}',
  },
  build: {
    needParts: 'Need {n} more parts',
    ofOwnedSets: 'of {n} owned sets',
    indexing: 'Indexing {n} more set(s) in the background…',
  },
  catalog: {
    title: 'Catalog',
    searchPlaceholder: 'Find a set',
    results: '{count} sets',
    noResults: 'No sets found',
    filters: 'Filters',
    filtersWithCount: 'Filters · {n}',
    sort: 'Sort',
    sortValue: 'Value', sortGrowth: 'Growth', sortNewest: 'Newest', sortTrending: 'Trending',
    clearFilters: 'Clear filters',
  },
  game: { marketGenius: '{score}/5 — market genius! 🎯', streakQuipOne: 'Streak: {count} day.', streakQuipOther: 'Streak: {count} days.' },
  community: {
    pendingSubmissionOne: '⏳ You have {n} submission awaiting approval.',
    pendingSubmissionFew: '⏳ You have {n} submissions awaiting approval.',
    pendingSubmissionMany: '⏳ You have {n} submissions awaiting approval.',
    pendingSubmissionOther: '⏳ You have {n} submissions awaiting approval.',
  },
  contributions: {
    approvedOne: '{n} approved contribution',
    approvedFew: '{n} approved contributions',
    approvedMany: '{n} approved contributions',
    approvedOther: '{n} approved contributions',
    contributorBadge: ' · ⭐ Contributor',
  },
  admin: {
    uploadingFile: 'Uploading {file}…',
    importedMinifigs: 'Imported {inserted} of {parsed} minifigs. They map to prices as they’re valued.',
    uploadFailed: 'Failed: {error}',
    lastRun: 'last run {when}{duration}',
    syncJobRunning: '{label}: running…',
    syncJobSkipped: 'skipped — {n}',
    syncJobSummary: 'processed {processed}, updated {updated}, rejected {rejected}',
    syncJobResult: '{label}: {summary}',
    syncJobFailed: '{label} failed: {error}',
    uploadSuccessToast: 'BrickLink minifig catalog: {inserted} imported',
    uploadErrorToast: 'Catalog upload failed: {error}',
    countRunning: '{n} running',
    countHealthy: '{n} healthy',
    countFailed: '{n} failed',
    countNotRun: '{n} not yet run',
    completedSlices: '{n} completed safe slices',
    jobId: 'Job #{id}',
    filled: '{n} filled',
    processed: '{n} processed',
    figures: '{n} minifigs',
    serviceTestResult: '{head} — {detail} ({ms}ms)',
    providerStatus: '{provider}: {status}',
    serviceTestFailed: 'Failed: {error}',
    providerTestFailed: '{provider} test failed',
    featureFlagStatus: '{flag}: {status}{suffix}',
    featureFlagUpdateFailed: 'Could not update {flag}: {error}',
    providerSaved: '{provider} saved.',
    providerSaveFailed: 'Error saving {provider}: {error}',
    pricingConfigLoadFailed: 'Could not load pricing config: {error}',
    resetFailed: 'Reset failed: {error}',
    contributionAction: '{action} — {applied}',
    enabled: 'enabled', disabled: 'disabled', approved: 'Approved', rejected: 'Rejected',
    noItemsProcessed: 'No items processed',
    jobStarted: 'Job #{id} started',
    jobFailed: 'Job failed: {error}',
    maintenanceComplete: '{label} complete',
    maintenanceFailed: '{label} failed: {error}',
    lastSeen: 'last seen {when}',
    tools: {
      sets: 'Import sets', figs: 'Import minifigs', upc: 'Backfill barcodes',
      populate: 'Populate coverage', revalue: 'Revalue prices', everything: 'Populate all safe sources',
      pricechartingBulk: 'Refresh PriceCharting (LEGO bulk)', pricechartingVerify: 'Verify PriceCharting mappings',
      pricesapi: 'Run pricesAPI now', ebaySold: 'Run eBay-sold scrape',
    },
    maintenanceTools: { expire: 'Expire valuations', repair: 'Repair search index' },
    countRunningOne: '{n} running', countRunningFew: '{n} running', countRunningMany: '{n} running', countRunningOther: '{n} running',
    countHealthyOne: '{n} healthy', countHealthyFew: '{n} healthy', countHealthyMany: '{n} healthy', countHealthyOther: '{n} healthy',
    countFailedOne: '{n} failed', countFailedFew: '{n} failed', countFailedMany: '{n} failed', countFailedOther: '{n} failed',
    countNotRunOne: '{n} not yet run', countNotRunFew: '{n} not yet run', countNotRunMany: '{n} not yet run', countNotRunOther: '{n} not yet run',
    completedSlicesOne: '{n} completed safe slice', completedSlicesFew: '{n} completed safe slices', completedSlicesMany: '{n} completed safe slices', completedSlicesOther: '{n} completed safe slices',
    filledOne: '{n} filled', filledFew: '{n} filled', filledMany: '{n} filled', filledOther: '{n} filled',
    processedOne: '{n} processed', processedFew: '{n} processed', processedMany: '{n} processed', processedOther: '{n} processed',
    figuresOne: '{n} minifig', figuresFew: '{n} minifigs', figuresMany: '{n} minifigs', figuresOther: '{n} minifigs',
  },
  downloads: {
    interrupted: 'Download interrupted at {pct}% — tap “Resume” to continue.',
    resume: 'Resume ({pct})',
    scanProgress: 'Identifying {current} of {total}…',
  },
  vault: {
    title: 'Vault',
    empty: 'Your vault is empty',
    emptyDesc: 'Add a set to start tracking its value.',
    setsOwned: 'Sets owned',
    totalValue: 'Total value',
    invested: 'Invested',
    investedAmount: 'Invested {amount}',
    gain: 'Gain',
    addSet: 'Add a set',
  },
  wishlist: {
    title: 'Wishlist',
    empty: 'Your wishlist is empty',
    targetPrice: 'Target price',
    priceDropAlert: 'Alert me on a price drop',
    remove: 'Remove from wishlist',
    setsCount: '{n} sets',
    setsCountOne: '1 set',
    alertsCount: '{n} alerts',
    alertsCountOne: '1 alert',
    nowPrice: 'Now {price}',
    targetPriceCurrency: 'Target Price ({symbol})',
    suggestedPrice: 'Suggested: {price}',
    unreadAlertsOne: '{count} unread alert', unreadAlertsOther: '{count} unread alerts',
  },
  minifigs: {
    ownedCount: '{count} owned',
    appearsInSetsOne: 'Appears in {n} set',
    appearsInSetsFew: 'Appears in {n} sets',
    appearsInSetsMany: 'Appears in {n} sets',
    appearsInSetsOther: 'Appears in {n} sets',
  },
  data: {
    reportFailed: 'Report failed: {error}', restoreFailed: 'Restore failed: {error}', retryFailed: 'Retry failed: {error}',
    exportFailed: 'Export failed: {error}', importFailed: 'Import failed: {error}', bricklinkImportFailed: 'BrickLink import failed: {error}',
    restoredFromBackup: 'Restored {count} sets from {date}',
    restoredFromBackupOne: 'Restored {count} set from {date}', restoredFromBackupOther: 'Restored {count} sets from {date}',
    migrationStillFailing: 'Still {count} items failing: {error}',
    migrationComplete: 'Done — {count} items synced.',
    importResult: '✓ {imported} imported, {skipped} skipped, {errors} errors',
    setsImported: '{count} sets imported',
    bricklinkImportResult: '✓ {added} sets added, {skipped} skipped. {errors}',
    bricklinkSetsImported: '{count} sets imported from BrickLink orders',
  },
  integrations: {
    bricksetSyncFailed: 'Brickset sync failed: {error}',
    bricksetSyncResult: 'Imported {added} sets ({skipped} not in catalog, {total} total on Brickset).',
    bricksetSyncSuccess: 'Brickset sync: {added} sets added',
    bricksetSyncResultOne: 'Imported {count} set ({skipped} not in catalog, {total} total on Brickset).', bricksetSyncResultOther: 'Imported {count} sets ({skipped} not in catalog, {total} total on Brickset).',
    bricksetSyncSuccessOne: 'Brickset sync: {count} set added', bricksetSyncSuccessOther: 'Brickset sync: {count} sets added',
    keyRemoved: '{label} key removed', keyVerified: '{label} key verified and saved',
  },
  scanner: {
    timedOut: 'Took too long — try again.', timedOutShort: 'Timed out', scanFailed: 'Error: {error}',
    findingSet: 'Finding set...', lookingUpSet: 'Looking up {setNum} in the catalog.',
    bulkPartial: 'Added {added} of {total} — {failed} failed, try those again',
    addSetsFailed: 'Failed to add sets: {error}',
    setNotFound: 'Set {setNum} was not found in the catalog.',
    localAiOfflineFailed: 'On-device AI failed and you’re offline: {error}',
    addItemFailed: 'Failed to add {name}: {error}', minifig: 'minifig',
    itemsAddedOne: 'Added {count} item to vault', itemsAddedOther: 'Added {count} items to vault',
    itemsSavedOfflineOne: 'Saved {count} item offline — will sync', itemsSavedOfflineOther: 'Saved {count} items offline — will sync',
    setsSavedOfflineOne: 'Saved {count} set offline — will sync when connected', setsSavedOfflineOther: 'Saved {count} sets offline — will sync when connected',
    itemsAdded: 'Added {count} items to vault', itemsSavedOffline: 'Saved {count} offline — will sync', setsSavedOffline: 'Saved {count} sets offline — will sync when connected',
  },
  portfolio: {
    collectionLoadFailed: 'Couldn’t load collection: {error}',
    bulkRemovePartial: 'Removed {removed} of {total} — {failed} failed, try those again',
    restoredCount: 'Restored {restored} of {total}',
    soldFor: 'Sold for {price} — removed from vault',
    wishlistAlertsTooltip: 'Wishlist Alerts ({spikes}, {drops})',
    wishlistAlertSpikesOne: '{count} spike', wishlistAlertSpikesOther: '{count} spikes', wishlistAlertDropsOne: '{count} price drop', wishlistAlertDropsOther: '{count} price drops',
    insightSignal: 'Resale {direction}{pct}% vs {basis}{quantity}', insightMarket: 'market', insightValue: 'value', insightQuantity: ' · ×{count}',
    bulkLocationPartial: 'Updated {updated} of {total} — {failed} failed, try those again',
  },
};

Object.assign(en.kids, {
  badgeCelebration: 'New badge: {badge}! 🎉', badgeQuip: 'You’re a building superstar! 🌟',
  levelCelebration: 'Level {level} reached! 🎉', levelQuip: 'Keep on building! 🧱',
  badgeFirstBrick: 'First Brick!', badgeJuniorBuilder: 'Junior Builder', badgeArchitect: 'Architect',
  badgeMaster: 'Master Builder', badgeGrandMaster: 'Grand Master', badgeLegend: 'Legendary!',
});
// `market` has legacy sections in this hand-maintained catalogue. Retain the
// earlier value-card keys after the later market-message section is declared.
Object.assign(en.market, {
  sellNowLabel: 'Sell now', fastSaleAfterFees: 'fast sale after fees', pctOfValue: '{pct}% of value',
  pctOfFairValue: '{pct}% of fair value', confidentlyPriced: '{pct}% confidently priced',
  families: '{n} independent market families', familyOne: '1 independent market family',
  sales: '{n} verified sales', saleOne: '1 verified sale', estimateUnlocks: '{list} estimate unlocks as more sold data arrives.', estimatesUnlock: '{list} estimates unlock as more sold data arrives.',
});
Object.assign(en.game, {
  roundOf: 'Round {n} of {total}', pctOff: 'You were {pct}% off', streakLine: '{day} · streak {streak} · best {best}',
  revealCorrect: '🎯 Nailed it! — it’s {value}', revealIncorrect: 'Not quite — it’s {value}',
});
Object.assign(en.scanner, { bulkMatched: '{matched} of {total} matched' });
Object.assign(en.catalog, { activeFiltersOne: '1 active', activeFiltersOther: '{count} active' });
Object.assign(en.portfolio, {
  anniversaryGain: 'Bought for {paid} — up {gain} since.', anniversaryNoGain: 'Bought for {paid}. Some sets are for love, not profit.',
  anniversaryQuip: 'Time flies when you’re building.', anniversaryCelebrationOne: '1 year with {set}! 🎂', anniversaryCelebrationOther: '{count} years with {set}! 🎂',
});
Object.assign(en.game, { loadFailed: 'Couldn’t load today’s game: {error}' });
Object.assign(en.contributions, { loadFailed: 'Couldn’t load: {error}' });
Object.assign(en.me, { wrappedLoadFailed: 'Couldn’t load your year: {error}', wrappedValueChange: 'Vault {direction} {value} this year', wrappedUp: 'up', wrappedDown: 'down' });
Object.assign(en.data, {
  csvImportConfirmTitleOne: 'Import 1 set?', csvImportConfirmTitleOther: 'Import {count} sets?',
  csvImportMore: ' and {count} more', csvImportConfirmMessage: 'Starting with: {sample}{more}. Existing sets are kept.', importConfirm: 'Import',
});
Object.assign(en.scanner, { setNumberMatched: 'Set number matched in catalog.' });
Object.assign(en.portfolio, { insightHeadlineOne: '≈ {value} upside across 1 set if sold now', insightHeadlineOther: '≈ {value} upside across {count} sets if sold now' });
Object.assign(en.market, {
  goodTimeToSell: 'Good time to sell', goodTimeToBuy: 'Good time to buy', onlyForSale: 'Only {count} for sale right now',
  askingHighHint: 'Sellers are asking high — list near the recent sold price to sell fast',
  askingLowHint: 'Listed below recent sold prices — good time to buy',
  askingSummary: '{count} for sale now · asking {asking}', askingSummaryWithSold: '{count} for sale now · asking {asking} vs {sold} recently sold',
  partsCoverage: '{pct}% parts coverage', forecastScenarios: 'Bear {bear} · Base {base} · Bull {bull}',
  salesSuffix: ' / {count} sales', newSold: 'New sold', usedSold: 'Used sold', viewOnBrickLink: 'View on BrickLink',
});
Object.assign(en.catalog, { loadFailedDetail: '{error}. Check your connection and try again.' });
Object.assign(en.portfolio, { moreThemesOne: '+1 more theme', moreThemesOther: '+{count} more themes', sealedParts: 'Sealed {sealed} · {approximate}Parts {parts}' });
en.advisor = Object.assign(en.advisor || {}, { moreThemesOne: '+1 other theme in your vault', moreThemesOther: '+{count} other themes in your vault' });

Object.assign(en.catalog, { filterSummaryNone: 'No filters active', filterSummaryActiveOne: '{count} active: {items}', filterSummaryActiveOther: '{count} active: {items}', filterSummarySearch: 'Search “{value}”', filterSummaryStatusRetired: 'Retired only', filterSummaryStatusActive: 'Active only', filterSummaryStatusRetiring: 'Retiring soon', filterSummaryDeal: 'Deals only', filterSummaryRangeYear: 'Year', filterSummaryRangePieces: 'Pieces', filterSummaryRangeValue: 'Value', filterSummaryRangeBetween: '{label} {min}–{max}', filterSummaryRangeMin: '{label} ≥ {value}', filterSummaryRangeMax: '{label} ≤ {value}', filterSummaryPiecesValue: '{value} pc', filterSummaryValueAmount: '${value}' });
Object.assign(en.minifigs, { filterSummaryNone: 'No filters active', filterSummaryActiveOne: '{count} active: {items}', filterSummaryActiveOther: '{count} active: {items}', filterSummarySearch: 'Search “{value}”', filterSummaryRarity: '{rarity} rarity', filterSummaryRarityCommon: 'Common', filterSummaryRarityUncommon: 'Uncommon', filterSummaryRarityRare: 'Rare', filterSummaryRarityLegendary: 'Legendary', filterSummaryOwned: 'Owned only', filterSummaryUnowned: 'Unowned only' });
Object.assign(en.catalog, { emptySearchResults: 'Nothing matches “{query}”. Try a different search or clear filters.', emptyFilteredResults: 'No sets match these filters. Try a different search or clear filters.' });
Object.assign(en.advisor, { retiredSetsOfTotalOne: '{retired} of {total} set', retiredSetsOfTotalOther: '{retired} of {total} sets' });
Object.assign(en.scanner, { duplicateConfirmTitle: 'Already owned', duplicateConfirmMessage: 'You already have {names} in your vault. Add another copy?', duplicateConfirmAction: 'Add anyway' });
Object.assign(en.scanner, { minifigWithSeries: '{minifig} · {series}', minifigWithRarity: '{minifig} · {rarity}', rarityUnknown: 'Unknown' });
Object.assign(en.admin, { jobAccepted: '{label} accepted and will appear in Activity shortly', pricechartingBulkAccepted: 'PriceCharting bulk download started — results will appear in Activity shortly', pricechartingVerifyAccepted: 'PriceCharting verification started — watch Activity for promoted mappings', pricesapiAccepted: 'pricesAPI refresh started — watch Activity for the result' });
Object.assign(en.scanner, { setsFoundOne: '{count} set found', setsFoundOther: '{count} sets found', minifigsFoundOne: '{count} minifig found', minifigsFoundOther: '{count} minifigs found', mixedResultsFoundOne: '{count} result found (sets and minifigs)', mixedResultsFoundOther: '{count} results found (sets and minifigs)', confidenceHigh: 'High confidence', confidenceMedium: 'Medium confidence', confidenceLow: 'Low confidence', confidenceUnknown: 'Match confidence unavailable', matchHigh: 'High match', matchMedium: 'Medium match', matchLow: 'Low match', match: 'Match' });
Object.assign(en.detail, { sellReasonGainSincePurchase: 'Up {roi} since purchase', sellReasonTrendDown: 'The price trend has turned down', sellReasonClimbFlattened: 'The price climb has flattened', sellReasonLittleUpside: 'Only {upside} forecast upside remains', sellReasonSellsFast: '{volume} recent sales suggest it sells quickly', sellReasonWatchClosely: 'Watch the market closely', sellReasonStillClimbing: 'The price is still climbing', sellReasonForecastUpside: 'Forecast suggests {upside} more upside', sellReasonNotRetired: 'It has not retired yet', sellReasonNoSellTrigger: 'No clear sell trigger yet' });
Object.assign(en.data, { migrationStillFailingOne: 'Still {count} item failing: {error}', migrationStillFailingOther: 'Still {count} items failing: {error}', migrationCompleteOne: 'Done — {count} item synced.', migrationCompleteOther: 'Done — {count} items synced.', setsImportedOne: '{count} set imported', setsImportedOther: '{count} sets imported', bricklinkSetsImportedOne: '{count} set imported from BrickLink orders', bricklinkSetsImportedOther: '{count} sets imported from BrickLink orders' });
Object.assign(en.detail, { sellReasonSellsFastOne: '{volume} recent sale suggests it sells quickly', sellReasonSellsFastOther: '{volume} recent sales suggest it sells quickly' });
Object.assign(en.minifigs, { setExclusive: 'Set-exclusive', inSetsOne: 'In {count} set', inSetsOther: 'In {count} sets', partsOne: '{count} part', partsOther: '{count} parts' });
Object.assign(en.minifigs, { emptySearchResults: 'Nothing matches “{query}”.', emptyFilteredResults: 'No minifigs match these filters.' });
Object.assign(en.detail, { partsComplete: 'Complete', partsMissingOne: '{count} part missing', partsMissingOther: '{count} parts missing', allPartsPresent: 'all parts present' });
Object.assign(en.build, { needPartsOne: 'Need {n} more part', needPartsOther: 'Need {n} more parts' });
Object.assign(en.card, { lotsOne: '{n} lot', lotsOther: '{n} lots' });
Object.assign(en.market, { salesSuffixOne: ' / {count} sale', salesSuffixOther: ' / {count} sales' });
Object.assign(en.data, { importedCountOne: '{n} set imported', importedCountOther: '{n} sets imported', skippedCountOne: '{n} set skipped', skippedCountOther: '{n} sets skipped', errorsCountOne: '{n} error', errorsCountOther: '{n} errors', setsAddedCountOne: '{n} set added', setsAddedCountOther: '{n} sets added', importResult: '✓ {imported}, {skipped}, {errors}', bricklinkImportResult: '✓ {added}, {skipped}. {errors}' });
Object.assign(en.admin, { minifigsImportedOne: '{n} minifig', minifigsImportedOther: '{n} minifigs', minifigsParsedOne: '{n} minifig', minifigsParsedOther: '{n} minifigs', importedMinifigs: 'Imported {inserted} of {parsed}. They map to prices as they’re valued.' });
Object.assign(en.time, { daysAgoOne: '{n} day ago', daysAgoOther: '{n} days ago' });
Object.assign(en.scanner, { bulkPartialOne: 'Added {added} of {total} — {failed} failed, try that again', bulkPartialOther: 'Added {added} of {total} — {failed} failed, try those again' });
Object.assign(en.kids, { setsToGoOne: '{n} set to go', setsToGoOther: '{n} sets to go', earnedOne: '{n} of {total} earned', earnedOther: '{n} of {total} earned' });
Object.assign(en.market, { familiesOne: '{n} independent market family', familiesOther: '{n} independent market families', salesOne: '{n} verified sale', salesOther: '{n} verified sales', onlyForSaleOne: 'Only {count} for sale right now', onlyForSaleOther: 'Only {count} for sale right now', askingSummaryOne: '{count} for sale now · asking {asking}', askingSummaryOther: '{count} for sale now · asking {asking}', askingSummaryWithSoldOne: '{count} for sale now · asking {asking} vs {sold} recently sold', askingSummaryWithSoldOther: '{count} for sale now · asking {asking} vs {sold} recently sold' });
Object.assign(en.detail, { fromSourcesOne: 'From {n} market source', fromSourcesOther: 'From {n} market sources', reviewsOne: '{n} review', reviewsOther: '{n} reviews', priceHistoryDaysOne: 'Price history · {n} day', priceHistoryDaysOther: 'Price history · {n} days', priceHistoryShortOne: 'Price history · {n}d', priceHistoryShortOther: 'Price history · {n}d' });
Object.assign(en.alerts, { priceDropOne: 'Price drop · {n}d ago', priceDropOther: 'Price drop · {n}d ago' });
Object.assign(en.portfolio, { bulkLocationPartialOne: 'Updated {updated} of {total} — {failed} failed, try that again', bulkLocationPartialOther: 'Updated {updated} of {total} — {failed} failed, try those again', bulkRemovePartialOne: 'Removed {removed} of {total} — {failed} failed, try that again', bulkRemovePartialOther: 'Removed {removed} of {total} — {failed} failed, try those again', restoredCountOne: 'Restored {restored} of {total}', restoredCountOther: 'Restored {restored} of {total}' });
Object.assign(en.wishlist, { setsCountOne: '{n} set', setsCountOther: '{n} sets', alertsCountOne: '{n} alert', alertsCountOther: '{n} alerts' });
Object.assign(en.admin, { syncJobSkippedOne: 'skipped — {n}', syncJobSkippedOther: 'skipped — {n}', syncJobSummaryOne: 'processed {processed}, updated {updated}, rejected {rejected}', syncJobSummaryOther: 'processed {processed}, updated {updated}, rejected {rejected}', uploadSuccessToastOne: 'BrickLink minifig catalog: {n} imported', uploadSuccessToastOther: 'BrickLink minifig catalog: {n} imported', contributionActionOne: '{action} — {n} applied', contributionActionOther: '{action} — {n} applied' });
Object.assign(en.data, { csvImportMoreOne: ' and {n} more', csvImportMoreOther: ' and {n} more', csvImportConfirmMessageOne: 'Starting with: {sample}{more}. Existing sets are kept.', csvImportConfirmMessageOther: 'Starting with: {sample}{more}. Existing sets are kept.' });
Object.assign(en.me, { trophyShelfOne: 'Trophy Shelf ({n}/6)', trophyShelfOther: 'Trophy Shelf ({n}/6)' });
Object.assign(en.build, { ofOwnedSetsOne: 'of {n} owned set', ofOwnedSetsOther: 'of {n} owned sets', indexingOne: 'Indexing {n} more set in the background…', indexingOther: 'Indexing {n} more sets in the background…' });
Object.assign(en.counts, { collectedOne: '{owned}/{total} collected', collectedOther: '{owned}/{total} collected', ownedOne: '{n} owned', ownedOther: '{n} owned', ofFigsOne: 'of {total} fig', ofFigsOther: 'of {total} figs', resultsOne: '{n} result', resultsOther: '{n} results', figsOne: '{n} fig', figsOther: '{n} figs' });
Object.assign(en.minifigs, { ownedCountOne: '{n} owned', ownedCountOther: '{n} owned' });
Object.assign(en.catalog, { filtersWithCountOne: 'Filter · {n}', filtersWithCountOther: 'Filters · {n}' });
Object.assign(en.scanner, {"bulkMatchedOne":"{matched} of {total} matched","bulkMatchedOther":"{matched} of {total} matched"});
Object.assign(en.kids, {"pcsOne":"{n} pcs","pcsOther":"{n} pcs"});
Object.assign(en.card, {"gamePiecesOne":"{n} pcs","gamePiecesOther":"{n} pcs","piecesOne":"{n}PC","piecesOther":"{n}PC"});
Object.assign(en.scanner, { bulkMatchedOne: '{n} of {total} match', bulkMatchedOther: '{n} of {total} matched' });
Object.assign(en.kids, { pcsOne: '{n} pc', pcsOther: '{n} pcs' });
Object.assign(en.card, { gamePiecesOne: '{n} pc', gamePiecesOther: '{n} pcs', piecesOne: '{n} pc', piecesOther: '{n} pcs' });
Object.assign(en.share ??= {}, { gameTitle: 'Price It!', gameText: '🧱 Price It! {day}\n{tiles} {score}/5 · streak {streak}\nGuess LEGO market prices on BricksVault', setText: 'Check out {name} ({setNum}) on BricksVault!', setDialogTitle: 'Share {name}', portfolioTitle: 'My LEGO BricksVault', portfolioText: 'Check out my LEGO collection on BricksVault!', portfolioDialogTitle: 'Share my BricksVault', wrappedTitle: 'Brick Wrapped {year}', wrappedBest: 'Best performer: {name}{roi}', wrappedTracked: 'Tracked with BricksVault', wrappedSetsAdded: 'sets added', wrappedPiecesAdded: 'pieces', wrappedValueChange: 'vault value change', wrappedTagline: 'BRICKSVAULT · STACK SOMETHING BEAUTIFUL' });
Object.assign(en.share, { wrappedHeading: 'Brick Wrapped', wrappedDescription: 'Your collector year in numbers — share it.', wrappedLoading: 'Counting your bricks…', wrappedSummaryTitle: '🧱 My Brick Wrapped {year}', wrappedSetsAddedOne: '{count} set added', wrappedSetsAddedOther: '{count} sets added', wrappedPiecesAddedOne: '{count} piece', wrappedPiecesAddedOther: '{count} pieces', wrappedMinifigsOne: '{count} minifig', wrappedMinifigsOther: '{count} minifigs', wrappedInvested: 'invested', wrappedSoldOne: '{count} set sold', wrappedSoldOther: '{count} sets sold', wrappedSoldLabel: 'sold', wrappedBestLabel: 'Best performer', wrappedBestCanvas: 'Best performer', wrappedBestCanvasWithRoi: 'Best performer · {roi}', wrappedLongestHeld: 'Longest held: {name} (since {year})', wrappedClose: 'Close', wrappedShareYear: 'Share my year' });
Object.assign(en.data, { reportPreparing: 'Preparing report…', insuranceReportTitle: 'BricksVault insurance report', reportSharedReady: 'Report ready — open it and print to PDF.', reportDownloadedReady: 'Report downloaded — open it and print to PDF.', noSnapshotsYet: 'No snapshots yet — the first one is written next Sunday.', backupsUnavailable: 'Backups unavailable right now.', retryingSync: 'Retrying sync…', guestVaultSynced: 'Guest vault synced', exportPreparing: 'Preparing export…', collectionExportTitle: 'Share BricksVault collection', guestExportShared: 'Your local guest export is ready to share or save.', guestExportDownloaded: 'Export downloaded from local guest data.', syncedExportShared: 'Your synced export is ready to share or save.', syncedExportDownloaded: 'Export downloaded from your synced vault.' });
// en.js declares `market` twice as an object literal, so the later one wins and
// keys added to the earlier block are silently dropped. Assigning after the fact
// lands on whichever object survived.
Object.assign(en.market, { comps: '{n} comps', slashComps: ' / {n} comps', usedValue: 'Used: {price}', updated: 'Updated {date}', compsAboveMsrp: 'New sold comps are {amount} ({pct}) above MSRP.', compsBelowMsrp: 'New sold comps are {amount} ({pct}) below MSRP.' });

Object.assign(en.detail, { tagsMoreOne: '+{n} more', tagsMoreOther: '+{n} more' });
Object.assign(en.market, { compsOne: '{n} comp', compsOther: '{n} comps', slashCompsOne: ' / {n} comp', slashCompsOther: ' / {n} comps' });

Object.assign(en.settings, { appLockUnchanged: 'App lock unchanged: {error}' });
Object.assign(en.game, { checkGuessFailed: 'Couldn\'t check that guess: {error}' });
Object.assign(en.alerts, { sellOpportunityOne: 'Sell opportunity · {n} day ago', sellOpportunityOther: 'Sell opportunity · {n} days ago' });
Object.assign(en.detail, { minifigsCountOne: '{n} minifig', minifigsCountOther: '{n} minifigs' });
Object.assign(en.market, { listingsOne: '{n} listing', listingsOther: '{n} listings', slashListingsOne: ' / {n} listing', slashListingsOther: ' / {n} listings', slashSamplesOne: ' / {n} sample', slashSamplesOther: ' / {n} samples' });
Object.assign(en.scanner, { estimatedValue: '(~estimated value)', marketGrabThreshold: 'Market {market} — under {price} is a grab{estimated}', underMarket: '{amount} under market{estimated}', withinMarket: 'within {pct}% of market{estimated}', overMarket: '{amount} over market{estimated}' });

export default en;
