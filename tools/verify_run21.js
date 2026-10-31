// 自動運転の検証(品川版 ⑤)。HTML の自動運転をそのまま 40分ぶん回して測る。
//
//   ・快特は品川だけに停まる(北品川・新馬場は通過)
//   ・停止位置:先頭車(車体の位置から測る)の前端と、ホームの停止位置の差
//   ・停車時間
//   ・曲線の制限速度:編成の先頭から最後尾までの区間の最も低い制限を超えたコマの数(制限は検証側で曲線半径から独立に計算)
//   ・同じ向きの列車どうしが重ならない
//   ・品川で客用扉が開き、扉の位置がホームドアの開口に合う
//   基準値は下の REF で持つ(HTML から読まない)。制限速度の式(3.7√R)は推定(CLAUDE.md の表)
//   使い方: node tools/verify_run21.js [keikyu_shinagawa_3d.html]
const path = process.argv[2] || 'keikyu_shinagawa_3d.html';
const X = require('./stub_three')(path,
  'trains:trains,driveTrain:driveTrain,placeTrain:placeTrain,stepSwitches:stepSwitches,stepCarDoors:stepCarDoors,' +
  'stepPSD:stepPSD,PSD:PSD,STA:STA,stopPosOf:stopPosOf,frame:frame,prjXY:prjXY,DOM:DOM');

const REF = {
  SIM: 2400, DT: 0.1,              // 回す時間[秒]と刻み
  STOPS: { '快特': ['品川'] },      // 種別ごとの停車駅
  DWELL: 30, DWELL_TOL: 0.25,      // 停車時間[秒](推定)
  STOP_TOL: 1.0,                   // 停止位置の誤差[m]
  CAR_LEN: 17.5, PITCH: 18.0,      // 車体長・連結面間(2100形・推定)
  K: 3.7, STEP: 5, VMAX: { '快特': 90, '普通': 60 },   // 制限速度 v=K√R を STEP 単位に切り下げ・種別の上限[km/h]
  V_TOL: 0.5,                      // 制限の超過とみなす差[km/h]
  DOORX: [-4.85, 4.85], PSD_TOL: 0.15,   // 扉の中心(車体の中心から)・ホームドアの開口との差[m]
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']); }

/* ---- 制限速度の表(検証側で独立に計算。1m ごと)---- */
const L0 = X.DOM.x0, LIM = [];
for (let s = X.DOM.x0; s <= X.DOM.x1; s += 1) {
  let R = Infinity;
  if (s > X.DOM.x0 + 10 && s < X.DOM.x1 - 10) {
    const a = X.frame(s - 10, 0), b = X.frame(s, 0), c = X.frame(s + 10, 0);
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    const cr = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (cr > 1e-9) R = ab * bc * ca / (2 * cr);
  }
  LIM.push(Math.floor(REF.K * Math.sqrt(R) / REF.STEP) * REF.STEP);
}
const limAt = (s) => (s < X.DOM.x0 || s > X.DOM.x1) ? Infinity : LIM[Math.round(s - L0)];

/* ---- 回す ---- */
const N = X.trains.length, lenOf = (t) => (t.cars.length - 1) * REF.PITCH + REF.CAR_LEN;
const stops = [], dwells = [], prev = X.trains.map((t) => t.st), dStart = X.trains.map(() => 0);
let over = 0, overAt = null, maxV = 0, collide = null, doorBad = null, doorN = 0, psdBad = null, psdN = 0;
const headS = (t) => {                       // 先頭車の車体の位置(線路の座標)から先頭の前端
  const p = t.cars[0].position, q = X.prjXY(p.x, p.z);
  return q.s + t.dir * REF.CAR_LEN / 2;
};
for (let k = 0, T = 0; T < REF.SIM; k++, T += REF.DT) {
  for (const t of X.trains) { X.driveTrain(t, REF.DT); X.placeTrain(t); X.stepCarDoors(t, REF.DT); }
  X.stepSwitches(REF.DT); X.stepPSD(REF.DT);
  X.trains.forEach((t, i) => {
    // 停車の始まりと終わり
    if (t.st === 'dwell' && prev[i] !== 'dwell') {
      dStart[i] = T;
      const st = t.atSt, h = headS(t), want = X.stopPosOf(st, t.dir);
      stops.push({ kind: t.kind, st: st.n, err: Math.abs(h - want), dir: t.dir });
    }
    if (prev[i] === 'dwell' && t.st !== 'dwell') dwells.push(T - dStart[i]);
    prev[i] = t.st;
    // 制限速度(線路の範囲の中を走っている間)
    const h = t.x + t.dir * REF.CAR_LEN / 2, tl = h - t.dir * lenOf(t);
    if (t.st !== 'wait' && Math.min(h, tl) > X.DOM.x0 && Math.max(h, tl) < X.DOM.x1) {
      let lim = REF.VMAX[t.kind] || 90;
      for (let s = Math.min(h, tl); s <= Math.max(h, tl); s += 1) lim = Math.min(lim, limAt(s));
      const v = t.v * 3.6; maxV = Math.max(maxV, v);
      if (v > lim + REF.V_TOL) { over++; if (!overAt) overAt = t.kind + ' s=' + h.toFixed(0) + ' ' + v.toFixed(1) + '>' + lim; }
    }
    // 停車中の扉とホームドアの開口
    if (t.st === 'dwell' && t.dwell < REF.DWELL - 5 && t.dwell > 4) {
      doorN++;
      if (!(t.dr > 0.9) && !doorBad) doorBad = t.atSt.n + ' 開度 ' + (t.dr || 0).toFixed(2);
      const row = X.PSD.find((p) => p.st === t.atSt && p.dir === t.dir && p.openable);
      if (!row) { if (!psdBad) psdBad = t.atSt.n + ' ホームドアの列が無い'; }
      else for (const c of t.cars) {
        const q = X.prjXY(c.position.x, c.position.z);
        for (const dx of REF.DOORX) {
          const ds = q.s + dx; psdN++;
          if (!row.open.some((o) => Math.abs(o - ds) <= REF.PSD_TOL) && !psdBad) psdBad = t.atSt.n + ' 扉 s=' + ds.toFixed(2);
        }
      }
    }
  });
  // 同じ向きの列車の重なり
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = X.trains[i], b = X.trains[j];
    if (i === j || a.dir !== b.dir || a.st === 'wait' || b.st === 'wait') continue;
    const ha = a.x + a.dir * REF.CAR_LEN / 2, hb = b.x + b.dir * REF.CAR_LEN / 2, tb = hb - b.dir * lenOf(b);
    if ((hb - ha) * a.dir > 0 && (ha - tb) * a.dir > 0 && !collide) collide = 'T=' + T.toFixed(0) + ' ' + i + '→' + j;
  }
}

