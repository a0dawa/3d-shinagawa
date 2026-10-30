// 街並み(建物・樹木)の配置と、交差鉄道(井の頭線・世田谷線)の列車を検査する。
//
//   建物が道路や川の上に建っている・高架下に潜り込んでいる・建物同士がめり込んでいる、
//   といった不具合は俯瞰では気づきにくい。実際に置かれた1棟ずつの世界座標を測り、
//   「置いてはいけない場所」と突き合わせる。
//
//   ※ 期待値(道路の幅・鉄道の建築限界・最小離隔)は検証側が独立に持つ。
//     モデルの KEEP 表をそのまま読むと、表を緩めれば検査も緩む循環になる。
//
//   使い方: node tools/verify_city.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'bldWinAt:(typeof bldWinAt!=="undefined"?bldWinAt:null),BLD_WIN_SRC:(typeof bldWinPatch!=="undefined"?bldWinPatch.toString():""),CITY:CITY,deckHalf:deckHalf,cutHalf:cutHalf,DOM:DOM,INO:INO,SETA:SETA,XR:XR,K8:K8,' +
  'KAN7_X:KAN7_X,NAKANO_X:NAKANO_X,HOSHA23_X:HOSHA23_X,KYU_INOKA_X:KYU_INOKA_X,H154_X:H154_X,H128_X:H128_X,' +
  'H133_X:H133_X,H215_X:H215_X,KANPACHI_X:KANPACHI_X,H216_X:H216_X,H217_X:H217_X,' +
  'JOSUI_X:JOSUI_X,BRIDGE:BRIDGE,XINGS:XINGS,WADA_S:WADA_S,WADA_OFF:WADA_OFF,' +
  'PLAZA_S:PLAZA_S,PLAZA_OFF:PLAZA_OFF,SUBK:SUBK,SUBC:SUBC,' +
  'stepXRail:stepXRail,inoTrains:inoTrains,setaTrain:setaTrain,LAT0:LAT0,MLAT:MLAT,RAW:RAW,' +
  'SETA_CARS:SETA_CARS,' +
  'XCAR:XCAR,K8GEO:K8GEO,XM_WHL:XM_WHL,' +
  'GAUGE_INO:GAUGE_INO,GAUGE_SETA:GAUGE_SETA,RAIL_W:RAIL_W,prjXY:prjXY,frame:frame,' +
  'VIA_COLS:VIA_COLS,EXPY:EXPY,railY:railY,DECK_END:DECK_END,ROADS_PL:ROADS_PL,CITY_LODS:CITY_LODS,' +
  'RD_CARS:(typeof RD_CARS!=="undefined"?RD_CARS:[]),RD_LANES:(typeof RD_LANES!=="undefined"?RD_LANES:[]),' +
  'stepRoadCars:(typeof stepRoadCars!=="undefined"?stepRoadCars:()=>{}),carsDraw:carsDraw,camera:camera,' +
  'PEDS:(typeof PEDS!=="undefined"?PEDS:[]),SIDEWALKS:(typeof SIDEWALKS!=="undefined"?SIDEWALKS:[]),pedPos:(typeof pedPos!=="undefined"?pedPos:null),' +
  'stepPeds:(typeof stepPeds!=="undefined"?stepPeds:()=>{}),KANPACHI_X:KANPACHI_X,' +
  'STRUCT:STRUCT,groundMesh:groundMesh,scene:scene,ROAD_LAMPS:(typeof ROAD_LAMPS!=="undefined"?ROAD_LAMPS:[]),' +
  'TER:(typeof TER!=="undefined"?TER:null),terH:(typeof terH!=="undefined"?terH:()=>0),DP:DP,S_OFS:S_OFS,MAT:MAT,MAT_FENCE:MAT_FENCE,NIGHT:NIGHT,' +
  'ORTHO_MGR:(typeof ORTHO_MGR!=="undefined"?ORTHO_MGR:null),ORTHO_U:(typeof ORTHO_U!=="undefined"?ORTHO_U:null),LON0:LON0,MLON:MLON,' +
  'lodStruct:lodStruct,renderer:renderer,LU:LU,CINE:CINE,MAT_JOSUI:(typeof MAT_JOSUI!=="undefined"?MAT_JOSUI:null),IS_MOBILE:IS_MOBILE');

/* ---- 期待値(検証側が独立して持つ) ----------------------------------------
   道路の幅は4章の描画寸法(box の第1引数)。ここでは"路面の半幅"だけを持ち、
   モデル側が持つ余裕(路肩)は足さない ⇒ 路面に載っていれば必ずNGになる。 */
const REF = {
  MIN_BUILDINGS: 9000,      // 倍増後の下限(2026-10 利用者指示。前回は約5,000棟)
  MIN_TREES: 2000,          // 倍増後の下限(前回1,100本)
  DECK_CLEAR: 4.6,          // 高架下+側道の外縁(桁半幅からの距離[m])
  // 交差鉄道の建築限界の半幅[m]。井の頭線=複線+掘割擁壁(±9.4)、世田谷線=単線+ホーム
  XRAIL_HALF: { 井の頭線: 13.0, 世田谷線: 3.7 },   // 井の頭線は 2026-10-27 から下の INO_CLEAR(線路から測る)。13.0 は写真の検査で近くを除く幅だけに使う
  INO_CLEAR: 3.2,           // 井の頭線:建物は実際の線路の中心から 3.2m(擁壁の外面)より外。ホームの範囲は INO_PLAT_CLEAR
  INO_PLAT_CLEAR: 1.55 + 8.4 + 0.5 + 0.3,   // ホームの縁 1.55+幅 8.4+背面の擁壁 0.5(+厚さの半分)
  INO_KEEP_MAX: 4.0,        // 井の頭線の脇の建物を消しすぎない:ホームの外で、線路の中心から この距離の外の建物は残る   // 世田谷線は線路の脇まで建物が建つ(架線柱の外まで。2026-10-27 利用者指示)
  SETA_TERM: { u: -48, hw: 6.6 },   // 世田谷線の終端(u=0)から 48m はホームと上屋があるので 6.6m
  SETA_KEEP_MAX: 4.5,       // 世田谷線の脇の建物を消しすぎない:終端の外では、線路の中心から この距離の内に掛かって外した建物が無い
  GAP: 0.0,                 // 物同士は外接円が重ならなければよい(接触=NG)
  // [s位置, 路面の半幅[m], offの半長([m]。省略=全幅)]
  CROSS: [['環七', 'KAN7_X', 15], ['中野通り', 'NAKANO_X', 10], ['放射23', 'HOSHA23_X', 9], ['旧井の頭', 'KYU_INOKA_X', 7],
  ['補助154', 'H154_X', 8, undefined, '計画'], ['補助128', 'H128_X', 7.5, undefined, '計画'], ['補助133', 'H133_X', 7.5, undefined, '計画'],
  ['補助215', 'H215_X', 7.5, undefined, '計画'], ['環八', 'KANPACHI_X', 17], ['補助216', 'H216_X', 8, undefined, '計画'],
  ['補助217', 'H217_X', 8, undefined, '計画'], ['玉川上水', 'JOSUI_X', 7.5, 230]],
  // 実データの道路(plateau_land.js)があるときの基準。建物は道路の縁に接して建つので、食い込み 0.3m までは許す
  ROAD_BLDG_IN: 0.3,
  SIDEWALK_IN: 1.5,         // 歩道の並木(桜)は道路区域の縁からこの深さ[m]まで入ってよい(幹の位置)
  // 用途の区分(plateau_import.py の USAGE)。住宅(1〜3)と業務(4)・工場倉庫(7,8)は別の色の組であること
  USE_GROUPS: [[1, 2, 3], [4], [7, 8]],
  XING_MIN: 3,              // 線路を横切る道路とみなす長さ[m](中心と桁の両端が道路の上に続く)
  XING_COL_CLEAR: 1.0,      // 横切る道路の縁から柱の中心までの最小[m](柱の半幅0.5+余裕)
  EXPY_CLEAR: 7.0,          // 自動車道の床版の下面とレール面の最小の差[m](架線の上)
  RIVER_HALF: 4.5,          // 仙川(河川)の半幅[m]
  RIVER_OFF: 75,
  POND: [[-105, 22, 19], [115, -24, 21]],   // 和田堀給水所の池 [WADA_Sからのs, off, 半径]
  // 並行道路 [名称, offの中心, 路面の半幅, s範囲]
  PARA: [['甲州街道', 158, 13, -1e9, 1e9], ['旧甲州街道', 93, 5, 4200, 1e9],
  ['首都高4号', 300, 8, 2000, 6100]],
  // 井の頭線:5両編成。明大前のホーム(実測緯度・長さ110m)。上り(渋谷方)は東側、下り(吉祥寺方)は西側
  INO_CARS: 5,
  INO_PLAT: [{ n: '上り(東側)', lat: 35.6674073382136, side: 1 }, { n: '下り(西側)', lat: 35.66801642659758, side: -1 }],
  INO_PLAT_LEN: 110,
  INO_DWELL_MIN: 15,        // 明大前での停車[秒]の下限
  // 交差鉄道の線路の位置(RAW.rail の tr=国土地理院のベクトルタイルの軌道の中心線)。台車の中心・レールはその上(検証側で線までの距離を測る)
  XR_ON_TRACK: 0.02,        // 台車の中心と線路の中心線の差[m]
  XR_RAIL_TOL: 0.08,        // レールの頂点と(軌間+頭部の幅)/2 の差[m](頭部・腹・底部の幅の内)
  SETA_XO_ZONE: [-100, -30],// 世田谷線の渡り線を探してよい u の範囲(終端から)。台車はこの外では線路の上、これより南では左側通行の線
  SETA_END: 12,             // 世田谷線の終端に停まるとき、北の端が終端(u=0)から何m 以内か
  SIM: [0.25, 1600],        // 走らせる刻み[秒]・回数(400秒=上下とも1往復以上)
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) {
  if (!cond) ng++;
  rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']);
}

// 交差鉄道の線形(検証側の実装。tools/xcurve.js):RAW.rail の tr から検証側の換算で作った曲線
const xCurve = (rl, origin) => require('./xcurve')(X, rl, origin);
const XC = { INO: xCurve(X.RAW.rail.ino, 'cross'), SETA: xCurve(X.RAW.rail.seta, 'end') };
// 井の頭線の線路 k(0=西・下り/1=東・上り)の側のホームの u の範囲(利用者が測った緯度から 110m。端から m の余裕)
const inoPlat = (k, u, m) => { const q = REF.INO_PLAT[k ? 0 : 1], u0 = XC.INO.uAtZ(-(q.lat - X.LAT0) * X.MLAT); return u > u0 - m && u < u0 + REF.INO_PLAT_LEN + m; };

const B = X.CITY.buildings, T = X.CITY.trees;
/* 測る点:模式の建物・樹木は外接円(中心と半径)。PLATEAU の建物は足跡の多角形なので、頂点と辺の1mごとの点
   (半径0)で測る。点の (s,off) は検証側で求める:重心を線形へ射影し、その s の接線・法線で近似する */
const POLY = (o) => !!(o.poly && o.poly.length >= 3);
function pts(o) {
  if (!POLY(o)) return [{ s: o.s, off: o.off, x: o.x, z: o.z, r: o.r }];
  if (o.__pts) return o.__pts;
  const P = o.poly; let A = 0, cx = 0, cz = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length], w = a[0] * c[1] - c[0] * a[1]; A += w; cx += (a[0] + c[0]) * w; cz += (a[1] + c[1]) * w; }
  cx /= 3 * A; cz /= 3 * A;
  const pr = X.prjXY(cx, cz), f0 = X.frame(pr.s, 0), f1 = X.frame(pr.s + 1, 0), fn = X.frame(pr.s, 1);
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length], m = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1])));
    for (let k = 0; k < m; k++) {
      const x = a[0] + (c[0] - a[0]) * k / m, z = a[1] + (c[1] - a[1]) * k / m;
      out.push({ s: pr.s + (x - cx) * (f1.x - f0.x) + (z - cz) * (f1.z - f0.z), off: pr.off + (x - cx) * (fn.x - f0.x) + (z - cz) * (fn.z - f0.z), x: x, z: z, r: 0 });
    }
  }
  return (o.__pts = out);
}
// 多角形までの距離(内側なら負)。検証側の実装
function polyDist(P, x, z) {
  let inside = false, d = 1e18;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i];
    if (((a[1] > z) !== (b[1] > z)) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, u = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
    d = Math.min(d, Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u));
  }
  return inside ? -d : d;
}
/* 実データの道路(plateau_land.js)。検証側で独自に読む(モデルの登録簿ではなくファイルそのもの) */
const LAND = (() => {
  const fs = require('fs'), pth = require('path');
  const f = pth.join(pth.dirname(path), 'plateau_land.js');
  const html = fs.readFileSync(path, 'utf8');
  if (!html.includes('<script src="plateau_land.js">') || !fs.existsSync(f)) return null;
  const g = {}; new Function('globalThis', fs.readFileSync(f, 'utf8'))(g);
  const b = Buffer.from(g.PLATEAU_LAND.road64, 'base64');
  if (b.toString('latin1', 0, 4) !== 'PLR1') throw new Error('道路データの形式');
  const N = b.readUInt32LE(4), out = []; let o = 8;
  for (let n = 0; n < N; n++) {
    const k = b.readUInt8(o), sec = b.readUInt8(o + 1), nv = b.readUInt16LE(o + 2); o += 4;
    let x = b.readInt32LE(o), z = b.readInt32LE(o + 4); o += 8;
    const P = [[x / 10, z / 10]];
    for (let i = 1; i < nv; i++) { x += b.readInt16LE(o); z += b.readInt16LE(o + 2); o += 4; P.push([x / 10, z / 10]); }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const v of P) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[1]); z1 = Math.max(z1, v[1]); }
    out.push({ k: k, sec: sec, P: P, bb: [x0, x1, z0, z1] });
  }
  const C = 30, grid = new Map();
  for (const R of out) {
    if (R.k === 2 && R.sec === 2) continue;          // 高架の自動車道は地表の道路ではない
    for (let a = Math.floor(R.bb[0] / C); a <= Math.floor(R.bb[1] / C); a++)
      for (let c = Math.floor(R.bb[2] / C); c <= Math.floor(R.bb[3] / C); c++) {
        const kk = a + ',' + c; let l = grid.get(kk); if (!l) { l = []; grid.set(kk, l); } l.push(R);
      }
  }
  // 点の、最も深く入っている道路の面までの距離(内側なら負)
  const depth = (x, z) => {
    let d = 1e9;
    for (const R of grid.get(Math.floor(x / C) + ',' + Math.floor(z / C)) || [])
      if (x > R.bb[0] - 5 && x < R.bb[1] + 5 && z > R.bb[2] - 5 && z < R.bb[3] + 5) d = Math.min(d, polyDist(R.P, x, z));
    return d;
  };
  // 水面(河川・池):land64 の種別3
  const water = [];
  if (g.PLATEAU_LAND.land64) {
    const w = Buffer.from(g.PLATEAU_LAND.land64, 'base64');
    if (w.toString('latin1', 0, 4) !== 'PLU1') throw new Error('地表データの形式');
    const M = w.readUInt32LE(4); let q = 8;
    for (let n = 0; n < M; n++) {
      const k = w.readUInt8(q), nv = w.readUInt16LE(q + 2); q += 4;
      let x = w.readInt32LE(q), z = w.readInt32LE(q + 4); q += 8;
      const P = [[x / 10, z / 10]];
      for (let i = 1; i < nv; i++) { x += w.readInt16LE(q); z += w.readInt16LE(q + 2); q += 4; P.push([x / 10, z / 10]); }
      if (k === 3) water.push(P);
    }
  }
  return { roads: out, depth: depth, elev: out.filter((R) => R.k === 2 && R.sec === 2), water: water };
})();
const ALL = B.map((o) => ({ o: o, kind: '建物' })).concat(T.map((o) => ({ o: o, kind: '樹木' })));

/* ---- 1. 数 ---------------------------------------------------------------- */
ok('建物の数', B.length >= REF.MIN_BUILDINGS, '≥' + REF.MIN_BUILDINGS + '棟', B.length + '棟');
ok('樹木の数', T.length >= REF.MIN_TREES, '≥' + REF.MIN_TREES + '本', T.length + '本');

/* ---- 2. 高架下・側道に入らない ------------------------------------------- */
{
  let bad = null;
  for (const e of ALL) for (const q of pts(e.o)) {
    // 掘割(DECK_END より西)は側ごとの幅(仙川の北は単式ホームの分だけ広い)
    const lim = (q.s > X.DECK_END ? X.cutHalf(q.s, q.off < 0 ? -1 : 1) : X.deckHalf(q.s)) + REF.DECK_CLEAR;
    if (Math.abs(q.off) - q.r < lim && !bad)
      bad = [e.kind, 's=' + q.s.toFixed(0), 'off=' + q.off.toFixed(1), '限界' + lim.toFixed(1)];
  }
  ok('高架下・側道に入らない', bad === null, '桁半幅+' + REF.DECK_CLEAR + 'm以遠',
    bad ? bad.join(' ') : ALL.length + '件すべて');
}

/* ---- 3. 交差鉄道(井の頭線・世田谷線)の上に無い --------------------------
   線路は営業距離に対して斜めに走る(井の頭線は880mの延長でsが約160m動く)。
   sだけの帯では覆えないので、世界座標の線路の中心線(検証側で RAW から作った曲線 XC)からの距離で判定する。 */
{
  const lines = [['井の頭線', XC.INO, X.XR.U0, X.XR.U1], ['世田谷線', XC.SETA, X.XR.SETA_U0, X.XR.SETA_U1]];
  let bad = null, worst = 1e9;
  for (const [nm, A, u0, u1] of lines) {
    for (const e of ALL) for (const q of pts(e.o)) {
      const p = A.uv(q.x, q.z), du = p.u, dn = Math.abs(p.n);
      if (du < u0 - q.r || du > u1 + q.r) continue;      // 線路の延長の外
      let clear = dn - q.r, lim = nm === '世田谷線' && du > REF.SETA_TERM.u ? REF.SETA_TERM.hw : REF.XRAIL_HALF[nm];
      if (nm === '井の頭線') { if (dn > 25) continue; const sd = p.n < 0 ? 0 : 1; clear = dn - Math.abs(A.trackV(sd, du)) - q.r; lim = inoPlat(sd, du, 1.5) ? REF.INO_PLAT_CLEAR : REF.INO_CLEAR; }
      if (clear - lim < worst) worst = clear - lim;
      if (clear < lim && !bad)
        bad = [nm, e.kind, 'u=' + du.toFixed(0), '離隔' + clear.toFixed(1) + 'm'];
    }
  }
  ok('交差鉄道の上に無い', bad === null,
    '井の頭線は線路から ' + REF.INO_CLEAR + 'm(ホーム ' + REF.INO_PLAT_CLEAR.toFixed(2) + 'm)・世田谷線は中心から ' + REF.XRAIL_HALF['世田谷線'] + 'm(終端 ' + REF.SETA_TERM.hw + 'm)',
    bad ? bad.join(' ') : '余裕' + worst.toFixed(1) + 'm');
}

