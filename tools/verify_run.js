// 自動運転を実際に走らせて、停止位置・停車時間・走行線を検査する。
//
//   「停止位置がずれている」「八幡山で外側の通過線を走ってしまう」といった不具合は
//   見た目では気づきにくく、AIは描画を見られない。そこで運転ロジックをそのまま
//   時間発展させ、どこにどれだけ停まったかを数値で確かめる。
//
//   使い方: node tools/verify_run.js [keio_elevated_3d.html]
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path,
  'STA:STA,platRange:platRange,stopPosOf:stopPosOf,nextStopFor:nextStopFor,' +
  'driveTrain:driveTrain,DRIVE:DRIVE,DWELL_OF:DWELL_OF,CAR_HALF:CAR_HALF,K8:K8,' +
  'mainOff:mainOff,runOff:runOff,DOM:DOM,STOP_BACK:STOP_BACK,' +
  'PSD:PSD,stepPSD:stepPSD,trains:trains,stepCarDoors:stepCarDoors,setCarDoors:setCarDoors,' +
  'K8_WIN:K8_WIN,DOOR_HW:DOOR_HW,DOOR_SLIDE:DOOR_SLIDE,frame:frame,PLATS:PLATS,' +
  'TRACKS:TRACKS,' +
  'atcLimit:atcLimit,stepRide:stepRide,ATC:ATC,NOTCHES:NOTCHES,NIDX_B7:NIDX_B7,' +
  'setRideState:setRideState,getRideState:getRideState,setNotch:setNotch,NIDX_N:NIDX_N,' +
  'NOTCH_LAG:NOTCH_LAG,ATC_DISP_STEP:ATC_DISP_STEP,ATC_UP_LAG:ATC_UP_LAG,' +
  'ridePSDFor:ridePSDFor,mainOff:mainOff,' +
  'DOOR_OPEN_SEC:DOOR_OPEN_SEC,DOOR_STOP_TOL:DOOR_STOP_TOL,stopPosOf:stopPosOf,placeTrain:placeTrain,' +
  'SWITCHES:SWITCHES,stepSwitches:stepSwitches,rideZf:rideZf,gapAhead:gapAhead');

/* ---- 期待値(検証側が独立して持つ) ---------------------------------------- */
const REF = {
  TRAIN_CARS: 10,          // 10両編成
  DWELL_DEFAULT: 25,       // 標準の停車時間[秒]
  DWELL_LONG: 60,          // 待避線に入る駅の停車時間[秒](指示)
  DWELL_LONG_STA: ['八幡山', '明大前', '桜上水', '千歳烏山'],
  VMAX_KMH: 60,            // 上限速度
  STOP_BACK: 3,            // ホーム先端から手前に置く距離[m]
  HACHI_STOP_OFF: 4.55,    // 八幡山の停車線(ホーム横=内側)のオフセット[m]
  HACHI_PASS_OFF: 8.35,    // 八幡山の通過線(ホーム無し=外側)のオフセット[m]
  QUAD_STA: ['明大前', '桜上水', '千歳烏山'],
  QUAD_LOOP_OFF: 13.0,     // 2面4線の待避線(外側)のオフセット[m](2026-10-11 利用者指示:ホームを1.5m 広げて 10.1→11.6、2026-10-13 本線との間を 11m に=13.0)
  QUAD_MAIN_OFF: 2.0,      // 同駅の本線(内側)のオフセット[m]
  // ホームドアを2列(上下)ではなく4列持つ駅=島式2面4線。
  // 停車列車の来ない側(笹塚の留置線側/待避線に入らない側)は開かない扉列。
  PSD4_STA: ['笹塚', '明大前', '桜上水', '千歳烏山'],
  TACTILE_IN: 0.45,        // 点字ブロックの中心をホーム縁から何m内側に置くか
  TACTILE_REACH: 3.0,      // ホーム縁の外側これだけ以内に線路があれば「線路側の縁」
  TOL: 1.0,                // 停止位置の許容誤差[m]
  // 保安装置(指示):600m先=120km/h まで / 20m先=0km/h まで、間はなめらか
  ATC_FAR: 600, ATC_NEAR: 20, ATC_VFAR: 120,
  ATC_BRAKE: 'B7',         // 介入時に使う制動段
  ATC_DISP_STEP: 5,        // ATCの表示は5km/h刻み
  ATC_UP_LAG: 20,          // 現示アップ(制限が緩む)は20秒遅れ。ダウンは即時
  ATC_LINE_TOL: 1.5,       // 前の列車が自列車と同じ線にいるとみなす横のずれ[m]
  NOTCH_LAG: 1.0,          // 力行・制動の応答遅れ[秒]
  DOOR_OPEN_SEC: 25,       // 停車中に扉を開けている時間[秒]
  // 戸閉灯は実物と同じ「扉が閉まっていれば点灯」。開いている間は消灯する
  LAMP_ON_WHEN_CLOSED: true,
  DOOR_STOP_TOL: 1.0,      // 停車と見なす停止位置からのずれ[m]
  // 特急(利用者指示:各停以外の種別を走らせて識別灯を点ける)。停車駅は京王の特急(2022年3月改正後)の区間内
  EXP_STOPS: ['笹塚', '明大前', '千歳烏山'],
  EXP_VMAX_KMH: 90,        // 特急の上限速度
  EXP_DWELL: 25,           // 特急の停車時間(待避しない)
  // 下りの急行(利用者指示:各停を待避線で追い越す)。停車駅は京王の急行(2022年3月改正後)の区間内
  KYU_STOPS: ['笹塚', '明大前', '桜上水', '千歳烏山'],
  PASS_LOOP_STA: ['明大前', '桜上水', '八幡山', '千歳烏山'],   // 各停が待避線・停車線に入り、追い越される駅
  // 運転モードの種別(利用者指示):特急=本線を走り、停車駅(EXP_STOPS)以外では停まってもホームドアを開けない
  // (利用者が挙げた駅は代田橋・下高井戸・桜上水・上北沢・八幡山・仙川。芦花公園も特急の通過駅)/各停=待避線・停車線を走り、全駅で開ける
  RIDE_EXP_NOOPEN: ['代田橋', '下高井戸', '桜上水', '上北沢', '八幡山', '芦花公園', '仙川'],
  // 列車が停まらないホームの縁(利用者指示:仙川の上りは北側の単式ホームを使う)。[駅, ホームの中心 off, 縁(+1=北)]。
  // その縁のホームドアは開かない(各停の開く列に数えない)
  NOSTOP: [['仙川', 0, 1]],
  SIM_T: 7200,             // いっしょに走らせる時間[秒]
  CAR_L: 19.5, CAR_W: 2.8, // 車体の長さ・幅(重なりの判定)
};

const rows = [];
let ng = 0;
function ok(name, cond, expect, got) {
  if (!cond) ng++;
  rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']);
}

const TRAIN_LEN = (REF.TRAIN_CARS - 1) * X.K8.PITCH + X.K8.LEN;   // 編成長[m]=199.5
// その列が「列車が停まらない縁」(REF.NOSTOP)に立つか。縁の位置はホームの登録簿 PLATS から(列は縁から 0.12m 内側)
function nostopRow(p) {
  return REF.NOSTOP.some((q) => q[0] === p.st.n && X.PLATS.some((pl) => Math.abs(pl.off - q[1]) < 0.5 &&
    pl.x0 <= p.st.x + 1 && pl.x1 >= p.st.x - 1 && Math.abs(p.off - (pl.off + q[2] * pl.hw)) < 0.3));
}

/* ---- 1. 停止位置:編成がホームに収まるか ---------------------------------- */
for (const dir of [1, -1]) {
  let worst = null;
  for (const st of X.STA) {
    const r = X.platRange(st);
    const center = X.stopPosOf(st, dir) - dir * X.CAR_HALF;   // 先頭車の中心
    // 先頭(運転台)と最後尾の位置
    const head = center + dir * X.K8.LEN / 2;
    const tail = center - dir * (TRAIN_LEN - X.K8.LEN / 2);
    const lo = Math.min(head, tail), hi = Math.max(head, tail);
    const over = Math.max(r[0] - lo, hi - r[1]);               // ホームからのはみ出し[m]
    if (over > 0.5 && (worst === null || over > worst[1])) worst = [st.n, over];
  }
  ok('編成がホーム内に収まる(' + (dir > 0 ? '下り' : '上り') + ')',
    worst === null, 'はみ出しなし', worst ? worst[0] + ' ' + worst[1].toFixed(1) + 'm' : 'はみ出しなし');
}
// 先頭がホーム先端の3m手前に着くか
{
  let bad = null;
  for (const st of X.STA) {
    const r = X.platRange(st);
    const head = X.stopPosOf(st, 1);
    const gap = r[1] - head;                                   // 先端までの残り[m]
    if (Math.abs(gap - REF.STOP_BACK) > 5 && !bad) bad = [st.n, gap.toFixed(1)];
  }
  ok('先頭がホーム先端の手前', bad === null, REF.STOP_BACK + 'm前後', bad ? bad.join(' ') + 'm' : '全駅OK');
}

/* ---- 2. 実際に走らせる(下り1本を全線) ------------------------------------ */
const t = { dir: 1, x: X.DOM.x0 + 40, x0: X.DOM.x0 + 40, v: 0, st: 'run', dwell: 0, target: null, atSt: null };
const log = [];       // {駅名, 停止位置, 停車時間}
let vmax = 0, prevSt = null, dwellStart = 0, tsec = 0;
const dt = 0.05;
for (let i = 0; i < 200000 && log.length < 40; i++) {
  X.driveTrain(t, dt);
  tsec += dt;
  if (t.v * 3.6 > vmax) vmax = t.v * 3.6;
  if (t.st === 'dwell' && prevSt !== 'dwell') { dwellStart = tsec; }
  if (prevSt === 'dwell' && t.st !== 'dwell') {
    log.push({ n: t.atSt ? t.atSt.n : '?', x: t.x, dwell: tsec - dwellStart });
  }
  prevSt = t.st;
}
ok('自動運転が全駅に停車', log.length >= X.STA.length, X.STA.length + '駅以上', log.length + '回停車');
ok('上限速度を超えない', vmax <= REF.VMAX_KMH + 0.5, '≤' + REF.VMAX_KMH + 'km/h', vmax.toFixed(1) + 'km/h');

