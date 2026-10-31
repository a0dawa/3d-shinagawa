// 京急2100形:生成された"実ジオメトリ"と編成を測って、諸元の表(推定を含む)と照合する(品川版 ④)。
//
//   車体の形(シェル)・窓と扉の数・パンタグラフ・編成(8両・車番・パンタの位置)を、HTML を実行して出来た
//   頂点と登録簿から測る。塗り分け(赤・白い帯・黒い前面窓)はシェーダなので頂点には現れない(写真で照合する)。
//   基準値は下の REF で持つ(HTML から読まない)。★多くは推定値(CLAUDE.md の「推定値の一覧」)。
//   実車の資料・写真で REF と HTML の K21 を両方直すこと。
//   使い方: node tools/verify_car21.js [keikyu_shinagawa_3d.html]
const path = process.argv[2] || 'keikyu_shinagawa_3d.html';
const X = require('./stub_three')(path,
  'K21GEO:K21GEO,K21_WIN:K21_WIN,K21_FORMATIONS:K21_FORMATIONS,trains:trains,WIRE_TRO:WIRE_TRO');

const REF = {
  LEN: 17.5, PITCH: 18.0,          // 車体長・連結面間(推定)
  HWB: 2.78 / 2,                   // 車体半幅(推定)
  Z_FLR: 1.15, ROOF: 3.645,        // 床面・屋根の高さ(推定)
  DOORS: 2, DOORX: [-4.85, 4.85],  // 片側の扉の数と中心(推定)
  WIN_BETWEEN: 4,                  // 扉間の側窓の数(推定)
  CARS: 8,                         // 8両編成
  PANTO_CARS: [3, 7], PANTO_PER: 2,   // パンタのある号車(浦賀方から)と1両あたりの数(推定)
  NUM_FIRST: /^21\d\d$/,           // 車番は 21xx
  TOL: 0.005,
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']); }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? REF.TOL : t);
function v4pts(geo) {                         // Three.js(x,上,左右)→(x, y=左右, z=上)
  const P = geo.attributes.position.array, out = [];
  for (let i = 0; i < P.length; i += 3) out.push([P[i], -P[i + 2], P[i + 1]]);
  return out;
}
const range = (pts, k) => { let lo = 1e9, hi = -1e9; for (const p of pts) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; } return [lo, hi]; };
const G = X.K21GEO;

/* ---- 1. 車体 ---- */
{
  const mid = v4pts(G.shell), cab = v4pts(G.shellCab);
  const xr = range(mid, 0), yr = range(mid, 1), zr = range(mid, 2);
  ok('車体長(中間車)', near(xr[1] - xr[0], REF.LEN), REF.LEN + 'm', (xr[1] - xr[0]).toFixed(3) + 'm');
  ok('車体幅', near(yr[1] - yr[0], 2 * REF.HWB, 0.002), (2 * REF.HWB).toFixed(3) + 'm', (yr[1] - yr[0]).toFixed(3) + 'm');
  ok('屋根の高さ', near(zr[1], REF.ROOF), REF.ROOF + 'm', zr[1].toFixed(3) + 'm');
  const hw = Math.max(yr[1], -yr[0]), side = mid.filter((p) => Math.abs(Math.abs(p[1]) - hw) < 1e-4);
  ok('床面の高さ(側面の下端)', near(range(side, 2)[0], REF.Z_FLR), REF.Z_FLR + 'm', range(side, 2)[0].toFixed(3) + 'm');
  const cr = range(cab, 0);
  ok('先頭車の長さ(連結面〜前面)', cr[1] - cr[0] <= REF.LEN + 0.01 && cr[1] - cr[0] >= REF.LEN - 0.6,
     (REF.LEN - 0.6) + '〜' + REF.LEN + 'm', (cr[1] - cr[0]).toFixed(3) + 'm');
}

/* ---- 2. 窓と扉 ---- */
{
  for (const k of ['mid', 'cab']) {
    const W = X.K21_WIN[k];
    const doorWin = W.filter((w) => w[6] === 2), side = W.filter((w) => w[6] === 0);
    const doors = new Set(doorWin.map((w) => Math.round((w[0] + w[1]) / 2 / 0.6) * 0.6)).size;   // 扉ごとに戸2枚
    ok('扉窓の数(' + k + ')', doorWin.length === REF.DOORS * 2, REF.DOORS * 2 + '枚(扉' + REF.DOORS + 'か所×戸2枚)', doorWin.length + '枚');
    const dc = []; for (let i = 0; i < doorWin.length; i += 2) dc.push((doorWin[i][1] + doorWin[i + 1][0]) / 2);
    ok('扉の中心(' + k + ')', dc.length === REF.DOORX.length && dc.every((d, i) => near(d, REF.DOORX[i], 0.01)),
       REF.DOORX.join('/'), dc.map((d) => d.toFixed(2)).join('/'));
    const between = side.filter((w) => w[0] > REF.DOORX[0] && w[1] < REF.DOORX[1]);
    ok('扉間の側窓(' + k + ')', between.length === REF.WIN_BETWEEN, REF.WIN_BETWEEN + '枚', between.length + '枚');
    const overlap = side.some((w) => REF.DOORX.some((d) => w[1] > d - 0.6 && w[0] < d + 0.6));
    ok('側窓が扉に掛からない(' + k + ')', !overlap, '重ならない', overlap ? '重なる' : '重ならない');
    void doors;
  }
}

/* ---- 3. パンタグラフ ---- */
{
  const shoe = v4pts(G.panto.shoe), top = range(shoe, 2)[1];
  ok('すり板が架線に接する', near(top, X.WIRE_TRO, 0.005), X.WIRE_TRO + 'm(トロリ線)', top.toFixed(3) + 'm');
}

/* ---- 4. 編成 ---- */
{
  let bad = null;
  for (const t of X.trains) {
    const n = t.cars.length;
    if (n !== REF.CARS && !bad) bad = '両数 ' + n;
    // 浦賀方から数えた号車:+s へ走る列車(dir>0)は先頭が8号車
    t.cars.forEach((c, j) => {
      const no = t.dir > 0 ? n - j : j + 1, o = c.userData.k8;
      const want = REF.PANTO_CARS.indexOf(no) >= 0, np = (c.userData.panto ? 1 : 0) + (c.userData.panto2 ? 1 : 0);
      if (!bad && np !== (want ? REF.PANTO_PER : 0)) bad = o.num + ' パンタ' + np + '基';
      if (!bad && !REF.NUM_FIRST.test(o.num)) bad = '車番 ' + o.num;
      if (!bad && (j === 0) !== !!o.cabF) bad = o.num + ' 運転台';
    });
  }
  ok('編成(8両・車番・パンタ・運転台)', bad === null && X.trains.length > 0,
     REF.CARS + '両・パンタは' + REF.PANTO_CARS.join('・') + '号車に' + REF.PANTO_PER + '基', bad || X.trains.length + '本 全て');
}

const w = (t, n) => { t = String(t); let l = 0; for (const ch of t) l += ch.charCodeAt(0) > 255 ? 2 : 1; return t + ' '.repeat(Math.max(1, n - l)); };
for (const r of rows) console.log(w(r[0], 36) + w(r[1], 36) + w(r[2], 30) + r[3]);
console.log(ng ? 'RESULT: FAIL(' + ng + '項目NG)' : 'RESULT: PASS');
process.exit(ng ? 1 : 0);
