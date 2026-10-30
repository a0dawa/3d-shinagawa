// 京王8000系(v4):生成された"実ジオメトリ"を測って実測値と照合する。④
//
//   2026-10 に車体を v4(reference/keio8000_v4/、利用者提供の Blender 用モデル)へ
//   差し替えた。寸法の根拠は ref/keio8000_measured_v4.md(RailFile.jp 8714編成の
//   山側・海側の編成写真を 60px/m で測った値と、前面写真の実測)。
//
//   役割分担:
//     auto_check.py      … HTML の諸元表(K8)の数値そのものを検査する(ソースレベル)
//     verify_car.js(本)… HTML を実行し、出来上がった頂点・部品の位置を測る(形)
//     verify_k8render.js … 実際に描いた画素を v4 の照合ツールで測る(塗り分け)
//   塗り分け(帯・窓・扉・前面の黒)はシェーダなので頂点には現れない。それは⑩で見る。
//
//   基準値はすべて下の REF(実測表から写した値)で持つ。HTML から読まない。
//   使い方: node tools/verify_car.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'K8:K8,K8GEO:K8GEO,K8_WIN:K8_WIN,K8_FORMATIONS:K8_FORMATIONS,K9_FORMATIONS:K9_FORMATIONS,makeCar:makeCar,' +
  'setCarDoors:setCarDoors,k8nose:k8nose,trains:trains,parkedCars:parkedCars,' +
  'WIRE_TRO:WIRE_TRO,RAIL_OFF:RAIL_OFF,GAUGE:GAUGE,RAIL_W:RAIL_W,RAIL_TOP:RAIL_TOP,' +
  'seatCar:seatCar,frame:frame,railY:railY,zRunDown:zRunDown,M_HL:M_HL,M_TL:M_TL,' +
  'M_HL_OFF:M_HL_OFF,M_TL_OFF:M_TL_OFF,K8M:K8M,M_PASS:M_PASS,M_PASS_OFF:M_PASS_OFF,' +
  'lodCar:lodCar,camera:camera,K9GEO:K9GEO');

/* ---- 基準値(ref/keio8000_measured_v4.md から。検証側が独立して持つ)---------- */
const REF = {
  LEN: 19.5, PITCH: 20.0, HWB: 1.385,                  // 車体長・連結面間・車体半幅(幅2,770)
  Z_BOT: 1.007, Z_FLR: 1.147,                          // 車体すそ・床面(扉の下端の線)
  Z_SH0: 3.387, Z_CROWN: 3.72,                         // 雨どい・屋根頂部
  BAND_Z: [1.266, 1.520, 1.573, 1.609, 1.650, 1.853, 1.995, 2.908, 2.927, 3.061, 3.198, 3.282],
  DOORX: [-7.05, -2.35, 2.35, 7.05], DOOR_HW: 0.648,  // 扉の中心・開口の半幅
  // 側面の開口(外枠の外側)
  DROP: [[0.021, 0.943]],            // 扉間中心 g からの距離(2連)
  POCKET: [0.895, 1.175],            // 扉中心からの距離
  DWIN: [0.135, 0.546],              // 扉窓(扉中心からの距離)
  END_DROP: [8.466, 9.396], END_POCKET: [7.945, 8.225],
  WZ: [1.995, 2.927], DWZ1: 2.908,
  CREW_WIN: [8.595, 8.95, 2.01, 2.927],
  // 前面の輪郭(中心面)。v4 はこの実測を折れ線で近似しているので、z3.09 付近で最大3.2cm
  // 差がある(v4 の NOSE_PROFILE は (2.52,9.752)→(3.50,9.635) の直線)。許容 0.035m
  NOSE: [[1.80, 9.752], [2.52, 9.752], [3.09, 9.652], [3.53, 9.635], [3.71, 9.29]], NOSE_TOL: 0.035,
  BOGIE_X: 6.88, WB_M: 2.2, WB_T: 2.1, WHEEL_R: 0.43,
  AC_TOP: 4.055, AC_L: 4.38,
  AC_FANS: 2,              // 冷房装置の凝縮器のファンの数(日立 HRB504-4 形。2026-10-12)
  PANTO_FROM_SHINJUKU: [2, 4, 5, 8, 9],                // パンタは新宿方から2・4・5・8・9両目
  CARS_8714F: ['8714', '8014', '8064', '8114', '8164', '8514', '8564', '8214', '8264', '8764'],
  // 9000系 9731F(10両。編成表の公表の並び)。パンタは デハ9000形・デハ9050形の京王八王子寄りに1基
  CARS_9731F: ['9731', '9031', '9081', '9531', '9131', '9581', '9681', '9231', '9281', '9781'],
  PANTO_9731F: [2, 3, 5, 8, 9],
  TOL: 0.01,
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) {
  if (!cond) ng++;
  rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']);
}
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? REF.TOL : t);
// Three.js の頂点(x,上,左右)→ v4 座標(x, y=−z, z=上)
function v4pts(geo) {
  const P = geo.attributes.position.array, out = [];
  for (let i = 0; i < P.length; i += 3) out.push([P[i], -P[i + 2], P[i + 1]]);
  return out;
}
const range = (pts, k) => { let lo = 1e9, hi = -1e9; for (const p of pts) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; } return [lo, hi]; };

