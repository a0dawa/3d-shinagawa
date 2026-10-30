// 駅の構造を検査する(⑪)。
//
//   駅は結合ジオメトリ(3b章)で細かく作り込んだので、見た目では確かめきれない
//   「列車に当たらないか」「階段やエレベーターがホームに収まっているか」
//   「駅名標の左右の駅名が見る向きと合っているか」「公表デザインの要点が形になっているか」
//   「細かくしても描画の呼び出しが増えていないか」を数値で確かめる。
//
//   ・列車との干渉は、登録簿 STRUCT(部品の s/off/高さの範囲)と、実際に出来た頂点の
//     両方で測る。建築限界の寸法は検証側が独立に持つ(HTMLからは読まない)。
//   ・公表デザインの要点も検証側が持つ。出典は京王電鉄 2019.5.30 の発表の「イメージパース」
//     (利用者提供の画像。寸法はパースの人物 約1.7m と比べて読んだ)と「デザインのポイント」の文。
//   使い方: node tools/verify_station.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'STA:STA,STG:STG,STRUCT:STRUCT,TRACKS:TRACKS,railY:railY,frame:frame,PLATS:PLATS,' +
  'STAIRS:(typeof STAIRS!=="undefined"?STAIRS:[]),SIGNS:(typeof SIGNS!=="undefined"?SIGNS:[]),' +
  'WEAVE:(typeof WEAVE!=="undefined"?WEAVE:[]),MAT:MAT,MAT_BRICK:MAT_BRICK,MAT_STONE:MAT_STONE,MAT_LOUVER:MAT_LOUVER,MAT_RIB:MAT_RIB,' +
  'platRange:platRange,deckHalf:deckHalf,' +
  'PSD:PSD,K8:K8,DECK_END:DECK_END,LODS:LODS,POLE_S:POLE_S,WIRE_CAT:WIRE_CAT,' +
  'GUIDES:GUIDES,depList:depList,pidsSetTime:pidsSetTime,' +
  'PEOPLE:(typeof PEOPLE!=="undefined"?PEOPLE:[]),scene:scene,STD:STD,POLES:(typeof POLES!=="undefined"?POLES:[]),' +
  'TURNOUTS:TURNOUTS,prjXY:prjXY,INO:INO,INO_PLAT:INO_PLAT,XR:XR,RAW:RAW,LAT0:LAT0,LON0:LON0,MLAT:MLAT,MLON:MLON,VIA_COLS:VIA_COLS,lodStruct:lodStruct,camera:camera,' +
  'trains:trains,stepWorld:stepWorld,FLOW:FLOW,stopPosOf:stopPosOf,CAR_HALF:CAR_HALF,placeTrain:placeTrain,trainPSD:trainPSD');

/* ---- 検証側が独立に持つ寸法 -------------------------------------------- */
const REF = {
  BODY_HW: 1.385 + 0.06,   // 車体の半幅(8000系 2.770m)+ゆれの余裕[m]
  BODY_Y: [0.30, 4.30],    // 車体が占める高さ(レール面から。冷房装置の上端4.055+余裕)
  PANTO_HW: 1.10,          // パンタグラフ・架線の占める半幅[m]
  PANTO_Y: [4.30, 6.15],   // その高さ(トロリ線4.95・き電ちょう架線5.90+余裕0.25)。
                           // 架線の支持物(可動ブラケット)は駅の部品ではないので、ここでは測らない(⑥で見る)
  ROOF_MIN: 7.00,          // 線路の上に架かる屋根・梁の下端の最小値(可動ブラケットを吊る余裕)
  TACTILE_KEEP: 0.80,      // 階段・エレベーターは線路側の縁からこれ以上離す[m]
  SIGN_PER_PLAT: 3,        // 1面あたりの駅名標(両面で1組)の最小数
  CALLS_PER_STA: 16,       // 1駅あたりの Mesh(=描画の呼び出し)の上限
  // 公表パース(京王電鉄 2019.5.30)に写っているもの → その駅に無ければならない部品
  DESIGN: {
    '代田橋': ['外装:透明のスクリーン', '外装:縦材', '外装:流れのルーバー', '駅舎:レンガ', '駅舎:格子の庇'],
    '明大前': ['外装:横ルーバー', '外装:紫のアクセント', '外装:灰の板', '外装:透明', '駅舎:半透明の壁'],
    '下高井戸': ['外装:白い腰壁', '外装:ガラスの帯', '外装:ガラリの板', '大庇', '大庇の柱'],
    '桜上水': ['外装:縦リブの板', '外装:細長い窓', '外装:暗い帯', '駅舎:木の縦ルーバー'],
    '上北沢': ['外装:ベージュの帯', '外装:透明の帯', '外装:白い弓形の柱', '駅舎:石積み', '駅舎:低い庇'],
    '芦花公園': ['外装:木の縦格子', '外装:深い軒', '外装:石積み', '駅舎:石積み'],
    '千歳烏山': ['外装:格子(縦)', '外装:格子(横)', '外装:高架の側面', '駅舎:木の柱'],
  },
  // パースから読んだ寸法(人物 約1.7m との比)
  LATTICE: [0.7, 1.2],     // 千歳烏山の格子の目[m](ホーム階の高さに約9段)
  LATTICE_ROWS: 6,         // 同 段の数の最小
  WEAVE_SEP: [0.06, 0.30], // 同 平織り:交点で表の帯と裏の帯の層の差(帯が貫き合わない・浮きすぎない)[m]
  STAIRS_PER_PLAT: 2,      // 1つのホームの階段の数(利用者指示:1ホームに2か所)
  STAIR_GAP: 10,           // 2か所の階段の離れの最小[m](同じ場所に並べたものは1か所と数える)
  FIN_PITCH: [0.4, 0.65],  // 芦花公園の縦格子の間隔[m]
  FIN_DEPTH: 0.40,         // 同 見込みの最小[m](奥行きのある厚い縦格子)
  EAVE_OVER: 1.2,          // 同 屋根の張り出し(縦格子より外へ)の最小[m]
  POST_PITCH: [1.2, 2.2],  // 代田橋の細い縦材の間隔[m]
  FLOW_SPAN: 2.5,          // 代田橋の流れの帯が上下に動く幅の最小[m](下に寄る所と上に寄る所がある)
  PURPLE_MIN: 20,          // 明大前の紫の横帯の数(片側)の最小
  SWEEP: 1.0,              // 下高井戸の大庇の縁の高さの変化(反り上がり)の最小[m]
  BOW_PITCH: [10, 20],     // 上北沢の白い弓形の柱の間隔[m]
  BOW_TOP: 6.5,            // 同 上端(レール面から)の最小[m]:屋根の軒より上へ伸びる
  // 発車標(利用者指示:階段とホームの接続部の付近)
  DEP_DIST: [1.0, 6.0],    // 階段口(入口の端)からホーム側への距離[m]
  DEP_EDGE: 0.25,          // ホームの縁からの内側の余裕[m]
  DEP_NOW: { morning: 450, noon: 720, evening: 1050, night: 1260 },   // 時刻の場面ごとの「今」[分]
  DEP_WITHIN: 25,          // 次の2本はこの分以内(日中の京王線は1方向に毎時十数本)
  // 種別ごとの停車駅(笹塚〜仙川。2022年3月のダイヤ改正後)
  STOPS: { '特急': ['笹塚', '明大前', '千歳烏山'], '急行': ['笹塚', '明大前', '桜上水', '千歳烏山'],
           '区急': ['笹塚', '明大前', '桜上水', '千歳烏山', '仙川'], '各停': 'all' },
  DEST_DOWN: ['京王八王子', '高尾山口', '橋本', '調布', 'つつじヶ丘', '若葉台'],
  DEST_UP: ['新宿', '本八幡', '新線新宿'],
  // 列車が停まらないホームの縁(利用者指示:仙川の上りは北側の単式ホームを使う)。島式(中心 off 0)の北の縁は
  // 上りの線に面するが番線の案内に数えない。[駅, ホームの中心 off, 縁(+1=北)]
  NOSTOP: [['仙川', 0, 1]],
};
const nostop = (st, p, sg) => REF.NOSTOP.some((q) => q[0] === st.n && Math.abs(p.off - q[1]) < 0.5 && q[2] === sg);

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, expect, got, cond ? 'OK' : 'NG']); }

// その s にある線路の横位置の一覧。end>0 なら線路の終端からその長さを除く
// (行き止まりの線路の終端には車止めが立つ。そこは列車が入らない所なので測らない)
/* 線分 p→q(断面の [off,高さ])が矩形 [ox0,ox1]×[yy0,yy1] と交わるか(Liang–Barsky) */
function segHits(p, q, ox0, ox1, yy0, yy1) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - ox0], [dx, ox1 - p[0]], [-dy, p[1] - yy0], [dy, yy1 - p[1]]]) {
    if (Math.abs(pp) < 1e-12) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}
// 線分の、off が [ox0,ox1] にある部分の最も低い高さ(その範囲に無ければ null)
function segMinY(p, q, ox0, ox1) {
  const a = Math.max(Math.min(p[0], q[0]), ox0), b = Math.min(Math.max(p[0], q[0]), ox1);
  if (a > b) return null;
  const at = (o) => (Math.abs(q[0] - p[0]) < 1e-12) ? Math.min(p[1], q[1]) : p[1] + (q[1] - p[1]) * (o - p[0]) / (q[0] - p[0]);
  return Math.min(at(a), at(b));
}
function tracksAt(s, end) {
  const out = [], e = end || 0;
  for (const t of X.TRACKS) if (s >= t.x0 - 0.5 + e && s <= t.x1 + 0.5 - e) out.push(t.zf(s));
  return out;
}
const STA_TAGS = new Set(['ホーム', '点字ブロック', 'ホーム端の柵', 'ホームドア', '階段の囲い', 'エレベーター',
  'ベンチ', '自動販売機', '発車標', '階段の案内', 'ホームの柱', '吊りレール', '屋根の梁', '大屋根', '上屋',
  '駅舎', '駅舎の庇', '大庇', '大庇の柱', '大庇の縁', '橋上駅舎', '橋上駅舎の柱']);

