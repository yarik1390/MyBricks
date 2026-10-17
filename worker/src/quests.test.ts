import { describe, expect, it } from 'vitest';
import { rankQuests, QUEST_MAX } from './routes/quests';

describe('rankQuests', () => {
  it('keeps finishable subthemes the member collects, most complete first', () => {
    const rows = [
      { theme: 'Star Wars', subtheme: 'Ultimate Collector Series', owned: 2, total: 45 },
      { theme: 'Modular Buildings', subtheme: 'Modular Buildings Collection', owned: 8, total: 14 },
      { theme: 'Icons', subtheme: 'Miscellaneous', owned: 5, total: 13 },
      { theme: 'Technic', subtheme: 'Licensed', owned: 1, total: QUEST_MAX + 31 },
      { theme: 'Icons', subtheme: 'Space System', owned: 1, total: 2 },
      { theme: 'City', subtheme: 'Police', owned: 0, total: 20 },
    ];
    expect(rankQuests(rows).map((r) => r.subtheme)).toEqual(['Modular Buildings Collection', 'Ultimate Collector Series']);
  });
});

import { anniversaryMessage } from './jobs/set-anniversaries';

describe('anniversaryMessage', () => {
  it('names the set, the years and the gain', () => {
    const m = anniversaryMessage({ user_id: 'u', set_num: '75192-1', name: 'Millennium Falcon', years: 3, purchase_price: 640, value: 850 });
    expect(m.title).toBe('3 years with Millennium Falcon 🎂');
    expect(m.body).toBe('Bought for $640, now worth about $850: up $210.');
  });
  it('stays kind about a loss and handles a missing price', () => {
    expect(anniversaryMessage({ user_id: 'u', set_num: 'x', name: 'X', years: 1, purchase_price: 100, value: 80 }).body).toContain('for love');
    expect(anniversaryMessage({ user_id: 'u', set_num: 'x', name: 'X', years: 1, purchase_price: null, value: 80 }).title).toBe('1 year with X 🎂');
  });
});