/* ---- 1. 車体シェル(断面と長さ) -------------------------------------------- */
{
  const mid = v4pts(X.K8GEO.shell), cab = v4pts(X.K8GEO.shellCab);
  const xr = range(mid, 0), yr = range(mid, 1), zr = range(mid, 2);
  ok('車体長(中間車)', near(xr[1] - xr[0], REF.LEN), REF.LEN + 'm', (xr[1] - xr[0]).toFixed(3) + 'm');
  ok('車体幅', near(yr[1], REF.HWB) && near(-yr[0], REF.HWB), '±' + REF.HWB, yr[0].toFixed(3) + '〜' + yr[1].toFixed(3));
  ok('車体すそ', near(zr[0], REF.Z_BOT), REF.Z_BOT + 'm', zr[0].toFixed(3) + 'm');
  ok('屋根頂部', near(zr[1], REF.Z_CROWN), REF.Z_CROWN + 'm', zr[1].toFixed(3) + 'm');
  // 垂直な側面の上端(雨どい)。|y|=半幅の頂点の最高点
  const sideTop = Math.max(...mid.filter((p) => Math.abs(Math.abs(p[1]) - REF.HWB) < 1e-4).map((p) => p[2]));
  ok('垂直な側面の上端(雨どい)', near(sideTop, REF.Z_SH0), REF.Z_SH0 + 'm', sideTop.toFixed(3) + 'm');
  // 帯・窓・扉の境目に断面の頂点があること(v4 と同じ作り。塗り分けの境目で面が折れない)
  const zs = new Set(mid.map((p) => p[2].toFixed(3)));
  const miss = REF.BAND_Z.filter((z) => !zs.has(z.toFixed(3)));
  ok('境目に断面の頂点', miss.length === 0, REF.BAND_Z.length + '箇所', miss.length ? '欠け ' + miss.join(',') : '全箇所');
  // 前面の中心線の輪郭(先頭車、y≒0 の頂点の最前部を高さごとに)
  // 中心線(y=0)上の頂点を高さ順に並べ、目標の高さで x を内挿して比べる
  const ctr = cab.filter((p) => Math.abs(p[1]) < 1e-6 && p[0] > 9).sort((a, b) => a[2] - b[2]);
  const xAt = (z) => { for (let i = 0; i < ctr.length - 1; i++) { const a = ctr[i], b = ctr[i + 1];
    if (a[2] <= z && z <= b[2]) return a[0] + (b[0] - a[0]) * (z - a[2]) / ((b[2] - a[2]) || 1); } return null; };
  let worst = 0, at = '';
  for (const [z, xr0] of REF.NOSE) {
    const xm = xAt(Math.min(z, ctr.length ? ctr[ctr.length - 1][2] : z));
    if (xm === null) { worst = 9; at = 'z=' + z + ' 頂点なし'; continue; }
    if (Math.abs(xm - xr0) > worst) { worst = Math.abs(xm - xr0); at = 'z=' + z + ' ' + xm.toFixed(3); }
  }
  ok('前面の輪郭(中心面)', worst <= REF.NOSE_TOL, '±' + REF.NOSE_TOL + 'm(5点)', '最大差 ' + worst.toFixed(3) + 'm ' + at);
  ok('先頭車の後端', near(range(cab, 0)[0], -REF.LEN / 2), -REF.LEN / 2, range(cab, 0)[0].toFixed(3));
}