/* ---- 3b. 交差鉄道の脇の建物を消しすぎない(2026-10-27 利用者指示:線路の脇の建物が無くなっていた) -------------------
   plateau_bldg.js を検証側で読み、足跡(頂点と辺の 1m ごとの点)の線路からの距離で:
   ・世田谷線:中心線から REF.SETA_KEEP_MAX〜20m に掛かる建物(終端のホームの外・線路の範囲の中)
   ・井の頭線:その側の実際の線路の中心から REF.INO_KEEP_MAX〜20m に掛かる建物(ホームの範囲の外)
   のうち、街(CITY.buildings)に残っている割合が 90% 以上 */
{
  const fs = require('fs'), pth = require('path'), f = pth.join(pth.dirname(path), 'plateau_bldg.js');
  if (fs.readFileSync(path, 'utf8').includes('<script src="plateau_bldg.js">') && fs.existsSync(f)) {
    const gB = {}; new Function('globalThis', fs.readFileSync(f, 'utf8'))(gB);
    const pb = Buffer.from(gB.PLATEAU_BLDG.b64, 'base64'), N = pb.readUInt32LE(4);
    const kept = new Set(B.filter((e) => e.plateau && e.poly).map((e) => e.poly[0][0].toFixed(1) + ',' + e.poly[0][1].toFixed(1) + ',' + e.h.toFixed(1)));
    const R = { 世田谷線: { n: 0, k: 0, miss: null }, 井の頭線: { n: 0, k: 0, miss: null } };
    for (let n = 0, o = 8; n < N; n++) {
      const nv = pb.readUInt8(o), h = pb.readUInt16LE(o + 1) / 10; o += 4;
      let x = pb.readInt32LE(o), z = pb.readInt32LE(o + 4); o += 8; const P = [[x / 10, z / 10]];
      for (let i = 1; i < nv; i++) { x += pb.readInt16LE(o); z += pb.readInt16LE(o + 2); o += 4; P.push([x / 10, z / 10]); }
      if (P.length < 3 || !(h > 0)) continue;
      const kp = kept.has(P[0][0].toFixed(1) + ',' + P[0][1].toFixed(1) + ',' + h.toFixed(1));
      for (const nm of ['世田谷線', '井の頭線']) {
        const A = nm === '世田谷線' ? XC.SETA : XC.INO, lo = nm === '世田谷線' ? X.XR.SETA_U0 + 10 : X.XR.U0 + 10, hi = nm === '世田谷線' ? REF.SETA_TERM.u - 5 : X.XR.U1 - 10;
        let dmin = 1e9, uIn = false, plat = false;
        for (let i = 0; i < P.length && dmin > 0; i++) { const a = P[i], c = P[(i + 1) % P.length], m = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1])));
          for (let k = 0; k < m; k++) { const q = A.uv(a[0] + (c[0] - a[0]) * k / m, a[1] + (c[1] - a[1]) * k / m); if (Math.abs(q.n) > 30 || q.u <= lo || q.u >= hi) continue;
            uIn = true; let d = Math.abs(q.n);
            if (nm === '井の頭線') { const sd = q.n < 0 ? 0 : 1; d -= Math.abs(A.trackV(sd, q.u)); if (inoPlat(sd, q.u, 5)) plat = true; }
            dmin = Math.min(dmin, d); } }
        const lim = nm === '世田谷線' ? REF.SETA_KEEP_MAX : REF.INO_KEEP_MAX;
        if (!uIn || plat || dmin < lim || dmin > 20) continue;
        const r = R[nm]; r.n++; if (kp) r.k++; else if (!r.miss) r.miss = '(' + P[0][0].toFixed(0) + ',' + P[0][1].toFixed(0) + ') 線路から ' + dmin.toFixed(1) + 'm';
      }
    }
    for (const [nm, r] of Object.entries(R))
      ok(nm + 'の脇の建物が残る', r.n >= 50 && r.k >= 0.9 * r.n, (nm === '世田谷線' ? '中心線から ' + REF.SETA_KEEP_MAX : '線路の中心から ' + REF.INO_KEEP_MAX + '(ホームの外)') + '〜20m に掛かる実際の建物の 90% 以上',
        r.k + '/' + r.n + '棟' + (r.miss ? '(外した例 ' + r.miss + ')' : ''));
  }
}

/* ---- 4. 道路・河川の上に無い --------------------------------------------- */
{
  let bad = null;
  for (const c of REF.CROSS) {
    // 実データの道路があるときは、道路は「実際の道路の上に無い」で見る。ここは模式のまま描く物(計画の放射23・玉川上水)だけ
    if (LAND && !['放射23', '玉川上水'].includes(c[0])) continue;
    const cs = X[c[1]], hw = c[2], oh = c[3] === undefined ? 1e9 : c[3];
    for (const e of ALL) for (const q of pts(e.o)) {
      if (Math.abs(q.off) > oh) continue;
      if (Math.abs(q.s - cs) - q.r < hw && !bad)
        bad = [c[0], e.kind, 's=' + q.s.toFixed(0), 'off=' + q.off.toFixed(0)];
    }
  }
  ok('交差道路の上に無い', bad === null, LAND ? '放射23・玉川上水(他は実データ)' : REF.CROSS.length + '路線すべて',
    bad ? bad.join(' ') : ALL.length + '件すべて');

  let bp = null;
  for (const c of (LAND ? [] : REF.PARA)) {         // 実データがあるときは下の「実際の道路の上に無い」で見る
    for (const e of ALL) for (const q of pts(e.o)) {
      if (q.s < c[3] || q.s > c[4]) continue;
      if (Math.abs(q.off - c[1]) - q.r < c[2] && !bp)
        bp = [c[0], e.kind, 's=' + q.s.toFixed(0), 'off=' + q.off.toFixed(1)];
    }
  }
  ok('並行道路の上に無い', bp === null, LAND ? '実データの道路で見る' : REF.PARA.length + '路線すべて',
    bp ? bp.join(' ') : ALL.length + '件すべて');

  let br = null;
  for (const e of ALL) for (const p of pts(e.o)) {
    if (Math.abs(p.off) < REF.RIVER_OFF &&
      Math.abs(p.s - X.BRIDGE.s) - p.r < REF.RIVER_HALF && !br)
      br = ['仙川', e.kind, 's=' + p.s.toFixed(0)];
    for (const q of (B.some((e) => e.plateau) ? [] : REF.POND)) {   // 実データの建物があるときは模式の池を描かない
      if (Math.hypot(p.s - (X.WADA_S + q[0]), p.off - (X.WADA_OFF + q[1])) - p.r < q[2] && !br)
        br = ['和田堀の池', e.kind, 's=' + p.s.toFixed(0)];
    }
  }
  /* 実データの建物があるときは、模式の施設(和田堀給水所 430m×230m)で実際の街を消さない。
     模式の範囲にある実データの建物が消えずに残っていること(2026-10:模式の箱と占有域が203棟を隠していた) */
  if (B.some((e) => e.plateau)) {
    const nW = B.filter((e) => e.plateau && Math.abs(e.s - X.WADA_S) < 215 && Math.abs(e.off - X.WADA_OFF) < 115).length;
    ok('和田堀給水所の範囲の実データ', nW >= 100, '100棟以上が残る', nW + '棟');
  }
  ok('河川・池の上に無い', br === null, '仙川+池2面', br ? br.join(' ') : ALL.length + '件すべて');
}

/* ---- 4b. 実データの道路(plateau_land.js があるとき) ------------------------
   ・建物・樹木が道路の上に無い(建物は道路の縁に接して建つので 0.3m の食い込みまで)
   ・京王線を横切る道路(中心と桁の両端が道路の上に続く所)に高架の柱が立っていない
     (模式の道路の位置 RAW.roads・XINGS と実際がずれていても、実際の道路の上には立てない)
   ・自動車道の高架(首都高・中央道)の床版の下面が、京王線の上ではレール面+7.0m 以上。橋脚は高架下・側道に無い */
if (LAND) {
  let bad = null, worst = 1e9;
  for (const e of ALL) for (const q of pts(e.o)) {
    const side = !POLY(e.o) && e.o.kind === '桜';   // 歩道の並木:幹が道路の縁から SIDEWALK_IN 以内
    const d = LAND.depth(side ? e.o.x : q.x, side ? e.o.z : q.z), lim = POLY(e.o) ? -REF.ROAD_BLDG_IN : (side ? -REF.SIDEWALK_IN : q.r);
    if (d - lim < worst) worst = d - lim;
    if (d < lim && !bad) bad = [e.kind, '(' + q.x.toFixed(0) + ',' + q.z.toFixed(0) + ')', '道路の面まで' + d.toFixed(2) + 'm'];
  }
  ok('実際の道路の上に無い', bad === null, '建物は食い込み≤' + REF.ROAD_BLDG_IN + 'm・樹木は半径ぶん離れる(歩道の桜は幹が縁から' + REF.SIDEWALK_IN + 'm以内)',
    bad ? bad.join(' ') : ALL.length + '件すべて(余裕' + worst.toFixed(2) + 'm)');

  // 河川・池の水面の上に無い(建物も樹木も、水面に入らない)
  let bw = null;
  if (LAND.water.length) {
    const WB = LAND.water.map((P) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const v of P) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[1]); z1 = Math.max(z1, v[1]); } return { P: P, bb: [x0, x1, z0, z1] }; });
    for (const e of ALL) for (const q of pts(e.o)) {
      for (const W of WB) {
        if (q.x < W.bb[0] - 10 || q.x > W.bb[1] + 10 || q.z < W.bb[2] - 10 || q.z > W.bb[3] + 10) continue;
        const d = polyDist(W.P, q.x, q.z), lim = POLY(e.o) ? -REF.ROAD_BLDG_IN : q.r;
        if (d < lim && !bw) bw = [e.kind, '(' + q.x.toFixed(0) + ',' + q.z.toFixed(0) + ')', '水面まで' + d.toFixed(2) + 'm'];
      }
    }
  }
  ok('水面(河川・池)の上に無い', bw === null && LAND.water.length > 0, '水面' + '>0面・建物は食い込み≤' + REF.ROAD_BLDG_IN + 'm',
    bw ? bw.join(' ') : '水面' + LAND.water.length + '面・' + ALL.length + '件すべて');

  // 京王線を横切る道路を検証側で見つける
  const xing = []; let a = null;
  for (let s = Math.floor(X.DOM.x0); s <= X.DECK_END + 1; s++) {
    const dh = X.deckHalf(s);
    const on = [0, -dh, dh].every((o) => { const f = X.frame(s, o); return LAND.depth(f.x, f.z) < 0; });
    if (on) { if (a === null) a = s; } else if (a !== null) { if (s - a >= REF.XING_MIN) xing.push([a, s - 1]); a = null; }
  }
  let bc = null, nc = 0;
  for (const c of X.VIA_COLS) {
    if (!xing.some((r) => c.s > r[0] - 10 && c.s < r[1] + 10)) continue;
    for (const o of c.offs) {
      const f = X.frame(c.s, o), d = LAND.depth(f.x, f.z);
      nc++;
      if (d < REF.XING_COL_CLEAR && xing.some((r) => c.s > r[0] - REF.XING_COL_CLEAR && c.s < r[1] + REF.XING_COL_CLEAR) && !bc)
        bc = ['s=' + c.s.toFixed(0), 'off=' + o.toFixed(1), '道路の縁まで' + d.toFixed(2) + 'm'];
    }
  }
  ok('横切る道路に柱が無い', bc === null && xing.length >= 20, '横切る道路≥20か所・柱は縁から' + REF.XING_COL_CLEAR + 'm',
    bc ? bc.join(' ') : xing.length + 'か所・近くの柱' + nc + '本');

  // 自動車道の高架
  let be = null, ne = 0;
  for (let s = Math.floor(X.DOM.x0); s <= X.DECK_END; s += 2) {
    const dh = X.deckHalf(s);
    for (const o of [0, -dh, dh]) {
      const f = X.frame(s, o);
      if (!LAND.elev.some((R) => polyDist(R.P, f.x, f.z) < 0)) continue;
      ne++;
      // 描かれた床版(登録簿)のうち、この点の上にある物の下面
      let bot = 1e9;
      for (const D of X.EXPY.deck) if (polyDist(D.P, f.x, f.z) < 0) bot = Math.min(bot, D.bot);
      if (!(bot - X.railY(s) >= REF.EXPY_CLEAR) && !be)
        be = ['s=' + s, '下面' + (bot > 1e8 ? 'なし' : bot.toFixed(1)), 'レール面' + X.railY(s).toFixed(1)];
    }
  }
  for (const pr of X.EXPY.piers) {
    const q = X.prjXY(pr[0], pr[1]);
    if (q.s > X.DOM.x0 - 50 && q.s < X.DECK_END + 50 && Math.abs(q.off) < X.deckHalf(q.s) + REF.DECK_CLEAR + 1.0 && !be)
      be = ['橋脚が高架下・側道に', 's=' + q.s.toFixed(0), 'off=' + q.off.toFixed(1)];
  }
  ok('自動車道の高架が京王線と当たらない', be === null && X.EXPY.deck.length === LAND.elev.filter((R) => R.P.some((v) => { const q = X.prjXY(v[0], v[1]); return q.s > X.DOM.x0 - 150 && q.s < X.DOM.x1 + 150 && Math.abs(q.off) < X.DOM.z + 60; })).length,
    '下面≥レール面+' + REF.EXPY_CLEAR + 'm・橋脚は側道の外',
    be ? be.join(' ') : '床版' + X.EXPY.deck.length + '面・重なる点' + ne + '・橋脚' + X.EXPY.piers.length + '基');
}

/* ---- 4e. 仙川の掘割(利用者指示 2026-10-11)----------------------------------------
   ・地表(groundMesh)は掘割の上に穴があり、擁壁の外は覆う(擁壁の位置は登録簿 STRUCT '擁壁')
   ・地表に敷いた面(道路・緑地・駐車場・水面=userData.flat)の三角形が掘割の中に無い。ただし渡る道路橋の上
     (登録簿 '掘割を渡る床版' の s の範囲)は道路の面が続いてよい
   ・PLATEAU の道路の橋梁(検証側が plateau_land.js から読んだもの)が掘割の中心線の上にある所には、床版がある
   ・幹線の街灯が掘割の中に無い */
{
  const WL = X.STRUCT.filter((q) => q.tag === '擁壁'), DK = X.STRUCT.filter((q) => q.tag === '掘割を渡る床版' || q.tag === '橋上駅舎');
  const s0 = Math.min(...WL.map((q) => q.s0)), s1 = Math.max(...WL.map((q) => q.s1));
  const inner = (s, sg) => { const L = WL.filter((q) => q.s0 <= s + 1e-6 && q.s1 >= s - 1e-6 && sg * (q.o0 + q.o1) > 0);
    return L.length ? Math.max(...L.map((q) => sg > 0 ? q.o0 : -q.o1)) : null; };   // 内面(区間の中で最も外=控えめ)
  const outer = (s, sg) => { const L = WL.filter((q) => q.s0 <= s + 1e-6 && q.s1 >= s - 1e-6 && sg * (q.o0 + q.o1) > 0);
    return L.length ? Math.max(...L.map((q) => sg > 0 ? q.o1 : -q.o0)) : null; };
  const inCut = (s, o, m) => { if (s < s0 + 0.5 || s > s1 - 0.5) return false; const n = inner(s, 1), so = inner(s, -1);
    return n !== null && so !== null && o < n - m && o > -so + m; };
  const underDeck = (s) => DK.some((q) => s > q.s0 - 0.6 && s < q.s1 + 0.6);
  // 地表の三角形
  // 頂点の配列が無い形(箱など)は穴を測れない=NG
  const g = X.groundMesh.geometry, ga = g && g.attributes && g.attributes.position, gi = g && g.index;
  const P = ga && ga.array ? ga.array : [], I = gi && gi.array ? gi.array : [], T = [];
  for (let i = 0; i < I.length; i += 3) T.push([[P[I[i] * 3], P[I[i] * 3 + 2]], [P[I[i + 1] * 3], P[I[i + 1] * 3 + 2]], [P[I[i + 2] * 3], P[I[i + 2] * 3 + 2]]]);
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const covered = (x, z) => T.some((t) => { const p = [x, z], d1 = cr(t[0], t[1], p), d2 = cr(t[1], t[2], p), d3 = cr(t[2], t[0], p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); });
  let bG = null, nG = 0;
  for (let s = s0 + 3; s < s1 - 3; s += 10) {
    if (inner(s, 1) === null) continue; nG++;
    const c = X.frame(s, 0);
    if (covered(c.x, c.z) && !bG) bG = ['s=' + s.toFixed(0), '掘割の中に地表'];
    for (const sg of [-1, 1]) { const f = X.frame(s, sg * (outer(s, sg) + 2.0)); if (!covered(f.x, f.z) && !bG) bG = ['s=' + s.toFixed(0), (sg > 0 ? '北' : '南') + 'の擁壁の外に地表が無い']; }
  }
  ok('地表に掘割の穴', bG === null && nG > 30 && T.length > 0, '掘割の中は穴・擁壁の外 2m は地表', T.length === 0 ? '地表の頂点が測れない' : bG ? bG.join(' ') : nG + '断面');
  // 地表に敷いた面の三角形(掘割の外接矩形の中だけ射影する)
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const q of WL) for (const s of [q.s0, q.s1]) for (const o of [q.o0, q.o1]) { const f = X.frame(s, o); bx0 = Math.min(bx0, f.x); bx1 = Math.max(bx1, f.x); bz0 = Math.min(bz0, f.z); bz1 = Math.max(bz1, f.z); }
  let bF = null, nF = 0, nB = 0;
  X.scene.traverse((o) => {
    if (!o.isMesh || !o.userData || !o.userData.flat || o === X.groundMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const A = o.geometry.attributes.position.array, J = o.geometry.index ? o.geometry.index.array : null, n = J ? J.length : A.length / 3;
    for (let i = 0; i < n; i += 3) {
      const v = [0, 1, 2].map((k) => (J ? J[i + k] : i + k) * 3), x = (A[v[0]] + A[v[1]] + A[v[2]]) / 3, z = (A[v[0] + 2] + A[v[1] + 2] + A[v[2] + 2]) / 3;
      if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
      const q = X.prjXY(x, z);
      if (!inCut(q.s, q.off, 0.4)) continue;
      if (underDeck(q.s)) { nB++; continue; }
      nF++;
      if (!bF) bF = ['s=' + q.s.toFixed(1), 'off=' + q.off.toFixed(2), 'y=' + ((A[v[0] + 1] + A[v[1] + 1] + A[v[2] + 1]) / 3).toFixed(2)];
    }
  });
  ok('掘割の中に地表の面が無い', bF === null, '道路・緑地の面は擁壁の外(渡る道路橋の上を除く)', bF ? nF + '面 例 ' + bF.join(' ') : '0面(道路橋の上 ' + nB + '面)');
  // PLATEAU の道路の橋梁が掘割の中心線の上にある所には床版
  if (LAND) {
    let bD = null, nD = 0;
    const br = LAND.roads.filter((R) => R.sec === 2 && R.k !== 2);
    for (let s = s0 + 1; s < s1 - 1; s += 0.5) {
      const c = X.frame(s, 0);
      if (!br.some((R) => c.x > R.bb[0] && c.x < R.bb[1] && c.z > R.bb[2] && c.z < R.bb[3] && polyDist(R.P, c.x, c.z) < 0)) continue;
      nD++;
      if (!DK.some((q) => s >= q.s0 - 1e-6 && s <= q.s1 + 1e-6) && !bD) bD = 's=' + s.toFixed(1);
    }
    ok('道路橋の下に床版', bD === null && nD > 0, 'PLATEAU の橋梁が掘割を渡る所は床版がある', bD ? bD + ' に床版が無い' : '橋梁の上 ' + nD + '点');
  }
  // 幹線の街灯は掘割の中・擁壁の上に無い
  const bL = X.ROAD_LAMPS.find((L) => { const q = X.prjXY(L[0], L[1]); if (q.s < s0 || q.s > s1) return false;
    const n = outer(q.s, 1), so = outer(q.s, -1); return n !== null && so !== null && q.off < n + 0.3 && q.off > -so - 0.3; });
  ok('街灯が掘割の中に無い', !bL, '擁壁の外', bL ? '(' + bL[0].toFixed(0) + ',' + bL[1].toFixed(0) + ')' : X.ROAD_LAMPS.length + '基すべて');
}