/* ---- 2b. 特急(上り1本を全線):停車駅だけに停まり、本線を走る ------------------- */
{
  const e = { dir: -1, kind: '特急', x: X.DOM.x1 - 40, x0: X.DOM.x1 - 40, v: 0, st: 'run', dwell: 0, target: null, atSt: null };
  const elog = [];
  let ev = 0, pv = null, ds = 0, ts = 0;
  for (let i = 0; i < 200000; i++) {
    X.driveTrain(e, dt); ts += dt;
    if (e.v * 3.6 > ev) ev = e.v * 3.6;
    if (e.st === 'dwell' && pv !== 'dwell') ds = ts;
    if (pv === 'dwell' && e.st !== 'dwell') elog.push({ n: e.atSt ? e.atSt.n : '?', x: e.x, dwell: ts - ds });
    if (e.x === e.x0 && i > 10) break;        // 端で入り直した=全線を走り終えた
    pv = e.st;
  }
  // 上りなので、西(s の大きい方)から順に停車駅を通る
  const want = X.STA.filter((s) => REF.EXP_STOPS.indexOf(s.n) >= 0).sort((a, b) => b.x - a.x).map((s) => s.n);
  ok('特急は停車駅だけに停まる', elog.map((q) => q.n).join('/') === want.join('/'), want.join('/'), elog.map((q) => q.n).join('/') || '停車なし');
  const badD = elog.find((q) => Math.abs(q.dwell - REF.EXP_DWELL) > 1.5);
  ok('特急の停車時間', elog.length > 0 && !badD, REF.EXP_DWELL + '秒', badD ? badD.n + ' ' + badD.dwell.toFixed(1) + '秒' : (elog.length ? '全駅' + REF.EXP_DWELL + '秒' : '-'));
  ok('特急の上限速度', ev <= REF.EXP_VMAX_KMH + 0.5 && ev > REF.VMAX_KMH + 5, '各停より速く ≤' + REF.EXP_VMAX_KMH + 'km/h', ev.toFixed(1) + 'km/h');
  const badS = elog.find((q) => { const st = X.STA.find((s) => s.n === q.n); return Math.abs(q.x - (X.stopPosOf(st, -1) + X.CAR_HALF)) > REF.TOL; });
  ok('特急の停止位置の正着', elog.length > 0 && !badS, '±' + REF.TOL + 'm', badS ? badS.n : '全駅OK');
  // 走行中の列車:上りの1本が特急・新宿行で、先頭車の表示が特急
  const ex = X.trains.filter((q) => q.kind === '特急');
  const sg = ex.length === 1 ? ex[0].cars[0].userData.k8.sign : null;
  ok('走行列車に特急が1本(上り・新宿行)', ex.length === 1 && ex[0].dir === -1 && sg && sg.kind === '特急' && sg.dest === '新宿',
    '1本・上り・特急 新宿', ex.length + '本' + (sg ? '・' + sg.kind + ' ' + sg.dest : ''));
  // 描かれる位置:通過する八幡山は外側の通過線、2面4線の駅は本線(内側)。先頭車の位置を frame と比べる(北が+off)
  if (ex.length === 1) {
    const tr = ex[0], save = { x: tr.x, st: tr.st, dwell: tr.dwell, atSt: tr.atSt, v: tr.v, target: tr.target };
    let bad = null;
    const cases = [['八幡山', REF.HACHI_PASS_OFF]].concat(REF.QUAD_STA.map((n) => [n, REF.QUAD_MAIN_OFF]));
    for (const [n, off] of cases) {
      const st = X.STA.find((s) => s.n === n);
      tr.x = st.x; X.placeTrain(tr);
      const c = tr.cars[0].position, q = X.frame(st.x, off), d = Math.hypot(c.x - q.x, c.z - q.z);
      if (d > 0.3 && !bad) bad = n + ' ずれ' + d.toFixed(2) + 'm';
    }
    ok('特急は本線を走る(八幡山は通過線)', !bad, '八幡山±' + REF.HACHI_PASS_OFF + '・2面4線±' + REF.QUAD_MAIN_OFF + '(0.3m以内)', bad || (cases.length + '駅とも'));
    // 2面4線の駅に停まると、開くのは本線側(内側)のホームドアだけ
    const st = X.STA.find((s) => s.n === '明大前');
    tr.x = X.stopPosOf(st, -1) + X.CAR_HALF; tr.st = 'dwell'; tr.dwell = 20; tr.atSt = st; tr.v = 0;
    const others = X.trains.filter((q) => q !== tr).map((q) => ({ q: q, st: q.st, atSt: q.atSt }));
    for (const o of others) { o.q.st = 'run'; o.q.atSt = null; }
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    const op = X.PSD.filter((q) => q.r > 0.95 && !q.hold);   // hold=ホームで待たせる編成の列(笹塚の3番線。いつも開いている)
    const okRow = op.length === 1 && op[0].st === st && Math.abs(op[0].off - REF.QUAD_MAIN_OFF) < 2.5;
    ok('特急の停車で本線側のホームドアが開く', okRow, '明大前の本線側(off≈+' + REF.QUAD_MAIN_OFF + ')の1列',
      op.map((q) => q.st.n + ' off' + q.off.toFixed(2)).join(' ') || '開かない');
    for (let i = 0; i < 150; i++) X.stepCarDoors(tr, 0.05);
    const dOpen = tr.dr, dSide = tr.dside;
    Object.assign(tr, save); for (const o of others) { o.q.st = o.st; o.q.atSt = o.atSt; }
    tr.st = 'run'; tr.atSt = null;
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    for (let i = 0; i < 150; i++) X.stepCarDoors(tr, 0.05);
    Object.assign(tr, save);
    // 開く面:本線の北側(+off 側)にホームがある。seatCar と同じ式 R=F×UP で、車体ローカル+z が北を向くかを独立に求める
    const s = st.x, pA = X.frame(s - 1, 0), pB = X.frame(s + 1, 0), pO = X.frame(s, 0), pN = X.frame(s, 1);
    const fx = -(pB.x - pA.x), fz = -(pB.z - pA.z), rx = -fz, rz = fx;   // 上り(dir<0)は向きを反転
    const lz = (rx * (pN.x - pO.x) + rz * (pN.z - pO.z)) > 0 ? 1 : -1;
    const wantSide = (op.length ? (op[0].off > REF.QUAD_MAIN_OFF ? 1 : -1) : 0) * lz;
    ok('特急の客用扉はホーム側が開く', dOpen > 0.98 && dSide === wantSide, '開度>0.98・面' + wantSide, dOpen.toFixed(3) + '・面' + dSide);
  }
}

/* ---- 3. 停止位置の正着(シミュレーション結果 ⇄ 期待値) --------------------- */
{
  let bad = null;
  for (const e of log.slice(0, X.STA.length)) {
    const st = X.STA.find((s) => s.n === e.n);
    if (!st) { bad = bad || [e.n, '駅不明']; continue; }
    const want = X.stopPosOf(st, 1) - X.CAR_HALF;
    if (Math.abs(e.x - want) > REF.TOL && !bad) bad = [e.n, (e.x - want).toFixed(2) + 'm'];
  }
  ok('停止位置の正着', bad === null, '±' + REF.TOL + 'm', bad ? bad.join(' ') : '全駅OK');
}

/* ---- 4. 停車時間(待避線に入る4駅は60秒・他は25秒) ------------------------- */
{
  let bad = null, seen = 0;
  for (const n of REF.DWELL_LONG_STA) {
    const e = log.find((q) => q.n === n);
    if (!e) { bad = bad || [n, '停車せず']; continue; }
    seen++;
    if (Math.abs(e.dwell - REF.DWELL_LONG) > 1.5 && !bad) bad = [n, e.dwell.toFixed(1) + '秒'];
  }
  ok('待避線に入る駅の停車時間', bad === null && seen === REF.DWELL_LONG_STA.length,
    REF.DWELL_LONG + '秒×' + REF.DWELL_LONG_STA.length + '駅',
    bad ? bad.join(' ') : seen + '駅とも' + REF.DWELL_LONG + '秒');
  const o = log.find((e) => REF.DWELL_LONG_STA.indexOf(e.n) < 0);
  ok('その他の駅の停車時間', o && Math.abs(o.dwell - REF.DWELL_DEFAULT) < 1.5,
    REF.DWELL_DEFAULT + '秒', o ? o.n + ' ' + o.dwell.toFixed(1) + '秒' : '-');
}

/* ---- 4b. 2面4線の駅:自動運転は待避線(外側)へ入るか ----------------------- */
{
  let bad = null;
  for (const n of REF.QUAD_STA) {
    const st = X.STA.find((s) => s.n === n);
    const run = X.runOff(st.x), main = X.mainOff(st.x);
    if (Math.abs(run - REF.QUAD_LOOP_OFF) > 0.15 && !bad) bad = [n + ' 走行線±' + run.toFixed(2)];
    if (Math.abs(main - REF.QUAD_MAIN_OFF) > 0.15 && !bad) bad = [n + ' 本線±' + main.toFixed(2)];
    // 駅を離れれば本線に戻る(振り分けが局所的であること)
    for (const d of [-450, 450]) {
      const f = Math.abs(X.runOff(st.x + d) - X.mainOff(st.x + d));
      if (f > 0.01 && !bad) bad = [n + ' 復帰せず' + f.toFixed(2) + 'm'];
    }
  }
  ok('2面4線で待避線に入る', bad === null,
    '±' + REF.QUAD_LOOP_OFF + 'm', bad ? bad.join(' ') : REF.QUAD_STA.length + '駅とも±' + REF.QUAD_LOOP_OFF + 'm');
}

/* ---- 5. 八幡山:停車列車はホーム横の停車線(内側)を走るか ------------------- */
{
  const hx = X.STA[6].x;
  const run = X.runOff(hx), main = X.mainOff(hx);
  ok('八幡山で内側の停車線を走る', Math.abs(run - REF.HACHI_STOP_OFF) < 0.15,
    '±' + REF.HACHI_STOP_OFF + 'm', '±' + run.toFixed(2) + 'm');
  ok('通過線(外側)は本線のまま', Math.abs(main - REF.HACHI_PASS_OFF) < 0.15,
    '±' + REF.HACHI_PASS_OFF + 'm', '±' + main.toFixed(2) + 'm');
  // 駅から離れれば本線に戻る(乗り移りが局所的であること)
  const far = Math.abs(X.runOff(hx + 400) - X.mainOff(hx + 400));
  ok('駅を離れると本線へ戻る', far < 0.01, '一致', far.toFixed(3) + 'm差');
}

