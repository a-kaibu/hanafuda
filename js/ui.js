import { CARDS, KIND_LABEL, MONTHS, ID, monthOf } from './cards.js';
import { DEFAULT_RULES, YAKU_INFO, TEYAKU_INFO, HANA_YAKU_INFO, HANA_BASE, evaluate, evaluateHana, cardPoints, finalScore } from './yaku.js';
import { randomHex, commitmentOf } from './rng.js';
import { isDecision, isOicho } from './engine.js';
import { BETS, HAND_NAMES, handRank, handValue } from './oicho.js';
import { LEVELS, decide } from './cpu.js';
import * as sfx from './audio.js';
import {
  HUMAN, CPU, createMatch, startRound, act, step, cpuView, isMatchOver, reveal, verifyLog,
  snapshot, resumeMatch, canUndo, undo,
} from './match.js';

const $ = (s) => document.querySelector(s);
// 札の絵: Wikimedia Commons の Louie Mantia ほか作（CC BY-SA 4.0）。出典は assets/cards/CREDITS.md
const ART = 'assets/cards/alt';
const cardImg = (c) => `<img src="${ART}/${c}.svg" alt="${CARDS[c].name}" draggable="false" decoding="async">`;
const backImg = () => `<img src="${ART}/back.svg" alt="" draggable="false" decoding="async">`;
const $$ = (s) => [...document.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * speed()));
const table = $('#table');
const layer = $('#layer');

// ---------------- 設定 ----------------
const SETTINGS_KEY = 'hanafuda.settings.v1';
const HISTORY_KEY = 'hanafuda.history.v1';
const CURRENT_KEY = 'hanafuda.current.v1'; // 対局中の種と行動（リロード後の再開用）
const settings = Object.assign(
  { sound: true, volume: 0.7, tags: true, hints: true, speed: 1, level: 2, rounds: 12, oichoRounds: 10, game: 'koikoi', rules: { ...DEFAULT_RULES } },
  safeJSON(localStorage.getItem(SETTINGS_KEY)),
);
settings.rules = { ...DEFAULT_RULES, ...settings.rules };
function safeJSON(s) {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}
const saveSettings = () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
};
const speed = () => settings.speed;
function applySettings() {
  document.body.classList.toggle('tags', settings.tags);
  document.documentElement.style.setProperty('--speed', settings.speed);
  sfx.setEnabled(settings.sound);
  sfx.setVolume(settings.volume);
}

// ---------------- CPU（Web Worker で隔離） ----------------
let worker = null;
let reqId = 0;
const waiting = new Map();
try {
  worker = new Worker(new URL('./cpu-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.action);
  };
  worker.onerror = () => { worker = null; };
} catch {
  worker = null;
}
function askCpu(view, level, cpuKey) {
  if (!worker) return Promise.resolve(decide(structuredClone(view), level, cpuKey));
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, view, level, cpuKey });
  }).catch(() => decide(structuredClone(view), level, cpuKey));
}

// ---------------- 検証（Web Worker） ----------------
let verifier = null;
let verifyId = 0;
const verifyWaiting = new Map();
function verifyAsync(log) {
  if (!verifier) {
    try {
      verifier = new Worker(new URL('./verify-worker.js', import.meta.url), { type: 'module' });
      verifier.onmessage = (e) => {
        const w = verifyWaiting.get(e.data.id);
        if (!w) return;
        verifyWaiting.delete(e.data.id);
        e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.result);
      };
    } catch {
      verifier = false;
    }
  }
  if (!verifier) return new Promise((r) => setTimeout(() => r(verifyLog(log)), 30));
  return new Promise((resolve, reject) => {
    const id = ++verifyId;
    verifyWaiting.set(id, { resolve, reject });
    verifier.postMessage({ id, log });
  });
}

// ---------------- 状態 ----------------
let match = null;
let gen = 0;
let prepared = null; // 次の対局用の種とコミットメント
let lastLog = null; // 直近の公開済みログ
const cardEls = new Map();
let slots = [];
let selected = null;
let humanWait = null;
let lastZone = new Map();
let groupLabels = {};
let deckBadge = null;

function prepareSeeds() {
  const dealerSeed = randomHex(32);
  const cpuSeed = randomHex(32);
  prepared = { dealerSeed, cpuSeed, commitment: commitmentOf(dealerSeed, cpuSeed) };
  $('#commitPreview').textContent = prepared.commitment;
  $('#playerSeed').value = randomHex(8);
}

// ---------------- 札の DOM ----------------
function tagText(c) {
  const card = CARDS[c];
  return `${MONTHS[card.month].label}${{ light: '光', animal: '種', ribbon: '短', plain: 'カス' }[card.kind]}`;
}
function makeCards() {
  layer.innerHTML = '';
  cardEls.clear();
  for (const card of CARDS) {
    const el = document.createElement('div');
    el.className = 'card down instant';
    el.dataset.id = card.id;
    el.innerHTML = `<div class="inner"><div class="face">${cardImg(card.id)}<span class="tag ${card.kind}">${tagText(card.id)}</span></div><div class="back">${backImg()}</div></div>`;
    el.setAttribute('aria-label', card.name);
    el.addEventListener('click', (e) => { e.stopPropagation(); onCardClick(card.id); });
    el.addEventListener('mouseenter', () => onCardHover(card.id, true));
    el.addEventListener('mouseleave', () => onCardHover(card.id, false));
    layer.appendChild(el);
    cardEls.set(card.id, el);
  }
  deckBadge = document.createElement('div');
  deckBadge.className = 'deck-count';
  layer.appendChild(deckBadge);
  groupLabels = {};
}

const miniCard = (c) => `<span class="mc" title="${CARDS[c].name}">${cardImg(c)}</span>`;

// ---------------- レイアウト ----------------
function rectOf(el) {
  const t = table.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - t.left, y: r.top - t.top, w: r.width, h: r.height };
}

function computeLayout(s) {
  if (isOicho(s.rules)) return computeLayoutOicho(s);
  const pos = new Map();
  const zH = rectOf($('#zHand'));
  const zC = rectOf($('#zCpuHand'));
  const zF = rectOf($('#zField'));
  const capZones = [rectOf($('#zMyCap')), rectOf($('#zCpuCap'))];

  // 手札
  const hand = [...s.hands[HUMAN]].sort((a, b) => a - b);
  const cw = Math.max(34, Math.min((zH.h - 18) / 1.6, zH.w / 5.6, 118));
  document.documentElement.style.setProperty('--cw', `${cw}px`);
  const n = Math.max(hand.length, 1);
  let stepX = cw + Math.min(8, cw * 0.1);
  if (stepX * (n - 1) + cw > zH.w) stepX = (zH.w - cw) / Math.max(n - 1, 1);
  const hx0 = zH.x + (zH.w - (stepX * (n - 1) + cw)) / 2;
  const hy = zH.y + (zH.h - cw * 1.6) / 2 + 4;
  hand.forEach((c, i) => {
    if (c === selected) {
      // 選んだ札は持ち上げて一番手前に出し、重なりに隠れず全体が見えるようにする
      pos.set(c, { x: hx0 + i * stepX, y: hy - cw * 0.22, s: 1, z: 400, down: false, zone: 'hand' });
    } else {
      pos.set(c, { x: hx0 + i * stepX, y: hy, s: 1, z: 300 + i, down: false, zone: 'hand' });
    }
  });

  // CPU の手札（裏向き）
  const cpuHand = s.hands[CPU];
  const cs = Math.min((zC.h * 0.86) / (cw * 1.6), 0.75);
  const ccw = cw * cs;
  const seatW = Math.min(150, zC.w * 0.34);
  const cStep = Math.min(ccw * 0.62, (zC.w - seatW - ccw) / Math.max(cpuHand.length - 1, 1));
  const cx0 = zC.x + Math.max(0, (zC.w - seatW - (cStep * (cpuHand.length - 1) + ccw)) / 2);
  cpuHand.forEach((c, i) => {
    pos.set(c, { x: cx0 + i * cStep, y: zC.y + (zC.h - ccw * 1.6) / 2, s: cs, z: 200 + i, down: true, zone: 'cpuhand' });
  });

  // 場と山札
  syncSlots(s);
  const nSlots = slots.length;
  const pad = 10;
  let best = { fw: 0, cols: 6 };
  for (let cols = 3; cols <= 12; cols++) {
    const rows = Math.ceil(nSlots / cols);
    const fw = Math.min((zF.w - pad * 2) / (cols + 1.35) / 1.1, (zF.h - pad * 2) / (rows * 1.6 * 1.1));
    if (fw > best.fw) best = { fw, cols };
  }
  const fw = Math.min(best.fw, cw * 1.12);
  const fs = fw / cw;
  const cols = best.cols;
  const rows = Math.ceil(nSlots / cols);
  const gap = fw * 0.1;
  const gridW = cols * fw + (cols - 1) * gap;
  const gridH = rows * fw * 1.6 + (rows - 1) * gap;
  const deckX = zF.x + pad + fw * 0.1;
  const deckY = zF.y + (zF.h - fw * 1.6) / 2;
  const gx0 = deckX + fw * 1.35 + Math.max(0, (zF.x + zF.w - pad - (deckX + fw * 1.35) - gridW) / 2);
  const gy0 = zF.y + (zF.h - gridH) / 2;
  const slotPos = (i) => ({ x: gx0 + (i % cols) * (fw + gap), y: gy0 + Math.floor(i / cols) * (fw * 1.6 + gap) });
  slots.forEach((c, i) => {
    if (c == null) return;
    const p = slotPos(i);
    pos.set(c, { ...p, s: fs, z: 100 + i, down: false, zone: 'field' });
  });
  if (s.pending) {
    const t = pos.get(s.pending.targets[0]);
    pos.set(s.pending.card, { x: t.x + fw * 0.22, y: t.y + fw * 0.28, s: fs, z: 180, down: false, zone: 'field' });
  }
  s.deck.forEach((c, i) => {
    const k = Math.min(i, 6);
    pos.set(c, { x: deckX - k * 0.7, y: deckY - k * 0.9, s: fs, z: 150 - Math.min(i, 40), down: true, zone: 'deck' });
  });
  if (s.drawn != null) {
    pos.set(s.drawn, { x: deckX + fw * 0.18, y: deckY - fw * 0.25, s: fs * 1.08, z: 260, down: false, zone: 'drawn' });
  }
  deckBadge.style.transform = `translate(${deckX + fw / 2}px, ${deckY + fw * 1.6 + 4}px) translate(-50%, 0)`;
  deckBadge.textContent = s.deck.length ? `山 ${s.deck.length}` : '';

  // 取り札
  [HUMAN, CPU].forEach((p) => layoutCaptured(pos, s.captured[p], capZones[p], cw, p));
  return pos;
}

