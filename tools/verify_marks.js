// 路面標示と交差点の設備(8d章 ROAD_MARKS・SIGNAL)を検査する。京王の road-marks(⑦ 4i)の仕様に、品川の道路(国土地理院の中心線の帯)を合わせた。
//   基準(検証側が持つ。HTML から読まない)は、新宿・京王の仕様と、2026-11-21 の実測(交差点 250・縞 4,811・停止線 331・信号の灯器 194)の
//   約半分を下限にした。下限が低すぎて壊れ方を見逃さないよう、数を見る検査のほかに「性質」の検査(周期・左側通行・建物と構造物の帯・高さ)を置く
//   使い方: node tools/verify_marks.js [keikyu_shinagawa_3d.html]
const path = process.argv[2] || 'keikyu_shinagawa_3d.html';
const X = require('./stub_three')(path,
  'ROAD_MARKS:ROAD_MARKS, SIGNAL:SIGNAL, signalState:signalState, stepSignals:stepSignals, plbHit:plbHit, roadHit:roadHit, terH:terH, ROAD_Y:ROAD_Y,' +
  'prjXY:prjXY, DOM:DOM, DECK_END:DECK_END, deckHalf:deckHalf, cutHalf:cutHalf');
let ng = 0;
const ok = (name, cond, got) => { console.log((cond ? 'OK  ' : 'NG  ') + name + (got ? '  … ' + got : '')); if (!cond) ng++; };
const M = X.ROAD_MARKS, S = X.SIGNAL;
console.log('=== 路面標示・交差点・信号(京王の road-marks。品川の道路の中心線から) ===');
ok('交差点・横断歩道・停止線・信号が十分ある', M.nodes.length >= 120 && M.bars >= 2000 && M.stops >= 150 && S.heads.length >= 80,
  '交差点' + M.nodes.length + '・縞' + M.bars + '・停止線' + M.stops + '・信号' + S.heads.length);
ok('外側線・中央線・車線の境・ガードパイプ・止まれがある', M.edge >= 400 && M.center >= 400 && M.lane >= 400 && M.guards >= 3000 && M.tomare >= 30,
  '外側線' + M.edge + '・中央線' + M.center + '・車線の境' + M.lane + '・ガード支柱' + M.guards + '・止まれ' + M.tomare);
// 信号の周期:各灯器で 60秒のうち 青25・黄3・赤32。同じ交差点の2つの組が同時に青にならない
let badCyc = 0, bothG = 0, pairs = 0;
for (const h of S.heads) { const c = { g: 0, y: 0, r: 0 }; for (let t = 0; t < 60; t++) c[X.signalState(h, t)]++; if (c.g !== 25 || c.y !== 3 || c.r !== 32) badCyc++; }
for (const n of M.nodes) { if (!n.sig) continue; const hs = S.heads.filter(h => h.node === n), g0 = hs.find(h => !h.g), g1 = hs.find(h => h.g);
  if (g0 && g1) { pairs++; for (let t = 0; t < 60; t++) if (X.signalState(g0, t) === 'g' && X.signalState(g1, t) === 'g') bothG++; } }
ok('信号の周期(青25・黄3・赤32)・交差する組が同時に青にならない', badCyc === 0 && bothG === 0 && pairs >= 15, '周期違い' + badCyc + '・同時に青' + bothG + '・組のある交差点' + pairs);
// 停止線は近づく車の左の半分(左側通行。方位で判定)
let tot = 0, bad = 0;
for (const s of M.stopList) { const hx = -s.ox, hz = -s.oz, dx = s.x - s.ax, dz = s.z - s.az; let exp = null;
  if (hx < -.94) exp = dz > 0; else if (hx > .94) exp = dz < 0; else if (hz < -.94) exp = dx < 0; else if (hz > .94) exp = dx > 0;
  if (exp === null) continue; tot++; if (!exp) bad++; }
ok('停止線が近づく車の左側(左側通行)', tot >= 20 && bad === 0, '検査' + tot + '・逆' + bad);
// 標示が建物・京急の構造物の帯・道路の外に出ない(橋・高架・自動車専用の上には作らない=道路の面の上にある)
let inB = 0, inK = 0, offRoad = 0;
for (const b of M.barList) { if (X.plbHit(b[0], b[1], 0)) inB++;
  const q = X.prjXY(b[0], b[1]); if (q.s > X.DOM.x0 - 5 && q.s < X.DOM.x1 + 5 && Math.abs(q.off) < (q.s > X.DECK_END ? X.cutHalf(q.s, q.off < 0 ? -1 : 1) : X.deckHalf(q.s)) + 1) inK++;
  if (!X.roadHit(b[0], b[1], 0.5)) offRoad++; }
ok('横断歩道の縞が建物・京急の構造物の帯に掛からず、道路の面の上にある', inB === 0 && inK === 0 && offRoad <= M.barList.length * 0.02, '縞' + M.barList.length + '・建物' + inB + '・構造物の帯' + inK + '・道路の外' + offRoad);
// 信号の柱が口の左の縁のすぐ外(口の軸から 0〜hw+2m)
let bp = 0; for (const h of S.heads) { const d = (h.x - h.node.x) * h.nx + (h.z - h.node.z) * h.nz; if (!(d > 0 && d < h.hw + 2)) bp++; }
ok('信号の柱が口の左の縁のすぐ外にある', bp === 0, '外れ' + bp);
// 路面の面の高さ=地形+道路の面(ROAD_Y[1])+0.04m(±0.05m。2m ごとに刻んだ折れ線なので斜面・格子の折れ目で最大 0.04m 外れる。標示は路面の +0.04m なので 0.04 を超えると路面に潜る)
{ // 面の高さ:路面に貼る白・黄の頂点(色が赤みのもの。ガードパイプは青みの白で別)だけ測る
  let worst = 0, n = 0;
  for (const m of M.meshes) { const A = m.geometry.attributes.position.array, C = m.geometry.attributes.color.array;
    for (let i = 0; i < A.length / 3; i += 5) { if (!(C[3 * i] > C[3 * i + 2] + 0.01)) continue;
      worst = Math.max(worst, Math.abs(A[3 * i + 1] - (X.terH(A[3 * i], A[3 * i + 2]) + X.ROAD_Y[1] + 0.04))); n++; } }
  ok('標示の面が地形+道路の面+0.04m に沿う(±0.05m。2m ごとに刻んだ折れ線なので斜面・格子の折れ目で外れる分)', worst <= 0.05 && n > 1000, '点' + n + '・最大のずれ' + worst.toFixed(3) + 'm');
}
ok('面は 500m 四方のまとまりごと・三角形は上限内(遠くは描かない)', M.meshes.length >= 4 && M.meshes.length <= 40 && M.tris <= 200000, 'まとまり' + M.meshes.length + '・三角形' + M.tris);
X.stepSignals(1000.2); const c0 = S.t; X.stepSignals(1000.7); ok('信号の灯は毎秒だけ書き換える', S.t === 1000 && c0 === 1000, 't=' + S.t);
console.log(ng ? '\nFAIL: ' + ng : '\nRESULT: PASS'); process.exit(ng ? 1 : 0);
