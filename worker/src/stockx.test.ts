import { describe, it, expect } from 'vitest';
import { parseStockXSearch } from './lib/stockx';

// Faithful to the real StockX search markup captured via the admin probe:
//   <a data-testid="productTile-ProductSwitcherLink" href="/lego-…-set-<num>">
//   …name… Set <num></p></div>
//   <div><p class="chakra-text …">Lowest Ask</p><div …><p …>$743</p></div></div>
const tile = (slug: string, name: string, ask: string) =>
  '<div data-sponsored-listing="false" data-product-vertical="collectibles" class="css-uq2vx8">' +
  `<a data-testid="productTile-ProductSwitcherLink" href="/${slug}">` +
  `<div class="css-1g4yje1"><img alt="${name}" src="https://images.stockx.com/x.jpg"></div>` +
  `<p class="chakra-text css-nn">${name}</p></div>` +
  '<div class="css-1b6n4o1"><p class="chakra-text css-e7a57k">Lowest Ask</p>' +
  `<div class="css-1giaaa9"><p class="chakra-text css-price">${ask}</p></div></div></a>`;

const SEARCH_HTML =
  '<html><body><div class="results">' +
  tile('lego-eiffel-tower-set-10307', 'LEGO Eiffel Tower Set 10307', '$743') +
  tile('lego-lion-knights-castle-set-10305', 'LEGO Lion Knights Castle Set 10305', '$497') +
  '</div></body></html>';

describe('parseStockXSearch', () => {
  it('extracts the lowest ask + URL for the exact set', () => {
    expect(parseStockXSearch(SEARCH_HTML, '10307-1')).toEqual({ ask: 743, url: '/lego-eiffel-tower-set-10307' });
    expect(parseStockXSearch(SEARCH_HTML, '10305-1')).toEqual({ ask: 497, url: '/lego-lion-knights-castle-set-10305' });
  });

  it('accepts a bare set number (no Rebrickable suffix)', () => {
    expect(parseStockXSearch(SEARCH_HTML, '10307').ask).toBe(743);
  });

  it('does not false-match a shorter/longer set number (slug boundary)', () => {
    // 1030 must NOT match "...-set-10307"; 103070 must not either.
    expect(parseStockXSearch(SEARCH_HTML, '1030-1')).toEqual({ ask: null, url: null });
    expect(parseStockXSearch(SEARCH_HTML, '103070-1')).toEqual({ ask: null, url: null });
  });

  it('returns nulls when the set is absent', () => {
    expect(parseStockXSearch(SEARCH_HTML, '99999-1')).toEqual({ ask: null, url: null });
  });

  it('parses thousands separators on high-value UCS asks (no $2k cap)', () => {
    const h = tile('lego-star-wars-millennium-falcon-set-10179', 'LEGO Millennium Falcon Set 10179', '$4,250');
    expect(parseStockXSearch(h, '10179-1')).toEqual({ ask: 4250, url: '/lego-star-wars-millennium-falcon-set-10179' });
  });

  it('scopes the ask to the matched tile, not a neighbour', () => {
    // The Eiffel tile ($743) precedes the Castle tile ($497); asking for the
    // castle must return 497, proving the region scoping works.
    expect(parseStockXSearch(SEARCH_HTML, '10305').ask).toBe(497);
  });

  // Firecrawl emits ABSOLUTE hrefs (https://stockx.com/...) and some carry a
  // ?sponsored=true query — some engines give relative paths. Parse both.
  const absTile = (slug: string, name: string, ask: string, q = '') =>
    `<a href="https://stockx.com/${slug}${q}">` +
    `<p data-testid="product-tile-title">${name}</p></div>` +
    `<div><p class="chakra-text css-e7a57k">Lowest Ask</p><div><p>${ask}</p></div></div></a>`;
  const ABS_HTML =
    '<html><body>' +
    absTile('lego-eiffel-tower-set-10307', 'LEGO Eiffel Tower Set 10307', '$743') +
    absTile('lego-icons-tudor-corner-set-10350', 'LEGO Tudor Corner Set 10350', '$219', '?sponsored=true') +
    '</body></html>';

  it('parses Firecrawl absolute URLs', () => {
    expect(parseStockXSearch(ABS_HTML, '10307-1')).toEqual({ ask: 743, url: 'https://stockx.com/lego-eiffel-tower-set-10307' });
  });
  it('parses absolute URLs that carry a query string', () => {
    expect(parseStockXSearch(ABS_HTML, '10350').ask).toBe(219);
  });
});