/* ---- 2. 側面の開口(シェーダへ渡す一覧)⇄ 実測 -------------------------------- */
{
  const want = (cab) => {
    const W = [];
    for (const g of [4.70, 0, -4.70]) for (const d of REF.DROP)
      W.push([g + d[0], g + d[1], 0], [g - d[1], g - d[0], 0]);
    for (const d of REF.DOORX) for (const sg of [-1, 1]) {
      if (cab && d > 7 && sg > 0) continue;                       // 運転台側の扉1の前は窓なし
      const a = d + sg * REF.POCKET[0], b = d + sg * REF.POCKET[1];
      W.push([Math.min(a, b), Math.max(a, b), 1]);
    }
    for (const s of (cab ? [-1] : [-1, 1])) {
      const a = s * REF.END_DROP[0], b = s * REF.END_DROP[1];
      W.push([Math.min(a, b), Math.max(a, b), 0]);
    }
    for (const d of REF.DOORX) W.push([d - REF.DWIN[1], d - REF.DWIN[0], 2], [d + REF.DWIN[0], d + REF.DWIN[1], 2]);
    if (cab) W.push([REF.CREW_WIN[0], REF.CREW_WIN[1], 3]);
    return W;
  };
  for (const [nm, cab] of [['中間車', false], ['先頭車', true]]) {
    const got = X.K8_WIN[cab ? 'cab' : 'mid'], exp = want(cab);
    let bad = null;
    if (got.length !== exp.length) bad = '数 ' + got.length + '/' + exp.length;
    for (const e of exp) {
      const m = got.find((w) => near(w[0], e[0], 0.002) && near(w[1], e[1], 0.002) && w[6] === e[2]);
      if (!m && !bad) bad = '無い ' + e[0].toFixed(3) + '〜' + e[1].toFixed(3);
      if (m) {
        const z0 = e[2] === 3 ? REF.CREW_WIN[2] : REF.WZ[0], z1 = e[2] === 2 ? REF.DWZ1 : REF.WZ[1];
        if ((!near(m[2], z0, 0.002) || !near(m[3], z1, 0.002)) && !bad) bad = '高さ ' + m[2] + '〜' + m[3];
      }
    }
    ok('側面の開口(' + nm + ')', bad === null, exp.length + '枚が実測どおり', bad === null ? got.length + '枚一致' : bad);
  }
  // 戸袋窓の外側の"車端の戸袋窓"は中間車の両端(7.945〜8.225)に当たる
  const midW = X.K8_WIN.mid;
  const endP = midW.find((w) => near(w[0], REF.END_POCKET[0], 0.002) && near(w[1], REF.END_POCKET[1], 0.002));
  ok('車端の戸袋窓', !!endP, REF.END_POCKET.join('〜'), endP ? '一致' : 'なし');
}

/* ---- 3. 台車・車輪(軌間と同じ定数から) ------------------------------------ */
{
  for (const [nm, geo, wb] of [['電動車', X.K8GEO.bogieM, REF.WB_M], ['付随車', X.K8GEO.bogieT, REF.WB_T]]) {
    const pts = v4pts(geo);
    // 車輪(半径0.43の円)の中心:z=0.43 の高さで最も外側の頂点群から x を拾う
    const wheelBottom = range(pts, 2)[0];
    ok('車輪がレール面に接する(' + nm + ')', near(wheelBottom, 0, 0.005), '0.000m', wheelBottom.toFixed(3) + 'm');
    // 軸の位置:車輪の円周の頂点(中心から0.43)の x の中心を求める
    const axles = [];
    for (const bx of [-REF.BOGIE_X, REF.BOGIE_X]) for (const s of [-1, 1]) axles.push(bx + s * wb / 2);
    let worst = 0;
    for (const ax of axles) {
      const c = pts.filter((p) => Math.abs(p[0] - ax) <= REF.WHEEL_R + 1e-3 && Math.abs(p[2] - REF.WHEEL_R) <= REF.WHEEL_R + 1e-3 &&
        Math.abs(Math.hypot(p[0] - ax, p[2] - REF.WHEEL_R) - REF.WHEEL_R) < 2e-3);
      if (c.length < 8) { worst = 9; continue; }
    }
    ok('軸距と台車中心(' + nm + ')', worst < 1, '台車中心±' + REF.BOGIE_X + '・軸距' + wb, worst < 1 ? '4軸とも車輪あり' : '車輪が無い軸あり');
    // 車輪の左右位置=レール中心(軌間1372+レール頭幅)/2
    const ys = pts.filter((p) => Math.abs(p[2] - REF.WHEEL_R) < 0.05 && Math.abs(Math.hypot(p[0] - axles[0], p[2] - REF.WHEEL_R) - REF.WHEEL_R) < 2e-3)
      .map((p) => Math.abs(p[1]));
    const yc = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    const want = (X.GAUGE + X.RAIL_W) / 2;
    ok('車輪の左右位置(' + nm + ')', near(yc, want, 0.003), want.toFixed(3) + 'm(軌間1372)', yc.toFixed(3) + 'm');
  }
}