/* ---- 1. 建築限界:駅の部品が列車・パンタグラフの通る空間に入らない ---------- */
{
  let bad = null, n = 0;
  for (const q of X.STRUCT) {
    if (!STA_TAGS.has(q.tag) && q.tag.indexOf('外装') !== 0) continue;
    n++;
    for (const s of [q.s0, (q.s0 + q.s1) / 2, q.s1]) {
      const y = X.railY(s);
      for (const t of tracksAt(s)) {
        const hit = (hw, ya, yb) => q.line ? segHits(q.line[0], q.line[1], t - hw, t + hw, y + ya, y + yb)
          : (q.y1 > y + ya && q.y0 < y + yb && q.o1 > t - hw && q.o0 < t + hw);
        if ((hit(REF.BODY_HW, REF.BODY_Y[0], REF.BODY_Y[1]) || hit(REF.PANTO_HW, REF.PANTO_Y[0], REF.PANTO_Y[1])) && !bad)
          bad = [q.tag, 's=' + s.toFixed(1), 'off ' + q.o0.toFixed(2) + '〜' + q.o1.toFixed(2), '線路 ' + t.toFixed(2)];
      }
    }
  }
  ok('部品が車両の通る空間に入らない', bad === null, '0件(' + n + '部品)', bad ? bad.join(' ') : '0件(' + n + '部品)');
}
// 1b. 実際の頂点でも測る(登録簿に載らない部品の取りこぼし対策)
{
  let bad = null, nv = 0;
  // 線路の座標へ戻す:駅の中心付近の frame を 0.5m 刻みで表にして、最も近い点を探す
  for (const S of X.STG) {
    const c0 = S.st.x, tab = [];
    for (let s = c0 - 400; s <= c0 + 400; s += 0.5) { const f = X.frame(s, 0); tab.push([s, f.x, f.z, f.a]); }
    const meshes = [];
    const walk = (o) => { if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o); for (const c of o.children || []) walk(c); };
    walk(S.g);
    for (const m of meshes) {
      if (m.material === X.MAT.glass || m.material === X.MAT.sign) continue;  // ガラス・看板は登録簿で見る
      const P = m.geometry.attributes.position.array;
      for (let i = 0; i < P.length; i += 9) {          // 3頂点に1つを標本にする
        const x = P[i], yv = P[i + 1], z = P[i + 2];
        let best = null, bd = 1e18;
        for (const r of tab) { const d = (r[1] - x) ** 2 + (r[2] - z) ** 2; if (d < bd) { bd = d; best = r; } }
        if (!best || bd > 60 * 60) continue;
        const s = best[0], a = best[3];
        const off = -(x - best[1]) * Math.sin(a) + (z - best[2]) * Math.cos(a);
        const ds = (x - best[1]) * Math.cos(a) + (z - best[2]) * Math.sin(a);
        const ry = X.railY(s + ds);
        nv++;
        for (const t of tracksAt(s + ds, 2.0)) {
          const d = Math.abs(off - t);
          const inBody = yv > ry + REF.BODY_Y[0] + 0.02 && yv < ry + REF.BODY_Y[1] && d < REF.BODY_HW - 0.02;
          const inPanto = yv > ry + REF.PANTO_Y[0] && yv < ry + REF.PANTO_Y[1] && d < REF.PANTO_HW - 0.02;
          if ((inBody || inPanto) && !bad) bad = [S.st.n, 's=' + (s + ds).toFixed(1), 'off=' + off.toFixed(2), 'h=' + (yv - ry).toFixed(2)];
        }
      }
    }
  }
  ok('頂点が車両の通る空間に入らない', bad === null, '0点', bad ? bad.join(' ') : '0点(標本' + nv + '点)');
}
// 1c. 線路の上(パンタグラフの幅の範囲)に架かる屋根・梁は架線設備より上。
//     軒を下げた屋根(上北沢)は線路の上だけ高ければよいので、傾いた面は線分で測る
{
  let bad = null, n = 0;
  for (const q of X.STRUCT) {
    if (q.tag !== '大屋根' && q.tag !== '屋根の梁' && q.tag !== '橋上駅舎') continue;
    const s = (q.s0 + q.s1) / 2, y = X.railY(s);
    for (const t of tracksAt(s)) {
      const ox0 = t - REF.PANTO_HW, ox1 = t + REF.PANTO_HW;
      const low = q.line ? segMinY(q.line[0], q.line[1], ox0, ox1) : ((q.o1 > ox0 && q.o0 < ox1) ? q.y0 : null);
      if (low === null) continue;
      n++;
      if (low < y + REF.ROOF_MIN - 1e-6 && !bad) bad = [q.tag, 's=' + s.toFixed(0), '線路 ' + t.toFixed(2), (low - y).toFixed(2) + 'm'];
    }
  }
  ok('線路の上の屋根は架線柱より上', bad === null, '下端≥' + REF.ROOF_MIN + 'm', bad ? bad.join(' ') : '全て(' + n + '箇所)');
}

/* ---- 2. 階段・エレベーター --------------------------------------------- */
{
  let bad = null, nS = 0, nE = 0;
  for (const w of X.STAIRS) {
    if (w.kind === '階段') nS++; else nE++;
    // そのホーム(同じ駅で off の範囲が重なるもの)を探す
    const pl = X.PLATS.find((p) => w.o0 >= p.off - p.hw - 1e-6 && w.o1 <= p.off + p.hw + 1e-6 &&
      w.s0 >= p.x0 && w.s1 <= p.x1);
    if (!pl) { if (!bad) bad = [w.st.n, w.kind, 'ホームからはみ出す']; continue; }
    // 線路側の縁からの距離(点字ブロックより内側=縁から0.8m以上)
    for (const sg of [-1, 1]) {
      const edge = pl.off + sg * pl.hw;
      const hasTrack = tracksAt((w.s0 + w.s1) / 2).some((t) => sg * (t - edge) > 0 && sg * (t - edge) < 2.6);
      if (!hasTrack) continue;
      const d = sg > 0 ? edge - w.o1 : w.o0 - edge;
      if (d < REF.TACTILE_KEEP && !bad) bad = [w.st.n, w.kind, '縁から' + d.toFixed(2) + 'm'];
    }
  }
  ok('階段・EVがホームに収まる', bad === null, '縁から' + REF.TACTILE_KEEP + 'm以上', bad ? bad.join(' ') : '階段' + nS + '・EV' + nE);
  // 島式・相対式の各ホームに2か所(仙川の単式=幅3.4mは除く)。離れた場所にあるものだけ数える
  let miss = null, nP = 0;
  for (const p of X.PLATS) {
    if (p.hw < 2.0) continue;
    nP++;
    const W = X.STAIRS.filter((w) => w.kind === '階段' && w.o0 >= p.off - p.hw && w.o1 <= p.off + p.hw &&
      w.s0 >= p.x0 && w.s1 <= p.x1).sort((a, b) => a.s0 - b.s0);
    let k = 0, last = -1e9;
    for (const w of W) if (w.s0 >= last + REF.STAIR_GAP) { k++; last = w.s1; }
    if (k < REF.STAIRS_PER_PLAT && !miss) miss = 'off=' + p.off.toFixed(2) + ' s=' + p.x0.toFixed(0) + ' ' + k + 'か所';
  }
  ok('各ホームに階段が' + REF.STAIRS_PER_PLAT + 'か所', miss === null, '幅4m以上の全ホーム(' + nP + '面)', miss || '全て');
  // 地上駅(線路が地平)の階段は上の橋上駅舎へ上がる(利用者指示:仙川)。高架駅は高架下へ降りる。
  // 地上か高架かは検証側がレール面の高さで決める(3m 未満=地上)
  let badUp = null, nUp = 0;
  for (const w of X.STAIRS) {
    if (w.kind !== '階段') continue;
    const ground = X.railY((w.s0 + w.s1) / 2) < 3;
    if (ground) nUp++;
    if (!!w.up !== ground && !badUp) badUp = [w.st.n, ground ? '地上駅なのに下りる' : '高架駅なのに上がる'];
    if (ground && !X.STRUCT.some((q) => q.tag === '橋上駅舎' && q.s0 <= Math.max(w.s0, w.s1) + 0.5 && q.s1 >= Math.min(w.s0, w.s1) - 0.5 &&
      q.o0 <= w.o0 && q.o1 >= w.o1) && !badUp) badUp = [w.st.n, '上った先に橋上駅舎が無い'];
  }
  ok('地上駅の階段は橋上駅舎へ上がる', badUp === null && nUp > 0, '地上駅=上り・高架駅=下り', badUp ? badUp.join(' ') : '上り' + nUp + 'か所');
  /* 高架駅の階段は高架下の駅舎へ降りる:井戸の奥(降りた先=桁の下へ続く端)と、エレベーターが駅舎(登録簿 '駅舎')の
     s の範囲に入ること。駅舎が駅の中心に無い駅(下高井戸=西端部)で、階段だけ中ほどに残る誤りを見る */
  let badIn = null, nIn = 0;
  // 登録簿は掃引を6m 以下の区間に分けて残すので、つながった区間を1つの範囲にまとめてから見る
  const spans = (L) => { const S = L.map((q) => [q.s0, q.s1]).sort((u, v) => u[0] - v[0]), out = [];
    for (const q of S) { if (out.length && q[0] <= out[out.length - 1][1] + 0.5) out[out.length - 1][1] = Math.max(out[out.length - 1][1], q[1]); else out.push(q.slice()); }
    return out.map((q) => ({ s0: q[0], s1: q[1] })); };
  for (const w of X.STAIRS) {
    if (w.up || X.railY((w.s0 + w.s1) / 2) < 3) continue;
    const B = spans(X.STRUCT.filter((q) => q.tag === '駅舎' && q.s0 <= w.s1 + 60 && q.s1 >= w.s0 - 60));
    if (!B.length) continue;                                   // 高架下駅舎を持たない駅(笹塚・八幡山)
    const inner = w.kind === '階段' ? (w.dir > 0 ? w.s1 : w.s0) : (w.s0 + w.s1) / 2;
    nIn++;
    if (!B.some((q) => inner >= q.s0 + 0.5 && inner <= q.s1 - 0.5) && !badIn)
      badIn = [w.st.n, w.kind, 's=' + (inner - w.st.x).toFixed(0) + '(駅舎 ' + B.map((q) => (q.s0 - w.st.x).toFixed(0) + '〜' + (q.s1 - w.st.x).toFixed(0)).join(',') + ')'];
  }
  ok('高架駅の階段・EVは駅舎へ降りる', badIn === null && nIn > 0, '降りた先が駅舎の範囲', badIn ? badIn.join(' ') : nIn + 'か所');
  /* 下高井戸の駅舎は駅の西端部の一階(利用者指示)。基準:駅の中心を含まず、西端(ホームの西端 +105m)まで届く */
  { const sh = X.STA.find((s) => s.n === '下高井戸');
    const B = X.STRUCT.filter((q) => q.tag === '駅舎' && q.s1 > sh.x - 120 && q.s0 < sh.x + 140);
    const s0 = Math.min(...B.map((q) => q.s0)) - sh.x, s1 = Math.max(...B.map((q) => q.s1)) - sh.x;
    ok('下高井戸の駅舎は駅の西端部', B.length > 0 && s0 > 20 && s1 >= 100, '中心を含まず西端(+105m)まで',
      B.length ? (s0.toFixed(0) + '〜' + s1.toFixed(0) + 'm') : '無い'); }
}
// 2b. ホームの柱・ベンチ・自動販売機は井戸・EVの中に立たない(階段を増やしたので位置がぶつかりうる)
{
  let bad = null, n = 0;
  const FLOOR = new Set(['ホームの柱', 'ベンチ', '自動販売機']);
  for (const q of X.STRUCT) {
    if (!FLOOR.has(q.tag)) continue;
    n++;
    for (const w of X.STAIRS)
      if (q.s1 > w.s0 && q.s0 < w.s1 && q.o1 > w.o0 && q.o0 < w.o1 && !bad) bad = [w.st.n, w.kind, q.tag, 's=' + q.s0.toFixed(1)];
  }
  ok('柱・ベンチ等が井戸・EVに立たない', bad === null, '0件', bad ? bad.join(' ') : '0件(' + n + '個)');
  // 架線柱も階段・エレベーターの中に立たない(仙川は道路橋・橋上駅舎の間に階段があり、柱の位置が寄せられる)
  let bp = null;
  for (const q of X.POLES) for (const w of X.STAIRS)
    if (q.s + q.r > w.s0 && q.s - q.r < w.s1 && q.o + q.r > w.o0 && q.o - q.r < w.o1 && !bp) bp = [w.st.n, w.kind, 's=' + q.s.toFixed(1), 'off=' + q.o.toFixed(2)];
  ok('架線柱が階段・EVに立たない', bp === null && X.POLES.length > 0, '0本', bp ? bp.join(' ') : '0本(' + X.POLES.length + '本)');
}

