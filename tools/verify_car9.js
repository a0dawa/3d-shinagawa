// 京王9000系:生成された"実ジオメトリ"を測って公表諸元と照合する。⑭
//
//   9000系は 8000系(v4)と同じ作り(諸元表 K9 → 断面・前面の平面形・開口の一覧 → 幾何と塗り分け)。
//   ここでは出来上がった頂点・部品の位置を、公表諸元と公表の説明に照らす:
//     車体長19,500・車体幅2,768・床面高さ1,130・屋根高さ3,620・冷房装置上面4,017・天井高さ2,270・
//     前面は上から見て半径10,000mm の曲面・中央に幅610mm の非常扉・扉間に窓2枚(戸袋窓なし)・
//     行先表示器は中央扉の上・車号は向かって右の窓の上・前照灯と尾灯は前面の下部
//   塗り分け(帯・窓・前面の黒)はシェーダなので頂点には現れない。それは⑮で見る。
//   基準値はすべて下の REF で持つ(reference/keio9000/measured_9000.md)。HTML から読まない。
//   使い方: node tools/verify_car9.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'K9GEO:K9GEO,K9_WIN:K9_WIN,K9_FORMATIONS:K9_FORMATIONS,trains:trains,WIRE_TRO:WIRE_TRO,' +
  'makeCar:makeCar,M_PASS:M_PASS,M_PASS_OFF:M_PASS_OFF');

const REF = {
  LEN: 19.5, HWB: 2.768 / 2,                 // 車体長・車体半幅(公表)
  Z_FLR: 1.130, ROOF: 3.620,                 // 床面高さ・屋根高さ(公表)
  AC_FANS: 1,                                 // 冷房装置の凝縮器のファンの数(ファン1つの形。2026-10-12)
  AC_TOP: 4.017, CEIL_H: 2.270,              // 冷房装置上面・天井高さ(公表)
  NOSE_R: 10.0, NOSE_R_TOL: 1.0,             // 前面の平面の半径(公表10,000mm)・許容
  FDOOR_W: 0.610,                            // 中央の非常扉の幅(公表)
  DOORX: [-7.05, -2.35, 2.35, 7.05], DOOR_W: 1.30,   // 客用扉の中心と幅(ホームドアの開口と揃う)
  WIN_PER_GAP: 2,                            // 扉間の窓の数(公表の説明:扉間に窓2枚)
  // 前面(写真の実測 ftex9.png の高さを、屋根 3.62 基準で 1.06 倍に直した値。measured_9000.md 3b)
  LAMP_Z: [1.43, 1.624],                     // 前照灯・尾灯は前面の青帯の中
  SKIRT_OUT: 0.93 * 1.225,                   // スカートの外端 |y|(写真の実測0.93 の1.225倍。利用者指示)
  // スカートの中央の開口(2026-10-11 利用者指示):上端の半幅=前掛けの脇(写真 0.55×1.225)−0.10、下端は上端の0.92倍。
  // 高さは measured_9000.md 3b:脇の板の上端 0.906・前掛けの上端 0.366
  SKIRT_OPEN: [0.55 * 1.225 - 0.10, 0.92], SKIRT_ZT: 0.906, SKIRT_ZB: 0.366,
  // 前面の横の位置(利用者指示 2026-10-11:写真の実測から 扉の幅+10cm・行先表示器+15cm・前照灯の間隔+20cm・識別灯の間隔+40cm。
  // measured_9000.md 3b の「利用者指示の微修正」)
  DEST_HALF: [0.21 * 1.15 + 0.05, 0.0795 * 1.15],    // 行先表示板の半幅・半高(写真の実測を表示板ごと1.15倍、さらに幅+15cm−5cm)
  KIND_Y: [0.61, 0.99], NUM_Y: [0.71, 1.05], // 種別(向かって左)・車号(右)の |y|(写真の実測から外へ0.10ずつ=間隔+20cm)
  DOOR_R: 0.035,                             // 戸の縁の上の角の半径(小さな角丸。写真 9755)
  WIPER: [0.88, 1.92, 0.49, 2.52],           // ワイパーの付け根 |y|・z と先 |y|・z(付け根は窓の下の外寄り、内の上へ。写真 9755)
  LOGO: [0.71, 1.17, 1.752, 1.888],          // KEIO ロゴの板の外接矩形 |y|・z(白い平行四辺形の板。赤帯の上端にまたがる。写真 9755 の遠近を直した値)
  FDOOR_EDGE: [0.31, 0.40],                  // 中央扉の戸の縁・枠の外縁の縦の線 |y|(写真の実測 0.26・0.35 から扉の幅+10cm)
  FDOOR_W_TOL: 0.015,                        // 戸の幅(2×戸の縁)と公表 610mm の差の許容
  LAMP_CASE: [0.67, 1.10], HL_Y: [0.71, 0.88], TL_Y: [0.93, 1.09],   // 灯火のケース・前照灯・尾灯の |y|(写真の実測から外へ0.10ずつ)
  PASS_Y: [1.17, 1.23],                      // 識別灯の |y|(写真の灰の縦長の灯から中心線に対称、間隔+40cm)
  KIND_Z: [3.111, 3.323],                    // 種別表示器の高さ(写真の実測)。車号はこれと同じ高さ(中心)へ(利用者指示)
  // 側面(写真 9736・9036 の実測。measured_9000.md 3c)
  WIN: [0.035, 0.938], WIN_Z: [1.924, 2.845],   // 2枚1組の窓:扉間の中心の大きな窓の中央の柱の半幅・外枠の半幅(利用者指摘:大きな窓の中央に柱)・上下
  DWIN: [0.113, 0.540], DWIN_Z: [1.890, 2.884], // 扉窓(扉の中心から)・上下
  END_WIN: [8.49, 9.395],                    // 車端の窓(先頭車は運転台と反対の端、中間車は両端)
  CREW_WIN: [8.584, 8.917, 1.979, 2.778],    // 乗務員扉の窓
  Z_BOT: 0.972, Z_SIDE_TOP: 3.338,           // すそ・側面の上端(雨どいの下)
  NOSE_END: 9.496,                           // 前面の角が側面の平面に着く x(側面写真2枚の輪郭に2画素以内で合わせ、中央は R10m)
  HANDRAIL: [9.063, 8.467, 1.292, 2.459],    // 乗務員扉の前後の手すり u と上下
  NUM_Z: [2.713, 2.832],                     // 側面の車号の高さ(窓の上端の高さ)
  CAB_LOGO: [7.82, 8.38, 2.64, 2.79],        // 運転台側の KEIO(X・z)
  TOL: 0.005,
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']); }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? REF.TOL : t);
function v4pts(geo) {                         // Three.js(x,上,左右)→ v4(x, y=−z, z=上)
  const P = geo.attributes.position.array, out = [];
  for (let i = 0; i < P.length; i += 3) out.push([P[i], -P[i + 2], P[i + 1]]);
  return out;
}
const range = (pts, k) => { let lo = 1e9, hi = -1e9; for (const p of pts) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; } return [lo, hi]; };
const G = X.K9GEO;

