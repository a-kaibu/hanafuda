// ブラウザで実際に遊ぶ E2E テスト（Playwright）。
// 3つの遊び方を最後まで遊んで検証が ✓ になること、途中リロードで続きから再開できること、
// こいこいの判断パネルが札に重ならないことを確かめる。
// 実行: npm run test:e2e（初回は npx playwright install chromium が必要）
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/markdown' };
let server;
let base;
let browser;

before(async () => {
  server = http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function open(settings, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(`${m.text()} ${m.location()?.url}`) && errors.push(m.text()));
  // Google Fonts は CI から取れなくてもよいので遮断しておく
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      localStorage.setItem('hanafuda.settings.v1', JSON.stringify({ speed: 0.2, level: 1, sound: false, ...s }));
      sessionStorage.setItem('seeded', '1');
    }
  }, settings);
  await page.goto(base);
  return { page, errors, ctx };
}

// 1手ぶん操作する。戻り値: 'match'（試合終了）/ 'decide' / 'acted' / 'wait'
async function playStep(page, { decide = 'stop' } = {}) {
  if (await page.$('#ovMatch.show')) return 'match';
  if (await page.$('#ovDecide.show')) {
    if (decide === 'hold') return 'decide';
    await page.click(decide === 'stop' ? '#btnStop' : '#btnKoikoi');
    return 'acted';
  }
  if (await page.$('#ovRound.show')) { await page.click('#btnNext'); return 'acted'; }
  const bet = await page.$$('.oi-btn.bet');
  if (bet.length) { await bet[1].click(); return 'acted'; }
  const hs = await page.$$('.oi-btn.hit, .oi-btn.stand');
  if (hs.length) { await hs[1].click(); return 'acted'; }
  const target = await page.$('.card.match.playable');
  if (target) { await target.click(); return 'acted'; }
  const sel = await page.$('.card.selected');
  if (sel) { await sel.click(); return 'acted'; }
  const pl = await page.$$('.card.playable');
  if (pl.length) { await pl.at(-1).click(); return 'acted'; }
  await page.waitForTimeout(120);
  return 'wait';
}

async function playUntil(page, want, limit = 3000, opts) {
  for (let i = 0; i < limit; i++) {
    const r = await playStep(page, opts);
    if (r === want) return true;
    if (r === 'match') return false;
    await page.waitForTimeout(40);
  }
  return false;
}

async function expectVerified(page) {
  await page.waitForFunction(() => !document.querySelector('#matchVerify').classList.contains('wait'), null, { timeout: 120000 });
  assert.equal((await page.textContent('#matchVerify')).trim(), '✓');
  assert.equal(await page.evaluate(() => localStorage.getItem('hanafuda.current.v1')), null);
}

for (const [game, settings] of [
  ['koikoi', { game: 'koikoi', rounds: 2 }],
  ['hanaawase', { game: 'hanaawase', rounds: 1 }],
  ['oicho', { game: 'oicho', oichoRounds: 3 }],
]) {
  test(`${game}: 最後まで遊べて検証が ✓ になる`, { timeout: 300000 }, async () => {
    const { page, errors, ctx } = await open(settings);
    await page.click('#btnStart');
    assert.ok(await playUntil(page, 'match'), '試合が終わらなかった');
    await expectVerified(page);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('途中でリロードしても同じ局面から再開できる', { timeout: 300000 }, async () => {
  const { page, errors, ctx } = await open({ game: 'koikoi', rounds: 2 });
  await page.click('#btnStart');
  for (let i = 0; i < 12; i++) { await playStep(page); await page.waitForTimeout(80); }
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('hanafuda.current.v1') || 'null');
    return s && s.rounds.flat().length > 2;
  }, null, { timeout: 60000 });
  const before = await page.evaluate(() => localStorage.getItem('hanafuda.current.v1'));
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal(await page.$('#ovTitle.show'), null, 'リロード後にタイトルに戻ってしまった');
  assert.match(await page.textContent("#roundLabel"), /局・親/);
  const now = await page.evaluate(() => localStorage.getItem('hanafuda.current.v1'));
  const a = JSON.parse(before);
  const b = JSON.parse(now);
  assert.deepEqual(b.params, a.params, '種が変わってしまった');
  assert.deepEqual(b.rounds.flat().slice(0, a.rounds.flat().length), a.rounds.flat(), '手順が失われた');
  assert.ok(await playUntil(page, 'match'));
  await expectVerified(page);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`こいこいの判断パネルが札に重ならない（${viewport.width}×${viewport.height}）`, { timeout: 300000 }, async () => {
    const { page, errors, ctx } = await open({ game: 'koikoi', rounds: 12 }, viewport);
    await page.click('#btnStart');
    assert.ok(await playUntil(page, 'decide', 6000, { decide: 'hold' }), '役ができる前に試合が終わった');
    await page.waitForTimeout(700); // 札が動き終わるのを待つ
    const overlap = await page.evaluate(() => {
      const top = document.querySelector('#ovDecide .sheet').getBoundingClientRect().top;
      return [...document.querySelectorAll('#layer .card')]
        .filter((el) => getComputedStyle(el).opacity !== '0')
        .map((el) => ({ id: el.dataset.id, bottom: el.getBoundingClientRect().bottom }))
        .filter((c) => c.bottom > top + 1);
    });
    assert.deepEqual(overlap, [], 'パネルの下に隠れた札がある');
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
