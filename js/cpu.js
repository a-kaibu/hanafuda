// CPU の思考ルーチン。
// 受け取るのは viewFor() が作る「公開情報」だけ（自分の手札・場・双方の取り札・枚数など）。
// 相手の手札と山札の順番は一切渡されないので、見ることも変えることもできない。
// 乱数は cpuKey と局・手番から決まるので、同じ公開情報からは必ず同じ手を選ぶ（後から再現検証できる）。
import { CARDS, ID, monthOf } from './cards.js';
import { evaluate, evaluateHana, finalScore, KUSA } from './yaku.js';
import { Stream } from './rng.js';
import { apply, advance, isDecision, legalActions } from './engine.js';
import { decideOicho } from './oicho-cpu.js';

export const LEVELS = [
  { id: 1, name: '初級', desc: 'ときどき気まぐれに打つ' },
  { id: 2, name: '中級', desc: '目の前の得を取りにいく' },
  { id: 3, name: '上級', desc: '山札の期待値と相手の役を読む' },
  { id: 4, name: '達人', desc: '見えない札を何通りも想定して先読みする' },
];

const PLAYOUT_LEVEL = 3; // 仮想対局で双方が使う打ち方
const WORLDS = 24; // 想定する「見えない札の配置」の数
const BASE = { light: 5, animal: 2.4, ribbon: 2.4, plain: 0.8 };
const SETS = [
  { cards: [ID.BOAR, ID.DEER, ID.BUTTERFLY], need: 3, pts: 5 },
  { cards: ID.AKA, need: 3, pts: 5 },
  { cards: ID.AO, need: 3, pts: 5 },
  { cards: [ID.CURTAIN, ID.SAKE], need: 2, pts: 5 },
  { cards: [ID.MOON, ID.SAKE], need: 2, pts: 5 },
  { cards: [ID.CRANE, ID.CURTAIN, ID.MOON, ID.PHOENIX], need: 3, pts: 5 },
];

// 花合わせ用：札そのものの点数が大きく、出来役は相手からも取れる
const HANA_BASE_V = { light: 8, animal: 4, ribbon: 2, plain: 0.4 };
const HANA_SETS = [
  { cards: [ID.BOAR, ID.DEER, ID.BUTTERFLY], need: 3, pts: 20 },
  { cards: ID.AKA, need: 3, pts: 40 },
  { cards: ID.AO, need: 3, pts: 40 },
  { cards: KUSA, need: 3, pts: 20 },
  { cards: [ID.CURTAIN, ID.SAKE], need: 2, pts: 20 },
  { cards: [ID.MOON, ID.SAKE], need: 2, pts: 20 },
  { cards: [ID.CRANE, ID.CURTAIN, ID.MOON, ID.RAINMAN, ID.PHOENIX], need: 3, pts: 20 },
];
const isHana = (rules) => rules.mode === 'hanaawase';

function cardValueHana(c, mine, opp) {
  const card = CARDS[c];
  let v = HANA_BASE_V[card.kind];
  for (const S of HANA_SETS) {
    if (!S.cards.includes(c)) continue;
    const oppIn = S.cards.filter((x) => opp.includes(x)).length;
    if (S.cards.length - oppIn < S.need) continue;
    const have = S.cards.filter((x) => mine.includes(x)).length + 1;
    v += (S.pts * have) / S.need / 6;
    if (have === S.need) v += S.pts / 2.5;
  }
  if (card.kind === 'ribbon') {
    const n = mine.filter((x) => CARDS[x].kind === 'ribbon').length + 1;
    if (n >= 5) v += 2;
  }
  return v;
}

const kindCount = (cards, kind, rules) =>
  cards.filter((c) => CARDS[c].kind === kind || (kind === 'plain' && rules.sakeAsPlain && c === ID.SAKE)).length;

