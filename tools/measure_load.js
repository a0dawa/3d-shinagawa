// 描画の負荷を測る(⑪)。駅・高架橋を作り込むときの"重さ"の物差し。
//
//   代表的な画(全体俯瞰・駅の俯瞰・運転モードの前面展望・列車追尾)を実際に描いて、
//     ・描画の呼び出し回数(calls)… 実機の重さに最も効く(CPU→GPUの往復)
//     ・三角形の数(tri)
//     ・GPU上のジオメトリ/テクスチャの数、シェーダの数
//     ・1枚を描く時間(ソフトウェアGLなので絶対値は参考。前後比較に使う)
//   と HTML のバイト数を出す。--budget を渡すと予算(JSON)と比べて超過で失敗する。
//
//   依存(リポジトリ外。capture.js と同じ):
//     --playwright <node_modules>  --three <three.min.js>  [--chromium <chrome>]
//     環境変数 K8_PW / K8_THREE でも渡せる
//   使い方: node tools/measure_load.js [--html keikyu_shinagawa_3d.html] [--budget tools/load_budget.json]
//           [--json 出力先]
const fs = require('fs');
const path = require('path');
const os = require('os');

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const HTML = opt('html', 'keikyu_shinagawa_3d.html');
const PW = opt('playwright', process.env.K8_PW || '');
const THREEJS = opt('three', process.env.K8_THREE || '');
const BUDGET = opt('budget', '');
const JSON_OUT = opt('json', '');
const W = 1280, H = 720;

