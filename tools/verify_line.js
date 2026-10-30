// 高架橋の桁幅と架線を、全線10m刻みでスキャンして検査する。
//
//   桁幅は「広すぎても狭すぎても」まずい。狭ければ車両が桁からはみ出し(防御的設計の
//   違反)、広ければ現実には有り得ない構造物になる。どちらも見た目では判断しづらいので
//   線路とホームの実態から必要幅を独立に計算し、その通りかを数値で確かめる。
//   架線は「線路の上に必ずあること」「吊り点が架線柱の真下にあること」に加え、
//   インテグレート架線としての形(き電ちょう架線2条+トロリ線・偏位の交互・ハンガの間隔・
//   パンタに当たらない支持物・柱の建築限界)を、登録簿と実際に描いた電線の頂点で見る。
//
//   使い方: node tools/verify_line.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'deckHalf:deckHalf,outerOff:outerOff,platOuter:platOuter,mainOff:mainOff,' +
  'poleStep:poleStep,STA:STA,DOM:DOM,DECK_END:DECK_END,frame:frame,RAIL_TOP:RAIL_TOP,' +
  'DECK_MIN:DECK_MIN,railY:railY,platRange:platRange,PLAT_EDGE:PLAT_EDGE,' +
  'TRACKS:(typeof TRACKS!=="undefined"?TRACKS:null),' +
  'WIRES:(typeof WIRES!=="undefined"?WIRES:null),' +
  'POLE_S:(typeof POLE_S!=="undefined"?POLE_S:[]),' +
  'PIERS:(typeof PIERS!=="undefined"?PIERS:[]),' +
  'parkedCars:parkedCars,PARKS:PARKS,YARD_A:YARD_A,YARD_B:YARD_B,YARD_E:YARD_E,YARD_W:YARD_W,K8:K8,' +
  'INOKASHIRA_X:INOKASHIRA_X,SETAGAYA_X:SETAGAYA_X,BRIDGE:BRIDGE,KAN7_X:KAN7_X,' +
  'KANPACHI_X:KANPACHI_X,XINGS:XINGS,' +
  'WIRE_CAT:WIRE_CAT,WIRE_TRO:WIRE_TRO,BEAM_LOW:BEAM_LOW,POLE_TOP:POLE_TOP,' +
  'VIA_COLS:(typeof VIA_COLS!=="undefined"?VIA_COLS:[]),STRUCT:(typeof STRUCT!=="undefined"?STRUCT:[]),' +
  'ROAD_SKIP:ROAD_SKIP,PS0:PS0,PLATS:PLATS,VIA_CH:VIA_CH,' +
  'CHAINS:(typeof CHAINS!=="undefined"?CHAINS:[]),SUPS:(typeof SUPS!=="undefined"?SUPS:[]),' +
  'POLES:(typeof POLES!=="undefined"?POLES:[]),BEAMS:(typeof BEAMS!=="undefined"?BEAMS:[]),' +
  'POLE_LAMPS:(typeof POLE_LAMPS!=="undefined"?POLE_LAMPS:[]),PSD:(typeof PSD!=="undefined"?PSD:[]),stepPSD:stepPSD');

/* ---- 設計上の要件(検証側が独立して持つ) ---------------------------------- */
const REQ = {
  CLEAR: 2.45,       // 最外軌道から桁端までの最小距離[m](建築限界+柱)
  PLAT_MARGIN: 0.6,  // ホーム外縁から桁端までの最小距離[m]
  DECK_MIN: 4.45,    // 複線区間の標準半幅[m]
  SLACK: 0.05,       // 必要幅に対して許容する余剰[m]
  GRAD: 1.30,        // 桁幅の変化率の上限[m / 5m]
  STEP: 5,
};

/* ---- インテグレート架線の基準(検証側が独立して持つ) ---------------------------- */
const CATREF = {
  TRO: 4.95,           // トロリ線の高さ(レール面から)=8000系のパンタのすり板の上面
  SYS: [0.85, 1.05],   // 支持点でのき電ちょう架線とトロリ線の間隔
  TWIN: [0.12, 0.18],  // き電ちょう架線2条の間隔
  STAG: [0.15, 0.25],  // 偏位(支持点でのトロリ線の振れ)
  BEND: 0.06,          // 線路が柱間の弦からこれ以上膨らむ支持点を「曲線」とみなす[m]
  DEV: 0.30,           // 柱間のどこでもトロリ線は線路中心からこれ以内(パンタの集電範囲)
  HANG: 5.5,           // ハンガの間隔の上限
  HANG_END: 3.0,       // 支持点から最初のハンガまでの上限
  HANG_MIN: 0.5,       // 最も短いハンガ(垂れの最下点)の長さの下限
  DROP_CLEAR: 1.25,    // ブラケットの付け根(柱の面・吊りパイプ)は線路中心からこれ以上(パンタの半幅1.1+余裕)
  STEADY_SLOPE: 0.12,  // 振止め金具の上り勾配の下限(トロリ線から離れるほど高く)
  POLE_CLEAR: 1.70,    // 架線柱の面は線路中心からこれ以上(車体の半幅1.385+余裕)
  POLE_EDGE: 1.0,      // ホームの上に立つ柱は線路側の縁からこれ以上
  BEAM_OVER: 0.5,      // ビームの下端はき電ちょう架線よりこれ以上上
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) { if (!cond) ng++; rows.push([name, expect, got, cond ? 'OK' : 'NG']); }

/* ---- 1. 桁幅 ------------------------------------------------------------- */
const need = (s) => Math.max(REQ.DECK_MIN, X.outerOff(s) + REQ.CLEAR, X.platOuter(s) + REQ.PLAT_MARGIN);
{
  let narrow = null, wide = null, steep = null, prev = null, sum = 0, n = 0;
  for (let s = X.DOM.x0; s < X.DECK_END; s += REQ.STEP) {
    const h = X.deckHalf(s), w = need(s);
    if (h < X.outerOff(s) + REQ.CLEAR - 1e-9 && !narrow) narrow = [s, (h - X.outerOff(s)).toFixed(2)];
    if (h < X.platOuter(s) + REQ.PLAT_MARGIN - 1e-9 && !narrow) narrow = [s, 'ホーム外'];
    if (h - w > REQ.SLACK && (!wide || h - w > wide[1])) wide = [s, h - w];
    if (prev !== null && Math.abs(h - prev) > REQ.GRAD && !steep) steep = [s, (h - prev).toFixed(2)];
    prev = h; sum += h - w; n++;
  }
  ok('桁が最外軌道から2.45m以上', narrow === null, '違反なし', narrow ? 's=' + narrow[0] + ' ' + narrow[1] + 'm' : '違反なし');
  ok('桁に無駄な幅がない', wide === null, '余剰≤' + REQ.SLACK + 'm',
    wide ? 's=' + wide[0].toFixed(0) + ' +' + wide[1].toFixed(2) + 'm' : '余剰 0.00m');
  ok('桁幅が急変しない', steep === null, '≤' + REQ.GRAD + 'm/' + REQ.STEP + 'm',
    steep ? 's=' + steep[0] + ' ' + steep[1] + 'm' : '滑らか');
  rows.push(['平均余剰', '0.00m', (sum / n).toFixed(3) + 'm', 'OK']);
}
// 駅ごとに必要幅が確保されているか(ホームが桁からはみ出さない)
{
  let bad = null;
  // 描いたホーム(登録簿 PLATS。待避線に沿って曲がる縁も edge(s) で)の外縁を 5m ごとに桁の半幅と比べる(2026-10-13:駅の中心の表の値だけでは
  // 芦花公園の拡幅や曲がる縁を見ない)
  let n = 0;
  for (const q of X.PLATS) for (let s = q.x0; s <= q.x1 + 1e-6; s += 5) {
    if (s > X.DECK_END) continue;                       // 仙川は地上区間
    const e = Math.max(...[-1, 1].map((sg) => Math.abs(q.edge ? q.edge(s, sg) : q.off + sg * q.hw))), h = X.deckHalf(s); n++;
    if (h < e + REQ.PLAT_MARGIN - 1e-9 && !bad) bad = ['s=' + s.toFixed(0), (h - e).toFixed(2)];
  }
  ok('全駅でホームが桁に載る', bad === null && n > 300, '違反なし(5m ごと)', bad ? bad.join(' ') + 'm' : n + '点とも');
}