// 2c. 乗務員用のホームモニターは置かない(利用者指示:車上の車内モニター式とする)
ok('乗務員モニターを置かない', !X.STRUCT.some((q) => q.tag === '乗務員モニター'), '0台',
  X.STRUCT.filter((q) => q.tag === '乗務員モニター').length + '台');
// 2d. 階段口の案内(利用者指示):ホームから階段を望む向き=黄の「出口」(降りた乗客に見える)、
//     階段からホームを望む向き=白の番線案内。番線は検証側で数え直す(ホームの縁の外 0.5〜2.6m の線路を
//     南から 1,2,…)。下り(西行き)は左側通行で、進行方向の左の線=京王八王子方面。
//     発車標は、階段口のホーム側にそのホームの線ごとに1台(島式は線の側の半分の上)。
{
  const G = X.GUIDES;
  const sub = (a, b) => [a.x - b.x, a.z - b.z];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const staTrk = new Map();
  for (const st of X.STA) {
    const pr = X.platRange(st), pm = (pr[0] + pr[1]) / 2, L = [];
    for (const p of X.PLATS) {
      if (!(p.x0 <= pm && p.x1 >= pm)) continue;
      for (const sg of [-1, 1]) {
        if (nostop(st, p, sg)) continue;                     // 列車が停まらない縁(仙川の島式の北)
        const edge = p.off + sg * p.hw;
        for (const t of X.TRACKS) {
          if (pm < t.x0 || pm > t.x1) continue;
          const o = t.zf(pm), d = sg * (o - edge);
          if (d > 0.5 && d < 2.6 && !L.some((q) => Math.abs(q.off - o) < 0.5)) L.push({ off: o });
        }
      }
    }
    L.sort((a, b) => a.off - b.off).forEach((q, j) => { q.n = j + 1; });
    // 下りの側:+s(西)へ進むときの左(上×進行方向)が off のどちら向きか
    const f0 = X.frame(pm, 0), tW = sub(X.frame(pm + 1, 0), f0), nO = sub(X.frame(pm, 1), f0);
    const downSign = Math.sign(dot([tW[1], -tW[0]], nO));
    staTrk.set(st, { L: L, down: downSign, pm: pm });
  }
  const platOf = (w) => X.PLATS.find((p) => w.o0 >= p.off - p.hw - 1e-6 && w.o1 <= p.off + p.hw + 1e-6 && w.s0 >= p.x0 && w.s1 <= p.x1);
  let badFace = null, badNum = null, badLR = null, badDest = null, badDep = null, nS = 0, nD = 0;
  for (const w of X.STAIRS) {
    if (w.kind !== '階段') continue;
    const e0 = w.dir > 0 ? w.s0 : w.s1, S = staTrk.get(w.st), p = platOf(w);
    const own = S.L.filter((q) => p && [-1, 1].some((sg) => { if (nostop(w.st, p, sg)) return false;
      const d = sg * (q.off - (p.off + sg * p.hw)); return d > 0.5 && d < 2.6; }));
    const g = G.find((q) => q.kind === 'stair' && q.st === w.st && Math.abs(q.s - e0) <= 1.0 && q.off >= w.o0 - 1e-6 && q.off <= w.o1 + 1e-6);
    if (!g) { if (!badFace) badFace = [w.st.n, 's=' + e0.toFixed(0), '案内が無い']; continue; }
    nS++;
    // 向き:黄の出口の面の法線はホーム側(-dir)、番線案内は階段側(+dir)。'e'=-s 向き/'w'=+s 向き
    const want = w.dir > 0 ? ['e', 'w'] : ['w', 'e'];
    if ((g.faceP !== want[0] || g.faceS !== want[1] || Math.sign(e0 - g.s) !== Math.sign(w.dir)) && !badFace)
      badFace = [w.st.n, 's=' + e0.toFixed(0), '出口' + g.faceP + '/番線' + g.faceS + '(期待 ' + want.join('/') + ')'];
    // 番線の数・番号・方面
    if (g.shown.length !== own.length && !badNum) badNum = [w.st.n, 's=' + e0.toFixed(0), g.shown.length + '線を表示/ホームの線' + own.length];
    for (const q of g.shown) {
      const m = S.L.find((r) => Math.abs(r.off - q.off) < 0.5);
      if ((!m || m.n !== q.n) && !badNum) badNum = [w.st.n, 'off ' + q.off.toFixed(2), q.n + '番線(期待 ' + (m ? m.n : '?') + ')'];
      const isDown = Math.sign(q.off) === S.down;
      if ((isDown ? q.dest.indexOf('京王八王子') < 0 : q.dest.indexOf('新宿') < 0) && !badDest)
        badDest = [w.st.n, q.n + '番線', q.dest];
    }
    // 左右:番線案内を見る人は階段側に立ち、ホーム側(-dir·s)を向く。左に表示した線が見る人の左にある
    if (g.shown.length === 2) {
      const tS = sub(X.frame(g.s + 1, g.off), X.frame(g.s, g.off)), look = [-w.dir * tS[0], -w.dir * tS[1]], left = [look[1], -look[0]];
      const d = sub(X.frame(g.s, g.shown[0].off), X.frame(g.s, g.shown[1].off));
      if (dot(d, left) <= 0 && !badLR) badLR = [w.st.n, 's=' + e0.toFixed(0), '左に' + g.shown[0].n + '番線・右に' + g.shown[1].n + '番線'];
    }
    // 発車標:ホームの線ごとに、階段口のホーム側 REF.DEP_DIST の範囲に1台。ホームに収まり、島式は線の側
    for (const q of own) {
      const d = G.find((r) => r.kind === 'dep' && r.st === w.st && Math.abs(r.toff - q.off) < 0.5 && Math.abs(r.off - p.off) < p.hw &&
        Math.sign(e0 - r.s) === Math.sign(w.dir) && Math.abs(r.s - e0) >= REF.DEP_DIST[0] && Math.abs(r.s - e0) <= REF.DEP_DIST[1]);
      if (!d) { if (!badDep) badDep = [w.st.n, 's=' + e0.toFixed(0), q.n + '番線の発車標が無い']; continue; }
      nD++;
      if (d.n !== q.n && !badDep) badDep = [w.st.n, q.n + '番線に' + d.n + '番線の表示'];
      if (Math.abs(d.off - p.off) + d.w / 2 > p.hw - REF.DEP_EDGE && !badDep) badDep = [w.st.n, q.n + '番線', 'ホームの縁に近い'];
      if (own.length === 2 && Math.sign(d.off - p.off) !== Math.sign(q.off - p.off) && !badDep) badDep = [w.st.n, q.n + '番線', '線と反対の側'];
    }
  }
  ok('階段口:ホーム側=出口(黄)/階段側=番線案内(白)', badFace === null && nS > 0, '全ての階段', badFace ? badFace.join(' ') : nS + 'か所');
  ok('番線案内の番線(南から1,2,…)', badNum === null, 'ホームの線と一致', badNum ? badNum.join(' ') : '全て');
  ok('番線案内の左右が見る向きと合う', badLR === null, '全て', badLR ? badLR.join(' ') : '全て');
  ok('番線案内の方面(下り=左側通行の側)', badDest === null, '下り=京王八王子方面/上り=新宿方面', badDest ? badDest.join(' ') : '全て');
  ok('発車標が階段口に線ごと', badDep === null && nD > 0, 'ホーム側' + REF.DEP_DIST.join('〜') + 'm・縁から' + REF.DEP_EDGE + 'm内側', badDep ? badDep.join(' ') : nD + '台');
  // 発車標の時刻表:どの時刻でも、次の2本は今より後・REF.DEP_WITHIN 分以内、その駅に止まる種別、向きの合う行先
  let badT = null, nT = 0;
  for (const k of Object.keys(REF.DEP_NOW)) {
    X.pidsSetTime(k);
    for (const d of G) {
      if (d.kind !== 'dep') continue;
      const L = X.depList(X.STA.indexOf(d.st), d.t), now = REF.DEP_NOW[k], down = Math.sign(d.toff) === staTrk.get(d.st).down;
      if (L.length !== 2 && !badT) badT = [d.st.n, d.n + '番線', k, L.length + '本'];
      for (const e of L) {
        nT++;
        const stops = REF.STOPS[e[0]];
        if (!stops && !badT) badT = [d.st.n, '種別 ' + e[0]];
        else if (stops !== 'all' && stops.indexOf(d.st.n) < 0 && !badT) badT = [d.st.n, e[0] + 'は止まらない'];
        if ((e[2] < now || e[2] - now > REF.DEP_WITHIN) && !badT) badT = [d.st.n, k, '発車 ' + e[2] + '分(今 ' + now + ')'];
        if ((down ? REF.DEST_DOWN : REF.DEST_UP).indexOf(e[1]) < 0 && !badT) badT = [d.st.n, d.n + '番線', '行先 ' + e[1]];
      }
    }
  }
  X.pidsSetTime('noon');
  ok('発車標の時刻表', badT === null && nT > 0, '止まる種別・今から' + REF.DEP_WITHIN + '分以内・向きの合う行先', badT ? badT.join(' ') : nT + '本(4つの時刻)');
}