if (!PW || !THREEJS) {
  console.log('SKIP: Playwright / three.min.js の場所が渡されていない(--playwright --three か K8_PW K8_THREE)');
  process.exit(0);
}
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kload-'));
const PAGE = path.join(OUT, 'page.html');
{
  let src = fs.readFileSync(HTML, 'utf8');
  src = src.replace(/<script src="https?:\/\/[^"]*three[^"]*"><\/script>/, '<script src="three.min.js"></script>');
  fs.writeFileSync(PAGE, src);
  fs.copyFileSync(THREEJS, path.join(OUT, 'three.min.js'));
  // 沿線の建物データ(別ファイル)。HTML の隣にあれば一緒に写す(無ければ模式の街で測る)
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
  const p = await b.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // 街並みの乱数を固定(capture.js と同じ種)。測るたびに建物の数が変わらないように
  await p.addInitScript(`(()=>{let a=20260701>>>0;Math.random=()=>{
    a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};})()`);
  const t0 = Date.now();
  await p.goto('file://' + PAGE, { timeout: 180000 });
  await p.waitForFunction('window.CINE!==undefined', { timeout: 180000 });
  await p.waitForFunction('typeof PTX_READY==="undefined"||PTX_READY.all', { timeout: 180000 });   // 写真テクスチャの画像が読めるまで
  const loadMs = Date.now() - t0;
  const res = await p.evaluate(async ([W, H]) => {
    CINE.begin();                         // 実時間のループを止める(1枚ずつ自分で描く)
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const one = () => { CINE.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const ortho = typeof ORTHO_MGR !== 'undefined' && ORTHO_MGR;
    const measure = async (name, place) => {
      place();
      if (ortho) await ortho.settle(30000);   // 航空写真のタイルが揃ってから(読み込み中の書き込みを時間に入れない)
      one(); one();                       // 初回はシェーダのコンパイル等が乗るので捨てる
      const info = renderer.info;
      const calls = info.render.calls, tri = info.render.triangles;
      const N = 4, s = performance.now();
      for (let i = 0; i < N; i++) { place(); one(); }
      return { name: name, calls: calls, tri: tri, ms: (performance.now() - s) / N };
    };
    const out = [];
    // 1) 全体俯瞰(初期視点)
    out.push(await measure('全体俯瞰', () => { Object.assign(cam, OV); applyCam(); }));
    // 2) 駅の俯瞰(駅ボタンと同じ視点)。品川版:2面4線の品川(STA[2])と、相対式の北品川(STA[1])
    for (const i of [2, 1]) {
      const st = STA[i];
      out.push(await measure('駅俯瞰 ' + st.n, () => {
        const q = frame(st.x, 0);
        Object.assign(cam, { tx: q.x, ty: 8, tz: q.z, r: 470, th: Math.PI / 2 - .4, ph: .95 }); applyCam();
      }));
    }
    // 3) 運転モードの前面展望(撮影の前面展望と同じ視点。見通しは既定のまま=遠方面30km)
    //    駅の手前150m(ホームと上屋が正面に並ぶ)と、駅間の中ほど
    const drive = (s) => () => {
      const off = zDown(s), q = frame(s, off), qa = frame(s - 6, off), qb = frame(s + 6, off);
      let tx = qb.x - qa.x, tz = qb.z - qa.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const y = railY(s) + 3.2;
      camera.up.set(0, 1, 0); camera.position.set(q.x, y, q.z); camera.lookAt(q.x + tx * 200, y, q.z + tz * 200);
      cam.tx = q.x; cam.tz = q.z;
    };
    out.push(await measure('運転 品川の手前', drive(STA[2].x - 250)));
    out.push(await measure('運転 北品川の手前', drive(STA[1].x - 250)));
    out.push(await measure('運転 駅間(北品川〜品川・八ツ山)', drive((STA[1].x + STA[2].x) / 2)));
    out.push(await measure('運転 ホーム上(品川)', drive(STA[2].x - 60)));
    // 4) 列車追尾に近い中景(高架を斜め上から150m)
    out.push(await measure('中景 新馬場', () => {
      const st = STA[0], q = frame(st.x + 260, 0);
      camera.up.set(0, 1, 0);
      camera.position.set(q.x + 90, railY(st.x) + 60, q.z + 110);
      camera.lookAt(q.x, railY(st.x), q.z); cam.tx = q.x; cam.tz = q.z;
    }));
    const mem = renderer.info.memory;
    return { views: out, geometries: mem.geometries, textures: mem.textures,
             programs: (renderer.info.programs || []).length, ortho: ortho ? ortho.stat() : null };
  }, [W, H]);
  await b.close();
  const html = fs.statSync(HTML).size;
  const r = Object.assign({ html: html, loadMs: loadMs }, res);
  console.log('HTML ' + (html / 1024).toFixed(1) + ' KB  読み込み ' + (loadMs / 1000).toFixed(1) + ' 秒  '
    + 'ジオメトリ ' + r.geometries + ' / テクスチャ ' + r.textures + ' / シェーダ ' + r.programs);
  const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(1, n - w)); };
  console.log(pad('画', 30) + pad('calls', 9) + pad('三角形', 12) + 'ms/枚(参考)');
  for (const v of r.views) console.log(pad(v.name, 30) + pad(v.calls, 9) + pad(v.tri.toLocaleString(), 12) + v.ms.toFixed(0));
  if (r.ortho) console.log('航空写真: ' + (r.ortho.on ? 'ON' : 'OFF') + '  書いたタイル ' + r.ortho.put + ' 枚・失敗 ' + r.ortho.fails + ' 枚' + (r.ortho.dead ? '(繋がらない=今の色で測った)' : ''));
  if (errs.length) console.log('ページのエラー:\n  ' + errs.slice(0, 5).join('\n  '));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(r, null, 1));
  let ng = errs.length ? 1 : 0;
  if (BUDGET) {
    const B = JSON.parse(fs.readFileSync(BUDGET, 'utf8'));
    console.log('---- 予算(' + BUDGET + ') ----');
    const chk = (label, val, lim) => {
      const ok = val <= lim; if (!ok) ng++;
      console.log(pad(label, 36) + pad(val.toLocaleString(), 12) + '≦ ' + lim.toLocaleString() + '  ' + (ok ? 'OK' : 'NG'));
    };
    chk('HTML[バイト]', html, B.html);
    for (const v of r.views) {
      const lim = B.views && B.views[v.name];
      if (!lim) continue;
      chk(v.name + ' calls', v.calls, lim.calls);
      chk(v.name + ' 三角形', v.tri, lim.tri);
    }
    if (B.geometries) chk('ジオメトリ数', r.geometries, B.geometries);
    if (B.textures) chk('テクスチャ数', r.textures, B.textures);
  }
  console.log(ng ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