/* ---- 3b. 前面のスカートの切り欠き(利用者指示:スカートの大きさは v4 のまま、切り欠きの深さを v4 の1.2倍) ----
   v4:スカートは上端1.09・下端0.24、切り欠きは上から6割。→ 深さ0.612(下端 z=0.478)。
   切り欠きの幅は 9000系と共通(2026-10-11 利用者指示):上端の半幅=9000系の前掛けの脇(写真 0.55×1.225)−0.10=0.574、
   下へ狭まり下端の幅は上端の0.92倍(半幅0.528)。斜めの縁は「上端に1点・切り欠きの下端に2点」の三角形で測る */
{
  // 明るい(アイボリーの)頂点だけを v4 座標で(スカートの板。連結器・床下の暗い箱を除く)
  const bright = (geo) => { const P = geo.attributes.position.array, C = geo.attributes.color.array, o = [];
    for (let i = 0; i < P.length; i += 3) if (C[i] > 0.5 && C[i + 1] > 0.5) o.push([P[i], -P[i + 2], P[i + 1]]); return o; };
  const sk = bright(X.K8GEO.front.vc).filter((p) => p[0] > 9 && p[2] < 1.1);
  const topRow = sk.filter((p) => Math.abs(p[2] - 1.09) < 1e-4), hwN = Math.min(...topRow.map((p) => Math.abs(p[1])));
  const inN = sk.filter((p) => Math.abs(p[1]) < hwN - 1e-4), zN = inN.length ? Math.max(...inN.map((p) => p[2])) : 0;
  const outer = Math.max(...sk.map((p) => Math.abs(p[1]))), zb = Math.min(...sk.map((p) => p[2]));
  const OPEN_T = 0.55 * 1.225 - 0.10, OPEN_B = OPEN_T * 0.92;
  // 斜めの縁の三角形:頂点の高さが {zN, zN, 1.09}。その zN の頂点のうち内側が切り欠きの下端の半幅
  let hwB = null;
  { const P = X.K8GEO.front.vc.attributes.position.array, C = X.K8GEO.front.vc.attributes.color.array;
    for (let i = 0; i < P.length; i += 9) {
      if (!(C[i] > 0.5 && C[i + 1] > 0.5) || P[i] < 9) continue;
      const v = [0, 1, 2].map((k) => [P[i + 3 * k], -P[i + 3 * k + 2], P[i + 3 * k + 1]]);
      const lo = v.filter((q) => Math.abs(q[2] - zN) < 1e-4), hi = v.filter((q) => Math.abs(q[2] - 1.09) < 1e-4);
      if (lo.length === 2 && hi.length === 1) { const m = Math.min(...lo.map((q) => Math.abs(q[1]))); hwB = hwB === null ? m : Math.min(hwB, m); }
    } }
  ok('スカートの切り欠き', near(hwN, OPEN_T, 0.002) && hwB !== null && near(hwB, OPEN_B, 0.002) && near(zN, 1.09 - 0.6 * 1.2 * 0.85, 0.01),
    '半幅 上0.574・下0.528(×0.92)・下端z0.478', '半幅 上' + hwN.toFixed(3) + '・下' + (hwB === null ? '斜めの縁なし' : hwB.toFixed(3)) + '・下端z' + zN.toFixed(3));
  ok('スカートの大きさ(v4 のまま)', near(zb, 0.24, 0.002) && outer > 1.15 && outer < 1.30, '下端0.24・外端1.2前後', '下端' + zb.toFixed(3) + '・外端' + outer.toFixed(3));
}

/* ---- 3c. 識別灯(通過標識灯)。利用者指示:白の縦長、行先の左と種別の右。各停以外の種別で点く ----
   行先・種別の表示器の位置は前面写真の実測(行先 y −1.16〜−0.54・種別 +0.555〜+1.01・z 3.107〜3.272) */
{
  const DEST = [-1.160, -0.540], KIND = [0.555, 1.010], ROW = [3.107, 3.272];
  const P = v4pts(X.K8GEO.front.pass).filter((p) => p[0] > 9);
  const L = P.filter((p) => p[1] < 0), R = P.filter((p) => p[1] > 0);
  const box = (Q) => [range(Q, 1), range(Q, 2)];
  const bl = box(L), br = box(R);
  const tall = (b) => (b[1][1] - b[1][0]) / Math.max(1e-6, b[0][1] - b[0][0]);
  ok('識別灯:行先の左・種別の右', L.length > 0 && R.length > 0 && bl[0][1] < DEST[0] && bl[0][1] > DEST[0] - 0.08 &&
     br[0][0] > KIND[1] && br[0][0] < KIND[1] + 0.25,
    '左の灯の右端 < ' + DEST[0] + '(8cm以内)・右の灯の左端 > ' + KIND[1] + '(25cm以内)',
    L.length && R.length ? bl[0][1].toFixed(3) + ' / ' + br[0][0].toFixed(3) : '灯が無い');
  ok('識別灯:縦長・表示器と同じ段', L.length > 0 && R.length > 0 && tall(bl) > 2 && tall(br) > 2 &&
     [bl, br].every((b) => b[1][0] >= ROW[0] - 0.01 && b[1][1] <= ROW[1] + 0.01),
    '高さ/幅 > 2・z ' + ROW.join('〜'), L.length && R.length ? tall(bl).toFixed(1) + '/' + tall(br).toFixed(1) + '・z ' + bl[1].map((v) => v.toFixed(3)).join('〜') : '-');
  // 左右の灯は車体の中心線(y=0)に対称(利用者指示):左右の端の |y| が一致
  ok('識別灯:中心線に対称', L.length > 0 && R.length > 0 && Math.abs(bl[0][0] + br[0][1]) < 0.003 && Math.abs(bl[0][1] + br[0][0]) < 0.003,
    '左 [−a,−b]・右 [b,a](3mm以内)', L.length && R.length ? '左 ' + bl[0].map((v) => v.toFixed(3)).join('〜') + '・右 ' + br[0].map((v) => v.toFixed(3)).join('〜') : '-');
  // 点灯条件:先頭(前照灯が点く車)で、種別が各停以外のときだけ点く。基準の判定はここで独立に持つ
  const lamp = (c) => { let m = null; c.traverse((o) => { if (o.geometry === X.K8GEO.front.pass) m = o.material; }); return m; };
  const cases = [['特急', 'head', true], ['急行', 'head', true], ['各停', 'head', false], ['特急', 'tail', false]];
  let bad = null;
  for (const [kind, lights, want] of cases) {
    const c = X.makeCar({ cabF: true, hachi: 1, num: '8714', lights: lights, sign: { kind: kind, dest: '新宿' }, crowd: null });
    const m = lamp(c);
    if (m !== (want ? X.M_PASS : X.M_PASS_OFF) && !bad) bad = kind + '・' + lights + ' → ' + (m === X.M_PASS ? '点灯' : m === X.M_PASS_OFF ? '消灯' : '灯が無い');
  }
  ok('識別灯:各停以外で点く(先頭のみ)', !bad, '特急・急行=点灯/各停・最後尾=消灯', bad || '4通りとも');
  ok('識別灯:点灯は白', X.M_PASS.color.r > 0.9 && X.M_PASS.color.g > 0.9 && X.M_PASS.color.b > 0.9, '白',
    [X.M_PASS.color.r, X.M_PASS.color.g, X.M_PASS.color.b].map((v) => v.toFixed(2)).join(','));
}

