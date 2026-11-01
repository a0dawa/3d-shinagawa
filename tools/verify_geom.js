// 線形・縦断・構造の数値検証(品川版 ③)。
//
//   京王版の verify_line.js は京王の留置線・交差鉄道に依存するので、品川版では線区に依存しない数値を
//   ここで測る。基準値は検証側が持つ(HTML からは読まない。CLAUDE.md の「検証の基準値」の表と同じ)。
//     ・最小曲線半径(線路中心。20m の弦の3点の外接円)
//     ・最急勾配(レール面。10m の差分)/ホームの中の勾配(新設の駅)
//     ・構造物の半幅 − 最も外の線路の中心(高架・掘割の縁から線路まで)
//     ・JR 等の線路の上の桁下の離隔(国土地理院の線路の中心 → 地表+レール面の高さ)
//     ・道路の上の桁下の離隔(国土地理院の道路の面)
//     ・JR 等の線路の上・道路の上に立つ高架の柱の数
//     ・品川の停止位置がホームに収まり、8両(2100形)がホームに入ること
//   使い方: node tools/verify_geom.js [keikyu_shinagawa_3d.html]
const path = process.argv[2] || 'keikyu_shinagawa_3d.html';
const X = require('./stub_three')(path,
  'DOM:DOM,STA:STA,frame:frame,railY:railY,prjXY:prjXY,deckHalf:deckHalf,TRACKS:TRACKS,platRange:platRange,' +
  'stopPosOf:stopPosOf,DECK_END:DECK_END,PS0:PS0,DECK_DROP:DECK_DROP,GIRDER:GIRDER,terH:terH,' +
  'GSR:(typeof GSR!=="undefined"?GSR:null),ROADS_PL:ROADS_PL,VIA_COLS:VIA_COLS,K21:K21,TRAIN_CARS:TRAIN_CARS,' +
  'VIA_THRU:(typeof VIA_THRU!=="undefined"?VIA_THRU:[]),PIERS:PIERS,SG_DECK:(typeof SG_DECK!=="undefined"?SG_DECK:[])');

/* ---- 検証側が独立に持つ基準値 ---- */
const REF = {
  R_MIN: 140,          // 最小曲線半径[m](推定の線形の下限。普通鉄道構造規則の本線の下限 160m より緩い既存区間を含むため 140m)
  G_MAX: 0.035,        // 最急勾配(35‰)
  G_PLAT: 0.005,       // ホームの中の勾配(5‰)
  EDGE: 2.34,          // 構造物の半幅 − 最も外の線路の中心[m](車両限界の半幅 1.70 + 保守の通路など)
  JR_CLEAR: 6.0,       // JR 等の線路のレール面から桁下まで[m](架線を張る高さ)
  JR_RAIL_H: 0.46,     // 描いた JR の線路のレール面の高さ(地表から。道床 0.30+レール 0.16)
  ROAD_CLEAR: 4.7,     // 道路の上の桁下の離隔[m](道路構造令の建築限界 4.5m+余裕)
  ROAD_Y: 0.12,        // 道路の面の高さ(地表から)
  JR_COL: 2.5,         // 柱が JR 等の線路の中心から離れるべき距離[m]
  STOP_FIT: 1.0,       // 編成の両端とホームの端の余裕[m]
  GIRDER: 2.4,         // 標準の RC 桁(縦梁・横梁)の下端:レール面からの深さ[m]
  DECK_DROP: 0.55, THRU_FLOOR: 1.05,   // 下路桁:床版の上面(レール面−0.55)から床組の下端まで[m]
  THRU_SPAN: 34,       // これを超える径間は下路桁(鋼)にする[m]
  CAT_TOP: 6.15,       // 京急の架線が占める高さの上端(レール面から。き電ちょう架線 5.90+余裕 0.25)
  CAT_GAP: 0.3,        // 自由通路の床の下端と架線の上端の離隔[m]
  CROSS: 45,           // 「線路を横切る道路」とみなす角度[°](道路の面の主軸と線路の接線。これ未満は線路に沿う道路=別線の用地)
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, expect, got, cond ? 'OK' : 'NG']); }