let L2_ALL = null, P0_ALL = null;          // 4c で読んだ LOD2 の面(建物ごと)と足跡の1点目(4c1 の写真の検査が使う)
/* ---- 4c. LOD2(屋根の形) ----------------------------------------------------
   plateau_bldg.js の LOD2 の面を検証側で独自に読み、近くの形(足跡の押し出しの代わりに面そのもの)を実際に作らせて、
   ・データの面の点がすべて描かれた頂点にある(LOD2 の建物が平らな箱のままになっていない)
   ・描いた三角形の向き(巻き順の法線)が頂点の法線と同じ側(裏返った面が無い)。足跡の押し出しの建物も同じに見る */
{
  const fs = require('fs'), pth = require('path');
  const f = pth.join(pth.dirname(path), 'plateau_bldg.js');
  const html = fs.readFileSync(path, 'utf8');
  const g = {};
  if (html.includes('<script src="plateau_bldg.js">') && fs.existsSync(f)) new Function('globalThis', fs.readFileSync(f, 'utf8'))(g);
  const D = g.PLATEAU_BLDG;
  if (D && D.lod2b64) {
    // 足跡の1点目(LOD2 の点の基準)を PLT1 から
    const b = Buffer.from(D.b64, 'base64'); const N = b.readUInt32LE(4); let o = 8; const P0 = [];
    for (let n = 0; n < N; n++) { const nv = b.readUInt8(o), hh = b.readUInt16LE(o + 1) / 10; o += 4; P0.push([b.readInt32LE(o) / 10, b.readInt32LE(o + 4) / 10, hh]); o += 8 + 4 * (nv - 1); }
    const w = Buffer.from(D.lod2b64, 'base64'); const M = w.readUInt32LE(4); let q = 8; const L2 = [];
    for (let k = 0; k < M; k++) {
      const bi = w.readUInt32LE(q), ns = w.readUInt16LE(q + 4); q += 6; const V = [], SF = []; let roofs = 0;
      for (let j = 0; j < ns; j++) {
        const t = w.readUInt8(q), nv = w.readUInt8(q + 1); q += 2; if (t === 1) roofs++;
        const sv = [];
        for (let i = 0; i < nv; i++) { const v = [P0[bi][0] + w.readInt16LE(q) / 10, w.readUInt16LE(q + 4) / 10, P0[bi][1] + w.readInt16LE(q + 2) / 10]; V.push(v); sv.push(v); q += 6; }
        SF.push(sv);
      }
      L2.push({ p0: P0[bi], V: V, roofs: roofs, bi: bi, SF: SF });
    }
    L2_ALL = L2; P0_ALL = P0;
    // 描かれている(登録簿にある)LOD2 の建物:足跡の1点目で対応を取る。面の点の高さは基部(地形の上。登録簿の base)からなので、
    // 描いた頂点はデータの高さ+基部(基部そのものは 4f で地表と独立の地盤の高さに照合する)
    const key = (x, z) => x.toFixed(1) + ',' + z.toFixed(1);
    const drawn = new Set(B.filter((e) => e.poly).map((e) => key(e.poly[0][0], e.poly[0][1])));
    const baseOf = new Map(B.filter((e) => e.poly).map((e) => [key(e.poly[0][0], e.poly[0][1]) + ',' + e.h.toFixed(1), e.base || 0]));
    const want = L2.filter((e) => drawn.has(key(e.p0[0], e.p0[1])));
    // LOD2 の建物を含むまとまりの近くの形を作る
    const VS = new Set(); let tris = 0, flip = 0, made = 0;
    for (const C of X.CITY_LODS) {
      if (!C.B.some((e) => e.l2)) continue;
      if (!C.m[0]) C.m[0] = C.make(C);
      made++;
      for (const m of [C.m[0]].concat(C.mt || [])) {             // 色の形と写真の形(詰め合わせごと)
      const gg = m.geometry, Pa = gg.attributes.position.array, Na = gg.attributes.normal.array, Ia = gg.index.array;
      for (let i = 0; i < Pa.length; i += 3) VS.add(Pa[i].toFixed(1) + ',' + Pa[i + 1].toFixed(1) + ',' + Pa[i + 2].toFixed(1));
      for (let t = 0; t < Ia.length; t += 3) {
        const a = Ia[t] * 3, c = Ia[t + 1] * 3, d = Ia[t + 2] * 3;
        const ux = Pa[c] - Pa[a], uy = Pa[c + 1] - Pa[a + 1], uz = Pa[c + 2] - Pa[a + 2], vx = Pa[d] - Pa[a], vy = Pa[d + 1] - Pa[a + 1], vz = Pa[d + 2] - Pa[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.hypot(nx, ny, nz) < 1e-6) continue;
        tris++;
        if (nx * Na[a] + ny * Na[a + 1] + nz * Na[a + 2] < 0) flip++;
      }
      }
    }
    let miss = 0, tot = 0, ex = null;
    for (const e of want) { const b0 = baseOf.get(key(e.p0[0], e.p0[1]) + ',' + e.p0[2].toFixed(1)) || 0;
      for (const v of e.V) {
        tot++;
        if (!VS.has(v[0].toFixed(1) + ',' + Math.fround(v[1] + b0).toFixed(1) + ',' + v[2].toFixed(1))) { miss++; if (!ex) ex = '(' + [v[0], v[1] + b0, v[2]].map((u) => u.toFixed(1)).join(',') + ')'; }
      } }
    ok('LOD2 の面が描かれる', want.length >= 300 && miss === 0, '300棟以上・面の点がすべて頂点に',
      want.length + '棟(データ' + L2.length + ')・点' + tot + '・欠け' + miss + (ex ? ' 例' + ex : ''));
    ok('建物の面が裏返らない', tris > 0 && flip === 0, '巻き順の法線=頂点の法線の側',
      'まとまり' + made + '・三角形' + tris + '・裏返り' + flip);
  }
}

/* ---- 4c1. 写真テクスチャ(2026-10-25 利用者指示:駅の周りの LOD2 の建物に PLATEAU の写真を貼る) -------------
   plateau_tex.js を検証側で独自に読み(PTX1 の形式。モデルの登録簿ではなくファイルそのもの)、描かれている LOD2 の建物
   (足跡の1点目で対応)のうち写真のある面について:
   ・面の点が写真の形(詰め合わせごとの Mesh)の頂点に、データと同じ位置・同じ u,v で描かれている(面の番号と写真がずれない)
   ・写真の形の材質は写真(map)を sRGB として読み、窓の材質(夜の明かり)で写真の面の印が立つ(昼の暗いガラスは塗らない)。
     シェーダの元の文字列で、写真の面では暗いガラスの式を飛ばす
   ・写真のある建物の中・遠の箱の色(インスタンスの色)は、データの写真の平均色をリニアで REF_PTX_GAIN 倍した色(±1。近くの写真の材質と同じ倍率)
   ・写真の材質の色(リニアの倍率)も REF_PTX_GAIN
   ・数:写真の面のある建物 400 棟以上・面 8,000 以上が描かれる */
{
  const fs = require('fs'), pth = require('path');
  const f = pth.join(pth.dirname(path), 'plateau_tex.js');
  const html = fs.readFileSync(path, 'utf8');
  const g = {};
  if (html.includes('<script src="plateau_tex.js">') && fs.existsSync(f) && L2_ALL) new Function('globalThis', fs.readFileSync(f, 'utf8'))(g);
  const T = g.PLATEAU_TEX;
  const REF_PTX_GAIN = 3.4;                  // 写真の明るさの倍率(リニア)。写真の壁の平均 sRGB 87 → 用途の色の約半分(CLAUDE.md)
  const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)), l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const gainHex = (h) => [16, 8, 0].reduce((a, sh) => a | (Math.max(0, Math.min(255, Math.round(255 * l2s(Math.min(1, s2l(((h >> sh) & 255) / 255) * REF_PTX_GAIN))))) << sh), 0);
  if (T && T.uv64) {
    const w = Buffer.from(T.uv64, 'base64'); let o = 8; const TX = new Map();
    const byBi = new Map(L2_ALL.map((e) => [e.bi, e]));
    let bad = null;
    if (w.toString('latin1', 0, 4) !== 'PTX1') bad = '形式が PTX1 でない';
    const N = bad ? 0 : w.readUInt32LE(4);
    for (let k = 0; k < N && !bad; k++) {
      const bi = w.readUInt32LE(o), ns = w.readUInt16LE(o + 4), rgb = (w[o + 6] << 16) | (w[o + 7] << 8) | w[o + 8]; o += 9;
      const e = byBi.get(bi); if (!e || e.SF.length !== ns) { bad = '建物 ' + bi + ' の面の数が LOD2 と合わない'; break; }
      const S = [];
      for (let j = 0; j < ns; j++) {
        const a = w[o]; o++;
        if (a === 255) continue;
        const uv = [];
        // 描いた頂点は 32bit の浮動小数なので、同じ丸めで比べる(小数4桁の境で食い違わない)
        for (let i = 0; i < e.SF[j].length; i++) { uv.push([Math.fround(w.readUInt16LE(o) / 65535), Math.fround(w.readUInt16LE(o + 2) / 65535)]); o += 4; }
        S.push({ j: j, a: a, uv: uv });
      }
      TX.set(bi, { rgb: rgb, S: S, e: e });
    }
    if (!bad && o !== w.length) bad = 'データの長さが合わない';
    // 写真の形の頂点(位置 0.1m・u,v 1e-4)と材質
    const VT = new Set(); let nMesh = 0, mBad = null;
    for (const C of X.CITY_LODS) {
      if (!C.B.some((e) => e.l2)) continue;
      if (!C.m[0]) C.m[0] = C.make(C);
      for (const m of (C.mt || [])) {
        nMesh++;
        const ma = m.material, at = m.geometry.attributes;
        if (!(ma && ma.map && ma.map.encoding === 3001 && ma.userData && ma.userData.bldWin && ma.userData.bldWinPhoto && at.uv && at.aBld) && !mBad)
          mBad = '詰め合わせ ' + m.userData.ptx + ' の材質(写真の sRGB・窓の材質・写真の印・uv・aBld)';
        if (ma && ma.color && [ma.color.r, ma.color.g, ma.color.b].some((v) => Math.abs(v - REF_PTX_GAIN) > 1e-6) && !mBad)
          mBad = '詰め合わせ ' + m.userData.ptx + ' の材質の色(リニア)が ' + REF_PTX_GAIN + ' 倍でない';
        const Pa = at.position.array, Ua = at.uv ? at.uv.array : [];
        if (Ua.length !== Pa.length / 3 * 2) { if (!mBad) mBad = '詰め合わせ ' + m.userData.ptx + ' の u,v の数が頂点の数と合わない'; continue; }
        for (let i = 0; i < Pa.length / 3; i++)
          if (!(Number.isFinite(Ua[2 * i]) && Number.isFinite(Ua[2 * i + 1]))) { if (!mBad) mBad = '詰め合わせ ' + m.userData.ptx + ' の u,v が数でない(点 ' + i + ')'; break; }
          else VT.add(m.userData.ptx + '|' + Pa[3 * i].toFixed(1) + ',' + Pa[3 * i + 1].toFixed(1) + ',' + Pa[3 * i + 2].toFixed(1) + '|' + Ua[2 * i].toFixed(4) + ',' + Ua[2 * i + 1].toFixed(4));
      }
    }
    const shOK = /photo\?'':' diffuseColor\.rgb=mix/.test(X.BLD_WIN_SRC);
    // 描かれている LOD2 の建物で照合(足跡の1点目が同じ別の建物があるので、高さも合わせて対応を取る)
    const key = (x, z, h) => x.toFixed(1) + ',' + z.toFixed(1) + ',' + h.toFixed(1);
    const drawn = new Set(B.filter((e) => e.poly).map((e) => key(e.poly[0][0], e.poly[0][1], e.h)));
    const baseOf = new Map(B.filter((e) => e.poly).map((e) => [key(e.poly[0][0], e.poly[0][1], e.h), e.base || 0]));   // 基部(地形の上)
    let nB = 0, nS = 0, miss = 0, ex = null;
    for (const [bi, t] of TX) {
      if (!drawn.has(key(t.e.p0[0], t.e.p0[1], t.e.p0[2])) || !t.S.length) continue;
      nB++;
      const b0 = baseOf.get(key(t.e.p0[0], t.e.p0[1], t.e.p0[2])) || 0;
      for (const s of t.S) {
        nS++;
        const V = t.e.SF[s.j];
        for (let i = 0; i < V.length; i++) {
          const k = s.a + '|' + V[i][0].toFixed(1) + ',' + Math.fround(V[i][1] + b0).toFixed(1) + ',' + V[i][2].toFixed(1) + '|' + s.uv[i][0].toFixed(4) + ',' + s.uv[i][1].toFixed(4);
          if (!VT.has(k)) { miss++; if (!ex) ex = '建物 ' + bi + ' 面 ' + s.j + ' 点 ' + i + ' (' + k + ')'; break; }
        }
      }
    }
    // 中・遠の箱の色=写真の平均色(足跡の1点目と高さで対応)
    const rgbOf = new Map();
    for (const [bi, t] of TX) rgbOf.set(key(t.e.p0[0], t.e.p0[1], t.e.p0[2]), gainHex(t.rgb));
    let nC = 0, cBad = null;
    for (const C of X.CITY_LODS) {
      const im = C.m[1]; if (!im || !im.cols) continue;
      C.B.forEach((e, j) => {
        const want = e.l2 ? rgbOf.get(key(e.P[0][0], e.P[0][1], e.h)) : undefined;
        if (want === undefined || !TX.size) return;
        const got = im.cols[j]; nC++;
        const d = [16, 8, 0].map((sh) => Math.abs(((got >> sh) & 255) - ((want >> sh) & 255)));
        if (Math.max(...d) > 1 && !cBad) cBad = '(' + e.ox.toFixed(0) + ',' + e.oz.toFixed(0) + ') 箱の色 #' + (got >>> 0).toString(16) + ' ≠ 写真の平均色 #' + want.toString(16);
      });
    }
    ok('写真テクスチャ(LOD2 の面)', !bad && !mBad && shOK && miss === 0 && nB >= 400 && nS >= 8000 && !cBad && nC > 0,
      '面の点が写真の形に同じ u,v で・sRGB・窓の材質・昼のガラスを塗らない・箱の色=写真の平均色・400棟/8,000面以上',
      bad || mBad || cBad || (shOK ? '' : 'シェーダに写真の分岐が無い ') + (ex ? '欠け ' + miss + ' 例 ' + ex :
        nB + '棟・' + nS + '面・写真の形 ' + nMesh + '(詰め合わせ ' + (T.atlases || []).length + '枚)・箱の色 ' + nC + '棟'));
  }
}