/* ---- 3. 駅名標:駅ごとの数と、見る向きに対する左右の駅名 ---------------------- */
{
  // 看板のこま k → 駅 i と種類(0:左に新宿方 / 1:左に八王子方 / 2:駅舎)
  let badN = null, badLR = null, badSt = null, n = 0;
  const perSta = X.STA.map(() => 0);
  for (const g of X.SIGNS) {
    if (g.k >= 3 * X.STA.length) continue;                // 共通(出口など)
    const i = Math.floor(g.k / 3), v = g.k % 3;
    // その看板がどの駅にあるか(位置から独立に決める)
    let near = 0, bd = 1e9;
    X.STA.forEach((st, j) => { const d = Math.abs(st.x - g.s); if (d < bd) { bd = d; near = j; } });
    if (near !== i && !badSt) badSt = [X.STA[near].n + 'に' + X.STA[i].n + 'の看板', 's=' + g.s.toFixed(0)];
    if (v === 2) continue;
    perSta[i]++; n++;
    if (g.face !== 1 && g.face !== -1) { if (!badLR) badLR = ['駅名標が線路を向いていない']; continue; }
    // 見る人は看板の正面に立ち、看板と逆向き(-face の off 方向)を向く。
    // その人の左手側にあるのが新宿方(s が小さい側)か八王子方かを座標から求める
    const f = X.frame(g.s, g.off), fe = X.frame(g.s - 10, g.off), fn = X.frame(g.s, g.off + g.face);
    const look = [-(fn.x - f.x), -(fn.z - f.z)];               // 見る向き(水平)
    const left = [look[1], -look[0]];                           // 上=(0,1,0) × look の水平成分
    // 右手系 X=東, Z=南, Y=上:上×前 = 左。(0,1,0)×(lx,0,lz) = (lz,0,-lx)
    const toEast = [fe.x - f.x, fe.z - f.z];
    const eastIsLeft = (left[0] * toEast[0] + left[1] * toEast[1]) > 0;
    const want = eastIsLeft ? 0 : 1;
    if (v !== want && !badLR) badLR = [X.STA[i].n, 's=' + g.s.toFixed(0), 'face=' + g.face];
  }
  X.STA.forEach((st, i) => {
    const plats = X.PLATS.filter((p) => p.x0 < st.x + 160 && p.x1 > st.x - 160).length;
    if (perSta[i] < REF.SIGN_PER_PLAT * 2 * Math.max(1, plats) && !badN) badN = [st.n, perSta[i] + '面'];
  });
  ok('駅名標の数', badN === null, '1ホーム' + REF.SIGN_PER_PLAT + '組以上', badN ? badN.join(' ') : n + '面');
  ok('駅名標の左右の駅名が見る向きと合う', badLR === null, '全て', badLR ? badLR.join(' ') : '全て');
  ok('看板の駅名がその駅', badSt === null, '全て', badSt ? badSt.join(' ') : '全て');
}

/* ---- 4. 公表デザインの要点が形になっている ----------------------------------- */
{
  let bad = null;
  const got = [];
  for (const name of Object.keys(REF.DESIGN)) {
    const st = X.STA.find((s) => s.n === name);
    if (!st) { bad = bad || [name, '駅が無い']; continue; }
    const tags = new Set(X.STRUCT.filter((q) => (q.s0 + q.s1) / 2 > st.x - 140 && (q.s0 + q.s1) / 2 < st.x + 140).map((q) => q.tag));
    const miss = REF.DESIGN[name].filter((t) => !tags.has(t));
    if (miss.length && !bad) bad = [name, miss.join('・') + 'が無い'];
    got.push(name + ' ' + REF.DESIGN[name].length);
  }
  ok('公表デザインの要点', bad === null, '7駅すべて', bad ? bad.join(' ') : '7駅すべて');
  // パースから読んだ寸法(北面で測る)
  const north = (tag) => X.STRUCT.filter((q) => q.tag === tag && q.o0 > 0);
  const pitchOf = (list) => {
    const v = list.map((q) => (q.s0 + q.s1) / 2).sort((a, b) => a - b);
    return v.length > 1 ? (v[v.length - 1] - v[0]) / (v.length - 1) : 0;
  };
  const inR = (v, r) => v >= r[0] && v <= r[1];
  // 千歳烏山の格子は平織り:縦の帯が格子の目の間隔で揃って並び、交点ごとに横と縦の帯の表裏が
  // 上下・左右で交互に入れ替わる(利用者指示。2026-10 小口積みから訂正)
  { const byC = new Map();
    for (const q of north('外装:格子(縦)')) {
      const k = Math.round(q.y0 * 50);
      if (!byC.has(k)) byC.set(k, []);
      byC.get(k).push((q.s0 + q.s1) / 2);
    }
    const C = [...byC.keys()].sort((a, b) => a - b).map((k) => byC.get(k).sort((a, b) => a - b));
    let pmin = 1e9, pmax = 0, bad = null;
    for (const c of C) for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d); }
    for (let r = 1; r < C.length; r++)                // 縦の帯は段ごとにずれず、同じ位置に揃う
      if ((C[r].length !== C[0].length || C[r].some((v, i) => Math.abs(v - C[0][i]) > 0.01)) && !bad) bad = (r + 1) + '段目で縦の帯がずれる';
    ok('千歳烏山の格子の目', C.length >= REF.LATTICE_ROWS && pmin >= REF.LATTICE[0] && pmax <= REF.LATTICE[1],
      REF.LATTICE.join('〜') + 'm・' + REF.LATTICE_ROWS + '段以上',
      C.length ? pmin.toFixed(2) + '〜' + pmax.toFixed(2) + 'm・' + C.length + '段' : '無し');
    // 平織り:交点ごとに表(外側)の帯が横と縦で入れ替わる。右隣・上の交点とは表裏が逆
    const key = (q) => q.sg + ',' + q.r + ',' + q.c, W = new Map(X.WEAVE.map((q) => [key(q), q]));
    const outerH = (q) => Math.abs(q.hor) > Math.abs(q.ver);
    let n = 0;
    for (const q of X.WEAVE) {
      n++;
      const sep = Math.abs(Math.abs(q.hor) - Math.abs(q.ver));
      if ((sep < REF.WEAVE_SEP[0] || sep > REF.WEAVE_SEP[1]) && !bad) bad = '交点の層の差 ' + sep.toFixed(3) + 'm';
      for (const nb of [W.get(q.sg + ',' + q.r + ',' + (q.c + 1)), W.get(q.sg + ',' + (q.r + 1) + ',' + q.c)])
        if (nb && outerH(nb) === outerH(q) && !bad) bad = '段' + q.r + '・列' + q.c + 'の隣と表裏が同じ';
    }
    ok('千歳烏山の格子が平織り(交点ごとに表裏が交互)', bad === null && n > 100, '上下・左右で交互・層の差' + REF.WEAVE_SEP.join('〜') + 'm',
      bad || n + '交点'); }
  { const L = north('外装:木の縦格子'), pt = pitchOf(L);
    const dep = L.length ? Math.min.apply(null, L.map((q) => q.o1 - q.o0)) : 0;
    ok('芦花公園の縦格子(間隔・見込み)', inR(pt, REF.FIN_PITCH) && dep >= REF.FIN_DEPTH - 1e-6,
      REF.FIN_PITCH.join('〜') + 'm・見込み≥' + REF.FIN_DEPTH, pt.toFixed(2) + 'm・' + dep.toFixed(2) + 'm');
    const eave = north('外装:深い軒'), fo = L.length ? Math.max.apply(null, L.map((q) => q.o1)) : 0;
    const eo = eave.length ? Math.max.apply(null, eave.map((q) => q.o1)) : 0;
    ok('芦花公園の深い軒', eo - fo >= REF.EAVE_OVER, '縦格子より' + REF.EAVE_OVER + 'm以上外', (eo - fo).toFixed(2) + 'm'); }
  { const pt = pitchOf(north('外装:縦材'));
    ok('代田橋の細い縦材の間隔', inR(pt, REF.POST_PITCH), REF.POST_PITCH.join('〜') + 'm', pt.toFixed(2) + 'm');
    const F = north('外装:流れのルーバー').map((q) => (q.y0 + q.y1) / 2 - X.railY((q.s0 + q.s1) / 2));
    const lo = F.length ? Math.min.apply(null, F) : 0, hi = F.length ? Math.max.apply(null, F) : 0;
    ok('代田橋の流れ(帯が上下に動く)', hi - lo >= REF.FLOW_SPAN, '≥' + REF.FLOW_SPAN + 'm',
      (hi - lo).toFixed(2) + 'm(' + lo.toFixed(1) + '〜' + hi.toFixed(1) + ')'); }
  { const n = north('外装:紫のアクセント').length;
    ok('明大前の紫の横帯', n >= REF.PURPLE_MIN, '片側' + REF.PURPLE_MIN + '本以上', n + '本'); }
  { const E = X.STRUCT.filter((q) => q.tag === '大庇の縁').map((q) => q.y0);
    const sw = E.length ? Math.max.apply(null, E) - Math.min.apply(null, E) : 0;
    ok('下高井戸の大庇の反り', sw >= REF.SWEEP, '縁の高さの差≥' + REF.SWEEP + 'm', sw.toFixed(2) + 'm');
    /* 置き場所(利用者指示・公表パース):駅の西南。南側(off<0)だけで、駅の中心より西(s が大きい側)へ張り出し、
       反り上がるのは西の端(パースは南から望む画で、左=西の端が反る) */
    const sh = X.STA.find((s) => s.n === '下高井戸');
    const R = X.STRUCT.filter((q) => q.tag === '大庇の縁');
    const south = R.length > 0 && R.every((q) => q.o1 < 0);
    const sMin = Math.min(...R.map((q) => q.s0)), sMax = Math.max(...R.map((q) => q.s0));
    const top = R.reduce((a, q) => (q.y0 > a.y0 ? q : a), R[0] || { y0: 0, s0: 0 });
    ok('下高井戸の大庇は駅の西南', south && (sMin + sMax) / 2 > sh.x + 5 && sMax > sh.x + 30,
      '南側だけ・中心より西(s+)へ', (south ? '南' : '北にもある') + '・s ' + (sMin - sh.x).toFixed(0) + '〜' + (sMax - sh.x).toFixed(0) + 'm');
    ok('下高井戸の大庇は西の端で反る', R.length > 0 && top.s0 >= sMax - 4.01, '最も高い縁=西端', '最も高い縁 s ' + (top.s0 - sh.x).toFixed(0) + 'm(西端 ' + (sMax - sh.x).toFixed(0) + 'm)'); }
  { const B = north('外装:白い弓形の柱'), pt = pitchOf(B);
    const top = B.length ? Math.min.apply(null, B.map((q) => q.y1 - X.railY((q.s0 + q.s1) / 2))) : 0;
    ok('上北沢の白い弓形の柱', inR(pt, REF.BOW_PITCH) && top >= REF.BOW_TOP,
      REF.BOW_PITCH.join('〜') + 'm・上端≥' + REF.BOW_TOP, pt.toFixed(1) + 'm・' + top.toFixed(2) + 'm'); }
  // 模様を画像で持つ外装(レンガ・横ルーバー・石積み・縦リブ)。その材質が駅の群にあること
  const mats = (name) => {
    const S = X.STG.find((q) => q.st.n === name), out = new Set();
    const walk = (o) => { if (o.isMesh) out.add(o.material); for (const c of o.children || []) walk(c); };
    if (S) walk(S.g);
    return out;
  };
  for (const [n, m, lab] of [['代田橋', X.MAT_BRICK, 'レンガ'], ['明大前', X.MAT_LOUVER, '横ルーバー'],
    ['明大前', X.MAT.frost, '半透明の壁'], ['芦花公園', X.MAT_STONE, '石積み'], ['上北沢', X.MAT_STONE, '石積み'],
    ['桜上水', X.MAT_RIB, '縦リブ']])
    ok(n + 'の' + lab, mats(n).has(m), lab + 'の材質', mats(n).has(m) ? 'あり' : 'なし');
}

