// 軌道と分岐器を検査する(⑬)。
//
//   線路は結合ジオメトリ(5章の区画)とインスタンスで描くので、見た目では確かめきれない
//   「レールの位置(軌間)と高さ」「まくらぎが途切れず・重ならず・レールの下にある」
//   「締結装置が全てのレールの下にある」「分岐器の部品(トングレール・クロッシング・
//   ガードレール・転てつ機・分岐まくらぎ)が揃い、寸法が合う」「道床どうしが重ならない
//   (重なると面がちらつく)」「行き止まりに車止め」を、登録簿と実際の頂点・インスタンスで測る。
//   基準値(軌間・レールの高さ・まくらぎの間隔・分岐器の番数など)は検証側が持つ(HTMLからは読まない)。
//   使い方: node tools/verify_track.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'TRACKS:TRACKS,TURNOUTS:TURNOUTS,FROGS:FROGS,RAILS:RAILS,BUFFERS:BUFFERS,BEDS:BEDS,STRUCT:STRUCT,' +
  'scene:scene,MAT:MAT,FAST1_GEO:FAST1_GEO,FAST2_GEO:FAST2_GEO,railY:railY,frame:frame,RAIL_TOP:RAIL_TOP,DOM:DOM,' +
  'SWITCHES:SWITCHES');

/* ---- 検証側が独立に持つ寸法 -------------------------------------------- */
const REF = {
  GAUGE: 1.372,            // 軌間[m](京王線=馬車軌間)。レール頭部の内側の面の間
  HEAD: 0.072,             // レール頭部の幅[m]
  RAIL_H: 0.153,           // 50kgN レールの高さ[m]
  SEAT: [0.005, 0.02],     // レールの底とまくらぎの上面の間(タイプレート・軌道パッド)[m]
  TIE_P: [0.58, 0.67],     // まくらぎの間隔[m](約1600本/km)
  TIE_LEN: 2.2,            // まくらぎの長さの下限[m]
  N: [6, 35],              // 分岐器の番数(クロッシング角の逆数)
  OPEN: 0.08,              // 開いたトングレールと基本レールの間(先端)の下限[m]
  BEND: 0.5,               // トングレールの折れ点:2本の中心が頭部の幅だけ離れる所から、先端と反対の側へ[m](2026-10-11 利用者指示)
  GUARD_LEN: 3.5,          // ガードレールの長さの下限[m]
  LONG: 0.8,               // ポイントの先端からクロッシングまで、分岐まくらぎが占める割合の下限
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, expect, got, cond ? 'OK' : 'NG']); }

/* ---- 座標を線路の (s, off) に戻す(1m 刻みの表と 20m 格子で最も近い点を探す) ---- */
const TAB = [], GRID = new Map(), CELL = 20;
for (let s = X.DOM.x0 - 20; s <= X.DOM.x1 + 20; s += 1) {
  const f = X.frame(s, 0), k = Math.floor(f.x / CELL) + ',' + Math.floor(f.z / CELL);
  TAB.push([s, f.x, f.z, f.a]);
  if (!GRID.has(k)) GRID.set(k, []);
  GRID.get(k).push(TAB.length - 1);
}
function toSO(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let best = null, bd = 1e18;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const L = GRID.get((cx + i) + ',' + (cz + j)); if (!L) continue;
    for (const k of L) { const r = TAB[k], d = (r[1] - x) ** 2 + (r[2] - z) ** 2; if (d < bd) { bd = d; best = r; } }
  }
  if (!best) return null;
  const a = best[3];
  return { s: best[0] + (x - best[1]) * Math.cos(a) + (z - best[2]) * Math.sin(a),
           off: -(x - best[1]) * Math.sin(a) + (z - best[2]) * Math.cos(a) };
}
// 高架の区画(5章)の中の Mesh を集める
const meshes = [];
for (const g of X.scene.children) {
  if (!g.name || g.name.indexOf('高架橋 ') !== 0) continue;
  g.traverse((o) => { if (o.isMesh) meshes.push(o); });
}
const tracksAt = (s) => X.TRACKS.filter((t) => s >= t.x0 - 1e-6 && s <= t.x1 + 1e-6);