/* ---- 4c2. 建物の窓と三角屋根(2026-10-12 利用者指示) -------------------------------------
   ・窓は壁の面にシェーダで描く:建物の全ての形(近く=頂点の aBld、中・遠の箱=インスタンスの iBld)が窓の材質(bldWin)で描かれる
   ・窓は壁の上端より上に出ない:近くの形の壁の三角形で、窓の上端の基準(aBld の2番目)がその三角形の最も高い点を超えない
     (以前は夜だけ外接矩形の殻に窓を貼っていたので、L字や三角屋根の建物では壁の無い所・軒より上に窓が光っていた)
   ・三角屋根(傾いた屋根面)は灰色:上向きで傾いた面(法線の上成分 0.3〜0.97)の色の彩度が低く暗い。戸建ての切妻屋根が十分ある */
{
  let bM = null, nM = 0, bT = null, nW = 0, nR = 0, bR = null; const WG = new Map();
  for (const C of X.CITY_LODS) {
    for (const m of [C.m[1], C.m[2]]) {
      if (!m) continue; nM++;
      if (!(m.material && m.material.userData && m.material.userData.bldWin) || !m.geometry.attributes.iBld) { if (!bM) bM = '箱のインスタンス'; }
    }
    if (!C.m[0]) C.m[0] = C.make(C);
    for (const m of [C.m[0]].concat(C.mt || [])) {               // 写真の形(詰め合わせごと)にも窓の材質(夜の明かり)
    nM++;
    const g = m.geometry, Pa = g.attributes.position.array, Na = g.attributes.normal.array, Ca = g.attributes.color ? g.attributes.color.array : null, A = g.attributes.aBld, Ia = g.index.array;
    if (!(m.material && m.material.userData && m.material.userData.bldWin) || !A || A.array.length / 4 !== Pa.length / 3) { if (!bM) bM = m.userData.ptx !== undefined ? '写真の形' : '近くの形'; continue; }
    for (let t = 0; t < Ia.length; t += 3) {
      const v = [Ia[t], Ia[t + 1], Ia[t + 2]], ny = Na[v[0] * 3 + 1];
      if (Math.abs(ny) < 0.5) {                       // 壁:同じ面(種・向き・上端の基準が同じ三角形)ごとに最も高い点を集める
        nW++;
        const top = A.array[v[0] * 4 + 1], my = Math.max(...v.map((k) => Pa[k * 3 + 1]));     // aBld=(種類,上端,種,基部)
        const kk = A.array[v[0] * 4 + 2] + '|' + top.toFixed(3) + '|' + Na[v[0] * 3].toFixed(2) + ',' + Na[v[0] * 3 + 2].toFixed(2);
        const q = WG.get(kk); if (!q || q.my < my) WG.set(kk, { my: my, top: top, x: Pa[v[0] * 3], z: Pa[v[0] * 3 + 2] });
      } else if (Ca && ny > 0.3 && ny < 0.97) {       // 傾いた屋根面(写真の屋根は写真の色)
        nR++;
        const c = [0, 1, 2].map((k) => Ca[v[0] * 3 + k]), mx = Math.max(...c), mn = Math.min(...c), lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        if ((mx - mn > 0.25 * mx || lum > 0.25) && !bR) bR = 'rgb(' + c.map((u) => u.toFixed(2)).join(',') + ')';
      }
    }
    }
  }
  for (const q of WG.values()) if (q.top > q.my + 0.001 && !bT) bT = '(' + q.x.toFixed(0) + ',' + q.z.toFixed(0) + ') 窓の上端の基準 ' + q.top.toFixed(2) + ' > 壁 ' + q.my.toFixed(2);
  ok('建物の窓(壁の面に)', bM === null && nM > 0, '近く・中・遠の全ての形が窓の材質', bM ? bM + 'に窓が無い' : nM + '形');
  ok('窓は壁の上端より上に出ない', bT === null && nW > 0, '壁の面の最も高い点以下', bT || '壁の三角形 ' + nW + '・面 ' + WG.size);
  const nG = B.filter((e) => e.roof === '切妻').length;
  /* 窓の数(2026-10-12 利用者指示:多すぎる・北向きの壁は少なく)。シェーダと同じ式 bldWinAt を壁の上で数える。
     検証側の決まり:戸建ての南向きの壁で窓は 10% 以下、北向きは南向きの半分以下。共同住宅・業務も北は南より少ない。
     シェーダが向きで間引いていること(文字列に北の成分の式)も見る */
  if (X.bldWinAt) {
    const dens = (t, nx, nz, top) => { let a = 0, n = 0; for (let u = 0; u < 400; u += 0.1) for (let y = 0.05; y < top; y += 0.1) { n++; if (X.bldWinAt(t, u, y, top, nx, nz)) a++; } return a / n; };
    const D = [0, 1, 2].map((t) => ({ s: dens(t, 0, 1, 9), n: dens(t, 0, -1, 9), e: dens(t, 1, 0, 9) }));
    const shOK = /clamp\(-normalize\(vBN\.xz\)\.y/.test(X.BLD_WIN_SRC) && /hc>=pd/.test(X.BLD_WIN_SRC);
    ok('窓は少なめ・北向きはさらに少ない', D[0].s <= 0.10 && D[0].n <= 0.5 * D[0].s && D[1].n < D[1].s && D[2].n < D[2].s && D[0].s > 0.03 && shOK,
      '戸建ての南 ≤10%・北 ≤ 南の半分・共同住宅と業務も 北<南・シェーダが向きで間引く',
      D.map((d, i) => ['戸建て', '共同住宅', '業務'][i] + ' 南' + (d.s * 100).toFixed(1) + '% 北' + (d.n * 100).toFixed(1) + '% 東' + (d.e * 100).toFixed(1) + '%').join(' / ') + (shOK ? '' : ' シェーダに向きの式が無い'));
  }
  ok('三角屋根は灰色', bR === null && nR > 0 && (B.some((e) => e.plateau) ? nG >= 1000 : true), '傾いた屋根面は暗い灰・切妻屋根 1000棟以上', bR || '屋根面 ' + nR + '・切妻 ' + nG + '棟');
}

/* ---- 4c3. 木の形(2026-10-12 利用者指示:単純すぎて浮いている) ------------------------------------
   まとまりごとに近く・遠くの2つの形。近くは樹冠の塊が3つ以上(三角形が遠くの2倍以上)、季節の色(インスタンスの色)は樹冠だけ
   (幹 aTint=0 は暗い茶のまま)、樹冠は占有半径(sc=1 で 2.3m)の内 */
{
  let bad = null, n = 0;
  const TC = X.CITY.treeChunks;
  for (const c of TC.values()) {
    n++;
    if (!c.m || !c.mn) { bad = '近く/遠くの形が無い'; break; }
    const gN = c.mn.geometry, gF = c.m.geometry, tN = gN.index.array.length / 3, tF = gF.index.array.length / 3;
    if (!gN.attributes.aTint || !gF.attributes.aTint) { bad = '樹冠の印(aTint)が無い'; break; }
    if (!(tF > 0) || tN < 2 * tF) { bad = '近くの形が粗い ' + tN + '/' + tF; break; }
    const P = gN.attributes.position.array, T = gN.attributes.aTint.array, C = gN.attributes.color.array;
    let rx = 0, trunk = null;
    for (let i = 0; i < T.length; i++) {
      if (T[i] > 0.5) rx = Math.max(rx, Math.hypot(P[i * 3], P[i * 3 + 2]));
      else if (C[i * 3] > 0.3 || C[i * 3] < C[i * 3 + 2]) trunk = 'rgb(' + C[i * 3].toFixed(2) + ',' + C[i * 3 + 1].toFixed(2) + ',' + C[i * 3 + 2].toFixed(2) + ')';
    }
    if (rx > 2.3 + 1e-6) { bad = '樹冠の半径 ' + rx.toFixed(2) + 'm > 2.3'; break; }
    if (trunk) { bad = '幹の色 ' + trunk; break; }
  }
  ok('木の形(近く・遠く・樹冠)', bad === null && n > 0, '近くは遠くの2倍以上・樹冠は半径2.3m 内・幹は茶', bad || n + 'まとまり');
}

/* ---- 4d. 建物の色は用途で ------------------------------------------------------
   plateau_bldg.js の用途(use64)を検証側で読み、登録簿の建物(足跡の1点目で対応)の用途がデータと一致し、
   住宅・業務・工場倉庫の色の組が互いに重ならない(用途で塗り分けている)ことを見る */
{
  const fs = require('fs'), pth = require('path');
  const f = pth.join(pth.dirname(path), 'plateau_bldg.js');
  const g = {};
  if (fs.readFileSync(path, 'utf8').includes('<script src="plateau_bldg.js">') && fs.existsSync(f)) new Function('globalThis', fs.readFileSync(f, 'utf8'))(g);
  const D = g.PLATEAU_BLDG;
  if (D && D.use64) {
    const b = Buffer.from(D.b64, 'base64'), u = Buffer.from(D.use64, 'base64'); const N = b.readUInt32LE(4); let o = 8; const use = new Map();
    // 足跡の1点目と高さで対応を取る(1点目が同じ別の建物がある)
    for (let n = 0; n < N; n++) { const nv = b.readUInt8(o), h = b.readUInt16LE(o + 1) / 10; o += 4; const kk = (b.readInt32LE(o) / 10).toFixed(1) + ',' + (b.readInt32LE(o + 4) / 10).toFixed(1) + ',' + h.toFixed(1); if (!use.has(kk)) use.set(kk, new Set()); use.get(kk).add(u[n]); o += 8 + 4 * (nv - 1); }
    let mis = 0, n = 0, ex = null; const cols = new Map();
    for (const e of B) {
      if (!e.poly) continue;
      const k = e.poly[0][0].toFixed(1) + ',' + e.poly[0][1].toFixed(1) + ',' + e.h.toFixed(1), want = use.get(k);
      if (want === undefined) continue;
      n++;
      if (!want.has(e.use)) { mis++; if (!ex) ex = k + ' 用途' + e.use + '≠' + [...want].join('/'); }
      let s = cols.get(e.use); if (!s) { s = new Set(); cols.set(e.use, s); } s.add(e.hex);
    }
    const grp = REF.USE_GROUPS.map((G) => { const s = new Set(); for (const k of G) for (const h of (cols.get(k) || [])) s.add(h); return s; });
    let ov = null;
    for (let i = 0; i < grp.length; i++) for (let j = i + 1; j < grp.length; j++) for (const h of grp[i]) if (grp[j].has(h) && !ov) ov = '組' + i + 'と組' + j + 'に同じ色 ' + h;
    ok('建物の色は用途で', mis === 0 && ov === null && grp.every((s) => s.size > 0), '用途がデータと一致・住宅/業務/工場倉庫の色が別',
      ex || ov || n + '棟・色の組 ' + grp.map((s) => s.size).join('/'));
  }
}

/* ---- 5. 建物・樹木どうしが重ならない ------------------------------------- */
{
  const CELL = 26, grid = new Map();
  const key = (a, b) => a + ',' + b;
  let bad = null, worst = 1e9, pairs = 0;
  /* PLATEAU の建物(実データ)どうしは実際に壁を接して建つので見ない。樹木など円の物とは、
     円の中心から足跡の多角形までの距離で見る(足跡の外接矩形が掛かる格子に入れて引く) */
  const pg = new Map();
  for (const e of ALL) if (POLY(e.o)) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const v of e.o.poly) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[1]); z1 = Math.max(z1, v[1]); }
    for (let a = Math.floor((x0 - 8) / CELL); a <= Math.floor((x1 + 8) / CELL); a++)
      for (let b = Math.floor((z0 - 8) / CELL); b <= Math.floor((z1 + 8) / CELL); b++) {
        let l = pg.get(key(a, b)); if (!l) { l = []; pg.set(key(a, b), l); } l.push(e);
      }
  }
  for (const e of ALL) {
    if (POLY(e.o)) continue;
    for (const q of (pg.get(key(Math.floor(e.o.x / CELL), Math.floor(e.o.z / CELL))) || [])) {
      const gap = polyDist(q.o.poly, e.o.x, e.o.z) - e.o.r;
      pairs++;
      if (gap < worst) worst = gap;
      if (gap < REF.GAP && !bad) bad = [e.kind + '⇄' + q.kind + '(PLATEAU)', 'すき間' + gap.toFixed(2) + 'm', '(' + e.o.x.toFixed(0) + ',' + e.o.z.toFixed(0) + ')'];
    }
  }
  for (const e of ALL) {
    if (POLY(e.o)) continue;
    const cx = Math.floor(e.o.x / CELL), cz = Math.floor(e.o.z / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = grid.get(key(cx + a, cz + b)); if (!l) continue;
      for (const q of l) {
        const gap = Math.hypot(e.o.x - q.o.x, e.o.z - q.o.z) - e.o.r - q.o.r;
        pairs++;
        if (gap < worst) worst = gap;
        if (gap < REF.GAP && !bad) bad = [e.kind + '⇄' + q.kind, 'すき間' + gap.toFixed(2) + 'm'];
      }
    }
    let l = grid.get(key(cx, cz)); if (!l) { l = []; grid.set(key(cx, cz), l); }
    l.push(e);
  }
  ok('建物・樹木が重ならない', bad === null, 'すき間≥' + REF.GAP + 'm',
    bad ? bad.join(' ') : '最小すき間' + worst.toFixed(2) + 'm(' + pairs + '組)');
}

/* ---- 6. 交差鉄道の列車と線路 ---------------------------------------------
   線路の位置は RAW.rail の tr(国土地理院のベクトルタイルの軌道の中心線)。検証側の曲線 XC で測る:
   ・敷いたレール(MAT.rail・MAT.railRust の頂点のうち交差鉄道の範囲で低い物)が、最も近い線路の中心線から (軌間+頭部の幅)/2 の所にある
   ・描いた車両の台車の中心(車輪の頂点を車両ごと・台車ごとに平均)が線路の中心線の上にある
   ・左側通行(もう一方の線路が進行方向の右)。世田谷線は渡り線の範囲(REF.SETA_XO_ZONE)より南で(終端の側は折り返すので上下とも使う)
   ・車輪の左右の間隔=軌間、車輪の下端=レール頭頂面、描いた頂点が線路の範囲の上、明大前・下高井戸に停車 */
{
  const railTop = X.XR.RAILY + X.XR.RAILH / 2;    // レール頭頂面(検証側で計算)
  X.stepXRail(3.0);                                // 実際に走らせてから測る
  const inoG = X.inoTrains.map((t) => t.g), setaG = X.setaTrain.g, allG = inoG.concat([setaG]);
  const kind = { 井の頭線: { A: XC.INO, gauge: X.GAUGE_INO, u0: X.XR.U0, u1: X.XR.U1 }, 世田谷線: { A: XC.SETA, gauge: X.GAUGE_SETA, u0: X.XR.SETA_U0, u1: X.XR.SETA_U1 } };
  // 描いている(drawRange の)頂点の世界座標
  const drawn = (o) => { const out = []; if (!o.geometry || !o.geometry.index) return out;
    const P = o.geometry.attributes.position.array, I = o.geometry.index.array, r = o.geometry.drawRange, e = Math.min(I.length, r.start + r.count), seen = new Set();
    for (let i = r.start; i < e; i++) { const k = I[i]; if (seen.has(k)) continue; seen.add(k); out.push([P[3 * k], P[3 * k + 1], P[3 * k + 2]]); }
    return out; };
  const wheels = (g) => { let w = []; if (!g.visible) return w; g.traverse((o) => { if (o.material === X.XM_WHL) w = w.concat(drawn(o)); }); return w; };
  // 車輪の頂点を、中心線に沿う u で 0.6m より大きい切れ目ごとの塊(=車軸)に分け、4軸ずつ車両に。車両の台車=前2軸・後2軸の頂点の平均
  const cars = (g, A) => { const w = wheels(g).map((p) => ({ p: p, u: A.uv(p[0], p[2]).u })).sort((a, b) => a.u - b.u);
    const ax = []; let last = -1e9; for (const q of w) { if (q.u - last > 0.6) ax.push([]); ax[ax.length - 1].push(q.p); last = q.u; }
    const avg = (L) => { const c = [0, 0, 0]; for (const p of L) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map((v) => v / L.length); };
    const out = []; for (let i = 0; i + 3 < ax.length; i += 4) out.push({ b: [avg(ax[i].concat(ax[i + 1])), avg(ax[i + 2].concat(ax[i + 3]))], ax: ax.slice(i, i + 4), w: [].concat(...ax.slice(i, i + 4)) });
    return { cars: out, axles: ax.length, w: w }; };
  // 車両数(明大前に停まって全車が線路の上にいる間に数える)と、交差鉄道は専用モデル
  {
    const keio = new Set();
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (o.attributes) { keio.add(o); return; } for (const k in o) walk(o[k]); };
    walk(X.K8GEO);
    let bad = null;
    for (const c of allG) {
      if (!c.userData || !c.userData.xcar) { bad = bad || ['専用モデルでない']; continue; }
      c.traverse((o) => { if (o.geometry && keio.has(o.geometry) && !bad) bad = ['8000系のジオメトリを共有']; });
    }
    ok('交差鉄道は専用モデル', bad === null, '8000系と別', bad ? bad[0] : '井の頭線/世田谷線とも専用');
  }
  // 敷いたレール:交差鉄道の範囲(中心線から 8m 以内・高さ 0〜1.2m・u が線路の範囲)の頂点は、最も近い線路の中心線から (軌間+頭部の幅)/2±許容
  {
    const res = [];
    for (const [nm, K] of Object.entries(kind)) {
      const want = (K.gauge + X.RAIL_W) / 2; let n = 0, bad = null, worst = 0;
      X.scene.traverse((o) => {
        if (!o.isMesh || (o.material !== X.MAT.rail && o.material !== X.MAT.railRust) || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        const P = o.geometry.attributes.position.array;
        if (o.parent !== X.scene && !(o.parent && o.parent.parent === X.scene && o.parent.position.x === 0 && o.parent.position.z === 0 && o.parent.rotation.y === 0)) return;
        for (let i = 0; i < P.length; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2]; if (y < 0 || y > 1.2) continue;
          const p = K.A.uv(x, z); if (Math.abs(p.n) > 8 || p.u < K.u0 + 1 || p.u > K.u1 - 1) continue;
          if (nm === '世田谷線' && p.u > REF.SETA_XO_ZONE[0] && p.u < REF.SETA_XO_ZONE[1]) continue;
          const d = Math.min(K.A.dTrack(0, x, z), K.A.dTrack(1, x, z)), e = Math.abs(d - want); n++;
          if (e > worst) worst = e; if (e > REF.XR_RAIL_TOL && !bad) bad = ['u=' + p.u.toFixed(1), '線路の中心から ' + d.toFixed(3) + 'm'];
        }
      });
      res.push([nm, n, bad, worst]);
    }
    ok('交差鉄道のレールが実際の線路の位置', res.every((r) => r[1] > 1000 && !r[2]), '中心線から(軌間+頭部)/2±' + REF.XR_RAIL_TOL + 'm',
      res.map((r) => r[0] + (r[2] ? ' ' + r[2].join(' ') : (r[1] > 1000 ? ' 最大差' + r[3].toFixed(3) + 'm(' + r[1] + '点)' : ' 頂点' + r[1]))).join('・'));
  }
  /* 走らせて測る:各コマ、描いた車両ごとに台車の中心が線路の上か・左側通行か・車輪の下端・左右の間隔・描いた頂点の範囲。
     停車中(台車が動かない)は、井の頭線=その側のホーム(緯度の実測・110m)に収まる、世田谷線=北の端が終端の近く */
  {
    const plat = REF.INO_PLAT.map((q) => { const u0 = XC.INO.uAtZ(-(q.lat - X.LAT0) * X.MLAT); return { n: q.n, side: q.side, u0: u0, u1: u0 + REF.INO_PLAT_LEN }; });
    const st = { 井の頭線: { badT: null, badL: null, badY: null, badG: null, badOut: null, badStop: null, nObs: 0, dirs: new Set(), worst: 0, gw: 0, nCars: 0 },
                 世田谷線: { badT: null, badL: null, badY: null, badG: null, badOut: null, badStop: null, nObs: 0, dirs: new Set(), worst: 0, gw: 0, nCars: 0, xo: 0 } };
    const items = inoG.map((g) => ['井の頭線', g]).concat([['世田谷線', setaG]]);
    const prev = items.map(() => null), stopT = items.map(() => 0), maxStop = items.map(() => 0);
    for (let k = 0; k < REF.SIM[1]; k++) {
      X.stepXRail(REF.SIM[0]);
      items.forEach(([nm, g], i) => {
        const K = kind[nm], S = st[nm], C = cars(g, K.A);
        if (!C.cars.length) { prev[i] = null; stopT[i] = 0; return; }
        if (C.axles % 4 && !S.badG) S.badG = ['車軸 ' + C.axles];
        S.nCars = Math.max(S.nCars, C.cars.length);
        // 描いた頂点の u の範囲
        let lo = 1e9, hi = -1e9; g.traverse((o) => { if (!o.isMesh) return; for (const p of drawn(o)) { const u = K.A.uv(p[0], p[2]).u; lo = Math.min(lo, u); hi = Math.max(hi, u); } });
        if ((lo < K.u0 - 1e-3 || hi > K.u1 + 1e-3) && !S.badOut) S.badOut = [lo.toFixed(1) + '〜' + hi.toFixed(1)];
        // 列車の中心(全台車の平均)と進行方向
        const all = [].concat(...C.cars.map((c) => c.b)), cx = all.reduce((a, p) => a + p[0], 0) / all.length, cz = all.reduce((a, p) => a + p[2], 0) / all.length;
        const pv = prev[i]; prev[i] = { x: cx, z: cz, n: C.cars.length };
        const mv = pv && pv.n === C.cars.length ? Math.hypot(cx - pv.x, cz - pv.z) : -1;
        for (const c of C.cars) {
          for (const b of c.b) {
            const pu = K.A.uv(b[0], b[2]).u, inXO = nm === '世田谷線' && pu > REF.SETA_XO_ZONE[0] && pu < REF.SETA_XO_ZONE[1];
            const d0 = K.A.dTrack(0, b[0], b[2]), d1 = K.A.dTrack(1, b[0], b[2]), d = Math.min(d0, d1);
            if (inXO) { if (d0 > REF.XR_ON_TRACK && d1 > REF.XR_ON_TRACK) S.xo++; continue; }
            S.worst = Math.max(S.worst, d);
            if (d > REF.XR_ON_TRACK && !S.badT) S.badT = ['u=' + pu.toFixed(1), '線路から ' + d.toFixed(3) + 'm'];
            const term = nm === '世田谷線' && pu >= REF.SETA_XO_ZONE[0];   // 世田谷線の終端の側(渡り線より北)はどちらの線も上下に使う
            if (mv > 1e-4 && mv < 50 && !term) {               // 走っている:もう一方の線路が進行方向の右(上×進行方向=(dz,-dx) が左)
              const dx = (cx - pv.x) / mv, dz = (cz - pv.z) / mv, other = d0 < d1 ? 1 : 0;
              // もう一方の線路の最も近い点の向き:その線路までの距離が、左へ 1m ずらした点で増える=右にある
              const lx = b[0] + dz, lz = b[2] - dx, dl = K.A.dTrack(other, lx, lz), dc = K.A.dTrack(other, b[0], b[2]);
              if (!(dl > dc) && !S.badL) S.badL = ['u=' + pu.toFixed(1), '進行方向の右を走る'];
            }
          }
          // 車輪:下端=レール頭頂面、左右の間隔(車両の横の向きに、台車の中心からの距離の平均)=(軌間+頭部の幅)/2
          let ymin = 1e9; for (const p of c.w) ymin = Math.min(ymin, p[1]);
          if (Math.abs(ymin - railTop) > 1e-4 && !S.badY) S.badY = [ymin.toFixed(4)];
          const hx = c.b[1][0] - c.b[0][0], hz = c.b[1][2] - c.b[0][2], hl = Math.hypot(hx, hz);
          for (let j = 0; j < 2; j++) { const L = c.ax[2 * j].concat(c.ax[2 * j + 1]), b = c.b[j];
            const m = L.reduce((a, p) => a + Math.abs(((p[0] - b[0]) * (-hz) + (p[2] - b[2]) * hx) / hl), 0) / L.length, want = (K.gauge + X.RAIL_W) / 2;
            S.gw = Math.max(S.gw, Math.abs(m - want)); if (Math.abs(m - want) > 1e-3 && !S.badG) S.badG = ['左右 ' + m.toFixed(4)]; }
        }
        if (mv > 1e-4 && mv < 50) {
          S.nObs++; const pu0 = K.A.uv(pv.x, pv.z).u, pu1 = K.A.uv(cx, cz).u; S.dirs.add(Math.sign(pu1 - pu0)); stopT[i] = 0;
        } else if (mv >= 0 && mv <= 1e-4) {
          stopT[i] += REF.SIM[0]; maxStop[i] = Math.max(maxStop[i], stopT[i]);
          if (nm === '井の頭線') {
            const side = K.A.dTrack(1, cx, cz) < K.A.dTrack(0, cx, cz) ? 1 : -1, pl = plat.find((q) => q.side === side);
            if ((lo < pl.u0 - 1e-3 || hi > pl.u1 + 1e-3) && !S.badStop) S.badStop = [pl.n + ' ' + pl.u0.toFixed(1) + '〜' + pl.u1.toFixed(1) + ' に ' + lo.toFixed(1) + '〜' + hi.toFixed(1)];
          } else if ((hi > 0.001 || hi < -REF.SETA_END) && !S.badStop) S.badStop = ['北の端 u=' + hi.toFixed(1)];
        }
      });
    }
    const I = st['井の頭線'], Z = st['世田谷線'];
    ok('井の頭線の車両数', I.nCars === REF.INO_CARS && !I.badG, REF.INO_CARS + '両(4軸ずつ)', I.nCars + '両' + (I.badG ? ' ' + I.badG.join(' ') : ''));
    ok('世田谷線の車両数', Z.nCars === X.SETA_CARS, X.SETA_CARS + '両', Z.nCars + '両');
    for (const [nm, S] of [['井の頭線', I], ['世田谷線', Z]]) {
      ok(nm + 'の台車が線路の上', S.badT === null && S.nObs > 50, '線路の中心線から ' + REF.XR_ON_TRACK + 'm 以内', S.badT ? S.badT.join(' ') : '最大 ' + S.worst.toFixed(3) + 'm(' + S.nObs + 'コマ)');
      ok(nm + 'は左側通行', S.badL === null && S.dirs.size === 2, '上下とも進行方向の左の線', S.badL ? S.badL.join(' ') : (S.dirs.size === 2 ? '上下とも左' : '片方向のみ'));
      ok(nm + 'の車輪', S.badY === null && S.badG === null, '下端=' + railTop.toFixed(3) + '・左右=(軌間+頭部)/2', (S.badY || S.badG || ['一致(左右の差 ' + S.gw.toFixed(4) + 'm)']).join(' '));
      ok(nm + 'の編成が線路内', S.badOut === null, '描いた頂点が線路の範囲', S.badOut ? S.badOut.join(' ') : '全て');
    }
    ok('世田谷線は渡り線を通る', Z.xo > 0, '渡り線の範囲で2本の線路の間を通る', Z.xo + '台車・コマ');
    const iS = maxStop.slice(0, inoG.length), zS = maxStop[inoG.length];
    ok('井の頭線が明大前に停車', I.badStop === null && iS.every((t) => t >= REF.INO_DWELL_MIN),
      '上下とも' + REF.INO_DWELL_MIN + '秒以上・ホームに収まる', I.badStop ? I.badStop.join(' ') : iS.map((t) => t.toFixed(0) + '秒').join('・'));
    ok('世田谷線が下高井戸の終端に停車', Z.badStop === null && zS >= REF.INO_DWELL_MIN,
      REF.INO_DWELL_MIN + '秒以上・北の端が終端から ' + REF.SETA_END + 'm 以内', Z.badStop ? Z.badStop.join(' ') : zS.toFixed(0) + '秒');
  }
}