/* ---- 1. 最小曲線半径 ---- */
{
  let rmin = Infinity, at = null;
  const P = (s) => X.frame(s, 0);
  for (let s = X.DOM.x0 + 10; s <= X.DOM.x1 - 10; s += 1) {
    const a = P(s - 10), b = P(s), c = P(s + 10);
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    const cr = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));   // 2×三角形の面積
    const R = cr < 1e-9 ? Infinity : ab * bc * ca / (2 * cr);
    if (R < rmin) { rmin = R; at = s; }
  }
  ok('最小曲線半径(線路中心)', rmin >= REF.R_MIN, '≥' + REF.R_MIN + 'm', rmin.toFixed(0) + 'm(s=' + at + ')');
}

/* ---- 2. 勾配 ---- */
const grade = (s) => (X.railY(s + 5) - X.railY(s - 5)) / 10;
{
  let gmax = 0, at = null;
  for (let s = X.DOM.x0 + 5; s <= X.DOM.x1 - 5; s += 1) { const g = Math.abs(grade(s)); if (g > gmax) { gmax = g; at = s; } }
  ok('最急勾配', gmax <= REF.G_MAX + 1e-4, '≤' + REF.G_MAX * 1000 + '‰', (gmax * 1000).toFixed(1) + '‰(s=' + at + ')');
  for (const st of X.STA) {
    const r = X.platRange(st); let g = 0;
    for (let s = r[0] + 5; s <= r[1] - 5; s += 1) g = Math.max(g, Math.abs(grade(s)));
    ok('ホームの中の勾配(' + st.n + ')', g <= REF.G_PLAT + 1e-6, '≤' + REF.G_PLAT * 1000 + '‰', (g * 1000).toFixed(2) + '‰');
  }
}

/* ---- 3. 構造物の半幅 − 最も外の線路 ---- */
{
  let mmin = Infinity, at = null;
  for (let s = X.DOM.x0; s <= X.DECK_END; s += 1) {
    let o = 0; for (const t of X.TRACKS) if (s >= t.x0 && s <= t.x1) o = Math.max(o, Math.abs(t.zf(s)));
    const m = X.deckHalf(s) - o; if (m < mmin) { mmin = m; at = s; }
  }
  ok('構造の半幅 − 最も外の線路', mmin >= REF.EDGE - 1e-6, '≥' + REF.EDGE + 'm', mmin.toFixed(2) + 'm(s=' + at + ')');
}

/* ---- 4. JR 等の線路の上の桁下の離隔 ---- */
// 桁の下端:標準の RC 桁は縦梁・横梁の下端(レール面−GIRDER)、下路桁の径間は床組の下端(床版の上面−THRU_FLOOR)
const inThru = (s) => X.VIA_THRU.some((q) => s > q.s0 && s < q.s1);
const bottom = (s) => inThru(s) ? X.railY(s) - REF.DECK_DROP - REF.THRU_FLOOR : X.railY(s) - REF.GIRDER;
{
  let cmin = Infinity, at = null, n = 0;
  if (X.GSR) for (const L of X.GSR.rails) for (let i = 0; i < L.length - 1; i++) {
    const A = L[i], B = L[i + 1], k = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 2));
    for (let j = 0; j <= k; j++) {
      const x = A[0] + (B[0] - A[0]) * j / k, z = A[1] + (B[1] - A[1]) * j / k, q = X.prjXY(x, z);
      if (q.s < X.DOM.x0 || q.s > X.DECK_END || Math.abs(q.off) > X.deckHalf(q.s)) continue;
      const c = bottom(q.s) - (X.terH(x, z) + REF.JR_RAIL_H); n++;
      if (c < cmin) { cmin = c; at = q.s; }
    }
  }
  ok('JR 等の線路の上の桁下の離隔', n > 0 && cmin >= REF.JR_CLEAR, '≥' + REF.JR_CLEAR + 'm',
     n ? cmin.toFixed(2) + 'm(s=' + at.toFixed(0) + '・' + n + '点)' : '線路が高架の下に無い');
}

