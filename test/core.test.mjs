import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, utf8, toHex } from '../js/sha256.js';
import { shuffledDeck, deckKeyOf, randomHex } from '../js/rng.js';
import { evaluate, evaluateHana, DEFAULT_RULES, teyakuOf, finalScore } from '../js/yaku.js';
import { createMatch, act, stepAll, snapshot, resumeMatch, cpuView, startRound, isMatchOver, reveal, verifyLog, HUMAN, CPU } from '../js/match.js';
import { decide } from '../js/cpu.js';
import { legalActions, runAuto } from '../js/engine.js';
import { CARDS } from '../js/cards.js';

test('sha256 matches node crypto', () => {
  for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'こいこい'.repeat(40)]) {
    assert.equal(toHex(sha256(utf8(s))), createHash('sha256').update(s).digest('hex'));
  }
});

test('shuffle is a deterministic permutation', () => {
  const k = deckKeyOf('aa', 'bb');
  const d = shuffledDeck(k, 1, 0);
  assert.deepEqual([...d].sort((a, b) => a - b), Array.from({ length: 48 }, (_, i) => i));
  assert.deepEqual(d, shuffledDeck(k, 1, 0));
  assert.notDeepEqual(d, shuffledDeck(k, 2, 0));
});

test('cards', () => {
  const kinds = {};
  for (const c of CARDS) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  assert.deepEqual(kinds, { light: 5, animal: 9, ribbon: 10, plain: 24 });
});

test('yaku', () => {
  const R = DEFAULT_RULES;
  assert.equal(evaluate([0, 8, 28], R).total, 5); // 三光
  assert.equal(evaluate([0, 8, 40], R).total, 0); // 雨入り三枚は役なし
  assert.equal(evaluate([0, 8, 28, 40], R).yaku[0].name, '雨四光');
  assert.equal(evaluate([0, 8, 28, 44], R).total, 8);
  assert.equal(evaluate([0, 8, 28, 40, 44], R).total, 10);
  assert.equal(evaluate([8, 32], R).total, 5); // 花見
  assert.equal(evaluate([8, 28, 32], R).total, 10); // 花見+月見
  assert.equal(evaluate([24, 36, 20], R).total, 5);
  assert.equal(evaluate([1, 5, 9], R).total, 5);
  assert.equal(evaluate([1, 5, 9, 21, 33, 37], R).total, 12); // 赤短+青短+タン2
  const plains = CARDS.filter((c) => c.kind === 'plain').map((c) => c.id);
  assert.equal(evaluate(plains.slice(0, 10), R).total, 1);
  assert.equal(evaluate([...plains.slice(0, 9), 32], R).yaku.find((y) => y.key === 'kasu').points, 1);
  assert.equal(teyakuOf([0, 1, 2, 3, 4, 8, 12, 16]).key, 'teshi');
  assert.equal(teyakuOf([0, 1, 4, 5, 8, 9, 12, 13]).key, 'kuttsuki');
  assert.equal(finalScore(7, R, true).score, 28);
  assert.equal(finalScore(3, R, false).score, 3);
});

function playMatch(levels, rounds = 12, mode = 'koikoi') {
  const rules = { ...DEFAULT_RULES, rounds, mode };
  const m = createMatch({ dealerSeed: randomHex(), cpuSeed: randomHex(), playerSeed: randomHex(8), rules, cpuLevel: levels[1] });
  const humanKey = 'f'.repeat(64);
  for (;;) {
    while (stepAll(m).phase !== 'end') {
      const s = m.state;
      if (s.turn === CPU) act(m, CPU, decide(cpuView(m), levels[1], m.cpuKey));
      else {
        const v = { ...cpuView(m) };
        // 人間側も CPU ロジック（自分視点）で打つ
        const hv = { ...v, me: HUMAN, hand: [...s.hands[HUMAN]], oppHandCount: s.hands[CPU].length };
        act(m, HUMAN, decide(hv, levels[0], humanKey));
      }
    }
    if (isMatchOver(m)) break;
    startRound(m);
  }
  return reveal(m);
}

test('full match replays and verifies', () => {
  for (const lv of [1, 2, 3]) {
    const log = JSON.parse(JSON.stringify(playMatch([2, lv], 6)));
    const v = verifyLog(log);
    assert.ok(v.pass, JSON.stringify(v.checks.filter((c) => !c.pass)));
  }
});

test('tampering is detected', () => {
  const log = JSON.parse(JSON.stringify(playMatch([2, 2], 3)));
  const t1 = structuredClone(log);
  t1.dealerSeed = '0'.repeat(64);
  assert.equal(verifyLog(t1).pass, false);
  const t2 = structuredClone(log);
  t2.totals[1] += 1;
  delete t2.logHash;
  assert.equal(verifyLog(t2).pass, false);
});

test('level 4 runs in reasonable time', () => {
  const t = Date.now();
  const log = JSON.parse(JSON.stringify(playMatch([3, 4], 2)));
  assert.ok(verifyLog(log).pass);
  console.log('lv4 2 rounds ms', Date.now() - t);
});

test('strength ordering (rough)', () => {
  const tally = (a, b, n) => {
    let diff = 0;
    for (let i = 0; i < n; i++) { const l = playMatch([a, b], 6); diff += l.totals[1] - l.totals[0]; }
    return diff / n;
  };
  console.log('lv3 vs lv1 avg diff', tally(1, 3, 20));
  console.log('lv3 vs lv2 avg diff', tally(2, 3, 20));
});

test('resume from snapshot reproduces the same state', () => {
  const rules = { ...DEFAULT_RULES, rounds: 3 };
  const m = createMatch({ dealerSeed: 'a'.repeat(64), cpuSeed: 'b'.repeat(64), playerSeed: 'p', rules, cpuLevel: 2 });
  let n = 0;
  outer: for (;;) {
    while (stepAll(m).phase !== 'end') {
      const s = m.state;
      const v = cpuView(m);
      const view = s.turn === CPU ? v : { ...v, me: HUMAN, hand: [...s.hands[HUMAN]], oppHandCount: s.hands[CPU].length };
      act(m, s.turn, decide(view, 2, m.cpuKey));
      if (++n === 25) break outer;
    }
    if (isMatchOver(m)) break;
    startRound(m);
  }
  const r = resumeMatch(JSON.parse(JSON.stringify(snapshot(m))));
  stepAll(m);
  assert.deepEqual(r.state, m.state);
  assert.deepEqual(r.log.rounds, m.log.rounds);
  assert.equal(r.log.commitment, m.log.commitment);
});

test('hanaawase: deals 10/8/10, zero-sum settlement, verifies', () => {
  for (const lv of [1, 3, 4]) {
    const log = JSON.parse(JSON.stringify(playMatch([2, lv], lv === 4 ? 2 : 4, 'hanaawase')));
    for (const r of log.rounds) {
      assert.equal(r.result.points[0] + r.result.points[1], 0);
      assert.equal(r.result.hana.cardPoints[0] + r.result.hana.cardPoints[1], 264);
      assert.equal(r.actions.filter((a) => a.type === 'play').length, 20);
    }
    const v = verifyLog(log);
    assert.ok(v.pass, JSON.stringify(v.checks.filter((c) => !c.pass)));
  }
});

test('hana yaku', () => {
  assert.equal(evaluateHana([0, 8, 28, 40, 44]).total, 200);
  assert.equal(evaluateHana([0, 8, 40]).total, 20);
  assert.equal(evaluateHana([1, 5, 9, 13, 17, 25]).total, 40 + 20 + 30);
  assert.equal(evaluateHana([8, 28, 32]).total, 20 + 20 + 0);
});
