// 役判定。取り札の配列から成立している役と合計点を返す。
import { CARDS, ID, KIND_POINT, monthOf } from './cards.js';

export const DEFAULT_RULES = Object.freeze({
  mode: 'koikoi', // koikoi / hanaawase（おいちょかぶは別エンジン）
  rounds: 12, // 何月（局）まで遊ぶか
  sakeAsPlain: true, // 菊に盃をカスとしても数える
  sakeYaku: true, // 花見で一杯・月見で一杯
  sevenDouble: true, // 7点以上は2倍
  koikoiDouble: true, // 相手がこいこい中に上がると2倍
  teyaku: true, // 手四・くっつき
});

export const YAKU_INFO = [
  { key: 'goko', name: '五光', points: '10', desc: '光札5枚すべて' },
  { key: 'shiko', name: '四光', points: '8', desc: '柳に小野道風以外の光札4枚' },
  { key: 'ameshiko', name: '雨四光', points: '7', desc: '柳に小野道風を含む光札4枚' },
  { key: 'sanko', name: '三光', points: '5', desc: '柳に小野道風以外の光札3枚' },
  { key: 'hanami', name: '花見で一杯', points: '5', desc: '桜に幕 + 菊に盃' },
  { key: 'tsukimi', name: '月見で一杯', points: '5', desc: '芒に月 + 菊に盃' },
  { key: 'inoshikacho', name: '猪鹿蝶', points: '5', desc: '萩に猪・紅葉に鹿・牡丹に蝶' },
  { key: 'akatan', name: '赤短', points: '5', desc: '松・梅・桜の赤短（字のある短冊）3枚' },
  { key: 'aotan', name: '青短', points: '5', desc: '牡丹・菊・紅葉の青短3枚' },
  { key: 'tane', name: 'タネ', points: '1〜', desc: 'タネ札5枚で1点、以降1枚ごとに+1' },
  { key: 'tan', name: 'タン', points: '1〜', desc: '短冊5枚で1点、以降1枚ごとに+1' },
  { key: 'kasu', name: 'カス', points: '1〜', desc: 'カス札10枚で1点、以降1枚ごとに+1' },
];

export const TEYAKU_INFO = [
  { key: 'teshi', name: '手四', points: '6', desc: '配られた手札に同じ月が4枚' },
  { key: 'kuttsuki', name: 'くっつき', points: '6', desc: '配られた手札が同じ月2枚ずつ4組' },
];

export function evaluate(captured, rules = DEFAULT_RULES) {
  const has = new Set(captured);
  const lights = captured.filter((c) => CARDS[c].kind === 'light');
  const animals = captured.filter((c) => CARDS[c].kind === 'animal');
  const ribbons = captured.filter((c) => CARDS[c].kind === 'ribbon');
  const plains = captured.filter(
    (c) => CARDS[c].kind === 'plain' || (rules.sakeAsPlain && c === ID.SAKE),
  );
  const yaku = [];
  const add = (key, name, points, cards) => yaku.push({ key, name, points, cards });

  const rain = has.has(ID.RAINMAN);
  if (lights.length === 5) add('goko', '五光', 10, lights);
  else if (lights.length === 4) add(rain ? 'ameshiko' : 'shiko', rain ? '雨四光' : '四光', rain ? 7 : 8, lights);
  else if (lights.length === 3 && !rain) add('sanko', '三光', 5, lights);

  if (rules.sakeYaku && has.has(ID.SAKE)) {
    if (has.has(ID.CURTAIN)) add('hanami', '花見で一杯', 5, [ID.CURTAIN, ID.SAKE]);
    if (has.has(ID.MOON)) add('tsukimi', '月見で一杯', 5, [ID.MOON, ID.SAKE]);
  }
  const isc = [ID.BOAR, ID.DEER, ID.BUTTERFLY];
  if (isc.every((c) => has.has(c))) add('inoshikacho', '猪鹿蝶', 5, isc);
  if (ID.AKA.every((c) => has.has(c))) add('akatan', '赤短', 5, ID.AKA);
  if (ID.AO.every((c) => has.has(c))) add('aotan', '青短', 5, ID.AO);
  if (animals.length >= 5) add('tane', 'タネ', animals.length - 4, animals);
  if (ribbons.length >= 5) add('tan', 'タン', ribbons.length - 4, ribbons);
  if (plains.length >= 10) add('kasu', 'カス', plains.length - 9, plains);

  return { yaku, total: yaku.reduce((s, y) => s + y.points, 0) };
}

export function teyakuOf(hand) {
  const counts = new Map();
  for (const c of hand) counts.set(monthOf(c), (counts.get(monthOf(c)) || 0) + 1);
  const v = [...counts.values()];
  if (v.includes(4)) return { key: 'teshi', name: '手四', points: 6 };
  if (v.length === 4 && v.every((n) => n === 2)) return { key: 'kuttsuki', name: 'くっつき', points: 6 };
  return null;
}

