// 検証（全手の再生と CPU 判断の再計算）は重いので別スレッドで行い、画面を止めない。
import { verifyLog } from './match.js';

self.onmessage = (e) => {
  const { id, log } = e.data;
  try {
    self.postMessage({ id, result: verifyLog(log) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