/* ---- 1. 車体(公表諸元) ---- */
{
  const mid = v4pts(G.shell), cab = v4pts(G.shellCab);
  const xr = range(mid, 0), yr = range(mid, 1), zr = range(mid, 2);
  ok('車体長', near(xr[1] - xr[0], REF.LEN), REF.LEN + 'm', (xr[1] - xr[0]).toFixed(3) + 'm');
  ok('車体幅', near(yr[1], REF.HWB, 6e-4) && near(-yr[0], REF.HWB, 6e-4), (2 * REF.HWB).toFixed(3) + 'm(公表 1mm 単位)', (yr[1] - yr[0]).toFixed(3) + 'm');
  ok('屋根高さ', near(zr[1], REF.ROOF), REF.ROOF + 'm', zr[1].toFixed(3) + 'm');
  // 床面:垂直な側面(|y|=半幅)の下端=扉の下端の線
  const hwm = Math.max(yr[1], -yr[0]), side = mid.filter((p) => Math.abs(Math.abs(p[1]) - hwm) < 1e-4);
  ok('床面高さ(側面の下端)', near(range(side, 2)[0], REF.Z_FLR), REF.Z_FLR + 'm', range(side, 2)[0].toFixed(3) + 'm');
  ok('先頭車の後端', near(range(cab, 0)[0], -REF.LEN / 2), -REF.LEN / 2, range(cab, 0)[0].toFixed(3));
  // 前面の平面の半径:前面の垂直な部分(z=2.44 の断面)で、中心と |y|≤0.7 の点から y²/(2Δx)
  const row = cab.filter((p) => Math.abs(p[2] - 2.44) < 1e-4 && p[0] > 9);
  const x0 = row.filter((p) => Math.abs(p[1]) < 1e-6).map((p) => p[0])[0];
  const Rs = row.filter((p) => Math.abs(p[1]) > 0.3 && Math.abs(p[1]) <= 0.7).map((p) => p[1] * p[1] / (2 * (x0 - p[0])));
  const R = Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : 0;
  ok('前面の平面の半径', Math.abs(R - REF.NOSE_R) <= REF.NOSE_R_TOL, REF.NOSE_R + '±' + REF.NOSE_R_TOL + 'm(公表10,000mm)', R.toFixed(2) + 'm(' + Rs.length + '点)');
  ok('冷房装置の上端', near(range(v4pts(G.ac), 2)[1], REF.AC_TOP), REF.AC_TOP + 'm(公表)', range(v4pts(G.ac), 2)[1].toFixed(3) + 'm');
  /* 冷房装置の形(2026-10-12 利用者指示で作り直し。屋上集中式):上面の凝縮器のファン(暗い網)の数と、筐体の上面が四方へ
     斜めに落ちていること(上面の端が下の箱の端より 0.2m 以上内) */
  { const G0 = G.ac, P = G0.attributes.position.array, C = G0.attributes.color.array, top = REF.AC_TOP;
    const xs = [];
    for (let i = 0; i < P.length; i += 3) if (C[i] < 0.2 && C[i + 1] < 0.2 && P[i + 1] > top - 0.012) xs.push(P[i]);
    const cl = []; for (const x of xs.sort((a, b) => a - b)) if (!cl.length || x - cl[cl.length - 1][1] > 0.3) cl.push([x, x]); else cl[cl.length - 1][1] = x;
    const pts = v4pts(G0), xb = range(pts.filter((p) => p[2] < top - 0.2), 0), xt = range(pts.filter((p) => Math.abs(p[2] - (top - 0.03)) < 0.002 && Math.abs(p[1]) > 0.6), 0);
    const inset = Math.min(xt[0] - xb[0], xb[1] - xt[1]);
    ok('冷房装置の形(ファン・斜めの端)', cl.length === REF.AC_FANS && inset >= 0.2, 'ファン' + REF.AC_FANS + 'つ・上面の端が0.2m以上内', 'ファン' + cl.length + 'つ・' + inset.toFixed(2) + 'm');
  }

  // 天井の下面=床面+天井高さ(車内の幾何に、その高さの頂点がある)
  const room = v4pts(G.room), ceil = REF.Z_FLR + REF.CEIL_H;
  ok('天井高さ', room.some((p) => near(p[2], ceil, 1e-3)), '床面+' + REF.CEIL_H + 'm', room.some((p) => near(p[2], ceil, 1e-3)) ? '頂点あり' : '無い');
  // 側面写真:すそと側面の上端(垂直な側面の上下)
  ok('すそ(車体の下端)', near(zr[0], REF.Z_BOT, 0.006), REF.Z_BOT + 'm(写真)', zr[0].toFixed(3) + 'm');
  ok('側面の上端(雨どいの下)', near(range(side, 2)[1], REF.Z_SIDE_TOP, 0.006), REF.Z_SIDE_TOP + 'm(写真)', range(side, 2)[1].toFixed(3) + 'm');
  // 前面の角:窓の高さの断面で、側面の平面(|y|=半幅)に着く所の x(写真の輪郭に合わせた形)
  const end = row.filter((p) => Math.abs(Math.abs(p[1]) - hwm) < 1e-4).map((p) => p[0]);
  const xe = end.length ? Math.max(...end) : 0;
  ok('前面の角の終わり', near(xe, REF.NOSE_END, 0.01), 'x ' + REF.NOSE_END + '(側面写真の輪郭)', 'x ' + xe.toFixed(3));
}

