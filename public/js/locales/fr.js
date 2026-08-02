/** French. Missing keys fall back to English (see lib/i18n.js). */
export const fr = {
  nav: { vault: 'Coffre', catalog: 'Catalogue', scan: 'Scanner', minifigs: 'Figurines', me: 'Moi', badges: 'Badges' },
  common: {
    cancel: 'Annuler', save: 'Enregistrer', close: 'Fermer', retry: 'Réessayer',
    delete: 'Supprimer', edit: 'Modifier', done: 'Terminé', undo: 'Annuler',
    loading: 'Chargement…', search: 'Rechercher', all: 'Tous', none: 'Aucun',
    yes: 'Oui', no: 'Non', error: 'Une erreur est survenue', offline: 'Vous êtes hors ligne',
    seeAll: 'Tout voir', share: 'Partager',
    and: 'et',
  },
  settings: {
    title: 'Réglages', language: 'Langue',
    languageDesc: 'Suit votre appareil sauf si vous en choisissez une.', languageAuto: 'Automatique ({name})',
    currency: 'Devise', currencyDesc: 'Afficher les valeurs dans votre devise locale.',
    market: 'Marché', marketDesc: 'Marché local pour les offres en boutique. Les valeurs de revente restent en USD.',
    appearance: 'Apparence', notifications: 'Notifications', signOut: 'Se déconnecter',
  },
  detail: {
    value: 'Valeur', retired: 'Retiré', comingSoon: 'Bientôt', retiringSoon: 'Bientôt retiré',
    pieces: 'pièces', minifigs: 'figurines', retail: 'Prix public',
    addToVault: 'Ajouter au coffre', inVault: 'Dans le coffre', removeFromVault: 'Retirer du coffre',
    tabInfo: 'Infos', tabForecast: 'Prévision', tabCommunity: 'Communauté',
    reliablePrice: 'Prix fiable', pricingDetails: 'Détails du prix', priceHistory: 'Historique des prix',
    details: 'Détails', estimated: 'Estimé', year: 'Année', theme: 'Thème',
    addToWishlist: 'Ajouter aux envies', inWishlist: 'Dans vos envies',
    addToVaultPrice: 'Ajouter au coffre · {price}', priceHistoryDays: 'Historique des prix · {days} jours', priceHistoryShort: 'Historique des prix · {days} j', fromSources: 'De {n} sources de marché', fromSourcesOne: 'De 1 source de marché', typicalRange: ' · généralement {low}–{high}',
  },
  counts: {
    results: '{n} résultats', resultsOne: '1 résultat', collected: '{owned}/{total} collectées', owned: '{n} en possession', ofFigs: 'sur {total} figurines', figs: '{n} figurines', figsOne: '1 figurine',
  },
  market: {
    sellNowLabel: 'Vendre maintenant',
    fastSaleAfterFees: 'vente rapide après frais',
    pctOfValue: '{pct}% de la valeur',
    pctOfFairValue: '{pct}% de la juste valeur',
    confidentlyPriced: '{pct}% évalués avec confiance',
    families: '{n} sources de marché indépendantes',
    familyOne: '1 source de marché indépendante',
    sales: '{n} ventes vérifiées',
    saleOne: '1 vente vérifiée',
    estimateUnlocks: 'L’estimation {list} se débloquera avec plus de données de ventes.',
    estimatesUnlock: 'Les estimations {list} se débloqueront avec plus de données de ventes.',
  },
  time: {
    unknown: 'inconnu', today: 'Aujourd’hui', yesterday: 'Hier', daysAgo: 'il y a {n} jours',
  },
  me: {
    trophyShelf: 'Vitrine ({n}/6)',
  },
  kids: {
    xp: '{n} XP', xpToLevel: '{n} XP avant le niveau {level}', maxLevel: 'Niveau max !', pcs: '{n} pièces', earned: '{n} sur {total} obtenus', setsToGo: 'Encore {n} sets', setsToGoOne: 'Encore 1 set !',
  },
  fees: {
    marketplace: 'Frais de place de marché ({pct}%)', payment: 'Frais de paiement ({pct}% + fixe)',
  },
  alerts: {
    priceDrop: 'Baisse de prix · il y a {days} j', targetWas: '— votre objectif était {price}.',
  },
  game: {
    roundOf: 'Manche {n} sur {total}', pctOff: 'Écart de {pct}%', streakLine: '{day} · série {streak} · record {best}',
  },
  build: {
    needParts: 'Il manque {n} pièces', ofOwnedSets: 'sur {n} sets possédés', indexing: 'Indexation de {n} set(s) supplémentaire(s) en arrière-plan…',
  },
  catalog: {
    title: 'Catalogue', searchPlaceholder: 'Trouver un set', results: '{count} sets',
    noResults: 'Aucun set trouvé', filters: 'Filtres', sort: 'Trier', clearFilters: 'Effacer les filtres',
  },
  vault: {
    title: 'Coffre', empty: 'Votre coffre est vide', emptyDesc: 'Ajoutez un set pour suivre sa valeur.',
    setsOwned: 'Sets possédés', totalValue: 'Valeur totale', invested: 'Investi', gain: 'Gain', addSet: 'Ajouter un set',
    investedAmount: 'Investi {amount}',
  },
  wishlist: {
    title: 'Liste d’envies', empty: 'Votre liste d’envies est vide', targetPrice: 'Prix cible',
    priceDropAlert: 'M’alerter en cas de baisse', remove: 'Retirer des envies',
    setsCount: '{n} sets', setsCountOne: '1 set', alertsCount: '{n} alertes', alertsCountOne: '1 alerte', nowPrice: 'Maintenant {price}',
  },
};
export default fr;