/* ---- 4. 冷房装置・パンタグラフ ----------------------------------------------- */
{
  const ac = v4pts(X.K8GEO.ac);
  ok('冷房装置の上端', near(range(ac, 2)[1], REF.AC_TOP), REF.AC_TOP + 'm(公表値)', range(ac, 2)[1].toFixed(3) + 'm');
  ok('冷房装置の長さ', near(range(ac, 0)[1] - range(ac, 0)[0], REF.AC_L), REF.AC_L + 'm', (range(ac, 0)[1] - range(ac, 0)[0]).toFixed(3) + 'm');
  /* 冷房装置の形(2026-10-12 利用者指示で作り直し。屋上集中式):上面の凝縮器のファン(暗い網)の数と、筐体の上面が四方へ
     斜めに落ちていること(上面の端が下の箱の端より 0.2m 以上内) */
  { const G0 = X.K8GEO.ac, P = G0.attributes.position.array, C = G0.attributes.color.array, top = REF.AC_TOP;
    const xs = [];
    for (let i = 0; i < P.length; i += 3) if (C[i] < 0.2 && C[i + 1] < 0.2 && P[i + 1] > top - 0.012) xs.push(P[i]);
    const cl = []; for (const x of xs.sort((a, b) => a - b)) if (!cl.length || x - cl[cl.length - 1][1] > 0.3) cl.push([x, x]); else cl[cl.length - 1][1] = x;
    const pts = v4pts(G0), xb = range(pts.filter((p) => p[2] < top - 0.2), 0), xt = range(pts.filter((p) => Math.abs(p[2] - (top - 0.03)) < 0.002 && Math.abs(p[1]) > 0.6), 0);
    const inset = Math.min(xt[0] - xb[0], xb[1] - xt[1]);
    ok('冷房装置の形(ファン・斜めの端)', cl.length === REF.AC_FANS && inset >= 0.2, 'ファン' + REF.AC_FANS + 'つ・上面の端が0.2m以上内', 'ファン' + cl.length + 'つ・' + inset.toFixed(2) + 'm');
  }

  // 舟体の上面=トロリ線の高さ(すり板が架線に接する)
  const shoe = v4pts(X.K8GEO.panto.shoe);
  const top = range(shoe.filter((p) => Math.abs(p[1]) <= 0.62 + 1e-6), 2)[1];   // 舟体(ホーンを除く)
  ok('すり板が架線に接する', near(top, X.WIRE_TRO, 0.005), X.WIRE_TRO + 'm(トロリ線)', top.toFixed(3) + 'm');
  const K = X.K8GEO.panto.knee;
  ok('ひじは京王八王子方(+x)', K.knee[0] > K.hinge[0], 'ひじx > 付け根x', K.knee[0].toFixed(3) + ' > ' + K.hinge[0].toFixed(3));
  const l1 = Math.hypot(K.knee[0] - K.hinge[0], K.knee[1] - K.hinge[1]);
  const l2 = Math.hypot(K.head[0] - K.knee[0], K.head[1] - K.knee[1]);
  ok('下枠・上枠の長さ(v4)', near(l1, 1.076, 1e-6) && near(l2, 1.34, 1e-6), '1.076 / 1.340m', l1.toFixed(3) + ' / ' + l2.toFixed(3) + 'm');
}