/* ---- 2. 側面の開口:扉間に窓2枚・戸袋窓なし ---- */
{
  for (const [nm, W] of [['中間車', X.K9_WIN.mid], ['先頭車', X.K9_WIN.cab]]) {
    // 側面写真の位置と上下(2枚1組の窓・扉窓・車端の窓)
    const t = 0.006, side = W.filter((w) => w[6] === 0 && Math.abs((w[0] + w[1]) / 2) < 7.5), dws = W.filter((w) => w[6] === 2);
    const ends = W.filter((w) => w[6] === 0 && Math.abs((w[0] + w[1]) / 2) > 7.5);
    // 扉間の中心ごとに大きな窓が1つ(外枠 ±WIN[1])、その中央を柱(半幅 WIN[0]=窓の一覧の8番目)が通る
    const okWin = side.length === 3 && [4.70, 0, -4.70].every((g) => side.some((w) => near((w[0] + w[1]) / 2, g, t) &&
      near((w[1] - w[0]) / 2, REF.WIN[1], t) && near(w[7] || 0, REF.WIN[0], t) && near(w[2], REF.WIN_Z[0], t) && near(w[3], REF.WIN_Z[1], t)));
    ok('2枚1組の窓=大きな窓の中央に柱(' + nm + ')', okWin, '扉間の中心ごとに外枠 ±' + REF.WIN[1] + '・柱 ±' + REF.WIN[0] + '・z ' + REF.WIN_Z.join('〜') + '(写真)',
      side.length + '個 ' + (side[0] ? side[0].slice(0, 4).map((v) => v.toFixed(3)).join('/') + '・柱' + (side[0][7] || 0) : ''));
    const okD = dws.length === 8 && dws.every((w) => { const d = REF.DOORX.reduce((a, b) => Math.abs(b - (w[0] + w[1]) / 2) < Math.abs(a - (w[0] + w[1]) / 2) ? b : a);
      const lo = Math.min(Math.abs(w[0] - d), Math.abs(w[1] - d)), hi = Math.max(Math.abs(w[0] - d), Math.abs(w[1] - d));
      return near(lo, REF.DWIN[0], t) && near(hi, REF.DWIN[1], t) && near(w[2], REF.DWIN_Z[0], t) && near(w[3], REF.DWIN_Z[1], t); });
    ok('扉窓(' + nm + ')', okD, '扉の中心から ' + REF.DWIN.join('〜') + '・z ' + REF.DWIN_Z.join('〜') + '(写真)', dws.length + '枚');
    const wantEnds = nm === '中間車' ? [-1, 1] : [-1];
    const okE = ends.length === wantEnds.length && wantEnds.every((s) => ends.some((w) => near(Math.min(Math.abs(w[0]), Math.abs(w[1])), REF.END_WIN[0], t) &&
      near(Math.max(Math.abs(w[0]), Math.abs(w[1])), REF.END_WIN[1], t) && Math.sign(w[0] + w[1]) === s));
    ok('車端の窓(' + nm + ')', okE, (nm === '中間車' ? '両端' : '運転台と反対の端') + ' ' + REF.END_WIN.join('〜') + '(写真)', ends.length + '枚');
    if (nm === '先頭車') {
      const cw = W.find((w) => w[6] === 3);
      ok('乗務員扉の窓', cw && REF.CREW_WIN.every((v, i) => near(cw[i], v, t)), REF.CREW_WIN.join('/') + '(写真)', cw ? cw.slice(0, 4).join('/') : '無い');
    }
    let bad = null;
    if (W.some((w) => w[6] === 1)) bad = '戸袋窓がある';
    // 戸袋=開いた戸が滑り込む外板の内側(開口の外 DOOR_W/2)。そこに窓があれば戸が透けて見える
    for (const d of REF.DOORX) for (const sg of [-1, 1]) {
      const a = d + sg * REF.DOOR_W / 2, b = d + sg * REF.DOOR_W, lo = Math.min(a, b), hi = Math.max(a, b);
      if (W.some((w) => w[6] === 0 && w[1] > lo + 1e-6 && w[0] < hi - 1e-6) && !bad) bad = '扉 ' + d + ' の戸袋に窓';
    }
    ok('戸袋窓なし(' + nm + ')', bad === null, '戸袋の位置に窓が無い', bad || '無い');
    let badN = null;
    for (let i = 0; i < REF.DOORX.length - 1; i++) {
      const a = REF.DOORX[i] + REF.DOOR_W / 2, b = REF.DOORX[i + 1] - REF.DOOR_W / 2;
      const n = W.filter((w) => w[6] === 0 && w[0] >= a && w[1] <= b).reduce((s, w) => s + ((w[7] || 0) > 0 ? 2 : 1), 0);   // 柱で分かれた2枚を数える
      if (n !== REF.WIN_PER_GAP && !badN) badN = '扉 ' + REF.DOORX[i] + '〜' + REF.DOORX[i + 1] + ' に ' + n + '枚';
    }
    ok('扉間の窓(' + nm + ')', badN === null, REF.WIN_PER_GAP + '枚ずつ', badN || '全て' + REF.WIN_PER_GAP + '枚');
    // 扉窓は扉の中心の左右(扉の位置がホームドアと揃う)
    const dw = W.filter((w) => w[6] === 2);
    const badD = REF.DOORX.some((d) => dw.filter((w) => Math.abs((w[0] + w[1]) / 2 - d) < REF.DOOR_W / 2).length !== 2);
    ok('扉の位置(' + nm + ')', !badD && dw.length === 8, '4扉×2枚の扉窓', dw.length + '枚');
  }
}