/* ---- 6. ホームドア ------------------------------------------------------- */
{
  const perCar = 4, cars = REF.TRAIN_CARS;
  // 6-1 開口数=1両4箇所×10両
  {
    const bad = X.PSD.filter((p) => p.open.length !== perCar * cars);
    ok('ホームドアの開口数', bad.length === 0, perCar * cars + '箇所/列',
      bad.length ? bad[0].st.n + ' ' + bad[0].open.length + '箇所' : '全て' + perCar * cars + '箇所');
    const openable = X.PSD.filter((p) => p.openable && !nostopRow(p));
    ok('開くホームドアの列数', openable.length === X.STA.length * 2,
      X.STA.length * 2 + '列(全駅×上下。列車が停まらない縁を除く)', openable.length + '列');
    // 列車が停まらない縁の列は、モデルでも開かない柵(noStop)になっている(それ以外の列は noStop でない)
    const wrongNo = X.PSD.filter((p) => !!p.noStop !== nostopRow(p));
    ok('停まらない縁の列は開かない柵', wrongNo.length === 0 && X.PSD.some((p) => p.noStop),
      REF.NOSTOP.map((q) => q[0] + (q[2] > 0 ? '(島式の北)' : '(島式の南)')).join('・') + 'だけ',
      wrongNo.length ? wrongNo.map((p) => p.st.n + ' off' + p.off.toFixed(2) + (p.noStop ? ' 柵' : ' 開く列')).join(' ') : X.PSD.filter((p) => p.noStop).length + '列');
    // 停車列車が来ない線(笹塚の内側=留置線側/2面4線の内側=本線)にもホームドアを置く
    let bad4 = null;
    for (const n of REF.PSD4_STA) {
      const st = X.STA.find((s) => s.n === n);
      const all = X.PSD.filter((p) => p.st === st);
      const fixed = all.filter((p) => !p.openable);
      if ((all.length !== 4 || fixed.length !== 2) && !bad4)
        bad4 = [n, all.length + '列(うち開かない' + fixed.length + '列)'];
    }
    ok('待避線側にもホームドア', bad4 === null,
      REF.PSD4_STA.length + '駅×4列(開2/固定2)', bad4 ? bad4.join(' ') : REF.PSD4_STA.join('/') + ' 各4列');
  }
  // 6-2 開口がホームの範囲に収まる
  {
    let bad = null;
    for (const p of X.PSD) {
      const r = X.platRange(p.st);
      for (const c of p.open) {
        if ((c < r[0] - 1 || c > r[1] + 1) && !bad) bad = [p.st.n, c.toFixed(1)];
      }
    }
    ok('開口がホーム内にある', bad === null, 'はみ出しなし', bad ? bad.join(' @s=') : 'はみ出しなし');
  }
  // 6-3 停車した列車の扉位置と開口が一致するか(シミュレーションで実際に停めて確かめる)
  {
    let bad = null, checked = 0;
    for (const p of X.PSD) {              // 開かない扉列も、開口は停止位置に合わせる
      const st = p.st, dir = p.dir;
      const center = X.stopPosOf(st, dir) - dir * X.CAR_HALF;     // 先頭車の中心
      for (let j = 0; j < cars; j++) {
        const cs = center - dir * j * X.K8.PITCH;                 // placeTrain と同じ式
        for (const dx of X.K8.DOORX) {
          const doorS = cs + dir * dx;
          const hit = p.open.some((c) => Math.abs(c - doorS) < 0.05);
          checked++;
          if (!hit && !bad) bad = [st.n, (dir > 0 ? '下り' : '上り'), doorS.toFixed(2)];
        }
      }
    }
    ok('車両の扉と開口が一致', bad === null, checked + '箇所すべて',
      bad ? bad.join(' ') : checked + '箇所一致');
  }
  // 6-4 停車中は開き、走行中は閉じる
  {
    const p = X.PSD.find((q) => q.dir === 1 && q.openable);
    // 同じ駅・同じ方向で「開かない」扉列(待避線に入らない側)
    const fx = X.PSD.find((q) => q.st === p.st && q.dir === 1 && !q.openable);
    const tr = X.trains[0];
    const save = { st: tr.st, dwell: tr.dwell, atSt: tr.atSt, dir: tr.dir };
    // 停車させる
    tr.dir = 1; tr.st = 'dwell'; tr.dwell = 20; tr.atSt = p.st;
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    const opened = p.r, fixed = fx ? fx.r : 0;
    // 発車直前(残り2秒)にする
    tr.dwell = 2;
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    const closing = p.r;
    // 走行に戻す
    tr.st = 'run'; tr.atSt = null;
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    const closed = p.r;
    Object.assign(tr, save);
    ok('停車中に開く', opened > 0.95, '開度>0.95', opened.toFixed(3));
    ok('列車の来ない列は開かない', fx && fixed < 0.01, '開度<0.01',
      fx ? fixed.toFixed(3) : '固定の扉列が無い');
    ok('発車前に閉じ始める', closing < 0.05, '開度<0.05', closing.toFixed(3));
    ok('走行中は閉じている', closed < 0.01, '開度<0.01', closed.toFixed(3));
  }
}

/* ---- 6b. ホームの付帯物:点字ブロックとホーム端の柵 ------------------------ */
{
  ok('ホームの登録数', X.PLATS.length >= X.STA.length, X.STA.length + '面以上',
    X.PLATS.length + '面');
  let bt = null, bf = null, bl = null;
  /* その縁の"外側"に線路があるか。検証側が TRACKS を独立に走査して決める
     (相対式ホームの外側や単式ホームの背面には線路が無いので敷かない)。 */
  const facesTrack = (s, edge, sg) => X.TRACKS.some((t) => {
    if (s < t.x0 - 1 || s > t.x1 + 1) return false;
    const d = sg * (t.zf(s) - edge);
    return d >= -0.01 && d <= REF.TACTILE_REACH;
  });
  let nTac = 0;
  for (const q of X.PLATS) {
    const mid = (q.x0 + q.x1) / 2;
    // 点字ブロックは「線路のある縁」から45cm内側にだけ敷く
    for (const sg of [-1, 1]) {
      const edge = q.off + sg * q.hw;
      const want = q.off + sg * (q.hw - REF.TACTILE_IN);
      const has = q.tactile.some((o) => Math.abs(o - want) < 1e-6);
      const need = facesTrack(mid, edge, sg);
      if (need) nTac++;
      if (has !== need && !bt)
        bt = ['off=' + q.off.toFixed(2), (sg > 0 ? '外' : '内') + '縁',
        need ? '線路側なのに無い' : '線路が無いのに敷いてある'];
    }
    // ホーム端の柵は短辺2箇所、ホームの内側にあること
    if (q.fence.length !== 2 && !bf) bf = ['off=' + q.off.toFixed(2), q.fence.length + '箇所'];
    for (const e of q.fence) {
      if ((e < q.x0 || e > q.x1) && !bf) bf = ['off=' + q.off.toFixed(2), 's=' + e.toFixed(1)];
    }
    // 点字ブロックがホームの長さに収まっていること
    if (q.x1 - q.x0 < 200 && !bl) bl = [(q.x1 - q.x0).toFixed(0) + 'm'];
  }
  ok('点字ブロックは線路側の縁だけ', bt === null,
    '線路のある縁から' + REF.TACTILE_IN + 'm内側',
    bt ? bt.join(' ') : nTac + '本すべて一致');
  ok('ホーム端に柵がある', bf === null, '各面2箇所', bf ? bf.join(' ') : X.PLATS.length + '面すべて');
  ok('ホーム長', bl === null, '210m級', bl ? bl.join('') : '全面210m');
}