/* ---- 2. 架線:線路の上にあるか / 吊り点が柱の真下か ------------------------ */
if (X.TRACKS && X.WIRES) {
  // 2-1 架線の無い線路が無いこと
  const uncovered = X.TRACKS.filter((t) => !X.WIRES.some((w) => w.id === t.id));
  ok('全ての線路に架線がある', uncovered.length === 0, '0本',
    uncovered.length ? uncovered.map((t) => t.id).join(',') : '0本');
  // 2-2 架線の横位置が線路の中心と一致すること
  {
    let bad = null;
    for (const w of X.WIRES) {
      const t = X.TRACKS.find((q) => q.id === w.id);
      if (!t) continue;
      for (let s = w.x0; s <= w.x1; s += 25) {
        const d = Math.abs(w.zf(s) - t.zf(s));
        if (d > 0.01 && (!bad || d > bad[1])) bad = [w.id, d];
      }
    }
    ok('架線が線路の真上にある', bad === null, 'ずれ≤0.01m', bad ? bad[0] + ' ' + bad[1].toFixed(3) + 'm' : 'ずれ 0.000m');
  }
  // 2-3 吊り点(垂れ0の点)が架線柱の位置と一致すること
  {
    let bad = null;
    for (const w of X.WIRES) {
      for (const h of w.sup) {
        if (!X.POLE_S.some((p) => Math.abs(p - h) < 0.01)) { bad = bad || [w.id, h.toFixed(1)]; }
      }
    }
    ok('吊り点が架線柱の真下', bad === null, '全て一致', bad ? bad.join(' @s=') : '全て一致');
  }
  // 2-4 架線が線路の全長をカバーすること
  {
    let bad = null;
    for (const t of X.TRACKS) {
      const w = X.WIRES.find((q) => q.id === t.id);
      if (!w) continue;
      const gap = Math.max(w.x0 - t.x0, t.x1 - w.x1);
      if (gap > 1 && (!bad || gap > bad[1])) bad = [t.id, gap];
    }
    ok('架線が線路の全長を覆う', bad === null, '未架設≤1m', bad ? bad[0] + ' ' + bad[1].toFixed(0) + 'm' : '全長を覆う');
  }
  // 2-4b 架線は架線柱の間で直線であること
  //      線路のように滑らかな曲線にしてはいけない(実物は吊り点を結んだ折れ線)。
  //      節点が「鎖の両端と柱の真下」だけであることと、描いた電線(区画の LineSegments)に
  //      支持点から次の支持点までの1本の線分が、トロリ線の高さ(レール面+4.95m)で
  //      そのまま入っていることを確かめる(中間点があれば1本の線分にならない)。
  {
    const poleSet = new Set(X.POLE_S.map((v) => v.toFixed(3)));
    const key = (a, b) => { const k = (p) => p.map((v) => Math.round(v * 200)).join(','); const x = k(a), y = k(b); return x < y ? x + '|' + y : y + '|' + x; };
    const segs = new Set();
    for (const C of X.VIA_CH) for (let i = 0; i + 5 < C.wl.length; i += 6)
      segs.add(key([C.wl[i], C.wl[i + 1], C.wl[i + 2]], [C.wl[i + 3], C.wl[i + 4], C.wl[i + 5]]));
    let bad = null, spans = 0;
    for (const c of X.CHAINS) {
      for (let i = 1; i < c.nodes.length - 1; i++)
        if (!poleSet.has(c.nodes[i].toFixed(3)) && !bad) bad = [c.ids[0], 's=' + c.nodes[i].toFixed(1) + ' は柱の位置でない'];
      const P = c.nodes.map((s, k) => { const f = X.frame(s, c.zf(s) + c.d[k]); return [f.x, X.railY(s) + X.RAIL_TOP + CATREF.TRO, f.z]; });
      for (let k = 0; k < P.length - 1; k++) {
        if (c.nodes[k + 1] - c.nodes[k] < 0.05) continue;
        spans++;
        if (!segs.has(key(P[k], P[k + 1])) && !bad) bad = [c.ids[0], 's=' + c.nodes[k].toFixed(1) + '〜' + c.nodes[k + 1].toFixed(1) + ' に1本のトロリ線が無い'];
      }
    }
    ok('架線柱間が直線(トロリ線)', bad === null, '支持点間=1本の線分・レール面+' + CATREF.TRO + 'm',
      bad ? bad.join(' ') : spans + 'スパンすべて');
  }
  /* 2-4c 高架下に構造物がある位置に橋脚を立てないこと。
     横断する道路・鉄道・河川の上には立てない。高架下駅舎の範囲では柱の列は通してよいが、
     柱は駅舎の壁より内側に収まること(壁を貫いて見えない)。駅舎の壁の位置は登録簿 STRUCT の
     '駅舎' から、柱の太さは検証側の値で測る。期待値(横断部の幅)は検証側が独立に持つ。 */
  {
    // 駅舎の範囲は登録簿 STRUCT の '駅舎' から読む(駅の中心とは限らない。下高井戸は駅の西端部)
    // 高架下を横切るもの [名称, s, 柱を立てない半幅[m]]
    const CROSS = [['井の頭線', X.INOKASHIRA_X, 12], ['世田谷線', X.SETAGAYA_X, 8],
    ['仙川', X.BRIDGE.s, 12], ['環七', X.KAN7_X, 16], ['環八', X.KANPACHI_X, 18]];
    for (const g of X.XINGS) CROSS.push(['踏切道 ' + g[0], g[1], 6]);
    let bad = null;
    const COL_HALF = 0.48;                                   // 柱の半幅(面取りした角柱の外接)
    const BLDGS = X.STRUCT.filter((q) => q.tag === '駅舎');
    const nB = X.STA.filter((st) => st.t !== 'ctx' && st.t !== 'gnd').length;
    if (BLDGS.length < nB && !bad) bad = ['駅舎の登録', BLDGS.length + '件(' + nB + '駅)'];
    for (const x of X.PIERS) {
      for (const b of BLDGS) {
        if (x < b.s0 - 1 || x > b.s1 + 1) continue;
        const c = X.VIA_COLS.find((q) => Math.abs(q.s - x) < 0.01);
        if (!c) { if (!bad) bad = ['駅舎の範囲の柱', '柱の登録なし s=' + x.toFixed(0)]; continue; }
        for (const o of c.offs)
          if ((o - COL_HALF < b.o0 || o + COL_HALF > b.o1) && !bad)
            bad = ['駅舎の壁を柱が貫く', 's=' + x.toFixed(0), 'off=' + o.toFixed(2)];
      }
      for (const c of CROSS)
        if (Math.abs(x - c[1]) < c[2] && !bad) bad = [c[0] + 'の直上', 's=' + x.toFixed(0)];
    }
    ok('構造物の上に橋脚が無い', bad === null, '横断部に0本・駅舎の壁の内側',
      bad ? bad.join(' ') : X.PIERS.length + '本すべて');
  }
  /* 2-4d 桜上水の留置線:2本とも東端から西端まで通しで敷かれていること。
     内側は待避線(副本線北)と同じ位置なので、その一定区間は副本線が受け持つ。
     区間の継ぎ目に隙間があると「線路が途切れて見える」。 */
  {
    const PARK_CARS = 10;                                     // 滞泊は上下方とも10両(指示)
    const LEN = (PARK_CARS - 1) * X.K8.PITCH + X.K8.LEN;      // 編成長[m]
    /* そのオフセットに線路がある区間を2m刻みで塗り、途切れ(隙間)を探す。
       内側は待避線(副本線北)が中央を受け持つので、区間の合成ではなく被覆で見る。 */
    const cover = (off) => {
      const seg = []; let run = null;
      for (let s = X.YARD_E; s <= X.YARD_W + 1e-6; s += 2) {
        const on = X.TRACKS.some((t) => s >= t.x0 - 1 && s <= t.x1 + 1 && Math.abs(t.zf(s) - off) < 0.15);
        if (on) { if (!run) { run = [s, s]; seg.push(run); } else run[1] = s; }
        else run = null;
      }
      return seg;
    };
    const inner = cover(X.YARD_A), outer = cover(X.YARD_B);
    const spans = (list) => list.some((q) => q[0] <= X.YARD_E + 2 && q[1] >= X.YARD_W - 2);
    const show = (list) => list.map((q) => q[0].toFixed(0) + '〜' + q[1].toFixed(0)).join(' / ') || 'なし';
    ok('留置線(外側)が通しで敷かれる', spans(outer),
      X.YARD_E.toFixed(0) + '〜' + X.YARD_W.toFixed(0) + 'm', show(outer));
    ok('留置線(内側)が通しで敷かれる', spans(inner),
      X.YARD_E.toFixed(0) + '〜' + X.YARD_W.toFixed(0) + 'm', show(inner));
    const sak = X.PARKS.filter((q) => /桜上水/.test(q.name));
    ok('滞泊編成の両数(桜上水)', sak.length === 2 && sak.every((q) => q.cars.length === PARK_CARS),
      PARK_CARS + '両×2本', sak.map((q) => q.cars.length + '両').join('・') || 'なし');
    // 編成が収まる長さがあるか(内側は副本線の一定区間より東/西の区間に停める)
    const fitI = inner.some((q) => q[1] - q[0] >= LEN), fitO = outer.some((q) => q[1] - q[0] >= LEN);
    ok('留置線に10両が収まる', fitI && fitO, '≥' + LEN.toFixed(0) + 'm',
      (fitI ? '内側OK' : '内側不足') + ' / ' + (fitO ? '外側OK' : '外側不足'));
  }
  /* 2-4e 笹塚の西側の留置線に 9000系10両(利用者指示)。基準は検証側で持つ:
       編成 9732F(30番台は下2桁が編成番号。新宿方から 9732・9032・9082・9532・9132・9582・9682・9232・9282・9782)、
       置き場所は笹塚の内側の留置線(±2m)のうちホームより西。
     守ること:①車両がその線路の上(|off|=2)②ホームと重ならない ③線路の端(車止め)の手前
     ④ほかの線路(渡り線・本線)が車体の幅に入ってこない(=分岐の先に置く。離れ3.0m 以上)⑤運転台が外を向き、灯火は消灯 */
  {
    const REF_9732F = ['9732', '9032', '9082', '9532', '9132', '9582', '9682', '9232', '9282', '9782'];
    const sasa = X.STA.find((s) => s.n === '笹塚');
    const P = X.PARKS.find((q) => /笹塚/.test(q.name) && /留置/.test(q.name));
    if (!P) ok('笹塚の留置線に9000系', false, '10両', '無い');
    else {
      const nums = P.cars.map((c) => c.userData.k8.num), ser = P.cars.every((c) => c.userData.k8.series === '9000');
      ok('笹塚の留置線に9000系10両', P.cars.length === 10 && ser && JSON.stringify(nums) === JSON.stringify(REF_9732F),
        '9732F(新宿方から)', P.cars.length + '両・' + (ser ? '9000系' : '形式違い') + '・' + nums.join(' '));
      const half = (X.K8.LEN) / 2, ss = P.cars.map((c) => c.userData.s);
      const e0 = Math.min(...ss) - half, e1 = Math.max(...ss) + half;
      const pr = X.platRange(sasa);
      const tr = X.TRACKS.filter((t) => Math.abs(t.zf(e0 + 5) - P.off) < 0.05 && e0 >= t.x0 && e1 <= t.x1);
      let badOn = null;
      for (const c of P.cars) {
        const q = X.frame(c.userData.s, P.off), d = Math.hypot(c.position.x - q.x, c.position.z - q.z);
        if (d > 0.3 && !badOn) badOn = c.userData.k8.num + ' ずれ' + d.toFixed(2) + 'm';
      }
      ok('笹塚の留置:線路の上・ホームより西', Math.abs(Math.abs(P.off) - 2) < 1e-6 && tr.length > 0 && !badOn && e0 > pr[1],
        '|off|=2 の線路の上・東端 > ホーム西端 ' + pr[1].toFixed(0), (badOn || ('off ' + P.off)) + '・東端 ' + e0.toFixed(1) + '・線路' + tr.length);
      const end = tr.length ? Math.min(...tr.map((t) => t.x1)) : -1e9;
      ok('笹塚の留置:車止めの手前', tr.length > 0 && e1 <= end - 2.0 && e1 >= end - 6.0, '線路の端の2〜6m 手前',
        tr.length ? (end - e1).toFixed(1) + 'm 手前' : '-');
      // ほかの線路が車体の幅に入ってこない(渡り線の分岐の先に置く)
      let foul = null;
      for (let s = e0; s <= e1; s += 1) for (const t of X.TRACKS) {
        if (tr.indexOf(t) >= 0 || s < t.x0 || s > t.x1) continue;
        const d = Math.abs(t.zf(s) - P.off);
        if (d < 3.0 && (!foul || d < foul[1])) foul = [t.id + ' s=' + s.toFixed(0), d];
      }
      ok('笹塚の留置:ほかの線路と離れる', !foul, '離れ3.0m 以上(東端は分岐の先)', foul ? foul[0] + ' 離れ' + foul[1].toFixed(2) + 'm' : 'すべて3.0m 以上');
      const lit = P.cars.filter((c) => c.userData.k8.lights !== 'off' || c.userData.k8.sign).length;
      const cabs = P.cars[0].userData.k8.cabR && P.cars[9].userData.k8.cabF && P.cars.slice(1, 9).every((c) => !c.userData.k8.cabF && !c.userData.k8.cabR);
      ok('笹塚の留置:運転台は両端・消灯', cabs && lit === 0, '両端に運転台・灯火と表示は消灯', (cabs ? '両端' : '運転台の位置違い') + '・点灯' + lit + '両');
    }
  }
  /* 2-4f 笹塚の3番線に 9000系10両(利用者指示)。基準は検証側で持つ:
       編成 9734F(新宿方から 9734・9034・9084・9534・9134・9584・9684・9234・9284・9784)、
       3番線=笹塚のホームに面する線路を南から数えて3番目(京王の番線の数え方)。
     守ること:①その線路の上 ②ホームの範囲に収まる ③ほかの線路(本線へ渡る分岐)が車体の幅に入ってこない
     ④上りの向き(新宿方=東端が先頭で前照灯、西端が尾灯)・表示器が点いている(各停 本八幡=利用者指示)
     ⑤40か所の扉がホームドアの開口に合う ⑥扉とホームドアはホーム側が開いている(利用者指示) */
  {
    const REF_9734F = ['9734', '9034', '9084', '9534', '9134', '9584', '9684', '9234', '9284', '9784'];
    const DOORX = [-7.05, -2.35, 2.35, 7.05];                 // 扉の中心(車両中心から。8000系・9000系とも)
    const sasa = X.STA.find((s) => s.n === '笹塚'), pr = X.platRange(sasa);
    // ホームの全長に掛かる線路を南(off の小さい側)から並べる
    const offs = [];
    for (const t of X.TRACKS) {
      if (t.x0 > pr[0] || t.x1 < pr[1]) continue;
      const o = t.zf(sasa.x); if (!offs.some((v) => Math.abs(v - o) < 0.5)) offs.push(o);
    }
    offs.sort((a, b) => a - b);
    const off3 = offs[2];
    const P = X.PARKS.find((q) => /笹塚/.test(q.name) && /3番線/.test(q.name));
    if (!P || offs.length !== 4) ok('笹塚の3番線に9000系', false, '10両(ホームの線路4本)', P ? '線路' + offs.length + '本' : '無い');
    else {
      const nums = P.cars.map((c) => c.userData.k8.num), ser = P.cars.every((c) => c.userData.k8.series === '9000');
      ok('笹塚の3番線に9000系10両', P.cars.length === 10 && ser && JSON.stringify(nums) === JSON.stringify(REF_9734F),
        '9734F(新宿方から)', P.cars.length + '両・' + (ser ? '9000系' : '形式違い') + '・' + nums.join(' '));
      const half = X.K8.LEN / 2, ss = P.cars.map((c) => c.userData.s);
      const e0 = Math.min(...ss) - half, e1 = Math.max(...ss) + half;
      let badOn = null;
      for (const c of P.cars) {
        const q = X.frame(c.userData.s, off3), d = Math.hypot(c.position.x - q.x, c.position.z - q.z);
        if (d > 0.3 && !badOn) badOn = c.userData.k8.num + ' ずれ' + d.toFixed(2) + 'm';
      }
      const tr = X.TRACKS.filter((t) => Math.abs(t.zf(sasa.x) - off3) < 0.05 && e0 >= t.x0 && e1 <= t.x1);
      ok('笹塚の3番線:線路の上・ホームに収まる', !badOn && tr.length > 0 && e0 >= pr[0] && e1 <= pr[1],
        '南から3番目の線路(off ' + off3.toFixed(2) + ')・ホーム ' + pr[0].toFixed(0) + '〜' + pr[1].toFixed(0),
        (badOn || 'ずれ0.3m 以内') + '・' + e0.toFixed(1) + '〜' + e1.toFixed(1));
      let foul = null;
      for (let s = e0; s <= e1; s += 1) for (const t of X.TRACKS) {
        if (tr.indexOf(t) >= 0 || s < t.x0 || s > t.x1) continue;
        const d = Math.abs(t.zf(s) - off3);
        if (d < 3.0 && (!foul || d < foul[1])) foul = [t.id + ' s=' + s.toFixed(0), d];
      }
      ok('笹塚の3番線:ほかの線路と離れる', !foul, '離れ3.0m 以上(西端は分岐の手前)', foul ? foul[0] + ' 離れ' + foul[1].toFixed(2) + 'm' : 'すべて3.0m 以上');
      // 向き:東端(s の小さい側)の車両が先頭(運転台・前照灯)、西端が最後尾(尾灯)。表示は全車で点く
      const byS = P.cars.slice().sort((a, b) => a.userData.s - b.userData.s), E = byS[0].userData.k8, W = byS[9].userData.k8;
      const head = (E.cabF || E.cabR) && E.lights === 'head' && (W.cabF || W.cabR) && W.lights === 'tail';
      const signs = P.cars.filter((c) => c.userData.k8.sign && c.userData.k8.sign.kind === '各停' && c.userData.k8.sign.dest === '本八幡').length;
      ok('笹塚の3番線:新宿方が先頭・各停 本八幡', head && signs === 10 && E.num === REF_9734F[0],
        '東端 ' + REF_9734F[0] + '=前照灯・西端=尾灯・各停 本八幡10両', (head ? '東端 ' + E.num + ' 前照灯' : '向き違い') + '・各停 本八幡' + signs + '両');
      // 扉:その線に面したホームドアの列の開口に、40か所の扉が合う
      const row = X.PSD.find((q) => q.st === sasa && Math.abs(q.off - off3) < 2.5);
      let worst = 0, nd = 0;
      if (row) for (const c of P.cars) for (const dx of DOORX) {
        const x = c.userData.s + dx; nd++;
        worst = Math.max(worst, Math.min(...row.open.map((o) => Math.abs(o - x))));
      }
      ok('笹塚の3番線:扉がホームドアの開口に合う', !!row && nd === 40 && worst < 0.3, '40か所・ずれ0.3m 未満',
        row ? nd + 'か所・最大のずれ ' + worst.toFixed(2) + 'm' : 'ホームドアの列なし');
      // 扉とホームドアが開いている。開く面は検証側で求める:上りの向き(東へ)の前 F と上 UP から R=F×UP、
      // 車体ローカル+z が +off(北)を向くか(seatCar と同じ式)。ホーム(列)が線路のどちら側かで正しい面が決まる
      const s = sasa.x, pA = X.frame(s - 1, 0), pB = X.frame(s + 1, 0), pO = X.frame(s, 0), pN = X.frame(s, 1);
      const fx = -(pB.x - pA.x), fz = -(pB.z - pA.z), lz = ((-fz) * (pN.x - pO.x) + fx * (pN.z - pO.z)) > 0 ? 1 : -1;
      const wantSide = row ? (row.off > off3 ? 1 : -1) * lz : 0;
      for (let i = 0; i < 100; i++) X.stepPSD(0.05);          // 5秒動かしても開いたまま(列車が停まらない列は閉じようとする)
      const doorsOK = P.cars.filter((c) => c.userData.doors && c.userData.doors.r === 1 && c.userData.doors.side === wantSide).length;
      ok('笹塚の3番線:扉とホームドアがホーム側で開く', !!row && row.r === 1 && doorsOK === 10,
        'ホームドア開・10両の扉がホーム側(' + (row && row.off > off3 ? '北' : '南') + ')で開く',
        row ? 'ホームドア ' + row.r + '・扉 ' + doorsOK + '両' : 'ホームドアの列なし');
    }
  }
  // 2-5 架線の高さの順序:トロリ線 < ちょう架線 < ビーム下弦(部材と干渉しない)
  {
    const good = X.WIRE_TRO < X.WIRE_CAT && X.WIRE_CAT < X.BEAM_LOW && X.BEAM_LOW < X.POLE_TOP;
    ok('架線とビームの高さ関係', good, 'トロリ<ちょう架<下弦<上弦',
      [X.WIRE_TRO, X.WIRE_CAT, X.BEAM_LOW, X.POLE_TOP].map((v) => v.toFixed(2)).join(' < '));
  }
  // 2-5b インテグレート架線の形(基準値は検証側が持つ)
  {
    // 電線の構成:き電ちょう架線2条+トロリ線1条。き電線は別に張らない
    let bad = null;
    const want = ['き電ちょう架線', 'き電ちょう架線', 'トロリ線'].join();
    for (const c of X.CHAINS) {
      if ((c.cond || []).join() !== want && !bad) bad = [c.ids[0], (c.cond || []).join('・') || '構成の記録なし'];
      if (!(c.twin >= CATREF.TWIN[0] && c.twin <= CATREF.TWIN[1]) && !bad) bad = [c.ids[0], '2条の間隔 ' + c.twin];
    }
    if (/function\s+feeder\s*\(/.test(X.__html) && !bad) bad = ['き電線(feeder)が別に張られている'];
    ok('電線=き電ちょう架線2条+トロリ線', bad === null && X.CHAINS.length > 0,
      '間隔' + CATREF.TWIN.join('〜') + 'm・き電線なし', bad ? bad.join(' ') : X.CHAINS.length + '本すべて');
  }
  {
    /* 偏位:直線では支持点ごとに左右へ交互(ジグザグ)、0.15〜0.25m。
       曲線(線路が柱間の弦から膨らむ所)では膨らむ側=曲線の外側へ寄せる(大きさ≤0.25m)。
       膨らみは検証側が線路の式と frame から独立に求める */
    const bulge = (zf, a, b) => {
      const fa = X.frame(a, zf(a)), fb = X.frame(b, zf(b));
      let m = 0;
      for (let u = 0.05; u < 0.96; u += 0.05) {
        const s = a + (b - a) * u, f = X.frame(s, zf(s)), g = X.frame(s, zf(s) + 1);
        const e = (f.x - fa.x - (fb.x - fa.x) * u) * (g.x - f.x) + (f.z - fa.z - (fb.z - fa.z) * u) * (g.z - f.z);
        if (Math.abs(e) > Math.abs(m)) m = e;
      }
      return m;
    };
    let bad = null, nS = 0, nC = 0;
    for (const c of X.CHAINS) {
      let prev = 0;
      for (let k = 1; k < c.nodes.length - 1; k++) {
        const d = c.d[k], s = c.nodes[k];
        const b = (bulge(c.zf, c.nodes[k - 1], s) + bulge(c.zf, s, c.nodes[k + 1])) / 2;
        if (Math.abs(b) < CATREF.BEND) {
          nS++;
          if ((Math.abs(d) < CATREF.STAG[0] || Math.abs(d) > CATREF.STAG[1]) && !bad) bad = [c.ids[0], 's=' + s.toFixed(0), '偏位 ' + d.toFixed(3)];
          if (prev && Math.sign(prev) === Math.sign(d) && !bad) bad = [c.ids[0], 's=' + s.toFixed(0), '直線で同じ側が続く'];
          prev = d;
        } else {
          nC++;
          if ((Math.sign(d) !== Math.sign(b) || Math.abs(d) > CATREF.STAG[1]) && !bad)
            bad = [c.ids[0], 's=' + s.toFixed(0), '曲線で外側へ寄っていない(偏位' + d.toFixed(3) + '・膨らみ' + b.toFixed(3) + ')'];
          prev = 0;
        }
      }
    }
    ok('トロリ線の偏位(直線は交互・曲線は外側)', bad === null && nS > 0, '±' + CATREF.STAG.join('〜') + 'm',
      bad ? bad.join(' ') : '直線' + nS + '・曲線' + nC + '支持点');
  }
  {
    // 柱間のどこでもトロリ線が線路中心からパンタの集電範囲内(曲線では弦が内へ寄る)
    let worst = 0, at = null;
    for (const c of X.CHAINS) {
      for (let k = 0; k < c.nodes.length - 1; k++) {
        const s0 = c.nodes[k], s1 = c.nodes[k + 1];
        if (s1 - s0 < 0.05) continue;
        const A = X.frame(s0, c.zf(s0) + c.d[k]), B = X.frame(s1, c.zf(s1) + c.d[k + 1]);
        for (let u = 0; u <= 1.0001; u += 0.05) {
          const s = s0 + (s1 - s0) * u, px = A.x + (B.x - A.x) * u, pz = A.z + (B.z - A.z) * u;
          const o = c.zf(s), f = X.frame(s, o), g = X.frame(s, o + 1);
          const dev = (px - f.x) * (g.x - f.x) + (pz - f.z) * (g.z - f.z);
          if (Math.abs(dev) > worst) { worst = Math.abs(dev); at = [c.ids[0], 's=' + s.toFixed(0)]; }
        }
      }
    }
    ok('トロリ線が集電範囲内', worst <= CATREF.DEV, '線路中心から≤' + CATREF.DEV + 'm',
      worst.toFixed(3) + 'm' + (at ? '(' + at.join(' ') + ')' : ''));
  }
  {
    // ハンガ:約5m間隔。支持点から最初のハンガまでも離れすぎない。最短のハンガの長さ
    let bad = null, n = 0, maxSag = 0;
    for (const c of X.CHAINS) {
      const H = c.hang.slice().sort((a, b) => a - b);
      for (let k = 0; k < c.nodes.length - 1; k++) {
        const s0 = c.nodes[k], s1 = c.nodes[k + 1];
        if (s1 - s0 < 2 * CATREF.HANG_END) continue;
        const in_ = H.filter((h) => h > s0 && h < s1);
        n += in_.length;
        const pts = [s0].concat(in_, [s1]);
        for (let i = 1; i < pts.length; i++) {
          const g = pts[i] - pts[i - 1], lim = (i === 1 || i === pts.length - 1) ? CATREF.HANG_END : CATREF.HANG;
          if (g > lim + 1e-6 && !bad) bad = [c.ids[0], 's=' + pts[i - 1].toFixed(1) + '〜' + pts[i].toFixed(1), g.toFixed(2) + 'm'];
        }
        maxSag = Math.max(maxSag, c.sag[k] || 0);
      }
    }
    const minLen = X.WIRE_CAT - maxSag - X.WIRE_TRO;
    ok('ハンガの間隔', bad === null && n > 0, '≤' + CATREF.HANG + 'm(支持点から≤' + CATREF.HANG_END + 'm)',
      bad ? bad.join(' ') : n + '本');
    ok('トロリ線の高さ・ハンガの長さ', Math.abs(X.WIRE_TRO - CATREF.TRO) < 0.005 &&
      X.WIRE_CAT - X.WIRE_TRO >= CATREF.SYS[0] && X.WIRE_CAT - X.WIRE_TRO <= CATREF.SYS[1] && minLen >= CATREF.HANG_MIN,
      'トロリ' + CATREF.TRO + 'm・間隔' + CATREF.SYS.join('〜') + 'm・最短≥' + CATREF.HANG_MIN + 'm',
      'トロリ' + X.WIRE_TRO.toFixed(2) + 'm・間隔' + (X.WIRE_CAT - X.WIRE_TRO).toFixed(2) + 'm・最短' + minLen.toFixed(2) + 'm');
  }
  {
    // 支持点ごとに、その架線を支える可動ブラケット(または懸垂)があること
    let bad = null, n = 0;
    X.CHAINS.forEach((c, ci) => {
      for (let k = 1; k < c.nodes.length - 1; k++) {
        const s = c.nodes[k], o = c.zf(s) + c.d[k];
        n++;
        const q = X.SUPS.find((u) => Math.abs(u.s - s) < 1e-6 && u.ch.indexOf(ci) >= 0 && u.M.some((m) => Math.abs(m - o) < 1e-6));
        if (!q && !bad) bad = [c.ids[0], 's=' + s.toFixed(0)];
      }
    });
    const by = {}; for (const u of X.SUPS) by[u.mount] = (by[u.mount] || 0) + 1;
    ok('支持点に可動ブラケット', bad === null && n > 0, '全支持点', bad ? bad.join(' ') + ' に支持が無い' :
      Object.keys(by).map((k) => k + by[k]).join('・'));
  }
  {
    // 支持物がパンタ・車両に当たらない:付け根(柱の面・吊りパイプ)は線路中心から離す/
    // 振止め金具はトロリ線から離れるほど高い(上り勾配)
    const tracksAt = (s) => X.TRACKS.filter((t) => s >= t.x0 - 0.5 && s <= t.x1 + 0.5).map((t) => t.zf(s));
    let bad = null, nb = 0, ns = 0;
    for (const u of X.SUPS) {
      if (u.b !== undefined) {
        nb++;
        const near = Math.min.apply(null, tracksAt(u.s).map((z) => Math.abs(u.b - z)));
        if (near < CATREF.DROP_CLEAR && !bad) bad = [u.mount, 's=' + u.s.toFixed(0), '付け根が線路中心から' + near.toFixed(2) + 'm'];
      }
      for (const st of u.steady) {
        ns++;
        const dx = Math.abs(st[0][0] - st[1][0]), dy = st[0][1] - st[1][1];
        if ((dx < 0.3 || dy / dx < CATREF.STEADY_SLOPE) && !bad) bad = [u.mount, 's=' + u.s.toFixed(0), '振止めの勾配 ' + (dy / Math.max(dx, 1e-6)).toFixed(3)];
      }
      if (u.mount === 'ビーム' || u.mount === '屋根' || u.mount === '床版' || u.mount === '柱') {
        if (u.h1 === undefined && !bad) bad = [u.mount, 's=' + u.s.toFixed(0), 'ブラケットの記録なし'];
      }
    }
    ok('ブラケットがパンタに当たらない', bad === null && nb > 0, '付け根≥' + CATREF.DROP_CLEAR + 'm・振止め勾配≥' + CATREF.STEADY_SLOPE,
      bad ? bad.join(' ') : '付け根' + nb + '・振止め' + ns);
  }
  {
    // 架線柱:建築限界の外(線路中心から柱の面まで)/ホームの上なら線路側の縁から離す/
    // 大屋根の下には建てない(屋根の梁から吊る)/ビームはき電ちょう架線より上
    const ROOF_HALF = 107, ROOF_T = ['isl', 'side', 'quad'];
    const underRoof = (s) => X.STA.some((st) => ROOF_T.indexOf(st.t) >= 0 && Math.abs(s - st.x) < ROOF_HALF);
    let bad = null, minC = 1e9;
    for (const q of X.POLES) {
      for (const t of X.TRACKS) {
        if (q.s < t.x0 - q.r || q.s > t.x1 + q.r) continue;
        const c = Math.abs(q.o - t.zf(q.s)) - q.r;
        minC = Math.min(minC, c);
        if (c < CATREF.POLE_CLEAR && !bad) bad = ['s=' + q.s.toFixed(0), t.id + 'から' + c.toFixed(2) + 'm'];
      }
      for (const pl of X.PLATS) {
        if (q.s < pl.x0 || q.s > pl.x1 || Math.abs(q.o - pl.off) > pl.hw) continue;
        // 線路側の縁(その縁の外に線路がある縁)からの距離
        for (const sg of [-1, 1]) {
          const edge = pl.off + sg * pl.hw;
          const faces = X.TRACKS.some((t) => q.s >= t.x0 && q.s <= t.x1 && sg * (t.zf(q.s) - edge) > 0 && sg * (t.zf(q.s) - edge) < 2.6);
          if (faces && Math.abs(edge - q.o) - q.r < CATREF.POLE_EDGE && !bad) bad = ['s=' + q.s.toFixed(0), 'ホームの縁から' + (Math.abs(edge - q.o) - q.r).toFixed(2) + 'm'];
        }
      }
      if (underRoof(q.s) && !bad) bad = ['s=' + q.s.toFixed(0), '大屋根の下に柱'];
    }
    for (const u of X.SUPS) if (underRoof(u.s) !== (u.mount.indexOf('屋根') === 0) && !bad) bad = ['s=' + u.s.toFixed(0), u.mount + 'が屋根の' + (underRoof(u.s) ? '下' : '外')];
    for (const b of X.BEAMS) {
      const y = X.railY(b.s) + X.RAIL_TOP + X.WIRE_CAT + CATREF.BEAM_OVER;
      if (b.y0 < y && !bad) bad = ['s=' + b.s.toFixed(0), 'ビームの下端が低い ' + (b.y0 - X.railY(b.s) - X.RAIL_TOP).toFixed(2)];
    }
    for (const L of X.POLE_LAMPS) if (!X.POLES.some((q) => Math.abs(q.s - L.s) < 0.01 && Math.abs(q.o - L.o) < 0.7) && !bad) bad = ['s=' + L.s.toFixed(0), '灯りが柱に付いていない'];
    ok('架線柱の位置', bad === null && X.POLES.length > 0, '線路中心から面まで≥' + CATREF.POLE_CLEAR + 'm・ホームの縁から≥' + CATREF.POLE_EDGE + 'm・大屋根の下に無し',
      bad ? bad.join(' ') : X.POLES.length + '本(最小' + minC.toFixed(2) + 'm)・ビーム' + X.BEAMS.length);
  }
  // 2-6 同じ場所に線路(と架線)が二重に敷かれていないこと
  //     副本線や留置線を分岐の終わりより先まで伸ばすと、本線と同じ位置に架線が重なり
  //     「不要な線」として見える。実際にこの検査で12組の重複を検出・除去した。
  {
    const T = X.TRACKS;
    let worst = null, pairs = 0;
    for (let i = 0; i < T.length; i++) {
      for (let j = i + 1; j < T.length; j++) {
        const a = T[i], b = T[j];
        const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
        if (hi - lo < 20) continue;
        let run = 0, best = 0;
        for (let s = lo; s <= hi; s += 5) {
          if (Math.abs(a.zf(s) - b.zf(s)) < 0.15) { run += 5; if (run > best) best = run; }
          else run = 0;
        }
        if (best >= 20) { pairs++; if (!worst || best > worst[2]) worst = [a.id, b.id, best]; }
      }
    }
    // ※分岐の見え方を優先し、副本線・留置線は本線と重なる範囲まで敷設する方針に
    //   戻したため、ここは合否ではなく参考値として出す。
    rows.push(['線路の重複(参考)', '-',
      pairs ? pairs + '組 最長' + worst[2] + 'm' : '0組', 'OK']);
  }
  rows.push(['架線柱の本数', '-', X.POLE_S.length + '本', 'OK']);
  rows.push(['敷設した線路', '-', X.TRACKS.length + '本', 'OK']);
} else {
  rows.push(['架線の検査', 'TRACKS/WIRES', '未登録(スキップ)', '--']);
}

/* ---- 3. 高架橋の構造(RCラーメン) -------------------------------------------
   柱・梁・床版・高欄は結合ジオメトリで作るので、登録簿(VIA_COLS・STRUCT)で測る。
   構造上の目安は検証側が持つ(HTMLからは読まない)。 */
{
  const V = {
    COL_IN: 1.0,       // 柱の中心は桁端から1.0m以上内側(側道に出ない)
    COL_GAP: 9.6,      // 1列の柱の間隔の上限[m](横梁の支間)
    SPAN_MAX: 45,      // 柱の列の間隔の上限[m](道路・鉄道を跨ぐ桁の支間)
    PAR_H: 2.1,        // 高欄の上端(レール面から)[m]=従来の防音壁と同じ
    BODY_HW: 1.385 + 0.06, BODY_Y: [0.3, 4.3],
  };
  const C = X.VIA_COLS;
  ok('柱の列がある', C.length > 300, '300列以上', C.length + '列');
  let bIn = null, bGap = null, bSpan = null, bTop = null;
  for (let i = 0; i < C.length; i++) {
    const c = C[i], h = X.deckHalf(c.s);
    if (c.offs.length < 2 && !bIn) bIn = ['s=' + c.s.toFixed(0), c.offs.length + '本'];
    for (const o of c.offs) if (Math.abs(o) > h - V.COL_IN + 1e-6 && !bIn) bIn = ['s=' + c.s.toFixed(0), 'off=' + o.toFixed(2), '桁端' + h.toFixed(2)];
    for (let k = 1; k < c.offs.length; k++) {
      const g = c.offs[k] - c.offs[k - 1];
      if (g > V.COL_GAP && !bGap) bGap = ['s=' + c.s.toFixed(0), g.toFixed(2) + 'm'];
    }
    if (Math.abs(c.top - (X.railY(c.s) - 2.4)) > 0.01 && !bTop) bTop = ['s=' + c.s.toFixed(0), c.top.toFixed(2)];
    if (i > 0) {
      const d = c.s - C[i - 1].s;
      if (d > V.SPAN_MAX && !bSpan) bSpan = [C[i - 1].s.toFixed(0) + '〜' + c.s.toFixed(0), d.toFixed(0) + 'm'];
    }
  }
  ok('柱が桁の下に収まる', bIn === null, '桁端から' + V.COL_IN + 'm以上内側・2本以上', bIn ? bIn.join(' ') : '全て');
  ok('1列の柱の間隔', bGap === null, '≤' + V.COL_GAP + 'm', bGap ? bGap.join(' ') : '全て');
  ok('柱の列の間隔(支間)', bSpan === null, '≤' + V.SPAN_MAX + 'm', bSpan ? bSpan.join(' ') : '全て');
  ok('柱の上端=横梁の下端', bTop === null, 'レール面-2.4m', bTop ? bTop.join(' ') : '全て');
  // 床版と高欄が全線に途切れなく続く(登録簿の区間を合成して隙間を探す)
  const cover = (tag, pred) => {
    const seg = X.STRUCT.filter((q) => q.tag === tag && pred(q)).map((q) => [q.s0, q.s1]).sort((a, b) => a[0] - b[0]);
    let end = X.DOM.x0, gap = null;
    for (const g of seg) { if (g[0] > end + 0.05 && !gap) gap = [end.toFixed(1), g[0].toFixed(1)]; end = Math.max(end, g[1]); }
    if (end < X.DECK_END - 0.05 && !gap) gap = [end.toFixed(1), X.DECK_END.toFixed(1)];
    return gap;
  };
  const gS = cover('床版', () => true), gN = cover('高欄', (q) => q.o0 > 0), gSo = cover('高欄', (q) => q.o1 < 0);
  ok('床版が途切れない', gS === null, X.DOM.x0.toFixed(0) + '〜' + X.DECK_END, gS ? '隙間 ' + gS.join('〜') : '連続');
  ok('高欄が両側で途切れない', gN === null && gSo === null, '北・南とも連続',
    gN ? '北 ' + gN.join('〜') : gSo ? '南 ' + gSo.join('〜') : '連続');
  // 高欄の高さと位置(桁端に立つ)
  let bP = null;
  for (const q of X.STRUCT) {
    if (q.tag !== '高欄') continue;
    const s = (q.s0 + q.s1) / 2, top = q.y1 - Math.max(X.railY(q.s0), X.railY(q.s1));
    const h = Math.max(X.deckHalf(q.s0), X.deckHalf(q.s1)) + 0.06;   // 笠木は外へ6cm張り出す
    if (Math.abs(top - V.PAR_H) > 0.05 && !bP) bP = ['s=' + s.toFixed(0), '高さ' + top.toFixed(2)];
    const outer = Math.max(Math.abs(q.o0), Math.abs(q.o1));
    // 掃引は2m標本・誤差2cmで間引くので、標本の間の曲がり(幅のなめらかな変化)ぶんを8cmまで許す
    // (登録簿は横に動く所を細かく切るので、標本の間の直線の上の点も測る。幅の変わり始めで最大7cm。床版も同じ標本で描く)
    if (Math.abs(outer - h) > 0.08 && !bP) bP = ['s=' + s.toFixed(0), '外面' + outer.toFixed(2) + '≠桁端+笠木' + h.toFixed(2)];
  }
  ok('高欄の高さ・位置', bP === null, 'レール面+' + V.PAR_H + 'm・桁端', bP ? bP.join(' ') : '全て');
  // 高架の部品(高欄・ケーブルトラフ・柱・梁)が車両の通る空間に入らない
  let bC = null, n = 0;
  for (const q of X.STRUCT) {
    if (['高欄', 'ケーブルトラフ', '柱', '横梁', '縦梁'].indexOf(q.tag) < 0) continue;
    n++;
    for (const s of [q.s0, (q.s0 + q.s1) / 2, q.s1]) {
      const y = X.railY(s);
      for (const t of X.TRACKS) {
        if (s < t.x0 || s > t.x1) continue;
        const o = t.zf(s);
        if (q.y1 > y + V.BODY_Y[0] && q.y0 < y + V.BODY_Y[1] && q.o1 > o - V.BODY_HW && q.o0 < o + V.BODY_HW && !bC)
          bC = [q.tag, 's=' + s.toFixed(0), t.id];
      }
    }
  }
  ok('高架の部品が車両に当たらない', bC === null, '0件(' + n + '部品)', bC ? bC.join(' ') : '0件(' + n + '部品)');
}

/* ---- 4. 仙川の掘割(利用者指示 2026-10-11:仙川駅は左右の土地より7m 程度低い掘割の中の駅) ----------------
   擁壁・底・渡る床版・架線柱は登録簿(STRUCT の '擁壁'・'掘割の底'・'掘割を渡る床版'・'橋上駅舎'、POLES)で測る。
   要件は検証側が持つ:深さ・擁壁の内面の余裕(高架の高欄の内面と同じ=最外軌道+2.21m・ホームの外縁+0.36m)・
   床版の下端(き電ちょう架線 5.9m の上) */
{
  const CUT = { DEPTH: [6.0, 8.0], CLEAR: 2.21, PLAT: 0.36, DECK: 6.2, BASE: 0.49, TOL: 0.03 };
  const st = X.STA.find((s) => s.n === '仙川');
  const depth = -(X.railY(st.x) + X.RAIL_TOP);
  ok('仙川は掘割の駅', depth >= CUT.DEPTH[0] && depth <= CUT.DEPTH[1], '地表からレール面まで' + CUT.DEPTH.join('〜') + 'm', depth.toFixed(2) + 'm');
  const W = X.STRUCT.filter((q) => q.tag === '擁壁'), F = X.STRUCT.filter((q) => q.tag === '掘割の底');
  const tracksAt = (s) => X.TRACKS.filter((t) => s >= t.x0 && s <= t.x1).map((t) => t.zf(s));
  // 擁壁の内面:登録簿の区間(6m 以下)ごとに、両端の必要な幅の小さい方より外。上端は地表より上・下端は道床より下
  const needAt = (s, sg) => { let n = Math.max(...tracksAt(s).map((o) => sg * o)) + CUT.CLEAR;
    for (const p of X.PLATS) if (s >= p.x0 && s <= p.x1 && sg * p.off > 0) n = Math.max(n, sg * p.off + p.hw + CUT.PLAT);
    return n; };
  let bW = null;
  for (const q of W) {
    const sg = (q.o0 + q.o1) > 0 ? 1 : -1, inner = sg > 0 ? q.o0 : -q.o1;
    const need = Math.min(needAt(q.s0, sg), needAt(q.s1, sg));
    if (inner < need - CUT.TOL && !bW) bW = ['s=' + q.s0.toFixed(0), sg > 0 ? '北' : '南', '内面' + inner.toFixed(2) + '<' + need.toFixed(2)];
    if (q.y1 < 0 && !bW) bW = ['s=' + q.s0.toFixed(0), '上端' + q.y1.toFixed(2)];
    if (q.y0 > Math.min(X.railY(q.s0), X.railY(q.s1)) - 0.5 && !bW) bW = ['s=' + q.s0.toFixed(0), '下端' + q.y0.toFixed(2)];
  }
  // 掘割(道床が地表より 1m 以上低い所)は 5m ごとに両側の擁壁と底がある
  let bC = null, nS = 0;
  for (let s = X.DECK_END + 2; s < X.DOM.x1 - 2; s += 5) {
    const y = X.railY(s); if (y > -1) continue; nS++;
    const offs = tracksAt(s), at = (L) => L.filter((q) => q.s0 <= s + 1e-6 && q.s1 >= s - 1e-6);
    for (const sg of [-1, 1]) if (!at(W).some((q) => sg * (q.o0 + q.o1) > 0) && !bC) bC = ['s=' + s.toFixed(0), (sg > 0 ? '北' : '南') + 'の擁壁が無い'];
    if (!at(F).some((q) => q.y1 < y && q.o0 < Math.min(...offs) - 1 && q.o1 > Math.max(...offs) + 1) && !bC) bC = ['s=' + s.toFixed(0), '底が無い'];
  }
  ok('掘割の擁壁が線路とホームを囲む', bW === null && W.length > 50, '内面が最外軌道+' + CUT.CLEAR + 'm・ホーム外縁+' + CUT.PLAT + 'm 以上・上端は地表より上', bW ? bW.join(' ') : W.length + '区間');
  ok('掘割の擁壁と底が続く', bC === null && nS > 50, '5m ごとに両側の擁壁と底', bC ? bC.join(' ') : nS + '断面');
  // 渡る床版(道路橋・西端の覆い・橋上駅舎)の下端はき電ちょう架線の上
  const D = X.STRUCT.filter((q) => q.tag === '掘割を渡る床版' || (q.tag === '橋上駅舎' && X.railY((q.s0 + q.s1) / 2) < -1));
  let bD = null;
  for (const q of D) for (const s of [q.s0, q.s1]) { const c = q.y0 - (X.railY(s) + X.RAIL_TOP); if (c < CUT.DECK && !bD) bD = [q.tag, 's=' + s.toFixed(0), c.toFixed(2) + 'm']; }
  ok('掘割を渡る床版はき電ちょう架線の上', bD === null && D.length > 0, 'レール面+' + CUT.DECK + 'm 以上', bD ? bD.join(' ') : D.length + '件');
  // 架線柱:根元は掘割の底(登録簿の底の高さ)・床版の下に立たない
  let bP = null, nP = 0;
  for (const p of X.POLES) {
    if (p.s < X.DECK_END + 1) continue;
    const f = F.find((q) => q.s0 <= p.s + 1e-6 && q.s1 >= p.s - 1e-6); if (!f) continue;
    nP++;
    // 底は西へ下る(区間の東端が上端 y1・西端が下端 y0)ので、柱の位置で補間する
    const fy = f.y1 + (f.y0 - f.y1) * (p.s - f.s0) / Math.max(1e-6, f.s1 - f.s0);
    if (Math.abs(p.y0 - CUT.BASE - fy) > 0.05 && !bP) bP = ['s=' + p.s.toFixed(1), '根元' + (p.y0 - CUT.BASE).toFixed(2) + '≠底' + fy.toFixed(2)];
    for (const q of D) if (p.s > q.s0 - 0.3 && p.s < q.s1 + 0.3 && q.y0 < p.y1 && !bP) bP = ['s=' + p.s.toFixed(1), q.tag + 'の下'];
  }
  ok('掘割の架線柱', bP === null && nP > 10, '根元=掘割の底・床版の下に無い', bP ? bP.join(' ') : nP + '本');
  // 床版の下の支持点は床版から吊る(床版の外は柱・ビーム)。床版の範囲は登録簿の s の範囲
  let bU = null, nU = 0;
  for (const u of X.SUPS) {
    if (u.s < X.DECK_END) continue;
    const under = D.some((q) => u.s > q.s0 && u.s < q.s1), deck = u.mount.indexOf('床版') === 0;
    if (deck) nU++;
    if (under !== deck && !bU) bU = ['s=' + u.s.toFixed(1), u.mount + (under ? '(床版の下)' : '(床版の外)')];
  }
  ok('床版の下の架線は床版から吊る', bU === null && nU > 0, '床版の下=床版から・外=柱/ビーム', bU ? bU.join(' ') : nU + 'か所');
  // 架空地線(柱の頂部どうし)は床版をはさむ柱の間に張らない(床版を突き抜ける)
  let bG = null, nG = 0;
  const segs = []; for (const C of X.VIA_CH) for (let i = 0; i + 5 < C.wl.length; i += 6) segs.push(C.wl.slice(i, i + 6));
  const topOf = (p) => { const f = X.frame(p.s, p.o); return [f.x, p.y1 + 0.06, f.z]; };
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.02;
  for (const sg of [-1, 1]) {
    const L = X.POLES.filter((p) => p.sg === sg && p.s > X.DECK_END).sort((a, b) => a.s - b.s);
    for (let i = 1; i < L.length; i++) {
      const a = L[i - 1], b = L[i];
      if (!D.some((q) => q.s1 > a.s && q.s0 < b.s && q.y0 < Math.max(a.y1, b.y1))) continue;
      nG++;
      const A = topOf(a), B = topOf(b);
      if (segs.some((g) => (near(g.slice(0, 3), A) && near(g.slice(3), B)) || (near(g.slice(0, 3), B) && near(g.slice(3), A))) && !bG)
        bG = ['s=' + a.s.toFixed(0) + '〜' + b.s.toFixed(0)];
    }
  }
  ok('架空地線は床版の下を通らない', bG === null && nG > 0, '床版をはさむ柱の間に張らない', bG ? bG.join(' ') : nG + 'か所');
}

/* ---- 事業区間の東端(2026-10-11 利用者指示:笹塚駅の東側200mを削除) --------------
   以前の東端は笹塚の中心から480m 東(s=−520)。200m を削って 280m 東。線路・架線・柱・高架の区画は東端より東に無い */
{
  const EAST = 280;                                       // 笹塚の中心から東端まで[m](検証側の値)
  const c0 = X.STA[0].x, e = c0 - X.DOM.x0;
  const tr = (X.TRACKS || []).filter((t) => Math.min(t.x0, t.x1) < X.DOM.x0 - 0.5).length;
  const pl = X.POLE_S.filter((s) => s < X.DOM.x0 - 0.5).length;
  const st = X.STRUCT.filter((q) => q.s1 !== undefined && q.s1 < X.DOM.x0 - 1).length;
  ok('東端=笹塚の中心から' + EAST + 'm 東', Math.abs(e - EAST) < 1 && tr === 0 && pl === 0 && st === 0,
    '±1m・東に線路/柱/構造なし', e.toFixed(1) + 'm・線路' + tr + '・柱' + pl + '・構造' + st);
}

/* ---- 出力 ---- */
const w = (s, n) => String(s) + ' '.repeat(Math.max(0, n -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
console.log('=== 高架橋の桁幅・架線の検証(全線 ' + REQ.STEP + 'm刻み) ===');
console.log('');
console.log(w('項目', 28) + w('要件', 18) + w('実測', 24) + '判定');
for (const r of rows) console.log(w(r[0], 28) + w(r[1], 18) + w(r[2], 24) + r[3]);
console.log('');
console.log('駅の桁半幅: ' + X.STA.filter((s) => s.x <= X.DECK_END)
  .map((s) => s.n + ' ' + X.deckHalf(s.x).toFixed(1)).join(' / '));
console.log('RESULT: ' + (ng ? 'FAIL(' + ng + '項目NG)' : 'PASS'));
process.exit(ng ? 1 : 0);
