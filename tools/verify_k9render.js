// 京王9000系の描画(塗り分け)の照合。⑮
//
//   ⑩(8000系)と同じ条件:正射影・白い一様な光(環境光1.0・トーンマッピングなし)で先頭車と2両目を描き、
//   画素の色で「帯・窓・幕板・前面のアイボリーと黒・中央扉の縁・灯火・表示器」の位置を確かめる。
//   このとき画素の値は材質の色(sRGB)そのものになる。
//     側面 2400×300・60px/m(レール面=下端、先頭車の前端 x=+9.75 が px 75、画像の右が −x)
//     前面 480×630・150px/m(中心列=y0、画像の右が v4 の +y=向かって右、z=4.2−(行+0.5)/150)
//   基準は REF(公表の説明と reference/keio9000/measured_9000.md の推定値)。HTML からは読まない。
//   依存:--playwright <node_modules> --three <three.min.js>(環境変数 K8_PW / K8_THREE でも可)
//   使い方: node tools/verify_k9render.js [--html keio_elevated_3d.html] [--out 出力フォルダ]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const HTML = opt('html', 'keio_elevated_3d.html');
const PW = opt('playwright', process.env.K8_PW || '');
const THREEJS = opt('three', process.env.K8_THREE || '');
const OUT = path.resolve(opt('out', path.join(require('os').tmpdir(), 'k9render')));
if (!PW || !THREEJS) { console.log('SKIP: Playwright / three.min.js の場所が渡されていない(--playwright --three か K8_PW K8_THREE)'); process.exit(0); }

const REF = {
  // 側面は利用者提供の写真(9736・9036)の実測(measured_9000.md 3c)
  RED: [1.668, 1.833], BLUE: [1.557, 1.631],   // 腰部の帯(側面)。赤は前面も同じ
  FBLUE: [1.43, 1.631],                         // 前面と側面の前端の青帯(下へ広い)
  WIN: [1.924, 2.845],                          // 側窓(2枚1組の外形)の下端・上端
  GAPS: [-4.70, 0, 4.70], WIN_OFF: 0.4865,      // 扉間の中心と、2枚の窓の中心の離れ((0.035+0.938)/2)
  MAKU_Z: 3.20,                                 // 幕板(窓の上)。8000系の赤帯は無い(公表の説明)
  IVORY_X: 8.40,                                // 先頭車の前頭部(乗務員扉まで)はアイボリー(公表の説明・写真 8.398)
  IVORY_PROBE: 0.21,                            // 塗りを見る点は IVORY_X からこれだけ前(u8.61=乗務員扉の上。後ろの手すり u8.467 を避ける)
  WRAP_X: 9.48,                                 // 前面窓は角の曲面に沿って側面へ回り込み、側面の X 9.48 で終わる(写真2枚)
  CAB_LOGO: [7.82, 8.38, 2.64, 2.79],           // 運転台側の KEIO(写真)
  // 以下は前面写真の実測(ftex9.png)の高さを、屋根 3.62 基準で 1.06 倍に直した値(measured_9000.md 3b)。
  // 横の位置は利用者指示で直した(2026-10-11:扉の幅+10cm・行先表示器+15cm・前照灯の間隔+20cm・識別灯の間隔+40cm。同 3b)
  WIN_IN: 0.40, WIN_BOTTOM: [1.99, 2.07],       // 左右の前面窓の内縁 |y|(扉の枠の外縁と同じ)・下端(2.030)
  DOOR_EDGE: [0.31, 0.40],                      // 扉の戸の縁と枠の外縁(縦の暗い線)。間の枠はアイボリーで、帯もここで切れる
  FDWIN: 0.24,                                  // 中央扉の窓の半幅(ゴムの外縁)
  HL: [0.795, 1.52], TL: [1.01, 1.52],          // 前照灯・尾灯の中心 [|y|, z](前面の青帯の中)
  HL_Y: [0.71, 0.88],                           // 前照灯(点いた白)の |y|
  DEST: [-0.2915, 0.2915, 3.18, 3.34],          // 行先表示器(扉の上)の範囲 [y0,y1,z0,z1]。半幅 0.2915=写真 0.21×1.15+0.05(+15cm−5cm)
  DEST_Z: 3.2596,                               // 行先表示器の中心の高さ(表示板の幅はここで測る)
  KIND: [-0.98, -0.62, 3.12, 3.31],             // 種別表示器(向かって左の窓の上部。写真の実測から外へ0.10=種別と車号の間隔+20cm)
  NUM: [0.68, 1.08, 3.12, 3.31],                // 車号(向かって右の窓の上部。種別と同じ高さへ上げ、外へ0.10=利用者指示。右の識別灯 1.17〜 は含めない)
  PASS: [[-1.23, -1.17], [1.17, 1.23], 3.132, 3.302],   // 識別灯(種別の左・車号の右。白の縦長。写真の灰の縦長の灯から中心線に対称、間隔+40cm)
  LOGO: [0.72, 0.99, 1.70, 1.82],               // KEIO ロゴの板の中(向かって右。白い板に黒の文字。写真 9755)
  LOGO_TXT: [0.74, 1.15, 1.78, 1.86],           // ロゴの文字の並ぶ範囲(斜体のずれを含む)
  LOGO_EDGE: [0.71, 0.05, 1.752, 0.136],        // 板の左の辺:下端の |y|・傾きによる上端までのずれ・下端の z・高さ(平行四辺形)
  WIPER: [0.88, 1.92, 0.49, 2.52],              // ワイパーの付け根 |y|・z と先(付け根は窓の下の外寄りのアイボリーの面。写真 9755)
  BODY_W: 2.768,                                // 車体幅(公表 2,768mm。8000系は 2,770mm)
  // 側面の実測の道具(reference/keio9000/measure_side9.py)を描画に当てたとき戻るべき値(measured_9000.md 3c)
  WIN_SPAN: [0.035, 0.938], END_WIN: [8.49, 9.395],             // 扉間の窓(扉間の中心から)・車端の窓
  DOORS: [-7.05, -2.35, 2.35, 7.05], DWIN: [0.113, 0.540], DWIN_Z0: 1.890, DWIN_Z1: 2.884,   // 客用扉の中心(8000系と同じ)・扉窓(扉中心から)・扉窓の上下
};

