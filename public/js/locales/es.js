/** Spanish. Missing keys fall back to English (see lib/i18n.js). */
export const es = {
  nav: { vault: 'Colección', catalog: 'Catálogo', scan: 'Escanear', minifigs: 'Minifiguras', me: 'Yo', badges: 'Insignias' },
  common: {
    cancel: 'Cancelar', save: 'Guardar', close: 'Cerrar', retry: 'Reintentar',
    loading: 'Cargando…', search: 'Buscar', all: 'Todos', none: 'Ninguno',
    error: 'Algo salió mal',
  },
  settings: {
    title: 'Ajustes',
    language: 'Idioma', languageDesc: 'Sigue tu dispositivo salvo que elijas uno.',
    languageAuto: 'Automático ({name})',
    currency: 'Moneda', currencyDesc: 'Mostrar los valores en tu moneda local.',
    market: 'Mercado', marketDesc: 'Qué precios de tienda mostrar.',
  },
  detail: {
    value: 'Valor', retired: 'Descatalogado', comingSoon: 'Próximamente', retiringSoon: 'Se descataloga pronto',
    pieces: 'piezas', minifigs: 'minifiguras', retail: 'PVP',
    addToVault: 'Añadir a la colección', inVault: 'En la colección',
    tabInfo: 'Info', tabForecast: 'Previsión', tabCommunity: 'Comunidad',
    reliablePrice: 'Precio fiable', pricingDetails: 'Detalles del precio', priceHistory: 'Historial de precios',
  },
  catalog: { title: 'Catálogo', searchPlaceholder: 'Buscar un set', results: '{count} sets', noResults: 'No se encontraron sets' },
};
export default es;
