// 照明と影の装置を検査する。
//
//   影は「見た目」の話なので目視でしか確かめられないと思われがちだが、
//   壊れ方の多くは数値で捕まえられる:
//     ・視点を動かすと影が回る(光の向きを一緒に動かしてしまう)
//     ・影が視界の一部にしか出ない(写す範囲が注視点から外れる)
//     ・影の縁がちらつく(テクセルの格子に載せていない)
//     ・影が切れる/出ない(影カメラの near/far が対象を挟んでいない)
//   ここではそれらを、実際に sunFollow() を呼んで測る。
//
//   ※ 期待値(向き・テクセルの上限・確保すべき高さ)は検証側が独立に持つ。
//
//   使い方: node tools/verify_light.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'sun:sun,sunFollow:sunFollow,shadowRadius:shadowRadius,' +
  'SUN_V:SUN_V,SUN_N:SUN_N,SUN_F:SUN_F,SUN_RT:SUN_RT,SUN_UP:SUN_UP,' +
  'SH_MAP:SH_MAP,SH_MIN:SH_MIN,SH_MAX:SH_MAX,SUN_DIST:SUN_DIST,' +
  'groundMesh:groundMesh,SHADOW_STAT:SHADOW_STAT,DOM:DOM,' +
  'SKY:SKY,SKY_TEX:SKY_TEX,SKY_R:SKY_R,skyDome:skyDome,MAT:MAT,camera:camera,scene:scene,' +
  'CARMAT:CARMAT,TRIMMAT:TRIMMAT,M_PN:M_PN,M_SH:M_SH,M_PANS:M_PANS,M_BOG:M_BOG,ENV_TEX:ENV_TEX');

/* ---- 期待値(検証側が独立して持つ) ---------------------------------------- */
const REF = {
  SUN: { x: 2400, y: 3200, z: 1600 },  // 太陽の方向(4章の光源設定と同じ意図)
  TEXEL_NEAR: 0.25,   // 寄ったときの影テクセルの上限[m](車両の細部が潰れない)
  TEXEL_FAR: 0.60,    // 引いたときの上限[m]
  OBJ_TOP: 40,        // 影を落としうる最も高い物[m](建物26m+高架12m を包む)
  MIN_ELEV: 25,       // 太陽高度の下限[°](低すぎると影が伸びて破綻する)
  MAX_ELEV: 70,
  SCENE_R: 5600,      // 場面の広がり(地表11000×5200の外接半径の目安)[m]
  ENVMAP: ['rail', 'glass', 'water'],   // 空を映す材質
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) {
  if (!cond) ng++;
  rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']);
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);