/* ---- 判定 ---- */
const wrong = stops.filter((q) => (REF.STOPS[q.kind] || []).indexOf(q.st) < 0);
ok('停車駅(快特=品川だけ)', stops.length > 0 && wrong.length === 0, REF.STOPS['快特'].join('・'),
   wrong.length ? wrong.map((q) => q.st).join(',') + ' に停車' : stops.length + '回 全て品川');
const emax = stops.reduce((m, q) => Math.max(m, q.err), 0);
ok('停止位置の誤差', stops.length > 0 && emax <= REF.STOP_TOL, '±' + REF.STOP_TOL + 'm', emax.toFixed(2) + 'm(' + stops.length + '回)');
const dw = dwells.filter((d) => Math.abs(d - REF.DWELL) > REF.DWELL_TOL);
ok('停車時間', dwells.length > 0 && dw.length === 0, REF.DWELL + '秒', dw.length ? dw.map((d) => d.toFixed(1)).join(',') : dwells.length + '回 全て');
ok('曲線の制限速度の超過', over === 0, '0コマ', over + 'コマ' + (overAt ? '(' + overAt + ')' : '') + '・最高 ' + maxV.toFixed(1) + 'km/h');
ok('同じ向きの列車が重ならない', collide === null, '重ならない', collide || '重ならない');
ok('品川で客用扉が開く', doorN > 0 && doorBad === null, '開度>0.9', doorBad || doorN + 'コマ');
ok('扉の位置とホームドアの開口', psdN > 0 && psdBad === null, '±' + REF.PSD_TOL + 'm', psdBad || psdN + '扉');

const w = (t, n) => { t = String(t); let l = 0; for (const ch of t) l += ch.charCodeAt(0) > 255 ? 2 : 1; return t + ' '.repeat(Math.max(1, n - l)); };
for (const r of rows) console.log(w(r[0], 32) + w(r[1], 22) + w(r[2], 50) + r[3]);
console.log(ng ? 'RESULT: FAIL(' + ng + '項目NG)' : 'RESULT: PASS');
process.exit(ng ? 1 : 0);