// 札 c を「mine を持っている側」が取ったときの価値（opp は相手の取り札）
function cardValue(c, mine, opp, rules) {
  if (isHana(rules)) return cardValueHana(c, mine, opp);
  const card = CARDS[c];
  let v = BASE[card.kind];
  for (const S of SETS) {
    if (!S.cards.includes(c)) continue;
    if (S.cards.some((x) => opp.includes(x)) && S.need === S.cards.length) continue;
    const oppIn = S.cards.filter((x) => opp.includes(x)).length;
    if (S.cards.length - oppIn < S.need) continue;
    const have = S.cards.filter((x) => mine.includes(x)).length + 1;
    v += (S.pts * have) / S.need / 1.5;
    if (have === S.need) v += S.pts;
  }
  const thr = { animal: 5, ribbon: 5, plain: 10 }[card.kind];
  if (thr) {
    const n = kindCount(mine, card.kind, rules) + 1;
    if (n >= thr) v += 1.5;
    else if (n >= thr - 2) v += 0.5;
  }
  if (c === ID.SAKE && rules.sakeAsPlain) {
    const n = kindCount(mine, 'plain', rules) + 1;
    if (n >= 10) v += 1;
  }
  return v;
}

// cards を自分が取る価値 + 相手に渡さない価値
function gain(cards, mine, opp, rules, denial = 0.7) {
  let v = 0;
  const m = [...mine];
  for (const c of cards) {
    v += cardValue(c, m, opp, rules) + denial * cardValue(c, opp, m, rules);
    m.push(c);
  }
  if (isHana(rules)) v += (evaluateHana(m).total - evaluateHana(mine).total) / 3;
  else v += 4 * (evaluate(m, rules).total - evaluate(mine, rules).total);
  return v;
}

function unknownCards(view) {
  const known = new Set([...view.hand, ...view.field, ...view.captured[0], ...view.captured[1]]);
  if (view.drawn != null) known.add(view.drawn);
  return CARDS.map((c) => c.id).filter((id) => !known.has(id));
}

// 相手が手札 h 枚の中に月 mo の札を持っている確率（未知札から一様に配られているとみなす）
function pOppHasMonth(mo, unknown, h) {
  const u = unknown.filter((c) => monthOf(c) === mo).length;
  const U = unknown.length;
  if (u === 0 || h === 0) return 0;
  let p = 1;
  for (let i = 0; i < h; i++) p *= (U - u - i) / (U - i);
  return 1 - Math.max(0, p);
}

const matchesOf = (field, c) => field.filter((f) => monthOf(f) === monthOf(c));

// 手札から1枚打った直後の結果（取り札と場）
function simulatePlay(view, a) {
  const m = matchesOf(view.field, a.card);
  if (m.length === 0) return { taken: [], field: [...view.field, a.card] };
  const targets = m.length === 2 ? [a.target] : m;
  return { taken: [a.card, ...targets], field: view.field.filter((f) => !targets.includes(f)) };
}

// 場に残った札を相手に取られる危険度
function exposure(field, view, mine, opp, unknown) {
  let risk = 0;
  const seen = new Set();
  for (const f of field) {
    const mo = monthOf(f);
    if (seen.has(mo)) continue;
    seen.add(mo);
    const group = field.filter((x) => monthOf(x) === mo);
    const p = pOppHasMonth(mo, unknown, view.oppHandCount);
    const best = Math.max(...group.map((x) => cardValue(x, opp, mine, view.rules)));
    risk += p * best;
  }
  return risk;
}

// 山札から1枚めくったときの期待値
function drawEV(field, mine, opp, view, unknown) {
  if (unknown.length === 0 || view.deckCount === 0) return 0;
  let total = 0;
  for (const d of unknown) {
    const m = matchesOf(field, d);
    if (m.length === 0) total -= 0.3 * cardValue(d, opp, mine, view.rules);
    else if (m.length === 2) total += Math.max(...m.map((t) => gain([d, t], mine, opp, view.rules)));
    else total += gain([d, ...m], mine, opp, view.rules);
  }
  return total / unknown.length;
}