/* ---- 5. 軽さ:駅ごとの Mesh の数と、細部が LOD に載っていること --------------- */
{
  let worst = null, total = 0;
  for (const S of X.STG) {
    let n = 0;
    const walk = (o) => { if (o.isMesh) n++; for (const c of o.children || []) walk(c); };
    walk(S.g);
    total += n;
    if (!worst || n > worst[1]) worst = [S.st.n, n];
  }
  ok('駅あたりの描画の呼び出し', worst[1] <= REF.CALLS_PER_STA, '≤' + REF.CALLS_PER_STA + '回', worst.join(' ') + '回(全駅 ' + total + ')');
  const lod = X.STG.filter((S) => X.LODS.some((L) => L.o === S.d)).length;
  ok('駅の細部が LOD に載る', lod === X.STG.length, X.STG.length + '駅', lod + '駅');
}

/* ---- ホームの拡幅と待避線の分岐(2026-10-11 利用者指示) --------------------------------------------
   ・明大前・桜上水・千歳烏山:島式2面4線のホームを1.5m 広く(5.0→6.5m)、本線と待避線の分岐を駅へ30m 寄せる
     (分岐の先端は駅の中心から 226.5m だった→196.5m)。待避線はホームの端で曲がり、ホームの縁とホームドアの列は線路に沿う
   ・仙川の上りホーム(北の単式。3.4m)と井の頭線のホーム(3.4m)を5m 広く(8.4m)。高架の柱は井の頭線のホームと擁壁に立たない
   2026-10-13 利用者指示:2面4線の本線と待避線の間を 11m に(以前 9.6m。ホームは 6.5+1.4=7.9m)、分岐をさらに駅へ50m 寄せる(196.5→146.5m)。
   芦花公園の相対式ホームを2m ずつ広く(4.5→6.5m) */
{
  const RW = { QUAD: ['明大前', '桜上水', '千歳烏山'], QUAD_W: 5.0 + 1.5 + 1.4, TIP: 226.5 - 30 - 50, TIP_TOL: 3, ROKA_W: 4.5 + 2, EDGE: [1.40, 1.60], PSD_IN: 0.12,
    SENGAWA_N: 3.4 + 5, INO_W: 3.4 + 5, INO_EDGE: 1.40 + 0.15, INO_CLEAR: 0.5, INO_FLOOR: 1.05 };   // 井の頭線:縁=車体の半幅 1.40+0.15・床はレール面+1.05
  // ホームの幅
  let bW = null;
  for (const n of RW.QUAD) {
    const st = X.STA.find((z) => z.n === n), L = X.PLATS.filter((q) => Math.abs((q.x0 + q.x1) / 2 - st.x) < 60);
    if (L.length !== 2 || L.some((q) => Math.abs(2 * q.hw - RW.QUAD_W) > 0.01)) { bW = n + ' ' + L.map((q) => (2 * q.hw).toFixed(2)).join('/'); break; }
  }
  { const st = X.STA.find((z) => z.n === '仙川'), q = X.PLATS.filter((q) => Math.abs((q.x0 + q.x1) / 2 - st.x) < 60 && q.off > 3).sort((a, b) => b.off - a.off)[0];
    if (!bW && (!q || Math.abs(2 * q.hw - RW.SENGAWA_N) > 0.01)) bW = '仙川の北 ' + (q ? (2 * q.hw).toFixed(2) : 'なし'); }
  { const st = X.STA.find((z) => z.n === '芦花公園'), L = X.PLATS.filter((q) => Math.abs((q.x0 + q.x1) / 2 - st.x) < 60);
    if (!bW && (L.length !== 2 || L.some((q) => Math.abs(2 * q.hw - RW.ROKA_W) > 0.01))) bW = '芦花公園 ' + L.map((q) => (2 * q.hw).toFixed(2)).join('/'); }
  ok('ホームの幅(拡幅)', bW === null, '2面4線 ' + RW.QUAD_W + 'm・仙川の北 ' + RW.SENGAWA_N + 'm・芦花公園 ' + RW.ROKA_W + 'm', bW || '一致');
  // 分岐の先端(本線→待避線)
  let bT = null, nT = 0;
  for (const n of RW.QUAD) {
    const st = X.STA.find((z) => z.n === n);
    for (const T of X.TURNOUTS.filter((T) => /^本線/.test(T.A.id) && /副本線/.test(T.B.id) && Math.abs(T.s - st.x) < 400)) {
      nT++; if (Math.abs(Math.abs(T.s - st.x) - RW.TIP) > RW.TIP_TOL && !bT) bT = n + ' ' + (T.s - st.x).toFixed(1) + 'm';
    }
  }
  ok('待避線の分岐の位置', bT === null && nT === 12, '駅の中心から ' + RW.TIP + '±' + RW.TIP_TOL + 'm(12組)', bT || nT + '組');
  // 待避線の側の縁が線路に沿う(描いたホームの面=登録簿 'ホーム' の区間)
  let bE = null, nE = 0;
  for (const n of RW.QUAD) {
    const st = X.STA.find((z) => z.n === n);
    const loops = X.TRACKS.filter((t) => /副本線/.test(t.id) && st.x > t.x0 && st.x < t.x1);
    for (const q of X.STRUCT) {
      if (q.tag !== 'ホーム' || Math.abs((q.s0 + q.s1) / 2 - st.x) > 110) continue;
      for (const t of loops) {
        const sg = Math.sign(t.zf(st.x)), m = (q.s0 + q.s1) / 2, edge = sg > 0 ? q.o1 : -q.o0;
        if (sg > 0 ? q.o0 < 0 : q.o1 > 0) continue;
        const gap = sg * t.zf(m) - edge;
        if (gap > 3) continue;                       // 井戸の脇の内側の片(外の縁は井戸)
        nE++;
        if ((gap < RW.EDGE[0] || gap > RW.EDGE[1]) && !bE) bE = n + ' ' + t.id + ' s=' + (m - st.x).toFixed(0) + ' ' + gap.toFixed(2) + 'm';
      }
    }
  }
  ok('待避線の側のホームの縁が線路に沿う', bE === null && nE > 0, '線路の中心から縁 ' + RW.EDGE.join('〜') + 'm(ホームの端まで)', bE || nE + '区間');
  // ホームドアの戸(描いたインスタンス)も線路に沿う:面する線路から 縁の距離−0.12
  let bD = null, nD = 0;
  for (const r of X.PSD) {
    if (RW.QUAD.indexOf(r.st.n) < 0 || !r.inst || !r.inst.mats) continue;
    const t = X.TRACKS.filter((t) => r.st.x > t.x0 && r.st.x < t.x1).sort((a, b) => Math.abs(a.zf(r.st.x) - r.off) - Math.abs(b.zf(r.st.x) - r.off))[0];
    for (const M of r.inst.mats) {
      const q = X.prjXY(M.p.x, M.p.z); if (q.s < t.x0 || q.s > t.x1) continue; nD++;
      const gap = Math.abs(t.zf(q.s) - q.off), want = (1.55 + RW.PSD_IN);   // 列は縁の 0.12m 内側
      if (Math.abs(gap - want) > 0.05 && !bD) bD = r.st.n + ' ' + r.off + ' s=' + (q.s - r.st.x).toFixed(0) + ' ' + gap.toFixed(2) + 'm';
    }
  }
  ok('ホームドアの戸が線路に沿う', bD === null && nD > 0, '面する線路から ' + (1.55 + RW.PSD_IN).toFixed(2) + '±0.05m', bD || nD + '枚');
  /* 井の頭線のホーム(2026-10-27 実際の線路の位置に):縁は面する線路(RAW.rail の tr の実際の線路。検証側の曲線 tools/xcurve.js)から
     車体の半幅+0.15m、幅 8.4m、上面は車両の床の 0.1m 以内。高架の柱は線路からホームの背面+擁壁(0.5m)より外 */
  const XI = require('./xcurve')(X, X.RAW.rail.ino, 'cross'), IP = X.INO_PLAT, railTop = X.XR.RAILY + X.XR.RAILH / 2;
  let bI = Math.abs(IP.top - (railTop + RW.INO_FLOOR)) > 0.1 ? '上面 ' + IP.top.toFixed(2) + 'm' : null, nI = 0, wE = 0;
  for (const [k, pl] of [[1, IP.up], [0, IP.dn]]) for (let u = pl[0]; u <= pl[1] + 1e-6; u += 2) {
    const P = IP.at(k, u), e = X.INO.pos(u, P.edge), b = X.INO.pos(u, P.back), d = XI.dTrack(k, e.x, e.z), w = Math.hypot(b.x - e.x, b.z - e.z), o = XI.dTrack(1 - k, e.x, e.z);
    nI++; wE = Math.max(wE, Math.abs(d - RW.INO_EDGE));
    if (!bI && (Math.abs(d - RW.INO_EDGE) > 0.03 || Math.abs(w - RW.INO_W) > 0.02 || o < d)) bI = (k ? '上り' : '下り') + ' u=' + u.toFixed(0) + ' 縁は線路から ' + d.toFixed(3) + 'm・幅 ' + w.toFixed(2) + (o < d ? '・反対の線路の側' : '');
  }
  let minN = 1e9;
  for (const c of X.VIA_COLS) for (const o of c.offs) {
    const f = X.frame(c.s, o), p = XI.uv(f.x, f.z);
    if (p.u < X.XR.U0 || p.u > X.XR.U1 || Math.abs(p.n) > 60) continue; minN = Math.min(minN, XI.dTrack(0, f.x, f.z), XI.dTrack(1, f.x, f.z));
  }
  const lim = RW.INO_EDGE + RW.INO_W + RW.INO_CLEAR;
  if (!bI && minN < lim) bI = '柱が井の頭線の線路から ' + minN.toFixed(1) + 'm';
  ok('井の頭線のホームと高架の柱', bI === null && nI > 100, '縁=線路+' + RW.INO_EDGE.toFixed(2) + '・幅' + RW.INO_W + 'm・上面=床・柱は線路から ' + lim.toFixed(2) + 'm 以遠',
    bI || '縁の差 ' + wE.toFixed(3) + 'm(' + nI + '点)・柱は ' + minN.toFixed(1) + 'm');
}
/* ---- 出力 ---- */
const w = (s, n) => String(s) + ' '.repeat(Math.max(0, n -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
/* ---- ホームの人(利用者指示)。検証側の決まり:駅ごとに15人以上・ホームの縁から1.0m 以上内側(点字ブロックの後ろ)・
   ホームの端から2m 以上・ホーム面の高さ(レール面の基準 railY+1.10)・床の上の物(柱・ベンチ・自販機・EV・階段の囲い・階段の井戸)
   から 0.25m 以上離れる。描いたインスタンスの位置が登録簿と一致すること ---- */
{
  const P = X.PEOPLE, REF_P = { MIN: 15, EDGE: 1.0, END: 2.0, PLAT: 1.10, GAP: 0.25 };
  const FLOOR = new Set(['ホームの柱', 'ベンチ', '自動販売機', 'エレベーター', '階段の囲い']);
  const by = {}; for (const m of P) by[m.st.n] = (by[m.st.n] || 0) + 1;
  const few = X.STA.filter((s) => (by[s.n] || 0) < REF_P.MIN).map((s) => s.n + (by[s.n] || 0));
  ok('ホームの人(駅ごと)', P.length > 0 && few.length === 0, '各駅' + REF_P.MIN + '人以上', few.length ? few.join(' ') : P.length + '人(' + X.STA.map((s) => by[s.n]).join('/') + ')');
  let bad = null;
  const OB = X.STRUCT.filter((o) => FLOOR.has(o.tag));
  for (const m of P) {
    const q = m.q;
    if (m.s < q.x0 + REF_P.END || m.s > q.x1 - REF_P.END || Math.abs(m.o - q.off) > q.hw - REF_P.EDGE) { bad = m.st.n + ' s=' + m.s.toFixed(1) + ' ホームの縁/端に近い'; break; }
    // 線路からも測る(縁が曲がる待避線のホームでも):線路の中心から縁まで約1.55m+縁から REF_P.EDGE
    const tc = X.TRACKS.filter((t) => m.s >= t.x0 && m.s <= t.x1).map((t) => Math.abs(t.zf(m.s) - m.o)).reduce((a, b) => Math.min(a, b), 1e9);
    if (tc < 1.5 + REF_P.EDGE) { bad = m.st.n + ' s=' + m.s.toFixed(1) + ' 線路から' + tc.toFixed(2) + 'm'; break; }
    if (Math.abs(m.y - (X.railY(m.s) + REF_P.PLAT)) > 0.05) { bad = m.st.n + ' 高さ ' + m.y.toFixed(2); break; }
    const hit = OB.find((o) => m.s > o.s0 - REF_P.GAP && m.s < o.s1 + REF_P.GAP && m.o > o.o0 - REF_P.GAP && m.o < o.o1 + REF_P.GAP && o.y0 < m.y + 1.7 && o.y1 > m.y);
    if (hit) { bad = m.st.n + ' ' + hit.tag + 'に重なる s=' + m.s.toFixed(1); break; }
    const w = X.STAIRS.find((w) => m.s > w.s0 - REF_P.GAP && m.s < w.s1 + REF_P.GAP && m.o > w.o0 - REF_P.GAP && m.o < w.o1 + REF_P.GAP);
    if (w) { bad = m.st.n + ' ' + w.kind + 'の中 s=' + m.s.toFixed(1); break; }
  }
  ok('ホームの人の立つ所', bad === null && P.length > 0, '縁から' + REF_P.EDGE + 'm・端から' + REF_P.END + 'm 以上内側、床の上の物から' + REF_P.GAP + 'm', bad || '全員');
  // 描いたインスタンス(駅ごと)の位置が登録簿と一致
  let nI = 0, badI = null;
  X.scene.traverse((o) => { if (!o.name || o.name.indexOf('ホームの人 ') !== 0 || !o.mats) return;
    const L = P.filter((m) => 'ホームの人 ' + m.st.n === o.name);
    if (L.length !== o.mats.length && !badI) badI = o.name + ' ' + o.mats.length + '/' + L.length;
    L.forEach((m, i) => { const f = X.frame(m.s, m.o), q = o.mats[i]; nI++;
      if ((!q || Math.hypot(q.p.x - f.x, q.p.z - f.z) > 0.01 || Math.abs(q.p.y - m.y) > 0.01) && !badI) badI = o.name + ' ' + i; }); });
  ok('ホームの人を描いた位置', badI === null && nI === P.length, '登録簿と同じ(全員)', badI || nI + '人');
  /* 人の遠近(2026-10-12):近く(駅の中)は細かい形・ホームの外接球の縁から 120〜350m は粗い形・その先は描かない。
     カメラが外接球の中にあるとき(距離が負)に近くの形が消えないこと(近距離の条件を入れたときに一度起きた)も見る */
  { const st = X.STA[2], f = X.frame(st.x, 0), y = X.railY(st.x) + 3;
    const nm = (k) => { let o = null; X.scene.traverse((q) => { if (q.name === k) o = q; }); return o; };
    const N = nm('ホームの人 ' + st.n), F = nm('ホームの人(遠く) ' + st.n), res = [];
    for (const d of [0, 350, 700]) { const g = X.frame(st.x, d); X.camera.position.set(g.x, y + (d ? 30 : 0), g.z); X.lodStruct();
      res.push([!!(N && N.visible), !!(F && F.visible)]); }
    const want = [[true, false], [false, true], [false, false]];
    ok('ホームの人の遠近', N && F && JSON.stringify(res) === JSON.stringify(want), '駅の中=近く・横350m=遠く・横700m=無し', JSON.stringify(res));
  }
  /* 人の種類(2026-10-12 利用者指示:老若男女・学生・会社員・主婦など。鞄もスマホも持たないのは不自然)。検証側の決まり:
     型が6種以上・鞄(リュック・肩掛け・書類鞄・買い物袋)を持つ人が85%以上・スマホを見る人が20%以上・
     スマホを持つ人は右腕を上げている(下ろした右腕と同時に無い)・描いたインスタンスの部品のビットが登録簿と同じ */
  { const BIT = { ARMR: 4, ARMUP: 5, PACK: 11, SBAG: 12, CASE: 13, PHONE: 14, SHOP: 15 }, has = (m, b) => ((m >> b) & 1) === 1;
    const types = new Set(P.map((m) => m.type)), bag = P.filter((m) => [BIT.PACK, BIT.SBAG, BIT.CASE, BIT.SHOP].some((b) => has(m.look.mask, b))).length;
    const ph = P.filter((m) => has(m.look.mask, BIT.PHONE)).length;
    const badArm = P.find((m) => has(m.look.mask, BIT.PHONE) !== has(m.look.mask, BIT.ARMUP) || (has(m.look.mask, BIT.ARMUP) && has(m.look.mask, BIT.ARMR)));
    let badM = null;
    X.scene.traverse((o) => { if (!o.name || o.name.indexOf('ホームの人 ') !== 0) return;
      const A = o.geometry && o.geometry.attributes && o.geometry.attributes.iMW; const L = P.filter((m) => 'ホームの人 ' + m.st.n === o.name);
      if (!A || !A.array) { if (!badM) badM = o.name + ' 部品のビットが無い'; return; }
      L.forEach((m, i) => { if (A.array[i * 3] !== m.look.mask && !badM) badM = o.name + ' ' + i; }); });
    ok('ホームの人の種類・鞄・スマホ', types.size >= 6 && bag >= 0.85 * P.length && ph >= 0.2 * P.length && !badArm && badM === null,
      '型6種以上・鞄85%以上・スマホ20%以上・腕と部品が合う',
      types.size + '種・鞄' + (100 * bag / P.length).toFixed(0) + '%・スマホ' + (100 * ph / P.length).toFixed(0) + '%' + (badArm ? '・腕の不一致' : '') + (badM ? '・' + badM : ''));
  }
}
/* ---- 階段・エスカレーターの幅(2026-10-13 利用者指示:ホームの幅が変わったので再調整)。検証側の決まり:
   ・線路のある縁と井戸の間(通り道)は 1.5m 以上(島式は両側、相対式は線路の側)
   ・広いホームで細い階段にしない:通り道が 2.1m を超えるなら井戸は 3.5m 以上
   ・2面4線(ホーム 7.9m)の井戸は 3.5m 以上 ---- */
{
  let bad = null, n = 0, quadW = [];
  for (const w of X.STAIRS.filter((q) => q.kind === '階段')) {
    const q = X.PLATS.find((p) => w.s0 >= p.x0 - 1 && w.s1 <= p.x1 + 1 && w.o0 >= p.off - p.hw - 0.01 && w.o1 <= p.off + p.hw + 0.01); if (!q) continue;
    const sm = (w.s0 + w.s1) / 2, ww = w.o1 - w.o0;
    const cl = { '-1': w.o0 - q.edge(sm, -1), '1': q.edge(sm, 1) - w.o1 };
    // 線路のある縁:縁から 2.6m 以内に線路の中心がある側
    const sides = [-1, 1].filter((sg) => X.TRACKS.some((t) => sm >= t.x0 && sm <= t.x1 && sg * (t.zf(sm) - q.edge(sm, sg)) > 0.3 && sg * (t.zf(sm) - q.edge(sm, sg)) < 2.6));
    n++;
    for (const sg of sides) { if (cl[sg] < 1.5 - 1e-6 && !bad) bad = w.st.n + ' 通り道 ' + cl[sg].toFixed(2) + 'm'; if (cl[sg] > 2.1 + 1e-6 && ww < 3.5 - 1e-6 && !bad) bad = w.st.n + ' 通り道 ' + cl[sg].toFixed(2) + 'm に井戸 ' + ww.toFixed(2) + 'm'; }
    if (['明大前', '桜上水', '千歳烏山'].indexOf(w.st.n) >= 0) quadW.push(ww);
  }
  ok('階段・エスカレーターの幅', bad === null && n >= 18 && quadW.length === 12 && quadW.every((v) => v >= 3.5 - 1e-6), '通り道 1.5m 以上・2.1m を超えるなら井戸 3.5m 以上・2面4線は 3.5m 以上',
    bad || n + 'か所・2面4線 ' + (quadW.length ? Math.min(...quadW).toFixed(2) : '-') + 'm');
}
/* ---- 乗り降り(2026-10-12 利用者指示:扉が開いたらまず車内の人がホームに降りて階段やエレベーターへ進み、降車が終わったら
   ホームで待っていた人が乗る。自然な歩き方でぶつからないように)。明大前に下りの各停を停めて 150秒動かす。検証側の決まり:
   ・扉が開いて 10秒のうちに 20人以上が降りる。降りる人の最初の位置は扉の中心から 1.0m 以内・ホームの縁より線路の側(車内)
   ・降りた人は階段の井戸(登録簿 STAIRS の範囲)かエレベーターの前(1.8m 以内)で消える
   ・乗る人が歩き出すとき、同じ扉から降りた人がその扉の 1.5m 以内にいない(降車が先)。乗る人は扉の中心から 1.0m 以内・車内で消える
   ・歩く人どうし・歩く人と立っている人の中心が 0.3m 以上離れる。歩く人はホームの床の上の物(柱・ベンチ・自販機・EV・階段の囲い)に入らない
   ・列車が出て 120秒のうちに、乗った人の場所に人が戻る(階段から歩いて来る) ---- */
{
  // その s で近い方の縁(待避線の側の縁が曲がって狭くなる所では、ホームの中心が名目の中心からずれる)
  const sideOf = (q, s, o) => (Math.abs(o - q.edge(s, -1)) < Math.abs(o - q.edge(s, 1)) ? -1 : 1);
  // 乗る人の側:行き先(車内=ホームの外)がどちらの縁の外か
  const boardSide = (w) => { const L = w.path[w.path.length - 1]; return L[1] < w.q.edge(L[0], -1) ? -1 : (L[1] > w.q.edge(L[0], 1) ? 1 : sideOf(w.q, w.m.s, w.m.o)); };
  const RF = { ALIGHT_MIN: 20, DOOR_TOL: 1.0, EXIT_EV: 1.8, GAP: 0.3, CLEAR: 1.5, BACK: 120 };
  const st = X.STA.find((z) => z.n === '明大前'), t = X.trains.find((u) => u.dir > 0 && u.kind === '各停');
  for (const u of X.trains) if (u !== t) { u.x = u.dir > 0 ? -30000 : 30000; u.st = 'wait'; }
  t.x = X.stopPosOf(st, 1) - X.CAR_HALF; t.st = 'dwell'; t.dwell = 58; t.atSt = st; t.v = 0; X.placeTrain(t);
  const OBJ = X.STRUCT.filter((o) => ['ホームの柱', 'ベンチ', '自動販売機', 'エレベーター', '階段の囲い'].indexOf(o.tag) >= 0 && Math.abs((o.s0 + o.s1) / 2 - st.x) < 130);
  const seen = new Map(); let bad = null, nOff10 = 0, tOpen = null, minG = 1e9, depT = null, hiddenAtDep = null;
  for (let k = 0; k < 3600 && !bad; k++) {
    X.stepWorld(0.05); const T = k * 0.05;
    if (tOpen === null && t.dr > 0.95) tOpen = T;
    if (depT === null && t.st !== 'dwell') { depT = T; hiddenAtDep = X.PEOPLE.filter((m) => m.st === st && !m.shown); }
    const row = X.trainPSD(t) || seen.row; if (row) seen.row = row;
    const A = X.FLOW.walkers.filter((w) => !(w.wait > 0) && w.st === st);
    for (const w of A) {
      if (!seen.has(w)) {                                  // 現れたとき
        seen.set(w, { t0: T });
        const rw = seen.row, ds = rw ? Math.min(...rw.open.map((c) => Math.abs(c - w.s))) : 99;
        if (w.kind === '降') { if (tOpen !== null && T - tOpen <= 10) nOff10++;
          const e = sideOf(w.q, w.s, w.o), edge = w.q.edge(w.s, e);
          if (ds > RF.DOOR_TOL || e * (w.o - edge) <= 0) bad = '降りる人が扉の外から s=' + (w.s - st.x).toFixed(1); }
        if (w.kind === '乗') {
          const D = w.m.door, e = boardSide(w), oe = w.q.edge(D, e);
          const near = A.find((o) => o.kind === '降' && o.door && o.door.c === D && Math.hypot(o.s - D, o.o - oe) < RF.CLEAR);
          if (near) bad = '降車が済む前に乗り始めた 扉 s=' + (D - st.x).toFixed(1);
        }
      }
      const r = seen.get(w); r.last = [w.s, w.o, w.k, w.path.length]; r.w = w;
      // 床の上の物(最後の井戸・EV へ入る区間と、車内の区間を除く)
      const onPlat = w.kind === '降' ? (w.k >= 1 && w.k < w.path.length - 2) : w.kind === '戻' ? (w.k >= 2) : (w.k < w.path.length - 2);
      if (onPlat) for (const o of OBJ) if (w.s > o.s0 - 0.1 && w.s < o.s1 + 0.1 && w.o > o.o0 - 0.1 && w.o < o.o1 + 0.1) { bad = (bad || w.kind + 'が' + o.tag + 'に入る s=' + (w.s - st.x).toFixed(1)); break; }
    }
    // すり抜け(行き詰まったときの最後の手。別の検査で回数を見る)の人は除く
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) if (A[i].q === A[j].q && !(A[i].ghost > 0) && !(A[j].ghost > 0)) minG = Math.min(minG, Math.hypot(A[i].s - A[j].s, A[i].o - A[j].o));
    for (const w of A) for (const m of X.PEOPLE) if (m.q === w.q && m.shown && m !== w.m) minG = Math.min(minG, Math.hypot(m.s - w.s, m.o - w.o));
    for (const [w, r] of seen) if (w.kind && !r.end && X.FLOW.walkers.indexOf(w) < 0) {   // 消えたとき
      r.end = T; const [s, o, kk, n] = r.last;
      if (w.kind === '降' && kk < n - 2) bad = bad || '降りた人が出口の前で消えた';
      if (w.kind === '降') { const okExit = X.STAIRS.some((q) => q.st === st && (q.kind === '階段' ? (s >= q.s0 - 0.5 && s <= q.s1 + 0.5 && o >= q.o0 - 0.3 && o <= q.o1 + 0.3) : Math.hypot(s - (q.s0 + q.s1) / 2, o - (q.o0 + q.o1) / 2) < RF.EXIT_EV + 1.0));
        if (!okExit) bad = bad || '降りた人が階段・EV でない所で消えた s=' + (s - st.x).toFixed(1) + ' o=' + o.toFixed(2); }
      if (w.kind === '乗') { const e = boardSide(w), oe = w.q.edge(w.m.door, e);
        if (Math.abs(s - w.m.door) > RF.DOOR_TOL || e * (o - oe) <= 0) { if (process.env.DBG && !bad) console.log('BOARD', (w.m.door - st.x).toFixed(1), 'last', (s - st.x).toFixed(2), o.toFixed(2), 'oe', oe.toFixed(2), 'e', e, 'k', kk, n, JSON.stringify(w.path.map((q) => [(q[0] - st.x).toFixed(1), q[1].toFixed(2)])), 'skips', X.FLOW.skips); bad = bad || '乗る人が扉の外で消えた'; } }
    }
  }
  if (process.env.DBG && hiddenAtDep) for (const m of hiddenAtDep) if (!m.shown) console.log('NB', (m.s - st.x).toFixed(1), m.o.toFixed(2), JSON.stringify(X.FLOW.walkers.filter((z) => z.m === m).map((z) => [z.kind, z.k, z.path.length, (z.s - st.x).toFixed(2), z.o.toFixed(2), z.path.map(q=>[(q[0]-st.x).toFixed(1),q[1].toFixed(2)])])), X.FLOW.respawn.filter((r) => r.m === m).map((r) => r.at));
  const back = hiddenAtDep ? hiddenAtDep.filter((m) => m.shown).length : 0, nH = hiddenAtDep ? hiddenAtDep.length : 0;
  const nOff = [...seen.keys()].filter((w) => w && w.kind === '降').length, nOn = [...seen.keys()].filter((w) => w && w.kind === '乗').length;
  ok('乗り降り(降りる→階段・EV/降車の後に乗る)', bad === null && nOff10 >= RF.ALIGHT_MIN && nOn > 0 && minG >= RF.GAP && depT !== null && back === nH && nH > 0,
    '10秒で' + RF.ALIGHT_MIN + '人以上降りる・扉から/階段・EVへ・降車の後に乗る・間 ' + RF.GAP + 'm 以上・発車後 ' + RF.BACK + '秒で戻る',
    (bad || '') + ' 降' + nOff + '(10秒で' + nOff10 + ')・乗' + nOn + '・最も近い ' + minG.toFixed(2) + 'm・戻った ' + back + '/' + nH);
}
/* ---- 乗り降りの歩き方(2026-10-12 利用者指摘:階段付近・EV 前で固まり、同じ場所で歩き続ける・回る・点滅する人/ホームドアの
   線路側にはみ出る人/階段・エスカレーターをほぼ垂直に降りる人)。全線を 10分動かして、検証側の決まりで見る:
   ・ホームドアの線(縁に立つ列の位置。列が無ければ縁)より 0.25m 以上ホーム側(乗り降りの区間=車内⇄扉は除く)。立っている人も
   ・階段は段 0.165/0.30・エスカレーターは入口 0.7m の先から 30°(高架駅の下りの井戸)の高さどおり。どこでも高さの変わり方は水平の 0.6倍まで
   ・歩いている間に1コマ(0.05秒)で 60°より大きく向きを変えない(回る・点滅して見える)
   ・3秒続けて歩く姿のまま 0.3m も進まない人はいない(その場で歩き続ける)
   ・60秒より長く行き先へ近づかない人はいない(行き詰まり)。すり抜けは歩いた人の 10% 未満・点の飛ばしは 1% 未満 ---- */
{
  const RW = { PSD: 0.25, STEP: 0.165 / 0.30, ESC: Math.tan(Math.PI / 6), ESC_FLAT: 0.7, YTOL: 0.03, VERT: 0.6, TURN: 60, INPLACE: 3, STUCK: 60, PASS: 0.10, SKIP: 0.01, T: 600 };
  const psdOf = new Map();
  const line = (q, e, s) => { const k = q; if (!psdOf.has(k)) psdOf.set(k, {}); const c = psdOf.get(k);
    if (!(e in c)) { const edge = q.off + e * q.hw; c[e] = X.PSD.find((r) => Math.abs(r.off - edge) < 1.2 && r.open.some((o) => o > q.x0 - 5 && o < q.x1 + 5)) || null; }
    return c[e] ? c[e].off + c[e].sh(s) : q.edge(s, e); };
  const outPSD = (q, s, o) => [-1, 1].some((e) => e * (o - line(q, e, s)) > -RW.PSD);
  let standOut = 0; for (const m of X.PEOPLE) if (m.shown && outPSD(m.q, m.s, m.o)) standOut++;
  const wells = X.STAIRS.filter((w) => w.kind === '階段');
  const st = new Map(); let out = 0, outEx = null, ybad = 0, ybEx = null, vert = 0, turn = 0, inplace = 0, stuck = 0, stEx = null, nW = new Set();
  const p0 = X.FLOW.passes || 0, k0 = X.FLOW.skips || 0;
  for (let k = 0; k < RW.T / 0.05; k++) {
    X.stepWorld(0.05); const T = k * 0.05;
    for (const w of X.FLOW.walkers) {
      if (w.wait > 0) continue; nW.add(w);
      const crossing = (w.kind === '降' && w.k < 1) || (w.kind === '乗' && w.k >= 1);
      const yP = X.railY(w.s) + X.STD.PLAT;
      if (!crossing && Math.abs(w.y - yP) < 0.01 && outPSD(w.q, w.s, w.o)) { out++; outEx = outEx || (w.kind + ' k' + w.k + ' ' + (w.st && w.st.n)); }
      // 井戸の中の高さ(高架駅の下りの井戸):検証側の段の形
      if (Math.abs(w.y - yP) > 0.01) for (const q of wells) {
        if (q.up || w.s < q.s0 || w.s > q.s1 || w.o < q.o0 || w.o > q.o1) continue;
        const f = q.dir || 1, e0 = f > 0 ? q.s0 : q.s1, oS = q.o0 + (q.o1 - q.o0) * 0.55, yt = X.railY(e0) + X.STD.PLAT, u = f * (w.s - e0);
        const want = w.o < oS ? yt - RW.STEP * Math.max(0, u) : yt - RW.ESC * Math.max(0, u - RW.ESC_FLAT);
        if (Math.abs(w.y - want) > RW.YTOL) { ybad++; ybEx = ybEx || (w.kind + ' ' + (w.y - want).toFixed(2) + 'm ' + (w.st && w.st.n)); }
      }
      let r = st.get(w);
      if (r) {
        const dh = Math.hypot(w.s - r.s, w.o - r.o), dy = Math.abs(w.y - r.y);
        if (dy > RW.VERT * dh + 0.005) vert++;
        if (w.mv && r.mv && w.fs !== undefined && r.fs !== undefined) { const c = (w.fs * r.fs + w.fo * r.fo) / ((Math.hypot(w.fs, w.fo) * Math.hypot(r.fs, r.fo)) || 1);
          if (Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI > RW.TURN) turn++; }
        r.h.push([w.s, w.o, w.mv]); if (r.h.length > RW.INPLACE / 0.05) r.h.shift();
        if (r.h.length >= RW.INPLACE / 0.05 && !r.ip && r.h.every((q) => q[2]) && Math.hypot(w.s - r.h[0][0], w.o - r.h[0][1]) < 0.3) { r.ip = 1; inplace++; }
        const g = Math.hypot(w.goal[0] - w.s, w.goal[1] - w.o);
        if (g < r.best - 0.5) { r.best = g; r.bt = T; } else if (T - r.bt > RW.STUCK && !r.st) { r.st = 1; stuck++; stEx = stEx || (w.kind + ' k' + w.k + ' ' + (w.st && w.st.n)); }
      } else r = { h: [], best: 1e9, bt: T };
      r.s = w.s; r.o = w.o; r.y = w.y; r.mv = w.mv; r.fs = w.fs; r.fo = w.fo; st.set(w, r);
    }
  }
  const nP = (X.FLOW.passes || 0) - p0, nK = (X.FLOW.skips || 0) - k0;
  ok('乗り降り:ホームドアの線より線路側へ出ない', out === 0 && standOut === 0, '歩く人(乗り降りの区間を除く)・立つ人とも線から ' + RW.PSD + 'm 以上ホーム側',
    '歩く ' + out + 'コマ' + (outEx ? '(' + outEx + ')' : '') + '・立つ ' + standOut + '人');
  ok('乗り降り:階段・エスカレーターの傾き', ybad === 0 && vert === 0, '段 0.165/0.30・エスカレーター30° の高さ±' + RW.YTOL + 'm・高さの変化≤水平×' + RW.VERT,
    '高さのずれ ' + ybad + 'コマ' + (ybEx ? '(' + ybEx + ')' : '') + '・急な上下 ' + vert + 'コマ');
  ok('乗り降り:回らない・その場で歩き続けない', turn === 0 && inplace === 0, '1コマで ' + RW.TURN + '°超の向き替え 0・' + RW.INPLACE + '秒歩いて 0.3m 未満 0',
    '向き替え ' + turn + '・その場 ' + inplace + '人(' + nW.size + '人中)');
  ok('乗り降り:行き詰まらない', stuck === 0 && nP < RW.PASS * nW.size && nK < RW.SKIP * nW.size, RW.STUCK + '秒近づかない 0・すり抜け<' + (RW.PASS * 100) + '%・点の飛ばし<' + (RW.SKIP * 100) + '%',
    '行き詰まり ' + stuck + (stEx ? '(' + stEx + ')' : '') + '・すり抜け ' + nP + '・飛ばし ' + nK + '/' + nW.size + '人');
}
console.log('=== 駅の構造の検証 ===');
console.log('');
console.log(w('項目', 34) + w('要件', 24) + w('実測', 40) + '判定');
for (const r of rows) console.log(w(r[0], 34) + w(r[1], 24) + w(r[2], 40) + r[3]);
console.log('');
console.log('RESULT: ' + (ng ? 'FAIL(' + ng + '項目NG)' : 'PASS'));
process.exit(ng ? 1 : 0);
