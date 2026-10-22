// おいちょかぶ（1対1：親と子）の1局ぶんの状態機械。engine.js と同じ形の純粋関数で、
// 同じ山札と同じ行動列からは必ず同じ結果になる。
//
// 札は1月〜10月の40枚。札の数は月の数（10月は0）、手の数は合計の一の位。
// 1枚目は伏せ札（持ち主だけが見られる）、2枚目以降は表向き。
//
// 意思決定フェーズ: bet（子が賭ける）/ hit（もう1枚引くか）
// 自動フェーズ    : deal2 / turnCheck / draw3 / showdown
// 終了            : end
import { monthOf } from './cards.js';
import { shuffledDeck } from './rng.js';

const clone = (s) => JSON.parse(JSON.stringify(s));
export const BETS = [1, 2, 3, 5];
export const OICHO_DECISIONS = ['bet', 'hit'];
export const HAND_NAMES = ['ブタ', 'ピン', 'ニゾウ', 'サンタ', 'ヨツヤ', 'ゴケ', 'ロッポウ', 'ナキ', 'オイチョ', 'カブ'];

export const cardNum = (c) => monthOf(c) % 10;
export const handValue = (cards) => cards.reduce((s, c) => s + cardNum(c), 0) % 10;
const pair = (h, a, b) => h.length >= 2 && ((monthOf(h[0]) === a && monthOf(h[1]) === b) || (monthOf(h[0]) === b && monthOf(h[1]) === a));
export const isArashi = (h) => h.length === 3 && h.every((c) => monthOf(c) === monthOf(h[0]));
export const isShippin = (h) => h.length === 2 && pair(h, 4, 1); // 子だけの役
export const isKuppin = (h) => h.length === 2 && pair(h, 9, 1); // 親だけの役

// 手の強さ：rank が大きい方が勝ち、同じなら value、それも同じなら親の勝ち
export function handRank(h, isOya) {
  if (isArashi(h)) return { rank: 3, value: 0, mult: 3, key: 'arashi', name: 'アラシ' };
  if (!isOya && isShippin(h)) return { rank: 2, value: 0, mult: 2, key: 'shippin', name: 'シッピン' };
  if (isOya && isKuppin(h)) return { rank: 2, value: 0, mult: 2, key: 'kuppin', name: 'クッピン' };
  const v = handValue(h);
  return { rank: 1, value: v, mult: 1, key: `v${v}`, name: HAND_NAMES[v] };
}

// 2枚の時点で引くか：3以下は必ず引く、7以上と特別な役は必ず止める、4〜6は自由
export function forcedChoice(h, isOya) {
  if (h.length >= 3) return 'stand';
  if (isOya ? isKuppin(h) : isShippin(h)) return 'stand';
  const v = handValue(h);
  if (v <= 3) return 'hit';
  if (v >= 7) return 'stand';
  return null;
}

export function newRound(deckKey, round, oya, rules) {
  const deck = shuffledDeck(deckKey, round, 0).filter((c) => c < 40);
  const ko = 1 - oya;
  const hands = [[], []];
  hands[ko].push(deck[0]);
  hands[oya].push(deck[1]);
  return {
    round, oya, attempt: 0, rules,
    deck: deck.slice(2),
    hands,
    field: [],
    captured: [[], []],
    bet: null,
    choice: [null, null], // 'hit' / 'stand'（自動で決まったときは auto: true）
    auto: [false, false],
    turn: ko,
    phase: 'bet',
    step: 0,
    result: null,
  };
}

export function legalActions(s) {
  if (s.phase === 'bet') return BETS.map((amount) => ({ type: 'bet', amount }));
  if (s.phase === 'hit') return [{ type: 'hit' }, { type: 'stand' }];
  return [];
}

export function isLegal(s, action) {
  return legalActions(s).some((a) => a.type === action.type && a.amount === action.amount && Object.keys(action).length === Object.keys(a).length);
}

function nextTurn(s) {
  if (s.turn !== s.oya) {
    s.turn = s.oya;
    s.phase = 'turnCheck';
  } else {
    s.phase = 'showdown';
  }
}

export function apply(state, action) {
  if (!isLegal(state, action)) throw new Error(`illegal action ${JSON.stringify(action)} in ${state.phase}`);
  const s = clone(state);
  s.step++;
  if (action.type === 'bet') {
    s.bet = action.amount;
    s.phase = 'deal2';
  } else if (action.type === 'hit') {
    s.choice[s.turn] = 'hit';
    s.phase = 'draw3';
  } else if (action.type === 'stand') {
    s.choice[s.turn] = 'stand';
    nextTurn(s);
  }
  return s;
}

export function advance(state) {
  const s = clone(state);
  const ko = 1 - s.oya;
  switch (s.phase) {
    case 'deal2':
      s.hands[ko].push(s.deck.shift());
      s.hands[s.oya].push(s.deck.shift());
      s.turn = ko;
      s.phase = 'turnCheck';
      break;
    case 'turnCheck': {
      const f = forcedChoice(s.hands[s.turn], s.turn === s.oya);
      if (f) {
        s.choice[s.turn] = f;
        s.auto[s.turn] = true;
        if (f === 'hit') s.phase = 'draw3';
        else nextTurn(s);
      } else {
        s.phase = 'hit';
      }
      break;
    }
    case 'draw3':
      s.hands[s.turn].push(s.deck.shift());
      nextTurn(s);
      break;
    case 'showdown':
      settle(s);
      break;
    default:
      throw new Error(`cannot advance from ${s.phase}`);
  }
  return s;
}

function settle(s) {
  const ko = 1 - s.oya;
  const r = [0, 1].map((p) => handRank(s.hands[p], p === s.oya));
  const a = r[ko];
  const b = r[s.oya];
  const koWins = a.rank > b.rank || (a.rank === b.rank && a.rank === 1 && a.value > b.value);
  const winner = koWins ? ko : s.oya;
  const w = r[winner];
  const score = s.bet * w.mult;
  const points = winner === 0 ? [score, -score] : [-score, score];
  s.phase = 'end';
  s.result = {
    winner,
    score,
    mult: w.mult > 1 ? [`${w.name} ×${w.mult}`] : [],
    yaku: [{ key: w.key, name: w.name, points: score }],
    points,
    oicho: { hands: s.hands.map((h) => [...h]), ranks: r, bet: s.bet },
  };
}

// プレイヤー p から見える情報。相手の伏せ札（1枚目）は局が終わるまで渡さない。
export function viewFor(s, p, extra = {}) {
  const opp = s.hands[1 - p];
  return {
    me: p,
    round: s.round,
    oya: s.oya,
    phase: s.phase,
    turn: s.turn,
    step: s.step,
    rules: { ...s.rules },
    hand: [...s.hands[p]],
    oppUp: s.phase === 'end' ? [...opp] : opp.slice(1),
    oppCount: opp.length,
    bet: s.bet,
    choice: [...s.choice],
    auto: [...s.auto],
    deckCount: s.deck.length,
    legal: legalActions(s),
    ...extra,
  };
}
