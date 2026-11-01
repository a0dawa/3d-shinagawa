// 航空写真を実際に描いて確かめる(⑯)。ブラウザ(Playwright・SwiftShader)で描いた画素を測る
//
//   (A) 位置と画素:線路から離れた所(帯の外)を真上から正射影で描き(一様な環境光 1.0・係数 1・トーンマッピングなし=写真の色が
//       そのまま出る)、近 z18・中 z16・遠 z14 を1段ずつ、検証側が別に読んだタイル(fetch→canvas の画素)と検証側の Web メルカトルで
//       作った絵と比べる。平均の差 2.0/255 以下・最もよく合うずらし(±3画素=±0.75m)が (0,0)。窓の画像への書き込み・繰り返し・
//       シェーダの展開・段の重ね方を GPU で通して見る(⑦はスタブで式と枠を見る)
//   (A2) 帯の印:線路をまたいで同じく描き、構造物の半幅+3.6m の内は写真なし(黒の地のまま)・+6.7m の外は写真どおり
//       (帯の印の画像の書き込み=1画素ずつの行・シェーダの座標を GPU で通して見る)
//   (B) 繋がらないとき:地理院タイルへの通信を止めたページで、読むのをやめる(初めの 12枚が失敗)・出典を出さない・写真 ON と OFF の
//       絵が同じ(帯の灰も出ない)
//   (C) 繋がるとき:駅の俯瞰で窓のタイルが全部読める・ON と OFF で絵が変わる・ON は出典を出して水面を隠す・OFF は出典を隠す
//   地理院タイルに繋がらない環境では (A)(C) を SKIP にする(検証側が直接 1枚読んでみて決める。ビューアの読み込みの成否では決めない=
//   ビューアの URL を壊すと NG になる)
//
//   依存(リポジトリ外。measure_load.js と同じ):--playwright <node_modules> --three <three.min.js>(環境変数 K8_PW / K8_THREE)
//   使い方: node tools/verify_ortho.js [--html keikyu_shinagawa_3d.html]
const fs = require('fs');
const path = require('path');
const os = require('os');

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const HTML = opt('html', 'keikyu_shinagawa_3d.html');
const PW = opt('playwright', process.env.K8_PW || '');
const THREEJS = opt('three', process.env.K8_THREE || '');

/* 検証側の基準(ビューアから読まない) */
const REF = {
  URL: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/', HOST: /cyberjapandata\.gsi\.go\.jp/,
  Z: [18, 16, 14],          // 近・中・遠の段
  SZ: 128, N: 512,          // 正射影で描く範囲[m]と画素(0.25m/画素=近の写真の約半画素)
  P: [[400, 160], [1600, -180]],    // 描く所 (s, off):線路の帯から 100m 以上離れた所(品川版:新馬場〜北品川の東・品川の北の西)
  MEAN: 2.0, SHIFT: 3,      // 平均の差[/255]・ずらしを探す範囲[画素]
  BAND_IN: 3.6, BAND_OUT: 6.7,   // 帯の印:構造物の半幅からこの内は写真なし・この外は写真(⑦と同じ)
  ON_DIFF: 6,               // 駅の俯瞰で ON と OFF の平均の差の下限[/255]
  DEAD_AFTER: 12,           // 繋がらないとき、読むのをやめるまでの失敗の数
  CREDIT: '航空写真:地理院タイル',   // 出典の表示(線路の位置の出典「…地理院タイル(ベクトルタイル)を加工」と取り違えない)
};