/* ---- 3. 前頭部:中央の非常扉・表示器・車号・灯火 ---- */
{
  const F = G.front;
  // 明るい(アイボリーの)頂点だけを v4 座標で(スカートの板。連結器・床下の暗い箱を除く)
  const bright = (geo) => { const P = geo.attributes.position.array, C = geo.attributes.color.array, o = [];
    for (let i = 0; i < P.length; i += 3) if (C[i] > 0.5 && C[i + 1] > 0.5) o.push([P[i], -P[i + 2], P[i + 1]]); return o; };
  const sk = bright(F.vc).filter((p) => p[0] > 9 && p[2] < 1.07), so = Math.max(...sk.map((p) => Math.abs(p[1])));
  ok('スカートの幅', near(so, REF.SKIRT_OUT, 0.003), '外端|y| ' + REF.SKIRT_OUT.toFixed(3) + 'm', so.toFixed(3) + 'm');
  { // 中央の開口:上端(脇の板の上端)の内の縁・下端(前掛けの上端)の内の縁。開口の中(高さの間・内の縁より内)に板の頂点が無い
    const oT = REF.SKIRT_OPEN[0], oB = oT * REF.SKIRT_OPEN[1];
    const at = (z) => sk.filter((p) => Math.abs(p[2] - z) < 0.003 && Math.abs(p[1]) > 0.2).map((p) => Math.abs(p[1]));
    const yT = Math.min(...at(REF.SKIRT_ZT)), yB = Math.max(...sk.filter((p) => Math.abs(p[2] - REF.SKIRT_ZB) < 0.003 && Math.abs(p[1]) < oT - 0.01).map((p) => Math.abs(p[1])));
    const inn = sk.filter((p) => p[2] > REF.SKIRT_ZB + 0.01 && p[2] < REF.SKIRT_ZT - 0.01 && Math.abs(p[1]) < oB - 0.01).length;
    ok('スカートの中央の開口', near(yT, oT, 0.003) && near(yB, oB, 0.003) && inn === 0,
      '半幅 上' + oT.toFixed(3) + '・下' + oB.toFixed(3) + '(×0.92)・中は空き', '上' + yT.toFixed(3) + '・下' + yB.toFixed(3) + '・中の頂点' + inn);
  }
  { const d = v4pts(F.dest), y = range(d, 1), z = range(d, 2);
    ok('行先表示板の大きさ', near((y[1] - y[0]) / 2, REF.DEST_HALF[0], 0.002) && near((z[1] - z[0]) / 2, REF.DEST_HALF[1], 0.002),
      '半幅' + REF.DEST_HALF[0].toFixed(3) + '・半高' + REF.DEST_HALF[1].toFixed(4), '半幅' + ((y[1] - y[0]) / 2).toFixed(3) + '・半高' + ((z[1] - z[0]) / 2).toFixed(4)); }
  // 非常扉の縁(ガラス域の中の縦の枠):前面の部品のうち高さ1m を超える細長い三角形が縦の枠
  const all = v4pts(F.vc), vc = [];
  for (let i = 0; i + 2 < all.length; i += 3) {
    const t = [all[i], all[i + 1], all[i + 2]], zz = t.map((p) => p[2]);
    if (Math.max(...zz) - Math.min(...zz) > 1.0 && t.every((p) => p[0] > 9 && p[2] > 1.5)) vc.push(...t);
  }
  // 縦の線は幅1.2cm の帯なので、|y| の4つの値(戸の縁の線の内と外・枠の外縁の線の内と外)から線の中心を出す
  const ys = [...new Set(vc.map((p) => Math.abs(p[1]).toFixed(4)))].map(Number).sort((a, b) => a - b);
  const e0 = ys.length === 4 ? (ys[0] + ys[1]) / 2 : 0, e1 = ys.length === 4 ? (ys[2] + ys[3]) / 2 : 0, E = REF.FDOOR_EDGE;
  ok('中央の非常扉の縁と幅', near(e0, E[0], 0.003) && near(e1, E[1], 0.003) && Math.abs(2 * e0 - REF.FDOOR_W) <= REF.FDOOR_W_TOL,
    '戸の縁 ±' + E[0] + '・枠の外縁 ±' + E[1] + '・戸の幅≈公表' + REF.FDOOR_W + 'm',
    ys.length === 4 ? '±' + e0.toFixed(3) + '・±' + e1.toFixed(3) + '・戸の幅' + (2 * e0).toFixed(3) + 'm' : '線が' + ys.length + '本');
  const dest = v4pts(F.dest), num = v4pts(F.num);
  const dy = range(dest, 1), dz = range(dest, 2), ny = range(num, 1), nz = range(num, 2);
  // 扉の列=左右の前面窓の間(枠の外縁 E[1] より内)
  ok('行先表示器は中央扉の上', dy[0] >= -E[1] && dy[1] <= E[1] && dz[0] >= 3.0,
    '|y|≤' + E[1] + '(扉の枠の内)・z≥3.0', 'y ' + dy[0].toFixed(2) + '〜' + dy[1].toFixed(2) + '・z ' + dz[0].toFixed(2));
  ok('車号は向かって右の窓の上部', ny[0] > E[1] && nz[0] >= 3.0,
    'y>' + E[1] + '(向かって右=+y)・z≥3.0', 'y ' + ny[0].toFixed(2) + '〜' + ny[1].toFixed(2) + '・z ' + nz[0].toFixed(2));
  const kd = v4pts(F.kind), ky = range(kd, 1), kz = range(kd, 2);
  ok('種別と車号の位置', near(-ky[1], REF.KIND_Y[0], 0.003) && near(-ky[0], REF.KIND_Y[1], 0.003) && near(ny[0], REF.NUM_Y[0], 0.003) && near(ny[1], REF.NUM_Y[1], 0.003),
    '種別 y −' + REF.KIND_Y[1] + '〜−' + REF.KIND_Y[0] + '・車号 ' + REF.NUM_Y.join('〜') + '(間隔+20cm)',
    '種別 ' + ky.map((v) => v.toFixed(3)).join('〜') + '・車号 ' + ny.map((v) => v.toFixed(3)).join('〜'));
  // 戸の縁の上の角は円弧(利用者指示:小さな半径の角丸)。角の4分の1の範囲の頂点が、円弧の中心から 半径±線の半幅 にある
  { const r = REF.DOOR_R, y0 = E[0], zt = 3.026, w = 0.0065;
    const okC = [-1, 1].every((s) => { const q = all.filter((p) => p[0] > 9 && s * p[1] > y0 - r - 1e-6 && s * p[1] < y0 + 0.01 && p[2] > zt - r - 1e-6 && p[2] < zt + 0.01);
      return q.length >= 8 && q.every((p) => { const d = Math.hypot(s * p[1] - (y0 - r), p[2] - (zt - r)); return d > r - w && d < r + w; }); });
    ok('扉の上の角は丸い', okC, '戸の縁の上の角が半径 ' + r + 'm の円弧(左右とも)', okC ? '円弧' : '角が尖る/線が無い'); }
  { const kc = (REF.KIND_Z[0] + REF.KIND_Z[1]) / 2, nc = (nz[0] + nz[1]) / 2;
    ok('車号は種別と同じ高さ', Math.abs(nc - kc) <= 0.01 && ny[0] >= 0.60,
      '中心 z' + kc.toFixed(2) + '±0.01・写真(左端0.58)より右', '中心 z' + nc.toFixed(3) + '・左端' + ny[0].toFixed(3)); }
  // 識別灯(利用者指示:白の縦長、種別の左と車号の右。各停以外の種別で点く)
  { const P = v4pts(F.pass).filter((p) => p[0] > 9), L = P.filter((p) => p[1] < 0), R = P.filter((p) => p[1] > 0);
    const bl = [range(L, 1), range(L, 2)], br = [range(R, 1), range(R, 2)];
    const tall = (b) => (b[1][1] - b[1][0]) / Math.max(1e-6, b[0][1] - b[0][0]);
    ok('識別灯:中心線に対称', L.length > 0 && R.length > 0 && Math.abs(bl[0][0] + br[0][1]) < 0.003 && Math.abs(bl[0][1] + br[0][0]) < 0.003,
      '左 [−a,−b]・右 [b,a](3mm以内)', L.length && R.length ? '左 ' + bl[0].map((v) => v.toFixed(3)).join('〜') + '・右 ' + br[0].map((v) => v.toFixed(3)).join('〜') : '-');
    const PY = REF.PASS_Y;
    ok('識別灯:種別の左・車号の右', L.length > 0 && R.length > 0 && bl[0][1] < ky[0] && br[0][0] > ny[1] &&
       near(-bl[0][1], PY[0], 0.003) && near(-bl[0][0], PY[1], 0.003) && near(br[0][0], PY[0], 0.003) && near(br[0][1], PY[1], 0.003),
      '|y| ' + PY.join('〜') + '(間隔+40cm)・左の灯 < 種別・右の灯 > 車号',
      L.length && R.length ? '左 ' + bl[0].map((v) => v.toFixed(3)).join('〜') + '・右 ' + br[0].map((v) => v.toFixed(3)).join('〜') + '(種別の左端' + ky[0].toFixed(2) + '・車号の右端' + ny[1].toFixed(2) + ')' : '灯が無い');
    ok('識別灯:縦長・種別と同じ段', L.length > 0 && R.length > 0 && tall(bl) > 2 && tall(br) > 2 &&
       [bl, br].every((b) => b[1][0] >= REF.KIND_Z[0] - 0.01 && b[1][1] <= REF.KIND_Z[1] + 0.01),
      '高さ/幅 > 2・z ' + REF.KIND_Z.join('〜'), L.length && R.length ? tall(bl).toFixed(1) + '/' + tall(br).toFixed(1) : '-');
    const lamp = (c) => { let m = null; c.traverse((o) => { if (o.geometry === F.pass) m = o.material; }); return m; };
    let bad = null;
    for (const [kind, lights, want] of [['特急', 'head', true], ['快速', 'head', true], ['各停', 'head', false], ['特急', 'tail', false]]) {
      const m = lamp(X.makeCar({ cabF: true, hachi: 1, num: '9731', series: '9000', lights: lights, sign: { kind: kind, dest: '新宿' }, crowd: null }));
      if (m !== (want ? X.M_PASS : X.M_PASS_OFF) && !bad) bad = kind + '・' + lights + ' → ' + (m === X.M_PASS ? '点灯' : m === X.M_PASS_OFF ? '消灯' : '灯が無い');
    }
    ok('識別灯:各停以外で点く(先頭のみ)', !bad, '特急・快速=点灯/各停・最後尾=消灯', bad || '4通りとも'); }
  ok('種別表示器は向かって左の窓の上部', ky[1] < -E[1] && kz[0] >= 3.0,
    'y<−' + E[1] + '・z≥3.0', 'y ' + ky[0].toFixed(2) + '〜' + ky[1].toFixed(2) + '・z ' + kz[0].toFixed(2));
  const hl = v4pts(F.hl), tl = v4pts(F.tl), lz = REF.LAMP_Z;
  const inBand = (P) => range(P, 2)[0] >= lz[0] - 1e-6 && range(P, 2)[1] <= lz[1] + 1e-6;
  ok('前照灯・尾灯は青帯の中', inBand(hl) && inBand(tl) && range(hl, 0)[0] > 9,
    'z ' + lz.join('〜') + '・前面', range(hl, 2).map((v) => v.toFixed(3)).join('〜') + ' / ' + range(tl, 2).map((v) => v.toFixed(3)).join('〜'));
  // 灯火は内=前照灯・外=尾灯(8000系と同じ並び)
  ok('前照灯が内・尾灯が外', range(hl.map((p) => [Math.abs(p[1])]), 0)[1] <= range(tl.map((p) => [Math.abs(p[1])]), 0)[0] + 1e-6,
    '前照灯の外端≤尾灯の内端', range(hl.map((p) => [Math.abs(p[1])]), 0)[1].toFixed(2) + ' ≤ ' + range(tl.map((p) => [Math.abs(p[1])]), 0)[0].toFixed(2));
  // 左右それぞれの |y| の範囲(利用者指示:前照灯の間隔+20cm。ケースごと外へ)
  { const ay = (P, sg) => range(P.filter((p) => Math.sign(p[1]) === sg).map((p) => [Math.abs(p[1])]), 0);
    const cs = v4pts(F.case), C = REF.LAMP_CASE, H = REF.HL_Y, T = REF.TL_Y, t = 0.003;
    const okL = [-1, 1].every((sg) => { const a = ay(hl, sg), b = ay(tl, sg), c = ay(cs, sg);
      return near(a[0], H[0], t) && near(a[1], H[1], t) && near(b[0], T[0], t) && near(b[1], T[1], t) && near(c[0], C[0], t) && near(c[1], C[1], t); });
    ok('前照灯・尾灯の位置', okL, '前照灯 |y| ' + H.join('〜') + '・尾灯 ' + T.join('〜') + '・ケース ' + C.join('〜') + '(左右とも)',
      [-1, 1].map((sg) => (sg < 0 ? '左 ' : '右 ') + ay(hl, sg).map((v) => v.toFixed(3)).join('〜') + '/' + ay(tl, sg).map((v) => v.toFixed(3)).join('〜')).join(' ')); }
}