/* ---- 7. 客用扉(車両側) --------------------------------------------------- */
{
  const tr = X.trains[0];
  const p = X.PSD.find((q) => q.dir === tr.dir && q.openable);
  const save = { st: tr.st, dwell: tr.dwell, atSt: tr.atSt, dr: tr.dr };
  // 7-1 停車中にホーム側だけ開く
  tr.st = 'dwell'; tr.dwell = 20; tr.atSt = p.st;
  for (let i = 0; i < 150; i++) X.stepCarDoors(tr, 0.05);
  const opened = tr.dr, side = tr.dside;
  tr.st = 'run'; tr.atSt = null;
  for (let i = 0; i < 150; i++) X.stepCarDoors(tr, 0.05);
  const closed = tr.dr;
  Object.assign(tr, save);
  ok('停車中に客用扉が開く', opened > 0.98, '開度>0.98', opened.toFixed(3));
  ok('走行中は客用扉が閉じる', closed < 0.01, '開度<0.01', closed.toFixed(3));
  ok('開くのはホーム側だけ', side === p.side, 'ホーム側(' + p.side + ')', String(side));
  // 7-2 ホーム側の判定を検証側で"独立に"計算して突き合わせる。
  //     モデルが持つ p.side と比べるだけでは、p.side 自体が間違っていても素通りする
  //     (実際に左右が逆のまま素通りしていた)。seatCar と同じ式 R = F × UP から、
  //     車体ローカル+z がワールドの ±off どちらを向くかを検証側で求める。
  {
    let bad = null;
    for (const q of X.PSD) {
      const s = q.st.x;
      const pA = X.frame(s - 1, 0), pB = X.frame(s + 1, 0);
      const pO = X.frame(s, 0), pN = X.frame(s, 1);
      let fx = pB.x - pA.x, fz = pB.z - pA.z;
      if (q.dir < 0) { fx = -fx; fz = -fz; }
      const rx = -fz, rz = fx;                       // R = F × (0,1,0)
      const lz = (rx * (pN.x - pO.x) + rz * (pN.z - pO.z)) > 0 ? 1 : -1;
      // その列が面している線:駅の中心で列に最も近い線路(各停の線・本線のほか、笹塚の内側の列は留置線=2・3番線に面する)
      const offs = X.TRACKS.filter((t) => s >= t.x0 && s <= t.x1).map((t) => t.zf(s));
      const trackOff = offs.reduce((b, o) => (Math.abs(o - q.off) < Math.abs(b - q.off) ? o : b), Infinity);
      const want = (q.off > trackOff ? 1 : -1) * lz;
      if (want !== q.side && !bad) bad = [q.st.n, q.dir > 0 ? '下り' : '上り',
        'モデル' + (q.side > 0 ? '+z' : '-z') + '/正解' + (want > 0 ? '+z' : '-z')];
    }
    ok('開く面がホーム側と一致', bad === null, X.PSD.length + '列すべて',
      bad ? bad.join(' ') : X.PSD.length + '列すべて一致');
  }
  // 7-3 全ての駅・方向でホーム側の判定が付いているか
  {
    const bad = X.PSD.filter((q) => q.side !== 1 && q.side !== -1);
    ok('全扉列でホーム側が定まる', bad.length === 0, X.PSD.length + '列すべて',
      bad.length ? bad[0].st.n + ' 未定' : X.PSD.length + '列すべて');
  }
  /* 7-3b 仙川(利用者指示):上りの列車は北側の単式ホームを使う。上りの各停を停めると、上りの線より北の列が開き、
     客用扉も北の面が開く。島式の北の縁の列(上りの線より南)は開かない。下りは島式の南の縁(下りの線より北)が開く。
     開く面は 7-2 と同じく seatCar の式から検証側で求める */
  {
    const st = X.STA.find((s) => s.n === '仙川');
    const offs = X.TRACKS.filter((t) => st.x >= t.x0 && st.x <= t.x1).map((t) => t.zf(st.x));
    const lzOf = (dir) => { const pA = X.frame(st.x - 1, 0), pB = X.frame(st.x + 1, 0), pO = X.frame(st.x, 0), pN = X.frame(st.x, 1);
      let fx = pB.x - pA.x, fz = pB.z - pA.z; if (dir < 0) { fx = -fx; fz = -fz; }
      return (-fz * (pN.x - pO.x) + fx * (pN.z - pO.z)) > 0 ? 1 : -1; };
    const others = X.trains.map((q) => ({ q: q, st: q.st, atSt: q.atSt, dwell: q.dwell, x: q.x, v: q.v, target: q.target }));
    const res = {};
    for (const dir of [-1, 1]) {
      const tr = X.trains.find((t) => t.dir === dir && t.kind === '各停');
      for (const o of others) { o.q.st = 'run'; o.q.atSt = null; }
      tr.x = X.stopPosOf(st, dir) - dir * X.CAR_HALF; tr.st = 'dwell'; tr.dwell = 20; tr.atSt = st; tr.v = 0;
      for (let i = 0; i < 120; i++) X.stepPSD(0.05);
      for (let i = 0; i < 150; i++) X.stepCarDoors(tr, 0.05);
      const line = dir < 0 ? Math.max(...offs) : Math.min(...offs);          // 上り=北の線・下り=南の線
      const op = X.PSD.filter((q) => q.st === st && q.r > 0.95 && !q.hold);
      const shut = X.PSD.filter((q) => q.st === st && q.r < 0.01 && Math.abs(q.off - line) < 2.5);
      res[dir] = { op: op, shut: shut, line: line, dr: tr.dr, ds: tr.dside, lz: lzOf(dir) };
      tr.st = 'run'; tr.atSt = null;
      for (let i = 0; i < 120; i++) X.stepPSD(0.05);
      for (let i = 0; i < 150; i++) X.stepCarDoors(tr, 0.05);
    }
    for (const o of others) Object.assign(o.q, { st: o.st, atSt: o.atSt, dwell: o.dwell, x: o.x, v: o.v, target: o.target });
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    const U = res[-1], D = res[1];
    const upOk = U.op.length === 1 && U.op[0].off > U.line + 0.5 && U.shut.some((q) => q.off < U.line - 0.5) &&
      U.dr > 0.98 && U.ds === U.lz;
    ok('仙川:上りは北側のホームで開く', upOk, '上りの線(off' + U.line.toFixed(2) + ')より北の1列・扉は北の面(' + U.lz + ')・島式の北の縁は閉',
      U.op.map((q) => 'off' + q.off.toFixed(2)).join(' ') + '・扉' + U.dr.toFixed(2) + '面' + U.ds + '・閉' + U.shut.map((q) => q.off.toFixed(2)).join('/'));
    const dnOk = D.op.length === 1 && D.op[0].off > D.line + 0.5 && D.dr > 0.98 && D.ds === D.lz;
    ok('仙川:下りは島式ホームで開く', dnOk, '下りの線(off' + D.line.toFixed(2) + ')より北の1列・扉は北の面(' + D.lz + ')',
      D.op.map((q) => 'off' + q.off.toFixed(2)).join(' ') + '・扉' + D.dr.toFixed(2) + '面' + D.ds);
  }
  /* 7-4〜7-6 客用扉(2026-10 v4 へ差し替え)
     扉は車体の塗り分けシェーダが描く2枚引戸で、開度は車両ごとの uniform uOpen
     (シェルの +y 面/−y 面)。戸は外板の内側を戸袋へ滑る。 */
  // 7-4 開くのはホーム側の面だけ(片面の開度だけが動く)
  {
    const c = X.trains[0].cars[0];
    const U = () => { const u = c.userData.bodyMat.userData.k8.uni.uOpen.value; return [u.x, u.y]; };
    X.setCarDoors(c, 0, 1); const closed = U();
    X.setCarDoors(c, 1, 1); const openP = U();
    X.setCarDoors(c, 1, -1); const openM = U();
    X.setCarDoors(c, 0, 1);
    ok('閉じると両面とも0', closed[0] === 0 && closed[1] === 0, '0/0', closed.join('/'));
    ok('ホーム側の面だけ開く', openP[0] + openP[1] === 1 && openM[0] + openM[1] === 1,
      '片面だけ開度1', '+z→' + openP.join('/') + ' −z→' + openM.join('/'));
    ok('面の向きを取り違えない', openP[0] !== openM[0], '+zと−zで別の面', openP[0] !== openM[0] ? '別の面' : '同じ面');
    // 最後尾(シェルを180°回した車)は面の符号が入れ替わる。先頭と同じ"ローカル面"が開くこと
    const t = X.trains[0].cars[9];
    X.setCarDoors(t, 1, 1);
    const ut = t.userData.bodyMat.userData.k8.uni.uOpen.value;
    ok('180°回した車でも同じ側が開く', (ut.x === 1) !== (openP[0] === 1), '左右反転を考慮',
      '先頭' + openP.join('/') + ' 最後尾' + ut.x + '/' + ut.y);
    X.setCarDoors(t, 0, 1);
  }
  // 7-5 全開の戸は戸袋窓の奥に収まり、隣の下降窓に被らない(戸袋の幅が足りているか)
  {
    const win = X.K8_WIN.mid;
    let over = 0, minGap = 9;
    for (const dx of X.K8.DOORX) {
      for (const sg of [-1, 1]) {
        // 全開の戸が占める範囲(外板の内側):開口の端から戸1枚ぶん
        const a = Math.min(dx + sg * X.DOOR_HW, dx + sg * (X.DOOR_HW + X.DOOR_SLIDE));
        const b = Math.max(dx + sg * X.DOOR_HW, dx + sg * (X.DOOR_HW + X.DOOR_SLIDE));
        for (const q of win) {
          if (q[6] !== 0) continue;                          // 下降窓だけ(戸袋窓は戸が見えるのが正しい)
          const ov = Math.min(b, q[1]) - Math.max(a, q[0]);
          if (ov > 0) over++;
          const gap = a > q[1] ? a - q[1] : b < q[0] ? q[0] - b : -ov;
          if (gap < minGap) minGap = gap;
        }
      }
    }
    ok('全開の戸が下降窓に被らない', over === 0, '重なり0', over ? over + '箇所 重なる' : 'すき間' + minGap.toFixed(3) + 'm');
    ok('戸は全開できる(戸1枚ぶん)', Math.abs(X.DOOR_SLIDE - X.K8.DOORW / 2) < 0.01,
      '片開き1枚ぶん(0.65m)', X.DOOR_SLIDE.toFixed(3) + 'm');
  }
}

/* ---- 8. 運転モードの保安装置(前方の列車で自動的に減速する) ---------------- */
{
  const T = X.trains;
  const save = T.map((t) => ({ x: t.x, dir: t.dir, st: t.st, atSt: t.atSt }));
  // 全編成をいったん遠くへ退ける(意図した1本だけを前方に置く)
  for (const t of T) { t.dir = 1; t.x = X.DOM.x1 - 5; t.st = 'run'; t.atSt = null; }
  const lead = T[0];
  const rearOf = (t) => t.x - (t.cars.length - 1) * X.K8.PITCH - X.K8.LEN / 2;
  // 先行列車の最後尾が s から d[m] 先に来るように置く
  const place = (s, d) => { lead.x = s + d + (lead.x - rearOf(lead)); };

  // 待避線への振り分け区間から外れた本線上の地点(明大前と桜上水の間)。
  // 振り分け区間に先行列車が入ると「別の線路」とみなされ、試験にならない。
  const s0 = 2000;
  // 8-1 距離ごとの許容速度(600m=120 / 20m=0 / 間は√で滑らか)
  {
    let bad = null;
    const want = (d) => (d <= REF.ATC_NEAR) ? 0
      : REF.ATC_VFAR * Math.sqrt((d - REF.ATC_NEAR) / (REF.ATC_FAR - REF.ATC_NEAR));
    for (const d of [20, 50, 100, 200, 310, 450, 600]) {
      place(s0, d);
      const got = X.atcLimit(s0);
      if (got === null || Math.abs(got - want(d)) > 0.5) {
        if (!bad) bad = [d + 'm', '期待' + want(d).toFixed(1), '実測' + (got === null ? '制限なし' : got.toFixed(1))];
      }
    }
    ok('許容速度の距離特性', bad === null,
      REF.ATC_FAR + 'm=' + REF.ATC_VFAR + ' / ' + REF.ATC_NEAR + 'm=0',
      bad ? bad.join(' ') : '7点すべて一致');
    // 単調増加(近いほど遅い)であること
    let mono = true, prev = -1;
    for (let d = 20; d <= 600; d += 10) { place(s0, d); const v = X.atcLimit(s0); if (v < prev - 1e-9) mono = false; prev = v; }
    ok('距離が近いほど遅い', mono, '単調', mono ? '単調' : '逆転あり');
  }
  // 8-2 解除条件:600mより先 / 待避線に入った / エリア外
  {
    place(s0, 601);
    ok('600mより先は制限しない', X.atcLimit(s0) === null, '制限なし',
      X.atcLimit(s0) === null ? '制限なし' : X.atcLimit(s0).toFixed(1) + 'km/h');
    // 待避線(2面4線の外側)に入っている列車は対象外
    const q = X.STA.find((z) => z.n === '桜上水');
    // 先行列車を待避線の一定区間へ(先頭を中心+100m=停止位置の近く。最後尾も待避線に入っている。
    // 2026-10-11 に分岐を駅へ30m 寄せたので、先頭が駅の中心だと最後尾は分岐の手前の本線に残る)
    place(q.x - 100, 100); lead.x = q.x + 100;
    ok('待避線の列車は対象外', X.atcLimit(q.x - 300) === null, '制限なし',
      X.atcLimit(q.x - 300) === null ? '制限なし' : '制限あり');
    // エリア外
    lead.x = X.DOM.x1 + 500;
    ok('エリア外の列車は対象外', X.atcLimit(s0) === null, '制限なし',
      X.atcLimit(s0) === null ? '制限なし' : '制限あり');
  }
  // 8-3 実際に走らせる:力行のままでも自動的にB7で減速し、追突しない
  {
    place(s0, REF.ATC_FAR);                          // 600m先=パターンの起点に置く
    const leadRear = rearOf(lead);
    X.setRideState({ s: s0, v: REF.ATC_VFAR, notch: X.NOTCHES.length - 1, acc: 0 });  // P4 全開のまま
    let braked = false, minGap = 1e9, over = 0, vEnd = 0, gapEnd = 0;
    for (let i = 0; i < 20000; i++) {
      X.stepRide(0.05);
      const st = X.getRideState();
      if (st.atc) braked = true;
      const gap = leadRear - st.s;
      if (gap < minGap) minGap = gap;
      if (st.lim !== null && st.v - st.lim > over) over = st.v - st.lim;
      vEnd = st.v; gapEnd = gap;
      if (gap <= REF.ATC_NEAR + 5 || st.v < 0.05) break;
    }
    ok('力行中でも自動でB7が入る', braked, '介入する', braked ? '介入した' : '介入しない');
    ok('先行列車に追突しない', minGap > REF.ATC_NEAR - 5, '最後尾の手前',
      '最接近 ' + minGap.toFixed(1) + 'm');
    ok('接近時は徐行になる', vEnd < 20, '<20km/h',
      gapEnd.toFixed(0) + 'm手前で ' + vEnd.toFixed(1) + 'km/h');
    ok('パターンに追従する', over < 12, '超過<12km/h', '最大超過 ' + over.toFixed(1) + 'km/h');
  }
  /* 8-3b すでにパターンを大きく超えた状態(前方に列車が突然現れた等)。
     120km/h から B7(4.2km/h/s)で止まるには約475m必要なので、300m地点からでは
     物理的に止まりきれない。ここで見るのは「力行に戻らず、B7を掛け続けて
     減速し続ける」こと。指示どおり制動は B7 までとし、非常制動は使わない。 */
  {
    place(s0, 300);                                  // 300m先(パターンは83km/h)に
    const leadRear = rearOf(lead);
    X.setRideState({ s: s0, v: 120, notch: X.NOTCHES.length - 1, acc: 0 });  // P4 全開のまま
    let steps = 0, held = 0, rose = 0, v0 = 120;
    for (let i = 0; i < 6000; i++) {
      X.stepRide(0.05);
      const st = X.getRideState();
      steps++; if (st.atc) held++;
      if (st.v > v0 + 1e-6) rose++;
      v0 = st.v;
      if (st.v < 0.05 || leadRear - st.s <= 0) break;   // 停止 or 追いついた時点で終了
    }
    ok('超過状態でも制動を掛け続ける', held === steps && rose === 0,
      '全区間で介入・増速なし',
      held + '/' + steps + 'ステップ介入・増速' + rose + '回');
  }
  // 8-4 介入に使う段が B7 であること
  {
    const nb = X.NOTCHES[X.NIDX_B7];
    ok('介入に使う制動段', nb && nb.s === REF.ATC_BRAKE, REF.ATC_BRAKE, nb ? nb.s : '不明');
  }
  for (let i = 0; i < T.length; i++) Object.assign(T[i], save[i]);
}