/* ---- 5. 道路の上の桁下の離隔 ---- */
{
  let cmin = Infinity, at = null, n = 0;
  for (const R of X.ROADS_PL) for (const p of R.P) {
    const q = X.prjXY(p[0], p[1]);
    if (q.s < X.DOM.x0 || q.s > X.DECK_END || Math.abs(q.off) > X.deckHalf(q.s) + 1) continue;
    const c = bottom(q.s) - (X.terH(p[0], p[1]) + REF.ROAD_Y); n++;
    if (c < cmin) { cmin = c; at = q.s; }
  }
  ok('道路の上の桁下の離隔', n > 0 && cmin >= REF.ROAD_CLEAR, '≥' + REF.ROAD_CLEAR + 'm',
     n ? cmin.toFixed(2) + 'm(s=' + at.toFixed(0) + '・' + n + '点)' : '道路が高架の下に無い');
}

/* ---- 6. JR 等の線路の上・道路の上の高架の柱 ---- */
{
  const jr = [];
  if (X.GSR) for (const L of X.GSR.rails) for (let i = 0; i < L.length - 1; i++) {
    const A = L[i], B = L[i + 1], k = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 1));
    for (let j = 0; j <= k; j++) jr.push([A[0] + (B[0] - A[0]) * j / k, A[1] + (B[1] - A[1]) * j / k]);
  }
  const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  // 道路の面の主軸の向き(主成分)。線路の接線との角度で「横切る道路」かを決める
  const axis = (R) => { let mx = 0, mz = 0; for (const p of R.P) { mx += p[0]; mz += p[1]; } mx /= R.P.length; mz /= R.P.length;
    let a = 0, b = 0, c = 0; for (const p of R.P) { const dx = p[0] - mx, dz = p[1] - mz; a += dx * dx; b += dx * dz; c += dz * dz; }
    return 0.5 * Math.atan2(2 * b, a - c); };
  const crossing = (R, s) => { const f0 = X.frame(s, 0), f1 = X.frame(s + 1, 0), tl = Math.atan2(f1.z - f0.z, f1.x - f0.x);
    let d = Math.abs(((axis(R) - tl) % Math.PI + Math.PI) % Math.PI); if (d > Math.PI / 2) d = Math.PI - d; return d * 180 / Math.PI >= REF.CROSS; };
  let nJ = 0, nR = 0, nC = 0, eJ = null, eR = null;
  for (const c of X.VIA_COLS) for (const o of c.offs) {
    const f = X.frame(c.s, o); nC++;
    if (jr.some((p) => Math.hypot(p[0] - f.x, p[1] - f.z) < REF.JR_COL)) { nJ++; if (!eJ) eJ = 's=' + c.s.toFixed(0); }
    if (c.s >= X.PS0 && X.ROADS_PL.some((R) => f.x > R.bb[0] && f.x < R.bb[1] && f.z > R.bb[2] && f.z < R.bb[3] && inPoly(R.P, f.x, f.z) && crossing(R, c.s))) {
      nR++; if (!eR) eR = 's=' + c.s.toFixed(0); }
  }
  ok('JR 等の線路の上の柱', nC > 0 && nJ === 0, '0本(中心から ' + REF.JR_COL + 'm 以内)', nJ + '本' + (eJ ? '(' + eJ + ')' : '') + ' / 柱 ' + nC + '本');
  ok('線路を横切る道路の上の柱(事業区間)', nR === 0, '0本', nR + '本' + (eR ? '(' + eR + ')' : ''));
}

/* ---- 6b. 長い径間は下路桁 ---- */
{
  const P = X.PIERS.slice().sort((a, b) => a - b); let bad = null, n = 0;
  for (let i = 1; i < P.length; i++) {
    if (P[i] - P[i - 1] <= REF.THRU_SPAN) continue; n++;
    if (!X.VIA_THRU.some((q) => Math.abs(q.s0 - P[i - 1]) < 0.01 && Math.abs(q.s1 - P[i]) < 0.01) && !bad) bad = P[i - 1].toFixed(0) + '〜' + P[i].toFixed(0);
  }
  ok('径間 ' + REF.THRU_SPAN + 'm 超は下路桁', bad === null, '全て', bad ? bad + ' が RC 桁' : n + '径間(下路桁 ' + X.VIA_THRU.length + '径間)');
}