/* ---- 3a. ワイパーと KEIO ロゴ(写真 9755) ---- */
{
  const F = G.front, W = REF.WIPER;
  // ワイパー:前面の部品のうち、窓の内縁(0.42)より外・z 1.88〜2.6 の頂点。いちばん下は付け根(外寄り)、いちばん上は先(内寄り)
  const okW = [-1, 1].map((s) => { const q = v4pts(F.vc).filter((p) => p[0] > 9 && s * p[1] > 0.42 && s * p[1] < 0.95 && p[2] > 1.88 && p[2] < 2.6);
    if (q.length < 20) return null;
    const lo = q.reduce((a, b) => (b[2] < a[2] ? b : a)), hi = q.reduce((a, b) => (b[2] > a[2] ? b : a));
    return [s * lo[1], lo[2], s * hi[1], hi[2]]; });
  const goodW = okW.every((v) => v && Math.abs(v[0] - W[0]) < 0.03 && Math.abs(v[1] - W[1]) < 0.03 && Math.abs(v[2] - W[2]) < 0.03 && Math.abs(v[3] - W[3]) < 0.03);
  ok('ワイパーは外の下から内の上へ', goodW, '付け根 |y|' + W[0] + '・z' + W[1] + ' → 先 |y|' + W[2] + '・z' + W[3] + '(±3cm・左右とも)',
    okW.map((v) => (v ? '|y|' + v[0].toFixed(2) + '・z' + v[1].toFixed(2) + '→|y|' + v[2].toFixed(2) + '・z' + v[3].toFixed(2) : '無い')).join(' / '));
  const lg = v4pts(F.logo), ly = range(lg, 1), lz = range(lg, 2), Lg = REF.LOGO;
  ok('KEIO ロゴの板の位置', near(ly[0], Lg[0], 0.003) && near(ly[1], Lg[1], 0.003) && near(lz[0], Lg[2], 0.003) && near(lz[1], Lg[3], 0.003),
    '|y| ' + Lg[0] + '〜' + Lg[1] + '・z ' + Lg[2] + '〜' + Lg[3] + '(赤帯の上端 1.833 にまたがる)', '|y| ' + ly.map((v) => v.toFixed(3)).join('〜') + '・z ' + lz.map((v) => v.toFixed(3)).join('〜'));
}

