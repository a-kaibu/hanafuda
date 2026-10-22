// こいこい・花合わせの1局ぶんの状態機械。純粋関数のみで、同じ山札と同じ行動列からは必ず同じ結果になる。
// rules.mode が 'hanaawase' のときは、こいこいの判断がなく手札を出し切って札の点数で精算する。
//
// 意思決定フェーズ（プレイヤーが選ぶ）: play / drawChoice / decide
// 自動フェーズ（advance で進む）     : playCapture / draw / drawReveal / drawCapture / check
// 終了                               : end
import { monthOf } from './cards.js';
import { evaluate, evaluateHana, hanaSettle, teyakuOf, finalScore } from './yaku.js';
import { shuffledDeck } from './rng.js';
import * as O from './oicho.js';

const clone = (s) => JSON.parse(JSON.stringify(s));
export const DECISION_PHASES = ['play', 'drawChoice', 'decide', ...O.OICHO_DECISIONS];
export const isDecision = (s) => DECISION_PHASES.includes(s.phase);

const fieldMatches = (field, card) => field.filter((c) => monthOf(c) === monthOf(card));
const hasFourOfMonth = (cards) => {
  const n = new Array(13).fill(0);
  for (const c of cards) n[monthOf(c)]++;
  return n.some((x) => x === 4);
};

const isHana = (rules) => rules.mode === 'hanaawase';
// おいちょかぶは別の状態機械（oicho.js）に任せる
export const isOicho = (rules) => rules.mode === 'oicho';

// 次の局の親：こいこい・花合わせは勝った方（流れなら据え置き）、おいちょかぶは交代
export const nextOya = (prev, rules) => (isOicho(rules) ? 1 - prev.oya : (prev.result.winner ?? prev.oya));
// 手札の枚数：こいこい8枚、花合わせ10枚。場はどちらも8枚。
export const handSizeOf = (rules) => (isHana(rules) ? 10 : 8);

// 配り方: 山札の先頭 H 枚が親の手札、次の8枚が場、次の H 枚が子の手札、残りが山札（先頭から引く）
export function dealFrom(deck, round, oya, attempt, rules) {
  const ko = 1 - oya;
  const H = handSizeOf(rules);
  const hands = [[], []];
  hands[oya] = deck.slice(0, H);
  hands[ko] = deck.slice(H + 8, 2 * H + 8);
  const s = {
    round, oya, attempt, rules,
    deck: deck.slice(2 * H + 8),
    hands,
    field: deck.slice(H, H + 8),
    captured: [[], []],
    turn: oya,
    phase: 'play',
    pending: null,
    drawn: null,
    koikoi: [false, false],
    koikoiCount: [0, 0],
    lastScore: [0, 0],
    turnsTaken: [0, 0],
    step: 0,
    newYaku: null,
    turnStartCap: 0,
    result: null,
  };
  if (rules.teyaku && !isHana(rules)) {
    for (const p of [oya, ko]) {
      const t = teyakuOf(s.hands[p]);
      if (t) {
        s.phase = 'end';
        s.result = { winner: p, base: t.points, score: t.points, mult: [], yaku: [t], teyaku: true, points: pointsFor(p, t.points) };
        break;
      }
    }
  }
  return s;
}

// 場に同じ月が4枚揃ったら配り直し（attempt を増やして別の並びを使う）
export function newRound(deckKey, round, oya, rules) {
  if (isOicho(rules)) return O.newRound(deckKey, round, oya, rules);
  for (let attempt = 0; attempt < 100; attempt++) {
    const deck = shuffledDeck(deckKey, round, attempt);
    const H = handSizeOf(rules);
    if (hasFourOfMonth(deck.slice(H, H + 8))) continue;
    return dealFrom(deck, round, oya, attempt, rules);
  }
  throw new Error('deal failed');
}

export function legalActions(s) {
  if (isOicho(s.rules)) return O.legalActions(s);
  if (s.phase === 'play') {
    const acts = [];
    for (const card of s.hands[s.turn]) {
      const m = fieldMatches(s.field, card);
      if (m.length === 2) for (const t of m) acts.push({ type: 'play', card, target: t });
      else acts.push({ type: 'play', card });
    }
    return acts;
  }
  if (s.phase === 'drawChoice') {
    return fieldMatches(s.field, s.drawn).map((t) => ({ type: 'drawChoice', target: t }));
  }
  if (s.phase === 'decide') return [{ type: 'koikoi' }, { type: 'stop' }];
  return [];
}

const sameAction = (a, b) => a.type === b.type && a.card === b.card && a.target === b.target;

export function isLegal(s, action) {
  if (isOicho(s.rules)) return O.isLegal(s, action);
  return legalActions(s).some((a) => sameAction(a, action));
}

