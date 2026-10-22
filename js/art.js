// 札の絵をすべて SVG で描く（画像ファイルなし）。viewBox は 0 0 100 160。
import { CARDS } from './cards.js';

const C = {
  paper: '#f4ecd8',
  red: '#c8242c',
  deep: '#8e1b1f',
  black: '#1d1a17',
  green: '#2f6b3a',
  leaf: '#3d8a4a',
  pine: '#22432c',
  pink: '#f2a7b8',
  white: '#fbf8f0',
  purple: '#6b3f94',
  lilac: '#9a72c4',
  yellow: '#e8b923',
  gold: '#d4a017',
  brown: '#7a4a24',
  blue: '#2a4f9e',
  sky: '#f0d9c0',
};

const r2 = (n) => Math.round(n * 10) / 10;

function star(cx, cy, R, r, n, rot = -90) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 ? r : R;
    pts.push(`${r2(cx + rad * Math.cos(a))},${r2(cy + rad * Math.sin(a))}`);
  }
  return pts.join(' ');
}

const flower5 = (cx, cy, r, fill, center = C.yellow) =>
  [0, 1, 2, 3, 4]
    .map((i) => {
      const a = ((i * 72 - 90) * Math.PI) / 180;
      return `<circle cx="${r2(cx + r * 0.9 * Math.cos(a))}" cy="${r2(cy + r * 0.9 * Math.sin(a))}" r="${r2(r * 0.62)}" fill="${fill}"/>`;
    })
    .join('') + `<circle cx="${cx}" cy="${cy}" r="${r2(r * 0.35)}" fill="${center}"/>`;

const chrysanthemum = (cx, cy, r, fill, inner) => {
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += `<ellipse cx="${cx}" cy="${r2(cy - r * 0.55)}" rx="${r2(r * 0.16)}" ry="${r2(r * 0.48)}" fill="${fill}" transform="rotate(${i * 22.5} ${cx} ${cy})"/>`;
  }
  for (let i = 0; i < 10; i++) {
    s += `<ellipse cx="${cx}" cy="${r2(cy - r * 0.3)}" rx="${r2(r * 0.12)}" ry="${r2(r * 0.3)}" fill="${inner}" transform="rotate(${i * 36 + 10} ${cx} ${cy})"/>`;
  }
  return s + `<circle cx="${cx}" cy="${cy}" r="${r2(r * 0.16)}" fill="${C.deep}"/>`;
};

const pineCluster = (cx, cy, w) => {
  let s = `<ellipse cx="${cx}" cy="${cy}" rx="${w}" ry="${r2(w * 0.5)}" fill="${C.pine}"/>`;
  for (let i = -4; i <= 4; i++) {
    s += `<line x1="${cx}" y1="${r2(cy + w * 0.35)}" x2="${r2(cx + i * w * 0.22)}" y2="${r2(cy - w * 0.4)}" stroke="${C.leaf}" stroke-width="1.2"/>`;
  }
  return s;
};

const maple = (cx, cy, R, fill, rot = 0) =>
  `<polygon points="${star(cx, cy, R, R * 0.45, 7, -90 + rot)}" fill="${fill}"/>` +
  `<line x1="${cx}" y1="${cy}" x2="${r2(cx + R * 0.3)}" y2="${r2(cy + R * 1.1)}" stroke="${C.deep}" stroke-width="1.2"/>`;

function tanzaku(x, y, rot, color, text = '') {
  let t = '';
  if (text) {
    [...text].forEach((ch, i) => {
      t += `<text x="${x + 9}" y="${y + 18 + i * 13}" font-size="11" text-anchor="middle" fill="${C.black}" font-family="serif" font-weight="700">${ch}</text>`;
    });
  }
  return `<g transform="rotate(${rot} ${x + 9} ${y + 40})">
    <rect x="${x}" y="${y}" width="18" height="80" rx="2" fill="${color}" stroke="${C.black}" stroke-width="1.2"/>
    <rect x="${x + 2}" y="${y + 2}" width="14" height="76" rx="1" fill="none" stroke="${C.gold}" stroke-width="0.8" opacity="0.8"/>${t}</g>`;
}