/* ---- 3b. 乗務員扉の手すりは埋め込み式(利用者指示:正面から見えない)。運転台の細部に車体幅の外へ出る頂点が無く、
   扉の前後(写真 u 9.07・8.476)にくぼみがあること ---- */
{
  const D = v4pts(G.detailCab).filter((p) => p[0] > 8.2 && p[0] < 9.4 && p[2] > 1.0 && p[2] < 2.75);
  const out = D.filter((p) => Math.abs(p[1]) > REF.HWB + 0.003);
  const H = REF.HANDRAIL, at = (u) => D.filter((p) => Math.abs(p[0] - u) < 0.03 && Math.abs(Math.abs(p[1]) - REF.HWB) < 0.006);
  const zr2 = (P) => P.length ? range(P, 2) : [0, 0], f = at(H[0]), r = at(H[1]);
  const okZ = [f, r].every((P) => P.length && near(zr2(P)[0], H[2], 0.006) && near(zr2(P)[1], H[3], 0.006));
  ok('乗務員扉の手すりは埋め込み', out.length === 0 && f.length > 0 && r.length > 0 && okZ, '車体幅+3mm の外に出ない・u ' + H[0] + '・' + H[1] + '・z ' + H[2] + '〜' + H[3] + '(写真)',
    out.length ? '外へ ' + (Math.max(...out.map((p) => Math.abs(p[1]))) - REF.HWB).toFixed(4) + 'm 出る' : (f.length && r.length ? 'z ' + zr2(f).map((v) => v.toFixed(3)).join('〜') : 'くぼみが無い'));
}
/* ---- 3c. 側面の車号と運転台側の KEIO は窓の上端の高さ(写真。幕板ではない) ---- */
{
  const pl = v4pts(G.plate), lg = v4pts(G.cabLogo || G.plate);
  ok('側面の車号の高さ', near(range(pl, 2)[0], REF.NUM_Z[0], 0.01) && near(range(pl, 2)[1], REF.NUM_Z[1], 0.01),
    'z ' + REF.NUM_Z.join('〜') + '(写真)', 'z ' + range(pl, 2).map((v) => v.toFixed(3)).join('〜'));
  const C = REF.CAB_LOGO;
  ok('運転台側の KEIO', !!G.cabLogo && near(range(lg, 0)[0], C[0], 0.01) && near(range(lg, 0)[1], C[1], 0.01) && near(range(lg, 2)[0], C[2], 0.01) && near(range(lg, 2)[1], C[3], 0.01),
    'X ' + C[0] + '〜' + C[1] + '・z ' + C[2] + '〜' + C[3] + '(写真)', G.cabLogo ? 'X ' + range(lg, 0).map((v) => v.toFixed(3)).join('〜') + '・z ' + range(lg, 2).map((v) => v.toFixed(3)).join('〜') : '無い');
}

