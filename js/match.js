// 試合全体（複数の局）の管理と、記録（ログ）・検証。
import { PROTOCOL, commitmentOf, deckKeyOf, cpuKeyOf, firstOyaOf, shuffledDeck } from './rng.js';
import { newRound, apply, advance, runAuto, isDecision, viewFor, isLegal, nextOya } from './engine.js';
import { decide, CPU_REV } from './cpu.js';
import { sha256Hex } from './sha256.js';

export const HUMAN = 0;
export const CPU = 1;

export function createMatch({ dealerSeed, cpuSeed, playerSeed, rules, cpuLevel, cpuRev = CPU_REV }) {
  const deckKey = deckKeyOf(dealerSeed, playerSeed);
  const m = {
    secret: { dealerSeed, cpuSeed }, // 試合終了まで公開しない
    deckKey,
    cpuKey: cpuKeyOf(cpuSeed),
    log: {
      protocol: PROTOCOL,
      commitment: commitmentOf(dealerSeed, cpuSeed),
      playerSeed,
      rules,
      cpuLevel,
      cpuRev,
      startedAt: new Date().toISOString(),
      firstOya: firstOyaOf(deckKey),
      rounds: [],
      totals: [0, 0],
      finished: false,
      dealerSeed: null,
      cpuSeed: null,
      undos: [], // 巻き戻しの記録（取り消した手も残す）
    },
    state: null,
  };
  startRound(m);
  return m;
}

export function startRound(m) {
  const log = m.log;
  const n = log.rounds.length + 1;
  const prev = log.rounds[n - 2];
  const oya = prev ? nextOya(prev, log.rules) : log.firstOya;
  m.state = runAuto(newRound(m.deckKey, n, oya, log.rules));
  log.rounds.push({ round: n, oya, attempt: m.state.attempt, actions: [], result: null });
  if (m.state.phase === 'end') finishRound(m);
  return m.state;
}

export function cpuView(m) {
  return viewFor(m.state, CPU, { matchScores: [...m.log.totals], roundsTotal: m.log.rules.rounds });
}

// 行動を適用（人・CPU 共通。違反手はここで弾く）
export function act(m, player, action) {
  if (m.state.turn !== player || !isDecision(m.state)) throw new Error('not your turn');
  if (!isLegal(m.state, action)) throw new Error('illegal');
  m.state = apply(m.state, action);
  m.log.rounds.at(-1).actions.push({ p: player, ...action });
  if (m.state.phase === 'end') finishRound(m);
  return m.state;
}

// 自動フェーズを1段だけ進める（UI はこの間にアニメーションを挟む）
export function step(m) {
  m.state = advance(m.state);
  if (m.state.phase === 'end') finishRound(m);
  return m.state;
}

export function stepAll(m) {
  while (m.state.phase !== 'end' && !isDecision(m.state)) step(m);
  return m.state;
}

function finishRound(m) {
  const r = m.log.rounds.at(-1);
  r.result = m.state.result;
  r.result.points.forEach((v, p) => { m.log.totals[p] += v; });
}

// ---- 巻き戻し ----
// 今の局で、あなたの最後の手（とそのあとの CPU の手）を取り消して、その手を選ぶ前の局面に戻す。
// 山札は種で固定なので、戻してもめくる札は変わらない。めくった札を見てから打ち直せてしまうので、
// 取り消した手はすべて log.undos に残し、検証画面に回数を表示する。
export function canUndo(m) {
  const r = m.log.rounds.at(-1);
  return !!r && m.state.phase !== 'end' && r.actions.some((a) => a.p === HUMAN);
}

export function undo(m) {
  if (!canUndo(m)) return false;
  const r = m.log.rounds.at(-1);
  const i = r.actions.findLastIndex((a) => a.p === HUMAN);
  const removed = r.actions.slice(i);
  r.actions = r.actions.slice(0, i);
  let s = runAuto(newRound(m.deckKey, r.round, r.oya, m.log.rules));
  for (const { p, ...action } of r.actions) s = runAuto(apply(s, action));
  m.state = s;
  (m.log.undos ||= []).push({ round: r.round, at: i, removed });
  return true;
}

export const isMatchOver = (m) =>
  m.state.phase === 'end' && m.log.rounds.length >= m.log.rules.rounds;

// 試合終了（または途中終了）で秘密の種を公開
export function reveal(m, aborted = false) {
  m.log.dealerSeed = m.secret.dealerSeed;
  m.log.cpuSeed = m.secret.cpuSeed;
  m.log.finished = !aborted;
  m.log.aborted = aborted;
  m.log.endedAt = new Date().toISOString();
  m.log.logHash = sha256Hex(JSON.stringify(stripHash(m.log)));
  return m.log;
}

const stripHash = (log) => {
  const { logHash, ...rest } = log;
  return rest;
};