/* ---- 9. 運転モードの表示と戸閉灯 ------------------------------------------ */
{
  ok('マスコンの応答遅れ', Math.abs(X.NOTCH_LAG - REF.NOTCH_LAG) < 1e-9,
    REF.NOTCH_LAG + '秒', X.NOTCH_LAG + '秒');
  ok('ATC表示の刻み', X.ATC_DISP_STEP === REF.ATC_DISP_STEP,
    REF.ATC_DISP_STEP + 'km/h刻み', X.ATC_DISP_STEP + 'km/h刻み');

  const T = X.trains;
  const save = T.map((t) => ({ x: t.x, dir: t.dir, st: t.st, atSt: t.atSt }));
  for (const t of T) { t.dir = 1; t.x = X.DOM.x1 - 5; t.st = 'run'; t.atSt = null; }
  const lead = T[0];
  const rearOf = (t) => t.x - (t.cars.length - 1) * X.K8.PITCH - X.K8.LEN / 2;

  /* 9-1 現示ダウンは即時・現示アップは10秒遅れ。
     遅らせるのは表示だけでなく実際の速度制限も同じ(実機の現示アップと同じ扱い)。
     ※「null なら未取得」で判定すると、null が続く間ずっと上書きしてしまうので、
       取得済みかどうかは別のフラグで持つ。 */
  {
    const s0 = 2000;
    X.setRideState({ on: true, s: s0, v: 0, notch: X.NIDX_N, acc: 0, reset: true });
    for (let i = 0; i < 40; i++) X.stepRide(0.05);           // 2秒:前方に列車なし
    const before = X.getRideState();
    ok('前方が空なら制限なし', before.lim === null, '—',
      before.lim === null ? '—' : before.lim.toFixed(0));

    // (a) 現示ダウン:300m先に列車を出した直後から効く
    lead.x = s0 + 300 + (lead.x - rearOf(lead));
    X.stepRide(0.05);
    const down = X.getRideState();
    ok('現示ダウンは即時', down.lim !== null && Math.abs(down.lim - down.raw) < 1e-9,
      '即座に制限', down.lim === null ? '制限なし' : down.lim.toFixed(1) + 'km/h');
    const held0 = down.lim;

    // (b) 現示アップ:列車を遠ざけても ATC_UP_LAG 秒間は前の(厳しい)制限のまま。
    //     サンプル時刻は遅れ量に比例させる(遅れ秒数を変えても検査が追従する)。
    const held = held0;
    const tEarly = REF.ATC_UP_LAG - 5, tLate = REF.ATC_UP_LAG + 2;
    lead.x = s0 + 560 + (lead.x - rearOf(lead));             // 560m先=緩い現示へ
    let upEarly = null, upLate = null, gE = false, gL = false, t = 0;
    for (let i = 0; i < Math.ceil(tLate / 0.05) + 40; i++) {
      X.stepRide(0.05); t += 0.05;
      if (!gE && t >= tEarly) { upEarly = X.getRideState(); gE = true; }
      if (!gL && t >= tLate) { upLate = X.getRideState(); gL = true; }
    }
    const kmh = (v) => (v === null || v === undefined) ? '—' : v.toFixed(1);
    ok('現示アップは' + REF.ATC_UP_LAG + '秒遅れる',
      upEarly.lim !== null && Math.abs(upEarly.lim - held) < 1e-9 &&
      upLate.lim !== null && upLate.lim > held + 1,
      REF.ATC_UP_LAG + '秒後に上がる',
      tEarly.toFixed(0) + '秒後=' + kmh(upEarly.lim) + ' / ' + tLate.toFixed(0) + '秒後=' + kmh(upLate.lim) + 'km/h');
    ok('現示アップ前も瞬時値は上がっている', upEarly.raw !== null && upEarly.raw > held + 1, '瞬時値は上昇',
      kmh(upEarly.raw) + 'km/h');

    // (c) 解除(制限なしへ)も ATC_UP_LAG 秒待つ
    lead.x = X.DOM.x1 - 5;
    let relEarly = null, relLate = null, hE = false, hL = false; t = 0;
    for (let i = 0; i < Math.ceil(tLate / 0.05) + 40; i++) {
      X.stepRide(0.05); t += 0.05;
      if (!hE && t >= tEarly) { relEarly = X.getRideState(); hE = true; }
      if (!hL && t >= tLate) { relLate = X.getRideState(); hL = true; }
    }
    const km = (v) => (v === null || v === undefined) ? '—' : v.toFixed(1);
    ok('解除も' + REF.ATC_UP_LAG + '秒遅れる', relEarly.lim !== null && relLate.lim === null,
      REF.ATC_UP_LAG + '秒後に解除',
      tEarly.toFixed(0) + '秒後=' + km(relEarly.lim) + ' / ' + tLate.toFixed(0) + '秒後=' + km(relLate.lim));
  }
  for (const t of T) { t.x = X.DOM.x1 - 5; }

  // 9-2 戸閉灯:停止位置の前後1m以内で停止したら25秒点灯し、ホームドアが開く
  {
    const st = X.STA.find((z) => z.n === '代田橋');
    const sp = X.stopPosOf(st, 1);
    X.setRideState({ on: true, kind: '各停', s: sp, v: 0, notch: X.NIDX_N, acc: 0, reset: true });   // 各停は全駅で開ける
    X.stepRide(0.05);
    const a = X.getRideState();
    // 開くのは自列車の線(代田橋は本線=各停の線)に面した扉列であること
    {
      const want = X.ridePSDFor(st), trackOff = -X.mainOff(st.x);
      ok('開くのは自列車側の扉列', a.psd === want && want &&
        Math.abs(want.off - trackOff) < 2.5, '本線側(off≈' + trackOff.toFixed(2) + ')',
        a.psd ? 'off=' + a.psd.off.toFixed(2) : 'なし');
    }
    ok('停車で扉が開く', a.open > 0 && a.openSt === st, REF.DOOR_OPEN_SEC + '秒開く',
      a.open > 0 ? a.open.toFixed(1) + '秒 @' + (a.openSt ? a.openSt.n : '?') : '開かない');
    // 戸閉灯は扉が開いている間は消灯(指示により極性を反転した)
    ok('扉が開いている間は消灯', a.lamp === false, '消灯', a.lamp ? '点灯' : '消灯');
    // 点灯中は力行に入れられない
    X.setNotch(X.NOTCHES.length - 1);
    ok('扉が開いている間は力行できない', X.getRideState().notch <= X.NIDX_N, 'N以下',
      X.NOTCHES[X.getRideState().notch].s);
    // ホームドアが開く(下り側)
    const psd = X.ridePSDFor(st);
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    ok('自列車でホームドアが開く', psd.r > 0.95, '開度>0.95', psd.r.toFixed(3));
    // 25秒で消灯し、ホームドアも閉じる
    for (let i = 0; i < Math.ceil(REF.DOOR_OPEN_SEC / 0.05) + 40; i++) X.stepRide(0.05);
    for (let i = 0; i < 120; i++) X.stepPSD(0.05);
    const b = X.getRideState();
    ok('25秒で扉が閉まる', b.open === 0, '閉まる', b.open.toFixed(1) + '秒');
    ok('扉が閉まれば点灯', b.lamp === true, '点灯', b.lamp ? '点灯' : '消灯');
    ok('扉扱い終了でホームドアも閉じる', psd.r < 0.05, '開度<0.05', psd.r.toFixed(3));
    X.setNotch(X.NIDX_N);
    ok('扉が閉まれば力行できる', (X.setNotch(X.NOTCHES.length - 1),
      X.getRideState().notch === X.NOTCHES.length - 1), 'P4',
      X.NOTCHES[X.getRideState().notch].s);
  }
  /* 9-2b 2面4線の駅:自列車は本線(内側)にいるので、待避線側ではなく
     本線側の扉列が開くこと(以前は待避線の方が開いていた)。 */
  {
    X.setRideState({ kind: '特急' });            // 特急=本線(八幡山は外側の通過線)
    let bad = null;
    for (const n of REF.QUAD_STA.concat(['笹塚'])) {
      const st = X.STA.find((z) => z.n === n);
      const q = X.ridePSDFor(st), trackOff = -X.mainOff(st.x);
      if (!q || Math.abs(q.off - trackOff) > 2.5) { bad = bad || [n, '見つからない']; continue; }
      // 待避線側(より外側)の列を掴んでいないこと
      const outer = X.PSD.filter((z) => z.st === st && z.off < 0)
        .sort((a2, b2) => a2.off - b2.off)[0];
      if (q === outer && Math.abs(outer.off - trackOff) > 2.5 && !bad) bad = [n, '待避線側'];
    }
    ok('2面4線で本線側が開く', bad === null, '本線側の扉列',
      bad ? bad.join(' ') : REF.QUAD_STA.concat(['笹塚']).join('/') + ' すべて本線側');
    // 八幡山は通過線にホームが無いので開かない
    const h = X.STA.find((z) => z.n === '八幡山');
    ok('ホームの無い通過線では開かない', X.ridePSDFor(h) === null, '扉列なし',
      X.ridePSDFor(h) === null ? '扉列なし' : 'off=' + X.ridePSDFor(h).off.toFixed(2));
  }
  // 9-3 停止位置から1mより離れていれば点かない
  {
    const st = X.STA.find((z) => z.n === '上北沢');
    X.setRideState({ on: true, s: X.stopPosOf(st, 1) + REF.DOOR_STOP_TOL + 0.5,
      v: 0, notch: X.NIDX_N, acc: 0, reset: true });
    X.stepRide(0.05);
    ok('停止位置から外れれば開かない', X.getRideState().open === 0, '開かない',
      X.getRideState().open.toFixed(1) + '秒');
    ok('走行中は戸閉灯が点灯', X.getRideState().lamp === true, '点灯',
      X.getRideState().lamp ? '点灯' : '消灯');
    // 停止位置に居ても速度が完全に0でなければ点かない
    X.setRideState({ on: true, s: X.stopPosOf(st, 1), v: 0.3, notch: X.NIDX_N, acc: 0, reset: true });
    X.stepRide(0.05);
    ok('0km/hでなければ開かない', X.getRideState().open === 0, '開かない',
      X.getRideState().v.toFixed(2) + 'km/hで ' + X.getRideState().open.toFixed(1) + '秒');
  }
  /* 9-4 運転モードの種別(利用者指示:運転モードを選ぶときに特急/各停を選ぶ) */
  const stopAt = (kind, n) => {                     // 停止位置に0km/hで停めて1歩進め、扉とホームドアを見る
    const st = X.STA.find((z) => z.n === n);
    for (const q of X.PSD) X.stepPSD(1);              // ほかの駅のホームドアを閉じ切っておく
    X.setRideState({ on: true, kind: kind, s: X.stopPosOf(st, 1), v: 0, notch: X.NIDX_N, acc: 0, reset: true });
    X.stepRide(0.05);
    for (let i = 0; i < 60; i++) X.stepPSD(0.05);
    return { st: st, a: X.getRideState(), open: X.PSD.filter((q) => q.st === st && q.r > 0.5 && !q.hold) };   // hold は笹塚の3番線の待たせる編成
  };
  // (a) 特急:通過駅では停止位置に停まってもホームドアも扉も開かない(戸閉灯は点いたまま・力行できる)。停車駅は本線側が開く
  {
    let bad = null;
    for (const n of REF.RIDE_EXP_NOOPEN) {
      const r = stopAt('特急', n);
      X.setNotch(X.NOTCHES.length - 1);
      const pw = X.getRideState().notch === X.NOTCHES.length - 1; X.setNotch(X.NIDX_N);
      if ((r.a.open !== 0 || r.open.length || !r.a.lamp || !pw) && !bad) bad = n + ' 扉' + r.a.open.toFixed(0) + '秒・ホームドア' + r.open.length + '列' + (pw ? '' : '・力行不可');
    }
    ok('特急:通過駅では開かない', bad === null, REF.RIDE_EXP_NOOPEN.join('・') + ' で扉・ホームドアとも閉', bad || REF.RIDE_EXP_NOOPEN.length + '駅とも閉');
    let bad2 = null;
    for (const n of REF.EXP_STOPS) {
      const r = stopAt('特急', n), main = -X.mainOff(r.st.x);
      if (!(r.a.open > 0 && r.a.psd && Math.abs(r.a.psd.off - main) < 2.5 && r.open.length === 1 && r.open[0] === r.a.psd) && !bad2)
        bad2 = n + ' ' + (r.a.psd ? 'off=' + r.a.psd.off.toFixed(2) : '扉列なし') + '・開いた列' + r.open.length;
    }
    ok('特急:停車駅は本線側が開く', bad2 === null, REF.EXP_STOPS.join('・') + ' で本線側の1列', bad2 || REF.EXP_STOPS.join('・') + ' 本線側');
  }
  // (b) 各停:待避駅では待避線(2面4線の外側)・停車線(八幡山の内側)に面した列が開く。全駅で開く
  {
    let bad = null;
    for (const n of REF.PASS_LOOP_STA) {
      const r = stopAt('各停', n), want = -(n === '八幡山' ? REF.HACHI_STOP_OFF : REF.QUAD_LOOP_OFF);
      // 扉列はホームの縁(線路の中心から約1.7m)にある。ほかの線(本線 ±2・通過線 ±8.35)とは 2.5m 以上離れる
      if (!(r.a.open > 0 && r.a.psd && Math.abs(r.a.psd.off - want) < 2.5 && r.open.length === 1 && r.open[0] === r.a.psd) && !bad)
        bad = n + ' ' + (r.a.psd ? 'off=' + r.a.psd.off.toFixed(2) : '扉列なし') + '(期待' + want + ')・開いた列' + r.open.length;
    }
    ok('各停:待避線・停車線の側が開く', bad === null, '待避線 ' + (-REF.QUAD_LOOP_OFF) + '・八幡山の停車線 ' + (-REF.HACHI_STOP_OFF), bad || REF.PASS_LOOP_STA.join('・') + ' 一致');
    let bad3 = null;
    for (const st of X.STA) { const r = stopAt('各停', st.n); if (!(r.a.open > 0 && r.open.length === 1) && !bad3) bad3 = st.n; }
    ok('各停:全駅で開く', bad3 === null, X.STA.length + '駅', bad3 ? bad3 + ' で開かない' : X.STA.length + '駅とも開く');
  }
  // (c) 自列車の線:各停は待避駅で待避線・停車線、特急は本線(八幡山は外側の通過線)。値は検証側の定数
  {
    let bad = null;
    for (const n of REF.PASS_LOOP_STA) {
      const st = X.STA.find((z) => z.n === n), H = n === '八幡山';
      X.setRideState({ kind: '各停' }); const zl = X.rideZf(st.x);
      X.setRideState({ kind: '特急' }); const ze = X.rideZf(st.x);
      const wl = -(H ? REF.HACHI_STOP_OFF : REF.QUAD_LOOP_OFF), we = -(H ? REF.HACHI_PASS_OFF : REF.QUAD_MAIN_OFF);
      if ((Math.abs(zl - wl) > 0.05 || Math.abs(ze - we) > 0.05) && !bad) bad = n + ' 各停' + zl.toFixed(2) + '・特急' + ze.toFixed(2);
    }
    ok('自列車の線(各停=待避線・停車線/特急=本線)', bad === null, '各停 ' + (-REF.QUAD_LOOP_OFF) + '/' + (-REF.HACHI_STOP_OFF) + '・特急 ' + (-REF.QUAD_MAIN_OFF) + '/' + (-REF.HACHI_PASS_OFF), bad || REF.PASS_LOOP_STA.join('・') + ' 一致');
  }
  // (d) 分岐器:自列車を全線に通し、載っている間は進路どおり(各停=反位・特急=定位)で動かない。自動運転の列車は退ける
  {
    for (const t of T) { t.x = X.DOM.x1 + 3000; t.st = 'wait'; }
    const LEN = 9 * X.K8.PITCH + X.K8.LEN, dn = X.SWITCHES.filter((W) => W.T.A.id.indexOf('下り') >= 0);
    for (const kind of ['各停', '特急']) {
      const want = kind === '各停' ? 1 : 0; let bad = null, n = 0;
      for (const W of dn) { W.r = W.want = 1 - want; W.fill(); }   // 反対の進路にしておく(転換しなければ見つかる)
      const inSw = new Set();
      X.setRideState({ on: true, kind: kind, s: X.DOM.x0 + 100, v: 0, reset: true });
      for (let s = X.DOM.x0 + 100; s < X.DOM.x1 - 100; s += 1.5) {   // 15m/s・0.1秒刻み
        X.setRideState({ s: s }); X.stepSwitches(0.1);
        for (const W of dn) {
          const on = s >= W.lo && s - LEN <= W.hi;
          if (on) { if (!inSw.has(W)) { inSw.add(W); n++; } if (W.r !== want && !bad) bad = kind + ' ' + W.T.B.id + ' s=' + W.T.s.toFixed(0) + ' r=' + W.r.toFixed(2); }
          else inSw.delete(W);
        }
      }
      ok('分岐器は自列車の進路へ(' + kind + ')', bad === null && n >= dn.length, (kind === '各停' ? '反位' : '定位') + 'で通る・下りの' + dn.length + '組すべて', bad || n + '回通過');
    }
  }
  // (e) ATC:各停は待避線の前の列車を見て、駅の本線を通る優等列車は見ない。特急は逆(待避線の各停は見ない)
  {
    for (const t of T) { t.x = X.DOM.x1 - 5; t.st = 'run'; t.atSt = null; }
    const lead = T[0], q = X.STA.find((z) => z.n === '桜上水'), k0 = lead.kind;
    lead.x = q.x + 100;                                // 先行列車(各停)を待避線の一定区間へ(最後尾まで)
    X.setRideState({ kind: '各停' }); const loopL = X.atcLimit(q.x - 300);
    X.setRideState({ kind: '特急' }); const loopE = X.atcLimit(q.x - 300);
    lead.kind = '急行';                                 // 同じ所に本線を通る優等列車
    X.setRideState({ kind: '各停' }); const mainL = X.atcLimit(q.x - 300);
    X.setRideState({ kind: '特急' }); const mainE = X.atcLimit(q.x - 300);
    lead.kind = k0;
    ok('ATC:同じ線の前の列車だけを見る', loopL !== null && loopE === null && mainL === null && mainE !== null,
      '各停:待避線の各停=制限・本線の優等=なし/特急:その逆',
      [loopL, loopE, mainL, mainE].map((v) => (v === null ? 'なし' : v.toFixed(0))).join('/'));
  }
  // (e2) ATC:待避線・停車線へ出入りする前の列車は、自列車の線に残っている最も後ろの所までで制限する。
  //   入る所 …… 先頭は待避線(各停)/待避線の横の本線(急行)でも、最後尾が分岐の手前の共通の線に残る間は最後尾まで
  //   出る所 …… 最後尾が待避線に残っていても、本線へ出た部分(合流の所)まで。先頭だけ・最後尾だけを見ると外れる
  {
    for (const t of T) { t.x = X.DOM.x1 - 5; t.st = 'run'; t.atSt = null; }
    const q = X.STA.find((z) => z.n === '桜上水'), lead = T[0], k0 = lead.kind, LEN = 9 * X.K8.PITCH + X.K8.LEN;
    const want = (d) => (d <= REF.ATC_NEAR) ? 0 : REF.ATC_VFAR * Math.sqrt((d - REF.ATC_NEAR) / (REF.ATC_FAR - REF.ATC_NEAR));
    const dOf = (v) => REF.ATC_NEAR + (REF.ATC_FAR - REF.ATC_NEAR) * Math.pow(v / REF.ATC_VFAR, 2);   // 許容速度 → 距離
    const dv = (x) => Math.abs(X.runOff(x) - X.mainOff(x));      // 待避線と本線の横の隔たり
    const putHead = (hf) => { lead.x = hf - X.CAR_HALF; };        // 先頭の前端を hf に
    const fmt = (v) => (v === null ? 'なし' : v.toFixed(1));
    let div = null, mer = null;                                    // 分かれて3m離れた所/合流して1.5m以内に戻る所
    for (let x = q.x - 400; x < q.x && div === null; x += 0.5) if (dv(x) > 3.0) div = x;
    for (let x = q.x; x < q.x + 400 && mer === null; x += 0.5) if (dv(x) <= REF.ATC_LINE_TOL) mer = x;
    const hIn = div + 20, rIn = hIn - LEN, sIn = rIn - 200;          // 入る所:最後尾の200m 手前に自列車
    const rows = [];
    putHead(hIn);
    lead.kind = '各停'; X.setRideState({ kind: '特急' }); const a1 = X.atcLimit(sIn);
    lead.kind = '急行'; X.setRideState({ kind: '各停' }); const a2 = X.atcLimit(sIn);
    const okIn = dv(rIn) < 0.01 && a1 !== null && a2 !== null && Math.abs(a1 - want(200)) < 0.5 && Math.abs(a2 - want(200)) < 0.5;
    rows.push('入る所(最後尾は本線・' + (rIn - q.x).toFixed(0) + 'm):特急の自列車の前の各停 ' + fmt(a1) + '・各停の自列車の前の急行 ' + fmt(a2) + '(期待 ' + want(200).toFixed(1) + ')');
    const hOut = mer + 60, rOut = hOut - LEN, sOut = q.x - 50;       // 出る所:最後尾は待避線、先頭は合流の先
    putHead(hOut); lead.kind = '各停'; X.setRideState({ kind: '特急' });
    const a3 = X.atcLimit(sOut), p3 = a3 === null ? null : sOut + dOf(a3);
    const okOut = dv(rOut) > 3.0 && p3 !== null && Math.abs(p3 - mer) <= 3;
    rows.push('出る所(最後尾は待避線):制限の点 ' + (p3 === null ? 'なし' : (p3 - q.x).toFixed(1)) + 'm(合流 ' + (mer - q.x).toFixed(1) + 'm・最後尾 ' + (rOut - q.x).toFixed(1) + 'm)');
    lead.kind = k0;
    ok('ATC:待避線へ出入りする前の列車は自列車の線に残る所まで', div !== null && mer !== null && okIn && okOut,
      '入る所=分岐の手前の最後尾まで/出る所=合流の所まで', rows.join('/'));
  }
  // (f) 自動運転の列車:各停の自列車が待避線に入っていれば、後ろの優等列車は塞がれない(後ろの各停は塞がれる)
  {
    const L = T.find((t) => t.kind === '各停' && t.dir === 1), E = T.find((t) => t.kind === '急行');
    for (const t of T) { if (t !== L && t !== E) { t.x = X.DOM.x1 + 3000; t.st = 'wait'; } }
    const st = X.STA.find((z) => z.n === '明大前'), RS = X.stopPosOf(st, 1), LEN = 9 * X.K8.PITCH + X.K8.LEN;
    for (const t of [L, E]) { t.x = RS - LEN - 600; t.st = 'run'; t.v = 0; t.atSt = null; t.target = null; }
    L.x = X.DOM.x1 + 3000; L.st = 'wait';
    X.setRideState({ on: false }); const free = X.gapAhead(E);
    X.setRideState({ on: true, kind: '各停', s: RS }); const withLoop = X.gapAhead(E);
    X.setRideState({ kind: '特急' }); const withMain = X.gapAhead(E);
    L.x = E.x; L.st = 'run'; E.x = X.DOM.x1 + 3000; E.st = 'wait';
    for (const W of X.SWITCHES) if (W.T.A.id.indexOf('下り') >= 0) { W.r = W.want = 1; W.fill(); }   // 各停の進路へ(分岐器の防護を外して自列車だけを見る)
    X.setRideState({ kind: '各停' }); const localBehind = X.gapAhead(L);
    const hf = RS - LEN - (L.x + X.CAR_HALF);
    X.setRideState({ on: false });
    ok('各停の自列車は待避線で追い越される', withLoop === free && Math.abs(withMain - hf) < 1 && Math.abs(localBehind - hf) < 1,
      '急行は塞がれない(各停の自列車が待避線)・本線なら塞がれる・後ろの各停は塞がれる',
      '急行 ' + (withLoop === Infinity ? '∞' : withLoop.toFixed(0)) + '(なし ' + (free === Infinity ? '∞' : free.toFixed(0)) + ')・特急のとき ' + withMain.toFixed(0) + '・各停 ' + localBehind.toFixed(0) + 'm(期待 ' + hf.toFixed(0) + ')');
  }
  X.setRideState({ on: false, kind: '特急', reset: true });
  for (let i = 0; i < T.length; i++) Object.assign(T[i], save[i]);
  for (const t of T) if (t.st === 'wait') t.st = 'run';
  for (const W of X.SWITCHES) { W.r = W.want = 0; W.fill(); }
  for (const p of X.PSD) X.stepPSD(1);
}

