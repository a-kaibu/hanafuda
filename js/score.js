// 点数計算ページ。実物の札で遊んだ局を入力し、局ごとの記録と合計を localStorage に残す。
import { CARDS, MONTHS, KIND_LABEL } from './cards.js';
import { DEFAULT_RULES } from './yaku.js';
import { koikoiRound, hanaRound, kindCounts, KOI_MANUAL_YAKU, KOI_COUNT_YAKU } from './score-core.js';

const KEY = 'hanafuda.score.v1';
const ART = 'assets/cards/alt';
const MODE_NAME = { koikoi: 'こいこい', hanaawase: '花合わせ' };
const DEFAULT_NAMES = ['A', 'B', 'C'];
const RULE_KEYS = ['sevenDouble', 'koikoiDouble', 'sakeYaku', 'sakeAsPlain'];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

// ---------- 保存 ----------
let game = load();

function load() {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (g && Array.isArray(g.players) && Array.isArray(g.records)) return g;
  } catch {}
  return null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(game)); } catch { toast('保存できませんでした'); }
}

const rulesOf = (g) => ({ ...DEFAULT_RULES, ...g.rules });

// 記録は入力内容だけを持ち、点数は毎回計算し直す（ルールを変えても合う）
function compute(g, detail) {
  if (g.mode === 'hanaawase') return hanaRound(detail.captured);
  return koikoiRound(detail, rulesOf(g), g.players.length);
}

// ---------- 一覧 ----------
function renderBoard() {
  const has = !!game;
  $('#board').hidden = !has;
  $('#dock').hidden = !has;
  $('#modeLabel').textContent = has ? MODE_NAME[game.mode] : '';
  if (!has) return;

  const n = game.players.length;
  const results = game.records.map((r) => compute(game, r));
  const totals = Array(n).fill(0);
  for (const r of results) r.points.forEach((p, i) => (totals[i] += p));
  const best = Math.max(...totals);
  const done = game.records.length >= game.rounds;

  $('#totals').style.setProperty('--n', n);
  $('#totals').innerHTML = game.players
    .map((name, i) => `<div class="total${done && totals[i] === best && results.length ? ' lead' : ''}"><span>${esc(name)}</span><b>${signed(totals[i])}</b></div>`)
    .join('');

  $('#progress').textContent = done
    ? `全${game.rounds}局おわり`
    : `${game.records.length} / ${game.rounds}局`;

  $('#empty').hidden = results.length > 0;
  $('#records').hidden = results.length === 0;
  $('#records').innerHTML = `
    <thead><tr><th>局</th>${game.players.map((p) => `<th>${esc(p)}</th>`).join('')}<th class="what">内容</th></tr></thead>
    <tbody>${results.map((r, i) => `
      <tr data-i="${i}">
        <td class="no">${i + 1}</td>
        ${r.points.map((p) => `<td class="pt${p > 0 ? ' plus' : p < 0 ? ' minus' : ''}">${signed(p)}</td>`).join('')}
        <td class="what">${esc(summary(game, game.records[i], r))}</td>
      </tr>`).join('')}
    </tbody>`;

  const btn = $('#btnAdd');
  btn.textContent = done ? '新しい対局' : `第${game.records.length + 1}局を記録`;
  btn.dataset.act = done ? 'new' : 'add';
}

function summary(g, detail, r) {
  if (g.mode === 'hanaawase') {
    return r.yaku.map((ys, i) => (ys.length ? `${g.players[i]}：${ys.map((y) => y.name).join('・')}` : '')).filter(Boolean).join(' ／ ') || '出来役なし';
  }
  if (detail.winner == null) return '流れ';
  if (!r.yaku.length) return `${g.players[detail.winner]} 役なし`;
  return `${g.players[detail.winner]}：${r.yaku.map((y) => y.name).join('・')}${r.mult.length ? '（×' + 2 ** r.mult.length + '）' : ''}`;
}

$('#records').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-i]');
  if (tr) openEditor(+tr.dataset.i);
});
$('#btnAdd').addEventListener('click', () => {
  if ($('#btnAdd').dataset.act === 'new') openSetup(true);
  else openEditor(null);
});

// ---------- 設定 ----------
let setup;

function openSetup(fresh) {
  const base = fresh || !game ? null : game;
  setup = {
    fresh: !base,
    mode: base?.mode || game?.mode || 'koikoi',
    count: base?.players.length || game?.players.length || 2,
    names: [...(game?.players || []), ...DEFAULT_NAMES].slice(0, 3),
    rounds: base?.rounds || game?.rounds || 12,
    rules: { ...DEFAULT_RULES, ...(game?.rules || {}) },
  };
  for (let i = 0; i < 3; i++) if (!setup.names[i]) setup.names[i] = DEFAULT_NAMES[i];
  renderSetup();
  show('#setup');
}

