import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeKidsStats, kidsBadges, newlyEarned, pickDailyQuestion, gameAnswer, streaks, towerFact, kidsTileOrder, themeSlug,
} from '../lib/kids-play.js';

const items = [
  { set_num: '10001-1', name: 'A', theme: 'City', pieces: 500, minifigs: 3, year: 2020, quantity: 1 },
  { set_num: '10002-1', name: 'B', theme: 'City', pieces: 300, minifigs: 2, year: 2018, quantity: 2 },
  { set_num: '10003-1', name: 'C', theme: 'City', pieces: 120, minifigs: 1, year: 2023 },
  { set_num: '10004-1', name: 'D', theme: 'Star Wars', pieces: 900, minifigs: 5, year: 2015 },
];

test('stats count sets, pieces with quantity, themes and built marks for owned sets only', () => {
  const s = computeKidsStats({ items, marks: [{ set_num: '10001-1', built: true }, { set_num: '99999-1', built: true }], plays: [] });
  assert.equal(s.sets, 4);
  assert.equal(s.pieces, 500 + 600 + 120 + 900);
  assert.equal(s.minifigs, 3 + 4 + 1 + 5);
  assert.equal(s.themes, 2);
  assert.equal(s.built, 1);
  assert.deepEqual(s.themeCounts[0], ['City', 3]);
});

test('badges: thresholds, theme fans with a goal, stored badges never lost', () => {
  const s = computeKidsStats({ items, marks: [], plays: [] });
  const b = kidsBadges(s, ['legend']);
  const by = Object.fromEntries(b.map(x => [x.slug, x]));
  assert.equal(by.first_brick.earned, true);
  assert.equal(by.junior_builder.earned, false);
  assert.equal(by.legend.earned, true, 'stored badge stays earned');
  assert.equal(by.pieces_1k.earned, true);
  assert.equal(by.fan_city.earned, true);
  assert.equal(by['fan_star-wars'].earned, false, 'closest theme shown as a goal');
  assert.deepEqual(newlyEarned(b, ['legend', 'first_brick']).includes('first_brick'), false);
  assert.ok(newlyEarned(b, []).includes('fan_city'));
});

test('streaks count consecutive days and keep a run alive until tomorrow', () => {
  assert.deepEqual(streaks(['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-04'), { current: 3, best: 3 });
  assert.deepEqual(streaks(['2026-11-01', '2026-11-03'], '2026-11-03'), { current: 1, best: 1 });
  assert.deepEqual(streaks(['2026-11-01', '2026-11-02'], '2026-11-05'), { current: 0, best: 2 });
});

test('daily question is stable for a day, uses owned sets and has one answer', () => {
  const q1 = pickDailyQuestion(items, '2026-11-04');
  const q2 = pickDailyQuestion([...items].reverse(), '2026-11-04');
  assert.deepEqual(q1, q2);
  const A = items.find(i => i.set_num === q1.a), B = items.find(i => i.set_num === q1.b);
  assert.ok(A && B && A !== B);
  assert.ok([A.set_num, B.set_num].includes(gameAnswer(q1.kind, A, B)));
  assert.equal(pickDailyQuestion(items.slice(0, 1), '2026-11-04'), null);
  const kinds = new Set(Array.from({ length: 30 }, (_, i) => pickDailyQuestion(items, `2026-12-${String(i + 1).padStart(2, '0')}`).kind));
  assert.ok(kinds.size >= 2, 'questions vary across days');
});

test('older question picks the earlier year; ties have no answer', () => {
  assert.equal(gameAnswer('older', items[0], items[3]), '10004-1');
  assert.equal(gameAnswer('pieces', { set_num: 'x', pieces: 5 }, { set_num: 'y', pieces: 5 }), null);
});

test('tower fact and tile order', () => {
  assert.equal(towerFact(1000).thing, 'house'); // 9.6 m
  assert.equal(towerFact(500).thing, 'elephant'); // 4.8 m
  assert.equal(towerFact(10).thing, null);
  assert.deepEqual(kidsTileOrder(items, [{ set_num: '10004-1', favorite: true }]).map(i => i.set_num)[0], '10004-1');
  assert.equal(themeSlug('Pokémon & Friends'), 'pokemon-friends');
});