/* ---- 4f. 地形(2026-10-25 利用者指示:地形を入れる)------------------------------------------------------------
   検証側の決まり(地形の手順を検証側に別に書き、データのファイルから独立に計算して照合する。値はモデルから読まない):
   (a) 格子の高さ:plateau_dem.js を検証側で復号し、文書(CLAUDE.md)の手順=閉じる(半径2マスの円の最大→最小)→ぼかす(σ1マス)→
       線路の地盤 Gs(s)(中心線と ±20m の中央値を σ60m)→起伏 × 重み(京王線の帯 21m・40m で起伏へ/交差鉄道・駅前広場は 30m/
       線路から 480〜600m と両端の外 100〜300m で 0)→平らな所に掛かるセルの4隅は 0、で 25m 格子の節点の高さを計算し、
       ビューアの格子(TER.H)と ±2cm で一致。京王線の帯の中(|off|≤21m)の点は 0
   (b) 地表の網:頂点の高さと三角形の重心が検証側の格子の面の上(±1cm)。起伏のあるセル 10,000 以上
   (c) 敷いた面(道路・緑地・水面・計画道路・緑道):起伏の上の頂点は地表+決まった高さ(0.05〜0.16m の7通り)、三角形の重心も
       (格子の1つの面の上=切ってから載せた)
   (d) 建物の基部:足跡の頂点・辺の 2m ごとの点・頂点の重心で測った地表の最も低い所(±1cm)。中・遠の箱の下面も基部
   (e) 実際の建物の地盤(reference/plateau/bldg_ground.json:地形モデルとは別のデータ=LOD1 の立体の最も低い標高)との照合:
       起伏がそのまま残る所(足跡の頂点の重みが全部 1)の建物で、基部 −(地盤 − Gs)の中央値が ±0.5m、中央値から 0.6m 以内が
       80% 以上・1.5m 以内が 95% 以上(10m 格子の平均・閉じる・25m 格子にした分の差)
   (f) 木の根元(幹の中心と 0.3m 外の4点の最も低い所)・地上の街灯(+5.2m)・自動車(前後の端の路面の平均+0.13m、縦の傾き=前後の
       路面の差)・歩く人(+0.27m)・歩道の頂点(+0.12/0.27m)・自動車道の橋脚の足元が地表に合う
   (g) 起伏が効いている:重み 1 の節点の標準偏差 1m 以上・高低差 8m 以上
   地形を描くべきかは検証側がファイルから決める(HTML が plateau_dem.js・plateau_land.js・plateau_bldg.js を読み、3つとも隣にある)。
   モデルの TER.on だけを見ると、地形を切った故障で (a)〜(g) が全部飛んで素通りした */
const TER_DATA = (() => { const fs = require('fs'), pth = require('path'), html = fs.readFileSync(path, 'utf8');
  return ['plateau_dem.js', 'plateau_land.js', 'plateau_bldg.js'].every((f) => html.includes('<script src="' + f + '">') && fs.existsSync(pth.join(pth.dirname(path), f))); })();