function renderSetup() {
  const locked = !setup.fresh && game.records.length > 0;
  $('#setupTitle').textContent = setup.fresh ? '新しい対局' : '対局の設定';
  if (setup.mode === 'koikoi') setup.count = 2;
  markSeg('#setMode', setup.mode, locked);
  markSeg('#setCount', String(setup.count), locked);
  $('#fieldCount').hidden = setup.mode === 'koikoi';
  $('#fieldRules').hidden = setup.mode !== 'koikoi';
  $('#setNames').innerHTML = setup.names
    .slice(0, setup.count)
    .map((n, i) => `<input data-i="${i}" value="${esc(n)}" maxlength="8" autocomplete="off" enterkeyhint="done">`)
    .join('');
  $('#setRounds').textContent = `${setup.rounds}局`;
  document.querySelectorAll('[data-rule]').forEach((el) => (el.checked = !!setup.rules[el.dataset.rule]));
  $('#setupNote').textContent = locked ? '記録がある間は遊び方と人数を変えられません。ルールを変えると、これまでの局も計算し直します。' : '';
  $('#btnSetupOk').textContent = setup.fresh ? 'はじめる' : '保存';
  $('#btnSetupCancel').hidden = !game;
  $('#setupExtra').hidden = setup.fresh || !game.records.length;
}

function markSeg(sel, v, locked) {
  document.querySelectorAll(`${sel} button`).forEach((b) => {
    b.classList.toggle('on', b.dataset.v === v);
    b.disabled = locked && b.dataset.v !== v;
  });
}

$('#setMode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  setup.mode = b.dataset.v;
  renderSetup();
});
$('#setCount').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  setup.count = +b.dataset.v;
  renderSetup();
});
$('#setNames').addEventListener('input', (e) => (setup.names[+e.target.dataset.i] = e.target.value));
document.querySelector('#setup .stepper').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const min = setup.fresh ? 1 : Math.max(1, game.records.length);
  if (b.dataset.d) setup.rounds = Math.min(48, Math.max(min, setup.rounds + +b.dataset.d));
  if (b.dataset.r) setup.rounds = Math.max(min, +b.dataset.r);
  $('#setRounds').textContent = `${setup.rounds}局`;
});
document.querySelectorAll('[data-rule]').forEach((el) =>
  el.addEventListener('change', () => (setup.rules[el.dataset.rule] = el.checked)),
);

$('#btnSetupOk').addEventListener('click', () => {
  const players = setup.names.slice(0, setup.count).map((n, i) => n.trim() || DEFAULT_NAMES[i]);
  const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, !!setup.rules[k]]));
  if (setup.fresh) {
    game = { v: 1, mode: setup.mode, players, rounds: setup.rounds, rules, records: [], created: Date.now() };
  } else {
    Object.assign(game, { mode: setup.mode, players, rounds: setup.rounds, rules });
  }
  save();
  hide('#setup');
  renderBoard();
});
$('#btnSetupCancel').addEventListener('click', () => hide('#setup'));
$('#btnReset').addEventListener('click', () => {
  if (!confirm('これまでの記録を消して、新しい対局をはじめますか？')) return;
  setup.fresh = true;
  renderSetup();
});
$('#btnSetup').addEventListener('click', () => openSetup(!game));

// ---------- 局の入力 ----------
let ed; // { index, detail }

function blankDetail() {
  if (game.mode === 'hanaawase') return { captured: game.players.map(() => []), active: 0 };
  return { winner: 0, method: 'cards', cards: [], manual: { keys: [], counts: { tane: 0, tan: 0, kasu: 0 } }, oppKoikoi: false };
}

function openEditor(index) {
  const detail = index == null ? blankDetail() : structuredClone(game.records[index]);
  if (game.mode === 'hanaawase') detail.active = 0;
  ed = { index, detail };
  $('#edTitle').textContent = `第${(index ?? game.records.length) + 1}局`;
  $('#btnDelete').hidden = index == null;
  $('#btnEdSave').textContent = index == null ? '記録する' : '直す';
  renderEditor();
  show('#editor');
  $('#editor .sheet-body').scrollTop = 0;
}

function renderEditor() {
  if (game.mode === 'hanaawase') renderHana();
  else renderKoikoi();
  renderResult();
}