/* ---- 6c. 品川の東西自由通路・西口駅前広場デッキ ---- */
{
  // デッキ・通路の下の道路(国土地理院の道路の面)の桁下
  let cmin = Infinity, at = null, n = 0;
  for (const d of X.SG_DECK) for (const R of X.ROADS_PL) for (const p of R.P) {
    const q = X.prjXY(p[0], p[1]); if (!d.inside(q.s, q.off, 0)) continue;
    const c = d.y0 - (X.terH(p[0], p[1]) + REF.ROAD_Y); n++;
    if (c < cmin) { cmin = c; at = d.kind; }
  }
  ok('西口デッキ・自由通路の下の道路の桁下', X.SG_DECK.length > 0 && n > 0 && cmin >= REF.ROAD_CLEAR, '≥' + REF.ROAD_CLEAR + 'm',
     X.SG_DECK.length ? (n ? cmin.toFixed(2) + 'm(' + at + '・' + n + '点)' : '道路が下に無い') : 'デッキが無い');
  // 線路の上を渡る部分(京急の線路の帯の中)の床の下端と京急の架線
  let gmin = Infinity, ga = null;
  for (const d of X.SG_DECK) for (let s = d.s0; s <= d.s1; s += 2) for (const t of X.TRACKS) {
    if (s < t.x0 || s > t.x1) continue; const o = t.zf(s); if (!d.inside(s, o, 0)) continue;
    const g = d.y0 - (X.railY(s) + REF.CAT_TOP); if (g < gmin) { gmin = g; ga = d.kind + ' s=' + s.toFixed(0); }
  }
  // 橋上駅舎(線路をまたぐ本体)は 7章 concourse。ここでは延伸の部分が線路に掛からないことも含めて見る
  ok('自由通路の床の下端と京急の架線', gmin === Infinity || gmin >= REF.CAT_GAP, '≥' + REF.CAT_GAP + 'm(架線の上端 レール面+' + REF.CAT_TOP + 'm)',
     gmin === Infinity ? '延伸の部分は線路に掛からない' : gmin.toFixed(2) + 'm(' + ga + ')');
}

/* ---- 7. 品川の停止位置と編成の長さ ---- */
{
  const L = (X.TRAIN_CARS - 1) * X.K21.PITCH + X.K21.LEN;
  for (const st of X.STA.filter((q) => q.n === '品川')) {
    const r = X.platRange(st);
    for (const d of [1, -1]) {
      const head = X.stopPosOf(st, d), tail = head - d * L;
      const a = Math.min(head, tail), b = Math.max(head, tail);
      ok('停止位置(' + st.n + (d > 0 ? '・泉岳寺方面' : '・横浜方面') + ')', a >= r[0] + REF.STOP_FIT - 1e-6 && b <= r[1] - REF.STOP_FIT + 1e-6,
         'ホーム ' + r[0].toFixed(1) + '〜' + r[1].toFixed(1) + ' の内(余裕' + REF.STOP_FIT + 'm)', a.toFixed(1) + '〜' + b.toFixed(1) + '(' + L.toFixed(1) + 'm)');
    }
  }
}

/* ---- 表 ---- */
const w = (t, n) => { t = String(t); let l = 0; for (const ch of t) l += ch.charCodeAt(0) > 255 ? 2 : 1; return t + ' '.repeat(Math.max(1, n - l)); };
for (const r of rows) console.log(w(r[0], 36) + w(r[1], 34) + w(r[2], 40) + r[3]);
console.log(ng ? 'RESULT: FAIL(' + ng + '項目NG)' : 'RESULT: PASS');
process.exit(ng ? 1 : 0);