/* ---- 5. 編成:車番・パンタ・灯火・表示(走行列車3本と留置2本) ------------------ */
{
  // 走行列車:下り(dir>0)の先頭 j=0 は京王八王子方=新宿方から10両目
  let badNum = null, badPanto = null, badPos = null, badLight = null;
  for (const t of X.trains) {
    for (let j = 0; j < t.cars.length; j++) {
      const c = t.cars[j], o = c.userData.k8, n = t.dir > 0 ? 10 - j : j + 1;
      const F = Object.values(X.K8_FORMATIONS).concat(Object.values(X.K9_FORMATIONS)).find((f) => f.cars.indexOf(o.num) >= 0);
      if (!F || F.cars.indexOf(o.num) !== n - 1) badNum = badNum || ('列車' + t.dir + ' j=' + j + ' ' + o.num);
      const s9 = o.num[0] === '9';                                  // 車番の千の位で形式を見分ける
      if (s9 !== (o.series === '9000')) badNum = badNum || ('j=' + j + ' ' + o.num + ' の形式が ' + o.series);
      const wantP = (s9 ? REF.PANTO_9731F : REF.PANTO_FROM_SHINJUKU).indexOf(n) >= 0;
      if (o.panto !== wantP) badPanto = badPanto || ('j=' + j + ' 新宿方から' + n + '両目');
      if (o.panto) {
        // パンタは京王八王子方(西)の台車の上:車体ローカルx の符号=進行方向が西なら+
        const px = c.userData.panto.position.x, want = (t.dir > 0 ? 1 : -1) * REF.BOGIE_X;
        if (!near(px, want, 1e-6)) badPos = badPos || ('j=' + j + ' x=' + px);
      }
      const wantL = j === 0 ? 'head' : (j === 9 ? 'tail' : 'off');
      if (o.lights !== wantL) badLight = badLight || ('j=' + j + ' ' + o.lights);
    }
  }
  ok('車番の並び(新宿方から)', badNum === null, '8714F/9731F/8713F の順', badNum || '3本とも一致');
  ok('パンタの車両', badPanto === null, '8000系=2・4・5・8・9/9000系=2・3・5・8・9両目', badPanto || '3本とも一致');
  ok('9731F の車番', JSON.stringify(X.K9_FORMATIONS['9731F'].cars) === JSON.stringify(REF.CARS_9731F),
    REF.CARS_9731F.join(' '), X.K9_FORMATIONS['9731F'].cars.join(' '));
  ok('9000系の編成が走る', X.trains.some((t) => t.cars.every((c) => c.userData.k8.series === '9000')), '1本以上',
    X.trains.filter((t) => t.cars.every((c) => c.userData.k8.series === '9000')).length + '本');
  ok('パンタの位置', badPos === null, '京王八王子方の台車上(±6.88)', badPos || '一致');
  ok('灯火', badLight === null, '先頭=前照灯/最後尾=尾灯', badLight || '3本とも一致');
  // 8714F は実測の編成表どおり
  ok('8714F の車番', JSON.stringify(X.K8_FORMATIONS['8714F'].cars) === JSON.stringify(REF.CARS_8714F),
    REF.CARS_8714F.join(' '), X.K8_FORMATIONS['8714F'].cars.join(' '));
  // 先頭車の灯火は点灯材質、最後尾は尾灯が点く
  const lead = X.trains[0].cars[0], tail = X.trains[0].cars[9];
  const mats = (c) => { const s = new Set(); c.traverse((o) => { if (o.material) s.add(o.material); }); return s; };
  ok('先頭の前照灯が点く', mats(lead).has(X.M_HL) && !mats(lead).has(X.M_TL), '前照灯=点灯/尾灯=消灯',
    (mats(lead).has(X.M_HL) ? '前照灯点灯' : '前照灯消灯') + '・' + (mats(lead).has(X.M_TL) ? '尾灯点灯' : '尾灯消灯'));
  ok('最後尾の尾灯が点く', mats(tail).has(X.M_TL) && !mats(tail).has(X.M_HL), '尾灯=点灯/前照灯=消灯',
    (mats(tail).has(X.M_TL) ? '尾灯点灯' : '尾灯消灯') + '・' + (mats(tail).has(X.M_HL) ? '前照灯点灯' : '前照灯消灯'));
  // 留置車は灯火も表示も消灯。ただし笹塚の3番線にホームで待たせる 9734F(利用者指示)は先頭=前照灯・最後尾=尾灯
  // (向きと表示は⑥が見る)。どの編成かは検証側の車番で見分ける
  const STAND = ['9734', '9034', '9084', '9534', '9134', '9584', '9684', '9234', '9284', '9784'];
  let lit = 0, litS = 0, nS = 0;
  for (const c of X.parkedCars) {
    const on = mats(c).has(X.M_HL) || mats(c).has(X.M_TL);
    if (STAND.indexOf(c.userData.k8.num) >= 0) { nS++; if (on) litS++; } else if (on) lit++;
  }
  ok('留置車は灯火を消す', lit === 0 && nS === 10 && litS === 2, '0両(笹塚の3番線の 9734F は両端の2両が点く)',
    lit + '両(9734F ' + nS + '両のうち ' + litS + '両)');
  // 運転台は編成の外側を向く(最後尾のシェルは180°回す=v4 と同じ)
  const rotOK = X.trains.every((t) => t.cars[0].userData.tail === false && t.cars[9].userData.tail === true);
  ok('運転台が外を向く', rotOK, '先頭=+x/最後尾=180°', rotOK ? X.trains.length + '本とも' : '逆向きあり');
}

