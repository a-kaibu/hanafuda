// CPU は Web Worker の中で動く。メインスレッドの対局状態（山札・相手の手札）には
// 物理的に触れられず、postMessage で届く公開情報のコピーだけを見て手を返す。
import { decide } from './cpu.js';

self.onmessage = (e) => {
  const { id, view, level, cpuKey, rev } = e.data;
  try {
    self.postMessage({ id, action: decide(view, level, cpuKey, rev) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
