// おいちょかぶの CPU。受け取るのは viewFor() の公開情報だけ（自分の札・相手の表向きの札・賭け金・相手が引いたかどうか）。
// 相手の伏せ札と山札の順番は渡されないので、見えない札は「残りのどれか」として確率で考える。
import { monthOf } from './cards.js';
import { BETS, cardNum, handRank, forcedChoice } from './oicho.js';

const ALL = Array.from({ length: 40 }, (_, i) => i);
const unknownOf = (view) => {
  const known = new Set([...view.hand, ...view.oppUp]);
  return ALL.filter((c) => !known.has(c));
};

// 子が勝つか（同点・同じ役は親の勝ち）
function koWins(koHand, oyaHand) {
  const a = handRank(koHand, false);
  const b = handRank(oyaHand, true);
  return a.rank > b.rank || (a.rank === b.rank && a.rank === 1 && a.value > b.value);
}
const multOf = (h, isOya) => handRank(h, isOya).mult;

// 相手の「引く／止める」のモデル（4〜6のときに引く確率）
const HIT_MODEL = { 4: 0.85, 5: 0.5, 6: 0.15 };
const v2 = (h) => (cardNum(h[0]) + cardNum(h[1])) % 10;
function hitProb(h, isOya) {
  const f = forcedChoice(h, isOya);
  if (f) return f === 'hit' ? 1 : 0;
  return HIT_MODEL[v2(h)];
}

// 中級の目安：5以下なら引く
const basicHit = (h, isOya) => {
  const f = forcedChoice(h, isOya);
  return f ? f === 'hit' : v2(h) <= 5;
};

// 子として、2枚の手 h で「止める／引く」の期待点（賭け金1あたり）
function koEV(h, oyaUp, unknown, hit) {
  let sum = 0;
  let n = 0;
  for (const hole of unknown) {
    const rest = unknown.filter((c) => c !== hole);
    const oya2 = [hole, oyaUp];
    const kos = hit ? rest.map((c) => [...h, c]) : [h];
    for (const k of kos) {
      const rest2 = hit ? rest.filter((c) => c !== k[2]) : rest;
      // 親は5以下なら引くと仮定
      if (basicHit(oya2, true)) {
        let s2 = 0;
        for (const c of rest2) s2 += payoff(k, [...oya2, c]);
        sum += s2 / rest2.length;
      } else {
        sum += payoff(k, oya2);
      }
      n++;
    }
  }
  return sum / n;
}
const payoff = (ko, oya) => (koWins(ko, oya) ? multOf(ko, false) : -multOf(oya, true));

// 親として、2枚の手 h で「止める／引く」の期待点（子の得点を正とした値を返すので小さいほど良い）
function oyaEV(h, koUp, unknown, hit, infer) {
  let sum = 0;
  let wsum = 0;
  for (const hole of unknown) {
    const ko = [hole, ...koUp];
    // 達人は、子が引いたか止めたかから伏せ札を推理する
    let w = 1;
    if (infer) {
      const p = hitProb(ko.slice(0, 2), false);
      w = ko.length === 3 ? p : 1 - p;
      if (w <= 0) continue;
    }
    const rest = unknown.filter((c) => c !== hole);
    let v;
    if (hit) {
      v = 0;
      for (const c of rest) v += payoff(ko, [...h, c]);
      v /= rest.length;
    } else {
      v = payoff(ko, h);
    }
    sum += w * v;
    wsum += w;
  }
  return wsum ? sum / wsum : 0;
}

// 子の1枚目だけを見て、賭け金1あたりの期待点を見積もる（乱数で何局か想定する）
function betEV(first, unknown, rng, trials) {
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    const u = [...unknown];
    const take = () => u.splice(rng.uniform(u.length), 1)[0];
    const oya = [take(), take()];
    const ko = [first, take()];
    if (basicHit(ko, false)) ko.push(take());
    if (basicHit(oya, true)) oya.push(take());
    sum += payoff(ko, oya);
  }
  return sum / trials;
}

export function decideOicho(view, level, rng) {
  const isOya = view.me === view.oya;
  const unknown = unknownOf(view);
  if (view.phase === 'bet') {
    const first = view.hand[0];
    if (level === 1) return { type: 'bet', amount: BETS[rng.uniform(BETS.length)] };
    // 中級：シッピン（4と1）の芽がある1枚目なら多めに賭ける
    if (level === 2) return { type: 'bet', amount: [1, 4].includes(monthOf(first)) ? 3 : 2 };
    const ev = betEV(first, unknown, rng, level === 4 ? 1200 : 400);
    const amount = ev > 0.05 ? 5 : ev > 0 ? 3 : ev > -0.08 ? 2 : 1;
    return { type: 'bet', amount };
  }
  if (view.phase === 'hit') {
    const h = view.hand;
    if (level === 1) return { type: rng.random() < 0.5 ? 'hit' : 'stand' };
    if (level === 2) return { type: basicHit(h, isOya) ? 'hit' : 'stand' };
    if (!isOya) {
      const stand = koEV(h, view.oppUp[0], unknown, false);
      const hit = koEV(h, view.oppUp[0], unknown, true);
      return { type: hit > stand ? 'hit' : 'stand' };
    }
    const stand = oyaEV(h, view.oppUp, unknown, false, level === 4);
    const hit = oyaEV(h, view.oppUp, unknown, true, level === 4);
    return { type: hit < stand ? 'hit' : 'stand' };
  }
  return view.legal[0];
}
