// 京王8000系(v4)の描画の照合。⑩
//
//   v4 の検証用レンダー(reference/keio8000_v4/tools/verify_render.py)と同じ条件で、
//   Three.js の車両を描いて PNG にし、v4 の照合ツールをそのまま当てる:
//     ・側面 side.png  … 2400×300、60px/m、レール面=画像の下端、先頭車の前端 u=+9.75 が px 75
//                        → check_side.py(実測値と45項目、±2cm)
//     ・前面 front.png … 480×630、150px/m、中心列=y0、z=4.2−(行+0.5)/150
//                        → check_front.py(前面写真 ftex.png と14項目、±3cm)
//   照明は「白い一様な光」(環境光1.0・トーンマッピングなし)。このとき画素の値は
//   材質の色(sRGB)そのものになり、v4 の Cycles(白い背景1.0・Standard変換)と同じ判定が効く。
//
//   描画を見られない前提でも、帯・窓・扉・前面の位置を画素で実測値と突き合わせられる。
//   基準値はすべて v4 側(実測表と前面写真)にあり、HTML からは読まない。
//
//   依存(リポジトリ外。capture.js と同じ):
//     --playwright <node_modules>  --three <three.min.js>  [--chromium <chrome>]
//     環境変数 K8_PW / K8_THREE でも渡せる
//   使い方: node tools/verify_k8render.js [--html keikyu_shinagawa_3d.html] [--out 出力フォルダ]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const HTML = opt('html', 'keikyu_shinagawa_3d.html');
const PW = opt('playwright', process.env.K8_PW || '');
const THREEJS = opt('three', process.env.K8_THREE || '');
const OUT = path.resolve(opt('out', path.join(require('os').tmpdir(), 'k8render')));
const REF = path.join(__dirname, '..', 'reference', 'keio8000_v4');