const TER_ON = !!(X.TER && X.TER.on && X.TER.H);
if (TER_DATA && !TER_ON) ok('起伏がある', false, '地形・道路・建物のデータが揃っていれば地形を描く', '地形が描かれていない(TER.on=' + !!(X.TER && X.TER.on) + ')');
if (TER_ON) {
  const fs = require('fs'), pth = require('path');
  const TR = { DX: 25, X0: -9100, X1: 1900, Z0: -1950, Z1: 3250, AS: 21, BL: 40, FAR0: 480, FAR1: 600, END0: 100, END1: 300,
    CLOSE: 2, BLUR: 1, GS_SIG: 60, GS_OFF: 20, GS_STEP: 10, GS_EXT: 700, SNAP: 0.003, CORR: [['INO', 17, 'U0', 'U1'], ['SETA', 7, 'SETA_U0', 'SETA_U1']],
    CORR_EXT: 10, CORR_BL: 30, DISC_R: 26, DISC_BL: 30, OFFS: [0.05, 0.06, 0.07, 0.08, 0.10, 0.12, 0.16], CAR_Y: 0.13, PED_Y: 0.27, SW_Y: [0.12, 0.27], LAMP_Y: 5.2 };
  const g = {};
  new Function('globalThis', fs.readFileSync(pth.join(pth.dirname(path), 'plateau_dem.js'), 'utf8'))(g);
  const D = g.PLATEAU_DEM, NX = D.nx, NZ = D.nz;
  // 1) 復号
  const rb = Buffer.from(D.r64, 'base64'), hb = Buffer.from(D.h64, 'base64');
  let A = new Float64Array(NX * NZ).fill(NaN);
  for (let j = 0, o = 0; j < NZ; j++) { const i0 = rb.readUInt16LE(4 * j), n = rb.readUInt16LE(4 * j + 2);
    for (let k = 0; k < n; k++) { const v = hb.readUInt16LE(2 * (o + k)); if (v !== 65535) A[j * NX + i0 + k] = D.h0 + v * D.q; } o += n; }
  // 2) 閉じる(最大→最小)
  const disk = []; for (let dj = -TR.CLOSE; dj <= TR.CLOSE; dj++) for (let di = -TR.CLOSE; di <= TR.CLOSE; di++) if (di * di + dj * dj <= TR.CLOSE * TR.CLOSE) disk.push([di, dj]);
  const mm = (S, f) => { const O = new Float64Array(NX * NZ).fill(NaN);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { if (Number.isNaN(S[j * NX + i])) continue; let v = S[j * NX + i];
      for (const [di, dj] of disk) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < NX && b < NZ && !Number.isNaN(S[b * NX + a])) v = f(v, S[b * NX + a]); }
      O[j * NX + i] = v; } return O; };
  A = mm(mm(A, Math.max), Math.min);
  // 3) ぼかす(縦横のガウス。データの無いマスは重みから外す)
  const KR = Math.ceil(2 * TR.BLUR), KW = []; for (let k = -KR; k <= KR; k++) KW.push(Math.exp(-0.5 * (k / TR.BLUR) ** 2));
  const bl = (S, di, dj) => { const O = new Float64Array(NX * NZ).fill(NaN);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { if (Number.isNaN(S[j * NX + i])) continue; let a = 0, w = 0;
      for (let k = -KR; k <= KR; k++) { const ii = i + k * di, jj = j + k * dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || Number.isNaN(S[jj * NX + ii])) continue; a += S[jj * NX + ii] * KW[k + KR]; w += KW[k + KR]; }
      O[j * NX + i] = a / w; } return O; };
  A = bl(bl(A, 1, 0), 0, 1);
  const dem = (x, z) => { const fx = (x - D.x0) / D.dx - 0.5, fz = (z - D.z0) / D.dx - 0.5, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i + 1 >= NX || j + 1 >= NZ) return NaN; const tx = fx - i, tz = fz - j, k = j * NX + i;
    return (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + NX] * (1 - tx) + A[k + NX + 1] * tx) * tz; };
  // 4) 線路の地盤 Gs
  const G0 = X.DOM.x0 - TR.GS_EXT, gv = [];
  for (let s = G0; s <= X.DOM.x1 + TR.GS_EXT + 1e-6; s += TR.GS_STEP) {
    const v = [-TR.GS_OFF, 0, TR.GS_OFF].map((f) => { const p = X.frame(s, f); return dem(p.x, p.z); }).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    gv.push(v.length ? v[(v.length - 1) >> 1] : NaN); }
  const GK = Math.ceil(3 * TR.GS_SIG / TR.GS_STEP);
  const GS = gv.map((_, i) => { let a = 0, w = 0; for (let k = -GK; k <= GK; k++) { const v = gv[i + k]; if (v === undefined || Number.isNaN(v)) continue;
    const ww = Math.exp(-0.5 * (k * TR.GS_STEP / TR.GS_SIG) ** 2); a += v * ww; w += ww; } return w ? a / w : NaN; });
  const gsAt = (s) => { const f = Math.max(0, Math.min(GS.length - 1, (s - G0) / TR.GS_STEP)), i = Math.min(GS.length - 2, Math.floor(f)), t = f - i; return GS[i] * (1 - t) + GS[i + 1] * t; };
  // 線路の座標(端の先は端の接線に沿ってはみ出した分を s に足す)
  const DPn = X.DP.x.length - 1;
  const prj = (x, z) => { const q = X.prjXY(x, z);
    for (const [i, j] of [[0, 1], [DPn, DPn - 1]]) { const sE = X.DP.s[i] - X.S_OFS; if (Math.abs(q.s - sE) > 0.5) continue;
      const L = Math.hypot(X.DP.x[i] - X.DP.x[j], X.DP.z[i] - X.DP.z[j]) || 1, d = ((x - X.DP.x[i]) * (X.DP.x[i] - X.DP.x[j]) + (z - X.DP.z[i]) * (X.DP.z[i] - X.DP.z[j])) / L;
      if (d > 0) return { s: sE + (i === 0 ? -d : d), off: q.off }; }
    return q; };
  const ss = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const CR = TR.CORR.map((c) => ({ A: XC[c[0]], hw: c[1], u0: X.XR[c[2]] - TR.CORR_EXT, u1: X.XR[c[3]] + TR.CORR_EXT }));
  const corrD = (C, x, z) => { const p = C.A.uv(x, z); return Math.max(Math.abs(p.n) - C.hw, C.u0 - p.u, p.u - C.u1); };
  const PZ = X.frame(X.PLAZA_S, X.PLAZA_OFF);
  const wOf = (x, z) => { const q = prj(x, z), a = Math.abs(q.off);
    let w = ss((a - TR.AS) / TR.BL) * (1 - ss((a - TR.FAR0) / (TR.FAR1 - TR.FAR0))) * (1 - ss((X.DOM.x0 - TR.END0 - q.s) / (TR.END1 - TR.END0))) * (1 - ss((q.s - X.DOM.x1 - TR.END0) / (TR.END1 - TR.END0)));
    for (const C of CR) w *= ss(corrD(C, x, z) / TR.CORR_BL);
    w *= ss((Math.hypot(x - PZ.x, z - PZ.z) - TR.DISC_R) / TR.DISC_BL);
    return { w: w, s: q.s, off: q.off }; };
  // 5) 25m 格子
  const GX = Math.round((TR.X1 - TR.X0) / TR.DX), GZ = Math.round((TR.Z1 - TR.Z0) / TR.DX), W = GX + 1, H = new Float64Array(W * (GZ + 1)), WN = new Float64Array(W * (GZ + 1));
  const inD = (x, z) => x > D.x0 + D.dx && x < D.x0 + (NX - 1) * D.dx && z > D.z0 + D.dx && z < D.z0 + (NZ - 1) * D.dx;
  for (let j = 0; j <= GZ; j++) for (let i = 0; i <= GX; i++) { const x = TR.X0 + i * TR.DX, z = TR.Z0 + j * TR.DX; if (!inD(x, z)) continue;
    const r = wOf(x, z); WN[j * W + i] = r.w; if (r.w <= 0) continue; const h = dem(x, z) - gsAt(r.s); if (Number.isNaN(h)) continue; const v = r.w * h; H[j * W + i] = Math.abs(v) < TR.SNAP ? 0 : v; }
  const hd = TR.DX / Math.SQRT2;
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) { const x = TR.X0 + (i + 0.5) * TR.DX, z = TR.Z0 + (j + 0.5) * TR.DX; if (!inD(x, z)) continue;
    const q = prj(x, z); let f = Math.abs(q.off) - hd <= TR.AS; for (const C of CR) if (corrD(C, x, z) - hd <= 0) f = true; if (Math.hypot(x - PZ.x, z - PZ.z) - hd <= TR.DISC_R) f = true;
    if (f) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) H[(j + b) * W + i + a] = 0; }
  const tH = (x, z) => { const fx = (x - TR.X0) / TR.DX, fz = (z - TR.Z0) / TR.DX, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GX || j >= GZ) return 0; const tx = fx - i, tz = fz - j, k = j * W + i;
    return tx >= tz ? H[k] + (H[k + 1] - H[k]) * tx + (H[k + W + 1] - H[k + 1]) * tz : H[k] + (H[k + W] - H[k]) * tz + (H[k + W + 1] - H[k + W]) * tx; };
  // (a)
  let dMax = 0, nBad = 0, ex = null;
  const VH = X.TER.H;
  if (!VH || VH.length !== H.length) ex = '格子の大きさが違う';
  else for (let k = 0; k < H.length; k++) { const d = Math.abs(VH[k] - H[k]); if (d > dMax) dMax = d; if (d > 0.02) { nBad++; if (!ex) ex = '節点 (' + (k % W) + ',' + Math.floor(k / W) + ') ' + VH[k].toFixed(2) + ' ≠ ' + H[k].toFixed(2); } }
  let bandBad = null;
  for (let s = X.DOM.x0; s <= X.DOM.x1 && !bandBad; s += 7) for (const o of [-21, -14, -7, 0, 7, 14, 21]) { const f = X.frame(s, o); if (Math.abs(X.terH(f.x, f.z)) > 1e-9) { bandBad = 's=' + s + ' off=' + o + ' 地表 ' + X.terH(f.x, f.z).toFixed(3); break; } }
  ok('地形の高さ(格子)', ex === null && bandBad === null, 'plateau_dem.js から検証側で計算した 25m 格子と ±2cm・京王線の帯(±21m)は 0',
    ex ? ex + (nBad ? '(' + nBad + '点)' : '') : bandBad ? bandBad : '節点 ' + H.length + '・最大の差 ' + dMax.toFixed(4) + 'm');
  // (b) 地表の網
  { const ga = X.groundMesh.geometry.attributes.position.array, gi = X.groundMesh.geometry.index.array;
    let bad = null, nT = 0;
    for (let k = 0; k < ga.length && !bad; k += 3) if (Math.abs(ga[k + 1] - tH(ga[k], ga[k + 2])) > 0.01) bad = '頂点 (' + ga[k].toFixed(0) + ',' + ga[k + 2].toFixed(0) + ') ' + ga[k + 1].toFixed(2) + ' ≠ ' + tH(ga[k], ga[k + 2]).toFixed(2);
    for (let t = 0; t < gi.length && !bad; t += 3) { let x = 0, y = 0, z = 0; for (let e = 0; e < 3; e++) { x += ga[gi[t + e] * 3]; y += ga[gi[t + e] * 3 + 1]; z += ga[gi[t + e] * 3 + 2]; }
      if (Math.abs(y / 3 - tH(x / 3, z / 3)) > 0.01) bad = '三角形の重心 (' + (x / 3).toFixed(0) + ',' + (z / 3).toFixed(0) + ') が格子の面から ' + (y / 3 - tH(x / 3, z / 3)).toFixed(2) + 'm'; }
    for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) { const k = j * W + i; if (H[k] || H[k + 1] || H[k + W] || H[k + W + 1]) nT++; }
    ok('地表の網が起伏の面', bad === null && nT >= 10000, '頂点と三角形の重心が格子の面の上(±1cm)・起伏のセル 10,000 以上', bad || '起伏のセル ' + nT + '・三角形 ' + gi.length / 3); }
  // (c) 敷いた面
  { let bad = null, nV = 0, nO = 0; const OK = (d) => TR.OFFS.some((o) => Math.abs(d - o) < 0.002);
    X.scene.traverse((o) => {
      if (bad || !o.isMesh || !o.userData || !o.userData.flat || o === X.groundMesh || o.name === '歩道' || o.material === X.MAT_FENCE || !o.geometry || !o.geometry.index) return;
      const P = o.geometry.attributes.position.array, I = o.geometry.index.array;
      for (let k = 0; k < P.length && !bad; k += 3) { const t = tH(P[k], P[k + 2]); if (Math.abs(t) < 1e-6) continue; nV++;
        if (!OK(P[k + 1] - t)) bad = (o.name || '面') + ' の頂点 (' + P[k].toFixed(0) + ',' + P[k + 2].toFixed(0) + ') 地表+' + (P[k + 1] - t).toFixed(3) + 'm'; else nO++; }
      for (let t = 0; t < I.length && !bad; t += 3) { let x = 0, y = 0, z = 0, e = 0;
        for (let m = 0; m < 3; m++) { const v = I[t + m] * 3; x += P[v]; y += P[v + 1]; z += P[v + 2]; e += P[v + 1] - tH(P[v], P[v + 2]); }
        if (Math.abs((y / 3 - tH(x / 3, z / 3)) - e / 3) > 0.003) bad = (o.name || '面') + ' の三角形 (' + (x / 3).toFixed(0) + ',' + (z / 3).toFixed(0) + ') が地表の折れ目をまたぐ(' + ((y / 3 - tH(x / 3, z / 3)) - e / 3).toFixed(3) + 'm)'; }
    });
    ok('敷いた面が起伏に沿う', bad === null && nV >= 50000, '道路・緑地・水面・計画道路・緑道の頂点が地表+0.05〜0.16m・三角形が格子の1つの面の上', bad || '起伏の上の頂点 ' + nV); }
  // (d) 建物の基部
  const tMinP = (P) => { let m = 1e9, cx = 0, cz = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k < n; k++) m = Math.min(m, tH(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)); cx += a[0]; cz += a[1]; }
    return Math.min(m, tH(cx / P.length, cz / P.length)); };
  { let bad = null, n = 0, nUp = 0;
    for (const e of B) { if (!e.plateau || !e.poly) continue; n++; const want = tMinP(e.poly); if (Math.abs(want) > 0.5) nUp++;
      if (!(Math.abs((e.base || 0) - want) <= 0.01) && !bad) bad = '(' + e.x.toFixed(0) + ',' + e.z.toFixed(0) + ') 基部 ' + (e.base || 0).toFixed(2) + ' ≠ 地表の最低 ' + want.toFixed(2); }
    for (const C of X.CITY_LODS) { const im = C.m[1]; if (!im || !im.mats) continue;
      C.B.forEach((b, j) => { const q = im.mats[j]; if (!q || bad) return; if (Math.abs(q.p.y - q.s.y / 2 - b.base) > 0.01) bad = '箱の下面 ' + (q.p.y - q.s.y / 2).toFixed(2) + ' ≠ 基部 ' + b.base.toFixed(2); }); }
    ok('建物は地表の最も低い所から建つ', bad === null && n > 9000 && nUp > 2000, '足跡の下の地表の最も低い所(±1cm)・中の箱の下面も・起伏の上の建物 2,000棟以上', bad || n + '棟(起伏 0.5m 超の上 ' + nUp + '棟)'); }
  // (e) 実際の建物の地盤
  { const G = JSON.parse(fs.readFileSync(pth.join(__dirname, '..', 'reference', 'plateau', 'bldg_ground.json'), 'utf8')), zb = Buffer.from(G.b64, 'base64');
    const gB = {}; new Function('globalThis', fs.readFileSync(pth.join(pth.dirname(path), 'plateau_bldg.js'), 'utf8'))(gB);
    const pb = Buffer.from(gB.PLATEAU_BLDG.b64, 'base64'), N = pb.readUInt32LE(4), idx = new Map(); let o = 8;
    for (let n = 0; n < N; n++) { const nv = pb.readUInt8(o), hh = pb.readUInt16LE(o + 1) / 10; o += 4; idx.set((pb.readInt32LE(o) / 10).toFixed(1) + ',' + (pb.readInt32LE(o + 4) / 10).toFixed(1) + ',' + hh.toFixed(1), n); o += 8 + 4 * (nv - 1); }
    const D2 = [];
    let nW = 0;
    for (const e of B) { if (!e.plateau || !e.poly) continue;
      const i = idx.get(e.poly[0][0].toFixed(1) + ',' + e.poly[0][1].toFixed(1) + ',' + e.h.toFixed(1)); if (i === undefined || i >= G.n) continue;
      const v = zb.readUInt16LE(2 * i); if (v === 65535) continue;
      if (!e.poly.every((p) => wOf(p[0], p[1]).w >= 0.999)) continue;
      nW++;
      let cx = 0, cz = 0; for (const p of e.poly) { cx += p[0]; cz += p[1]; } cx /= e.poly.length; cz /= e.poly.length;
      D2.push((e.base || 0) - (G.z0 + v * G.q - gsAt(prj(cx, cz).s)));
    }
    D2.sort((a, b) => a - b); const med = D2.length ? D2[D2.length >> 1] : NaN;
    const f06 = D2.filter((d) => Math.abs(d - med) <= 0.6).length / Math.max(1, D2.length), f15 = D2.filter((d) => Math.abs(d - med) <= 1.5).length / Math.max(1, D2.length);
    ok('地形 ⇄ 実際の建物の地盤', D2.length >= 3000 && Math.abs(med) <= 0.5 && f06 >= 0.8 && f15 >= 0.95,
      '起伏のそのままの所の建物で 基部−(地盤−線路の地盤) の中央値 ±0.5m・0.6m 以内 80%・1.5m 以内 95%(bldg_ground.json)',
      D2.length + '棟・中央値 ' + med.toFixed(2) + 'm・0.6m 以内 ' + (f06 * 100).toFixed(1) + '%・1.5m 以内 ' + (f15 * 100).toFixed(1) + '%'); }
  // (f) 木・街灯・自動車・歩く人・歩道・橋脚
  { let bad = null, nT = 0, nTU = 0;
    for (const t of X.CITY.trees) { nT++; const want = Math.min(tH(t.x, t.z), tH(t.x + 0.3, t.z), tH(t.x - 0.3, t.z), tH(t.x, t.z + 0.3), tH(t.x, t.z - 0.3)); if (Math.abs(want) > 0.5) nTU++;
      if (!(Math.abs((t.y === undefined ? 0 : t.y) - want) <= 0.005) && !bad) bad = '木 (' + t.x.toFixed(0) + ',' + t.z.toFixed(0) + ') 根元 ' + (t.y === undefined ? '無し' : t.y.toFixed(2)) + ' ≠ ' + want.toFixed(2); }
    const yAt = new Map(X.CITY.trees.map((t) => [t.x + ',' + t.z, t.y]));
    for (const c of X.CITY.treeChunks.values()) for (const m of [c.m, c.mn]) if (!bad) m.mats.forEach((q) => { if (bad || !q) return; const y = yAt.get(q.p.x + ',' + q.p.z); if (y === undefined || Math.abs(q.p.y - y) > 1e-6) bad = '木の形の高さ ' + q.p.y.toFixed(2) + ' ≠ 根元 ' + (y === undefined ? '無し' : y.toFixed(2)); });
    ok('木は地表に立つ', bad === null && nTU > 300, '根元=幹の中心と 0.3m 外の4点の地表の最も低い所・起伏の上の木 300本以上', bad || nT + '本(起伏 0.5m 超の上 ' + nTU + '本)'); }
  { let bad = null, nG = 0, nGU = 0;
    const head = X.NIGHT.group.children.find((m) => m.isMesh && m.mats && m.mats.length === X.NIGHT.stat.lamp && m.geometry && m.geometry.type === 'Sph');
    if (!head) bad = '街灯の灯具が見つからない';
    else for (const q of head.mats) { if (!q) continue; const t = tH(q.p.x, q.p.z);
      if (Math.abs(q.p.y - (t + TR.LAMP_Y)) < 0.01) { nG++; if (Math.abs(t) > 0.5) nGU++; }
      else if (q.p.y < t + 6.5 && !bad) bad = '街灯 (' + q.p.x.toFixed(0) + ',' + q.p.z.toFixed(0) + ') の高さ ' + q.p.y.toFixed(2) + '(地表+' + (q.p.y - t).toFixed(2) + 'm。地上は +5.2・高架の灯りは高架の上)'; }
    ok('地上の街灯は地表から 5.2m', bad === null && nG > 200 && nGU >= 20, '灯具=地表+5.2m(高架の上の灯りは除く)・起伏の上 20基以上', bad || '地上 ' + nG + '基(起伏 0.5m 超の上 ' + nGU + '基)'); }
  { let bad = null, nC = 0, nS = 0;
    X.carsDraw(true);
    for (const c of X.RD_CARS) {
      const im = X.RD_CARS.meshes[c.kind], q = im && im.mats && im.mats[c.mi]; if (!q) continue;
      const p = c.lane.pos(c.u), hb2 = tH(p.x - p.fx * c.L / 2, p.z - p.fz * c.L / 2), hf = tH(p.x + p.fx * c.L / 2, p.z + p.fz * c.L / 2);
      const yw = (hf + hb2) / 2 + TR.CAR_Y, sw = Math.sin(Math.atan2(hf - hb2, c.L)); nC++; if (Math.abs(hf - hb2) > 0.05) nS++;
      const Q = q.q, fy = Q ? 2 * (Q.x * Q.y + Q.w * Q.z) : NaN, fxz = Q ? [1 - 2 * (Q.y * Q.y + Q.z * Q.z), 2 * (Q.x * Q.z - Q.w * Q.y)] : [NaN, NaN];
      if (!(Math.abs(q.p.y - yw) <= 0.005) && !bad) bad = '車 (' + p.x.toFixed(0) + ',' + p.z.toFixed(0) + ') の高さ ' + q.p.y.toFixed(3) + ' ≠ 路面+0.13 ' + yw.toFixed(3);
      else if (!(Math.abs(fy - sw) <= 0.002) && !bad) bad = '車 (' + p.x.toFixed(0) + ',' + p.z.toFixed(0) + ') の縦の傾き ' + fy.toFixed(4) + ' ≠ ' + sw.toFixed(4);
      else if (!(Math.abs(fxz[0] * p.fz - fxz[1] * p.fx) <= 0.002 && fxz[0] * p.fx + fxz[1] * p.fz > 0) && !bad) bad = '車の向きが進行方向でない';
    }
    ok('自動車は路面に載る', bad === null && nC >= 40 && nS >= 10, '前後の端の路面の平均+0.13m・縦の傾き=前後の路面の差/車の長さ・向き=進行方向・坂の上の車 10台以上', bad || nC + '台(坂 ' + nS + '台)'); }
  { let bad = null, nP = 0, nPU = 0;
    for (const m of X.PEDS) { const q = X.pedPos(m), t = tH(q.x, q.z); nP++; if (Math.abs(t) > 0.5) nPU++;
      if (!(Math.abs(q.y - (t + TR.PED_Y)) <= 0.003) && !bad) bad = '歩く人 (' + q.x.toFixed(0) + ',' + q.z.toFixed(0) + ') ' + q.y.toFixed(2) + ' ≠ 地表+0.27 ' + (t + TR.PED_Y).toFixed(2); }
    let nSW = 0;
    X.scene.traverse((o) => { if (bad || o.name !== '歩道' || !o.geometry) return; const P = o.geometry.attributes.position.array;
      for (let k = 0; k < P.length && !bad; k += 3) { const t = tH(P[k], P[k + 2]); if (Math.abs(t) < 1e-6) continue; nSW++;
        if (!TR.SW_Y.some((y) => Math.abs(P[k + 1] - t - y) < 0.003)) bad = '歩道の頂点 (' + P[k].toFixed(0) + ',' + P[k + 2].toFixed(0) + ') 地表+' + (P[k + 1] - t).toFixed(3); } });
    ok('歩く人と歩道が地表に載る', bad === null && nPU >= 20 && nSW > 1000, '歩く人=地表+0.27m・歩道の頂点=地表+0.12/0.27m・起伏の上の人 20人以上', bad || nP + '人(起伏の上 ' + nPU + ')・歩道の頂点 ' + nSW); }
  { let bad = null, n = 0;
    const pm = []; X.scene.traverse((o) => { if (o.isMesh && o.mats && o.mats.length === X.EXPY.piers.length && o.material === X.MAT.pier) pm.push(o); });
    if (pm.length !== 1) bad = '自動車道の橋脚のインスタンスが見つからない(' + pm.length + ')';
    else pm[0].mats.forEach((q, i) => { if (bad || !q) return; n++; const p = X.EXPY.piers[i], t = tH(q.p.x, q.p.z), bot = q.p.y - q.s.y / 2, top = q.p.y + q.s.y / 2;
      if (Math.abs(bot - t) > 0.005) bad = '橋脚 (' + q.p.x.toFixed(0) + ',' + q.p.z.toFixed(0) + ') の足元 ' + bot.toFixed(2) + ' ≠ 地表 ' + t.toFixed(2);
      else if (Math.abs(top - p[2]) > 0.005) bad = '橋脚の上端 ' + top.toFixed(2) + ' ≠ 床版の下面 ' + p[2].toFixed(2); });
    ok('自動車道の橋脚は地表から', bad === null && n > 100, '橋脚の足元=地表・上端=床版の下面', bad || n + '基'); }
  // (g) 起伏が効いている
  { const V = []; for (let k = 0; k < H.length; k++) if (WN[k] >= 0.999) V.push(H[k]);
    const mu = V.reduce((a, v) => a + v, 0) / Math.max(1, V.length), sd = Math.sqrt(V.reduce((a, v) => a + (v - mu) ** 2, 0) / Math.max(1, V.length));
    const lo = Math.min(...V), hi = Math.max(...V);
    ok('起伏がある', V.length > 5000 && sd >= 1.0 && hi - lo >= 8, '起伏のそのままの所の節点:標準偏差 1m 以上・高低差 8m 以上', V.length + '点・標準偏差 ' + sd.toFixed(2) + 'm・' + lo.toFixed(1) + '〜' + hi.toFixed(1) + 'm'); }
}

/* ---- 4g. 航空写真(2026-10-26 利用者指示:国土地理院の航空写真を閲覧時に読み込み、地表と屋根に真上から貼る)-------------------
   検証側の決まり(値はモデルから読まない。使うのは世界座標の定義 LAT0・LON0・MLAT・MLON と構造物の幅 deckHalf・cutHalf だけ):
   (a) 座標:タイルの番号は Web メルカトル(検証側の式)。シェーダの展開 tc=((x−x0)·sx, (z−z0)·sz+(z−z0)²·q)(ORTHO_U の値で計算)が、
       段ごとの窓の中の点で式と 0.25画素以内(遠=地表の全体を1枚にした段は 0.6画素)。枠の原点 uOw は窓の原点の n の剰余
   (b) 枠と書き込み:近・中の枠 (sx,sy) には窓の中で番号が n の剰余で等しいタイル、遠は窓の原点からの番号。その枠への最後の書き込み
       (renderer.copies)がそのタイルの URL(書式は検証側)。画像ごとの最後の書き込みは縮小の段も作り直す(コマの終わりに1回)。
       画像は一辺 256×枚数・近と中は繰り返し・遠は端で止める・上下を反転しない
   (c) 窓の置き場(lodStruct の後):視線が地表に当たる所(当たらなければ近 350m・中 1400m 先)の番号が窓の中心から 1枚以内。
       運転台のカメラ自身も近の窓の中。遠は地表の網の全体を覆う。段は z18・16・14、近と中の窓は 8×8 枚
   (d) 帯の印(画像の値を検証側で GL の双線形に読む。値=128+10×距離・写真の割合=clamp(距離+0.5)):構造物の半幅(掘割は側ごと)
       +3.6m の内は 0.05 以下(高架下と側道は今の色)、+6.7m の外は 0.95 以上、事業区間の端の 3m 外も 0.95 以上、
       井の頭線・世田谷線の建築限界の半幅−1m の内は 0.05 以下。街から外した実際の建物(plateau_bldg.js を検証側で読み、帯の中の
       建物から街にある物を引く)のうち、足跡が構造物の半幅+4.6m に掛かる物の重心は 0.05 以下(写真では屋根が地面に平らに写る)、
       30m 以上離れて外した物は写真のまま、街にある建物の重心は 99.5% 以上で 0.95 以上
   (e) 材質(onBeforeCompile を通した結果):地表の網=全面+帯の灰・地表に敷いた面(道路・緑地)=全面・水面と計画の放射23号線=無し・
       歩道と玉川上水=上面・建物=屋根(PLATEAU の写真の面は無し)。uniform は ORTHO_U そのもの
   (f) 明るさ:昼・夏・晴れで係数 0.65、夜は地表と同じ 0.55 倍、雨は地表の色と同じ比、雪は白へ 0.5 以上寄せる。帯の灰は #8f8d88
   (g) 切替:OFF で uOrthoOn=0・水面を出す/ON で 1・写真が読めていれば水面を隠す
   (h) 読めないタイル:書かない(近の枠は α=0 で塗ったまま=前の窓のタイルが残らない)・待ちに数えない */
const REF_OR = { URL: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/', Z: [18, 16, 14], N: X.IS_MOBILE ? [0, 4] : [8, 8], AHEAD: [350, 1400],
  TOL_PX: [0.25, 0.25, 0.6], GAIN: 0.65, NIGHT: 0.55, BAND_IN: 3.6, BAND_OUT: 6.7, END_OUT: 3, XR_IN: 1.0, BAND_HEX: 0x8f8d88, SNOW_MIN: 0.5,
  HOLE_OUT: 4.0, HOLE_MISS: 0.03, KEEP_PHOTO: 0.995, FAR_RM: 30 };   // 外した建物の足跡:この距離[m]の内は帯の外の検査から除く(帯の印は 4m/画素で、足跡どうしの狭い隙間では
                                                          // 双線形が距離を小さく読むので1画素)・重心で写真が出てよい割合・街の建物で写真が出る割合