/* ---- 1. レール:位置(軌間)と高さ ------------------------------------------ */
{
  // 普通のレールは線路中心から (軌間+頭部の幅)/2 の所(内側の面の間が軌間)
  const half = (REF.GAUGE + REF.HEAD) / 2;
  let bad = null, n = 0;
  for (const r of X.RAILS) {
    if (r.kind !== 'レール') continue;
    const t = X.TRACKS.find((q) => q.id === r.id);
    for (let s = r.s0; s <= r.s1 + 1e-9; s += Math.max(0.5, (r.s1 - r.s0) / 20)) {
      n++;
      const d = Math.abs(r.o(s) - (t.zf(s) + r.r * half));
      if (d > 1e-6 && !bad) bad = [r.id, 's=' + s.toFixed(1), 'ずれ ' + d.toFixed(4) + 'm'];
    }
  }
  ok('レールの位置(軌間)', bad === null && n > 0, '内側の面の間=' + REF.GAUGE + 'm', bad ? bad.join(' ') : n + '点');
  // 磨かれた頭頂面(MAT.rail)の頂点はすべてレール面(車両の原点)の高さ
  let worst = 0, at = null, nv = 0;
  for (const m of meshes) {
    if (m.material !== X.MAT.rail) continue;
    const P = m.geometry.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      const q = toSO(P[i], P[i + 2]); if (!q) continue;
      nv++;
      const d = Math.abs(P[i + 1] - (X.railY(q.s) + X.RAIL_TOP));
      if (d > worst) { worst = d; at = 's=' + q.s.toFixed(1); }
    }
  }
  ok('レール面の高さ=車両の原点', worst <= 0.005 && nv > 0, '±5mm', worst.toFixed(4) + 'm(' + nv + '頂点' + (at ? ' 最大 ' + at : '') + ')');
}

