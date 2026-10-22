// 48 枚の札。id = (月-1)*4 + 月内番号。
// kind: light(光) / animal(タネ) / ribbon(短冊) / plain(カス)

export const MONTHS = [
  null,
  { name: '松', flower: '松', label: '1月' },
  { name: '梅', flower: '梅', label: '2月' },
  { name: '桜', flower: '桜', label: '3月' },
  { name: '藤', flower: '藤', label: '4月' },
  { name: '菖蒲', flower: '菖蒲', label: '5月' },
  { name: '牡丹', flower: '牡丹', label: '6月' },
  { name: '萩', flower: '萩', label: '7月' },
  { name: '芒', flower: '芒', label: '8月' },
  { name: '菊', flower: '菊', label: '9月' },
  { name: '紅葉', flower: '紅葉', label: '10月' },
  { name: '柳', flower: '柳', label: '11月' },
  { name: '桐', flower: '桐', label: '12月' },
];

const DEFS = [
  // 1 松
  ['light', '松に鶴', 'crane'], ['ribbon', '松に赤短', 'red-poem'], ['plain', '松のカス'], ['plain', '松のカス'],
  // 2 梅
  ['animal', '梅に鶯', 'warbler'], ['ribbon', '梅に赤短', 'red-poem'], ['plain', '梅のカス'], ['plain', '梅のカス'],
  // 3 桜
  ['light', '桜に幕', 'curtain'], ['ribbon', '桜に赤短', 'red-poem'], ['plain', '桜のカス'], ['plain', '桜のカス'],
  // 4 藤
  ['animal', '藤に不如帰', 'cuckoo'], ['ribbon', '藤に短冊', 'red'], ['plain', '藤のカス'], ['plain', '藤のカス'],
  // 5 菖蒲
  ['animal', '菖蒲に八橋', 'bridge'], ['ribbon', '菖蒲に短冊', 'red'], ['plain', '菖蒲のカス'], ['plain', '菖蒲のカス'],
  // 6 牡丹
  ['animal', '牡丹に蝶', 'butterfly'], ['ribbon', '牡丹に青短', 'blue'], ['plain', '牡丹のカス'], ['plain', '牡丹のカス'],
  // 7 萩
  ['animal', '萩に猪', 'boar'], ['ribbon', '萩に短冊', 'red'], ['plain', '萩のカス'], ['plain', '萩のカス'],
  // 8 芒
  ['light', '芒に月', 'moon'], ['animal', '芒に雁', 'geese'], ['plain', '芒のカス'], ['plain', '芒のカス'],
  // 9 菊
  ['animal', '菊に盃', 'sake'], ['ribbon', '菊に青短', 'blue'], ['plain', '菊のカス'], ['plain', '菊のカス'],
  // 10 紅葉
  ['animal', '紅葉に鹿', 'deer'], ['ribbon', '紅葉に青短', 'blue'], ['plain', '紅葉のカス'], ['plain', '紅葉のカス'],
  // 11 柳
  ['light', '柳に小野道風', 'rainman'], ['animal', '柳に燕', 'swallow'], ['ribbon', '柳に短冊', 'red'], ['plain', '柳のカス', 'thunder'],
  // 12 桐
  ['light', '桐に鳳凰', 'phoenix'], ['plain', '桐のカス'], ['plain', '桐のカス'], ['plain', '桐のカス', 'kiri-yellow'],
];

export const CARDS = Object.freeze(
  DEFS.map(([kind, name, motif], id) =>
    Object.freeze({ id, month: Math.floor(id / 4) + 1, kind, name, motif: motif || null }),
  ),
);

export const KIND_LABEL = { light: '光', animal: 'タネ', ribbon: '短冊', plain: 'カス' };
export const KIND_POINT = { light: 20, animal: 10, ribbon: 5, plain: 1 };

// 役判定で使う特定札
export const ID = Object.freeze({
  CRANE: 0, CURTAIN: 8, MOON: 28, RAINMAN: 40, PHOENIX: 44,
  SAKE: 32, BOAR: 24, DEER: 36, BUTTERFLY: 20,
  AKA: [1, 5, 9], AO: [21, 33, 37],
});

export const monthOf = (id) => Math.floor(id / 4) + 1;
export const cardName = (id) => CARDS[id].name;
