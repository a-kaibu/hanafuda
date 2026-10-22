// 検証可能な決定的乱数。すべて「文字列 → SHA-256」で定義しているので、
// 他の言語でも VERIFY.md の手順どおりに再計算できる。

import { sha256, utf8, sha256Hex } from './sha256.js';

export const PROTOCOL = 'hanafuda-koikoi-v1';

// key と label から SHA-256(key|label|k) を k=0,1,2… と連結したバイト列を作る
export class Stream {
  constructor(key, label) {
    this.key = key;
    this.label = label;
    this.k = 0;
    this.buf = null;
    this.pos = 32;
  }
  next32() {
    if (this.pos >= 32) {
      this.buf = sha256(utf8(`${this.key}|${this.label}|${this.k++}`));
      this.pos = 0;
    }
    const b = this.buf;
    const p = this.pos;
    this.pos += 4;
    return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  }
  // 0..n-1 の一様乱数（棄却サンプリングで偏りなし）
  uniform(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const x = this.next32();
      if (x < limit) return x % n;
    }
  }
  random() {
    return this.next32() / 0x100000000;
  }
}

export function randomHex(nBytes = 32) {
  const a = new Uint8Array(nBytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const commitmentOf = (dealerSeed, cpuSeed) =>
  sha256Hex(`${PROTOCOL}|commit|${dealerSeed}|${cpuSeed}`);

export const deckKeyOf = (dealerSeed, playerSeed) =>
  sha256Hex(`${PROTOCOL}|deck|${dealerSeed}|${playerSeed}`);

export const cpuKeyOf = (cpuSeed) => sha256Hex(`${PROTOCOL}|cpu|${cpuSeed}`);

// 局 r（1始まり）・配り直し a 回目の山札順。Fisher–Yates。
export function shuffledDeck(deckKey, round, attempt) {
  const s = new Stream(deckKey, `round:${round}:deal:${attempt}`);
  const d = Array.from({ length: 48 }, (_, i) => i);
  for (let i = 47; i > 0; i--) {
    const j = s.uniform(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// 親決め：鍵から 1 ビット
export function firstOyaOf(deckKey) {
  return new Stream(deckKey, 'oya').uniform(2);
}