/* ---- 2. まくらぎと締結装置 ---------------------------------------------- */
const TIES = [], FAST = [];
for (const m of meshes) {
  if (!Array.isArray(m.mats)) continue;
  const isTie = m.material === X.MAT.tie, isF2 = m.geometry === X.FAST2_GEO, isF1 = m.geometry === X.FAST1_GEO;
  if (!isTie && !isF1 && !isF2) continue;
  for (let i = 0; i < m.count; i++) {
    const t = m.mats[i]; if (!t) continue;
    const q = toSO(t.p.x, t.p.z); if (!q) continue;
    if (isTie) TIES.push({ s: q.s, off: q.off, y: t.p.y, hl: 1.15 * (t.s ? t.s.z : 1) });
    else FAST.push({ s: q.s, off: q.off, two: isF2 });
  }
}
TIES.sort((a, b) => a.s - b.s); FAST.sort((a, b) => a.s - b.s);
const near = (L, s, w) => { let lo = 0, hi = L.length; while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].s < s - w) lo = m + 1; else hi = m; }
  const out = []; for (let i = lo; i < L.length && L[i].s <= s + w; i++) out.push(L[i]); return out; };
{
  // まくらぎの上面の高さ:レールの底(レール面-レールの高さ)からタイプレートぶん下
  let bad = null;
  for (const t of TIES) {
    const gap = X.railY(t.s) + X.RAIL_TOP - REF.RAIL_H - t.y;
    if ((gap < REF.SEAT[0] - 1e-6 || gap > REF.SEAT[1] + 1e-6) && !bad) bad = ['s=' + t.s.toFixed(1), (gap * 1000).toFixed(1) + 'mm'];
  }
  ok('レール(高さ' + REF.RAIL_H * 1000 + 'mm)がまくらぎに載る', bad === null && TIES.length > 0,
    'レールの底とまくらぎの間 ' + REF.SEAT.map((v) => v * 1000).join('〜') + 'mm', bad ? bad.join(' ') : TIES.length + '本');
  // 各線路の下に、まくらぎが途切れず(間隔)・両方のレールの下まで届く長さで並ぶ
  let bSp = null, bLen = null, nT = 0;
  for (const tr of X.TRACKS) {
    let prev = null;
    for (const t of TIES) {
      if (t.s < tr.x0 + 0.4 || t.s > tr.x1 - 0.4) continue;
      const c = tr.zf(t.s), half = (REF.GAUGE + REF.HEAD) / 2 + 0.1;
      if (Math.abs(t.off - c) - t.hl > -half) continue;       // この線路の下に無い
      nT++;
      if (t.hl * 2 < REF.TIE_LEN && !bLen) bLen = [tr.id, 's=' + t.s.toFixed(1), (t.hl * 2).toFixed(2) + 'm'];
      if (Math.abs(t.off - c) + half > t.hl + 1e-6 && !bLen) bLen = [tr.id, 's=' + t.s.toFixed(1), 'レールの下まで届かない'];
      if (prev !== null) { const d = t.s - prev; if ((d < REF.TIE_P[0] || d > REF.TIE_P[1]) && !bSp) bSp = [tr.id, 's=' + prev.toFixed(1), d.toFixed(3) + 'm']; }
      prev = t.s;
    }
  }
  ok('まくらぎの間隔', bSp === null && nT > 0, REF.TIE_P.join('〜') + 'm', bSp ? bSp.join(' ') : nT + '本');
  ok('まくらぎの長さ', bLen === null, '≥' + REF.TIE_LEN + 'm・両方のレールの下', bLen ? bLen.join(' ') : '全て');
  // 同じ位置で重なるまくらぎが無い(分岐器の中は1本の分岐まくらぎにまとめる)
  let bOv = null;
  for (let i = 0; i < TIES.length; i++) for (let j = i + 1; j < TIES.length && TIES[j].s - TIES[i].s < 0.24; j++) {
    const a = TIES[i], b = TIES[j];
    if (Math.abs(a.off - b.off) < a.hl + b.hl - 0.01 && !bOv) bOv = ['s=' + a.s.toFixed(1), 'off ' + a.off.toFixed(2) + '/' + b.off.toFixed(2)];
  }
  ok('まくらぎが重ならない', bOv === null, '0組', bOv ? bOv.join(' ') : '0組');
  // 締結装置:全てのまくらぎの上の、全てのレールの下にある(クロッシングの切れ目を除く)
  const cutAt = (id, r, s) => X.FROGS.some((F) => F.t && ((F.a === id && F.ra === r) || (F.b === id && F.rb === r)) &&
    (s - F.throat) * (s - F.nose) < 0);
  let bF = null, nF = 0;
  for (const tr of X.TRACKS) for (const t of TIES) {
    if (t.s < tr.x0 + 0.4 || t.s > tr.x1 - 0.4) continue;
    const c = tr.zf(t.s);
    if (Math.abs(t.off - c) > t.hl) continue;
    for (const r of [-1, 1]) {
      if (cutAt(tr.id, r, t.s)) continue;
      const ro = c + r * (REF.GAUGE + REF.HEAD) / 2;
      nF++;
      const has = near(FAST, t.s, 0.05).some((f) => f.two ? (Math.abs(f.off - c) < 0.01) : (Math.abs(f.off - ro) < 0.01));
      if (!has && !bF) bF = [tr.id, 's=' + t.s.toFixed(2), r > 0 ? '北のレール' : '南のレール'];
    }
  }
  ok('締結装置が全てのレールの下にある', bF === null && nF > 0, 'まくらぎ×レール', bF ? bF.join(' ') + ' に無い' : nF + '箇所');
}