function scorePlay(view, a, level, unknown) {
  const me = view.me;
  const mine = view.captured[me];
  const opp = view.captured[1 - me];
  const r = simulatePlay(view, a);
  let v;
  if (r.taken.length) v = gain(r.taken, mine, opp, view.rules);
  else {
    // 捨て札：相手に取られやすい・相手の役になる札ほど損
    const p = pOppHasMonth(monthOf(a.card), unknown, view.oppHandCount);
    v = -(0.4 + p) * cardValue(a.card, opp, mine, view.rules) - 0.15 * cardValue(a.card, mine, opp, view.rules);
    // 手札に同じ月がもう1枚あるなら次に回収しやすい
    if (view.hand.some((h) => h !== a.card && monthOf(h) === monthOf(a.card))) v += 0.8;
  }
  if (level >= 3) {
    const mine2 = [...mine, ...r.taken];
    // 花合わせは札点の振れ幅が大きく、山札の期待値を足すとかえって弱くなった（自動対戦で確認）
    const [de, ex] = isHana(view.rules) ? [0, 0.3] : [0.8, 0.6];
    v += de * drawEV(r.field, mine2, opp, view, unknown);
    v -= ex * exposure(r.field, view, mine2, opp, unknown);
  }
  return v;
}

// ---- 達人用：見えない札を想定した仮想対局 ----
function sampleWorld(view, rng) {
  const unknown = unknownCards(view);
  for (let i = unknown.length - 1; i > 0; i--) {
    const j = rng.uniform(i + 1);
    [unknown[i], unknown[j]] = [unknown[j], unknown[i]];
  }
  const oppHand = unknown.slice(0, view.oppHandCount);
  const deck = unknown.slice(view.oppHandCount, view.oppHandCount + view.deckCount);
  const hands = [[], []];
  hands[view.me] = [...view.hand];
  hands[1 - view.me] = oppHand;
  return {
    round: view.round, oya: view.oya, attempt: 0, rules: view.rules,
    deck, hands, field: [...view.field],
    captured: [[...view.captured[0]], [...view.captured[1]]],
    turn: view.turn, phase: view.phase, pending: null, drawn: view.drawn,
    koikoi: [...view.koikoi], koikoiCount: [0, 0], lastScore: [...view.lastScore],
    turnsTaken: [...view.turnsTaken], step: view.step, newYaku: null,
    turnStartCap: view.captured[view.turn].length, result: null,
  };
}

function fastView(s, p) {
  return {
    me: p, round: s.round, oya: s.oya, phase: s.phase, turn: s.turn, step: s.step,
    rules: s.rules, hand: s.hands[p], oppHandCount: s.hands[1 - p].length, field: s.field,
    captured: s.captured, deckCount: s.deck.length, drawn: s.drawn, koikoi: s.koikoi,
    lastScore: s.lastScore, turnsTaken: s.turnsTaken, legal: legalActions(s),
  };
}

function playout(s, maxSteps = 200) {
  let st = s;
  for (let i = 0; i < maxSteps && st.phase !== 'end'; i++) {
    if (isDecision(st)) st = apply(st, heuristic(fastView(st, st.turn), PLAYOUT_LEVEL, null));
    else st = advance(st);
  }
  return st.result ? st.result.points : [0, 0];
}

function montecarlo(view, candidates, rng, worlds) {
  const me = view.me;
  const totals = candidates.map(() => 0);
  for (let w = 0; w < worlds; w++) {
    const world = sampleWorld(view, rng);
    candidates.forEach((a, i) => {
      const pts = playout(apply(world, a));
      totals[i] += (pts[me] - pts[1 - me]) / (isHana(view.rules) ? 10 : 1);
    });
  }
  return totals.map((t) => t / worlds);
}

// 相手があと少しで役を作りそうか（0〜1）
function threat(view) {
  const me = view.me;
  const opp = view.captured[1 - me];
  const mine = view.captured[me];
  const unknown = new Set(unknownCards(view).concat(view.field));
  let t = 0;
  for (const S of SETS) {
    const missing = S.cards.filter((c) => !opp.includes(c));
    if (missing.some((c) => mine.includes(c)) && S.need === S.cards.length) continue;
    const have = S.cards.length - missing.length;
    const need = S.need - have;
    if (need <= 0) continue;
    const avail = missing.filter((c) => unknown.has(c)).length;
    if (avail < need) continue;
    t = Math.max(t, need === 1 ? 0.55 : need === 2 ? 0.2 : 0.05);
  }
  for (const [kind, thr] of [['animal', 5], ['ribbon', 5], ['plain', 10]]) {
    const n = kindCount(opp, kind, view.rules);
    if (n === thr - 1) t = Math.max(t, 0.45);
    else if (n === thr - 2) t = Math.max(t, 0.2);
  }
  return Math.min(1, t + 0.04 * view.koikoi.filter(Boolean).length);
}