const OM = X.ORTHO_MGR, OU = X.ORTHO_U;
if (!OM || !OU) ok('航空写真', false, '航空写真の読み込み(ORTHO_MGR)と uniform(ORTHO_U)がある', '無い');
else {
  const P2 = (z) => Math.pow(2, z), md = (a, n) => ((a % n) + n) % n;
  const tileOf = (x, z, zm) => { const lon = X.LON0 + x / X.MLON, la = (X.LAT0 - z / X.MLAT) * Math.PI / 180;
    return [(lon + 180) / 360 * P2(zm), (1 - Math.asinh(Math.tan(la)) / Math.PI) / 2 * P2(zm)]; };
  const worldOf = (tx, ty, zm) => { const lon = tx / P2(zm) * 360 - 180, la = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / P2(zm)))) * 180 / Math.PI;
    return [(lon - X.LON0) * X.MLON, -(la - X.LAT0) * X.MLAT]; };
  const LVS = OM.LV.filter((L) => L.slots), cam = X.camera;
  const aim = (p, y, t, ty) => { cam.position.set(p.x, y, p.z); cam.lookAt(t.x, ty, t.z); };
  // (c) 窓の置き場
  { let bad = null, n = 0;
    const cases = [];
    { const T = X.frame(2000, 0), C = X.frame(2200, 0); cases.push({ n: '俯瞰', C: C, cy: 400, T: T, ty: 0 }); }   // 高架の帯(地表 0)の上 400m から 200m 先
    { const C = X.frame(6000, 0), T = X.frame(6200, 0), y = X.railY(6000) + 3.2; cases.push({ n: '運転台', C: C, cy: y, T: T, ty: y, cab: true }); }   // 水平に線路の先
    { const C = X.frame(3000, 0), T = X.frame(4500, 0); cases.push({ n: '遠望', C: C, cy: 1500, T: T, ty: 0 }); }   // 1500m の高さから 1.5km 先
    for (const K of cases) {
      aim(K.C, K.cy, K.T, K.ty); for (let k = 0; k < 3; k++) X.lodStruct();
      const dx = K.T.x - K.C.x, dy = K.ty - K.cy, dz = K.T.z - K.C.z, fh = Math.hypot(dx, dz), D = dy < 0 ? K.cy * fh / -dy : 1e9;
      for (const L of LVS) { if (L.whole) continue;
        const dist = Math.min(D, REF_OR.AHEAD[L.i]), t = tileOf(K.C.x + dx / fh * dist, K.C.z + dz / fh * dist, L.z); n++;
        if (!(Math.abs(t[0] - (L.ox + L.nx / 2)) <= 1 && Math.abs(t[1] - (L.oy + L.ny / 2)) <= 1) && !bad)
          bad = K.n + ' z' + L.z + ' の窓の中心 (' + (L.ox + L.nx / 2) + ',' + (L.oy + L.ny / 2) + ') ≠ 見る所 (' + t[0].toFixed(2) + ',' + t[1].toFixed(2) + ')';
        if (K.cab && L === LVS[0]) { const c = tileOf(K.C.x, K.C.z, L.z);
          if (!(c[0] >= L.ox + 0.5 && c[0] <= L.ox + L.nx - 0.5 && c[1] >= L.oy + 0.5 && c[1] <= L.oy + L.ny - 0.5) && !bad) bad = '運転台のカメラが近の窓の外'; } }
    }
    const W = LVS.find((L) => L.whole);
    if (!W) bad = bad || '遠の段(地表の全体)が無い';
    else { const ga = X.groundMesh.geometry.attributes.position.array; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < ga.length; k += 3) { x0 = Math.min(x0, ga[k]); x1 = Math.max(x1, ga[k]); z0 = Math.min(z0, ga[k + 2]); z1 = Math.max(z1, ga[k + 2]); }
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) { const t = tileOf(x, z, W.z);
        if (!(t[0] >= W.ox && t[0] <= W.ox + W.nx && t[1] >= W.oy && t[1] <= W.oy + W.ny) && !bad) bad = '遠の段が地表の隅 (' + x.toFixed(0) + ',' + z.toFixed(0) + ') を覆わない'; } }
    const lvOK = LVS.map((L) => L.z).join(',') === REF_OR.Z.filter((z, i) => i === 2 || REF_OR.N[i] > 0).join(',') && LVS.every((L) => L.whole || L.n === REF_OR.N[L.i]);
    ok('航空写真:窓の置き場', bad === null && lvOK, '視線が地表に当たる所(無ければ近 350m・中 1400m 先)が窓の中心から 1枚以内(lodStruct の後)・運転台は近の窓の中・遠は地表の全体・段 z18/16/14・窓 8×8',
      bad || (lvOK ? n + '件・' + LVS.map((L) => 'z' + L.z + '(' + L.nx + '×' + L.ny + ')').join(' ') : '段の構成が違う ' + LVS.map((L) => 'z' + L.z + ':' + L.n).join(' '))); }
  // (a)(b) 座標・枠と書き込み(今の窓のタイルを全部書かせる)
  OM.update(true);
  { const eMax = [0, 0, 0]; let bad = null, nS = 0, nOk = 0;
    const lastCopy = new Map();
    for (const c of X.renderer.copies) lastCopy.set(c.dst, (lastCopy.get(c.dst) || new Map()).set(c.x + ',' + c.y, c.src));
    for (const L of LVS) { const i = L.i, o = OU['uOr' + i].value, w = OU['uOw' + i].value, q = [OU.uOq.value.x, OU.uOq.value.y, OU.uOq.value.z][i];
      if (L.z !== REF_OR.Z[i] && !bad) bad = '段 ' + i + ' が z' + L.z;
      for (const a of [0.02, 0.25, 0.5, 0.75, 0.98]) for (const b of [0.02, 0.25, 0.5, 0.75, 0.98]) {
        const tx = L.ox + a * L.nx, ty = L.oy + b * L.ny, p = worldOf(tx, ty, L.z), dx = p[0] - o.x, dz = p[1] - o.y;
        eMax[i] = Math.max(eMax[i], Math.max(Math.abs(dx * o.z - (tx - L.ox)), Math.abs(dz * o.w + dz * dz * q - (ty - L.oy))) * 256); }
      const wx = L.whole ? 0 : md(L.ox, L.nx), wy = L.whole ? 0 : md(L.oy, L.ny);
      if (!(w.x === wx && w.y === wy && w.z === L.nx && w.w === L.ny) && !bad) bad = 'z' + L.z + ' の枠の原点 uOw (' + [w.x, w.y, w.z, w.w].join(',') + ') ≠ (' + [wx, wy, L.nx, L.ny].join(',') + ')';
      const T = L.tex;
      if (T !== OU['uOrtho' + i].value && !bad) bad = 'z' + L.z + ' の画像がシェーダの uniform と違う';
      if (!(T.image.width === L.nx * 256 && T.image.height === L.ny * 256 && T.flipY === false && T.wrapS === (L.whole ? 1001 : 1000) && T.wrapT === T.wrapS) && !bad)
        bad = 'z' + L.z + ' の画像 ' + T.image.width + '×' + T.image.height + '・繰り返し ' + T.wrapS + '/' + T.wrapT + '・上下の反転 ' + T.flipY;
      const LC = lastCopy.get(T) || new Map(), lastAny = X.renderer.copies.filter((c) => c.dst === T).pop();
      if (lastAny && !lastAny.mip && !bad) bad = 'z' + L.z + ' の画像の最後の書き込みで縮小の段を作り直していない(遠くの写真が古い段のまま)';
      for (const S of L.slots) { nS++;
        const t = L.whole ? [L.ox + S.sx, L.oy + S.sy] : [L.ox + md(S.sx - L.ox, L.nx), L.oy + md(S.sy - L.oy, L.ny)];
        const url = REF_OR.URL + L.z + '/' + t[0] + '/' + t[1] + '.jpg', got = LC.get(S.sx * 256 + ',' + S.sy * 256);
        if (got === url) nOk++; else if (!bad) bad = 'z' + L.z + ' の枠 (' + S.sx + ',' + S.sy + ') の最後の書き込み ' + got + ' ≠ ' + url; }
    }
    ok('航空写真:座標(Web メルカトル)', eMax.every((e, i) => e <= REF_OR.TOL_PX[i]), 'シェーダの展開が式と 近・中 0.25画素・遠 0.6画素以内', LVS.map((L) => 'z' + L.z + ' ' + eMax[L.i].toFixed(3)).join('・') + '画素');
    ok('航空写真:枠と書き込み', bad === null && nS > 0 && nOk === nS, '枠に入るのは番号が n の剰余で等しいタイル(遠は原点から)・最後の書き込みがその URL で縮小の段も作り直す・画像の大きさと繰り返し', bad || nOk + '/' + nS + '枠'); }
  // (d) 帯の印
  { const MT = OU.uOrthoMask.value, im = MT && MT.image, dat = im && im.data, mw = im && im.width, mh = im && im.height, om = OU.uOm.value;
    const mwt = (x, z) => { const u = (x - om.x) * om.z, v = (z - om.y) * om.w; if (u < 0 || v < 0 || u > 1 || v > 1) return 1;
      const fx = u * mw - 0.5, fy = v * mh - 0.5, i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
      const g = (ii, jj) => dat[Math.max(0, Math.min(mh - 1, jj)) * mw + Math.max(0, Math.min(mw - 1, ii))];
      return Math.max(0, Math.min(1, ((g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b - 128) * 0.1 + 0.5)); };
    const xr = [[XC.INO, X.XR.U0, X.XR.U1, REF.XRAIL_HALF['井の頭線']], [XC.SETA, X.XR.SETA_U0, X.XR.SETA_U1, REF.XRAIL_HALF['世田谷線']]];
    const nearXR = (x, z) => xr.some(([A, u0, u1, hw]) => { const p = A.uv(x, z); return p.u > u0 - 25 && p.u < u1 + 25 && Math.abs(p.n) < hw + 25; });
    /* 街から外した実際の建物:plateau_bldg.js を検証側で読み、帯の中(重心の s が事業区間・|off|≤DOM.z)の建物のうち街(CITY.buildings)に
       無い物。そのうち足跡(頂点と辺の 2m ごとの点)が構造物の半幅+DECK_CLEAR(4.6m)の内に掛かる物=線路の帯で外した物は、写真では
       屋根が帯の脇の地面に平らに写るので、重心が今の色(写真 0.05 以下)であること。線路から 30m 以上離れて(井の頭線・世田谷線の帯の
       近くも除く)外した物は写真の屋根のまま(0.95 以上が 95% 以上。今の色にすると無地の穴になる)。街にある建物の重心は 99.5% 以上で
       写真(0.95 以上)=外した足跡の印が広がりすぎない(足跡+8m にすると 98.1% になる) */
    const inP = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const segD = (P, x, z) => { let d = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[j], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const u = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0; d = Math.min(d, Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u)); } return d; };
    const RM = [], KP = [];
    { const fs = require('fs'), pth = require('path'), f = pth.join(pth.dirname(path), 'plateau_bldg.js');
      if (fs.readFileSync(path, 'utf8').includes('<script src="plateau_bldg.js">') && fs.existsSync(f)) {
        const gB = {}; new Function('globalThis', fs.readFileSync(f, 'utf8'))(gB);
        const pb = Buffer.from(gB.PLATEAU_BLDG.b64, 'base64'), N = pb.readUInt32LE(4);
        const kept = new Set(B.filter((e) => e.plateau && e.poly).map((e) => e.poly[0][0].toFixed(1) + ',' + e.poly[0][1].toFixed(1) + ',' + e.h.toFixed(1)));
        for (let n = 0, o = 8; n < N; n++) {
          const nv = pb.readUInt8(o), h = pb.readUInt16LE(o + 1) / 10; o += 4;
          let x = pb.readInt32LE(o), z = pb.readInt32LE(o + 4); o += 8; const P = [[x / 10, z / 10]];
          for (let i = 1; i < nv; i++) { x += pb.readInt16LE(o); z += pb.readInt16LE(o + 2); o += 4; P.push([x / 10, z / 10]); }
          if (P.length < 3 || !(h > 0)) continue;
          let A2 = 0, cx = 0, cz = 0;
          for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length], w = a[0] * c[1] - c[0] * a[1]; A2 += w; cx += (a[0] + c[0]) * w; cz += (a[1] + c[1]) * w; }
          if (Math.abs(A2) < 2) continue; cx /= 3 * A2; cz /= 3 * A2;
          const q = X.prjXY(cx, cz); if (q.s < X.DOM.x0 || q.s > X.DOM.x1 || Math.abs(q.off) > X.DOM.z) continue;
          if (kept.has(P[0][0].toFixed(1) + ',' + P[0][1].toFixed(1) + ',' + h.toFixed(1))) { KP.push({ P: P, cx: cx, cz: cz }); continue; }
          let dmin = 1e9;   // 足跡の点の (|off| − 構造物の半幅) の最小
          for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length], m = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2));
            for (let k = 0; k < m; k++) { const pq = X.prjXY(a[0] + (c[0] - a[0]) * k / m, a[1] + (c[1] - a[1]) * k / m), sg = pq.off < 0 ? -1 : 1;
              dmin = Math.min(dmin, Math.abs(pq.off) - (pq.s > X.DECK_END ? X.cutHalf(pq.s, sg) : X.deckHalf(pq.s))); } }
          RM.push({ P: P, cx: cx, cz: cz, d: dmin });
        }
      } }
    // 外した足跡の近く(帯の外の検査から除く):格子で引く
    const RG = new Map(), RC = 20; for (const r of RM) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of r.P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      for (let i = Math.floor((x0 - 5) / RC); i <= Math.floor((x1 + 5) / RC); i++) for (let j = Math.floor((z0 - 5) / RC); j <= Math.floor((z1 + 5) / RC); j++) { const k = i + ',' + j; if (!RG.has(k)) RG.set(k, []); RG.get(k).push(r); } }
    const nearRM = (x, z, d) => (RG.get(Math.floor(x / RC) + ',' + Math.floor(z / RC)) || []).some((r) => inP(r.P, x, z) || segD(r.P, x, z) < d);
    let bad = null, nIn = 0, nOut = 0, nSkip = 0;
    if (!dat || dat.length !== mw * mh || MT.magFilter !== 1006 || MT.minFilter !== 1006) bad = '帯の印の画像が無いか、双線形でない';
    else {
      for (let s = X.DOM.x0 + 1.5; s <= X.DOM.x1 - 1.5 && !bad; s += 5) for (const sg of [-1, 1]) {   // 事業区間の端ちょうどは帯の縁(0.5)
        const hw = s > X.DECK_END ? X.cutHalf(s, sg) : X.deckHalf(s);
        for (const o of [0, sg * hw * 0.5, sg * hw, sg * (hw + REF_OR.BAND_IN)]) { const f = X.frame(s, o), m = mwt(f.x, f.z); nIn++;
          if (m > 0.05 && !bad) bad = '帯の中 s=' + s + ' off=' + o.toFixed(1) + ' の写真の割合 ' + m.toFixed(2); }
        const f = X.frame(s, sg * (hw + REF_OR.BAND_OUT)); if (nearXR(f.x, f.z)) continue;
        if (nearRM(f.x, f.z, REF_OR.HOLE_OUT)) { nSkip++; continue; }
        const m = mwt(f.x, f.z); nOut++;
        if (m < 0.95 && !bad) bad = '帯の外 s=' + s + ' off=' + (sg * (hw + REF_OR.BAND_OUT)).toFixed(1) + ' の写真の割合 ' + m.toFixed(2);
      }
      for (const s of [X.DOM.x0 - REF_OR.END_OUT, X.DOM.x0 - 20, X.DOM.x1 + REF_OR.END_OUT, X.DOM.x1 + 20]) for (const o of [-8, 0, 8]) {
        const f = X.frame(s, o); if (nearRM(f.x, f.z, REF_OR.HOLE_OUT)) continue; const m = mwt(f.x, f.z); nOut++;
        if (m < 0.95 && !bad) bad = '事業区間の外 s=' + s + ' off=' + o + ' の写真の割合 ' + m.toFixed(2); }
      // 井の頭線は実際の線路から REF.INO_CLEAR−1m、世田谷線は中心線から XRAIL_HALF−1m の内(2026-10-27 から曲線の上で。以前の直線の式は
      // 曲線の物に .x/.ax が無く NaN になって素通りしていた。NaN も NG にする)
      for (const [A, u0, u1, hw] of xr) for (let u = u0; u <= u1 && !bad; u += 5) {
        const c = A.pos(u), vs = A === XC.INO ? [-(Math.abs(A.trackV(0, u)) + REF.INO_CLEAR - REF_OR.XR_IN), 0, Math.abs(A.trackV(1, u)) + REF.INO_CLEAR - REF_OR.XR_IN] : [-(REF.XRAIL_HALF['世田谷線'] - REF_OR.XR_IN), 0, REF.XRAIL_HALF['世田谷線'] - REF_OR.XR_IN];
        for (const v of vs) { const m = mwt(c.x + c.nx * v, c.z + c.nz * v); nIn++;
          if (!(m <= 0.05) && !bad) bad = '交差鉄道の帯 u=' + u + ' v=' + v.toFixed(1) + ' の写真の割合 ' + m; } }
    }
    ok('航空写真:線路の帯は今の色', bad === null && nIn > 5000 && nOut > 2000, '構造物の半幅(掘割は側ごと)+3.6m の内・井の頭線と世田谷線の建築限界−1m の内は写真 0.05 以下/+6.7m の外・事業区間の端の 3m 外は 0.95 以上(外した建物の足跡の近くは除く)',
      bad || '内 ' + nIn + '点・外 ' + nOut + '点(外した足跡の近くで除いた ' + nSkip + '点)');
    let rmBad = 0, rmN = 0, rmEx = null, fN = 0, fOK = 0, kOK = 0, kN = 0;
    if (dat) { for (const r of RM) { if (!inP(r.P, r.cx, r.cz)) continue; const m = mwt(r.cx, r.cz);
        if (r.d <= REF.DECK_CLEAR) { rmN++; if (m > 0.05) { rmBad++; if (!rmEx) rmEx = '(' + r.cx.toFixed(0) + ',' + r.cz.toFixed(0) + ') の写真の割合 ' + m.toFixed(2); } }
        else if (r.d >= REF_OR.FAR_RM && !nearXR(r.cx, r.cz)) { fN++; if (m >= 0.95) fOK++; } }
      for (const r of KP) { if (!inP(r.P, r.cx, r.cz)) continue; kN++; if (mwt(r.cx, r.cz) >= 0.95) kOK++; } }
    ok('航空写真:外した建物の足跡は今の色', rmN >= 100 && rmBad <= rmN * REF_OR.HOLE_MISS && fN >= 50 && fOK >= fN * 0.95 && kN > 9000 && kOK >= kN * REF_OR.KEEP_PHOTO,
      '線路の帯で外した実際の建物(plateau_bldg.js を検証側で読み、足跡が構造物の半幅+4.6m に掛かる物)の重心で写真 0.05 以下(' + (REF_OR.HOLE_MISS * 100) + '% まで)・' +
      REF_OR.FAR_RM + 'm 以上離れて外した建物は写真のまま(95%)・街にある建物の重心は ' + (REF_OR.KEEP_PHOTO * 100) + '% 以上で 0.95 以上',
      '帯で外した ' + rmN + '棟のうち写真が出る ' + rmBad + (rmEx ? '(' + rmEx + ')' : '') + '・離れて外した ' + fN + '棟のうち写真 ' + fOK +
      '・街の ' + kN + '棟のうち写真 ' + kOK + '(' + (kN ? (kOK / kN * 100).toFixed(1) : '-') + '%)'); }
  // (e) 貼る面
  { let bad = null; const cnt = { all: 0, top: 0, roof: 0, none: 0, photo: 0 }, seen = new Set();
    const UN = ['uOrtho0', 'uOrtho1', 'uOrtho2', 'uOrthoMask', 'uOr0', 'uOr1', 'uOr2', 'uOw0', 'uOw1', 'uOw2', 'uOq', 'uOm', 'uOf', 'uOrthoOn', 'uOrthoGain', 'uOrthoSnow', 'uOrthoBand'];
    const comp = (m) => { const sh = { uniforms: {}, vertexShader: 'void main(){\n#include <begin_vertex>\n}', fragmentShader: 'void main(){\n#include <color_fragment>\n#include <emissivemap_fragment>\n}' };
      if (typeof m.onBeforeCompile === 'function') m.onBeforeCompile(sh, X.renderer); return sh; };
    const kind = (o) => { const m = o.material, ud = (m && m.userData) || {};   // [名前, 種類, シェーダの呼び出し]
      if (o === X.groundMesh) return ['地表の網', 'all', 'orthoMix(diffuseColor.rgb,vOrW,1.,1.)'];
      if (ud.bldWin) return ud.bldWinPhoto ? ['PLATEAU の写真の面', 'photo', null] : ['建物', 'roof', 'orthoMix(diffuseColor.rgb,vBW,smoothstep(.5,.7,vBN.y),0.)'];
      if (!o.userData || !o.userData.flat || m === X.MAT_FENCE) return null;
      if (o.name === '水面' || m === X.MAT.roadPlan) return [o.name || '計画の放射23号線', 'none', null];
      if (o.name === '歩道' || m === X.MAT_JOSUI) return [o.name || '玉川上水', 'top', 'orthoMix(diffuseColor.rgb,vOrW,smoothstep(.5,.7,vOrN.y),0.)'];
      return ['地表に敷いた面', 'all', 'orthoMix(diffuseColor.rgb,vOrW,1.,0.)']; };
    X.scene.traverse((o) => {
      if (bad || !o.isMesh || !o.material || Array.isArray(o.material)) return;
      const k = kind(o); if (!k) return;
      cnt[k[1] === 'photo' ? 'none' : k[1]]++; if (k[1] === 'photo') cnt.photo++;
      if (seen.has(o.material)) return; seen.add(o.material);
      const sh = comp(o.material), ud = o.material.userData || {}, fs = sh.fragmentShader, at = fs.indexOf('#include <color_fragment>');
      const tag = k[2] ? k[1] : undefined;
      if (k[2] ? !(fs.indexOf(k[2]) > at && at >= 0 && UN.every((u) => sh.uniforms[u] === OU[u]) && sh.vertexShader.includes(o === X.groundMesh || k[1] !== 'roof' ? 'vOrW=' : 'vBW=')) : fs.includes('orthoMix('))
        bad = k[0] + (o.name ? '(' + o.name + ')' : '') + ' のシェーダ:' + (k[2] || '航空写真なし') + ' でない';
      else if (ud.ortho !== tag || !!ud.orthoBand !== (o === X.groundMesh)) bad = k[0] + ' の材質の印 ortho=' + ud.ortho + '・orthoBand=' + ud.orthoBand;
    });
    ok('航空写真:貼る面', bad === null && cnt.all >= 2 && cnt.top >= 2 && cnt.roof > 0 && cnt.none >= 2,
      '地表の網=全面+帯の灰・道路と緑地=全面・歩道と玉川上水=上面・建物=屋根・水面と計画道路と PLATEAU の写真の面=無し(onBeforeCompile の結果と uniform)',
      bad || '全面 ' + cnt.all + '・上面 ' + cnt.top + '・屋根 ' + cnt.roof + '・無し ' + cnt.none + '(うち写真の面 ' + cnt.photo + ')'); }
  // (f) 明るさ
  { const C = X.CINE, g = () => OU.uOrthoGain.value, gc = () => X.MAT.ground.color.g, s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    C.setTime('noon'); C.setSeason('summer'); C.setWeather('clear');
    const g0 = g().x, c0 = gc(), bv = OU.uOrthoBand.value, band = [bv.x, bv.y, bv.z, bv.w], sn0 = OU.uOrthoSnow.value.w;
    const bw = [(REF_OR.BAND_HEX >> 16) & 255, (REF_OR.BAND_HEX >> 8) & 255, REF_OR.BAND_HEX & 255].map((v) => s2l(v / 255));
    C.setTime('night'); const gN = g().x, cN = gc();
    C.setTime('noon'); C.setWeather('rain'); const gR = g().x, cR = gc();
    C.setWeather('snow'); const snW = OU.uOrthoSnow.value.w;
    C.setWeather('clear'); const g1 = g().x;
    const okB = band.slice(0, 3).every((v, i) => Math.abs(v - bw[i]) < 1e-4) && band[3] === 1;
    ok('航空写真:明るさ', Math.abs(g0 - REF_OR.GAIN) < 1e-6 && Math.abs(gN / g0 - REF_OR.NIGHT) < 1e-6 && Math.abs(gN / g0 - cN / c0) < 1e-6 && Math.abs(gR / g0 - cR / c0) < 1e-6 && gR < g0 &&
      sn0 === 0 && snW >= REF_OR.SNOW_MIN && Math.abs(g1 - g0) < 1e-9 && g().y === g().x && g().z === g().x && okB,
      '昼・夏・晴れ 0.65・夜は 0.55 倍(地表と同じ比)・雨は地表と同じ比・雪は白へ 0.5 以上・帯の灰 #8f8d88',
      '昼 ' + g0.toFixed(3) + '・夜 ' + (gN / g0).toFixed(3) + '倍(地表 ' + (cN / c0).toFixed(3) + ')・雨 ' + (gR / g0).toFixed(3) + '倍(地表 ' + (cR / c0).toFixed(3) + ')・雪 ' + snW.toFixed(2) +
      '・帯 ' + band.slice(0, 3).map((v) => v.toFixed(4)).join(',') + (okB ? '' : '(期待 ' + bw.map((v) => v.toFixed(4)).join(',') + ')')); }
  // (g) 切替
  { const wm = X.LU.waterMesh, needW = !!(X.LU.water && X.LU.water.length);
    OM.setOn(false); const f0 = [OU.uOrthoOn.value, wm ? wm.visible : null, OM.on];
    OM.setOn(true); const f1 = [OU.uOrthoOn.value, wm ? wm.visible : null, OM.on];
    ok('航空写真:切替', f0[0] === 0 && f0[2] === false && f1[0] === 1 && f1[2] === true && (needW ? !!wm && f0[1] === true && f1[1] === false : true),
      'OFF:uOrthoOn=0・水面を出す/ON:1・写真が読めていれば水面を隠す', 'OFF ' + f0.join(',') + '/ON ' + f1.join(',') + (needW && !wm ? '(水面の Mesh が登録されていない)' : '')); }
  // (h) 読めないタイル(画像の読み込みを全部失敗させて、これまでの窓から離れた所を見る)
  { const RealImage = global.Image, failed = new Set();
    global.Image = class { constructor() { this.onload = null; this.onerror = null; this._src = ''; } set src(v) { this._src = v; failed.add(v); if (this.onerror) this.onerror(); } get src() { return this._src; } };
    const st0 = OM.stat(), nc0 = X.renderer.copies.length, sF = X.DOM.x1 - 200;
    aim(X.frame(sF - 150, 0), 300, X.frame(sF, 0), 0); X.lodStruct(); OM.update(true);
    const st1 = OM.stat(), L0 = LVS[0], stray = X.renderer.copies.slice(nc0).filter((c) => failed.has(c.src)).length;
    const last = new Map(); for (const c of X.renderer.copies) if (c.dst === L0.tex) last.set(c.x + ',' + c.y, c.src);
    const kept = L0.slots.filter((S) => S.ok || last.get(S.sx * 256 + ',' + S.sy * 256) !== 'data').length;
    global.Image = RealImage;
    ok('航空写真:読めないタイル', stray === 0 && kept === 0 && st1.pending === 0 && st1.fails - st0.fails >= L0.slots.length && !OM.dead,
      '書かない(近の枠は α=0 で塗ったまま=前の窓のタイルが残らない)・待ちに数えない・前に読めていれば止めない',
      '新たな失敗 ' + (st1.fails - st0.fails) + '枚・塗っていない近の枠 ' + kept + '・読めなかったタイルの書き込み ' + stray + '・待ち ' + st1.pending + (OM.dead ? '・止めた' : '')); }
}

