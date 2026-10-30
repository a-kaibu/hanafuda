// 点数計算ページの計算部分
import test from 'node:test';
import assert from 'node:assert/strict';
import { koikoiRound, hanaRound } from '../js/score-core.js';
import { DEFAULT_RULES, hanaSettle } from '../js/yaku.js';

const rules = { ...DEFAULT_RULES };

test('こいこい: 取り札から役を判定し、上がった人に加点・相手に減点', () => {
  // 赤短 + 短冊5枚（タン1）= 6点
  const r = koikoiRound({ winner: 1, method: 'cards', cards: [1, 5, 9, 13, 17] }, rules);
  assert.equal(r.base, 6);
  assert.deepEqual(r.points, [-6, 6]);
});

test('こいこい: 7点以上とこいこい返しで倍になる', () => {
  // 猪鹿蝶 5 + 花見で一杯 5 = 10 → ×2 ×2
  const r = koikoiRound({ winner: 0, method: 'cards', cards: [20, 24, 36, 8, 32], oppKoikoi: true }, rules);
  assert.equal(r.base, 10);
  assert.equal(r.score, 40);
  assert.equal(r.mult.length, 2);
  const off = koikoiRound({ winner: 0, method: 'cards', cards: [20, 24, 36, 8, 32], oppKoikoi: true }, { ...rules, sevenDouble: false, koikoiDouble: false });
  assert.equal(off.score, 10);
});

test('こいこい: 役を手で選ぶ・手役・流れ', () => {
  const m = koikoiRound({ winner: 0, method: 'manual', manual: { keys: ['akatan', 'sanko'], counts: { tan: 6, kasu: 4 } } }, rules);
  assert.equal(m.base, 12); // 5 + 5 + タン2、カス4枚は役にならない
  assert.equal(m.score, 24);
  const t = koikoiRound({ winner: 1, method: 'teyaku', oppKoikoi: true }, rules);
  assert.deepEqual(t.points, [-6, 6]);
  assert.deepEqual(koikoiRound({ winner: null }, rules).points, [0, 0]);
});

test('こいこい: 菊に盃のルール設定が効く', () => {
  const cards = [8, 32];
  assert.equal(koikoiRound({ winner: 0, method: 'cards', cards }, rules).base, 5);
  assert.equal(koikoiRound({ winner: 0, method: 'cards', cards }, { ...rules, sakeYaku: false }).base, 0);
  assert.equal(koikoiRound({ winner: 0, method: 'manual', manual: { keys: ['hanami'] } }, { ...rules, sakeYaku: false }).base, 0);
});

test('花合わせ 2人: ゲームの精算と同じになる', () => {
  const a = [0, 8, 28, 1, 5, 9, 2, 3, 6, 7, 10, 11, 20, 24, 36, 21, 33, 37];
  const set = new Set(a);
  const b = [...Array(48).keys()].filter((c) => !set.has(c));
  assert.deepEqual(hanaRound([a, b]).points, hanaSettle([a, b]).points);
});

test('花合わせ 3人: 基準88点でゼロサム、出来役は2人から受け取る', () => {
  const a = [0, 8, 28]; // 三光 20、札60
  const b = [...Array(20).keys()].map((i) => i + 12).filter((c) => c !== 28);
  const used = new Set([...a, ...b]);
  const c = [...Array(48).keys()].filter((x) => !used.has(x));
  const r = hanaRound([a, b, c]);
  assert.equal(r.base, 88);
  assert.equal(r.points.reduce((s, p) => s + p, 0), 0);
  assert.equal(r.points[0], 60 - 88 + r.yakuTotal[0] * 3 - (r.yakuTotal[0] + r.yakuTotal[1] + r.yakuTotal[2]));
});