// おいちょかぶ：上に CPU、下に自分の札（最大3枚）、場の左に山札
function computeLayoutOicho(s) {
  const pos = new Map();
  const zH = rectOf($('#zHand'));
  const zC = rectOf($('#zCpuHand'));
  const zF = rectOf($('#zField'));
  const cw = Math.max(40, Math.min((zH.h - 34) / 1.6, zH.w / 4.2, 130));
  document.documentElement.style.setProperty('--cw', `${cw}px`);
  const end = s.phase === 'end';
  for (const el of cardEls.values()) el.classList.remove('hole');
  const row = (p, z, sc, reserve) => {
    const w = cw * sc;
    const gap = w * 0.16;
    const total = 3 * w + 2 * gap; // 3枚分の場所を先に取り、3枚目が来ても札が動かないようにする
    const x0 = z.x + Math.max(0, (z.w - reserve - total) / 2);
    const y = z.y + Math.max(0, (z.h - 30 - w * 1.6) / 2);
    s.hands[p].forEach((c, i) => {
      pos.set(c, { x: x0 + i * (w + gap), y, s: sc, z: 300 + i, down: p === CPU && i === 0 && !end, zone: `h${p}` });
      if (p === HUMAN && i === 0 && !end) cardEls.get(c).classList.add('hole');
    });
    return { x: x0 + total / 2, y: y + w * 1.6 + 6 };
  };
  const cs = Math.min(0.85, (zC.h - 30) / (cw * 1.6));
  const me = row(HUMAN, zH, 1, 0);
  const cpu = row(CPU, zC, cs, Math.min(110, zC.w * 0.26));

  const fs = Math.min(0.8, (zF.h - 34) / 1.6 / cw);
  const deckX = zF.x + 14;
  const deckY = zF.y + (zF.h - cw * fs * 1.6) / 2 - 8;
  s.deck.forEach((c, i) => {
    const k = Math.min(i, 6);
    pos.set(c, { x: deckX - k * 0.7, y: deckY - k * 0.9, s: fs, z: 150 - Math.min(i, 40), down: true, zone: 'deck' });
  });
  deckBadge.style.transform = `translate(${deckX + (cw * fs) / 2}px, ${deckY + cw * fs * 1.6 + 4}px) translate(-50%, 0)`;
  deckBadge.textContent = s.deck.length ? `山 ${s.deck.length}` : '';

  const label = (key, at, html) => {
    let el = groupLabels[key];
    if (!el) {
      el = groupLabels[key] = document.createElement('div');
      el.className = 'oi-label';
      layer.appendChild(el);
    }
    const tf = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, 0)`;
    if (el.style.transform !== tf) el.style.transform = tf;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  };
  const role = (p) => `<span class="role ${p === s.oya ? 'oya' : ''}">${p === s.oya ? '親' : '子'}</span>`;
  const choice = (p) => (s.choice[p] === 'hit' ? '<span class="ch">引いた</span>' : s.choice[p] === 'stand' && (p === HUMAN || s.phase !== 'turnCheck') ? '<span class="ch">止めた</span>' : '');
  const name = (h, p) => {
    const r = handRank(h, p === s.oya);
    return r.rank > 1 ? `<b class="sp">${r.name}</b>` : `<b>${r.name}</b><i>${r.value}</i>`;
  };
  const myH = s.hands[HUMAN];
  label('oi-me', me, myH.length ? `${role(HUMAN)}${name(myH, HUMAN)}${choice(HUMAN)}` : role(HUMAN));
  const cpuH = s.hands[CPU];
  const upSum = handValue(cpuH.slice(1));
  label('oi-cpu', cpu, end ? `${role(CPU)}${name(cpuH, CPU)}${choice(CPU)}` : `${role(CPU)}${cpuH.length > 1 ? `<small>表の札</small><i>${upSum}</i>` : '<small>伏せ札のみ</small>'}${choice(CPU)}`);
  return pos;
}

function syncSlots(s) {
  const onField = new Set(s.field);
  slots = slots.map((c) => (c != null && onField.has(c) ? c : null));
  const placed = new Set(slots);
  for (const c of s.field) {
    if (placed.has(c)) continue;
    let i = slots.indexOf(null);
    if (i < 0) { slots.push(null); i = slots.length - 1; }
    slots[i] = c;
  }
  while (slots.length > 12 && slots.at(-1) == null) slots.pop();
  while (slots.length < 12) slots.push(null);
}

const KINDS = ['light', 'animal', 'ribbon', 'plain'];
const KIND_MAX = { light: 5, animal: 9, ribbon: 10, plain: 24 };
function layoutCaptured(pos, cards, z, cw, p) {
  const by = { light: [], animal: [], ribbon: [], plain: [] };
  for (const c of cards) by[CARDS[c].kind].push(c);
  const tall = z.h > z.w * 0.6;
  const labelKey = p === HUMAN ? 'me' : 'cpu';
  KINDS.forEach((k, gi) => {
    const list = by[k].sort((a, b) => a - b);
    let gx, gy, gw, gh;
    if (tall) {
      const rowH = (z.h - 26) / 4;
      gx = z.x + 6; gy = z.y + 4 + gi * rowH; gw = z.w - 12; gh = rowH - 4;
    } else {
      const fr = [0.17, 0.25, 0.25, 0.33];
      const off = fr.slice(0, gi).reduce((a, b) => a + b, 0);
      gx = z.x + 4 + off * (z.w - 8); gy = z.y + 2; gw = fr[gi] * (z.w - 8) - 4; gh = z.h - 4;
    }
    const labelH = 13;
    const sw = Math.max(14, Math.min((gh - labelH - 2) / 1.6, tall ? gw / 4 : gw / 2.2, cw * 0.8));
    const ss = sw / cw;
    const step = list.length > 1 ? Math.min(sw * (tall ? 0.72 : 0.5), (gw - sw) / (list.length - 1)) : 0;
    list.forEach((c, i) => {
      pos.set(c, { x: gx + i * step, y: gy + labelH, s: ss, z: 20 + i, down: false, zone: `cap${p}`, small: true });
    });
    const key = `${labelKey}-${k}`;
    let lb = groupLabels[key];
    if (!lb) {
      lb = groupLabels[key] = document.createElement('div');
      lb.className = 'group-label';
      layer.appendChild(lb);
    }
    const tf = `translate(${Math.round(gx)}px, ${Math.round(gy)}px)`;
    if (lb.style.transform !== tf) lb.style.transform = tf;
    const html = `${KIND_LABEL[k]}<b>${list.length}</b>`;
    if (lb._html !== html) { lb.innerHTML = html; lb._html = html; }
  });
}

function applyLayout(s, { instant = false } = {}) {
  const pos = computeLayout(s);
  for (const [c, el] of cardEls) {
    const p = pos.get(c);
    if (!p) { el.style.opacity = '0'; continue; }
    el.style.opacity = '1';
    el.classList.toggle('instant', instant);
    el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.s})`;
    el.classList.toggle('down', p.down);
    el.classList.toggle('small', !!p.small);
    const prevZone = lastZone.get(c);
    if (!instant && prevZone && prevZone !== p.zone) {
      el.style.zIndex = 900;
      clearTimeout(el._zt);
      el._zt = setTimeout(() => { el.style.zIndex = p.z; }, 450 * speed());
    } else {
      el.style.zIndex = p.z;
    }
    lastZone.set(c, p.zone);
  }
  return pos;
}

// ---------------- 描画 ----------------
function render() {
  if (!match) return;
  const s = match.state;
  updateUndoBtn();
  applyLayout(s);
  updateInteractivity(s);
  updateHud(s);
}

function updateHud(s) {
  const log = match.log;
  $('#roundLabel').textContent = `${s.round}/${log.rules.rounds}局・親 ${s.oya === HUMAN ? 'あなた' : 'CPU'}`;
  setScore('#scoreP', log.totals[HUMAN]);
  setScore('#scoreC', log.totals[CPU]);
  if (isOicho(s.rules)) {
    reconcile($('#myYaku'), []);
    reconcile($('#cpuYaku'), []);
    reconcile($('#koikoiBadges'), []);
    return;
  }
  renderChips('#myYaku', s.captured[HUMAN], s.captured[CPU], s.rules);
  renderChips('#cpuYaku', s.captured[CPU], s.captured[HUMAN], s.rules);
  const badges = [];
  if (s.koikoi[CPU]) badges.push({ k: `cpu-${s.koikoiCount[CPU]}`, cls: 'kbadge', t: `CPU こいこい${s.koikoiCount[CPU] > 1 ? `×${s.koikoiCount[CPU]}` : ''}` });
  if (s.koikoi[HUMAN]) badges.push({ k: `me-${s.koikoiCount[HUMAN]}`, cls: 'kbadge', t: `あなた こいこい${s.koikoiCount[HUMAN] > 1 ? `×${s.koikoiCount[HUMAN]}` : ''}` });
  reconcile($('#koikoiBadges'), badges);
}

