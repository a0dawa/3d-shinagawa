// 地形の検証用の点を出す(品川版。姉妹作 3d-togoshikoen の terrain_points.js を、品川の地形 terH() に合わせたもの)。
//   線路の両側 ±off[m] の帯と、地形の格子 TER の全域から、種を固定した乱数で点を取り、
//   モデルの地面の標高 TP[m](= terH(x,z) + Y_TP)を書き出す。tools/terrain_vs_gsi.py が国土地理院の DEM5A と比べる。
//   使い方: node tools/terrain_points.js <HTML> [--n 600] [--off 600] > points.json
//   ・品川の地形は絶対の標高(Y = 標高 TP − Y_TP)。ただし線路の帯(中心から 21m)の中は線路の地盤 Gs(s)(60m のぼかし)にそろえ、
//     中心から 480〜600m で平らへ消える(TER.FAR0/FAR1)。線路の両端の先(s が DOM の外)も 10〜300m で平らへ消える。ゆえに残差は帯・遠く・線路の端の先で大きくなるのが仕様。
//     inDom=線路の区間の中(DOM.x0〜x1)の印。判定は inDom の点だけで見る。区間(off)ごとに分けて見る
const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : +A[i + 1]; };
const X = require('./stub_three')(A[0], 'terH:terH,TER:TER,Y_TP:Y_TP,LAT0:LAT0,LON0:LON0,MLAT:MLAT,MLON:MLON,prjXY:prjXY,DOM:DOM,frame:frame');
if (!X.TER || !X.TER.H) { console.error('地形が無い(plateau_dem.js が無い)'); process.exit(1); }
let a = 12345; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
const n = opt('n', 600), off = opt('off', 600), pts = [];
const T = X.TER;
const b = { x0: T.X0 + 60, x1: T.X1 - 60, z0: T.Z0 + 60, z1: T.Z1 - 60 };
for (let i = 0; i < n; i++) {
  let x, z;
  if (i % 2) { const f = X.frame(X.DOM.x0 + rnd() * (X.DOM.x1 - X.DOM.x0), (rnd() * 2 - 1) * off); x = f.x; z = f.z; }   // 線路の帯(±off)
  else { x = b.x0 + rnd() * (b.x1 - b.x0); z = b.z0 + rnd() * (b.z1 - b.z0); }                                          // 格子の全域
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
  const q = X.prjXY(x, z);
  pts.push({ x, z, lat: X.LAT0 - z / X.MLAT, lon: X.LON0 + x / X.MLON, y: X.terH(x, z) + X.Y_TP, s: q.s, off: q.off, inDom: q.s >= X.DOM.x0 && q.s <= X.DOM.x1 });
}
console.log(JSON.stringify({ h0: 0, pts }));
