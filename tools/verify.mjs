#!/usr/bin/env node
// 使い方: node tools/verify.mjs hanafuda-xxxx.json
// ゲーム画面と同じコードで、保存した対局記録を検証します。
import { readFileSync } from 'node:fs';
import { verifyLog } from '../js/match.js';
import { CARDS } from '../js/cards.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/verify.mjs <log.json>');
  process.exit(2);
}
const log = JSON.parse(readFileSync(file, 'utf8'));
const v = verifyLog(log);
for (const c of v.checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
for (const r of v.rounds) {
  const names = (a) => a.map((c) => CARDS[c].name).join(' ');
  console.log(`\n第${r.round}局 山札の並び（配り直し ${r.attempt} 回）`);
  console.log(`  親の手札: ${names(r.deck.slice(0, 8))}`);
  console.log(`  場      : ${names(r.deck.slice(8, 16))}`);
  console.log(`  子の手札: ${names(r.deck.slice(16, 24))}`);
  console.log(`  山札    : ${names(r.deck.slice(24))}`);
}
console.log(v.pass ? '\nすべての検証に合格しました' : '\n一致しない項目があります');
process.exit(v.pass ? 0 : 1);