// ---- 月ごとの地の絵 ----
const BASES = {
  1: () => `
    <rect x="0" y="110" width="100" height="50" fill="${C.red}"/>
    <path d="M0 118 Q25 108 50 116 T100 112 V160 H0Z" fill="${C.deep}" opacity=".35"/>
    <path d="M38 160 C40 130 30 110 46 86 C56 70 48 52 62 38" stroke="${C.brown}" stroke-width="7" fill="none" stroke-linecap="round"/>
    ${pineCluster(62, 36, 22)}${pineCluster(32, 64, 18)}${pineCluster(70, 78, 20)}${pineCluster(40, 100, 15)}`,
  2: () => `
    <rect x="0" y="0" width="100" height="58" fill="${C.red}"/>
    <path d="M0 58 Q50 48 100 58" fill="${C.red}"/>
    <path d="M8 160 C20 120 18 96 40 74 C58 56 70 52 92 30" stroke="${C.black}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M40 74 C46 92 60 98 74 112" stroke="${C.black}" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${flower5(30, 90, 7, C.red, C.yellow)}${flower5(52, 64, 8, C.white, C.red)}${flower5(78, 40, 7, C.red)}${flower5(66, 104, 6, C.white, C.red)}${flower5(18, 120, 6, C.red)}`,
  3: () => `
    <rect x="0" y="0" width="100" height="160" fill="${C.sky}" opacity=".6"/>
    <path d="M0 40 Q30 30 60 42 T100 38 V56 Q70 48 40 58 T0 52Z" fill="${C.red}" opacity=".85"/>
    ${[[24, 22], [58, 16], [84, 30], [16, 78], [46, 80], [78, 70], [30, 110], [66, 108], [88, 116], [12, 140], [50, 140]]
      .map(([x, y], i) => flower5(x, y, 8 + (i % 3), i % 2 ? C.pink : C.white, C.red))
      .join('')}`,
  4: () => `
    <path d="M0 6 C30 18 60 4 100 12" stroke="${C.black}" stroke-width="5" fill="none"/>
    ${[14, 38, 62, 86]
      .map((x, i) => {
        let s = '';
        const len = 7 + (i % 2) * 2;
        for (let k = 0; k < len; k++) {
          const yy = 16 + k * 10;
          const w = 9 - k * 0.6;
          s += `<ellipse cx="${x + Math.sin(k) * 2}" cy="${yy}" rx="${r2(w)}" ry="5" fill="${k % 2 ? C.lilac : C.purple}"/>`;
        }
        return s;
      })
      .join('')}
    <path d="M0 150 Q50 136 100 150 V160 H0Z" fill="${C.black}" opacity=".85"/>`,
  5: () => `
    ${[18, 36, 54, 72, 88].map((x, i) => `<path d="M${x} 160 C${x - 4} 120 ${x + 6} 100 ${x + (i % 2 ? 8 : -6)} 70" stroke="${C.green}" stroke-width="4" fill="none" stroke-linecap="round"/>`).join('')}
    ${[[24, 52], [62, 40], [84, 70], [42, 84]]
      .map(
        ([x, y]) => `<g transform="translate(${x} ${y})">
        <path d="M0 0 C-12 -6 -12 -20 0 -14 C12 -20 12 -6 0 0Z" fill="${C.purple}"/>
        <path d="M0 0 C-14 2 -16 14 -4 10 Z M0 0 C14 2 16 14 4 10Z" fill="${C.lilac}"/>
        <circle cx="0" cy="-2" r="2" fill="${C.yellow}"/></g>`,
      )
      .join('')}`,
  6: () => `
    ${[[22, 120], [74, 128], [50, 150], [12, 150], [88, 96]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="14" ry="7" fill="${C.green}" transform="rotate(-30 ${x} ${y})"/>`).join('')}
    ${[[34, 92, 20], [72, 66, 17]]
      .map(
        ([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.red}"/>
      <circle cx="${x}" cy="${y}" r="${r * 0.7}" fill="${C.deep}" opacity=".35"/>
      ${flower5(x, y, r * 0.55, '#e0525a', C.yellow)}`,
      )
      .join('')}`,
  7: () => `
    <path d="M6 160 C20 110 50 70 96 50" stroke="${C.black}" stroke-width="3" fill="none"/>
    <path d="M30 160 C40 120 70 96 98 90" stroke="${C.black}" stroke-width="2.5" fill="none"/>
    <path d="M60 160 C60 140 74 128 98 126" stroke="${C.black}" stroke-width="2" fill="none"/>
    ${Array.from({ length: 26 }, (_, i) => {
      const t = i / 26;
      const x = 10 + t * 86 + Math.sin(i * 1.7) * 6;
      const y = 150 - t * 96 + Math.cos(i * 2.3) * 10;
      return `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="3.6" ry="2.4" fill="${i % 3 ? C.red : C.deep}" transform="rotate(${(i * 37) % 180} ${r2(x)} ${r2(y)})"/>`;
    }).join('')}`,
  8: () => `
    <rect x="0" y="0" width="100" height="100" fill="${C.white}"/>
    <path d="M-10 160 V96 Q50 46 110 96 V160Z" fill="${C.black}"/>
    ${Array.from({ length: 14 }, (_, i) => `<path d="M${6 + i * 7} 100 Q${8 + i * 7} 80 ${i * 7 + (i % 2 ? 14 : -2)} 66" stroke="${C.black}" stroke-width="1.4" fill="none"/>`).join('')}`,
  9: () => `
    ${[[20, 150], [80, 146], [50, 156]].map(([x, y]) => `<path d="M${x} ${y} C${x - 6} 130 ${x + 8} 110 ${x} 90" stroke="${C.green}" stroke-width="3" fill="none"/>`).join('')}
    ${[[26, 50, 16], [72, 34, 14], [56, 92, 18], [20, 112, 12], [84, 104, 12]].map(([x, y, r]) => chrysanthemum(x, y, r, C.yellow, '#f3d55b')).join('')}`,
  10: () => `
    <path d="M100 0 C70 30 60 60 66 160" stroke="${C.black}" stroke-width="4" fill="none"/>
    ${[[78, 20, 13], [54, 40, 11], [86, 56, 12], [42, 72, 13], [74, 92, 11], [28, 104, 12], [60, 124, 12], [20, 142, 10], [88, 136, 10], [30, 26, 9]]
      .map(([x, y, r], i) => maple(x, y, r, i % 3 ? C.red : '#e06a2a', i * 17))
      .join('')}`,
  11: () => `
    <rect x="0" y="0" width="100" height="160" fill="${C.sky}" opacity=".35"/>
    ${[10, 26, 42, 58, 74, 90].map((x, i) => `<path d="M${x} 0 C${x + 10} 40 ${x - 8} 80 ${x + (i % 2 ? 6 : -4)} 120" stroke="${i % 2 ? C.green : C.leaf}" stroke-width="2.5" fill="none"/>`).join('')}
    <path d="M0 128 Q50 120 100 128 V160 H0Z" fill="${C.green}" opacity=".6"/>`,
  12: () => `
    <rect x="0" y="110" width="100" height="50" fill="${C.yellow}"/>
    ${[[30, 70], [72, 86], [44, 122], [84, 130]]
      .map(([x, y]) => `<path d="M${x} ${y} C${x - 22} ${y - 6} ${x - 24} ${y - 34} ${x} ${y - 30} C${x + 24} ${y - 34} ${x + 22} ${y - 6} ${x} ${y}Z" fill="${C.black}"/>
       <path d="M${x} ${y} V${y - 26}" stroke="${C.green}" stroke-width="1.5"/>`)
      .join('')}
    ${[0, 1, 2, 3, 4, 5].map((k) => `<circle cx="${50 + (k % 2 ? 5 : -5)}" cy="${10 + k * 7}" r="4" fill="${C.purple}"/>`).join('')}
    <path d="M50 6 V52" stroke="${C.green}" stroke-width="1.5"/>`,
};

// ---- 特別札の上絵 ----
const MOTIFS = {
  crane: () => `
    <circle cx="66" cy="36" r="24" fill="${C.red}"/>
    <g transform="translate(16 54)">
      <path d="M20 60 C10 40 18 22 34 20 C50 18 62 30 60 48 C58 62 40 70 20 60Z" fill="${C.white}" stroke="${C.black}" stroke-width="1.5"/>
      <path d="M34 22 C32 8 40 -4 48 -10" stroke="${C.black}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="49" cy="-11" r="5" fill="${C.white}" stroke="${C.black}" stroke-width="1"/>
      <circle cx="49" cy="-14" r="2.4" fill="${C.red}"/>
      <path d="M53 -11 L64 -8 L53 -8Z" fill="${C.gold}"/>
      <path d="M48 46 C60 56 70 58 78 54 C68 50 60 44 56 40Z" fill="${C.black}"/>
      <path d="M30 62 L26 84 M40 64 L42 84" stroke="${C.black}" stroke-width="2"/>
    </g>`,
  warbler: () => `
    <g transform="translate(46 22)">
      <ellipse cx="20" cy="16" rx="18" ry="11" fill="#7b8d2e" stroke="${C.black}" stroke-width="1"/>
      <circle cx="6" cy="10" r="8" fill="#8fa236" stroke="${C.black}" stroke-width="1"/>
      <circle cx="4" cy="9" r="1.6" fill="${C.black}"/>
      <path d="M-2 10 L-9 12 L-2 13Z" fill="${C.black}"/>
      <path d="M30 14 L46 8 L44 18Z" fill="#5a6a1e"/>
      <path d="M14 18 C22 24 30 22 34 18" stroke="${C.black}" stroke-width="1" fill="none"/>
    </g>`,
  curtain: () => `
    <g transform="translate(0 86)">
      <path d="M0 0 H100 V64 H0Z" fill="${C.red}"/>
      ${[0, 1, 2, 3, 4].map((i) => `<path d="M${i * 20} 0 Q${i * 20 + 10} 14 ${i * 20 + 20} 0" fill="${C.white}" opacity=".9"/>`).join('')}
      ${[16, 50, 84].map((x) => `<circle cx="${x}" cy="40" r="10" fill="none" stroke="${C.white}" stroke-width="2"/>${flower5(x, 40, 5, C.white, C.red)}`).join('')}
      <rect x="0" y="0" width="100" height="5" fill="${C.black}"/>
    </g>`,
  cuckoo: () => `
    <path d="M70 18 A16 16 0 1 0 88 40 A12 12 0 1 1 70 18Z" fill="${C.red}"/>
    <g transform="translate(40 52) rotate(-15)">
      <path d="M0 10 C10 0 30 0 40 8 C30 12 14 14 0 10Z" fill="${C.black}"/>
      <path d="M14 6 L2 -14 L24 4Z M22 8 L34 -12 L30 6Z" fill="${C.black}"/>
      <path d="M40 8 L48 6 L42 11Z" fill="${C.red}"/>
    </g>`,
  bridge: () => `
    ${[0, 1, 2].map((i) => `<g transform="translate(${-6 + i * 34} ${100 - i * 8}) rotate(-24)">
      <rect x="0" y="0" width="46" height="12" fill="${C.brown}" stroke="${C.black}" stroke-width="1.5"/>
      <path d="M8 0 V12 M18 0 V12 M28 0 V12 M38 0 V12" stroke="${C.black}" stroke-width=".8"/></g>`).join('')}`,
  butterfly: () =>
    [[30, 36, -10], [70, 30, 14]]
      .map(
        ([x, y, rot]) => `<g transform="translate(${x} ${y}) rotate(${rot})">
      <path d="M0 0 C-18 -18 -24 4 -10 8 C-22 14 -12 26 0 8Z" fill="${C.blue}" stroke="${C.black}" stroke-width="1"/>
      <path d="M0 0 C18 -18 24 4 10 8 C22 14 12 26 0 8Z" fill="${C.purple}" stroke="${C.black}" stroke-width="1"/>
      <circle cx="-10" cy="-2" r="3" fill="${C.yellow}"/><circle cx="10" cy="-2" r="3" fill="${C.yellow}"/>
      <path d="M0 -6 V14" stroke="${C.black}" stroke-width="2.5"/>
      <path d="M0 -6 L-5 -14 M0 -6 L5 -14" stroke="${C.black}" stroke-width="1"/></g>`,
      )
      .join(''),
  boar: () => `
    <g transform="translate(10 52)">
      <path d="M6 40 C0 20 20 4 46 6 C70 8 84 20 80 38 C76 50 60 52 40 52 C20 52 10 50 6 40Z" fill="${C.brown}" stroke="${C.black}" stroke-width="1.5"/>
      <path d="M10 18 C24 2 54 0 74 14" stroke="${C.black}" stroke-width="3" fill="none"/>
      <path d="M80 30 L92 34 L80 40Z" fill="${C.brown}" stroke="${C.black}" stroke-width="1"/>
      <circle cx="72" cy="26" r="2" fill="${C.black}"/>
      <path d="M84 40 C88 46 86 50 82 48" stroke="${C.white}" stroke-width="2" fill="none"/>
      <path d="M20 50 V62 M34 52 V62 M56 52 V62 M68 50 V62" stroke="${C.black}" stroke-width="4"/>
    </g>`,
  moon: () => `
    <rect x="0" y="0" width="100" height="100" fill="${C.red}"/>
    <path d="M-10 160 V96 Q50 46 110 96 V160Z" fill="${C.black}"/>
    <circle cx="50" cy="52" r="30" fill="${C.white}"/>
    ${Array.from({ length: 14 }, (_, i) => `<path d="M${6 + i * 7} 104 Q${8 + i * 7} 84 ${i * 7 + (i % 2 ? 14 : -2)} 70" stroke="${C.black}" stroke-width="1.4" fill="none"/>`).join('')}`,
  geese: () => `
    <rect x="0" y="0" width="100" height="70" fill="${C.red}"/>
    <path d="M0 70 Q50 60 100 70 V80 H0Z" fill="${C.red}"/>
    ${[[24, 22], [52, 34], [78, 18]].map(([x, y]) => `<path d="M${x - 12} ${y} Q${x - 6} ${y - 8} ${x} ${y} Q${x + 6} ${y - 8} ${x + 12} ${y} Q${x + 6} ${y - 3} ${x} ${y + 3} Q${x - 6} ${y - 3} ${x - 12} ${y}Z" fill="${C.black}"/>`).join('')}`,
  sake: () => `
    <g transform="translate(18 66)">
      <ellipse cx="32" cy="12" rx="32" ry="12" fill="${C.deep}"/>
      <path d="M0 12 C4 40 60 40 64 12" fill="${C.red}" stroke="${C.black}" stroke-width="1.5"/>
      <ellipse cx="32" cy="12" rx="30" ry="10" fill="${C.red}" stroke="${C.gold}" stroke-width="1.5"/>
      <text x="32" y="17" text-anchor="middle" font-size="14" fill="${C.gold}" font-family="serif" font-weight="700">寿</text>
      <path d="M20 36 H44 L40 44 H24Z" fill="${C.deep}"/>
    </g>`,
  deer: () => `
    <g transform="translate(12 48)">
      <path d="M14 56 C10 38 22 28 44 30 C62 32 66 44 62 56 Z" fill="#a0612c" stroke="${C.black}" stroke-width="1.5"/>
      ${[[24, 40], [38, 44], [50, 38]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${C.white}"/>`).join('')}
      <path d="M58 34 C64 20 70 14 76 14 C82 16 80 24 72 28 Z" fill="#a0612c" stroke="${C.black}" stroke-width="1.5"/>
      <circle cx="74" cy="19" r="1.6" fill="${C.black}"/>
      <path d="M70 14 C66 0 60 -6 54 -10 M66 4 L58 2 M74 14 C78 2 84 -4 90 -6 M80 4 L86 6" stroke="${C.black}" stroke-width="2" fill="none"/>
      <path d="M20 56 V72 M30 56 V72 M52 56 V72 M60 56 V72" stroke="${C.black}" stroke-width="3"/>
    </g>`,
  rainman: () => `
    <rect x="0" y="0" width="100" height="160" fill="${C.black}" opacity=".12"/>
    ${Array.from({ length: 18 }, (_, i) => `<line x1="${(i * 13) % 100}" y1="${(i * 29) % 70}" x2="${((i * 13) % 100) - 4}" y2="${((i * 29) % 70) + 14}" stroke="${C.blue}" stroke-width="1" opacity=".6"/>`).join('')}
    <g transform="translate(26 40)">
      <path d="M0 24 Q24 -10 52 24Z" fill="${C.yellow}" stroke="${C.black}" stroke-width="1.5"/>
      <path d="M26 22 V60" stroke="${C.black}" stroke-width="2"/>
      <circle cx="22" cy="40" r="7" fill="#f2d0b0" stroke="${C.black}" stroke-width="1"/>
      <path d="M8 96 L14 50 C18 46 30 46 34 50 L40 96Z" fill="${C.red}" stroke="${C.black}" stroke-width="1.5"/>
      <path d="M14 60 L34 60" stroke="${C.gold}" stroke-width="2"/>
    </g>
    <g transform="translate(70 120)"><ellipse cx="0" cy="0" rx="10" ry="7" fill="${C.green}"/><circle cx="-6" cy="-5" r="2" fill="${C.yellow}"/><circle cx="6" cy="-5" r="2" fill="${C.yellow}"/></g>`,
  swallow: () => `
    <g transform="translate(30 60) rotate(-20)">
      <path d="M0 10 C10 4 26 4 36 10 C26 14 10 14 0 10Z" fill="${C.black}"/>
      <path d="M14 8 L-6 -16 L26 6Z M20 12 L4 34 L28 12Z" fill="${C.black}"/>
      <path d="M36 10 L50 4 M36 10 L50 16" stroke="${C.black}" stroke-width="2"/>
      <circle cx="4" cy="9" r="2" fill="${C.red}"/>
    </g>`,
  thunder: () => `
    <rect x="0" y="0" width="100" height="160" fill="${C.black}"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${-10 + i * 30} 0 L${10 + i * 30} 60 L${-4 + i * 30} 60 L${16 + i * 30} 160" stroke="${C.red}" stroke-width="7" fill="none"/>`).join('')}
    <g transform="translate(50 108)"><ellipse cx="0" cy="0" rx="20" ry="12" fill="${C.red}" stroke="${C.gold}" stroke-width="2"/>
      <path d="M-6 -6 A6 6 0 1 1 6 6 A6 6 0 1 1 -6 -6" fill="${C.gold}" opacity=".85"/></g>`,
  phoenix: () => `
    <g transform="translate(20 44)">
      <path d="M30 40 C10 30 0 10 10 0 C20 20 30 20 40 18 C50 10 62 6 70 12 C60 16 56 24 58 34 C70 40 80 56 74 76 C64 60 50 54 40 56Z" fill="${C.red}" stroke="${C.black}" stroke-width="1.5"/>
      <path d="M40 56 C30 70 26 86 34 100 C40 86 46 76 56 70Z" fill="${C.green}" stroke="${C.black}" stroke-width="1"/>
      <path d="M48 58 C48 76 56 90 70 96 C64 80 62 70 62 62Z" fill="${C.purple}" stroke="${C.black}" stroke-width="1"/>
      <path d="M36 50 C20 60 10 76 12 92 C22 78 30 70 42 64Z" fill="${C.yellow}" stroke="${C.black}" stroke-width="1"/>
      <circle cx="64" cy="14" r="2" fill="${C.black}"/>
      <path d="M70 12 L78 14 L70 16Z" fill="${C.gold}"/>
    </g>`,
  'kiri-yellow': () => `<rect x="0" y="0" width="100" height="160" fill="#f6dc7a"/>`,
  'red-poem': (m) => tanzaku(30, 50, -14, C.red, m === 1 ? 'あかよろし' : m === 2 ? 'あかよろし' : 'みよしの'),
  red: () => tanzaku(34, 52, -14, C.red),
  blue: () => tanzaku(34, 52, -14, C.blue),
};

function faceSVG(card) {
  const base = BASES[card.month]();
  const motif = card.motif ? MOTIFS[card.motif](card.month) : '';
  const paper = `<rect x="0" y="0" width="100" height="160" fill="${C.paper}"/>`;
  if (card.motif === 'moon' || card.motif === 'thunder') return paper + motif; // 地ごと描き替える札
  if (card.motif === 'kiri-yellow') return paper + motif + base; // 地の色だけ違う札
  return paper + base + motif;
}

// <svg> スプライト（<symbol>）をまとめて返す
export function spriteSVG() {
  const syms = CARDS.map(
    (c) =>
      `<symbol id="card-${c.id}" viewBox="0 0 100 160"><clipPath id="clip-${c.id}"><rect width="100" height="160" rx="6"/></clipPath><g clip-path="url(#clip-${c.id})">${faceSVG(c)}</g></symbol>`,
  ).join('');
  const back = `<symbol id="card-back" viewBox="0 0 100 160">
    <rect width="100" height="160" rx="6" fill="#2a1a12"/>
    <rect x="6" y="6" width="88" height="148" rx="4" fill="#3a2418" stroke="#6b4428" stroke-width="2"/>
    <g opacity=".35" stroke="#a46a3a" stroke-width="1.2" fill="none">
      ${Array.from({ length: 8 }, (_, i) => `<circle cx="50" cy="80" r="${6 + i * 6}"/>`).join('')}
    </g>
    <circle cx="50" cy="80" r="14" fill="#8e1b1f"/>
    <text x="50" y="86" font-size="16" text-anchor="middle" fill="#f4ecd8" font-family="serif" font-weight="700">花</text>
  </symbol>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${syms}${back}</svg>`;
}