/* ---- 出力 ---------------------------------------------------------------- */
/* ---- 自動車と歩く人(利用者指示)。検証側の決まり:2分間、描いたインスタンスの位置がいつも道路の面(PLATEAU の道路区域。
   自動車専用の橋梁は除く)の上・高架の柱から2.5m 以上・自動車道の橋脚から2m 以上、2車線の道では進行方向の左を走る(左側通行)。
   2026-10-12 利用者指示:車と人は線路から 50m 以内だけ(同日の指示で 100m に)・トラックやバスも・環七・環八・甲州街道・井の頭通りは渋滞
   (同日の指示で密度を半分に)・ほかの道の車は1.5倍に・歩道を人が歩く。
   ・線路から 100m(REF_RD.NEAR)以内。車種はトラック・バスとも 5台以上
   ・渋滞の道(環七・環八の交わる所 ±40m と、線路に並ぶ幹線):車線の長さあたり 15〜26m に1台(以前の約9m の半分の密度)、平均の速さが 4m/s 未満。
     ほかの道は 5m/s 以上で、2車線の道は 60m に1台以上(以前の 80m の1.5倍)。同じ車線の車どうしが重ならない(車の長さの半分の和+1m 以上)
   ・歩く人は歩道(登録簿 SIDEWALKS の帯の幅の内)の上・線路から 50m 以内で、歩いている(脚を振る量1・2分で位置が変わる) ---- */
if (X.ROADS_PL.length) {
  const REF_RD = { HEAD_DEG: 6, YAW_DEG_M: 2.5, NEAR: 100, MIN_TRUCK: 5, MIN_BUS: 5, HEAVY_SP_MAX: 26, FREE_SP: 60, HEAVY_SP: 15, HEAVY_V: 4, FREE_V: 5, GAP: 1.0, HEAVY_X: [X.KAN7_X, X.KANPACHI_X, X.KYU_INOKA_X] };   // 環七・環八・井の頭通り
  const C = X.RD_CARS, M = C.meshes || {};
  ok('自動車の台数', C.length >= 40 && X.RD_LANES.length >= 20, '40台以上・20車線以上', C.length + '台・' + X.RD_LANES.length + '車線');
  const nk = (k) => C.filter((c) => c.kind === k).length;
  ok('トラック・バスも走る', nk('truck') >= REF_RD.MIN_TRUCK && nk('bus') >= REF_RD.MIN_BUS, 'トラック・バス各 5台以上', 'トラック' + nk('truck') + '・バス' + nk('bus') + '・乗用車' + nk('car') + '・軽バン' + nk('van'));
  const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const ground = X.ROADS_PL.filter((R) => !(R.k === 2 && R.sec === 2));
  // 隣り合う道路区域の多角形の継ぎ目(データの 0.1m ほどのすき間)は道路の上とみなす:多角形の内か、縁から 0.2m 以内
  const SEAM = 0.2;
  const edgeD = (P, x, z) => { let d = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[j], b = P[i], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const u = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0; d = Math.min(d, Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u)); } return d; };
  const onRoad = (x, z) => ground.some((R) => x >= R.bb[0] - SEAM && x <= R.bb[1] + SEAM && z >= R.bb[2] - SEAM && z <= R.bb[3] + SEAM && (inPoly(R.P, x, z) || edgeD(R.P, x, z) < SEAM));
  const cols = []; for (const c of X.VIA_COLS) for (const o of c.offs) { const f = X.frame(c.s, o); cols.push([f.x, f.z]); }
  // 描くのは近い車だけ(carsDraw)。検証では全台を書かせて測る。遠い車を描かないことも見る
  { const cp = X.camera.position; cp.set(-9000, 50, 3000); X.carsDraw(); const nDraw = Object.values(M).reduce((a, m) => a + m.count, 0);
    ok('遠い車は描かない', nDraw < C.length, 'カメラから遠い車はインスタンスに書かない', nDraw + '/' + C.length + '台'); }
  X.carsDraw(true);
  const posOf = (c) => { const q = M[c.kind] && M[c.kind].mats && M[c.kind].mats[c.mi]; if (!q) return null; const Q = q.q;   // 向き=インスタンスの回転の +x
    return { x: q.p.x, z: q.p.z, hx: Q ? 1 - 2 * (Q.y * Q.y + Q.z * Q.z) : NaN, hz: Q ? 2 * (Q.x * Q.z - Q.w * Q.y) : NaN }; };
  let bad = null, left = 0, right = 0, moved = 0, far = 0, ovl = null, hd = { n: 0, worst: 0, at: null, yaw: 0, yat: null };
  const prev = C.map(posOf);
  const vs = { h: [0, 0], f: [0, 0] };
  for (let k = 0; k < 240 && !bad; k++) {
    X.stepRoadCars(0.5); X.carsDraw(true);
    C.forEach((c, i) => {
      if (bad) return;
      const q = posOf(c); if (!q) { bad = '位置が無い ' + i; return; }
      const x = q.x, z = q.z;
      if (!onRoad(x, z)) bad = '道路の外 x=' + x.toFixed(0) + ' z=' + z.toFixed(0);
      else if (cols.some((p) => Math.hypot(p[0] - x, p[1] - z) < 2.5)) bad = '高架の柱に近い x=' + x.toFixed(0);
      else if (X.EXPY.piers.some((p) => Math.hypot(p[0] - x, p[1] - z) < 2.0)) bad = '自動車道の橋脚に近い';
      if (Math.abs(X.prjXY(x, z).off) > REF_RD.NEAR + 0.5) far++;
      const pv = prev[i], dx = x - pv.x, dz = z - pv.z, d = Math.hypot(dx, dz);
      const heavyRoad = c.lane.kind === '並' || REF_RD.HEAVY_X.some((h) => Math.abs(X.prjXY(c.lane.cx || x, c.lane.cz || z).s - h) < 40);
      if (d < 20) { const g = heavyRoad ? vs.h : vs.f; g[0] += d / 0.5; g[1]++; }
      if (d > 0.5 && d < 20) {                                       // 向き=進んだ向き(0.5秒の弦)・向きの変わり方(1m あたり)
        const hl = Math.hypot(q.hx, q.hz), pl = Math.hypot(pv.hx, pv.hz), a = Math.acos(Math.max(-1, Math.min(1, (dx * q.hx + dz * q.hz) / d / hl))) * 180 / Math.PI;
        const y = Math.acos(Math.max(-1, Math.min(1, (q.hx * pv.hx + q.hz * pv.hz) / hl / pl))) * 180 / Math.PI / d; hd.n++;
        if (!(a <= hd.worst)) { hd.worst = a; hd.at = c.lane.kind + ' s=' + X.prjXY(x, z).s.toFixed(0); }
        if (!(y <= hd.yaw)) { hd.yaw = y; hd.yat = c.lane.kind + ' s=' + X.prjXY(x, z).s.toFixed(0); } }
      if (d > 0.3 && d < 20 && c.lane.off > 0) {                     // 端での入り直し(大きく跳ぶ)は除く
        moved++;
        // 車の位置から道路の中心線への横の向き。中心線:横切る道は (cx,cz)+(dx,dz)t、並ぶ道は線路の s での中心 oc(s)
        let px, pz;
        if (c.lane.kind === '並') { const s = X.prjXY(x, z).s, f = X.frame(s, c.lane.oc(s)); px = x - f.x; pz = z - f.z; }
        else { const L = c.lane, t = (x - L.cx) * L.dx + (z - L.cz) * L.dz; px = x - (L.cx + L.dx * t); pz = z - (L.cz + L.dz * t); }
        if (px * (dz / d) + pz * (-dx / d) > 0) left++; else right++;
      }
      prev[i] = q;
    });
    // 同じ車線で重ならない
    if (!ovl) for (const L of X.RD_LANES) {
      const A = C.filter((c) => c.lane === L).map((c) => ({ c: c, p: posOf(c) })).filter((q) => q.p);
      for (let i = 0; i < A.length && !ovl; i++) for (let j = i + 1; j < A.length; j++) {
        const d = Math.hypot(A[i].p.x - A[j].p.x, A[i].p.z - A[j].p.z);
        if (d < (A[i].c.L + A[j].c.L) / 2 + REF_RD.GAP - 0.01 && d > 0.01) { ovl = '重なり ' + d.toFixed(1) + 'm'; break; }
      }
    }
  }
  ok('自動車は道路の上を走る', bad === null, '2分間:道路の面の上・柱から2.5m・橋脚から2m', bad || C.length + '台×240回');
  ok('自動車は左側通行', left > 0 && right === 0 && moved > 1000, '2車線の道で進行方向の左', '左' + left + '・右' + right);
  ok('自動車の向きが進む向き', hd.n > 10000 && hd.worst <= REF_RD.HEAD_DEG && hd.yaw <= REF_RD.YAW_DEG_M,
    '進んだ向きとの差 ' + REF_RD.HEAD_DEG + '° 以内・向きの変わり方 ' + REF_RD.YAW_DEG_M + '°/m 以内(2026-10-27 曲がるときに斜めに進んでいた)',
    '最大 ' + hd.worst.toFixed(1) + '°(' + hd.at + ')・' + hd.yaw.toFixed(2) + '°/m(' + hd.yat + ')・' + hd.n + '標本');
  ok('自動車は線路から100m 以内', far === 0, '|off|≦' + REF_RD.NEAR + 'm', far + '回はみ出し');
  // 渋滞:幹線(環七・環八・線路に並ぶ幹線)の車線の密度と速さ
  const hl = X.RD_LANES.filter((L) => L.kind === '並' || REF_RD.HEAVY_X.some((h) => Math.abs(X.prjXY(L.cx, L.cz).s - h) < 40));
  const hlen = hl.reduce((a, L) => a + (L.L1 - L.L0), 0), hn = C.filter((c) => hl.indexOf(c.lane) >= 0).length;
  const hv = vs.h[1] ? vs.h[0] / vs.h[1] : 99, fv = vs.f[1] ? vs.f[0] / vs.f[1] : 0;
  const fl = X.RD_LANES.filter((L) => hl.indexOf(L) < 0 && L.off > 0), flen = fl.reduce((a, L) => a + (L.L1 - L.L0), 0), fn = C.filter((c) => fl.indexOf(c.lane) >= 0).length;
  ok('ほかの道の車(以前の1.5倍)', fn * REF_RD.FREE_SP >= flen && fl.length >= 10, '2車線の道で ' + REF_RD.FREE_SP + 'm に1台以上', fl.length + '車線・' + (flen / Math.max(1, fn)).toFixed(1) + 'm に1台');
  ok('幹線は渋滞', hl.length >= 4 && hn * REF_RD.HEAVY_SP <= hlen && hn * REF_RD.HEAVY_SP_MAX >= hlen && hv < REF_RD.HEAVY_V && fv >= REF_RD.FREE_V && ovl === null,
    '幹線の車線 4本以上・' + REF_RD.HEAVY_SP + '〜' + REF_RD.HEAVY_SP_MAX + 'm に1台(以前の半分)・平均 ' + REF_RD.HEAVY_V + 'm/s 未満(ほかは ' + REF_RD.FREE_V + '以上)・重ならない',
    hl.length + '車線・' + (hlen / Math.max(1, hn)).toFixed(1) + 'm に1台・幹線 ' + hv.toFixed(2) + 'm/s・ほか ' + fv.toFixed(1) + 'm/s' + (ovl ? '・' + ovl : ''));
  // 歩く人
  const PD = X.PEDS || [];
  let bP = null, mv = 0;
  const p0 = PD.map((m) => X.pedPos(m));
  for (let k = 0; k < 120 && !bP; k++) {
    X.stepPeds(1.0);
    for (const m of PD) {
      const q = X.pedPos(m), W = m.sw, f = W.f(m.u), lat = (q.x - f.x) * f.fz - (q.z - f.z) * f.fx;
      if (Math.abs(lat) > W.w / 2 + 1e-3 || !(m.u >= W.a && m.u <= W.b) || !(W.seg || []).some((s) => m.u >= s[0] - 0.01 && m.u <= s[1] + 0.01)) { bP = '歩道の外 u=' + m.u.toFixed(1); break; }
      if (Math.abs(X.prjXY(q.x, q.z).off) > REF_RD.NEAR + 3.5) { bP = '線路から ' + X.prjXY(q.x, q.z).off.toFixed(0) + 'm'; break; }
    }
  }
  PD.forEach((m, i) => { const q = X.pedPos(m); if (Math.hypot(q.x - p0[i].x, q.z - p0[i].z) > 1) mv++; });
  const swSeg = (X.SIDEWALKS || []).reduce((a, W) => a + (W.seg || []).length, 0);
  ok('歩道を人が歩く', PD.length >= 80 && swSeg > 40 && bP === null && mv >= 0.9 * PD.length, '歩道の帯 40区間以上・80人以上・歩道の上・線路から' + REF_RD.NEAR + 'm・歩いている',
    'の帯 ' + swSeg + '区間・' + PD.length + '人' + (bP ? '・' + bP : '') + '・動いた ' + mv);
}
console.log('=== 街並みと交差鉄道の検証 ===');
console.log('(置かれた1件ずつの世界座標を測り、道路・河川・鉄道・高架下と突き合わせ)\n');
const w = [0, 0, 0].map((_, i) => Math.max.apply(null, rows.map((r) => [...r[i]].length).concat([8])));
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].length + 2));
console.log(pad('項目', 30) + pad('期待', 24) + pad('実測', 30) + '判定');
for (const r of rows) console.log(pad(r[0], 30) + pad(r[1], 24) + pad(r[2], 30) + r[3]);
console.log('\n建物 ' + B.length + '棟 / 樹木 ' + T.length + '本');
console.log(ng ? 'RESULT: FAIL(' + ng + '項目NG)' : 'RESULT: PASS');
process.exit(ng ? 1 : 0);