/* ---- 5b. 車両の遠景(LOD):遠くでは台車・パンタを描かず、近づけば戻る。車体はいつも描く ----
   基準:1.5km 先の車両は数画素(全体俯瞰で50両ぶんの描画を減らすため。⑫が負荷を測る)。400m 以内は細部まで描く */
{
  const c = X.trains[0].cars[1];
  // 車両の群までの親をたどって、どれかが非表示なら描かれない(スタブの親は車両の群で止める)
  const isOn = (o) => { for (let q = o, k = 0; q && q !== c && k < 8; q = q.parent, k++) if (q.visible === false) return false; return true; };
  const bog = []; c.traverse((o) => { if (o.geometry === X.K8GEO.bogieM || o.geometry === X.K8GEO.bogieT) bog.push(o); });
  const pan = c.userData.panto, body = c.userData.body;
  const at = (d) => { const p = c.position; X.camera.position.set(p.x + d, p.y + 30, p.z); X.lodCar(c);
    return { bog: bog.length > 0 && bog.every(isOn), pan: !pan || isOn(pan), body: isOn(body) }; };
  const save = X.camera.position.clone ? X.camera.position.clone() : { x: X.camera.position.x, y: X.camera.position.y, z: X.camera.position.z };
  const far = at(3000), near = at(300), far2 = at(2000);
  X.camera.position.set(save.x, save.y, save.z); X.lodCar(c);
  ok('遠景で台車・パンタを省く', !far.bog && !far.pan && far.body && !far2.bog, '3km・2km先=台車なし・車体あり',
    '台車' + (far.bog ? 'あり' : 'なし') + '・パンタ' + (far.pan ? 'あり' : 'なし') + '・車体' + (far.body ? 'あり' : 'なし'));
  ok('近づけば台車・パンタが戻る', near.bog && near.pan && near.body, '300m=すべてあり',
    '台車' + (near.bog ? 'あり' : 'なし') + '・パンタ' + (near.pan ? 'あり' : 'なし'));
}