// 上がり時の最終得点
export function finalScore(base, rules, opponentKoikoi) {
  let s = base;
  const mult = [];
  if (rules.sevenDouble && base >= 7) { s *= 2; mult.push('7点以上 ×2'); }
  if (rules.koikoiDouble && opponentKoikoi) { s *= 2; mult.push('こいこい返し ×2'); }
  return { score: s, mult };
}

// ================= 花合わせ =================
// 札の点数（光20・タネ10・短冊5・カス1、合計264点）と出来役で競う。

export const HANA_BASE = 132; // 2人で264点を分けるので、基準は半分の132点
export const KUSA = [13, 17, 25]; // 藤・菖蒲・萩の短冊（草短）

export const HANA_YAKU_INFO = [
  { key: 'goko', name: '五光', points: '200', desc: '光札5枚すべて', ex: [0, 8, 28, 40, 44] },
  { key: 'shiko', name: '四光', points: '60', desc: '光札のうち4枚', ex: [0, 8, 28, 44] },
  { key: 'sanko', name: '三光', points: '20', desc: '光札のうち3枚', ex: [0, 8, 28] },
  { key: 'akatan', name: '赤短', points: '40', desc: '松・梅・桜の字入り赤短冊3枚', ex: [1, 5, 9] },
  { key: 'aotan', name: '青短', points: '40', desc: '牡丹・菊・紅葉の青短冊3枚', ex: [21, 33, 37] },
  { key: 'kusatan', name: '草短', points: '20', desc: '藤・菖蒲・萩の短冊3枚', ex: KUSA },
  { key: 'nanatan', name: '七短', points: '40', desc: '短冊を7枚以上（六短とは重複しない）', ex: [1, 5, 9, 13, 17, 21, 25] },
  { key: 'rokutan', name: '六短', points: '30', desc: '短冊を6枚', ex: [1, 5, 9, 13, 17, 21] },
  { key: 'inoshikacho', name: '猪鹿蝶', points: '20', desc: '萩に猪・紅葉に鹿・牡丹に蝶', ex: [24, 36, 20] },
  { key: 'hanami', name: '花見で一杯', points: '20', desc: '桜に幕 + 菊に盃', ex: [8, 32] },
  { key: 'tsukimi', name: '月見で一杯', points: '20', desc: '芒に月 + 菊に盃', ex: [28, 32] },
];

export const cardPoints = (cards) => cards.reduce((s, c) => s + KIND_POINT[CARDS[c].kind], 0);

export function evaluateHana(captured) {
  const has = new Set(captured);
  const yaku = [];
  const add = (key, name, points, cards) => yaku.push({ key, name, points, cards });
  const lights = captured.filter((c) => CARDS[c].kind === 'light');
  const ribbons = captured.filter((c) => CARDS[c].kind === 'ribbon');
  if (lights.length === 5) add('goko', '五光', 200, lights);
  else if (lights.length === 4) add('shiko', '四光', 60, lights);
  else if (lights.length === 3) add('sanko', '三光', 20, lights);
  if (ID.AKA.every((c) => has.has(c))) add('akatan', '赤短', 40, ID.AKA);
  if (ID.AO.every((c) => has.has(c))) add('aotan', '青短', 40, ID.AO);
  if (KUSA.every((c) => has.has(c))) add('kusatan', '草短', 20, KUSA);
  if (ribbons.length >= 7) add('nanatan', '七短', 40, ribbons);
  else if (ribbons.length === 6) add('rokutan', '六短', 30, ribbons);
  const isc = [ID.BOAR, ID.DEER, ID.BUTTERFLY];
  if (isc.every((c) => has.has(c))) add('inoshikacho', '猪鹿蝶', 20, isc);
  if (has.has(ID.SAKE) && has.has(ID.CURTAIN)) add('hanami', '花見で一杯', 20, [ID.CURTAIN, ID.SAKE]);
  if (has.has(ID.SAKE) && has.has(ID.MOON)) add('tsukimi', '月見で一杯', 20, [ID.MOON, ID.SAKE]);
  return { yaku, total: yaku.reduce((s, y) => s + y.points, 0) };
}

// 局の精算（ゼロサム）：(札の点 − 132) + 自分の出来役 − 相手の出来役
export function hanaSettle(captured) {
  const cp = captured.map(cardPoints);
  const ev = captured.map((c) => evaluateHana(c));
  const points = [0, 1].map((p) => cp[p] - HANA_BASE + ev[p].total - ev[1 - p].total);
  return { cardPoints: cp, yaku: ev.map((e) => e.yaku), yakuTotal: ev.map((e) => e.total), points };
}
