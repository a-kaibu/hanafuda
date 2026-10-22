// 効果音はすべて Web Audio API で合成する（音声ファイルなし）。
let ctx = null;
let master = null;
let volume = 0.7;
let enabled = true;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}
export function setEnabled(on) {
  enabled = on;
}
export const unlock = () => ac();

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function burst(t, { freq = 1500, q = 1.2, peak = 0.6, dur = 0.08, type = 'bandpass' } = {}) {
  const n = noise();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, 0.002, peak, dur);
  n.connect(f).connect(g).connect(master);
  n.start(t);
  n.stop(t + dur + 0.05);
}

function tone(t, freq, { type = 'sine', peak = 0.3, a = 0.005, dur = 0.3, slideTo = null } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + a + dur + 0.05);
}

// 琴っぽい撥弦音
function pluck(t, freq, peak = 0.22) {
  tone(t, freq, { type: 'triangle', peak, dur: 0.9 });
  tone(t, freq * 2, { type: 'sine', peak: peak * 0.35, dur: 0.5 });
  tone(t, freq * 3.01, { type: 'sine', peak: peak * 0.12, dur: 0.25 });
  burst(t, { freq: freq * 4, q: 3, peak: peak * 0.3, dur: 0.02 });
}

function taiko(t, peak = 0.9) {
  tone(t, 140, { peak, dur: 0.45, slideTo: 48 });
  burst(t, { freq: 220, q: 0.8, peak: peak * 0.5, dur: 0.12, type: 'lowpass' });
}

// 都節音階（日本的な響き）
const MIYAKO = [293.66, 311.13, 392.0, 440.0, 466.16, 587.33, 622.25, 783.99, 880.0];

const SOUNDS = {
  tap: (t) => tone(t, 1250, { peak: 0.08, dur: 0.05 }),
  hover: (t) => tone(t, 1800, { peak: 0.03, dur: 0.03 }),
  slap: (t) => {
    burst(t, { freq: 1800, q: 0.9, peak: 0.7, dur: 0.06 });
    tone(t, 180, { peak: 0.25, dur: 0.07, slideTo: 90 });
  },
  capture: (t) => {
    burst(t, { freq: 2200, q: 1, peak: 0.8, dur: 0.05 });
    tone(t, 220, { peak: 0.3, dur: 0.06, slideTo: 100 });
    burst(t + 0.07, { freq: 1400, q: 2, peak: 0.4, dur: 0.05 });
  },
  flip: (t) => burst(t, { freq: 3500, q: 0.6, peak: 0.25, dur: 0.12, type: 'highpass' }),
  deal: (t) => burst(t, { freq: 2600, q: 0.8, peak: 0.18, dur: 0.04 }),
  turn: (t) => {
    pluck(t, MIYAKO[5], 0.12);
    pluck(t + 0.09, MIYAKO[7], 0.1);
  },
  yaku: (t) => {
    [0, 2, 3, 5, 7, 8].forEach((k, i) => pluck(t + i * 0.08, MIYAKO[k], 0.2));
    taiko(t + 0.5, 0.5);
  },
  koikoi: (t) => {
    taiko(t, 1);
    taiko(t + 0.18, 0.8);
    [5, 7, 8].forEach((k, i) => pluck(t + 0.36 + i * 0.07, MIYAKO[k], 0.22));
  },
  stop: (t) => {
    taiko(t, 1);
    pluck(t + 0.05, MIYAKO[0] / 2, 0.3);
    pluck(t + 0.05, MIYAKO[2] / 2, 0.2);
  },
  win: (t) => {
    [0, 2, 3, 5, 7, 8, 7, 8].forEach((k, i) => pluck(t + i * 0.11, MIYAKO[k], 0.22));
    taiko(t, 0.7);
    taiko(t + 0.88, 1);
  },
  lose: (t) => {
    [8, 6, 4, 1, 0].forEach((k, i) => pluck(t + i * 0.16, MIYAKO[k] / 2, 0.2));
  },
  draw: (t) => {
    pluck(t, MIYAKO[3], 0.15);
    pluck(t + 0.2, MIYAKO[2], 0.15);
  },
  error: (t) => tone(t, 140, { type: 'square', peak: 0.06, dur: 0.12 }),
  open: (t) => burst(t, { freq: 900, q: 0.5, peak: 0.12, dur: 0.18, type: 'lowpass' }),
};

export function play(name, delay = 0) {
  if (!enabled) return;
  const c = ac();
  if (!c || !SOUNDS[name]) return;
  SOUNDS[name](c.currentTime + 0.01 + delay);
}