/* ---- 1. 影が有効になっているか(ソースを読む) ------------------------------ */
{
  const src = X.__html;
  for (const [label, pat] of [
    ['影を描く', /renderer\.shadowMap\.enabled\s*=\s*true/],
    ['影の種類', /renderer\.shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/],
    ['太陽が影を落とす', /sun\.castShadow\s*=\s*true/],
    ['影を毎フレーム追従', /sunFollow\(cam\.tx,cam\.tz/],
  ]) ok(label, pat.test(src), 'あり', pat.test(src) ? 'あり' : 'なし');
  // スマホでは影を切る(1パス増えるため)
  ok('スマホでは影を切る', /renderer\.shadowMap\.enabled=false;sun\.castShadow=false/.test(src),
    'あり', /renderer\.shadowMap\.enabled=false;sun\.castShadow=false/.test(src) ? 'あり' : 'なし');
}

/* ---- 2. 太陽の高度(影の長さが破綻しない範囲か) ---------------------------- */
{
  const n = REF.SUN, l = len(n);
  const elev = Math.asin(n.y / l) * 180 / Math.PI;
  ok('太陽高度', elev > REF.MIN_ELEV && elev < REF.MAX_ELEV,
    REF.MIN_ELEV + '〜' + REF.MAX_ELEV + '°', elev.toFixed(1) + '°');
  // モデルの向きが検証側の意図と一致するか
  const m = X.SUN_N, d = Math.hypot(m.x - n.x / l, m.y - n.y / l, m.z - n.z / l);
  ok('太陽の方向', d < 1e-6, '(' + [n.x, n.y, n.z].join(',') + ')の向き', d.toFixed(6) + ' 差');
}

/* ---- 3. 視点を動かしても太陽の向きが変わらないこと -------------------------
   ここを間違えると、視点を動かすたびに影が回るという最も目立つ不具合になる。 */
{
  const F = [];
  for (let s = X.DOM.x0 + 100; s < X.DOM.x1; s += 900)
    for (const off of [-400, 0, 400]) for (const d of [50, 300, 1200, 4000]) F.push([s, off, d]);
  let bad = null, worstSnap = 0, outside = null, offGrid = null;
  for (const [fx, fz, dist] of F) {
    X.sunFollow(fx, fz, dist);
    const t = X.sun.target.position, l = X.sun.position;
    // (a) 向きが常に同じ
    const v = sub(l, t), n = len(v);
    const dev = Math.hypot(v.x / n - X.SUN_N.x, v.y / n - X.SUN_N.y, v.z / n - X.SUN_N.z);
    if (dev > 1e-9 && !bad) bad = ['向きが変わった', dev.toExponential(1)];
    // (b) 光源までの距離が一定
    if (Math.abs(n - X.SUN_DIST) > 1e-6 && !bad) bad = ['距離が変わった', n.toFixed(3)];
    /* (c) 影の中心が影テクセルの格子"上"に載っていること。
       残差が小さいことだけを見ると「吸着していない(残差0)」も通ってしまうので、
       格子座標が整数であることを直接確かめる。 */
    const R = X.shadowRadius(dist), texel = 2 * R / X.SH_MAP;
    const p = { x: fx, y: 0, z: fz };
    for (const ax of [X.SUN_RT, X.SUN_UP]) {
      const g = dot(t, ax) / texel;
      const frac = Math.abs(g - Math.round(g));
      if (frac > 1e-6 && !offGrid) offGrid = ['s=' + fx.toFixed(0), '格子から' + frac.toFixed(4) + 'テクセル'];
    }
    // 中心は注視点から半テクセル以内(吸着で遠くへ飛んでいないこと)
    const ea = Math.abs(dot(p, X.SUN_RT) - dot(t, X.SUN_RT));
    const eb = Math.abs(dot(p, X.SUN_UP) - dot(t, X.SUN_UP));
    const snap = Math.max(ea, eb) / texel;
    if (snap > worstSnap) worstSnap = snap;
    // (d) 注視点が影の写る範囲の中にある
    if ((ea > R || eb > R) && !outside) outside = [fx.toFixed(0), (ea / R).toFixed(2)];
  }
  ok('視点を動かしても影が回らない', bad === null, F.length + '点すべて同じ向き',
    bad ? bad.join(' ') : F.length + '点すべて同じ向き');
  ok('影の中心が格子上にある', offGrid === null, '整数テクセル',
    offGrid ? offGrid.join(' ') : F.length + '点すべて格子上');
  ok('影の中心が注視点の近く', worstSnap <= 0.5 + 1e-9, 'ずれ≤0.5テクセル',
    'ずれ ' + worstSnap.toFixed(3) + 'テクセル');
  ok('注視点が影の範囲内', outside === null, '範囲内', outside ? outside.join(' ') : '全点範囲内');
}

/* ---- 4. 影の解像度(テクセルの実寸) ---------------------------------------- */
{
  const near = 2 * X.shadowRadius(0) / X.SH_MAP;        // 最も寄ったとき
  const far = 2 * X.shadowRadius(1e9) / X.SH_MAP;       // 最も引いたとき
  ok('影テクセル(近景)', near <= REF.TEXEL_NEAR, '≤' + REF.TEXEL_NEAR + 'm', near.toFixed(3) + 'm');
  ok('影テクセル(遠景)', far <= REF.TEXEL_FAR, '≤' + REF.TEXEL_FAR + 'm', far.toFixed(3) + 'm');
  ok('範囲が視点距離で広がる', X.shadowRadius(4000) > X.shadowRadius(200),
    '引くほど広い', X.shadowRadius(200).toFixed(0) + 'm → ' + X.shadowRadius(4000).toFixed(0) + 'm');
}

/* ---- 5. 影カメラの near/far が対象を挟んでいるか ---------------------------
   挟めていないと、影が途中で切れる/そもそも出ない。
   影カメラは光源から SUN_F 方向を見る平行投影なので、対象の"奥行き"は
   (点 - 光源)・SUN_F で決まる。範囲いっぱいと高さ0〜OBJ_TOP で走査する。 */
{
  X.sunFollow(0, 0, 1e9);                                // 最も広い範囲で確かめる
  const R = X.shadowRadius(1e9), L = X.sun.position, c = X.sun.shadow.camera;
  let lo = 1e9, hi = -1e9;
  for (const a of [-R, 0, R]) for (const b of [-R, 0, R]) for (const h of [0, REF.OBJ_TOP]) {
    const t = X.sun.target.position;
    const q = {
      x: t.x + X.SUN_RT.x * a + X.SUN_UP.x * b, y: h,
      z: t.z + X.SUN_RT.z * a + X.SUN_UP.z * b,
    };
    const d = dot(sub(q, L), X.SUN_F);
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  ok('影カメラのnear', c.near < lo, '<' + lo.toFixed(0) + 'm', c.near.toFixed(0) + 'm');
  ok('影カメラのfar', c.far > hi, '>' + hi.toFixed(0) + 'm', c.far.toFixed(0) + 'm');
}

/* ---- 6. 落とす/受けるの割当 ------------------------------------------------ */
{
  const g = X.groundMesh;
  ok('地表は影を受ける', g.receiveShadow === true, 'true', String(g.receiveShadow));
  ok('地表は影を落とさない', g.castShadow === false, 'false', String(g.castShadow));
  ok('影を落とす物がある', X.SHADOW_STAT.cast > 0, '>0', X.SHADOW_STAT.cast + '件');
  ok('受ける物は落とす物以上', X.SHADOW_STAT.recv >= X.SHADOW_STAT.cast,
    '受≧落', X.SHADOW_STAT.recv + ' / ' + X.SHADOW_STAT.cast);
}

/* ---- 7. 空 ---------------------------------------------------------------
   空ドームは「場面の外・カメラの遠方面の内」に無いと、見切れるか描かれない。
   フォグの色は地平と同じでないと、遠景と空の境目に線が出る。 */
{
  const d = X.skyDome;
  ok('空ドームがある', !!(d && d.geometry), 'あり', d && d.geometry ? 'あり' : 'なし');
  ok('空ドームの大きさ', X.SKY_R > REF.SCENE_R && X.SKY_R < X.camera.far,
    REF.SCENE_R + 'm < R < ' + X.camera.far + 'm', X.SKY_R + 'm');
  const m = d.material;
  ok('空にフォグを掛けない', m.fog === false, 'false', String(m.fog));
  ok('空は裏面を描く', m.side === 1 /* THREE.BackSide */, 'BackSide', String(m.side));
  // トーンマッピングを通さないと、地平でフォグ(通す)と色が合わず境目が出る
  ok('空もトーンマッピングを通す', m.toneMapped !== false, '通す',
    m.toneMapped === false ? '通さない' : '通す');
  // 影の対象から外れていること(裏面の巨大な球なので入れると世界中が影になる)
  ok('空は影の対象外', d.castShadow === false && d.receiveShadow === false,
    'cast/recv とも false', d.castShadow + ' / ' + d.receiveShadow);
  // フォグの色は地平と同じ値か(ソースで確認。同じ経路を通るので見え方も一致する)
  const okFog = /scene\.fog=new THREE\.Fog\(srgb\(SKY\.HOR\)/.test(X.__html);
  ok('フォグ=地平の色', okFog, 'SKY.HOR', okFog ? 'SKY.HOR' : '別の色');
  // 天頂と地平下は地平と違う色(=グラデーションになっている)
  ok('空がグラデーション', X.SKY.TOP !== X.SKY.HOR && X.SKY.BOT !== X.SKY.HOR,
    '天頂≠地平≠地平下',
    ['TOP', 'HOR', 'BOT'].map((k) => '#' + X.SKY[k].toString(16)).join(' '));
}

/* ---- 8. 材質と環境マップ ---------------------------------------------------
   金属・ガラスは物理ベース(Standard)で空を映す。
   一方、車体は**塗色を守るため Standard にしてはいけない**:
     ・Standard は環境光の拡散が加わり、帯が持ち上がる(実測 最大72/255)
     ・Phong でも envMap を混ぜると、緑成分0の赤帯に空が数%入るだけで大きく動く
       (reflectivity 0.03 で 37/255)
   Phong で envMap を持たせなければ拡散は Lambert と完全に同一(差0/255)で、
   鏡面ハイライトだけが増える。 */
{
  const STD = 'standard';
  let bad = null;
  for (const k of REF.ENVMAP) {
    const m = X.MAT[k];
    if (!m || m.type !== STD) { bad = bad || [k, '物理ベースでない']; continue; }
    if (!(m.envMapIntensity > 0)) bad = bad || [k, '環境の強さ' + m.envMapIntensity];
    if (!(m.roughness >= 0 && m.roughness <= 1)) bad = bad || [k, '粗さ' + m.roughness];
  }
  ok('空を映す材質', bad === null, REF.ENVMAP.join('/') + 'がStandard',
    bad ? bad.join(' ') : REF.ENVMAP.join('/'));
  // scene.environment は PMREM 済みでなければ粗さを反映できない
  ok('環境マップがPMREM済み', X.scene.environment && X.scene.environment.mapping === 306,
    'CubeUV(306)', X.scene.environment ? String(X.scene.environment.mapping) : 'なし');
  // 元になった空は正距円筒として読ませる必要がある
  ok('空の写像', X.SKY_TEX.mapping === 303 /* Equirectangular */, 'Equirectangular(303)',
    String(X.SKY_TEX.mapping));
  // 金属部品(パンタ・台車)も物理ベースに
  let bm = null;
  for (const [nm, m] of [['パンタ枠', X.M_PN], ['舟体', X.M_SH], ['すり板', X.M_PANS], ['台車', X.M_BOG]]) {
    if (m.type !== STD) { bm = bm || [nm, m.type]; continue; }
    if (!(m.metalness >= 0.5)) bm = bm || [nm, '金属度' + m.metalness];
  }
  ok('金属部品が物理ベース', bm === null, 'Standard・金属度≥0.5', bm ? bm.join(' ') : '4点すべて');
  /* 車体:帯を守るための2条件。Phong であること・envMap を持たないこと。
     どちらか欠けると帯が動く。 */
  let bb = null;
  for (const [nm, m] of [['車体', X.CARMAT], ['トリム', X.TRIMMAT]]) {
    if (m.type !== 'phong') bb = bb || [nm, m.type + 'になっている'];
    else if ('envMap' in m) bb = bb || [nm, 'envMapを持っている'];
    else if (!(m.shininess > 0)) bb = bb || [nm, 'ハイライトが無い'];
  }
  ok('車体は帯を動かさない材質', bb === null, 'Phong・envMapなし',
    bb ? bb.join(' ') : 'Phong・envMapなし・ハイライトあり');
}

/* ---- 9. 色を持つテクスチャが sRGB として読まれているか -----------------------
   ソースの見た目ではなく、場面に実際に載っている材質を走査して確かめる。
   1枚でも指定が漏れると、その面だけ不自然に明るくなる。                     */
{
  const SRGB = 3001;                 // THREE.sRGBEncoding(検証側が独立に持つ)
  const seen = new Set();
  let bad = null, n = 0;
  X.scene.traverse(function (o) {
    const m = o.material; if (!m || typeof m !== 'object') return;
    for (const slot of ['map', 'envMap']) {
      const t = m[slot];
      if (!t || typeof t.encoding !== 'number' || seen.has(t)) continue;
      seen.add(t); n++;
      if (t.encoding !== SRGB && !bad) bad = [slot, 'encoding=' + t.encoding];
    }
  });
  ok('テクスチャがsRGB', bad === null && n > 0, n + '枚すべてsRGB',
    bad ? bad.join(' ') : n + '枚すべてsRGB');
}

/* ---- 10. 材質を渡し忘れたメッシュが無いか -----------------------------------
   `new THREE.Mesh(geo)` と材質を省くと、three.js は**無照明の白**を既定で充てる。
   昼は周りも明るいので気づかないが、夜にすると白く光る。
   実際に MAT の定義が行末コメントに飲み込まれて road/roadMajor が undefined になり、
   道路が無照明の白板として敷かれていた(2026-10)。
   個々の名前ではなく「材質が無いメッシュが1つも無いこと」で面として押さえる。 */
{
  let miss = 0, first = null;
  X.scene.traverse(function (o) {
    if (o.isMesh !== true) return;              // メッシュだけを厳密に選ぶ
    const m = o.material;
    if (m && typeof m === 'object' && (m.type || Array.isArray(m))) return;
    miss++;
    if (!first) {
      const g = o.geometry || {};
      first = (typeof g.type === 'string' ? g.type : 'ジオメトリ') + ' を材質なしで作っている';
    }
  });
  ok('材質の渡し忘れ', miss === 0, '0件', miss === 0 ? '0件' : miss + '件 / ' + first);
  /* 地表のすぐ上に敷く面(道路・側道・緑道)は、遠方で深度の分解能が足りず
     地表と奥行きを取り合って画素単位でちらつく。地表だけを深度方向へ
     押し下げて、距離によらず上の面が勝つようにしておく。 */
  const gm = X.MAT.ground;
  ok('地表を深度方向へ押し下げ', gm.polygonOffset === true && gm.polygonOffsetUnits > 0,
    'polygonOffset ON・units>0',
    (gm.polygonOffset === true ? 'ON' : 'OFF') + ' / units=' + (gm.polygonOffsetUnits || 0));
  // MAT の項目がすべて材質になっているか(飲み込まれた項目は undefined になる)
  const empty = Object.keys(X.MAT).filter((k) => !X.MAT[k] || !X.MAT[k].type);
  ok('MATの項目が揃う', empty.length === 0, '全項目が材質',
    empty.length ? empty.join(',') + ' が未定義' : Object.keys(X.MAT).length + '項目');
}

/* ---- 出力 ---------------------------------------------------------------- */
console.log('=== 照明と影の検証 ===');
console.log('(sunFollow を実際に呼び、光の向き・写す範囲・テクセル吸着を測定)\n');
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].length + 2));
console.log(pad('項目', 28) + pad('期待', 24) + pad('実測', 28) + '判定');
for (const r of rows) console.log(pad(r[0], 28) + pad(r[1], 24) + pad(r[2], 28) + r[3]);
console.log('\n影マップ ' + X.SH_MAP + 'px / 半径 ' + X.SH_MIN + '〜' + X.SH_MAX + 'm');
console.log(ng ? 'RESULT: FAIL(' + ng + '項目NG)' : 'RESULT: PASS');
process.exit(ng ? 1 : 0);