/* ---- 3. 分岐器 ----------------------------------------------------------- */
{
  let bB = null, bFr = null, bG = null, bM = null, bL = null, bP = null, nP = 0, nT = X.TURNOUTS.length;
  const half = REF.GAUGE / 2;
  for (const T of X.TURNOUTS) {
    const A = T.A, B = T.B, sg = T.sg, f = T.f;
    // トングレール:A 側(定位)は A の軌間の線と基本レール(B の外側のレール)の内面の間に密着し、
    // B 側は基本レール(A の反対側のレール)から開く
    const cl = X.RAILS.find((r) => r.kind === 'トングレール' && r.state === '密着' && r.id === A.id && r.r === sg && Math.abs(Math.min(r.s0, r.s1) - Math.min(T.s, T.heel)) < 0.01);
    const op = X.RAILS.find((r) => r.kind === 'トングレール' && r.state === '開' && r.id === B.id && r.r === -sg && Math.abs(Math.min(r.s0, r.s1) - Math.min(T.s, T.heel)) < 0.01);
    if ((!cl || !op) && !bB) bB = [B.id, 's=' + T.s.toFixed(1), (cl ? '' : '密着側') + (op ? '' : '開く側') + 'のトングレールが無い'];
    if (cl && !bB) {
      const s = T.s + (T.full - T.s) * 0.5, e = cl.e(s), g = A.zf(s) + sg * half, st = B.zf(s) + sg * half;
      const lo = Math.min(g, st), hi = Math.max(g, st);
      if ((Math.abs(e[0] - lo) > 0.001 || Math.abs(e[1] - hi) > 0.001) && !bB) bB = [B.id, 's=' + s.toFixed(1), '密着していない'];
    }
    if (op && !bB) {
      const s = T.s + f * 0.05, e = op.e(s), stock = A.zf(s) - sg * half;
      const gap = Math.min(Math.abs(e[0] - stock), Math.abs(e[1] - stock));
      if (gap < REF.OPEN && !bB) bB = [B.id, 's=' + s.toFixed(1), '開き ' + gap.toFixed(3) + 'm'];
    }
    /* 折れ点:B 側のトングレールの基本レール側の縁を A からの距離で見て、向きが最も大きく変わる所が
       「2本の中心が頭部の幅だけ離れる所」(検証側で求める)から先端と反対の側へ REF.BEND。そこまでは A に対してまっすぐ */
    if (op && !bP) {
      let full = null; for (let s = T.s; f * (s - T.s) < 80; s += f * 0.01) if (Math.abs(B.zf(s) - A.zf(s)) >= REF.HEAD) { full = s; break; }
      const rel = (s) => { const e = op.e(s); return sg * ((sg > 0 ? e[0] : e[1]) - A.zf(s)); };
      const h = 0.1, s1 = T.heel - f * 1.0; let km = 0, sk = null;
      for (let s = T.s + f * 0.3; f * (s1 - s) > 0; s += f * 0.02) { const k = Math.abs(rel(s + h) - 2 * rel(s) + rel(s - h)); if (k > km) { km = k; sk = s; } }
      const want = full === null ? null : full + f * REF.BEND;
      let dev = 0;
      if (want !== null) { const r0 = rel(T.s + f * 0.05), r1 = rel(want - f * 0.05);
        for (let s = T.s + f * 0.05; f * (want - f * 0.05 - s) > 0; s += f * 0.1) dev = Math.max(dev, Math.abs(rel(s) - (r0 + (r1 - r0) * (s - T.s - f * 0.05) / (want - T.s - f * 0.1)))); }
      if ((want === null || sk === null || Math.abs(sk - want) > 0.12 || dev > 0.002) && !bP)
        bP = [B.id, 's=' + T.s.toFixed(1), '折れ点 ' + (sk === null ? '無し' : (f * (sk - T.s)).toFixed(2)) + 'm(期待 ' + (want === null ? '-' : (f * (want - T.s)).toFixed(2)) + 'm)・直線からのずれ ' + (dev * 1000).toFixed(1) + 'mm'];
      else nP++;
    }
    // クロッシング:A の分かれる側のレールと B の反対側のレールが交わる所。番数と切れ目(フランジウェー)
    const F = X.FROGS.filter((q) => q.t && ((q.a === A.id && q.b === B.id && q.ra === sg && q.rb === -sg) ||
      (q.a === B.id && q.b === A.id && q.rb === sg && q.ra === -sg)) && f * (q.s - T.s) > 0)
      .sort((p, q) => Math.abs(p.s - T.s) - Math.abs(q.s - T.s))[0];
    if (!F) { if (!bFr) bFr = [B.id, 's=' + T.s.toFixed(1), 'クロッシングが無い']; continue; }
    if ((F.N < REF.N[0] || F.N > REF.N[1]) && !bFr) bFr = [B.id, 's=' + F.s.toFixed(1), F.N.toFixed(1) + '番'];
    const g0 = Math.min(F.throat, F.nose) + 0.05, g1 = Math.max(F.throat, F.nose) - 0.05;
    for (const [id, r] of [[F.a, F.ra], [F.b, F.rb]])
      if (X.RAILS.some((q) => q.kind === 'レール' && q.id === id && q.r === r && q.s0 < g1 && q.s1 > g0) && !bFr)
        bFr = [id, 's=' + F.s.toFixed(1), 'レールが途切れていない(フランジウェーが無い)'];
    // ガードレール:2本(A と B の反対側のレールの内側)。長さ
    const G = X.RAILS.filter((q) => q.kind === 'ガードレール' && Math.abs(q.frog - F.s) < 1e-6 && (q.id === F.a || q.id === F.b));
    const gA = G.find((q) => q.id === F.a && q.r === -F.ra), gB = G.find((q) => q.id === F.b && q.r === -F.rb);
    if ((!gA || !gB) && !bG) bG = [B.id, 's=' + F.s.toFixed(1), 'ガードレールが' + G.length + '本'];
    for (const q of G) if (q.s1 - q.s0 < REF.GUARD_LEN && !bG) bG = [q.id, 's=' + F.s.toFixed(1), '長さ ' + (q.s1 - q.s0).toFixed(2) + 'm'];
    // 転てつ機(ポイントの先端の近く)
    if (!X.STRUCT.some((q) => q.tag === '転てつ機' && Math.abs((q.s0 + q.s1) / 2 - T.s) < 3) && !bM) bM = [B.id, 's=' + T.s.toFixed(1)];
    // 分岐まくらぎ:先端からクロッシングまでのまくらぎは、両方の線路の4本のレールの下に届く1本
    let all = 0, long = 0;
    for (const t of near(TIES, (T.s + F.s) / 2, Math.abs(F.s - T.s) / 2)) {
      if (t.s < Math.min(T.s, F.s) || t.s > Math.max(T.s, F.s)) continue;
      if (Math.abs(t.off - A.zf(t.s)) > t.hl) continue;              // A の下のまくらぎだけ数える
      all++;
      const o = [A.zf(t.s) - 0.722, A.zf(t.s) + 0.722, B.zf(t.s) - 0.722, B.zf(t.s) + 0.722];
      if (o.every((v) => Math.abs(v - t.off) < t.hl)) long++;
    }
    if (long < REF.LONG * all && !bL) bL = [B.id, 's=' + T.s.toFixed(1), long + '/' + all + '本'];
  }
  ok('トングレール(密着・開き)', bB === null && nT > 0, '定位で密着・反位側は≥' + REF.OPEN + 'm開く', bB ? bB.join(' ') : nT + '組');
  ok('トングレールの折れ点', bP === null && nP > 0, '中心が頭部の幅だけ離れる所+' + REF.BEND + 'm(±0.12)・先端からまっすぐ', bP ? bP.join(' ') : nP + '組');
  /* 転換する分岐器(利用者指示:待避線へ入る列車に合わせて転換):本線⇔待避線・停車線の分岐器が全て転換でき、反位では
     A 側のトングレールが基本レール(B の外側のレール)から ≥REF.OPEN 開き、B 側が基本レール(A の反対側)に密着する。
     描く Mesh の頂点も同じ位置へ動く */
  {
    const want = X.TURNOUTS.filter((T) => /^本線/.test(T.A.id) && /副本線|停車線/.test(T.B.id));
    let bad = null, n = 0;
    if (X.SWITCHES.length !== want.length || X.SWITCHES.some((W) => want.indexOf(W.T) < 0)) bad = ['転換する分岐器 ' + X.SWITCHES.length + '組(期待 ' + want.length + '組)'];
    for (const W of X.SWITCHES) {
      if (bad) break;
      const T = W.T, A = T.A, B = T.B, sg = T.sg;
      const cl = X.RAILS.find((r) => r.sw === W && r.state === '密着'), op = X.RAILS.find((r) => r.sw === W && r.state === '開');
      const f0 = (r) => (Math.abs(r.s0 - T.s) < Math.abs(r.s1 - T.s) ? r.s1 : r.s0);   // 先端と反対の端
      if (!cl || !op || !W.mesh) { bad = [B.id, 's=' + T.s.toFixed(1), '登録が無い']; break; }
      const P0 = Array.from(W.geo.attributes.position.array);
      W.r = 1; W.fill();
      const s = T.s + T.f * 0.05;
      const ea = cl.e(s), stockA = B.zf(s) + sg * half;          // A 側:基本レールから開く
      const gA = Math.min(Math.abs(ea[0] - stockA), Math.abs(ea[1] - stockA));
      const eb = op.e(s), stockB = A.zf(s) - sg * half;          // B 側:基本レールに密着
      const gB = Math.min(Math.abs(eb[0] - stockB), Math.abs(eb[1] - stockB));
      // A 側のトングレールの終わり(開きが0になる所)で、続く固定のレールと食い違わない
      const se = f0(cl), ec = cl.e(se), ef = [A.zf(se) + sg * half, A.zf(se) + sg * (half + REF.HEAD)];
      const jump = Math.max(Math.abs(Math.min(...ec) - Math.min(...ef)), Math.abs(Math.max(...ec) - Math.max(...ef)));
      const P1 = W.geo.attributes.position.array;
      let mv = 0; for (let i = 0; i < P1.length; i++) mv = Math.max(mv, Math.abs(P1[i] - P0[i]));
      W.r = 0; W.fill(); n++;
      if (gA < REF.OPEN) bad = [B.id, 's=' + T.s.toFixed(1), '反位で A 側が開かない ' + gA.toFixed(3) + 'm'];
      else if (gB > 0.002) bad = [B.id, 's=' + T.s.toFixed(1), '反位で B 側が密着しない ' + gB.toFixed(3) + 'm'];
      else if (mv < 0.08) bad = [B.id, 's=' + T.s.toFixed(1), '描く Mesh が動かない ' + mv.toFixed(3) + 'm'];
      else if (jump > 0.002) bad = [B.id, 's=' + T.s.toFixed(1), '反位で A 側のトングレールの終わりが固定のレールと ' + (jump * 1000).toFixed(0) + 'mm 食い違う'];
    }
    ok('分岐器の転換(反位)', bad === null && n > 0, '本線⇔待避線・停車線の全組:A 側が≥' + REF.OPEN + 'm開き B 側が密着', bad ? bad.join(' ') : n + '組');
  }
  ok('クロッシング(番数・フランジウェー)', bFr === null, REF.N.join('〜') + '番・レールに切れ目', bFr ? bFr.join(' ') : nT + '組');
  ok('ガードレール', bG === null, '2本・長さ≥' + REF.GUARD_LEN + 'm', bG ? bG.join(' ') : nT * 2 + '本');
  ok('転てつ機', bM === null, '各分岐器', bM ? bM.join(' ') + ' に無い' : nT + '台');
  ok('分岐まくらぎ', bL === null, '先端〜クロッシングの' + REF.LONG * 100 + '%以上', bL ? bL.join(' ') : '全て');
}