fs.mkdirSync(OUT, { recursive: true });
const page_html = path.join(OUT, 'page.html');
{
  let src = fs.readFileSync(HTML, 'utf8');
  src = src.replace(/<script src="https?:\/\/[^"]*three[^"]*"><\/script>/, '<script src="three.min.js"></script>');
  fs.writeFileSync(page_html, src);
  fs.copyFileSync(THREEJS, path.join(OUT, 'three.min.js'));
  // 沿線の建物データ(別ファイル)。HTML の隣にあれば写す(無いと読み込みのエラーが出る)
  for (const nm of ['plateau_bldg.js', 'plateau_land.js', 'plateau_tex.js', 'plateau_dem.js', 'gsi_rail.js']) {   // 沿線の建物・道路(PLATEAU。あれば)
    const pl = path.join(path.dirname(HTML), nm);
    if (fs.existsSync(pl)) fs.copyFileSync(pl, path.join(OUT, nm));
  }
}
function findChromium() {
  if (opt('chromium')) return opt('chromium');
  for (const base of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (d.startsWith('chromium') && fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

(async () => {
  const { chromium } = require(path.resolve(PW, 'playwright-core'));
  const b = await chromium.launch({ executablePath: findChromium(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 2400, height: 630 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + page_html, { timeout: 180000 });
  await p.waitForFunction('window.K8API!==undefined', { timeout: 180000 });
  const res = await p.evaluate(() => {
    CINE.begin();
    const { makeCar, renderer } = K8API, T = THREE;
    const sc = new T.Scene(); sc.background = new T.Color(1, 1, 1);
    sc.add(new T.AmbientLight(0xffffff, 1.0));
    const lead = makeCar({ cabF: true, panto: false, motor: false, hachi: 1, num: '9781', series: '9000',
      lights: 'head', sign: { kind: '各停', dest: '京王八王子' }, crowd: 0 });
    const second = makeCar({ panto: true, motor: true, hachi: 1, num: '9281', series: '9000',
      sign: { kind: '各停', dest: '京王八王子' }, crowd: 1 });
    for (const c of [lead, second]) { c.parent.remove(c); sc.add(c); }
    second.position.x = -20;
    // 識別灯と行先の表記を見る先頭車(特急・新宿行)。同じ位置に置き、描くときだけ入れ替える
    const lead2 = makeCar({ cabF: true, panto: false, motor: false, hachi: 1, num: '9781', series: '9000',
      lights: 'head', sign: { kind: '特急', dest: '新宿' }, crowd: 0 });
    lead2.parent.remove(lead2); sc.add(lead2); lead2.visible = false;
    const save = { tm: renderer.toneMapping, sh: renderer.shadowMap.enabled, pr: renderer.getPixelRatio() };
    renderer.toneMapping = T.NoToneMapping; renderer.shadowMap.enabled = false; renderer.setPixelRatio(1);
    const cv = renderer.domElement;
    const grab = (w, h) => { const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      const x = c2.getContext('2d'); x.drawImage(cv, 0, 0); return { url: c2.toDataURL('image/png'), d: Array.from(x.getImageData(0, 0, w, h).data) }; };
    renderer.setSize(2400, 300, false);
    let cam = new T.OrthographicCamera(-20, 20, 2.5, -2.5, 0.3, 200);
    cam.position.set(-9, 2.5, -30); cam.up.set(0, 1, 0); cam.lookAt(-9, 2.5, 0);
    renderer.render(sc, cam); const side = grab(2400, 300);
    // 写真の縮尺は揃っていないので、45px/m に縮めた写しも作る(側面の実測の道具が縮尺を直して測れるか)
    const sideS = (() => { const c2 = document.createElement('canvas'); c2.width = 1800; c2.height = 225; const x = c2.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, 2400, 300, 0, 0, 1800, 225);
      return { url: c2.toDataURL('image/png') }; })();
    renderer.setSize(480, 630, false);
    cam = new T.OrthographicCamera(-1.6, 1.6, 2.1, -2.1, 0.3, 200);
    cam.position.set(30, 2.1, 0); cam.up.set(0, 1, 0); cam.lookAt(0, 2.1, 0);
    renderer.render(sc, cam); const front = grab(480, 630);
    lead.visible = false; lead2.visible = true;
    renderer.render(sc, cam); const front2 = grab(480, 630);
    renderer.toneMapping = save.tm; renderer.shadowMap.enabled = save.sh; renderer.setPixelRatio(save.pr);
    return { side: side, sideS: sideS, front: front, front2: front2 };
  });
  await b.close();
  for (const k of ['side', 'sideS', 'front', 'front2']) fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(res[k].url.split(',')[1], 'base64'));
  if (errs.length) console.log('ページのエラー:\n  ' + errs.slice(0, 5).join('\n  '));

  const rows = []; let ng = errs.length ? 1 : 0;
  const ok = (name, cond, expect, got) => { if (!cond) ng++; rows.push([name, String(expect), String(got), cond ? 'OK' : 'NG']); };
  const px = (img, w, i, j) => { const k = 4 * (j * w + i); return [img.d[k], img.d[k + 1], img.d[k + 2]]; };
  const S = (x, z) => px(res.side, 2400, Math.round(1200 + (-9 - x) * 60), Math.round(150 + (2.5 - z) * 60));
  const F = (y, z) => px(res.front, 480, Math.round((y + 1.6) * 150), Math.round((4.2 - z) * 150));
  const F2 = (y, z) => px(res.front2, 480, Math.round((y + 1.6) * 150), Math.round((4.2 - z) * 150));
  const isRed = (c) => c[0] > 150 && c[1] < 60 && c[2] > 60 && c[2] < 170;
  const isBlue = (c) => c[2] > 70 && c[0] < 70 && c[1] < 90 && c[2] > c[0] + 40;
  const isSteel = (c) => Math.abs(c[0] - 184) < 25 && Math.abs(c[1] - 186) < 25 && Math.abs(c[2] - 189) < 25 && Math.max(...c) - Math.min(...c) < 18;
  const isIvory = (c) => c[0] > 205 && c[1] > 198 && c[2] > 170 && c[0] - c[2] > 12;
  const isBlack = (c) => c[0] + c[1] + c[2] < 60;
  const fmt = (c) => '(' + c.join(',') + ')';
  const zr = (a) => (a[0] + a[1]) / 2;
  // ---- 側面 ----
  {
    const xs = [-8.0, -4.7, 0, 4.7, 7.6];
    const badR = xs.map((x) => S(x, zr(REF.RED))).find((c) => !isRed(c));
    ok('側面:腰部の赤帯', !badR, '京王レッド(z ' + REF.RED.join('〜') + ')', badR ? fmt(badR) : xs.length + '点');
    const badB = xs.map((x) => S(x, zr(REF.BLUE))).find((c) => !isBlue(c));
    ok('側面:京王ブルーの帯', !badB, '京王ブルー(z ' + REF.BLUE.join('〜') + ')', badB ? fmt(badB) : xs.length + '点');
    const mk = [-2.5, -1.2, 2.0, 3.0].map((x) => S(x, REF.MAKU_Z)), badM = mk.find((c) => !isSteel(c));
    ok('側面:幕板に赤帯が無い', !badM, 'ステンレス(z ' + REF.MAKU_Z + ')', badM ? fmt(badM) : '4点');
    let badW = null;
    for (const g of REF.GAPS) for (const sg of [-1, 1]) {
      const c = S(g + sg * REF.WIN_OFF, zr(REF.WIN)); if (isSteel(c) && !badW) badW = [g + sg * REF.WIN_OFF, fmt(c)];
    }
    ok('側面:扉間の窓が透ける', !badW, '6枚(ステンレスでない)', badW ? badW.join(' ') : '6枚');
    // 2枚1組の窓は大きな窓の中央に柱が通る形(利用者指摘・写真):扉間の中心は車体より明るい柱で、黒いゴムの外枠が柱の上下でも
    // 切れずに通る(以前の2枚の別々の窓では、間は車体の色で枠が無かった)。先頭車と2両目の両方
    { const dk = (x, z0, z1) => { let m = 999; for (let z = z0; z <= z1; z += 1 / 60) { const c = S(x, z); m = Math.min(m, c[0] + c[1] + c[2]); } return m; };
      const isPil = (c) => Math.min(...c) > 196 && Math.max(...c) - Math.min(...c) < 12;
      let bad = null;
      for (const off of [0, -20]) for (const g of REF.GAPS) {
        const x = g + off, mid = S(x, zr(REF.WIN)), lo = dk(x, REF.WIN[0] - 0.01, REF.WIN[0] + 0.03), hi = dk(x, REF.WIN[1] - 0.03, REF.WIN[1] + 0.01);
        if (!(isPil(mid) && lo < 120 && hi < 120) && !bad) bad = 'X' + x + ' 柱' + fmt(mid) + '・枠の下' + lo + '・上' + hi; }
      ok('側面:2枚1組の窓は大きな窓の中央に柱', !bad, '扉間の中心=明るい柱・その上下も外枠(黒)・6か所', bad || '6か所'); }
    // 先頭車と中間車の同じ u・幕板の高さ(窓・手すりの無い所)で比べる
    const iv = S(REF.IVORY_X + REF.IVORY_PROBE, 3.1), mid = S(-20 + REF.IVORY_X + REF.IVORY_PROBE, 3.1);
    ok('側面:前頭部はアイボリー', isIvory(iv) && isSteel(mid), '先頭車=アイボリー/中間車=ステンレス', fmt(iv) + ' / ' + fmt(mid));
    ok('側面:帯はアイボリーの上も通る', isRed(S(REF.IVORY_X + REF.IVORY_PROBE, zr(REF.RED))), '京王レッド', fmt(S(REF.IVORY_X + REF.IVORY_PROBE, zr(REF.RED))));
  }
  // ---- 側面写真:前面窓は角の曲面に沿って側面へ回り込む(利用者指摘)・前頭部の青帯は下へ広い・運転台側の KEIO ----
  {
    const isDark = (c) => c[0] + c[1] + c[2] < 260;
    const wrap = [9.53, 9.60, 9.68].map((x) => S(x, 2.6)), behind = S(REF.WRAP_X - 0.08, 2.6);
    ok('側面:前面窓が側面へ回り込む', wrap.every(isDark) && isIvory(behind),
      'X 9.53〜9.68 は窓(暗い)・' + (REF.WRAP_X - 0.08).toFixed(2) + ' はアイボリー', wrap.map(fmt).join(' ') + ' / ' + fmt(behind));
    const bw = [9.60, 9.50].map((x) => S(x, (REF.FBLUE[0] + REF.BLUE[0]) / 2)), bn = S(8.80, (REF.FBLUE[0] + REF.BLUE[0]) / 2);
    ok('側面:前頭部の青帯は下へ広い', bw.every(isBlue) && isIvory(bn), 'X 9.5〜9.6 は青・8.8 はアイボリー(z ' + ((REF.FBLUE[0] + REF.BLUE[0]) / 2).toFixed(2) + ')',
      bw.map(fmt).join(' ') + ' / ' + fmt(bn));
    let n = 0;
    for (let x = REF.CAB_LOGO[0]; x <= REF.CAB_LOGO[1]; x += 1 / 60) for (let z = REF.CAB_LOGO[2]; z <= REF.CAB_LOGO[3]; z += 1 / 60) {
      const c = S(x, z); if (c[0] + c[1] + c[2] < 360) n++; }
    ok('側面:運転台側の KEIO', n > 15, '暗い文字 >15画素(X ' + REF.CAB_LOGO[0] + '〜' + REF.CAB_LOGO[1] + ')', n + '画素');
  }
  // ---- 側面の実測の道具(reference/keio9000/measure_side9.py)を自分の描画に当てる ----
  // 9000系の編成写真が手に入ったときに使う道具。60px/m の描画と 45px/m に縮めた写しで、帯・窓・扉・アイボリーの後端が
  // measured_9000.md の値(=描いた値)に戻ること、つまり道具が壊れていないことを毎回確かめる(u は運転台の側が+)
  {
    // 許容は元の画像の1.5画素(60px/m で 0.025m・45px/m で 0.033m。縮めた写しは境が1画素ぶんぼける)
    const tool = path.join(__dirname, '..', 'reference', 'keio9000', 'measure_side9.py');
    let T = 0.025;
    const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= T + 1e-9;
    const nearR = (q, r) => Array.isArray(q) && near(q[0], r[0]) && near(q[1], r[1]);
    const f2 = (q) => Array.isArray(q) ? q.map((v) => Array.isArray(v) ? f2(v) : (+v).toFixed(3)).join(Array.isArray(q[0]) ? ' ' : '〜') : String(q);
    const expSide = [[-REF.END_WIN[1], -REF.END_WIN[0]]];          // 運転台と反対の端の窓
    for (const g of REF.GAPS) expSide.push([g - REF.WIN_SPAN[1], g - REF.WIN_SPAN[0]], [g + REF.WIN_SPAN[0], g + REF.WIN_SPAN[1]]);
    const expDw = [];
    for (const d of REF.DOORS) expDw.push([d - REF.DWIN[1], d - REF.DWIN[0]], [d + REF.DWIN[0], d + REF.DWIN[1]]);
    expSide.sort((a, b) => a[0] - b[0]); expDw.sort((a, b) => a[0] - b[0]);
    const list = (got, exp) => Array.isArray(got) && got.length === exp.length && exp.every((e, i) => nearR(got[i], e));
    for (const [file, k, tag] of [['side.png', 1, '60px/m'], ['sideS.png', 0.75, '45px/m']]) {
      T = 1.5 / (60 * k);
      const r = spawnSync('python3', ['-I', tool, path.join(OUT, file), '--ends', String(75 * k), String(1245 * k),
        '--rail', String(300 * k), '--cab', 'left', '--json'], { encoding: 'utf8' });
      let m = null; try { m = JSON.parse(r.stdout); } catch (e) { m = null; }
      if (!m) { ok('側面の実測の道具(' + tag + ')', false, 'JSON を出す', ((r.stderr || '') + (r.stdout || '')).trim().slice(-160)); continue; }
      ok('道具(' + tag + '):帯の高さ', nearR(m.red_z, REF.RED) && nearR(m.blue_z, REF.BLUE), '赤 ' + REF.RED.join('〜') + '・青 ' + REF.BLUE.join('〜'),
        f2(m.red_z) + '・' + f2(m.blue_z));
      ok('道具(' + tag + '):窓の上下', nearR(m.win_z, REF.WIN) && nearR(m.dwin_z, [REF.DWIN_Z0, REF.DWIN_Z1]),
        REF.WIN.join('〜') + '・扉窓 ' + REF.DWIN_Z0 + '〜' + REF.DWIN_Z1, f2(m.win_z) + '・' + f2(m.dwin_z));
      ok('道具(' + tag + '):窓と扉窓の並び', list(m.side_windows_u, expSide) && list(m.door_windows_u, expDw),
        '側窓' + expSide.length + '枚・扉窓' + expDw.length + '枚 ±' + T.toFixed(3), (m.side_windows_u || []).length + '枚・' + (m.door_windows_u || []).length + '枚 ' +
        (list(m.side_windows_u, expSide) ? '' : '側窓 ' + f2(m.side_windows_u)) + (list(m.door_windows_u, expDw) ? '' : ' 扉窓 ' + f2(m.door_windows_u)));
      ok('道具(' + tag + '):扉の中心・アイボリーの後端', Array.isArray(m.doors_u) && m.doors_u.length === REF.DOORS.length &&
        REF.DOORS.every((d, i) => near(m.doors_u[i], d)) && near(m.ivory_u, REF.IVORY_X), REF.DOORS.join('/') + '・' + REF.IVORY_X,
        f2(m.doors_u) + '・' + m.ivory_u);
    }
  }
  // ---- 前面 ----
  {
    // 窓は3つ(左右の前面窓と扉の窓)が暗く、その間(扉の戸・枠)はアイボリー。1枚の黒いガラス域ではない(写真)
    const isDark = (c) => c[0] + c[1] + c[2] < 180;
    const gl = [F(-1.0, 2.6), F(0, 2.6), F(1.0, 2.6)], badG = gl.find((c) => !isDark(c));
    // 間=扉の戸(扉の窓と戸の縁の間)と枠(戸の縁と枠の外縁の間)
    const E = REF.DOOR_EDGE, FL = (REF.FDWIN + E[0]) / 2, FC = (E[0] + E[1]) / 2;
    const between = [F(-FL, 2.6), F(FL, 2.6), F(-FC, 2.6), F(FC, 2.6)], badI = between.find((c) => !isIvory(c));
    ok('前面:窓は3つ(間はアイボリー)', !badG && !badI, '窓=暗い・扉の戸と枠=アイボリー', badG ? '窓 ' + fmt(badG) : (badI ? '間 ' + fmt(badI) : '7点'));
    // 前面窓の下端:y=±1.0 で z=2.6 から下へ暗さが切れる所(左右とも)
    let zb = null;
    for (const y of [-1.0, 1.0]) for (let z = 2.6; z > 1.5; z -= 1 / 150) if (!isDark(F(y, z))) { zb = zb === null ? z : Math.max(zb, z); break; }
    ok('前面:窓の下端', zb !== null && zb >= REF.WIN_BOTTOM[0] && zb <= REF.WIN_BOTTOM[1],
      REF.WIN_BOTTOM.join('〜') + 'm', zb === null ? '無い' : zb.toFixed(3) + 'm');
    const st = [F(-0.45, zr(REF.RED)), F(0.45, zr(REF.RED))], sb = [F(-0.45, zr(REF.FBLUE)), F(0.45, zr(REF.FBLUE))];
    ok('前面:腰部の帯が正面へ回る', st.every(isRed) && sb.every(isBlue), '赤と青(左右)', st.map(fmt).join(' ') + ' / ' + sb.map(fmt).join(' '));
    const iv = [F(-0.45, 1.40), F(0.45, 1.40), F(-0.45, 1.93)];
    ok('前面:アイボリー', iv.every(isIvory), '帯の上下', iv.map(fmt).join(' '));
    // 中央の非常扉の縁:戸の縁と枠の外縁に暗い線(青帯の下、扉の下端との間 z1.30 で見る)。戸の中央と枠の中ほど(FC)は無地
    const line = (y) => { let m = 999; for (let d = -3; d <= 3; d++) { const c = px(res.front, 480, Math.round((y + 1.6) * 150) + d, Math.round((4.2 - 1.30) * 150)); m = Math.min(m, c[0] + c[1] + c[2]); } return m; };
    const lines = [-E[1], -E[0], E[0], E[1]].map(line);
    ok('前面:中央の非常扉の縁', lines.every((v) => v < 200) && line(0) > 500 && line(FC) > 500 && line(-FC) > 500,
      'y=±' + E.join('・±') + ' に線・中央と枠(±' + FC.toFixed(3) + ')は無地', lines.join('/') + ' / ' + line(0) + '/' + line(FC) + '/' + line(-FC));
    // 扉の窓と左右の前面窓の内縁(利用者指示:扉の幅+10cm、その分だけ窓を狭く):z2.6 の行で、中心から外へ
    // 暗い扉の窓が切れる所と、枠の中ほど(FC)から外へ暗い前面窓が始まる所。左右とも
    { const edge = (sg, from, wantDark) => { for (let y = from; Math.abs(y) < 0.8; y += sg / 150) if (isDark(F(y, 2.6)) === wantDark) return Math.abs(y); return null; };
      // 境の画素は混ざった色なので、読みは ±1画素ほど揺れる(左右で半画素ずつ逆に寄る)。許容は ±2画素
      const dw = [-1, 1].map((sg) => edge(sg, 0, false)), wi = [-1, 1].map((sg) => edge(sg, sg * FC, true)), t = 2.01 / 150;
      ok('前面:扉の窓と前面窓の内縁', dw.every((v) => v !== null && Math.abs(v - REF.FDWIN) <= t) && wi.every((v) => v !== null && Math.abs(v - REF.WIN_IN) <= t),
        '扉の窓の半幅 ' + REF.FDWIN + '・窓の内縁 ' + REF.WIN_IN + ' ±2画素', '左 ' + [dw[0], wi[0]].map((v) => v === null ? '-' : v.toFixed(3)).join('・') +
        ' 右 ' + [dw[1], wi[1]].map((v) => v === null ? '-' : v.toFixed(3)).join('・')); }
    // 帯は扉の枠(戸の縁〜枠の外縁)のアイボリーで切れる
    const gap = [F(-FC, zr(REF.RED)), F(FC, zr(REF.FBLUE))];
    ok('前面:帯は扉の枠で切れる', gap.every(isIvory), 'アイボリー', gap.map(fmt).join(' '));
    const hl = [F(-REF.HL[0], REF.HL[1]), F(REF.HL[0], REF.HL[1])];
    ok('前面:前照灯が点く(青帯の中)', hl.every((c) => c[0] + c[1] + c[2] > 600) && zb !== null && zb > REF.HL[1] && REF.HL[1] > REF.FBLUE[0] && REF.HL[1] < REF.FBLUE[1],
      '明るい・窓より下', hl.map(fmt).join(' '));
    // 点いた前照灯の白の範囲(利用者指示:前照灯の間隔+20cm)。z=HL の行で左右とも
    { const sp = (sg) => { let a = 1e9, b = -1e9; for (let y = sg * 0.5; Math.abs(y) <= 1.25; y += sg / 150) if (F(y, REF.HL[1]).every((v) => v > 240)) { a = Math.min(a, Math.abs(y)); b = Math.max(b, Math.abs(y)); } return [a, b]; };
      const s = [sp(-1), sp(1)], t = 2.01 / 150;
      ok('前面:前照灯の位置', s.every((r) => Math.abs(r[0] - REF.HL_Y[0]) <= t && Math.abs(r[1] - REF.HL_Y[1]) <= t), '|y| ' + REF.HL_Y.join('〜') + ' ±2画素(左右とも)',
        s.map((r, i) => (i ? '右 ' : '左 ') + r.map((v) => v.toFixed(3)).join('〜')).join(' ')); }
    const tl = [F(-REF.TL[0], REF.TL[1]), F(REF.TL[0], REF.TL[1])];
    ok('前面:尾灯は消えている(先頭)', tl.every((c) => c[0] < 150 && c[0] > c[1]), '暗い赤', tl.map(fmt).join(' '));
    const count = (r, test) => { let n = 0; for (let y = r[0]; y <= r[1]; y += 1 / 150) for (let z = r[2]; z <= r[3]; z += 1 / 150) if (test(F(y, z))) n++; return n; };
    const nd = count(REF.DEST, (c) => c[0] > 150 && c[0] > c[2] + 60);
    ok('前面:行先表示器は扉の上', nd > 30, '橙の文字>30画素', nd + '画素');
    // 表示板の幅(利用者指示:+15cm):中心の高さの行で、中心から外へアイボリーになる所(左右とも)
    { const ed = (sg) => { for (let y = 0; Math.abs(y) < 0.6; y += sg / 150) if (isIvory(F(y, REF.DEST_Z))) return Math.abs(y); return null; };
      const w = [ed(-1), ed(1)], t = 2.01 / 150;
      ok('前面:行先表示器の幅', w.every((v) => v !== null && Math.abs(v - REF.DEST[1]) <= t), '半幅 ' + REF.DEST[1] + ' ±2画素(左右とも)',
        w.map((v) => v === null ? '-' : v.toFixed(3)).join('・')); }
    // 種別は黒地に明るい文字(各停は白)。黒地が半分以上で、明るい文字が30画素以上
    const nk = count(REF.KIND, (c) => Math.max(...c) > 150), nkD = count(REF.KIND, (c) => c[0] + c[1] + c[2] < 40);
    ok('前面:種別表示器は向かって左の窓の上部', nk > 30 && nkD > nk, '黒地に明るい文字>30画素', nk + '画素(黒地' + nkD + ')');
    // 種別「各  停」(2文字の間を空ける。利用者指示):外接矩形の幅/高さ 2.2〜3.4、中央の2割に文字が無い(字間)。
    // 画像と面の縦横比が違うと縦長になる(以前は約1.1)
    { const bb = (R, th) => { let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (let y = R[0]; y <= R[1]; y += 1 / 150) for (let z = R[2]; z <= R[3]; z += 1 / 150)
          if (th(F(y, z))) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        return [y0, y1, z0, z1]; };
      // 幅・高さは両端の画素を含めて数える(+1画素。文字の高さは十数画素しかないので、端の差だけでは1割ずれる)
      const ext = (a, b) => b - a + 1 / 150;
      const k = bb(REF.KIND, (c) => Math.max(...c) > 150), ar = ext(k[0], k[1]) / Math.max(1e-6, ext(k[2], k[3]));
      const cm = (k[0] + k[1]) / 2, gap = count([cm - 0.1 * (k[1] - k[0]), cm + 0.1 * (k[1] - k[0]), k[2], k[3]], (c) => Math.max(...c) > 150);
      ok('前面:種別の文字の縦横比と字間', ar >= 2.2 && ar <= 3.4 && gap === 0, '幅/高さ 2.2〜3.4・中央の2割は空き', ar.toFixed(2) + '・中央' + gap + '画素(高さ' + (k[3] - k[2]).toFixed(3) + 'm)');
      // 車号「9781」:字形のまま(Arial 太字の4桁で 幅/高さ ≈3)。枠いっぱいに引き伸ばすと約2.6 の縦長になる
      const n = bb(REF.NUM, (c) => c[0] > 200 && c[1] > 200 && c[2] > 200), an = ext(n[0], n[1]) / Math.max(1e-6, ext(n[2], n[3]));
      ok('前面:車号の縦横比', an >= 2.8 && an <= 3.6, '幅/高さ 2.8〜3.6', an.toFixed(2)); }
    const lgW = count(REF.LOGO, (c) => c[0] > 200 && c[1] > 200 && c[2] > 190), lgL = count([-REF.LOGO[1], -REF.LOGO[0], REF.LOGO[2], REF.LOGO[3]], (c) => c[0] > 200 && c[1] > 200 && c[2] > 190);
    ok('前面:KEIO ロゴは向かって右の赤帯', lgW > 20 && lgL < 3, '右に白>20画素・左に無し', lgW + '/' + lgL + '画素');
    // ロゴは白い板に黒の文字(利用者指示:忠実に。写真 9755)。以前の赤帯の上の白抜きの文字には黒い画素が無い
    { const nb = count(REF.LOGO_TXT, (c) => c[0] + c[1] + c[2] < 150), nw = count(REF.LOGO_TXT, (c) => Math.min(...c) > 235);
      ok('前面:KEIO ロゴは白い板に黒の文字', nb > 40 && nw > 40, '黒>40画素・白>40画素', '黒' + nb + '・白' + nw + '画素');
      // 板の左の辺は文字と同じ傾き(平行四辺形):赤帯の中の2つの高さで、外へ白になる所
      const E2 = REF.LOGO_EDGE, edge = (z) => { for (let y = 0.55; y < 0.85; y += 1 / 150) if (Math.min(...F(y, z)) > 235) return y; return null; };
      const za = E2[2] + 0.012, zb2 = 1.822, ea = edge(za), eb = edge(zb2), xa = E2[0] + E2[1] * (za - E2[2]) / E2[3], xb = E2[0] + E2[1] * (zb2 - E2[2]) / E2[3];
      ok('前面:ロゴの板は平行四辺形', ea !== null && eb !== null && Math.abs(ea - xa) <= 2.01 / 150 && Math.abs(eb - xb) <= 2.01 / 150 && eb - ea > 0.008,
        '左の辺 z' + za.toFixed(3) + ' で ' + xa.toFixed(3) + '・z' + zb2 + ' で ' + xb.toFixed(3) + '(±2画素。上ほど外)',
        ea === null || eb === null ? '辺が無い' : ea.toFixed(3) + '・' + eb.toFixed(3)); }
    // ワイパー(利用者指示:写真に合わせて):付け根は窓の下の外寄りのアイボリーの面、腕は内の上へ。付け根と、腕が窓に入る手前が暗い
    { const W = REF.WIPER, dk = (y, z) => { let m = 999; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = F(y + a / 150, z + b / 150); m = Math.min(m, c[0] + c[1] + c[2]); } return m; };
      const t = (1.99 - W[1]) / (W[3] - W[1]), ya = W[0] + (W[2] - W[0]) * t;
      const v = [-1, 1].map((s) => [dk(s * W[0], W[1]), dk(s * ya, 1.99)]);
      ok('前面:ワイパーは外の下から内の上へ', v.every((a) => a[0] < 200 && a[1] < 200), '付け根(|y|' + W[0] + '・z' + W[1] + ')と腕(|y|' + ya.toFixed(3) + '・z1.99)が暗い(左右とも)',
        v.map((a) => a.join('/')).join(' ')); }
    const nn = count(REF.NUM, (c) => c[0] > 200 && c[1] > 200 && c[2] > 200);
    ok('前面:車号は向かって右の窓の上部', nn > 10, '白い文字>10画素', nn + '画素');
    // 車号は種別と同じ高さ(利用者指示):白い数字の外接矩形の中心と、種別の文字の中心の高さの差
    { let z0 = 1e9, z1 = -1e9, k0 = 1e9, k1 = -1e9;
      for (let y = REF.NUM[0]; y <= REF.NUM[1]; y += 1 / 150) for (let z = REF.NUM[2]; z <= REF.NUM[3]; z += 1 / 150)
        if (Math.min(...F(y, z)) > 200) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let y = REF.KIND[0]; y <= REF.KIND[1]; y += 1 / 150) for (let z = REF.KIND[2]; z <= REF.KIND[3]; z += 1 / 150)
        if (Math.max(...F(y, z)) > 150) { k0 = Math.min(k0, z); k1 = Math.max(k1, z); }
      const d = (z0 + z1) / 2 - (k0 + k1) / 2;
      ok('前面:車号は種別と同じ高さ', Math.abs(d) <= 0.02, '文字の中心の差 ≤0.02m', d.toFixed(3) + 'm'); }
    // 向かって左の窓の上部には種別表示器があるので、その下(表示器の外)に白い数字が無いこと
    const nl = count([-REF.NUM[1], -REF.NUM[0], 3.00, REF.KIND[2] - 0.02], (c) => c[0] > 200 && c[1] > 200 && c[2] > 200);
    ok('前面:向かって左には車号が無い', nl < 3, '0画素', nl + '画素');
  }
  // ---- 正面から見た車体の幅(利用者の確認:8000系 2,770mm と 9000系 2,768mm)と、手すりが張り出さないこと ----
  {
    const bg = (c) => Math.min(...c) > 245;
    const span = (z) => { const r = Math.round((4.2 - z) * 150); let a = -1, b = -1;
      for (let i = 0; i < 480; i++) if (!bg(px(res.front, 480, i, r))) { if (a < 0) a = i; b = i; } return a < 0 ? 0 : (b - a + 1) / 150; };
    const w28 = span(2.8);
    ok('正面:車体の幅(窓の高さ)', Math.abs(w28 - REF.BODY_W) <= 2.01 / 150, REF.BODY_W + 'm ±2画素', w28.toFixed(3) + 'm');
    const wide = [1.4, 1.8, 2.2, 2.45].map(span), mx = Math.max(...wide);
    ok('正面:手すりが張り出さない', mx <= REF.BODY_W + 2.01 / 150, '腰〜窓の高さで車体の幅 ≤' + REF.BODY_W + 'm+2画素', wide.map((v) => v.toFixed(3)).join('/') + 'm');
  }
  // ---- 識別灯と行先の表記(各停=front・特急 新宿行=front2) ----
  {
    const white = (c) => Math.min(...c) > 225;
    const at = (G, r) => G((r[0] + r[1]) / 2, (REF.PASS[2] + REF.PASS[3]) / 2);
    const on = REF.PASS.slice(0, 2).map((r) => at(F2, r)), off = REF.PASS.slice(0, 2).map((r) => at(F, r));
    ok('前面:識別灯は各停以外で点く', on.every(white) && off.every((c) => !white(c)), '特急=白・各停=消灯',
      on.map(fmt).join(' ') + ' / ' + off.map(fmt).join(' '));
    // 点いた灯の形:白い画素の外接矩形が縦長(高さ/幅 > 1.8)
    const box = (r) => { let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      // 灯の内側は車号・種別の文字に近いので1.5cm だけ広げ、外側は5cm 広げて探す
      const lo = r[0] > 0 ? r[0] - 0.015 : r[0] - 0.05, hi = r[0] > 0 ? r[1] + 0.05 : r[1] + 0.015;
      for (let y = lo; y <= hi; y += 1 / 150) for (let z = REF.PASS[2] - 0.05; z <= REF.PASS[3] + 0.05; z += 1 / 150)
        if (white(F2(y, z))) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return (z1 - z0) / Math.max(1e-6, y1 - y0); };
    const ar = REF.PASS.slice(0, 2).map(box);
    ok('前面:識別灯は白の縦長', ar.every((a) => a > 1.8 && a < 6), '高さ/幅 1.8〜6', ar.map((a) => a.toFixed(2)).join(' / '));
    // 左右の灯の白い画素の列の範囲が、画像の中心列(y=0)について対称(1画素以内)
    // 車号・種別の文字(|y|≤1.05)の外から、窓の中(|y|≤1.30)を探す
    const cols = (sg) => { let a = 1e9, b = -1e9; for (let y = sg * 1.10; sg > 0 ? y <= 1.30 : y >= -1.30; y += sg / 150)
      for (let z = REF.PASS[2]; z <= REF.PASS[3]; z += 1 / 150) if (white(F2(y, z))) { a = Math.min(a, Math.abs(y)); b = Math.max(b, Math.abs(y)); } return [a, b]; };
    const cl = cols(-1), cr = cols(1), PY = REF.PASS[1], t2 = 2.01 / 150;
    ok('前面:識別灯は中心線に対称', Math.abs(cl[0] - cr[0]) <= 1.01 / 150 && Math.abs(cl[1] - cr[1]) <= 1.01 / 150 &&
       [cl, cr].every((c) => Math.abs(c[0] - PY[0]) <= t2 && Math.abs(c[1] - PY[1]) <= t2),
      '左右の |y| の差 ≤1画素・|y| ' + PY.join('〜') + ' ±2画素', '左 ' + cl.map((v) => v.toFixed(3)).join('〜') + '・右 ' + cr.map((v) => v.toFixed(3)).join('〜'));
    // 「新  宿」(2文字の間を空ける。利用者指示):橙の文字の外接矩形の中央2割に文字が無い
    const isOr = (c) => c[0] > 150 && c[0] > c[2] + 60;
    let y0 = 1e9, y1 = -1e9;
    for (let y = REF.DEST[0]; y <= REF.DEST[1]; y += 1 / 150) for (let z = REF.DEST[2]; z <= REF.DEST[3]; z += 1 / 150)
      if (isOr(F2(y, z))) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cm = (y0 + y1) / 2, w = y1 - y0;
    let g = 0; for (let y = cm - 0.1 * w; y <= cm + 0.1 * w; y += 1 / 150) for (let z = REF.DEST[2]; z <= REF.DEST[3]; z += 1 / 150) if (isOr(F2(y, z))) g++;
    ok('前面:行先「新  宿」の字間', w > 0.15 && g === 0, '中央の2割は空き', '幅' + w.toFixed(3) + 'm・中央' + g + '画素');
  }
  console.log('=== 京王9000系の描画(塗り分け) ⇄ 公表の説明・推定値 ===\n描画: ' + OUT + '/side.png sideS.png front.png front2.png');
  const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
  for (const r of rows) console.log(pad(r[0], 34) + pad(r[1], 34) + pad(r[2], 40) + r[3]);
  console.log(ng ? '\nRESULT: FAIL(' + ng + '項目NG)' : '\nRESULT: PASS');
  process.exit(ng ? 1 : 0);
})();
