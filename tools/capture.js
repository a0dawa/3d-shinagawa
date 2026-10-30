// 動画の撮影。HTMLの撮影モード(13章 CINE)を外から1コマずつ駆動して連番JPEGを書き、
// ffmpeg で H.264 にまとめる。
//
//   構成は「駅のフォーカス(10秒) → 次の駅までの前面展望・俯瞰展望 → 次の駅の
//   フォーカス …」の繰り返し。時刻(朝/昼/夕/夜)と季節(春夏秋冬)は駅ごとに替える。
//
//   【設計の要点】
//   ・**世界の時間はコマ番号だけで決まる**。どのコマも dt=1/fps で進めるので、
//     コマ k の世界は「読み込み直後から k 回 step した状態」でしかありえない。
//     これで撮り直しても並列に撮っても同じ映像になる(ワーカを跨いでも繋がる)。
//   ・街並みは生成時に Math.random を使うので、**種を固定した乱数に差し替える**。
//     差し替えないとワーカごとに別の街が建ち、切り替わりで建物が入れ替わる。
//   ・カメラが線路上を走る速さは「駅間を所定の秒数で渡る」ように決める(早回し)。
//     実時間で走らせると駅間だけで30秒を超え、全線で15分の動画になる。
//   ・画は **ページの中で JPEG に焼いてから** 取り出す。Playwright の screenshot は
//     DOMの合成を通るぶん遅く、字幕もページ内で描いたほうが解像度に追従する。
//
//   【依存】リポジトリには含まれない。パスを渡す:
//     --playwright <playwright-core のあるディレクトリ>
//     --chromium   <chrome の実行ファイル>   (既定: Playwright 同梱を探す)
//     --ffmpeg     <ffmpeg の実行ファイル>   (既定: PATH の ffmpeg)
//     --three      <three.min.js>  CDNへ出られない環境でHTMLの読み込み先を差し替える
//
//   例:
//     node tools/capture.js --out /tmp/vid --w 480 --h 270 --fps 12 --workers 3 \
//       --playwright ~/npm/node_modules --ffmpeg ~/npm/node_modules/ffmpeg-static/ffmpeg \
//       --three /tmp/three.min.js
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/* ---- 引数 ----------------------------------------------------------------- */
const A = process.argv.slice(2);
function opt(name, def) {
  const i = A.indexOf('--' + name);
  if (i < 0) return def;
  const v = A[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
const OPT = {
  html: String(opt('html', 'keio_elevated_3d.html')),
  out: String(opt('out', 'capture')),
  w: +opt('w', 480), h: +opt('h', 270), fps: +opt('fps', 12),
  // 超過標本化。描いてから出力の大きさへ縮めると、細い線(道路の縁・架線・
  // レール・点字ブロック)のちらつきが消える。**解像度は所要時間にほとんど
  // 効かない**(描画の呼び出し回数で決まる)ので、ここを上げるのが一番安い
  ss: +opt('ss', 3),
  quality: +opt('quality', 0.72),
  workers: +opt('workers', 3),
  seed: +opt('seed', 20260701),
  staFrom: +opt('from', 0), staTo: +opt('to', 999),
  dwell: +opt('dwell', 10),     // 駅のフォーカス[秒]
  frontSec: +opt('front', 7),   // 前面展望[秒]
  airSec: +opt('air', 4),       // 俯瞰展望[秒]
  shadow: opt('shadow', '1') !== '0',
  far: +opt('far', 1800),       // 前面展望の見通し[m](0で既定)
  three: opt('three', null),
  playwright: opt('playwright', null),
  chromium: opt('chromium', null),
  ffmpeg: String(opt('ffmpeg', 'ffmpeg')),
  keepFrames: !!opt('keep', false),
  crf: +opt('crf', 26),          // H.264 の画質(小さいほど高画質。高画質版は18前後)
  preset: String(opt('preset', 'medium')),
  dry: !!opt('dry', false),     // 絵コンテだけ出して撮らない
  // 続きから撮る。世界はコマ番号だけで決まるので、出来ているコマ(JPEGの終端まで
  // 書けているもの)を飛ばしても映像は変わらない。コンテナの再起動で止まったとき用
  resume: !!opt('resume', false),
};

/* ---- 1. 作業用ページを作る(CDNの three を手元の写しへ差し替える) ---------- */
const OUT = path.resolve(OPT.out);
const FRM = path.join(OUT, 'frames');
fs.mkdirSync(FRM, { recursive: true });
const PAGE = path.join(OUT, 'page.html');
{
  let src = fs.readFileSync(OPT.html, 'utf8');
  if (OPT.three) {
    const dst = path.join(OUT, 'three.min.js');
    fs.copyFileSync(String(OPT.three), dst);
    const before = src;
    src = src.replace(/<script src="https?:\/\/[^"]*three[^"]*"><\/script>/,
      '<script src="three.min.js"></script>');
    if (src === before) { console.error('three のscriptタグが見つからない'); process.exit(1); }
  }
  // 沿線の建物データ(別ファイル)。HTML の隣にあれば一緒に写す
  for (const nm of ['plateau_bldg.js', 'plateau_land.js', 'plateau_tex.js', 'plateau_dem.js', 'gsi_rail.js']) {   // 沿線の建物・道路(PLATEAU。あれば)
    const pl = path.join(path.dirname(OPT.html), nm);
    if (fs.existsSync(pl)) fs.copyFileSync(pl, path.join(OUT, nm));
  }
  fs.writeFileSync(PAGE, src);
}

/* ---- 2. Playwright / Chromium ------------------------------------------- */
function loadPW() {
  const where = OPT.playwright ? path.resolve(String(OPT.playwright), 'playwright-core') : 'playwright-core';
  try { return require(where); }
  catch (e) { console.error('playwright-core が見つからない: ' + where + '\n  --playwright <node_modules> を渡す'); process.exit(1); }
}
function findChromium(pw) {
  if (OPT.chromium) return String(OPT.chromium);
  for (const base of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (d.startsWith('chromium') && fs.existsSync(p)) return p;
    }
  }
  return pw.chromium.executablePath();
}

/* ---- 3. 絵コンテ ----------------------------------------------------------
   駅ごとに「時刻・季節(・天候)」を割り当て、朝/昼/夕/夜と春夏秋冬を一巡させる。
   天候を書かない所は晴れ。冬は雪を降らせる(2026-10-12 から雪は天候で選ぶ。冬の季節だけでは降らない)。
   駅のフォーカスの時刻がそのまま次の駅までの走行にも続く(切り替えは駅の頭)。 */
const LOOK = [
  ['morning', 'spring'], ['noon', 'spring'], ['noon', 'summer'], ['evening', 'summer'],
  ['night', 'summer'], ['morning', 'autumn'], ['noon', 'autumn'], ['evening', 'autumn'],
  ['noon', 'winter', 'snow'], ['night', 'winter', 'snow'],
];
const FRONT_SHARE = 0.55;    // 駅間のうち前面展望が受け持つ割合(残りは俯瞰)

let EVENTS = [];                 // 列車の置き直し(コマ番号・駅・向き・到着/発車)
function storyboard(stations) {
  const S = stations.slice(OPT.staFrom, Math.min(OPT.staTo + 1, stations.length));
  const shots = [];
  let frame = 0;
  const push = (o) => { o.f0 = frame; frame += o.n; shots.push(o); };
  for (let i = 0; i < S.length; i++) {
    const look = LOOK[(OPT.staFrom + i) % LOOK.length];
    /* 駅のフォーカスには列車の到着か発車を入れる(CINE.stage)。向きと到着/発車は
       駅の番号で決めて、下り到着→上り到着→下り発車→上り発車…と一巡させる */
    const g = OPT.staFrom + i;
    push({ kind: 'station', i: i, sta: S[i], time: look[0], season: look[1], weather: look[2] || 'clear',
           n: Math.round(OPT.dwell * OPT.fps), main: S[i].n,
           stage: { i: g, dir: g % 2 === 0 ? 1 : -1, mode: Math.floor(g / 2) % 2 === 0 ? 'arrive' : 'depart' } });
    if (i + 1 < S.length) {
      const a = S[i].x, b = S[i + 1].x, mid = a + (b - a) * FRONT_SHARE;
      push({ kind: 'front', sta: S[i], time: look[0], season: look[1], weather: look[2] || 'clear',
             s0: a, s1: mid, n: Math.round(OPT.frontSec * OPT.fps),
             main: S[i].n + ' → ' + S[i + 1].n });   // 前面展望は表記しない(利用者指示)
      push({ kind: 'aerial', sta: S[i], time: look[0], season: look[1], weather: look[2] || 'clear',
             s0: mid, s1: b, n: Math.round(OPT.airSec * OPT.fps),
             main: S[i].n + ' → ' + S[i + 1].n });   // 俯瞰展望も表記しない(利用者指示)
    }
  }
  // 列車の置き直しは"コマ番号で決まる出来事"。どのワーカも同じ時刻に同じ順で適用する
  const events = shots.filter((o) => o.stage).map((o) => Object.assign({ frame: o.f0 }, o.stage));
  return { shots, total: frame, events };
}

/* ---- 4. ページ側で動かす本体 ----------------------------------------------
   ・tTo(k) … コマ k の世界へ追いつく(必ず同じ dt で刻む=再現する)
   ・grab() … 1枚描いて字幕を焼き、JPEGのデータURLを返す             */
const PAGE_API = `(() => {
  const W = __W, H = __H, SS = __SS, FPS = __FPS, Q = __Q, EVENTS = __EVENTS, done = {};
  const cv = document.querySelector('canvas');
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const cx = c2.getContext('2d');
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  let worldFrame = 0;
  window.__cine = {
    begin(){ CINE.begin(); CINE.setSize(W*SS, H*SS); CINE.caption('',''); },
    /* コマ k の世界へ追いつく。途中のコマに置き直し(EVENTS)があれば、そのコマを進める
       前に適用する。適用は世界の時間で決まるので、どのワーカがどのカットを撮っても同じ */
    tTo(k){
      const apply = () => { for (const e of EVENTS) if (e.frame === worldFrame && !done[e.frame]) {
        CINE.stage(e.i, e.mode, e.dir); done[e.frame] = true; } };
      while(worldFrame < k){ apply(); CINE.step(1/FPS); worldFrame++; }
      apply(); return worldFrame;
    },
    grab(main, sub){
      CINE.render();
      cx.drawImage(cv, 0, 0, W, H);     // SS倍で描いた画を出力の大きさへ縮める
      const big = Math.round(H*0.080), small = Math.round(H*0.050);
      const x = Math.round(W*0.028), y1 = Math.round(H*0.862), y2 = Math.round(H*0.952);
      cx.textBaseline = 'alphabetic';
      const draw = (t, px, x0, y0) => {
        if(!t) return;
        cx.font = px + 'px IPAGothic, "Noto Sans JP", sans-serif';
        cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillText(t, x0+2, y0+2);
        cx.fillStyle = '#fff'; cx.fillText(t, x0, y0);
      };
      draw(main, 'bold ' + big, x, y1);
      draw(sub, small, x, y2);
      return c2.toDataURL('image/jpeg', Q);
    },
  };
})()`;

async function runWorker(id, pw, exe, shots, log) {
  const browser = await pw.chromium.launch({
    executablePath: exe,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars'],
  });
  const page = await browser.newPage({
    viewport: { width: OPT.w * OPT.ss, height: OPT.h * OPT.ss }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => log('W' + id + ' PAGEERROR ' + e.message));
  // 街並みの乱数を種から固定する(読み込み前に差し替える)
  await page.addInitScript(`(()=>{let a=${OPT.seed}>>>0;Math.random=()=>{
    a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};})()`);
  await page.goto('file://' + PAGE, { timeout: 180000 });   // 街並みの生成に時間がかかる
  await page.waitForFunction('window.CINE!==undefined', { timeout: 180000 });
  await page.waitForFunction('typeof PTX_READY==="undefined"||PTX_READY.all', { timeout: 180000 });   // 写真テクスチャの画像が読めるまで(どのワーカも同じ絵に)
  await page.evaluate(PAGE_API.replace('__W', OPT.w).replace('__H', OPT.h)
    .replace('__SS', OPT.ss).replace('__FPS', OPT.fps).replace('__Q', OPT.quality)
    .replace('__EVENTS', JSON.stringify(EVENTS)));
  await page.evaluate(([shadow]) => { window.__cine.begin(); CINE.setShadow(shadow); }, [OPT.shadow]);

  let done = 0;
  for (const sh of shots) {
    await page.evaluate(([t, s, w]) => { CINE.setTime(t); CINE.setSeason(s); if (CINE.setWeather) CINE.setWeather(w); }, [sh.time, sh.season, sh.weather]);
    const t0 = Date.now();
    for (let k = 0; k < sh.n; k++) {
      if (sh.skip && sh.skip.has(k)) continue;
      const u = sh.n > 1 ? k / (sh.n - 1) : 0;
      const data = await page.evaluate(async ([sh, u, k, far], ) => {
        window.__cine.tTo(k);
        if (sh.kind === 'station') { CINE.setFar(0); CINE.shotStation(sh.sta, u); }
        else {
          const s = sh.s0 + (sh.s1 - sh.s0) * u;
          if (far) CINE.setFar(far, far * 0.08, far * 0.83); else CINE.setFar(0);
          if (sh.kind === 'front') CINE.shotFront(s); else CINE.shotAerial(s, u);
        }
        // 航空写真:このカメラの窓のタイルが揃うまで待つ(読み込みの速さで絵が変わらない=どのワーカでも同じ絵)
        if (typeof ORTHO_MGR !== 'undefined' && ORTHO_MGR) await ORTHO_MGR.settle(60000);
        const sub = sh.sub2 || '';
        return window.__cine.grab(sh.main, sub);
      }, [sh, u, sh.f0 + k, sh.kind === 'front' ? OPT.far : 0]);
      const b64 = data.slice(data.indexOf(',') + 1);
      fs.writeFileSync(path.join(FRM, 'f' + String(sh.f0 + k).padStart(6, '0') + '.jpg'),
        Buffer.from(b64, 'base64'));
    }
    const nNew = sh.n - (sh.skip ? sh.skip.size : 0);
    done += nNew;
    log('W' + id + ' ' + sh.kind + ' ' + sh.main + ' ' + nNew + '枚 '
      + ((Date.now() - t0) / Math.max(1, nNew)).toFixed(0) + ' ms/枚');
  }
  await browser.close();
  return done;
}

/* ---- 5. 進行 -------------------------------------------------------------- */
(async () => {
  const pw = loadPW();
  const exe = findChromium(pw);
  console.log('HTML   : ' + path.resolve(OPT.html));
  console.log('Chrome : ' + exe);
  console.log('出力   : ' + OUT + '  ' + OPT.w + 'x' + OPT.h + ' ' + OPT.fps + 'fps'
    + '  (描画 ' + (OPT.w * OPT.ss) + 'x' + (OPT.h * OPT.ss) + ' = ' + OPT.ss + '倍で超過標本化)');

  // 駅の一覧を1回だけ読む
  const b0 = await pw.chromium.launch({ executablePath: exe,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'] });
  const p0 = await b0.newPage({ viewport: { width: 64, height: 64 } });
  await p0.goto('file://' + PAGE, { timeout: 180000 });
  await p0.waitForFunction('window.CINE!==undefined', { timeout: 180000 });
  await p0.waitForFunction('typeof PTX_READY==="undefined"||PTX_READY.all', { timeout: 180000 });
  const stations = await p0.evaluate(() => CINE.stations.map((s) => ({ n: s.n, x: s.x })));
  await b0.close();

  const { shots, total, events } = storyboard(stations);
  EVENTS = events;
  console.log('列車    : 駅のフォーカス ' + events.length + 'カットに到着/発車を入れる');
  console.log('駅     : ' + stations.length + '(' + OPT.staFrom + '〜'
    + Math.min(OPT.staTo, stations.length - 1) + 'を撮る)');
  console.log('画      : ' + shots.length + 'カット / ' + total + '枚 / '
    + (total / OPT.fps).toFixed(1) + '秒');
  if (OPT.dry) return;

  // 続きから撮るときは、終端(FF D9)まで書けているコマを飛ばす。
  // 書きかけで止まったコマは終端が無いので撮り直しになる
  const frameOk = (f) => {
    try {
      const b = fs.readFileSync(f);
      return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
    } catch (e) { return false; }
  };
  let todo = shots;
  if (OPT.resume) {
    for (const sh of shots) {
      sh.skip = new Set();
      for (let k = 0; k < sh.n; k++)
        if (frameOk(path.join(FRM, 'f' + String(sh.f0 + k).padStart(6, '0') + '.jpg'))) sh.skip.add(k);
    }
    todo = shots.filter((s) => s.skip.size < s.n);
    const left = todo.reduce((a, s) => a + s.n - s.skip.size, 0);
    console.log('続き    : 残り ' + todo.length + 'カット / ' + left + '枚');
  }

  // ワーカへカットを配る。世界の時間はコマ番号で決まるので、どう配っても映像は同じ。
  // 早送りの手間を抑えるため、連続するカットは同じワーカへまとめる(撮る枚数で等分)。
  const nW = Math.max(1, Math.min(OPT.workers, todo.length));
  const lots = Array.from({ length: nW }, () => []);
  const cost = (s) => s.n - (s.skip ? s.skip.size : 0);
  const per = Math.max(1, todo.reduce((a, s) => a + cost(s), 0) / nW);
  let acc = 0;
  todo.forEach((s) => { lots[Math.min(nW - 1, Math.floor((acc + cost(s) / 2) / per))].push(s); acc += cost(s); });

  const t0 = Date.now();
  let shot = 0;
  const log = (m) => {
    shot++;
    const el = (Date.now() - t0) / 1000;
    console.log('[' + el.toFixed(0) + 's ' + shot + '/' + todo.length + '] ' + m);
  };
  await Promise.all(lots.filter((l) => l.length).map((l, i) => runWorker(i + 1, pw, exe, l, log)));
  console.log('撮影 ' + ((Date.now() - t0) / 1000).toFixed(0) + ' 秒');

  /* ---- 6. ffmpeg でまとめる ---- */
  const mp4 = path.join(OUT, 'keio_3d_sample.mp4');
  const args = ['-y', '-framerate', String(OPT.fps), '-i', path.join(FRM, 'f%06d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', OPT.preset, '-crf', String(OPT.crf),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', mp4];
  const r = spawnSync(OPT.ffmpeg, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('ffmpeg が失敗した(連番JPEGは ' + FRM + ' に残っている)');
    console.error((r.stderr || r.error || '').toString().split('\n').slice(-12).join('\n'));
    process.exit(1);
  }
  const kb = (fs.statSync(mp4).size / 1024).toFixed(0);
  console.log('完成 ' + mp4 + '  ' + kb + ' KB  ' + (total / OPT.fps).toFixed(1) + '秒');
  if (!OPT.keepFrames) fs.rmSync(FRM, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