/* ---- 4. パンタグラフ(PT-7110):屋根の上に載り、すり板がトロリ線に接する ---- */
{
  const base = v4pts(G.panto.base), shoe = v4pts(G.panto.shoe);
  ok('パンタの台が屋根の上', range(base, 2)[0] >= REF.ROOF - 0.1 && range(base, 2)[0] <= REF.ROOF + 0.05,
    REF.ROOF + 'm 付近', range(base, 2)[0].toFixed(3) + 'm');
  const top = range(shoe.filter((p) => Math.abs(p[1]) <= 0.62 + 1e-6), 2)[1];
  ok('すり板が架線に接する', near(top, X.WIRE_TRO, 0.005), X.WIRE_TRO + 'm(トロリ線)', top.toFixed(3) + 'm');
}

/* ---- 5. 走行列車の9000系は 9000系の幾何で組まれている ---- */
{
  const t9 = X.trains.find((t) => t.cars.every((c) => c.userData.k8.series === '9000'));
  let bad = t9 ? null : '9000系の列車が無い';
  if (t9) for (const c of t9.cars) {
    const geos = new Set(); c.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
    const body = c.userData.body.geometry;
    if (body !== G.shell && body !== G.shellCab && !bad) bad = c.userData.k8.num + ' の車体が 9000系でない';
    if (c.userData.bodyMat.userData.k8.series !== '9000' && !bad) bad = c.userData.k8.num + ' の塗り分けが 9000系でない';
  }
  ok('9000系の車体と塗り分け', bad === null, '10両とも', bad || '10両とも');
}

console.log('=== 京王9000系:実ジオメトリ ⇄ 公表諸元 ===');
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
console.log(pad('項目', 30) + pad('期待', 34) + pad('実測', 36) + '判定');
for (const r of rows) console.log(pad(r[0], 30) + pad(r[1], 34) + pad(r[2], 36) + r[3]);
console.log(ng ? '\nRESULT: FAIL(' + ng + '項目NG)' : '\nRESULT: PASS');
process.exit(ng ? 1 : 0);