// ---- 検証 ----
// ログだけから、コミットメント・山札・全手の合法性・点数・CPU の再現性を確かめる
export function verifyLog(log, { checkCpu = true } = {}) {
  const checks = [];
  const ok = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });
  const fail = (name, detail) => ok(name, false, detail);

  if (log.protocol !== PROTOCOL) fail('プロトコル', `未知のプロトコル ${log.protocol}`);
  if (!log.dealerSeed || !log.cpuSeed) {
    fail('種の公開', 'まだ種が公開されていません（試合終了後に検証できます）');
    return { pass: false, checks, rounds: [] };
  }
  const commit = commitmentOf(log.dealerSeed, log.cpuSeed);
  ok('コミットメント一致', commit === log.commitment, `SHA-256 = ${commit}`);
  if (log.logHash) ok('ログの改ざんなし', sha256Hex(JSON.stringify(stripHash(log))) === log.logHash);

  const deckKey = deckKeyOf(log.dealerSeed, log.playerSeed);
  const cpuKey = cpuKeyOf(log.cpuSeed);
  ok('親決め', firstOyaOf(deckKey) === log.firstOya);

  const totals = [0, 0];
  const rounds = [];
  let cpuChecked = 0;
  let cpuMismatch = 0;
  let prev = null;
  for (const r of log.rounds) {
    const expectOya = prev ? (prev.result ? nextOya(prev, log.rules) : null) : log.firstOya;
    if (r.oya !== expectOya) fail(`${r.round}局 親`, `親が想定と違います`);
    let s = runAuto(newRound(deckKey, r.round, r.oya, log.rules));
    // おいちょかぶは11月・12月を抜いた40枚を同じ順で使う
    const deck = shuffledDeck(deckKey, r.round, s.attempt).filter((c) => log.rules.mode !== 'oicho' || c < 40);
    rounds.push({ round: r.round, deck, attempt: s.attempt, initial: { hands: s.hands, field: s.field } });
    if (s.attempt !== r.attempt) fail(`${r.round}局 配り直し`, '配り直し回数が一致しません');
    let illegal = null;
    for (const a of r.actions) {
      const { p, ...action } = a;
      if (s.phase === 'end' || s.turn !== p || !isLegal(s, action)) {
        illegal = a;
        break;
      }
      if (checkCpu && p === CPU) {
        const view = viewFor(s, CPU, { matchScores: [...totals], roundsTotal: log.rules.rounds });
        const again = decide(view, log.cpuLevel, cpuKey, log.cpuRev ?? 1);
        cpuChecked++;
        if (JSON.stringify(again) !== JSON.stringify(action)) cpuMismatch++;
      }
      s = runAuto(apply(s, action));
    }
    if (illegal) fail(`${r.round}局 手順`, `不正な手 ${JSON.stringify(illegal)}`);
    const finished = s.phase === 'end';
    if (r.result) {
      ok(
        `${r.round}局 結果`,
        finished && sameResult(s.result, r.result),
        finished ? `${winnerLabel(s.result.winner)} ${s.result.score}点` : '局が終わっていません',
      );
      if (finished) s.result.points.forEach((v, p) => { totals[p] += v; });
    }
    prev = r;
  }
  ok('合計点', JSON.stringify(totals) === JSON.stringify(log.totals), `あなた ${totals[0]} / CPU ${totals[1]}`);
  if (checkCpu)
    ok('CPU は公開情報だけで判断', cpuMismatch === 0, `${cpuChecked}手を再計算、不一致 ${cpuMismatch}`);
  const undos = log.undos || [];
  if (undos.length) {
    // 巻き戻しは不正ではないが、めくった札を見てから打ち直せるので回数を明示する
    const legalUndo = undos.every((u) => u.removed.length && u.removed[0].p === HUMAN);
    ok('巻き戻し', legalUndo, `${undos.length}回（あなたが取り消した手。山札の札を見てから打ち直せるため記録しています）`);
  }
  return { pass: checks.every((c) => c.pass), checks, rounds };
}

const winnerLabel = (w) => (w === HUMAN ? 'あなた' : w === CPU ? 'CPU' : '流局');

// ---- 中断と再開 ----
// 保存するのは「種・設定・これまでの行動」だけ。再開時は同じ種から最初の局面を作り、
// 行動を順に再生して元の局面に戻す。山札は種で固定なので、リロードしても引き直しにはならない。
export function snapshot(m) {
  const { dealerSeed, cpuSeed } = m.secret;
  const l = m.log;
  return {
    v: 1,
    params: { dealerSeed, cpuSeed, playerSeed: l.playerSeed, rules: l.rules, cpuLevel: l.cpuLevel, cpuRev: l.cpuRev },
    startedAt: l.startedAt,
    rounds: l.rounds.map((r) => r.actions),
    undos: l.undos || [],
  };
}

export function resumeMatch(snap) {
  // 版の記録がない中断データは以前の打ち方のまま続ける
  const m = createMatch({ ...snap.params, cpuRev: snap.params.cpuRev ?? 1 });
  m.log.startedAt = snap.startedAt;
  m.log.undos = snap.undos || [];
  snap.rounds.forEach((actions, i) => {
    if (i > 0) startRound(m);
    for (const { p, ...action } of actions) {
      stepAll(m);
      act(m, p, action);
    }
    stepAll(m);
  });
  return m;
}

// 以前のバージョンの記録には points などの項目がないので、記録にある項目だけを比べる
function sameResult(computed, recorded) {
  const pick = Object.fromEntries(Object.keys(recorded).map((k) => [k, computed[k]]));
  return JSON.stringify(pick) === JSON.stringify(recorded);
}