/* ---- 10. 全列車をいっしょに走らせる(間隔・待避・追い越し・停車駅・行き詰まりなし) ----------------
   基準は検証側で持つ:各停=全駅、急行=REF.KYU_STOPS、特急=REF.EXP_STOPS。追い越しは各停が待避駅(REF.PASS_LOOP_STA)に
   停まっている間だけ。重なりは描いた車両の位置から独立に測る(線路の向きに沿って車体長・横に車体幅の内側に別の列車の車両)。 */
{
  const T = X.trains;
  const save = T.map((t) => ({ x: t.x, v: t.v, st: t.st, dwell: t.dwell, target: t.target, atSt: t.atSt }));
  const kinds = T.map((t) => t.kind + '/' + t.dir + '/' + t.cars[0].userData.k8.sign.dest).sort().join(' ');
  // 上りは利用者指示で増やした(各停2・急行1を足す)。行先は笹塚の4番線(新線新宿・本八幡方面)に合わせる
  ok('走行列車の種別と行先', kinds === ['各停/1/京王八王子', '各停/1/京王八王子', '急行/1/橋本',
    '特急/-1/新宿', '各停/-1/本八幡', '各停/-1/新線新宿', '急行/-1/本八幡'].sort().join(' '),
    '下り 各停2・急行(橋本)1/上り 特急(新宿)1・各停(本八幡・新線新宿)2・急行(本八幡)1', kinds);
  const HF = (t) => t.x + t.dir * X.CAR_HALF;
  const seq = T.map(() => []), wraps = T.map(() => 0), stopT = T.map(() => 0);
  const prev = T.map((t) => ({ st: t.st, x: t.x }));
  let overlap = null, nChk = 0, passes = [], badPass = null;
  const rel = {};                                         // 列車の組 → 先頭の前後(符号)
  const dirAt = (s) => { const a = X.frame(s - 1, 0), b = X.frame(s + 1, 0); const l = Math.hypot(b.x - a.x, b.z - a.z); return [(b.x - a.x) / l, (b.z - a.z) / l]; };
  const dt = 0.1;
  // 分岐器:各停は待避駅で待避線・停車線(反位=1)、優等列車は本線(定位=0)を通る(検証側の決まり)。
  // 列車が載っている間の r を全部記録し、通過ごとに「転換し終わって、進路どおり」かを見る
  const SWI = X.SWITCHES, occ = new Map(), swBad = [], swN = { rev: 0, nor: 0 };
  const sideOf = (t, W) => W.T.A.id.indexOf(t.dir > 0 ? '下り' : '上り') >= 0;
  const occupies = (t, W) => { const h = HF(t), tl = h - t.dir * (9 * X.K8.PITCH + X.K8.LEN); return Math.max(h, tl) >= W.lo && Math.min(h, tl) <= W.hi; };
  for (let k = 0; k * dt < REF.SIM_T; k++) {
    for (const t of T) X.driveTrain(t, dt);
    X.stepSwitches(dt);
    for (let i = 0; i < T.length; i++) for (let j = 0; j < SWI.length; j++) {
      const t = T[i], W = SWI[j]; if (t.st === 'wait' || !sideOf(t, W)) continue;
      const key = i + '-' + j, o = occupies(t, W), P = occ.get(key);
      if (o) { if (!P) occ.set(key, { r: new Set([W.r]) }); else P.r.add(W.r); }
      else if (P) {
        const want = t.kind === '各停' ? 1 : 0, rs = [...P.r];
        if ((rs.length !== 1 || rs[0] !== want) && swBad.length < 3) swBad.push(t.kind + ' ' + W.T.B.id + ' s=' + W.T.s.toFixed(0) + ' r=' + rs.map((v) => v.toFixed(2)).join(','));
        if (want) swN.rev++; else swN.nor++;
        occ.delete(key);
      }
    }
    for (let i = 0; i < T.length; i++) {
      const t = T[i], q = prev[i];
      if (t.st === 'dwell' && q.st !== 'dwell' && t.atSt) seq[i].push(t.atSt.n);
      if (Math.abs(t.x - q.x) > 100) wraps[i]++;          // 線路の端の先で入り直した
      if (t.st !== 'dwell' && t.st !== 'wait' && t.v === 0 && Math.abs(t.x - t.x0) > 1) stopT[i] += dt;
    }
    // 追い越し:同じ向きの優等列車の先頭が各停の先頭を越えた瞬間に、各停が待避駅に停まっているか
    for (const L of T) for (const E of T) {
      if (L === E || L.dir !== E.dir || L.kind !== '各停' || E.kind === '各停') continue;
      const key = T.indexOf(L) + '-' + T.indexOf(E), sgn = Math.sign((HF(E) - HF(L)) * L.dir);
      const jumped = Math.abs(L.x - prev[T.indexOf(L)].x) > 100 || Math.abs(E.x - prev[T.indexOf(E)].x) > 100;
      if (rel[key] !== undefined && rel[key] < 0 && sgn > 0 && !jumped) {
        const at = L.st === 'dwell' && L.atSt ? L.atSt.n : null;
        passes.push(at || '駅間');
        if ((!at || REF.PASS_LOOP_STA.indexOf(at) < 0) && !badPass) badPass = (at || '駅間') + ' s=' + HF(L).toFixed(0);
      }
      if (sgn !== 0) rel[key] = sgn;
    }
    for (let i = 0; i < T.length; i++) prev[i] = { st: T[i].st, x: T[i].x };
    // 重なり(1秒ごと):描いた車両の中心どうし
    if (k % 10 === 0) {
      for (const t of T) X.placeTrain(t);
      nChk++;
      for (let a = 0; a < T.length; a++) for (let b = a + 1; b < T.length; b++)
        for (const ca of T[a].cars) { if (!ca.visible) continue;
          const d = dirAt(ca.userData.s);
          for (const cb of T[b].cars) { if (!cb.visible) continue;
            const dx = cb.position.x - ca.position.x, dz = cb.position.z - ca.position.z;
            const al = Math.abs(dx * d[0] + dz * d[1]), lat = Math.abs(dx * d[1] - dz * d[0]);
            if (al < REF.CAR_L - 0.5 && lat < REF.CAR_W && !overlap) overlap = [k * dt, T[a].kind + T[a].dir, T[b].kind + T[b].dir, ca.userData.s.toFixed(0), al.toFixed(1), lat.toFixed(2)];
          } }
    }
  }
  ok('全列車:車両が重ならない', overlap === null, REF.SIM_T + '秒・' + T.length + '本', overlap ? overlap.join(' ') : nChk + '回の測定で0');
  ok('分岐器は進路へ転換し終わってから通る', swBad.length === 0 && swN.rev >= 10 && swN.nor >= 10,
    '各停=反位・優等=定位、載っている間は動かない(各10回以上)', swBad.length ? swBad.join(' / ') : '反位' + swN.rev + '回・定位' + swN.nor + '回');
  // 停車駅の並び:隣り合う2回の停車が、種別の停車駅の表で隣り合う(端では折り返して最初の駅へ)
  const order = (dir, names) => X.STA.filter((s) => names === null || names.indexOf(s.n) >= 0).sort((a, b) => (a.x - b.x) * dir).map((s) => s.n);
  let badSeq = null;
  for (let i = 0; i < T.length; i++) {
    const t = T[i], L = order(t.dir, t.kind === '各停' ? null : t.kind === '急行' ? REF.KYU_STOPS : REF.EXP_STOPS);
    for (let j = 1; j < seq[i].length; j++) {
      const a = L.indexOf(seq[i][j - 1]), b = L.indexOf(seq[i][j]);
      if ((a < 0 || b < 0 || (b !== a + 1 && !(a === L.length - 1 && b === 0))) && !badSeq) badSeq = t.kind + ': ' + seq[i][j - 1] + '→' + seq[i][j];
    }
  }
  ok('全列車:停車駅の並び', badSeq === null, '各停=全駅・急行=' + REF.KYU_STOPS.join('/') + '・特急=' + REF.EXP_STOPS.join('/'), badSeq || seq.map((q) => q.length).join('/') + '回');
  ok('追い越しは待避駅で', passes.length >= 2 && badPass === null, '各停が ' + REF.PASS_LOOP_STA.join('・') + ' に停まっている間・2回以上',
    badPass || (passes.length + '回(' + [...new Set(passes)].join('・') + ')'));
  ok('全列車が回り続ける(行き詰まらない)', wraps.every((w) => w >= 3), '2時間で各3回以上入り直す', wraps.join('/') + '回');
  const lim = T.map((t) => t.kind === '各停' ? 900 : 120);
  ok('駅以外で止まる時間', stopT.every((v, i) => v <= lim[i]), '各停≤900秒・優等≤120秒(2時間)', stopT.map((v) => v.toFixed(0)).join('/') + '秒');
  /* 待避:発車間際の各停(待避線・停車線)は、すぐ後ろ(1.8km 以内)の急行が先頭を越えて先へ出るまで発車しない。
     下り:八幡山=急行は通過(停車線の各停を追い越す)・明大前=急行も停まる(緩急接続:急行の発車を待つ)。
     上り(利用者指示で各停・急行を足した):八幡山=通過・千歳烏山=緩急接続 */
  for (const [n, dir] of [['八幡山', 1], ['明大前', 1], ['八幡山', -1], ['千歳烏山', -1]]) {
    const L = T.find((t) => t.kind === '各停' && t.dir === dir), E = T.find((t) => t.kind === '急行' && t.dir === dir);
    if (!L || !E) { ok('待避:' + n + (dir > 0 ? '(下り)' : '(上り)'), false, '各停と急行', '列車が無い'); continue; }
    for (const t of T) { if (t !== L && t !== E) { t.x = X.DOM.x1 + 3000; t.st = 'wait'; } }
    const st = X.STA.find((s) => s.n === n);
    L.x = X.stopPosOf(st, dir) - dir * X.CAR_HALF; L.v = 0; L.st = 'dwell'; L.dwell = 4; L.atSt = st; L.target = null;
    E.x = L.x - dir * 1000; E.v = 25; E.st = 'run'; E.target = null; E.atSt = null; E.dwell = 0;
    let dep = null, tt = 0;
    for (let k = 0; k < 6000 && dep === null; k++) {
      X.driveTrain(E, 0.05); X.driveTrain(L, 0.05); X.stepSwitches(0.05); tt += 0.05;
      if (L.st !== 'dwell') dep = { t: tt, rel: (HF(E) - HF(L)) * dir };
    }
    ok('待避:' + n + (dir > 0 ? '(下り)' : '(上り)') + 'の各停は急行に追い越されてから発車', dep !== null && dep.rel > 0 && dep.t > 4.5,
      '急行の先頭が前に出てから(発車まで' + '4秒より長く待つ)', dep ? '発車 ' + dep.t.toFixed(0) + '秒後・急行は ' + dep.rel.toFixed(0) + 'm 前' : '発車しない');
  }
  /* 分岐器の防護:進路へ転換していない分岐器の手前で止まり、転換し終わってから通る(分岐器は止めておき、後で動かす) */
  {
    const L = T.find((t) => t.kind === '各停' && t.dir === 1);
    for (const t of T) { if (t !== L) { t.x = X.DOM.x1 + 3000; t.st = 'wait'; } }
    const W = X.SWITCHES.find((w) => w.T.A.id.indexOf('下り') >= 0 && w.T.f === 1 && /副本線/.test(w.T.B.id));
    W.r = W.want = 0; W.fill();                                   // 定位(各停の進路=待避線ではない)
    L.x = W.lo - 400; L.v = 16; L.st = 'run'; L.target = null; L.atSt = null; L.dwell = 0;
    for (let k = 0; k < 1600; k++) X.driveTrain(L, 0.05);         // 80秒。分岐器は動かさない
    const stopGap = W.lo - HF(L), stopped = L.v === 0;
    let passed = false;
    for (let k = 0; k < 3000 && !passed; k++) { X.stepSwitches(0.05); X.driveTrain(L, 0.05); if (HF(L) > W.hi + 5) passed = true; }
    ok('転換していない分岐器の手前で止まる', stopped && stopGap > 0 && stopGap < 30 && passed && W.r === 1,
      '分岐器の手前(30m 以内)で停止→反位へ転換して通る', '手前' + stopGap.toFixed(1) + 'm・' + (stopped ? '停止' : (L.v * 3.6).toFixed(0) + 'km/h') + '→' + (passed ? '通過(r=' + W.r + ')' : '通れない'));
  }
  // 運転モードの自列車(下りの本線)の後ろで、自動運転の各停は手前で止まる
  {
    const L = T[0], RS = 2400, LEN = 9 * X.K8.PITCH + X.K8.LEN;
    for (const t of T) { if (t !== L) { t.x = X.DOM.x1 + 3000; t.st = 'wait'; } }
    L.x = 1900; L.v = 0; L.st = 'run'; L.target = null; L.atSt = null; L.dwell = 0;
    X.setRideState({ on: true, s: RS, v: 0 });
    for (let k = 0; k < 2400; k++) X.driveTrain(L, 0.05);
    const head = HF(L), gap = (RS - LEN) - head;
    X.setRideState({ on: false });
    ok('運転モードの自列車の後ろで止まる', gap >= 20 && L.v === 0, '自列車の最後尾の手前20m以上で停止', '手前' + gap.toFixed(1) + 'm・' + (L.v * 3.6).toFixed(0) + 'km/h');
  }
  T.forEach((t, i) => Object.assign(t, save[i]));
  for (const t of T) if (t.st === 'wait') t.st = 'run';
}

/* ---- 出力 ---- */
const w = (s, n) => String(s) + ' '.repeat(Math.max(0, n -
  [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
console.log('=== 自動運転:停止位置・停車時間・走行線の検証 ===');
console.log('(運転ロジックを実時間で走らせ、停車の実績を測定)');
console.log('');
console.log(w('項目', 30) + w('期待', 16) + w('実測', 22) + '判定');
for (const r of rows) console.log(w(r[0], 30) + w(r[1], 16) + w(r[2], 22) + r[3]);
console.log('');
console.log('停車実績: ' + log.slice(0, X.STA.length)
  .map((e) => e.n + '(' + e.dwell.toFixed(0) + 's)').join(' → '));
console.log('RESULT: ' + (ng ? 'FAIL(' + ng + '項目NG)' : 'PASS'));
process.exit(ng ? 1 : 0);