if (!PW || !THREEJS) {
  console.log('SKIP: Playwright / three.min.js の場所が渡されていない(--playwright --three か K8_PW K8_THREE)');
  process.exit(0);
}
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kortho-'));
const PAGE = path.join(OUT, 'page.html');
{
  let src = fs.readFileSync(HTML, 'utf8');
  src = src.replace(/<script src="https?:\/\/[^"]*three[^"]*"><\/script>/, '<script src="three.min.js"></script>');
  fs.writeFileSync(PAGE, src);
  fs.copyFileSync(THREEJS, path.join(OUT, 'three.min.js'));
  for (const nm of ['plateau_bldg.js', 'plateau_land.js', 'plateau_tex.js', 'plateau_dem.js', 'gsi_rail.js']) {
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

const rows = [];
let ng = 0;
const ok = (name, cond, expect, got) => { if (!cond) ng++; rows.push([name, expect, got, cond ? 'OK' : 'NG']); };
const skip = (name, why) => rows.push([name, '', why, 'SKIP']);

async function openPage(b, offline) {
  const ctx = await b.newContext({ viewport: { width: 800, height: 450 } });   // ページごとに保存領域を分ける(写真の ON/OFF の記憶)
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  if (offline) await p.route(REF.HOST, (r) => r.abort());
  await p.addInitScript(`(()=>{let a=20260701>>>0;Math.random=()=>{
    a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};})()`);
  await p.goto('file://' + PAGE, { timeout: 300000 });
  await p.waitForFunction('window.CINE!==undefined', { timeout: 300000 });
  await p.waitForFunction('typeof PTX_READY==="undefined"||PTX_READY.all', { timeout: 300000 });
  return { p, ctx, errs };
}

/* 駅の俯瞰(measure_load の「駅俯瞰 品川」と同じ視点)で ON/OFF を描いて画素と出典・水面を返す */
const STATION_VIEW = async (R) => {
  CINE.begin(); renderer.setPixelRatio(1); renderer.setSize(800, 450, false); camera.aspect = 800 / 450; camera.updateProjectionMatrix();
  const st = STA[2], q = frame(st.x, 0);
  camera.up.set(0, 1, 0);
  Object.assign(cam, { tx: q.x, ty: 8, tz: q.z, r: 470, th: Math.PI / 2 - 0.4, ph: 0.95 }); applyCam();
  lodStruct();
  const stat = await ORTHO_MGR.settle(90000);
  const gl = renderer.getContext();
  const grab = () => { CINE.render(); const px = new Uint8Array(800 * 450 * 4); gl.readPixels(0, 0, 800, 450, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const credit = () => [...document.querySelectorAll('div')].some((d) => d.textContent.includes(R.CREDIT) && d.style.display !== 'none' && d.isConnected);
  const water = () => (LU.waterMesh ? LU.waterMesh.visible : null);
  ORTHO_MGR.setOn(true);
  const on = grab(), cOn = credit(), wOn = water();
  ORTHO_MGR.setOn(false);
  const off = grab(), cOff = credit(), wOff = water();
  ORTHO_MGR.setOn(true);
  let sum = 0, nd = 0, mx = 0;
  for (let i = 0; i < on.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(on[i + c] - off[i + c]); sum += d; if (d) nd++; if (d > mx) mx = d; }
  return { stat: stat, mean: sum / (on.length / 4 * 3), nd: nd, mx: mx, cOn: cOn, cOff: cOff, wOn: wOn, wOff: wOff, dead: ORTHO_MGR.dead, hasWater: !!(LU.water && LU.water.length) };
};

(async () => {
  const { chromium } = require(path.resolve(PW, 'playwright-core'));
  const b = await chromium.launch({ executablePath: findChromium(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
  const errs = [];

  /* ---- (B) 繋がらないとき ---- */
  {
    const P = await openPage(b, true);
    const r = await P.p.evaluate(STATION_VIEW, REF);
    ok('繋がらないとき読むのをやめる', r.dead && r.stat.put === 0 && r.stat.fails >= REF.DEAD_AFTER && r.stat.pending === 0,
      '初めの ' + REF.DEAD_AFTER + '枚が失敗したら止める・1枚も書かない・待ちが残らない', '止めた ' + r.dead + '・失敗 ' + r.stat.fails + '・書いた ' + r.stat.put + '・待ち ' + r.stat.pending);
    ok('繋がらないとき今の色のまま', r.nd === 0 && !r.cOn && !r.cOff && (!r.hasWater || (r.wOn === true && r.wOff === true)),
      '写真 ON と OFF の絵が画素まで同じ・出典を出さない・水面を出す', '違う画素の値 ' + r.nd + '(最大 ' + r.mx + ')・出典 ' + r.cOn + '/' + r.cOff + '・水面 ' + r.wOn + '/' + r.wOff);
    errs.push(...P.errs);
    await P.ctx.close();
  }

  /* ---- (A)(C) 繋がるとき ---- */
  {
    const P = await openPage(b, false);
    // 検証側が直接 1枚読んでみる(笹塚の z14 のタイル。番号は検証側の式)
    const probe = await P.p.evaluate(async (R) => {
      const la = LAT0 * Math.PI / 180, n = Math.pow(2, 14), x = Math.floor((LON0 + 180) / 360 * n), y = Math.floor((1 - Math.asinh(Math.tan(la)) / Math.PI) / 2 * n);
      try { const r = await fetch(R.URL + '14/' + x + '/' + y + '.jpg', { cache: 'no-store' }); return r.ok ? (await r.blob()).size : -r.status; } catch (e) { return String(e); }
    }, REF);
    if (!(typeof probe === 'number' && probe > 1000)) {
      skip('写真の位置と画素(近・中・遠)', '地理院タイルに繋がらない(' + probe + ')');
      skip('帯の印(GPU)', '地理院タイルに繋がらない');
      skip('繋がるとき写真を出す', '地理院タイルに繋がらない');
    } else {
      const res = await P.p.evaluate(async ([R]) => {
        CINE.begin(); renderer.setPixelRatio(1);
        const P2 = (z) => Math.pow(2, z);
        const tileOf = (x, z, zm) => { const lon = LON0 + x / MLON, la = (LAT0 - z / MLAT) * Math.PI / 180;
          return [(lon + 180) / 360 * P2(zm), (1 - Math.asinh(Math.tan(la)) / Math.PI) / 2 * P2(zm)]; };
        const TC = new Map();
        const tile = async (k) => { if (TC.has(k)) return TC.get(k);
          const r = await fetch(R.URL + k + '.jpg'); if (!r.ok) throw new Error('タイル ' + k + ' ' + r.status);
          const bm = await createImageBitmap(await r.blob()), cv = document.createElement('canvas'); cv.width = cv.height = 256;
          const cx = cv.getContext('2d'); cx.drawImage(bm, 0, 0); const d = cx.getImageData(0, 0, 256, 256).data; TC.set(k, d); return d; };
        const N = R.N, SZ = R.SZ, OU = ORTHO_U, gl = renderer.getContext();
        const T0 = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat); T0.needsUpdate = true;   // 透明な1画素(その段を使わない)
        const wx = (Q, i) => Q.x - SZ / 2 + (i + 0.5) * SZ / N, wz = (Q, r) => Q.z + SZ / 2 - (r + 0.5) * SZ / N;   // 行 r=0 は画面の下=南
        // 窓をその所へ置いてタイルを揃える(真上から見下ろす)
        const settleAt = async (Q) => { camera.up.set(0, 0, -1); camera.position.set(Q.x, 300, Q.z); camera.lookAt(Q.x, 0, Q.z); cam.tx = Q.x; cam.tz = Q.z;
          lodStruct(); return ORTHO_MGR.settle(90000); };
        // 試しの場面:地表と同じ高さの平らな面に航空写真だけを貼る(黒の地・帯の灰なし)。一様な環境光 1.0=拡散の色がそのまま出る。
        // lv=その段だけ(それより近い段は透明な1画素に差し替える)。null=全部の段
        const draw = (Q, lv) => {
          const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, 1));
          const mat = orthoPatch(new THREE.MeshLambertMaterial({ color: 0x000000 }), false, false); mat.toneMapped = false;
          const g = new THREE.PlaneGeometry(SZ, SZ); g.rotateX(-Math.PI / 2);
          const m = new THREE.Mesh(g, mat); m.position.set(Q.x, 0, Q.z); sc.add(m);
          const oc = new THREE.OrthographicCamera(-SZ / 2, SZ / 2, SZ / 2, -SZ / 2, 1, 1000);
          oc.up.set(0, 0, -1); oc.position.set(Q.x, 200, Q.z); oc.lookAt(Q.x, 0, Q.z);   // 画面の右=東・上=北
          renderer.setSize(N, N, false);
          const sv = { t0: OU.uOrtho0.value, t1: OU.uOrtho1.value, g: OU.uOrthoGain.value.clone(), sn: OU.uOrthoSnow.value.clone() };
          OU.uOrthoGain.value.set(1, 1, 1); OU.uOrthoSnow.value.set(0, 0, 0, 0);
          if (lv !== null) { OU.uOrtho0.value = lv >= 1 ? T0 : sv.t0; OU.uOrtho1.value = lv >= 2 ? T0 : sv.t1; }
          renderer.render(sc, oc);
          const px = new Uint8Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
          OU.uOrtho0.value = sv.t0; OU.uOrtho1.value = sv.t1; OU.uOrthoGain.value.copy(sv.g); OU.uOrthoSnow.value.copy(sv.sn);
          g.dispose(); mat.dispose();
          return px; };
        // 検証側の絵:画素の中心 → 世界 → タイルの番号(検証側の式)→ 画素の双線形(GL と同じ:画素の中心が +0.5)
        const expect = async (Q, zm) => {
          const c0 = tileOf(wx(Q, 0), wz(Q, N - 1), zm), c1 = tileOf(wx(Q, N - 1), wz(Q, 0), zm);
          for (let x = Math.floor(c0[0] - 0.01); x <= Math.floor(c1[0] + 0.01); x++) for (let y = Math.floor(c0[1] - 0.01); y <= Math.floor(c1[1] + 0.01); y++) await tile(zm + '/' + x + '/' + y);
          const tex = (gx, gy, c) => { const x = Math.floor(gx / 256), y = Math.floor(gy / 256), d = TC.get(zm + '/' + x + '/' + y);
            return d[(((gy - y * 256) * 256) + (gx - x * 256)) * 4 + c]; };
          const ex = new Float32Array(N * N * 3);
          for (let r = 0; r < N; r++) for (let i = 0; i < N; i++) {
            const t = tileOf(wx(Q, i), wz(Q, r), zm), fx = t[0] * 256 - 0.5, fy = t[1] * 256 - 0.5, gx = Math.floor(fx), gy = Math.floor(fy), a = fx - gx, bb = fy - gy;
            for (let c = 0; c < 3; c++) ex[(r * N + i) * 3 + c] = (tex(gx, gy, c) * (1 - a) + tex(gx + 1, gy, c) * a) * (1 - bb) + (tex(gx, gy + 1, c) * (1 - a) + tex(gx + 1, gy + 1, c) * a) * bb;
          }
          return ex; };
        const out = [];
        // (A) 段ごとの位置と画素
        for (const [s, o] of R.P) {
          const Q = frame(s, o), stat = await settleAt(Q);
          for (let lv = 0; lv < 3; lv++) {
            if (!ORTHO_MGR.LV[lv].slots) { out.push({ s: s, o: o, lv: lv, none: true }); continue; }
            const px = draw(Q, lv), ex = await expect(Q, R.Z[lv]);
            // ずらし (dx,dy) ごとの平均の差(縁の SHIFT 画素は除く)
            const S = R.SHIFT, diff = (dx, dy) => { let a = 0, n = 0;
              for (let r = S; r < N - S; r += 2) for (let i = S; i < N - S; i += 2) { const k = ((r + dy) * N + i + dx) * 4, e = (r * N + i) * 3;
                for (let c = 0; c < 3; c++) a += Math.abs(px[k + c] - ex[e + c]); n += 3; } return a / n; };
            let best = [0, 0], bm = Infinity; const d00 = diff(0, 0);
            for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) { const v = (dx || dy) ? diff(dx, dy) : d00; if (v < bm - 1e-9) { bm = v; best = [dx, dy]; } }
            let sum = 0; for (let k = 0, e = 0; k < px.length; k += 4, e += 3) for (let c = 0; c < 3; c++) sum += Math.abs(px[k + c] - ex[e + c]);
            let sd = 0, mu = 0; for (let e = 0; e < ex.length; e++) mu += ex[e]; mu /= ex.length; for (let e = 0; e < ex.length; e++) sd += (ex[e] - mu) ** 2; sd = Math.sqrt(sd / ex.length);
            out.push({ s: s, o: o, lv: lv, z: R.Z[lv], mean: sum / ex.length, d00: d00, best: best, bm: bm, sd: sd, ok: stat.levels[lv].ok, slots: stat.levels[lv].slots });
          }
        }
        // (A2) 帯の印:線路をまたいで描く(全部の段)。構造物の半幅+BAND_IN の内は黒(写真なし)、+BAND_OUT の外は写真どおり
        const sB = (STA[0].x + STA[1].x) / 2, QB = frame(sB, 0);   // 品川版:新馬場〜北品川の高架の中ほど
        await settleAt(QB);
        const pb = draw(QB, null), eb = await expect(QB, R.Z[0]);
        let nIn = 0, inBad = 0, inMax = 0, nOut = 0, outSum = 0;
        for (let r = 0; r < N; r++) for (let i = 0; i < N; i++) {
          const q = prjXY(wx(QB, i), wz(QB, r)), sg = q.off < 0 ? -1 : 1, hw = q.s > DECK_END ? cutHalf(q.s, sg) : deckHalf(q.s), a = Math.abs(q.off), k = (r * N + i) * 4, e = (r * N + i) * 3;
          if (a <= hw + R.BAND_IN) { nIn++; const v = Math.max(pb[k], pb[k + 1], pb[k + 2]); inMax = Math.max(inMax, v); if (v > 3) inBad++; }
          else if (a >= hw + R.BAND_OUT) {
            // 品川版:帯に掛かって外した実際の建物の足跡+1m も写真を使わない(ORTHO_HOLES)。その近く(+1m+移り変わり 3.1m)は比べない
            const hx = wx(QB, i), hz = wz(QB, r);
            if (ORTHO_HOLES.some((P) => polyDist(P, hx, hz) < 1.0 + (R.BAND_OUT - R.BAND_IN))) continue;
            nOut++; for (let c = 0; c < 3; c++) outSum += Math.abs(pb[k + c] - eb[e + c]); }
        }
        out.push({ band: true, s: Math.round(sB), nIn: nIn, inBad: inBad, inMax: inMax, nOut: nOut, outMean: outSum / Math.max(1, nOut * 3) });
        T0.dispose();
        return out;
      }, [REF]);
      let bad = null; const got = [];
      for (const r of res) {
        if (r.none || r.band) continue;
        got.push('z' + r.z + ' 平均の差 ' + r.mean.toFixed(2) + '・ずらし (' + r.best.join(',') + ')');
        if (!bad && !(r.ok === r.slots && r.slots > 0)) bad = 's=' + r.s + ' z' + r.z + ' の窓のタイル ' + r.ok + '/' + r.slots;
        else if (!bad && !(r.sd > 8)) bad = 's=' + r.s + ' z' + r.z + ' の写真が平坦(標準偏差 ' + r.sd.toFixed(1) + '。位置を見分けられない)';
        else if (!bad && !(r.mean <= REF.MEAN && r.best[0] === 0 && r.best[1] === 0))
          bad = 's=' + r.s + ' off=' + r.o + ' z' + r.z + ':平均の差 ' + r.mean.toFixed(2) + '・最もよく合うずらし (' + r.best.join(',') + ')=' + r.bm.toFixed(2) + '(ずらさず ' + r.d00.toFixed(2) + ')';
      }
      ok('写真の位置と画素(近・中・遠)', bad === null && res.filter((r) => !r.none && !r.band).length >= 4,
        '真上の正射影で、検証側が読んだタイルと Web メルカトルの絵に平均 ' + REF.MEAN + '/255 以下・最もよく合うずらしが (0,0)', bad || got.join(' / '));
      const B = res.find((r) => r.band);
      ok('帯の印(GPU)', B && B.nIn > 5000 && B.inBad === 0 && B.nOut > 50000 && B.outMean <= REF.MEAN,
        '線路をまたいで描き、構造物の半幅+' + REF.BAND_IN + 'm の内は写真なし(黒の地のまま 3/255 以下)・+' + REF.BAND_OUT + 'm の外は写真どおり(平均の差 ' + REF.MEAN + '/255 以下)',
        B ? 's=' + B.s + ' 内 ' + B.nIn + '画素(写真が出た ' + B.inBad + '・最大 ' + B.inMax + ')・外 ' + B.nOut + '画素(平均の差 ' + B.outMean.toFixed(2) + ')' : '測れない');
      // (C) 駅の俯瞰
      const r = await P.p.evaluate(STATION_VIEW, REF);
      const full = r.stat.levels.every((L) => L.ok === L.slots);
      ok('繋がるとき写真を出す', full && !r.dead && r.mean >= REF.ON_DIFF && r.cOn && !r.cOff && (!r.hasWater || (r.wOn === false && r.wOff === true)),
        '駅の俯瞰で窓のタイルが全部読める・ON と OFF の平均の差 ' + REF.ON_DIFF + '/255 以上・ON は出典を出して水面を隠す・OFF は出典を隠して水面を出す',
        'タイル ' + r.stat.levels.map((L) => 'z' + L.z + ' ' + L.ok + '/' + L.slots).join('・') + '・平均の差 ' + r.mean.toFixed(1) + '・出典 ' + r.cOn + '/' + r.cOff + '・水面 ' + r.wOn + '/' + r.wOff);
    }
    errs.push(...P.errs);
    await P.ctx.close();
  }
  await b.close();

  ok('ページのエラー', errs.length === 0, '0件', errs.length ? errs.slice(0, 3).join(' / ') : '0件');
  const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(1, n - w)); };
  for (const r of rows) console.log(pad(r[0], 32) + pad(r[1], 40) + pad(r[2], 40) + r[3]);
  console.log(ng ? 'RESULT: FAIL(' + ng + '項目NG)' : 'RESULT: PASS');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
