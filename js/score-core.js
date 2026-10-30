// 実物の札で遊ぶときの点数計算（画面に依存しない部分）。役の判定は yaku.js を使う。
import { CARDS, KIND_POINT } from './cards.js';
import { evaluate, evaluateHana, finalScore, cardPoints } from './yaku.js';

export const TOTAL_CARD_POINTS = 264;

// こいこいの役を手で選ぶとき用（光の役はどれか一つ）
export const KOI_MANUAL_YAKU = [
  { key: 'goko', name: '五光', points: 10, group: 'light' },
  { key: 'shiko', name: '四光', points: 8, group: 'light' },
  { key: 'ameshiko', name: '雨四光', points: 7, group: 'light' },
  { key: 'sanko', name: '三光', points: 5, group: 'light' },
  { key: 'hanami', name: '花見で一杯', points: 5, sake: true },
  { key: 'tsukimi', name: '月見で一杯', points: 5, sake: true },
  { key: 'inoshikacho', name: '猪鹿蝶', points: 5 },
  { key: 'akatan', name: '赤短', points: 5 },
  { key: 'aotan', name: '青短', points: 5 },
];
// 枚数で点が決まる役：min 枚で1点、以降1枚ごとに+1
export const KOI_COUNT_YAKU = [
  { key: 'tane', name: 'タネ', min: 5, max: 9 },
  { key: 'tan', name: 'タン', min: 5, max: 10 },
  { key: 'kasu', name: 'カス', min: 10, max: 25 },
];

// こいこいの1局。input:
//   winner: 上がった人の番号（null なら流れて0点）
//   method: 'cards'（取り札から判定）/ 'manual'（役を選ぶ）/ 'teyaku'（手四・くっつき 6点）
//   cards: 取り札の id 配列、manual: { keys: [...], counts: { tane, tan, kasu } }
//   oppKoikoi: 相手がこいこいしていた
export function koikoiRound(input, rules, players = 2) {
  const points = Array(players).fill(0);
  if (input.winner == null) return { points, base: 0, score: 0, yaku: [], mult: [] };
  let yaku;
  if (input.method === 'teyaku') {
    yaku = [{ key: 'teyaku', name: '手役', points: 6 }];
  } else if (input.method === 'manual') {
    yaku = manualYaku(input.manual, rules);
  } else {
    yaku = evaluate(input.cards || [], rules).yaku.map(({ key, name, points: p }) => ({ key, name, points: p }));
  }
  const base = yaku.reduce((s, y) => s + y.points, 0);
  // 手役は配った直後に決まるので、こいこい返しの倍は付けない
  const { score, mult } = base > 0
    ? finalScore(base, rules, input.method !== 'teyaku' && !!input.oppKoikoi)
    : { score: 0, mult: [] };
  points[input.winner] = score;
  if (players === 2) points[1 - input.winner] = -score;
  return { points, base, score, yaku, mult };
}

function manualYaku(manual = {}, rules) {
  const keys = new Set(manual.keys || []);
  const out = [];
  for (const y of KOI_MANUAL_YAKU) {
    if (!keys.has(y.key)) continue;
    if (y.sake && !rules.sakeYaku) continue;
    out.push({ key: y.key, name: y.name, points: y.points });
  }
  for (const y of KOI_COUNT_YAKU) {
    const n = manual.counts?.[y.key] || 0;
    if (n >= y.min) out.push({ key: y.key, name: `${y.name}（${n}枚）`, points: n - y.min + 1 });
  }
  return out;
}

// 花合わせの1局。captured: 人数ぶんの取り札配列。
// 基準点は 264 ÷ 人数（2人なら132、3人なら88）。出来役は他の全員から受け取る。
export function hanaRound(captured) {
  const n = captured.length;
  const base = TOTAL_CARD_POINTS / n;
  const cp = captured.map(cardPoints);
  const ev = captured.map((c) => evaluateHana(c));
  const yakuSum = ev.reduce((s, e) => s + e.total, 0);
  const points = ev.map((e, i) => cp[i] - base + e.total * n - yakuSum);
  return {
    base,
    cardPoints: cp,
    yaku: ev.map((e) => e.yaku.map(({ key, name, points: p }) => ({ key, name, points: p }))),
    yakuTotal: ev.map((e) => e.total),
    points,
  };
}

export function kindCounts(cards) {
  const c = { light: 0, animal: 0, ribbon: 0, plain: 0 };
  for (const id of cards) c[CARDS[id].kind]++;
  return c;
}

export { KIND_POINT };