export function apply(state, action) {
  if (isOicho(state.rules)) return O.apply(state, action);
  if (!isLegal(state, action)) throw new Error(`illegal action ${JSON.stringify(action)} in ${state.phase}`);
  const s = clone(state);
  s.step++;
  const p = s.turn;
  if (action.type === 'play') {
    s.hands[p] = s.hands[p].filter((c) => c !== action.card);
    const m = fieldMatches(s.field, action.card);
    if (m.length === 0) {
      s.field.push(action.card);
      s.phase = 'draw';
    } else {
      s.pending = { card: action.card, targets: m.length === 2 ? [action.target] : m, source: 'hand' };
      s.phase = 'playCapture';
    }
  } else if (action.type === 'drawChoice') {
    s.pending = { card: s.drawn, targets: [action.target], source: 'deck' };
    s.drawn = null;
    s.phase = 'drawCapture';
  } else if (action.type === 'koikoi') {
    s.koikoi[p] = true;
    s.koikoiCount[p]++;
    s.lastScore[p] = evaluate(s.captured[p], s.rules).total;
    s.newYaku = null;
    endTurn(s);
  } else if (action.type === 'stop') {
    win(s, p);
  }
  return s;
}

function capturePending(s) {
  const { card, targets } = s.pending;
  s.field = s.field.filter((c) => !targets.includes(c));
  s.captured[s.turn].push(card, ...targets);
  s.pending = null;
}

const pointsFor = (p, score) => (p === 0 ? [score, 0] : [0, score]);

function win(s, p) {
  const ev = evaluate(s.captured[p], s.rules);
  const f = finalScore(ev.total, s.rules, s.koikoi[1 - p]);
  s.phase = 'end';
  s.newYaku = null;
  s.result = { winner: p, base: ev.total, score: f.score, mult: f.mult, yaku: ev.yaku, points: pointsFor(p, f.score) };
}

function endTurn(s) {
  if (s.hands[0].length === 0 && s.hands[1].length === 0) {
    s.phase = 'end';
    if (isHana(s.rules)) {
      const st = hanaSettle(s.captured);
      const winner = st.points[0] > st.points[1] ? 0 : st.points[1] > st.points[0] ? 1 : null;
      s.result = { winner, score: winner == null ? 0 : st.points[winner], mult: [], yaku: winner == null ? [] : st.yaku[winner], points: st.points, hana: st };
    } else {
      s.result = { winner: null, base: 0, score: 0, mult: [], yaku: [], points: [0, 0] };
    }
    return;
  }
  s.turn = 1 - s.turn;
  s.turnStartCap = s.captured[s.turn].length;
  s.phase = 'play';
}

// 自動フェーズを1段進める
export function advance(state) {
  if (isOicho(state.rules)) return O.advance(state);
  const s = clone(state);
  switch (s.phase) {
    case 'playCapture':
      capturePending(s);
      s.phase = 'draw';
      break;
    case 'draw':
      s.drawn = s.deck.shift();
      s.phase = 'drawReveal';
      break;
    case 'drawReveal': {
      const m = fieldMatches(s.field, s.drawn);
      if (m.length === 0) {
        s.field.push(s.drawn);
        s.drawn = null;
        s.phase = 'check';
      } else if (m.length === 2) {
        s.phase = 'drawChoice';
      } else {
        s.pending = { card: s.drawn, targets: m, source: 'deck' };
        s.drawn = null;
        s.phase = 'drawCapture';
      }
      break;
    }
    case 'drawCapture':
      capturePending(s);
      s.phase = 'check';
      break;
    case 'check': {
      const p = s.turn;
      s.turnsTaken[p]++;
      if (isHana(s.rules)) {
        // 花合わせ：こいこいはなく、新しくできた出来役を知らせるだけ
        const prev = new Set(evaluateHana(s.captured[p].slice(0, s.turnStartCap)).yaku.map((y) => y.key));
        const now = evaluateHana(s.captured[p]).yaku;
        s.newYaku = now.filter((y) => !prev.has(y.key));
        if (!s.newYaku.length) s.newYaku = null;
        endTurn(s);
        break;
      }
      const ev = evaluate(s.captured[p], s.rules);
      if (ev.total > s.lastScore[p]) {
        const prev = evaluate(s.captured[p].slice(0, s.turnStartCap), s.rules).yaku;
        const before = new Map(prev.map((y) => [y.key, y.points]));
        s.newYaku = ev.yaku.filter((y) => !before.has(y.key) || before.get(y.key) < y.points);
        if (s.hands[p].length === 0) win(s, p);
        else s.phase = 'decide';
      } else {
        endTurn(s);
      }
      break;
    }
    default:
      throw new Error(`cannot advance from ${s.phase}`);
  }
  return s;
}

// 次の意思決定か終局まで自動フェーズを進める
export function runAuto(state) {
  let s = state;
  while (s.phase !== 'end' && !isDecision(s)) s = advance(s);
  return s;
}

// プレイヤー p から見える情報だけを取り出す。CPU にはこれしか渡さない。
export function viewFor(s, p, extra = {}) {
  if (isOicho(s.rules)) return O.viewFor(s, p, extra);
  return {
    me: p,
    round: s.round,
    oya: s.oya,
    phase: s.phase,
    turn: s.turn,
    step: s.step,
    rules: { ...s.rules },
    hand: [...s.hands[p]],
    oppHandCount: s.hands[1 - p].length,
    field: [...s.field],
    captured: [[...s.captured[0]], [...s.captured[1]]],
    deckCount: s.deck.length,
    drawn: s.drawn, // 山札からめくられて公開済みの札
    koikoi: [...s.koikoi],
    lastScore: [...s.lastScore],
    turnsTaken: [...s.turnsTaken],
    legal: legalActions(s),
    ...extra,
  };
}
