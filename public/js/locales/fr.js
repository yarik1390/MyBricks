/** French. Missing keys fall back to English (see lib/i18n.js). */
export const fr = {
  nav: { vault: 'Coffre', catalog: 'Catalogue', scan: 'Scanner', minifigs: 'Figurines', me: 'Moi', badges: 'Badges' },
  common: {
    cancel: 'Annuler', save: 'Enregistrer', close: 'Fermer', retry: 'Réessayer',
    loading: 'Chargement…', search: 'Rechercher', all: 'Tous', none: 'Aucun',
    error: 'Une erreur est survenue',
  },
  settings: {
    title: 'Réglages',
    language: 'Langue', languageDesc: 'Suit votre appareil sauf si vous en choisissez une.',
    languageAuto: 'Automatique ({name})',
    currency: 'Devise', currencyDesc: 'Afficher les valeurs dans votre devise locale.',
    market: 'Marché', marketDesc: 'Quels prix boutique afficher.',
  },
  detail: {
    value: 'Valeur', retired: 'Retiré', comingSoon: 'Bientôt', retiringSoon: 'Bientôt retiré',
    pieces: 'pièces', minifigs: 'figurines', retail: 'Prix public',
    addToVault: 'Ajouter au coffre', inVault: 'Dans le coffre',
    tabInfo: 'Infos', tabForecast: 'Prévision', tabCommunity: 'Communauté',
    reliablePrice: 'Prix fiable', pricingDetails: 'Détails du prix', priceHistory: 'Historique des prix',
  },
  catalog: { title: 'Catalogue', searchPlaceholder: 'Trouver un set', results: '{count} sets', noResults: 'Aucun set trouvé' },
};
export default fr;