function seg(name, items, current) {
  return `<div class="seg" data-seg="${name}">${items
    .map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(current) ? 'on' : ''}">${esc(label)}</button>`)
    .join('')}</div>`;
}

function renderKoikoi() {
  const d = ed.detail;
  const rules = rulesOf(game);
  const winners = game.players.map((p, i) => [i, p]).concat([['none', '流れ']]);
  let html = `
    <div class="field"><div class="label">上がった人</div>${seg('winner', winners, d.winner ?? 'none')}</div>`;
  if (d.winner != null) {
    html += `
    <div class="field"><div class="label">入力のしかた</div>${seg('method', [['cards', '取り札'], ['manual', '役を選ぶ'], ['teyaku', '手役（6点）']], d.method)}</div>`;
    if (d.method === 'cards') {
      html += `<p class="hint">${esc(game.players[d.winner])}の取り札をタップ</p>${cardGrid((id) => (d.cards.includes(id) ? 'on' : ''))}`;
    } else if (d.method === 'manual') {
      html += `<div class="chips">${KOI_MANUAL_YAKU.filter((y) => !y.sake || rules.sakeYaku)
        .map((y) => `<button class="chip${d.manual.keys.includes(y.key) ? ' on' : ''}" data-yaku="${y.key}">${y.name}<small>${y.points}</small></button>`)
        .join('')}</div>
        <div class="counts">${KOI_COUNT_YAKU.map((y) => {
          const n = d.manual.counts[y.key] || 0;
          return `<div class="count"><span>${y.name}<small>${y.min}枚から</small></span>
            <span class="stepper" data-count="${y.key}"><button data-d="-1" aria-label="減らす">−</button><b>${n}枚</b><button data-d="1" aria-label="増やす">＋</button></span></div>`;
        }).join('')}</div>`;
    } else {
      html += `<p class="hint">配られた手札に同じ月が4枚（手四）か、同じ月2枚ずつ4組（くっつき）。</p>`;
    }
    if (rules.koikoiDouble && d.method !== 'teyaku') {
      html += `<label class="toggle"><input type="checkbox" id="oppKoikoi"${d.oppKoikoi ? ' checked' : ''}><span>相手がこいこいしていた（×2）</span></label>`;
    }
  }
  $('#edBody').innerHTML = html;
}

function renderHana() {
  const d = ed.detail;
  const owner = new Map();
  d.captured.forEach((cs, p) => cs.forEach((c) => owner.set(c, p)));
  const left = 48 - owner.size;
  const tabs = game.players.map((p, i) => [i, `${p}（${d.captured[i].length}）`]);
  $('#edBody').innerHTML = `
    <div class="field"><div class="label">誰の取り札か</div>${seg('active', tabs, d.active)}</div>
    <p class="hint">${esc(game.players[d.active])}の取り札をタップ。ほかの人の札をタップすると付け替えます。</p>
    ${cardGrid((id) => {
      if (!owner.has(id)) return '';
      return owner.get(id) === d.active ? 'on' : `taken" data-owner="${esc(game.players[owner.get(id)].slice(0, 2))}`;
    })}
    <div class="row-btns">
      <button class="secondary small" id="btnRest"${left ? '' : ' disabled'}>残り${left}枚を${esc(game.players[d.active])}に</button>
      <button class="secondary small" id="btnClear"${d.captured[d.active].length ? '' : ' disabled'}>${esc(game.players[d.active])}の札を外す</button>
    </div>`;
}

function cardGrid(stateOf) {
  let html = '<div class="grid">';
  for (let m = 1; m <= 12; m++) {
    html += `<div class="month"><span class="mname">${m}<small>${MONTHS[m].name}</small></span><div class="mcards">`;
    for (let k = 0; k < 4; k++) {
      const id = (m - 1) * 4 + k;
      const c = CARDS[id];
      html += `<button class="pick ${stateOf(id)}" data-id="${id}" aria-label="${c.name}（${KIND_LABEL[c.kind]}）"><img src="${ART}/${id}.svg" alt="" draggable="false" decoding="async"></button>`;
    }
    html += '</div></div>';
  }
  return html + '</div>';
}

function renderResult() {
  const d = ed.detail;
  const r = compute(game, d);
  let html;
  if (game.mode === 'hanaawase') {
    const assigned = d.captured.reduce((s, c) => s + c.length, 0);
    html = `<div class="res-rows">${game.players.map((p, i) => `
      <div class="res-row"><span class="who">${esc(p)}</span>
        <span class="detail">札 ${r.cardPoints[i]}${r.yaku[i].length ? ` ・ ${r.yaku[i].map((y) => `${y.name} ${y.points}`).join('・')}` : ''}</span>
        <b class="${r.points[i] > 0 ? 'plus' : r.points[i] < 0 ? 'minus' : ''}">${signed(r.points[i])}</b></div>`).join('')}</div>
      ${assigned < 48 ? `<p class="warn">まだ ${48 - assigned} 枚がだれの札でもありません</p>` : ''}`;
  } else if (d.winner == null) {
    html = '<p class="res-line">流れ（0点）</p>';
  } else {
    const counts = d.method === 'cards' ? kindCounts(d.cards) : null;
    const yakuText = r.yaku.length ? r.yaku.map((y) => `${y.name} ${y.points}`).join(' ＋ ') : '役なし';
    html = `
      ${counts ? `<p class="res-sub">${d.cards.length}枚：光${counts.light} タネ${counts.animal} 短冊${counts.ribbon} カス${counts.plain}</p>` : ''}
      <p class="res-line"><span>${esc(yakuText)}</span>${r.mult.length ? `<span class="mult">${r.mult.join('・')}</span>` : ''}
        <b>${esc(game.players[d.winner])} ${signed(r.score)}</b></p>`;
  }
  $('#edResult').innerHTML = html;
}

$('#edBody').addEventListener('click', (e) => {
  const d = ed.detail;
  const segBtn = e.target.closest('[data-seg] button');
  if (segBtn) {
    const name = segBtn.parentElement.dataset.seg;
    const v = segBtn.dataset.v;
    if (name === 'winner') d.winner = v === 'none' ? null : +v;
    else if (name === 'method') d.method = v;
    else if (name === 'active') d.active = +v;
    return renderEditor();
  }
  const pick = e.target.closest('.pick');
  if (pick) {
    const id = +pick.dataset.id;
    if (game.mode === 'hanaawase') {
      const mine = d.captured[d.active];
      const had = mine.includes(id);
      d.captured = d.captured.map((cs) => cs.filter((c) => c !== id));
      if (!had) d.captured[d.active].push(id);
    } else {
      d.cards = d.cards.includes(id) ? d.cards.filter((c) => c !== id) : [...d.cards, id];
    }
    return updateGrid();
  }
  const chip = e.target.closest('[data-yaku]');
  if (chip) {
    const key = chip.dataset.yaku;
    const y = KOI_MANUAL_YAKU.find((x) => x.key === key);
    let keys = d.manual.keys;
    if (keys.includes(key)) keys = keys.filter((k) => k !== key);
    else {
      if (y.group) keys = keys.filter((k) => KOI_MANUAL_YAKU.find((x) => x.key === k).group !== y.group);
      keys = [...keys, key];
    }
    d.manual.keys = keys;
    return renderEditor();
  }
  const step = e.target.closest('[data-count] button');
  if (step) {
    const key = step.parentElement.dataset.count;
    const y = KOI_COUNT_YAKU.find((x) => x.key === key);
    let n = (d.manual.counts[key] || 0) + +step.dataset.d;
    // 0 から＋で最初の役の枚数へ、最小枚数から−で0へ
    if (n > 0 && n < y.min) n = step.dataset.d > 0 ? y.min : 0;
    d.manual.counts[key] = Math.min(y.max, Math.max(0, n));
    return renderEditor();
  }
  if (e.target.closest('#btnRest')) {
    const owned = new Set(d.captured.flat());
    for (let id = 0; id < 48; id++) if (!owned.has(id)) d.captured[d.active].push(id);
    return renderEditor();
  }
  if (e.target.closest('#btnClear')) {
    d.captured[d.active] = [];
    return renderEditor();
  }
});
$('#edBody').addEventListener('change', (e) => {
  if (e.target.id === 'oppKoikoi') {
    ed.detail.oppKoikoi = e.target.checked;
    renderResult();
  }
});

// 札のタップでは全体を描き直さず、選択状態と結果だけ更新する（スクロール位置を保つ）
function updateGrid() {
  const d = ed.detail;
  if (game.mode === 'hanaawase') return renderEditor();
  document.querySelectorAll('#edBody .pick').forEach((b) => b.classList.toggle('on', d.cards.includes(+b.dataset.id)));
  renderResult();
}

$('#btnEdSave').addEventListener('click', () => {
  const d = structuredClone(ed.detail);
  delete d.active;
  if (game.mode === 'koikoi') {
    // 使わない入力は残さない
    if (d.winner == null || d.method !== 'cards') d.cards = [];
    if (d.winner == null || d.method !== 'manual') d.manual = { keys: [], counts: { tane: 0, tan: 0, kasu: 0 } };
    if (d.winner == null) d.method = 'cards';
  }
  if (ed.index == null) game.records.push(d);
  else game.records[ed.index] = d;
  save();
  hide('#editor');
  renderBoard();
});
$('#btnEdCancel').addEventListener('click', () => hide('#editor'));
$('#btnDelete').addEventListener('click', () => {
  if (!confirm(`第${ed.index + 1}局の記録を消しますか？`)) return;
  game.records.splice(ed.index, 1);
  save();
  hide('#editor');
  renderBoard();
});

// ---------- 共通 ----------
function show(sel) {
  $(sel).hidden = false;
  document.body.classList.add('locked');
}
function hide(sel) {
  $(sel).hidden = true;
  if ($('#setup').hidden && $('#editor').hidden) document.body.classList.remove('locked');
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

renderBoard();
if (!game) openSetup(true);
