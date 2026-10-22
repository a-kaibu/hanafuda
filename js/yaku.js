// 役判定。取り札の配列から成立している役と合計点を返す。
import { CARDS, ID, monthOf } from './cards.js';

export const DEFAULT_RULES = Object.freeze({
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