if (!PW || !THREEJS) {
  console.log('SKIP: Playwright / three.min.js の場所が渡されていない(--playwright --three か K8_PW K8_THREE)');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
// 作業用ページ(CDN の three を手元の写しへ)
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
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 2400, height: 630 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + page_html, { timeout: 180000 });
  await p.waitForFunction('window.K8API!==undefined', { timeout: 180000 });
  const shots = await p.evaluate(() => {
    CINE.begin();
    const { makeCar, renderer } = K8API;
    const T = THREE;
    const sc = new T.Scene();
    sc.background = new T.Color(1, 1, 1);
    sc.add(new T.AmbientLight(0xffffff, 1.0));
    // v4 と同じ並び:先頭車(運転台+x)と2両目。先頭は下り特急 京王八王子(v4 の verify_render)
    const lead = makeCar({ cabF: true, panto: false, motor: false, hachi: 1, num: '8764',
      lights: 'head', sign: { kind: '特急', dest: '京王八王子' }, crowd: 0 });
    const second = makeCar({ panto: true, motor: true, hachi: 1, num: '8264',
      sign: { kind: '特急', dest: '京王八王子' }, crowd: 1 });
    for (const c of [lead, second]) { c.parent.remove(c); sc.add(c); }
    second.position.x = -20;
    const save = { tm: renderer.toneMapping, sh: renderer.shadowMap.enabled, pr: renderer.getPixelRatio() };
    renderer.toneMapping = T.NoToneMapping;
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(1);
    const out = {};
    const cv = renderer.domElement;
    /* v4 の照合は Cycles・白い背景(強さ1)で描いた画を測る。このとき塗装面(非金属)にも
       周りの白が鏡面反射で約5%映る(誘電体の F0≒0.04 を粗い面で積分した値)。
       環境光1.0の一様照明はこの映り込みを含まないので、リニアで LIFT を足して同じ条件にする。
       足さないと、緑成分0の赤帯が L<80 の"暗い部分"と判定される(sRGB は0付近が急峻)。 */
    const LIFT = 0.05;
    const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    const LUT = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) LUT[i] = Math.round(l2s(Math.min(1, s2l(i / 255) + LIFT)) * 255);
    const grab = (w, h) => {
      const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      const x = c2.getContext('2d'); x.drawImage(cv, 0, 0);
      const im = x.getImageData(0, 0, w, h), d = im.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = LUT[d[i]]; d[i + 1] = LUT[d[i + 1]]; d[i + 2] = LUT[d[i + 2]]; }
      x.putImageData(im, 0, 0);
      return c2.toDataURL('image/png');
    };
    // 側面:v4 の +y 面(=車体ローカル −z 側)から。画像の右が −x
    renderer.setSize(2400, 300, false);
    let cam = new T.OrthographicCamera(-20, 20, 2.5, -2.5, 0.3, 200);
    cam.position.set(-9, 2.5, -30); cam.up.set(0, 1, 0); cam.lookAt(-9, 2.5, 0);
    renderer.render(sc, cam); out.side = grab(2400, 300);
    // 前面:前方 +x から。画像の右が v4 の +y(=ローカル −z)
    renderer.setSize(480, 630, false);
    cam = new T.OrthographicCamera(-1.6, 1.6, 2.1, -2.1, 0.3, 200);
    cam.position.set(30, 2.1, 0); cam.up.set(0, 1, 0); cam.lookAt(0, 2.1, 0);
    renderer.render(sc, cam); out.front = grab(480, 630);
    // 正面の輪郭の幅(背景の白でない列の端から端)。手すり・取っ手が張り出していないかを見る(LUT の前の画素で)
    { const c2 = document.createElement('canvas'); c2.width = 480; c2.height = 630;
      const x = c2.getContext('2d'); x.drawImage(cv, 0, 0); const d = x.getImageData(0, 0, 480, 630).data;
      out.frontW = [1.4, 1.8, 2.2, 2.45, 2.8].map((z) => { const r = Math.round((4.2 - z) * 150); let a = -1, b = -1;
        for (let i = 0; i < 480; i++) { const k = 4 * (r * 480 + i); if (Math.min(d[k], d[k + 1], d[k + 2]) <= 245) { if (a < 0) a = i; b = i; } }
        return a < 0 ? 0 : (b - a + 1) / 150; }); }
    // 扉を開けた側面(目視用。照合はしない)
    K8API.setCarDoors(lead, 0.6, -1);
    renderer.setSize(2400, 300, false);
    cam = new T.OrthographicCamera(-20, 20, 2.5, -2.5, 0.3, 200);
    cam.position.set(-9, 2.5, -30); cam.up.set(0, 1, 0); cam.lookAt(-9, 2.5, 0);
    renderer.render(sc, cam); out.open = grab(2400, 300);
    renderer.toneMapping = save.tm; renderer.shadowMap.enabled = save.sh; renderer.setPixelRatio(save.pr);
    return out;
  });
  await b.close();
  const frontW = shots.frontW; delete shots.frontW;
  for (const k of Object.keys(shots)) {
    const d = shots[k];
    fs.writeFileSync(path.join(OUT, k + '.png'), Buffer.from(d.slice(d.indexOf(',') + 1), 'base64'));
  }
  if (errs.length) { console.log('ページのエラー:\n  ' + errs.slice(0, 5).join('\n  ')); }
  console.log('描画: ' + OUT + '/side.png front.png open.png');
  let ng = errs.length ? 1 : 0;
  // v4 の照合ツールをそのまま当てる
  const run = (script, args) => spawnSync('python3', [path.join(REF, 'tools', script)].concat(args),
    { encoding: 'utf8' });
  const rs = run('check_side.py', [path.join(OUT, 'side.png')]);
  console.log('---- 側面(check_side.py:実測値と45項目) ----\n' + rs.stdout + rs.stderr);
  if (!/RESULT: PASS/.test(rs.stdout)) ng++;
  /* 前面写真(ftex.png)は撮影者・権利の記録が無いので、リポジトリから(履歴も)外した(2026-10-11 利用者指示)。
     写真があるとき(ref/ftex.png に置くか、環境変数 K8_FTEX で場所を渡す)だけ前面14項目を照合する */
  const FTEX = process.env.K8_FTEX || path.join(REF, 'ref', 'ftex.png');
  if (!fs.existsSync(FTEX)) {
    console.log('---- 前面(check_front.py:前面写真と14項目) ----\nSKIP: 前面写真が無い(' + FTEX + ')。権利の記録が無いので外した。' +
      '使ってよい写真があれば ref/ftex.png に置くか K8_FTEX で渡す');
  } else {
    const rf = run('check_front.py', [path.join(OUT, 'front.png'), FTEX]);
    console.log('---- 前面(check_front.py:前面写真と14項目) ----\n' + rf.stdout + rf.stderr);
    // v4 の受け入れ条件:14項目中12項目以上(外れる2項目は写真の側の理由。CLAUDE.md 参照)
    const m = rf.stdout.match(/RESULT: (?:PASS|(\d+) 項目が)/);
    const bad = m ? (m[1] ? +m[1] : 0) : 99;
    console.log('前面:' + (14 - bad) + '/14項目(受け入れ条件 12以上)');
    if (bad > 2) ng++;
  }
  // 乗務員扉の前後の手すりは埋め込み式(利用者指示):正面から見て、腰〜窓の高さの幅が車体幅(窓の高さ 2.8m の幅=2.770)を
  // 2画素より超えない。v4 の手すりは 4.5cm 外に出て、腰の高さで幅 2.893m に見えていた
  { const BODY_W = 2.770, px = 2.01 / 150, w28 = frontW[4], low = frontW.slice(0, 4), mx = Math.max(...low);
    const okW = Math.abs(w28 - BODY_W) <= px && mx <= BODY_W + px;
    console.log('正面の輪郭:窓の高さ ' + w28.toFixed(3) + 'm(車体幅 ' + BODY_W + '±2画素)・腰〜窓 ' + low.map((v) => v.toFixed(3)).join('/') +
      'm(≤' + BODY_W + '+2画素) → ' + (okW ? 'OK(手すりは張り出さない)' : 'NG'));
    if (!okW) ng++; }
  console.log(ng ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
