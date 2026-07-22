import { describe, expect, it } from 'vitest';
import { analyzeEbaySoldHtml } from './lib/brightdata';

const setNum = '75192-1';
const setName = 'Millennium Falcon';

function card(title: string, price: string): string {
  return `<div class="s-card__title">${title}</div><div class="s-card__price">$${price}</div>`;
}

describe('analyzeEbaySoldHtml', () => {
  it('accepts compact valid result pages instead of imposing a byte threshold', () => {
    const html = [
      card('LEGO 75192 Millennium Falcon complete set', '800.00'),
      card('LEGO Star Wars 75192 Millennium Falcon', '820.00'),
      card('LEGO 75192 Millennium Falcon retired set', '840.00'),
    ].join('');

    expect(html.length).toBeLessThan(50_000);
    expect(analyzeEbaySoldHtml(html, setNum, setName)).toEqual({
      status: 'ok',
      value: 820,
      count: 3,
    });
  });

  it('unwraps JSON response envelopes returned by some Web Unlocker setups', () => {
    const html = [
      card('LEGO 75192 Millennium Falcon sealed', '780.00'),
      card('LEGO 75192 Millennium Falcon sealed', '800.00'),
      card('LEGO 75192 Millennium Falcon sealed', '820.00'),
    ].join('');

    expect(analyzeEbaySoldHtml(JSON.stringify({ body: html }), setNum, setName)).toMatchObject({
      status: 'ok',
      value: 800,
      count: 3,
    });
  });

  it('rejects challenge pages even when they return HTTP 200', () => {
    expect(analyzeEbaySoldHtml('<html><h1>Pardon our interruption</h1></html>', setNum, setName)).toEqual({
      status: 'error',
      value: null,
      count: 0,
      error: 'blocked page: pardon our interruption',
    });
  });

  it('distinguishes an explicit empty result from an unparseable response', () => {
    expect(analyzeEbaySoldHtml('<main>No exact matches found</main>', setNum, setName).status).toBe('no_data');
    expect(analyzeEbaySoldHtml('<html><main>Unexpected shell</main></html>', setNum, setName)).toMatchObject({
      status: 'error',
      value: null,
      count: 0,
    });
  });
});