// 差分だけ DOM を更新する。描画のたびに作り直すと入場アニメーションが繰り返されてちらつくため。
function reconcile(box, items) {
  const existing = new Map([...box.children].map((el) => [el.dataset.k, el]));
  const want = new Set(items.map((it) => it.k));
  for (const [k, el] of existing) if (!want.has(k)) el.remove();
  items.forEach((it, i) => {
    let el = existing.get(it.k);
    if (!el) {
      el = document.createElement('span');
      el.dataset.k = it.k;
      el.className = `${it.cls} new`;
      el.textContent = it.t;
      el.addEventListener('animationend', () => el.classList.remove('new'), { once: true });
    }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
}

function setScore(sel, v) {
  const el = $(sel);
  if (el.textContent !== String(v)) {
    el.textContent = v;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

const PROGRESS = [
  { name: '猪鹿蝶', cards: [ID.BOAR, ID.DEER, ID.BUTTERFLY], need: 3 },
  { name: '赤短', cards: ID.AKA, need: 3 },
  { name: '青短', cards: ID.AO, need: 3 },
  { name: '花見', cards: [ID.CURTAIN, ID.SAKE], need: 2 },
  { name: '月見', cards: [ID.MOON, ID.SAKE], need: 2 },
];
function renderChips(sel, mine, opp, rules) {
  if (rules.mode === 'hanaawase') {
    const ev = evaluateHana(mine);
    const chips = [{ k: `pt-${cardPoints(mine)}`, cls: 'pts', t: `札 ${cardPoints(mine)}点` }];
    for (const y of ev.yaku) chips.push({ k: `d-${y.key}`, cls: 'done', t: `${y.name} ${y.points}` });
    reconcile($(sel), chips.map((c) => ({ ...c, cls: `chip ${c.cls}` })));
    return;
  }
  const ev = evaluate(mine, rules);
  const chips = ev.yaku.map((y) => ({ k: `d-${y.key}-${y.points}`, cls: 'done', t: `${y.name} ${y.points}` }));
  if (settings.hints) {
    const done = new Set(ev.yaku.map((y) => y.name.slice(0, 2)));
    for (const P of PROGRESS) {
      const have = P.cards.filter((c) => mine.includes(c)).length;
      if (have === 0 || have >= P.need || P.cards.some((c) => opp.includes(c))) continue;
      if (done.has(P.name.slice(0, 2))) continue;
      chips.push({ k: `p-${P.name}-${have}`, cls: have === P.need - 1 ? 'near' : '', t: `${P.name} ${have}/${P.need}` });
    }
    const lights = mine.filter((c) => CARDS[c].kind === 'light').length;
    if (lights >= 1 && lights < 3) chips.push({ k: `p-l-${lights}`, cls: lights === 2 ? 'near' : '', t: `光 ${lights}/3` });
    const cnt = (k) => mine.filter((c) => CARDS[c].kind === k || (k === 'plain' && rules.sakeAsPlain && c === ID.SAKE)).length;
    for (const [k, thr, nm] of [['animal', 5, 'タネ'], ['ribbon', 5, 'タン'], ['plain', 10, 'カス']]) {
      const v = cnt(k);
      if (v >= thr - 2 && v < thr) chips.push({ k: `p-${k}-${v}`, cls: v === thr - 1 ? 'near' : '', t: `${nm} ${v}/${thr}` });
    }
  }
  reconcile($(sel), chips.map((c) => ({ ...c, cls: `chip ${c.cls}` })));
}

function matchesFor(card, field) {
  return field.filter((f) => monthOf(f) === monthOf(card));
}

function updateInteractivity(s) {
  for (const el of cardEls.values()) el.classList.remove('playable', 'match', 'selected', 'dimmed');
  if (isOicho(s.rules)) return oichoControls(s);
  const myTurn = s.turn === HUMAN && humanWait;
  if (myTurn && s.phase === 'play') {
    for (const c of s.hands[HUMAN]) cardEls.get(c).classList.add('playable');
    if (selected != null) {
      cardEls.get(selected).classList.add('selected');
      const m = matchesFor(selected, s.field);
      for (const f of s.field) cardEls.get(f).classList.add(m.includes(f) ? 'match' : 'dimmed');
      for (const f of m) cardEls.get(f).classList.add('playable');
      setHint(
        m.length === 0 ? '同じ月の札がありません。もう一度タップで場に出します'
          : m.length === 2 ? 'どちらの札を取りますか？ 光っている札をタップ'
            : 'もう一度タップ（または光っている札をタップ）で取ります',
      );
    } else {
      setHint('手札から1枚選んでください');
    }
  } else if (myTurn && s.phase === 'drawChoice') {
    const m = matchesFor(s.drawn, s.field);
    for (const f of s.field) cardEls.get(f).classList.add(m.includes(f) ? 'match' : 'dimmed');
    for (const f of m) cardEls.get(f).classList.add('playable');
    setHint('山札から引いた札で、どちらを取りますか？');
  }
}

// おいちょかぶ：賭け金と、自分の番のボタン
function oichoControls(s) {
  const betBox = $('#oiBet');
  const betHTML = s.bet ? `<span class="lb">賭け金</span><span class="coins">${'<i></i>'.repeat(s.bet)}</span><b>${s.bet}</b>` : '<span class="lb">賭け金はまだ</span>';
  if (betBox._html !== betHTML) { betBox.innerHTML = betHTML; betBox._html = betHTML; }
  const box = $('#oiActions');
  const mine = s.turn === HUMAN && humanWait;
  const key = mine ? s.phase : '';
  if (box.dataset.k !== key) {
    box.dataset.k = key;
    box.innerHTML = key === 'bet'
      ? BETS.map((b) => `<button class="oi-btn bet" data-bet="${b}"><b>${b}</b></button>`).join('')
      : key === 'hit'
        ? '<button class="oi-btn hit" data-act="hit"><b>もう1枚</b></button><button class="oi-btn stand" data-act="stand"><b>勝負</b></button>'
        : '';
    box.querySelectorAll('button').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        sfx.unlock();
        sfx.play('tap');
        resolveHuman(b.dataset.bet ? { type: 'bet', amount: Number(b.dataset.bet) } : { type: b.dataset.act });
      };
    });
  }
  if (!mine) return;
  if (s.phase === 'bet') setHint('自分の伏せ札を見て、賭け金を選んでください');
  else if (s.phase === 'hit') {
    const v = handValue(s.hands[HUMAN]);
    setHint(`いまは ${HAND_NAMES[v]}（${v}）。もう1枚引きますか？`);
  }
}

function setHint(t, dim = false) {
  const h = $('#hint');
  h.textContent = t;
  h.classList.toggle('dim', dim);
}

// ---------------- 入力 ----------------
function onCardClick(c) {
  sfx.unlock();
  if (!match || !humanWait) return;
  const s = match.state;
  if (s.turn !== HUMAN) return;
  if (s.phase === 'play') {
    if (s.hands[HUMAN].includes(c)) {
      if (selected === c) {
        const m = matchesFor(c, s.field);
        if (m.length === 2) { sfx.play('error'); flashCards(m); return; }
        resolveHuman({ type: 'play', card: c });
      } else {
        selected = c;
        sfx.play('tap');
        render();
      }
      return;
    }
    if (selected != null && s.field.includes(c)) {
      const m = matchesFor(selected, s.field);
      if (m.includes(c)) {
        resolveHuman(m.length === 2 ? { type: 'play', card: selected, target: c } : { type: 'play', card: selected });
        return;
      }
    }
    if (selected != null) { selected = null; render(); }
  } else if (s.phase === 'drawChoice') {
    if (matchesFor(s.drawn, s.field).includes(c)) resolveHuman({ type: 'drawChoice', target: c });
  }
}



function onCardHover(c, on) {
  if (!match || !humanWait || selected != null || !matchMedia('(hover: hover)').matches) return;
  const s = match.state;
  if (s.phase !== 'play' || s.turn !== HUMAN || !s.hands[HUMAN].includes(c)) return;
  for (const f of matchesFor(c, s.field)) cardEls.get(f).classList.toggle('match', on);
}

function flashCards(cards) {
  for (const c of cards) {
    const el = cardEls.get(c);
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}

table.addEventListener('click', () => {
  if (selected != null && match && humanWait) { selected = null; render(); }
});

document.addEventListener('keydown', (e) => {
  if (((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
    if (canUndoNow()) { e.preventDefault(); doUndo(); }
    return;
  }
  if (!match || !humanWait || $('.overlay.show')) return;
  const s = match.state;
  if (isOicho(s.rules) && s.turn === HUMAN) {
    if (s.phase === 'bet' && BETS.includes(Number(e.key))) resolveHuman({ type: 'bet', amount: Number(e.key) });
    else if (s.phase === 'hit' && (e.key === 'h' || e.key === 'Enter')) resolveHuman({ type: 'hit' });
    else if (s.phase === 'hit' && (e.key === 's' || e.key === ' ')) { e.preventDefault(); resolveHuman({ type: 'stand' }); }
    return;
  }
  if (s.phase === 'play' && s.turn === HUMAN) {
    const hand = [...s.hands[HUMAN]].sort((a, b) => a - b);
    const n = e.key === '0' ? 10 : Number(e.key);
    if (n >= 1 && n <= hand.length) onCardClick(hand[n - 1]);
    else if (e.key === 'Enter' && selected != null) onCardClick(selected);
    else if (e.key === 'Escape') { selected = null; render(); }
  }
});

function waitHuman() {
  return new Promise((resolve) => {
    humanWait = resolve;
    render();
  });
}
function resolveHuman(action) {
  const r = humanWait;
  humanWait = null;
  selected = null;
  r && r(action);
}

// ---------------- 演出 ----------------
function banner(big, sub = '', cls = '') {
  const b = $('#banner');
  b.innerHTML = `<div class="ink-splash"></div><div class="banner ${cls}"><span class="big">${big}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  return sleep(1500);
}

function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

async function dealAnimation() {
  if (isOicho(match.state.rules)) return dealOicho();
  const s = match.state;
  slots = [];
  lastZone = new Map();
  selected = null;
  // まず全札を山に積む
  const all = { ...s, deck: [...s.hands[s.oya], ...s.field, ...s.hands[1 - s.oya], ...s.deck], hands: [[], []], field: [], captured: [[], []], drawn: null, pending: null };
  applyLayout(all, { instant: true });
  void layer.offsetWidth;
  await sleep(150);
  // 2枚ずつ「親→場→子」の順に配る
  const order = [];
  const oyaH = s.hands[s.oya];
  const koH = s.hands[1 - s.oya];
  for (let i = 0; i < 8; i += 2) order.push(oyaH.slice(i, i + 2), s.field.slice(i, i + 2), koH.slice(i, i + 2));
  const dealt = { ...all, deck: [...all.deck] };
  const target = { hands: [[], []], field: [] };
  for (const pair of order) {
    for (const c of pair) {
      dealt.deck = dealt.deck.filter((x) => x !== c);
      if (oyaH.includes(c)) target.hands[s.oya].push(c);
      else if (koH.includes(c)) target.hands[1 - s.oya].push(c);
      else target.field.push(c);
    }
    const temp = { ...dealt, hands: target.hands.map((h) => [...h]), field: [...target.field] };
    const pos = applyLayout(temp);
    // 自分の手札は配り終わるまで伏せておく
    for (const c of target.hands[HUMAN]) cardEls.get(c).classList.add('down');
    void pos;
    sfx.play('deal');
    await sleep(70);
  }
  await sleep(350);
  sfx.play('flip');
  render();
  await sleep(450);
}

async function dealOicho() {
  const s = match.state;
  lastZone = new Map();
  const ko = 1 - s.oya;
  const all = { ...s, deck: [...s.hands[ko], ...s.hands[s.oya], ...s.deck], hands: [[], []], choice: [null, null] };
  applyLayout(all, { instant: true });
  void layer.offsetWidth;
  await sleep(200);
  const t = { ...all, hands: [[], []] };
  for (const p of [ko, s.oya]) {
    t.hands = t.hands.map((h, i) => (i === p ? [...s.hands[p]] : h));
    t.deck = t.deck.filter((c) => !s.hands[p].includes(c));
    applyLayout(t);
    sfx.play('deal');
    await sleep(280);
  }
  render();
  await sleep(350);
}

// ---------------- ゲーム進行 ----------------
async function gameLoop(myGen, { resume = false, cont = false } = {}) {
  const alive = () => myGen === gen;
  if (cont) {
    // 巻き戻し直後：札はいまの位置から動かして戻す
  } else if (resume) {
    slots = [];
    lastZone = new Map();
    applyLayout(match.state, { instant: true });
    void layer.offsetWidth;
  } else {
    await dealAnimation();
  }
  while (alive()) {
    const s = match.state;
    render();
    if (s.phase === 'end') {
      await roundEnd();
      if (!alive()) return;
      if (isMatchOver(match)) { matchEnd(); return; }
      startRound(match);
      saveCurrent();
      await dealAnimation();
      continue;
    }
    if (isDecision(s)) {
      let action;
      if (s.turn === HUMAN) {
        if (isOicho(s.rules)) action = await waitHuman();
        else if (s.phase === 'decide') action = await humanDecide(s);
        else {
          if (s.phase === 'play') sfx.play('turn');
          action = await waitHuman();
        }
      } else {
        action = await cpuTurn(s);
      }
      if (!alive()) return;
      const before = s;
      act(match, before.turn, action);
      saveCurrent();
      await afterAction(before, action);
    } else {
      const before = s;
      step(match);
      await afterStep(before, match.state);
    }
  }
}

// ---------------- 巻き戻し ----------------
// 自分の番（手札を選ぶ・こいこいの判断など）のときだけ、自分の最後の手まで戻せる。
function canUndoNow() {
  return !!match && !match.log.dealerSeed && canUndo(match) && (!!humanWait || $('#ovDecide').classList.contains('show'));
}
function updateUndoBtn() {
  $('#btnUndo').disabled = !canUndoNow();
}
function doUndo() {
  if (!canUndoNow()) return;
  undo(match);
  saveCurrent();
  gen++;
  humanWait = null;
  selected = null;
  hideOverlay('#ovDecide');
  reserveBottom(0);
  $('#thinking').classList.remove('on');
  sfx.play('flip');
  toast('1手戻しました');
  gameLoop(gen, { cont: true });
}

async function cpuTurn(s) {
  updateUndoBtn();
  $('#thinking').classList.add('on');
  setHint('CPU の番です', true);
  const t0 = performance.now();
  const view = cpuView(match);
  const action = await askCpu(view, match.log.cpuLevel, match.cpuKey);
  const minThink = s.phase === 'play' ? 650 : s.phase === 'decide' ? 900 : 450;
  const spent = performance.now() - t0;
  if (spent < minThink * speed()) await new Promise((r) => setTimeout(r, minThink * speed() - spent));
  $('#thinking').classList.remove('on');
  return action;
}

async function afterAction(before, action) {
  const s = match.state;
  if (isOicho(s.rules)) {
    const cpu = before.turn === CPU;
    render();
    if (action.type === 'bet') {
      sfx.play('slap');
      if (cpu) toast(`CPU は ${action.amount} 賭けました`);
      await sleep(cpu ? 700 : 350);
    } else if (action.type === 'hit') {
      if (cpu) toast('CPU はもう1枚引きます');
      await sleep(cpu ? 450 : 150);
    } else {
      sfx.play('tap');
      if (cpu) toast('CPU はこのまま勝負します');
      await sleep(cpu ? 650 : 250);
    }
    return;
  }
  if (action.type === 'play') {
    render();
    await sleep(380);
    sfx.play('slap');
    await sleep(220);
  } else if (action.type === 'drawChoice') {
    render();
    await sleep(380);
    sfx.play('slap');
    await sleep(200);
  } else if (action.type === 'koikoi') {
    render();
    sfx.play('koikoi');
    await banner('こいこい', before.turn === HUMAN ? 'あなたは勝負を続けます' : 'CPU が勝負を続けます', 'koikoi');
  } else if (action.type === 'stop') {
    render();
    sfx.play('stop');
    await banner('勝負', before.turn === HUMAN ? 'あなたのあがり' : 'CPU のあがり', 'stop');
  }
  void s;
}

async function afterStepOicho(before, s) {
  render();
  switch (before.phase) {
    case 'deal2':
      sfx.play('deal');
      await sleep(650);
      break;
    case 'turnCheck': {
      const p = before.turn;
      if (!s.auto[p]) break;
      const hit = s.choice[p] === 'hit';
      if (p === HUMAN) {
        const h = before.hands[HUMAN];
        const r = handRank(h, before.oya === HUMAN);
        setHint(r.rank > 1 ? `${r.name}！ このまま勝負です` : `${r.name}（${r.value}）なので${hit ? '必ずもう1枚引きます' : 'このまま勝負です'}`);
      } else {
        setHint(hit ? 'CPU はもう1枚引きます' : 'CPU はこのまま勝負します', true);
      }
      await sleep(900);
      break;
    }
    case 'draw3':
      sfx.play('flip');
      await sleep(650);
      break;
    case 'showdown': {
      sfx.play('flip');
      await sleep(800);
      const r = s.result;
      const w = r.oicho.ranks[r.winner];
      if (w.rank > 1) sfx.play('yaku');
      await banner(w.name, `${r.winner === HUMAN ? 'あなた' : 'CPU'}の勝ち`, w.rank > 1 ? 'yaku' : r.winner === HUMAN ? 'stop' : 'koikoi');
      break;
    }
    default:
  }
}

async function afterStep(before, s) {
  if (isOicho(s.rules)) return afterStepOicho(before, s);
  switch (before.phase) {
    case 'playCapture':
    case 'drawCapture': {
      const taken = s.captured[before.turn].slice(before.captured[before.turn].length);
      render();
      sfx.play('capture');
      await sleep(420);
      void taken;
      break;
    }
    case 'draw':
      render();
      sfx.play('flip');
      await sleep(560);
      break;
    case 'drawReveal':
      render();
      if (s.phase !== 'drawChoice') {
        await sleep(380);
        sfx.play('slap');
        await sleep(200);
      }
      break;
    case 'check':
      render();
      if (s.newYaku && s.newYaku.length && (s.phase === 'decide' || s.phase === 'end' || s.rules.mode === 'hanaawase')) {
        flashCards(s.newYaku.flatMap((y) => y.cards));
        sfx.play('yaku');
        await banner(s.newYaku.map((y) => y.name).join('・'), before.turn === HUMAN ? 'あなたの役' : 'CPU の役', 'yaku');
      } else {
        await sleep(120);
      }
      break;
    default:
      render();
  }
}

// こいこいするか（人）
function humanDecide(s) {
  const ev = evaluate(s.captured[HUMAN], s.rules);
  const f = finalScore(ev.total, s.rules, s.koikoi[CPU]);
  const newKeys = new Set((s.newYaku || []).map((y) => y.key));
  $('#decideYaku').innerHTML = ev.yaku.map((y) => `<span class="chip done ${newKeys.has(y.key) ? 'new' : ''}">${y.name} ${y.points}</span>`).join('');
  $('#decideScore').innerHTML = `今あがると <b>${f.score}</b> 点${f.mult.length ? `（${f.mult.join('・')}）` : ''}`;
  const left = s.hands[HUMAN].length;
  const notes = [`手札あと${left}枚`];
  if (s.koikoi[CPU]) notes.push('CPU がこいこい中：今あがると倍');
  $('#decideNote').textContent = notes.join('　');
  setHint('あがるか、こいこいで続けるかを選んでください');
  showOverlay('#ovDecide');
  updateUndoBtn();
  reserveBottom($('#ovDecide .sheet').offsetHeight + 12);
  return new Promise((resolve) => {
    const done = (type) => {
      hideOverlay('#ovDecide');
      reserveBottom(0);
      $('#btnKoikoi').onclick = $('#btnStop').onclick = null;
      resolve({ type });
    };
    $('#btnKoikoi').onclick = () => done('koikoi');
    $('#btnStop').onclick = () => done('stop');
  });
}

// 下部パネルの高さぶん卓を縮めて、手札も場も取り札もパネルに隠れないようにする
function reserveBottom(px) {
  $('#app').style.paddingBottom = px ? `${px}px` : '';
  if (match) { applyLayout(match.state); updateInteractivity(match.state); }
}

function yakuRow(y, isNew = false) {
  const cards = y.cards || exampleCards(y.key);
  return `<div class="yaku-row ${isNew ? 'new' : ''}"><span class="nm">${y.name}</span><span class="mini-cards">${cards.slice(0, 10).map(miniCard).join('')}${cards.length > 10 ? '…' : ''}</span><span class="pt">${y.points}点</span></div>`;
}

function boardHTML(log, current) {
  return log.rounds
    .map((r) => {
      const w = r.result?.winner;
      const pts = r.result?.points?.[HUMAN];
      const t = !r.result ? '…' : log.rules.mode === 'hanaawase' || log.rules.mode === 'oicho' ? `${pts > 0 ? '+' : pts < 0 ? '−' : '±'}${Math.abs(pts)}`
        : w == null ? '流れ' : `${w === HUMAN ? '+' : '−'}${r.result.score}`;
      const nm = log.rules.mode === 'oicho' ? `${r.round}局` : MONTHS[((r.round - 1) % 12) + 1].name;
      return `<div class="rb ${w === HUMAN ? 'you' : ''} ${r.round === current ? 'now' : ''}">${nm}<b>${t}</b></div>`;
    })
    .join('');
}

function roundEnd() {
  const s = match.state;
  const r = s.result;
  const head = $('#roundHead');
  if (isOicho(s.rules)) {
    const o = r.oicho;
    const me = r.points[HUMAN];
    head.textContent = me > 0 ? 'あなたの勝ち' : 'CPU の勝ち';
    head.className = `result-head ${me > 0 ? 'win' : 'lose'}`;
    const side = (p, nm) => {
      const k = o.ranks[p];
      return `<div class="hana-side ${p === r.winner ? 'won' : ''}"><div class="hs-head">${nm}（${p === s.oya ? '親' : '子'}）</div>
        <div class="oi-hand">${o.hands[p].map(miniCard).join('')}</div>
        <div class="hs-row"><span>${k.name}</span><b>${k.rank > 1 ? `×${k.mult}` : k.value}</b></div></div>`;
    };
    $('#roundYaku').innerHTML = side(HUMAN, 'あなた') + side(CPU, 'CPU');
    $('#roundCards').innerHTML = '';
    const a = o.ranks[1 - s.oya];
    const b = o.ranks[s.oya];
    const tie = a.rank === b.rank && (a.rank > 1 || a.value === b.value);
    $('#roundTotal').innerHTML = `<b>${me > 0 ? '+' : '−'}${Math.abs(me)}</b> 点<span class="mult">賭け金 ${o.bet}${r.mult.length ? ` × ${r.mult.join('')}` : ''}${tie ? '・同じ強さは親の勝ち' : ''}</span>`;
    sfx.play(me > 0 ? 'win' : 'lose');
  } else if (s.rules.mode === 'hanaawase') {
    const h = r.hana;
    const me = h.points[HUMAN];
    head.textContent = me > 0 ? 'あなたの勝ち' : me < 0 ? 'CPU の勝ち' : '引き分け';
    head.className = `result-head ${me > 0 ? 'win' : me < 0 ? 'lose' : ''}`;
    const side = (p, name) => `<div class="hana-side"><div class="hs-head">${name}</div>
      <div class="hs-row"><span>札の点</span><b>${h.cardPoints[p]}点</b></div>
      ${h.yaku[p].map((y) => yakuRow(y)).join('') || '<div class="small">出来役なし</div>'}</div>`;
    $('#roundYaku').innerHTML = side(HUMAN, 'あなた') + side(CPU, 'CPU');
    $('#roundCards').innerHTML = '';
    $('#roundTotal').innerHTML = `<b>${me > 0 ? '+' : ''}${me}</b> 点<span class="mult">（札の点 ${h.cardPoints[HUMAN]} − ${HANA_BASE}）＋ 自分の出来役 ${h.yakuTotal[HUMAN]} − 相手の出来役 ${h.yakuTotal[CPU]}</span>`;
    sfx.play(me >= 0 ? 'win' : 'lose');
  } else if (r.winner == null) {
    head.textContent = '流れ（引き分け）';
    head.className = 'result-head';
    $('#roundYaku').innerHTML = '<div class="small">どちらも役ができませんでした。親はそのままです。</div>';
    $('#roundTotal').innerHTML = '';
    $('#roundCards').innerHTML = '';
    sfx.play('draw');
  } else {
    const youWin = r.winner === HUMAN;
    head.textContent = r.teyaku ? `${youWin ? 'あなた' : 'CPU'}の手役！` : youWin ? 'あなたのあがり' : 'CPU のあがり';
    head.className = `result-head ${youWin ? 'win' : 'lose'}`;
    $('#roundYaku').innerHTML = r.yaku.map((y) => yakuRow(y)).join('');
    $('#roundCards').innerHTML = r.teyaku ? s.hands[r.winner].map(miniCard).join('') : '';
    $('#roundTotal').innerHTML = `<b>${r.score}</b> 点${r.mult.length ? `<span class="mult">${r.base}点 → ${r.mult.join('・')}</span>` : ''}`;
    sfx.play(youWin ? 'win' : 'lose');
  }
  $('#roundBoard').innerHTML = boardHTML(match.log, s.round);
  $('#btnNext').textContent = isMatchOver(match) ? '最終結果へ' : '次の局へ';
  setHint('');
  updateHud(s);
  showOverlay('#ovRound');
  return new Promise((resolve) => {
    $('#btnNext').onclick = () => { hideOverlay('#ovRound'); sfx.play('tap'); resolve(); };
  });
}

function matchEnd() {
  clearCurrent();
  const log = reveal(match);
  lastLog = log;
  saveHistory(log);
  const [p, c] = log.totals;
  const head = $('#matchHead');
  head.textContent = p > c ? '勝ち！' : p < c ? '負け…' : '引き分け';
  head.className = `match-head ${p > c ? 'win' : p < c ? 'lose' : ''}`;
  $('#matchScore').innerHTML = `${p}<span>対</span>${c}`;
  $('#matchBoard').innerHTML = boardHTML(log, -1);
  const box = $('#matchVerify');
  box.className = 'verify-inline wait';
  box.textContent = '…';
  box.title = '検証中';
  $('#matchUndo').textContent = '';
  sfx.play(p >= c ? 'win' : 'lose');
  showOverlay('#ovMatch');
  setHint('');
  const myGen = gen;
  verifyAsync(log).then(
    (v) => {
      if (myGen !== gen || lastLog !== log) return;
      box.className = `verify-inline ${v.pass ? '' : 'bad'}`;
      box.textContent = v.pass ? '✓' : '✗';
      box.title = v.pass ? '検証済み' : '検証で不一致あり';
      const n = (log.undos || []).length;
      $('#matchUndo').textContent = n ? `巻き戻し ${n}回` : '';
    },
    () => { box.className = 'verify-inline bad'; box.textContent = '✗'; },
  );
}

function saveHistory(log) {
  try {
    const h = safeJSON(localStorage.getItem(HISTORY_KEY));
    const list = Array.isArray(h) ? h : [];
    list.unshift(log);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {}
}
function loadHistory() {
  const h = safeJSON(localStorage.getItem(HISTORY_KEY));
  return Array.isArray(h) ? h : [];
}

// ---- 中断と再開 ----
function saveCurrent() {
  try { if (match && !match.log.dealerSeed) localStorage.setItem(CURRENT_KEY, JSON.stringify(snapshot(match))); } catch {}
}
function clearCurrent() {
  try { localStorage.removeItem(CURRENT_KEY); } catch {}
  updateResumeButton();
}
function loadCurrent() {
  const snap = safeJSON(localStorage.getItem(CURRENT_KEY));
  if (!snap || snap.v !== 1 || !snap.params) return null;
  try { return resumeMatch(snap); } catch { return null; }
}
function updateResumeButton() {
  const btn = $('#btnResume');
  const m = loadCurrentCached();
  btn.hidden = !m;
  if (m) btn.innerHTML = `続きから<small>第${m.state.round}局・あなた ${m.log.totals[HUMAN]} − ${m.log.totals[CPU]} CPU（${LEVELS.find((l) => l.id === m.log.cpuLevel).name}）</small>`;
}
let resumeCache;
function loadCurrentCached() {
  if (resumeCache === undefined) resumeCache = loadCurrent();
  return resumeCache;
}
// 途中の対局を捨てて新しく始める場合は「中断」として種を公開し記録に残す
function abandonSaved() {
  const m = loadCurrentCached();
  if (m) {
    lastLog = reveal(m, true);
    saveHistory(lastLog);
  }
  resumeCache = null;
  clearCurrent();
}
function resumeGame() {
  const m = loadCurrentCached();
  if (!m) return;
  sfx.unlock();
  sfx.play('open');
  gen++;
  match = m;
  resumeCache = undefined;
  $('#cpuLevelLabel').textContent = LEVELS.find((l) => l.id === match.log.cpuLevel).name;
  setMode(match.log.rules.mode);
  makeCards();
  setScore('#scoreP', match.log.totals[HUMAN]);
  setScore('#scoreC', match.log.totals[CPU]);
  $$('.overlay').forEach((o) => o.classList.remove('show'));
  toast(`第${match.state.round}局の続きから再開します`);
  gameLoop(gen, { resume: true });
}

function startMatch() {
  if (loadCurrentCached()) {
    if (!confirm('中断中の対局があります。新しく始めると、前の対局は「中断」として記録されます。よろしいですか？')) return;
    abandonSaved();
  }
  sfx.unlock();
  sfx.play('open');
  const playerSeed = $('#playerSeed').value.trim() || randomHex(8);
  gen++;
  match = createMatch({
    dealerSeed: prepared.dealerSeed,
    cpuSeed: prepared.cpuSeed,
    playerSeed,
    rules: { ...settings.rules, rounds: settings.game === 'oicho' ? settings.oichoRounds : settings.rounds, mode: settings.game },
    cpuLevel: settings.level,
  });
  $('#cpuLevelLabel').textContent = LEVELS.find((l) => l.id === settings.level).name;
  setMode(settings.game);
  setScore('#scoreP', 0);
  setScore('#scoreC', 0);
  makeCards();
  hideOverlay('#ovTitle');
  hideOverlay('#ovMatch');
  saveCurrent();
  toast(`第1局は${match.log.firstOya === HUMAN ? 'あなた' : 'CPU'}が親です`);
  gameLoop(gen);
}

// 遊び方ごとに卓の配置と名前を切り替える
function setMode(mode = 'koikoi') {
  document.body.classList.toggle('mode-oicho', mode === 'oicho');
  $('.brand .name').textContent = GAMES.find((g) => g.id === mode)?.name || 'こいこい';
  const box = $('#oiActions');
  box.innerHTML = '';
  box.dataset.k = '';
}

function quitToTitle() {
  $('#app').style.paddingBottom = '';
  if (match && !match.log.dealerSeed) {
    lastLog = reveal(match, true);
    saveHistory(lastLog);
  }
  clearCurrent();
  gen++;
  if (humanWait) humanWait = null;
  match = null;
  layer.innerHTML = '';
  setHint('');
  $$('.overlay').forEach((o) => o.classList.remove('show'));
  prepareSeeds();
  showOverlay('#ovTitle');
}

// ---------------- オーバーレイ ----------------
function showOverlay(sel) {
  $(sel).classList.add('show');
}
function hideOverlay(sel) {
  $(sel).classList.remove('show');
}
$$('[data-close]').forEach((b) => b.addEventListener('click', () => { b.closest('.overlay').classList.remove('show'); sfx.play('tap'); }));
$$('.overlay').forEach((o) =>
  o.addEventListener('click', (e) => {
    if (e.target === o && ['ovRules', 'ovVerify', 'ovMenu'].includes(o.id)) o.classList.remove('show');
  }),
);

// ---------------- タイトル画面 ----------------
function buildTitle() {
  const fan = [0, 8, 28, 40, 44];
  $('#titleCards').innerHTML = fan
    .map((c, i) => `<div class="tc" style="transform: translateX(-50%) rotate(${(i - 2) * 11}deg); animation-delay:${i * 0.07}s">${cardImg(c)}</div>`)
    .join('');
  $('#levelSeg').innerHTML = LEVELS.map(
    (l) => `<button data-v="${l.id}"><span class="stars">${'●'.repeat(l.id)}${'○'.repeat(4 - l.id)}</span><b>${l.name}</b><small>${l.desc}</small></button>`,
  ).join('');
  $('#gameSeg').innerHTML = GAMES.map((g) => `<button data-v="${g.id}">${g.name}</button>`).join('');
  $('#ruleGameSeg').innerHTML = $('#gameSeg').innerHTML;
  const onGame = () => {
    $('#gameDesc').textContent = GAMES.find((g) => g.id === settings.game).desc;
    $('#ruleSettings').hidden = settings.game !== 'koikoi';
    $('#ovTitle h1 small').textContent = GAMES.find((g) => g.id === settings.game).name;
    const oi = settings.game === 'oicho';
    const opts = oi ? [[5, '5局'], [10, '10局'], [20, '20局']] : [[3, '3局'], [6, '6局'], [12, '12局（一年）']];
    $('#roundSeg').innerHTML = opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('');
    segment('#roundSeg', oi ? settings.oichoRounds : settings.rounds, (v) => {
      if (settings.game === 'oicho') settings.oichoRounds = Number(v);
      else settings.rounds = Number(v);
      saveSettings();
    });
  };
  if (!GAMES.some((g) => g.id === settings.game)) settings.game = 'koikoi';
  segment('#gameSeg', settings.game, (v) => { settings.game = v; saveSettings(); onGame(); });
  onGame();
  segment('#levelSeg', settings.level, (v) => { settings.level = Number(v); saveSettings(); });
  const T = [
    ['sakeYaku', '花見で一杯・月見で一杯を役にする'],
    ['sakeAsPlain', '菊に盃をカスとしても数える'],
    ['sevenDouble', '7点以上は2倍'],
    ['koikoiDouble', '相手のこいこい中にあがると2倍'],
    ['teyaku', '手役（手四・くっつき）あり'],
  ];
  $('#ruleToggles').innerHTML = T.map(
    ([k, t]) => `<label class="toggle"><input type="checkbox" data-rule="${k}" ${settings.rules[k] ? 'checked' : ''}><span>${t}</span></label>`,
  ).join('');
  $$('[data-rule]').forEach((i) => i.addEventListener('change', () => { settings.rules[i.dataset.rule] = i.checked; saveSettings(); }));
}

function segment(sel, value, onChange) {
  const btns = $$(`${sel} button`);
  const set = (v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  set(value);
  btns.forEach((b) => b.addEventListener('click', () => { set(b.dataset.v); onChange(b.dataset.v); sfx.unlock(); sfx.play('tap'); }));
}

// ---------------- ルール ----------------
const EXAMPLES = {
  goko: [0, 8, 28, 40, 44], shiko: [0, 8, 28, 44], ameshiko: [0, 8, 28, 40], sanko: [0, 8, 28],
  hanami: [8, 32], tsukimi: [28, 32], inoshikacho: [24, 36, 20], akatan: [1, 5, 9], aotan: [21, 33, 37],
  tane: [4, 12, 16, 29, 41], tan: [13, 17, 25, 42, 1], kasu: [2, 3, 6, 7, 10, 11, 14, 15, 18, 19],
  teshi: [0, 1, 2, 3], kuttsuki: [0, 1, 4, 5, 8, 9, 12, 13],
};
const exampleCards = (k) => EXAMPLES[k] || [];
const CREDIT_HTML = `<p class="note">札の絵：<a href="https://commons.wikimedia.org/wiki/Category:SVG_Hanafuda_with_traditional_colors_(black_border)" target="_blank" rel="noopener">Wikimedia Commons</a> の Louie Mantia、すけじょ、Spenĉjo 作の花札 SVG（<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noopener">CC BY-SA 4.0</a>）。詳細は <a href="https://github.com/a-kaibu/hanafuda/blob/main/assets/cards/CREDITS.md" target="_blank" rel="noopener">CREDITS.md</a>。</p>`;

const GAMES = [
  { id: 'koikoi', name: 'こいこい', desc: '役を作って「あがる」か「こいこい」で続けるかを選ぶ、いちばん有名な遊び方。' },
  { id: 'hanaawase', name: '花合わせ', desc: 'こいこいせずに手札を出し切り、取った札の点数と出来役で勝負する昔ながらの遊び方。' },
  { id: 'oicho', name: 'おいちょかぶ', desc: '2〜3枚の札の合計の一の位で、9（カブ）に近い方が勝ち。賭け金を決めて親と勝負する。' },
];
let ruleGame = 'koikoi';
let ruleTabNow = 'how';

function ruleTab(tab = ruleTabNow) {
  ruleTabNow = tab;
  $$('#ruleTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('#ruleGameSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === ruleGame));
  const body = $('#ruleBody');
  const R = match && match.log.rules.mode === ruleGame ? match.log.rules : { ...settings.rules, mode: ruleGame };
  if (ruleGame === 'hanaawase' && (tab === 'how' || tab === 'yaku')) return hanaRules(tab, body);
  if (ruleGame === 'oicho' && tab !== 'fair') return oichoRules(tab, body);
  koikoiRules(tab, body, R);
}

function hanaRules(tab, body) {
  if (tab === 'how') {
    body.innerHTML = `
      <p class="note">花合わせは地方や家によってルールが少しずつ違います。ここではこのアプリの「2人用」ルールを説明します。</p>
      <h3>目的</h3>
      <p>点数の高い札をたくさん取り、決まった組み合わせ（<b>出来役</b>）を作ります。こいこいと違って途中で「あがる」ことはなく、<b>手札を全部出し切ってから点数を精算</b>します。</p>
      <h3>札の点数</h3>
      <table>
        <tr><td class="nm">光</td><td>${[0, 8, 28, 40, 44].map(miniCard).join('')}</td><td class="pt">20点</td></tr>
        <tr><td class="nm">タネ</td><td>${[4, 12, 16, 20, 24, 29, 32, 36, 41].map(miniCard).join('')}</td><td class="pt">10点</td></tr>
        <tr><td class="nm">短冊</td><td>${[1, 5, 9, 13, 17, 21, 25, 33, 37, 42].map(miniCard).join('')}</td><td class="pt">5点</td></tr>
        <tr><td class="nm">カス</td><td><div class="small">上記以外の24枚</div></td><td class="pt">1点</td></tr>
      </table>
      <p class="small">48枚ぜんぶ足すと264点です。札の種類は「札一覧」タブでも確認できます。</p>
      <h3>配り方</h3>
      <p>2人に手札を<b>10枚ずつ</b>、場に<b>8枚</b>を表向きに並べ、残り20枚が山札です。場に同じ月が4枚そろったら配り直します。</p>
      <h3>1回の手番（こいこいと同じ）</h3>
      <ol>
        <li><b>手札から1枚出す。</b>場に同じ月の札があれば、その札と一緒に取ります。なければ場に置くだけです。</li>
        <li><b>山札から1枚めくる。</b>同じように、場に同じ月の札があれば取れます。</li>
        <li>場に同じ月が2枚あるときは、どちらを取るか選べます。3枚あるときは4枚まとめて取れます。</li>
      </ol>
      <p>親から交互に10手ずつ打ち、2人とも手札がなくなったら局の終わりです。</p>
      <h3>精算のしかた</h3>
      <ol>
        <li><b>札の点</b>：取った札の点数を合計し、そこから <b>${HANA_BASE}点</b>（264点の半分）を引きます。例：150点取れば +18、120点なら −12。</li>
        <li><b>出来役</b>：できた出来役の点を<b>相手から</b>もらいます（「役と点数」タブ参照）。</li>
        <li>局の点 = （札の点 − ${HANA_BASE}）＋ 自分の出来役 − 相手の出来役。2人の点を足すと必ず0になります。</li>
      </ol>
      <p>プラスになった方がその局の勝ちで、次の局の親（先手）になります。決めた局数が終わった時点で合計点の多い方が勝ちです。</p>
      <h3>こいこいとの違い</h3>
      <ul>
        <li>「こいこい」「あがり」の判断はありません。最後まで打ち切ります。</li>
        <li>役がなくても、点の高い札（特に光とタネ）をたくさん取れば勝てます。</li>
        <li>出来役は点が大きいので、相手に作らせない（相手が集めている札を先に取る）ことも大切です。</li>
      </ul>
      <h3>操作</h3>
      <p class="note">手札をタップすると札が持ち上がり、取れる場の札が光ります → もう一度タップ（または光った札をタップ）で出します。</p>`;
  } else {
    body.innerHTML = `<table>${HANA_YAKU_INFO.map((y) => `<tr><td class="nm">${y.name}</td><td>${y.ex.map(miniCard).join('')}<div class="small">${y.desc}</div></td><td class="pt">${y.points}点</td></tr>`).join('')}</table>
      <p class="note">光の役（五光・四光・三光）はいちばん高いものだけ、七短と六短もどちらか高い方だけ数えます。それ以外の出来役は重ねて数えます。柳に小野道風（雨）も光として数えます。出来役の点は相手から受け取ります。</p>`;
  }
}

// 1〜10月の代表札（カス札）
const OI_SAMPLE = [2, 6, 10, 14, 18, 22, 26, 30, 34, 38];
const oiEx = (...months) => months.map((m) => miniCard(OI_SAMPLE[m - 1])).join('');

function oichoRules(tab, body) {
  if (tab === 'how') {
    body.innerHTML = `
      <p class="note">おいちょかぶは地方や家によってルールがかなり違います。ここではこのアプリの「CPU と1対1」のルールを説明します。</p>
      <h3>目的</h3>
      <p>2枚か3枚の札の数を足して、<b>一の位が 9 に近い方が勝ち</b>です。札を取り合うのではなく、配られた札で一発勝負します。</p>
      <h3>使う札と数</h3>
      <p>1月〜10月の40枚だけを使います（11月・12月は抜きます）。札の数は<b>月の数</b>で、<b>10月だけは 0</b> です。光・タネ・短冊などの種類は関係ありません。</p>
      <table>${OI_SAMPLE.map((c, i) => `<tr><td class="nm">${MONTHS[i + 1].label}（${MONTHS[i + 1].name}）</td><td>${[0, 1, 2, 3].map((k) => miniCard(i * 4 + k)).join('')}</td><td class="pt">${(i + 1) % 10}</td></tr>`).join('')}</table>
      <h3>手の数え方</h3>
      <p>札の数を全部足して、<b>一の位だけ</b>を見ます。</p>
      <table>
        <tr><td>${oiEx(8, 7)}</td><td>8 + 7 = 15 → <b>5</b>（ゴケ）</td></tr>
        <tr><td>${oiEx(4, 5)}</td><td>4 + 5 = 9 → <b>9</b>（カブ・いちばん強い）</td></tr>
        <tr><td>${oiEx(10, 10)}</td><td>0 + 0 = 0 → <b>0</b>（ブタ・いちばん弱い）</td></tr>
        <tr><td>${oiEx(6, 9, 5)}</td><td>6 + 9 + 5 = 20 → <b>0</b>（3枚目で台無しになることもある）</td></tr>
      </table>
      <h3>1局の流れ</h3>
      <ol>
        <li><b>親と子</b>：あなたと CPU が1局ごとに交代で親になります（最初の親はくじ引き）。</li>
        <li><b>1枚目を伏せて配る</b>：子と親に1枚ずつ。自分の伏せ札は自分だけが見られます。相手のは見えません。</li>
        <li><b>子が賭け金を決める</b>：1・2・3・5 のどれか。自分の伏せ札だけを見て決めます。勝てばその分もらい、負ければその分払います。</li>
        <li><b>2枚目を表向きに配る</b>：2枚目からはお互いに見えます。</li>
        <li><b>子が3枚目を引くか決める</b>（下のきまりを参照）。</li>
        <li><b>親が3枚目を引くか決める</b>：親は、子が引いたかどうかと子の表の札を見てから決められます。</li>
        <li><b>勝負</b>：伏せ札を開けて比べます。</li>
      </ol>
      <h3>3枚目のきまり</h3>
      <ul>
        <li>2枚の合計が <b>3 以下</b>なら、必ずもう1枚引きます。</li>
        <li><b>7 以上</b>なら引けません（そのまま勝負）。</li>
        <li><b>4・5・6</b> のときだけ、引くか止めるかを自分で選べます。</li>
        <li>3枚目は表向きです。引けるのは1枚だけ（最大3枚）です。</li>
      </ul>
      <h3>勝ち負けと点</h3>
      <ul>
        <li>数の大きい方が勝ち。<b>同じ数なら親の勝ち</b>です（親が少し有利）。</li>
        <li>子が勝てば子が賭け金をもらい、親が勝てば親が賭け金をもらいます。</li>
        <li>特別な役（「役と点数」タブ）で勝つと、賭け金が2倍・3倍になります。</li>
        <li>決めた局数が終わった時点で、合計点の多い方の勝ちです。</li>
      </ul>
      <h3>コツ</h3>
      <ul>
        <li>子は同じ数だと負けるので少し不利です。伏せ札を見て、いけそうなときだけ多めに賭けましょう。</li>
        <li>4 なら引く、6 なら止める、が目安です。5 は相手の表の札と相談です。</li>
        <li>親は、子が「止めた」ならだいたい 6 以上、「引いた」なら 2枚の時点で小さかった、と読めます。</li>
      </ul>
      <h3>操作</h3>
      <p class="note">賭け金は丸いボタン、3枚目は「もう1枚」か「勝負」を押します。PC ではキー 1・2・3・5 で賭け、H（Enter）で引く、S（スペース）で止めることもできます。</p>`;
  } else if (tab === 'yaku') {
    body.innerHTML = `
      <h3>数の呼び名</h3>
      <table>${HAND_NAMES.map((n, v) => `<tr><td class="nm">${n}</td><td class="small">${['いちばん弱い', '', '', '', '', '', '', '', '', 'いちばん強い'][v]}</td><td class="pt">${v}</td></tr>`).reverse().join('')}</table>
      <h3>特別な役</h3>
      <table>
        <tr><td class="nm">アラシ</td><td>${oiEx(3, 3, 3)}<div class="small">3枚とも同じ月。親でも子でもできます。いちばん強い役。</div></td><td class="pt">×3</td></tr>
        <tr><td class="nm">シッピン</td><td>${oiEx(4, 1)}<div class="small">子だけの役。最初の2枚が 4月と1月。そこで自動的に止めます。</div></td><td class="pt">×2</td></tr>
        <tr><td class="nm">クッピン</td><td>${oiEx(9, 1)}<div class="small">親だけの役。最初の2枚が 9月と1月。そこで自動的に止めます。</div></td><td class="pt">×2</td></tr>
      </table>
      <p class="note">強さの順は アラシ ＞ シッピン・クッピン ＞ 数（カブ〜ブタ）。同じ強さなら親の勝ちです。役で勝つと、賭け金にその倍率をかけた点が動きます。</p>`;
  } else {
    body.innerHTML = `<p>使うのは1月〜10月の40枚です。札の数は月の数（10月は 0）。種類（光・タネなど）は関係ありません。</p>
      <div class="month-grid">${OI_SAMPLE.map((c, i) => `<div class="month"><h4>${MONTHS[i + 1].label}・${MONTHS[i + 1].name}　<b>${(i + 1) % 10}</b></h4><div class="row">${[0, 1, 2, 3].map((k) => `<figure>${miniCard(i * 4 + k)}</figure>`).join('')}</div></div>`).join('')}</div>${CREDIT_HTML}`;
  }
}

function koikoiRules(tab, body, R) {
  if (tab === 'how') {
    body.innerHTML = `
      <h3>目的</h3>
      <p>同じ月（同じ花）の札を合わせて取り、取った札で「役」を作ります。役ができたら「あがる」か「こいこい（続ける）」かを選びます。</p>
      <h3>1回の手番</h3>
      <ol>
        <li><b>手札から1枚出す。</b>場に同じ月の札があれば、その札と一緒に取れます。なければ場に置くだけです。</li>
        <li><b>山札から1枚めくる。</b>同じように、場に同じ月の札があれば取れます。</li>
        <li>場に同じ月が2枚あるときは、どちらを取るか選べます。3枚あるときは4枚まとめて取れます。</li>
      </ol>
      <h3>役ができたら</h3>
      <ul>
        <li><b>あがり</b>：その時点の役の合計点を獲得して局が終わります。</li>
        <li><b>こいこい</b>：続けてさらに役を狙います。ただし相手が先にあがると、相手の点が2倍になります${R.koikoiDouble ? '' : '（現在の設定ではなし）'}。</li>
        <li>手札がなくなった時に役ができていれば自動であがります。両者とも手札がなくなったら「流れ」で0点です。</li>
      </ul>
      <h3>その他</h3>
      <ul>
        <li>${R.sevenDouble ? '7点以上の役であがると点数が2倍になります。' : '7点以上の倍付けはありません（設定でオフ）。'}</li>
        <li>局に勝った方が次の局の親（先手）になります。流れの場合は親はそのまま。</li>
        <li>配った直後に場に同じ月が4枚あると、配り直します。</li>
        ${R.teyaku ? '<li>配られた手札に同じ月4枚（手四）か、2枚ずつ4組（くっつき）があると、その場で6点のあがりです。</li>' : ''}
      </ul>
      <h3>操作</h3>
      <p class="note">手札をタップすると札が持ち上がり、取れる場の札が光ります → もう一度タップ（または光った札をタップ）で出します。PC では数字キー 1〜8 と Enter でも操作できます。</p>`;
  } else if (tab === 'yaku') {
    const rows = YAKU_INFO.filter((y) => R.sakeYaku || !['hanami', 'tsukimi'].includes(y.key))
      .map((y) => `<tr><td class="nm">${y.name}</td><td>${exampleCards(y.key).map(miniCard).join('')}<div class="small">${y.desc}</div></td><td class="pt">${y.points}点</td></tr>`)
      .join('');
    const te = R.teyaku
      ? `<h3>手役（配られた時点）</h3><table>${TEYAKU_INFO.map((y) => `<tr><td class="nm">${y.name}</td><td>${exampleCards(y.key).map(miniCard).join('')}<div class="small">${y.desc}</div></td><td class="pt">${y.points}点</td></tr>`).join('')}</table>`
      : '';
    body.innerHTML = `<table>${rows}</table>
      <p class="note">役は重ねて数えます（例：猪鹿蝶 + タネ）。${R.sakeAsPlain ? '菊に盃はタネにもカスにも数えます。' : ''}
      ${R.sevenDouble ? '合計7点以上は2倍。' : ''}${R.koikoiDouble ? '相手がこいこいしている時にあがると2倍。' : ''}</p>${te}`;
  } else if (tab === 'cards') {
    let h = '<div class="month-grid">';
    for (let m = 1; m <= 12; m++) {
      h += `<div class="month"><h4>${MONTHS[m].label}・${MONTHS[m].name}</h4><div class="row">`;
      for (let k = 0; k < 4; k++) {
        const c = (m - 1) * 4 + k;
        h += `<figure>${miniCard(c)}${CARDS[c].name.replace(/^.+?に/, '')}<br><b>${KIND_LABEL[CARDS[c].kind]}</b></figure>`;
      }
      h += '</div></div>';
    }
    body.innerHTML = h + `</div>${CREDIT_HTML}`;
  } else if (tab === 'fair') {
    body.innerHTML = fairnessExplainer();
  }
}

function fairnessExplainer() {
  return `
    <h3>イカサマできない仕組み</h3>
    <ol>
      <li><b>対局前に山札を固定</b>：アプリが秘密の種（ディーラー種・CPU種）を作り、そのハッシュ値（コミットメント）を対局前に表示します。</li>
      <li><b>あなたの種も混ぜる</b>：山札の並びは SHA-256(ディーラー種 + あなたの種) から決まります。アプリはあなたの種を知る前に種を固定しているので、狙った山札を作れません。</li>
      <li><b>CPU は見えない札を見られない</b>：CPU は別スレッド（Web Worker）で動き、自分の手札・場・取り札・枚数だけを受け取ります。山札の順番やあなたの手札は渡されません。CPU が返した手は合法手かどうか必ずチェックされます。</li>
      <li><b>後から検証</b>：終局後に種を公開します。コミットメントの一致、全局の山札、すべての手の合法性、点数、そして「CPU の判断が公開情報だけから再現できるか」を再計算して確認します。</li>
    </ol>
    <p class="note">記録（JSON）を保存すれば、このページの「記録を検証」や、リポジトリの <code>tools/verify.mjs</code> でいつでも検証できます。手順は VERIFY.md に書いてあります。</p>`;
}

// ---------------- 検証画面 ----------------
function openVerify(log = null) {
  const body = $('#verifyBody');
  let h = '';
  if (match && !match.log.dealerSeed && !log) {
    h += `<div class="verdict wait">⏳ 対局中です。種は終局後に公開されます。</div>
      <div class="kv"><span>この対局のコミットメント（対局前に固定済み）</span><code>${match.log.commitment}</code></div>
      <div class="kv"><span>あなたの種</span><code>${escapeHTML(match.log.playerSeed)}</code></div>
      <div class="kv"><span>CPU の強さ</span><code>${LEVELS.find((l) => l.id === match.log.cpuLevel).name}</code></div>
      <p class="small">コミットメントをメモしておけば、終局後に公開される種と一致するか自分で確かめられます。</p>`;
  }
  const target = log || lastLog;
  if (target) h += '<div id="verifyReport"><div class="verdict wait">⏳ 検証中…（山札と全手を再計算しています）</div></div>';
  h += `<h3 style="font-family:var(--mincho)">記録を読み込んで検証</h3>
    <textarea class="logbox" id="logInput" placeholder="ここに記録(JSON)を貼り付け"></textarea>
    <div class="btn-row"><button class="secondary" id="btnPasteVerify">貼り付けた記録を検証</button><label class="secondary" style="text-align:center;cursor:pointer">ファイルを選ぶ<input type="file" id="logFile" accept="application/json,.json" hidden></label></div>`;
  const hist = loadHistory();
  if (hist.length) {
    h += `<h3 style="font-family:var(--mincho)">最近の対局</h3><div class="history">${hist
      .map((l, i) => `<button data-hist="${i}">${new Date(l.startedAt).toLocaleString('ja-JP')}　あなた ${l.totals[0]} − ${l.totals[1]} CPU（${LEVELS.find((x) => x.id === l.cpuLevel)?.name || ''}${l.aborted ? '・中断' : ''}${l.undos?.length ? `・巻き戻し${l.undos.length}回` : ''}）</button>`)
      .join('')}</div>`;
  }
  h += fairnessExplainer();
  body.innerHTML = h;
  $('#btnPasteVerify').onclick = () => {
    try { openVerify(JSON.parse($('#logInput').value)); } catch { toast('JSON として読めませんでした'); }
  };
  $('#logFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { openVerify(JSON.parse(await f.text())); } catch { toast('JSON として読めませんでした'); }
  };
  $$('[data-hist]').forEach((b) => (b.onclick = () => openVerify(hist[Number(b.dataset.hist)])));
  showOverlay('#ovVerify');
  $('#ovVerify .sheet').scrollTop = 0;
  if (!target) return;
  const token = ++verifyViewToken;
  verifyAsync(target).then((v) => {
    const slot = $('#verifyReport');
    if (!slot || token !== verifyViewToken) return;
    slot.innerHTML = verifyReport(target, v);
    const dl = $('#btnDownload');
    if (dl) dl.onclick = () => download(target);
    const cp = $('#btnCopyLog');
    if (cp) cp.onclick = async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(target)); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
    };
  });
}
let verifyViewToken = 0;

function verifyReport(log, v) {
  let h = '';
  const oiLog = log.rules?.mode === 'oicho';
  const H = log.rules?.mode === 'hanaawase' ? 10 : 8;
  if (!log.dealerSeed) {
    h += `<div class="verdict wait">⏳ まだ種が公開されていない記録です</div>`;
  } else {
    h += `<div class="verdict ${v.pass ? 'ok' : 'ng'}">${v.pass ? '✓ すべての検証に合格しました' : '✗ 一致しない項目があります'}</div>`;
  }
  h += `<div class="checks">${v.checks
    .map((c) => `<div class="check ${c.pass ? '' : 'ng'}"><span class="ic">${c.pass ? '✓' : '✗'}</span><div>${c.name}<small>${escapeHTML(c.detail || '')}</small></div></div>`)
    .join('')}</div>`;
  if (log.dealerSeed) {
    h += `<div class="kv"><span>コミットメント</span><code>${log.commitment}</code></div>
      <div class="kv"><span>ディーラー種（公開）</span><code>${log.dealerSeed}</code></div>
      <div class="kv"><span>CPU種（公開）</span><code>${log.cpuSeed}</code></div>
      <div class="kv"><span>あなたの種</span><code>${escapeHTML(log.playerSeed)}</code></div>
      <div class="btn-row"><button class="secondary" id="btnDownload">記録を保存</button><button class="secondary" id="btnCopyLog">記録をコピー</button></div>
      <h3 style="font-family:var(--mincho)">各局の山札（再計算）</h3>
      <p class="small">${oiLog ? '左から：子の伏せ札・親の伏せ札 ｜ 子の2枚目・親の2枚目 ｜ 3枚目以降に引く札（左が上）。11月・12月の札は使いません' : `左から：親の手札${H}枚 ｜ 場8枚 ｜ 子の手札${H}枚 ｜ 山札${48 - 2 * H - 8}枚（左が上）`}</p>
      <div class="deck-rows">${v.rounds
        .map((r) => {
          const parts = oiLog ? [r.deck.slice(0, 2), r.deck.slice(2, 4), r.deck.slice(4, 6)]
            : [r.deck.slice(0, H), r.deck.slice(H, H + 8), r.deck.slice(H + 8, 2 * H + 8), r.deck.slice(2 * H + 8)];
          return `<div class="deck-row"><div class="hd">第${r.round}局${r.attempt ? `（配り直し${r.attempt}回）` : ''}</div><div class="strip">${parts.map((p) => p.map(miniCard).join('')).join('<span class="sep"></span>')}</div></div>`;
        })
        .join('')}</div>`;
  }
  return h;
}

function download(log) {
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hanafuda-${(log.startedAt || '').replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------- 起動 ----------------
function init() {
  // 札画像を先読みしておく（初回の配札で絵が遅れて出ないように）
  for (const c of [...CARDS.map((x) => x.id), 'back']) {
    const im = new Image();
    im.src = `${ART}/${c}.svg`;
  }
  applySettings();
  buildTitle();
  prepareSeeds();

  $('#reseed').onclick = () => { $('#playerSeed').value = randomHex(8); sfx.play('tap'); };
  $('#btnStart').onclick = startMatch;
  $('#btnResume').onclick = resumeGame;
  updateResumeButton();
  // 対局の途中でリロード・再訪した場合は、タイトルを挟まずにそのまま続きから始める
  if (loadCurrentCached()) resumeGame();
  $('#btnAgain').onclick = () => { hideOverlay('#ovMatch'); match = null; layer.innerHTML = ''; prepareSeeds(); showOverlay('#ovTitle'); };
  $('#btnMatchVerify').onclick = () => openVerify(lastLog);
  const openRules = () => {
    ruleGame = match ? match.log.rules.mode || 'koikoi' : settings.game;
    ruleTab('how');
    showOverlay('#ovRules');
    sfx.play('open');
  };
  $('#btnGameRules').onclick = openRules;
  $$('#ruleGameSeg button').forEach((b) => (b.onclick = () => { ruleGame = b.dataset.v; ruleTab(); sfx.play('tap'); }));
  $('#btnRules').onclick = openRules;
  $('#btnTitleRules').onclick = openRules;
  $$('#ruleTabs button').forEach((b) => (b.onclick = () => { ruleTab(b.dataset.tab); sfx.play('tap'); }));
  $('#btnUndo').onclick = (e) => { e.stopPropagation(); sfx.unlock(); doUndo(); };
  $('#btnFair').onclick = () => { openVerify(); sfx.play('open'); };
  $('#roundLabel').onclick = () => { openVerify(); sfx.play('open'); };
  $('#btnTitleVerify').onclick = () => openVerify();
  $('#btnMenu').onclick = () => { showOverlay('#ovMenu'); sfx.play('open'); };
  $('#btnQuit').onclick = () => {
    if (!match || confirm('対局をやめますか？（種は公開され、ここまでの記録を検証できます）')) quitToTitle();
  };

  const snd = $('#optSound');
  snd.checked = settings.sound;
  snd.onchange = () => { settings.sound = snd.checked; applySettings(); saveSettings(); sfx.play('tap'); };
  const vol = $('#optVolume');
  vol.value = settings.volume;
  vol.oninput = () => { settings.volume = Number(vol.value); applySettings(); saveSettings(); };
  vol.onchange = () => sfx.play('capture');
  const tags = $('#optTags');
  tags.checked = settings.tags;
  tags.onchange = () => { settings.tags = tags.checked; applySettings(); saveSettings(); };
  const hints = $('#optHints');
  hints.checked = settings.hints;
  hints.onchange = () => { settings.hints = hints.checked; saveSettings(); if (match) render(); };
  segment('#speedSeg', settings.speed, (v) => { settings.speed = Number(v); applySettings(); saveSettings(); });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (match) { applyLayout(match.state, { instant: true }); updateInteractivity(match.state); } }, 60);
  });
}

init();