/* ---- 5c. 部品のまとめ(2026-10-11 利用者指示:描画を軽く) -------------------------------------
   1両の中で、同じ材質・同じ近さの段の静止した部品を1つの形にまとめた。基準(検証側が持つ):
   ・1両の Mesh の数の上限(まとめる前の 中間車15・パンタ付き19・先頭車26〜27 から 3〜4 減らした数。先頭車は前照灯と
     識別灯の暈けを含む)
   ・頂点カラーの部品と車内の頂点の集まりが、部品の形(K8GEO/K9GEO)を v4 の組み立て方で置いたものと同じ
     (まとめで部品が欠けた・向きや位置がずれた、を見る)。組み立て方:シェルに付く物(側面の小物・前面のケースと
     頂点カラー・内装・乗客)は最後尾の運転台の車両で y 回りに180°、幌は新宿方の妻(−(車体長/2+0.25))で最後尾の
     運転台の車両には無い、床下・冷房は車体の中心、パンタの台座の小物は京王八王子方へ 5.1m */
{
  const MAXM = { mid: 12, panto: 15, cab: 23 };
  const key = (x, y, z) => x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
  const pts = (geo, rot, dx) => { const P = geo.attributes.position.array, L = [], c = rot ? -1 : 1;
    for (let i = 0; i < P.length; i += 3) L.push(key(c * P[i] + dx, P[i + 1], c * P[i + 2])); return L; };
  // 車両の中の頂点を車体ローカルへ(親をたどる。回転は y 回りの180°だけ)
  const local = (c, mat) => { const L = [];
    c.traverse((o) => { if (!o.isMesh || o.material !== mat) return;
      const chain = []; for (let q = o; q && q !== c; q = q.parent) chain.push(q);
      const P = o.geometry.attributes.position.array;
      for (let i = 0; i < P.length; i += 3) { let x = P[i], y = P[i + 1], z = P[i + 2];
        for (const n of chain) { if (n.rotation && Math.abs(n.rotation.y) > 1e-9) { x = -x; z = -z; } x += n.position.x; y += n.position.y; z += n.position.z; }
        L.push(key(x, y, z)); } });
    return L; };
  const same = (a, b) => { if (a.length !== b.length) return false; a.sort(); b.sort(); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const cars = []; for (const t of X.trains) cars.push(...t.cars); cars.push(...X.parkedCars);
  let badN = null, badG = null, n = 0;
  for (const c of cars) {
    const o = c.userData.k8, G = o.series === '9000' ? X.K9GEO : X.K8GEO, cab = !!(o.cabF || o.cabR), tail = !!o.cabR;
    let m = 0; c.traverse((q) => { if (q.isMesh) m++; });
    const lim = cab ? MAXM.cab : o.panto ? MAXM.panto : MAXM.mid;
    if (m > lim && !badN) badN = [o.num, m + '>' + lim];
    const ev = [].concat(pts(G.sideFit, tail, 0), cab ? pts(G.front.case, tail, 0).concat(pts(G.front.vc, tail, 0)) : [],
      o.cabR ? [] : pts(G.gang, false, -(REF.LEN / 2 + 0.25)), pts(G.under, false, 0), pts(G.ac, false, 0),
      o.panto ? pts(G.pantoBits, false, o.hachi * 5.1) : []);
    const pp = cab ? G.peopleCab : G.people;
    const er = [].concat(pts(cab ? G.roomCab : G.room, tail, 0), o.crowd === null ? [] : pts(pp[(o.crowd | 0) % pp.length], tail, 0));
    n++;
    const av = local(c, X.K8M.vc), ar = local(c, X.K8M.room);
    if (!same(ev, av) && !badG) badG = [o.num, '頂点カラー ' + av.length + '/' + ev.length + '頂点'];
    if (!same(er, ar) && !badG) badG = [o.num, '車内 ' + ar.length + '/' + er.length + '頂点'];
  }
  ok('1両の描画の呼び出し(部品のまとめ)', badN === null && n > 0, '中間車≤' + MAXM.mid + '・パンタ付き≤' + MAXM.panto + '・先頭車≤' + MAXM.cab, badN ? badN.join(' ') : n + '両');
  ok('部品をまとめても形は同じ', badG === null && n > 0, '頂点カラーの部品・車内=部品の形を組み立て方どおりに置いたもの', badG ? badG.join(' ') : n + '両');
}

/* ---- 6. 車両の置き方(レール面・連結面間) -------------------------------------- */
{
  // 車体の原点=レール頭頂面(v4 の z=0)。車輪の下端がレールの上に載る
  const t = X.trains[0];
  const c = t.cars[3];
  const s = t.x - t.dir * 3 * REF.PITCH;
  const want = X.railY(s) + X.RAIL_TOP;
  ok('車体の原点=レール頭頂面', near(c.position.y, want, 0.02), want.toFixed(3) + 'm', c.position.y.toFixed(3) + 'm');
  // 隣の車両との間(連結面間20.0 − 車体長19.5 = 0.5m)
  const a = t.cars[0].position, b = t.cars[1].position;
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  ok('車両の間隔', near(d, REF.PITCH, 0.05), REF.PITCH + 'm', d.toFixed(3) + 'm');
}

/* ---- 7. 扉の開閉(ホーム側の面だけ) ------------------------------------------- */
{
  const c = X.trains[0].cars[4];
  X.setCarDoors(c, 1, 1);
  const U = c.userData.bodyMat.userData.k8.uni.uOpen.value;
  const u1 = [U.x, U.y];
  X.setCarDoors(c, 1, -1);
  const u2 = [U.x, U.y];
  X.setCarDoors(c, 0, 1);
  const u0 = [U.x, U.y];
  ok('開くのは片面だけ', (u1[0] + u1[1] === 1) && (u2[0] + u2[1] === 1) && u1[0] !== u2[0],
    '+z面と−z面で別の面', '+z→' + u1.join('/') + ' −z→' + u2.join('/'));
  ok('閉じると両面とも0', u0[0] === 0 && u0[1] === 0, '0/0', u0.join('/'));
}

/* ---- 出力 ---------------------------------------------------------------------- */
console.log('=== 京王8000系(v4):実ジオメトリ ⇄ 実測値 ===');
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
console.log(pad('項目', 30) + pad('期待', 34) + pad('実測', 36) + '判定');
for (const r of rows) console.log(pad(r[0], 30) + pad(r[1], 34) + pad(r[2], 36) + r[3]);
console.log(ng ? '\nRESULT: FAIL(' + ng + '項目NG)' : '\nRESULT: PASS');
process.exit(ng ? 1 : 0);