function decideKoikoi(view, level, rng) {
  const me = view.me;
  const base = evaluate(view.captured[me], view.rules).total;
  const handLeft = view.hand.length;
  const now = finalScore(base, view.rules, view.koikoi[1 - me]).score;
  if (level === 1) return rng.random() < (handLeft >= 4 ? 0.5 : 0.2) ? 'koikoi' : 'stop';
  if (level === 2) return base <= 2 && handLeft >= 5 && !view.koikoi[1 - me] ? 'koikoi' : 'stop';
  const th = threat(view);
  let koikoi = handLeft >= 3 && th < 0.3 && now < 6;
  // 7点の倍付けが近いならもう一押し
  if (view.rules.sevenDouble && base >= 5 && base <= 6 && handLeft >= 4 && th < 0.2) koikoi = true;
  if (view.koikoi[1 - me]) koikoi = false; // 相手のこいこいを返せるなら確実に上がる
  // 試合の流れ：大差で負けていて最終盤なら攻める
  if (view.matchScores && view.roundsTotal) {
    const diff = view.matchScores[me] - view.matchScores[1 - me];
    const last = view.round >= view.roundsTotal;
    if (last && diff + now <= 0 && handLeft >= 2) koikoi = true;
    if (last && diff + now > 0) koikoi = false;
  }
  if (level === 4 && !view.koikoi[1 - me] && handLeft >= 2) {
    const [ev] = montecarlo({ ...view, phase: 'decide' }, [{ type: 'koikoi' }], rng, 24);
    const last = view.matchScores && view.round >= view.roundsTotal;
    if (!last) koikoi = ev > now * 1.15 && th < 0.5;
  }
  return koikoi ? 'koikoi' : 'stop';
}

function heuristic(view, level, rng) {
  if (view.phase === 'decide') return { type: decideKoikoi(view, level, rng) };
  const unknown = unknownCards(view);
  if (view.phase === 'drawChoice') {
    const mine = view.captured[view.me];
    const opp = view.captured[1 - view.me];
    const opts = view.legal;
    if (level === 1 && rng && rng.random() < 0.5) return opts[rng.uniform(opts.length)];
    let best = opts[0];
    let bv = -Infinity;
    for (const a of opts) {
      const v = gain([view.drawn, a.target], mine, opp, view.rules);
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }
  const acts = view.legal;
  if (level === 1 && rng && rng.random() < 0.55) return acts[rng.uniform(acts.length)];
  let best = acts[0];
  let bv = -Infinity;
  for (const a of acts) {
    let v = scorePlay(view, a, level, unknown);
    if (level === 2 && rng) v += rng.random() * 0.6;
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}

export function decide(view, level, cpuKey) {
  const rng = new Stream(cpuKey, `round:${view.round}:step:${view.step}`);
  if (view.rules.mode === 'oicho') return decideOicho(view, level, rng);
  if (level === 4 && view.phase === 'play' && view.legal.length > 1) {
    // 上級の評価で候補を絞ってから仮想対局で比べる
    const unknown = unknownCards(view);
    const ranked = view.legal
      .map((a) => ({ a, v: scorePlay(view, a, 3, unknown) }))
      .sort((x, y) => y.v - x.v)
      .slice(0, 4);
    const evs = montecarlo(view, ranked.map((r) => r.a), rng, WORLDS);
    let bi = 0;
    evs.forEach((e, i) => {
      const s = e + ranked[i].v * 0.15;
      const b = evs[bi] + ranked[bi].v * 0.15;
      if (s > b) bi = i;
    });
    return ranked[bi].a;
  }
  return heuristic(view, level, rng);
}