/* ---- 4. 道床が重ならない(重なると面がちらつく) ------------------------- */
{
  const byS = new Map();
  for (const b of X.BEDS) { const k = b.s.toFixed(1); if (!byS.has(k)) byS.set(k, []); byS.get(k).push(b); }
  let bad = null, n = 0;
  for (const [k, L] of byS) {
    L.sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < L.length; i++) {
      n++;
      if (L[i].lo < L[i - 1].hi - 0.01 && !bad) bad = ['s=' + k, L[i - 1].id + '/' + L[i].id, (L[i - 1].hi - L[i].lo).toFixed(3) + 'm'];
    }
  }
  ok('道床が重ならない', bad === null && X.BEDS.length > 0, '重なり≤0.01m', bad ? bad.join(' ') : X.BEDS.length + '断面');
}

/* ---- 5. 行き止まりに車止め ---------------------------------------------- */
{
  let bad = null, n = 0;
  for (const t of X.TRACKS) for (const e of [t.x0, t.x1]) {
    if (Math.abs(e - X.DOM.x0) < 10 || Math.abs(e - X.DOM.x1) < 10) continue;
    if (X.TRACKS.some((u) => u !== t && e >= u.x0 - 0.05 && e <= u.x1 + 0.05 && Math.abs(u.zf(e) - t.zf(e)) < 0.03)) continue;
    n++;
    const b = X.BUFFERS.find((q) => q.id === t.id && Math.abs(q.end - e) < 1e-6);
    if ((!b || Math.abs(b.s - e) > 3 || b.s < t.x0 || b.s > t.x1) && !bad) bad = [t.id, 's=' + e.toFixed(1)];
  }
  ok('行き止まりに車止め', bad === null, '全ての行き止まり', bad ? bad.join(' ') + ' に無い' : n + '箇所');
}

/* ---- 出力 ---- */
const w = (s, n) => String(s) + ' '.repeat(Math.max(0, n -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
console.log('=== 軌道と分岐器の検証 ===');
console.log('');
console.log(w('項目', 34) + w('要件', 30) + w('実測', 34) + '判定');
for (const r of rows) console.log(w(r[0], 34) + w(r[1], 30) + w(r[2], 34) + r[3]);
console.log('');
console.log('分岐器 ' + X.TURNOUTS.length + '組・クロッシング ' + X.FROGS.length + 'か所(うち鈍角 ' +
  X.FROGS.filter((q) => !q.t).length + ')・車止め ' + X.BUFFERS.length);
console.log('RESULT: ' + (ng ? 'FAIL(' + ng + '項目NG)' : 'PASS'));
process.exit(ng ? 1 : 0);
