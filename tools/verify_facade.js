// 建物の外装のシェーダを実際に描いて、検証用の式 bldFacadeAt と画素ごとに突き合わせる(⑰)。ブラウザ(Playwright・SwiftShader)
//
//   (品川版:基準は京王版と同じ式の突き合わせなので同じ値。バルコニーの印は壁の試しでだけ使う。⑦ verify_city 相当は未移植)
//   ⑦(verify_city.js)は外装の性質(窓の段=階数・壁の端・玄関の幅と向き・店の1階・窓の割合)を bldFacadeAt(JS)で検査する。
//   それが描かれた絵の性質であるためには、シェーダ(GLSL の bwFacade と頂点シェーダの u・L・印の受け渡し)が bldFacadeAt と同じ結果を
//   出さなければならない。スタブではシェーダを走らせられないので、ここで GPU の単精度で走らせて比べる:
//   - 試しの壁(窓の種類4 × 外装8 × 3通りの長さ・階数・1階の印・向き)と、遠景(バルコニーの手すりを塗る)・箱のインスタンス(中・遠の形。
//     頂点シェーダが箱の局所座標から u・L を作り、共同住宅の南の壁にバルコニーの印を足す)を、壁に正対する正射影で 24px/m に描く
//   - 検証用の出力(BLD_WIN_U.uBwDbg=1:赤=区分 k・緑=夜に灯る部屋・青=外装を描く面)を読み、画素の中心で bldFacadeAt を計算して比べる。
//     区分の境(画素の中心から ±0.45画素で区分が変わる所)は除く
//   - 合格:区分の一致 99.8% 以上・灯る部屋の一致 99.8% 以上・k=1〜10 の区分がすべて現れる・外装を描く印がすべての画素で立つ
//   乱数は 289 を法とする整数の置換(bh)なので、単精度でも JS と同じ値になる(sin の乱数は大きな数で食い違った)。それもここで見る。
//
//   依存(リポジトリ外。measure_load.js と同じ):--playwright <node_modules> --three <three.min.js>(環境変数 K8_PW / K8_THREE)
//   使い方: node tools/verify_facade.js [--html keikyu_shinagawa_3d.html]
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
  PXM: 24,                  // 1m あたりの画素
  MATCH: 0.998,             // 区分・灯る部屋の一致の下限
  KINDS: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],   // 現れるべき区分(窓・枠・扉・店のガラス・看板・シャッター・戸袋・庇・遠景の手すり・雨だれ)
  MIN_PX: 300000,           // 比べる画素の下限
  // 試しの壁:窓の種類ごとの [1階の印, 長さ, 階数] ×3。印:1 扉・2 店・4 入口・8 共同住宅のバルコニー・16 戸建てのバルコニー・32 車庫・64 倉庫の扉
  CASES: [[[1, 6.6, 2], [1 | 32, 9.1, 2], [1 | 16, 7.4, 2]],
          [[4, 8.2, 3], [8, 11.3, 4], [0, 5.3, 0]],
          [[2, 9.6, 3], [4, 12.4, 5], [0, 7.7, 0]],
          [[64, 12.6, 0], [0, 8.4, 2], [2, 6.4, 1]]],
  NORMALS: [[0, 1], [0, -1], [1, 0], [0.5, 0.8660254]],   // 壁の外向き(南・北・東・南南東)
};

if (!PW || !THREEJS) {
  console.log('SKIP: Playwright / three.min.js の場所が渡されていない(--playwright --three か K8_PW K8_THREE)');
  process.exit(0);
}
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kfac-'));
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

(async () => {
  const { chromium } = require(path.resolve(PW, 'playwright-core'));
  const b = await chromium.launch({ executablePath: findChromium(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 450 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/cyberjapandata\.gsi\.go\.jp/, (r) => r.abort());   // 航空写真は使わない
  await p.goto('file://' + PAGE, { timeout: 300000 });
  await p.waitForFunction('window.CINE!==undefined', { timeout: 300000 });
  const res = await p.evaluate((R) => {
    if (typeof bldFacadeAt !== 'function' || !BLD_WIN_U.uBwDbg) return { err: 'bldFacadeAt か uBwDbg が無い' };
    CINE.begin(); renderer.setPixelRatio(1);
    const mat = mkMat('MeshLambertMaterial', { color: 0xffffff, vertexColors: true }); bldWinPatch(mat);
    const sc = new THREE.Scene();
    const st = { n: 0, ok: 0, nl: 0, okl: 0, kinds: {}, bad: [], noFac: 0, panels: 0 };
    const twinAt = (o, u, yr) => bldFacadeAt(Object.assign({}, o, { u: u, yr: yr }));
    const litOf = (r) => r.k === 1 && r.cell && bh(r.cell[0] + 307 * r.cell[1], 34) > 0.42;
    // 描いて読む:壁の面に正対する正射影(右=u が増える向き)。中心から外へ 50m
    const shoot = (obj, o, n, cx, cy, L, H) => {
      const W = Math.round(L * R.PXM), Hp = Math.round(H * R.PXM);
      const rt = new THREE.WebGLRenderTarget(W, Hp, { depthBuffer: true });
      const cam = new THREE.OrthographicCamera(-L / 2, L / 2, H / 2, -H / 2, 1, 200);
      cam.up.set(0, 1, 0); cam.position.set(cx[0] + n[0] * 50, cy, cx[1] + n[1] * 50); cam.lookAt(cx[0], cy, cx[1]);
      sc.add(obj); renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
      const px = new Uint8Array(W * Hp * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, Hp, px); renderer.setRenderTarget(null); sc.remove(obj); rt.dispose();
      st.panels++;
      const du = L / W * 0.45, dy = H / Hp * 0.45;
      for (let r = 1; r < Hp - 1; r++) for (let i = 1; i < W - 1; i++) {
        const u = (i + 0.5) / W * L, yr = (r + 0.5) / Hp * H, q = (r * W + i) * 4;
        if (px[q + 2] < 128) { st.noFac++; continue; }
        const c = twinAt(o, u, yr);
        let edge = false;
        for (const [a, bb] of [[-du, 0], [du, 0], [0, -dy], [0, dy], [-du, -dy], [du, dy], [-du, dy], [du, -dy]]) { const e = twinAt(o, u + a, yr + bb); if (e.k !== c.k || litOf(e) !== litOf(c)) { edge = true; break; } }
        if (edge) continue;
        const k = px[q] >> 4, lit = px[q + 1] > 127;
        st.n++; if (k === c.k) st.ok++; else if (st.bad.length < 6) st.bad.push('wt' + o.wt + ' fs' + o.fs + ' 印' + o.fl + ' L' + o.L.toFixed(1) + ' u' + u.toFixed(2) + ' y' + yr.toFixed(2) + ' GPU ' + k + ' / 式 ' + c.k);
        st.kinds[c.k] = (st.kinds[c.k] || 0) + 1;
        if (c.k === 1) { st.nl++; if (lit === litOf(c)) st.okl++; }
      }
    };
    const BASE = 3.0;
    // (1) 壁の面(近くの形・LOD2 の壁と同じ属性 aBld・aWal)
    for (let wt = 0; wt < 4; wt++) for (let fs = 0; fs < 8; fs++) for (let j = 0; j < 3; j++) for (const far of [false, true]) {
      const [fl0, L, nst] = R.CASES[wt][j];
      if (far && !(fl0 & 24)) continue;                      // 遠景はバルコニーの印の壁だけ
      const n = R.NORMALS[(fs + j) % 4], t = [n[1], -n[0]], seed = (wt * 131 + fs * 17 + j * 53) % 997, fh = BLD_WIN[wt][2], g0 = FS_G0[fs];
      const H = nst > 0 ? g0 + nst * fh + 0.6 : 9.0, fl = fl0 + 128 * nst;
      const P = [], AB = [], AW = [], Nn = [], Cc = [];
      const a = [0, 0], d = [t[0] * L, t[1] * L];
      for (const [pp, u, y] of [[a, 0, 0], [d, L, 0], [d, L, H], [a, 0, H]]) {
        P.push(pp[0], BASE + y, pp[1]); Nn.push(n[0], 0, n[1]); Cc.push(1, 1, 1); AB.push(wt + 4 * fs, BASE + H, seed, BASE); AW.push(u, L, fh, fl); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aBld', new THREE.Float32BufferAttribute(AB, 4));
      g.setAttribute('aWal', new THREE.Float32BufferAttribute(AW, 4)); g.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.material.side = THREE.DoubleSide;
      BLD_WIN_U.uBwDbg.value = 1; BLD_WIN_U.uAttD.value = far ? 0 : 1e9;
      shoot(m, { wt: wt, fs: fs, L: L, H: H, fh: fh, fl: fl, seed: seed, tx: -n[1], tz: n[0], nz: n[1], far: far }, n, [d[0] / 2, d[1] / 2], BASE + H / 2, L, H);
      g.dispose();
    }
    // (2) 箱のインスタンス(中・遠の形):南の面を正面から。u・L は頂点シェーダが箱の局所座標から作る
    for (let wt = 0; wt < 4; wt++) for (const fs of [1, 2, 3, 6]) {
      const w = 8.6 + wt, h = 10.2, dd = 6.0, nst = 3, seed = (wt * 41 + fs * 7) % 997, fh = Math.min(BLD_WIN[wt][2] + 0.1, 4.0);
      const g = new THREE.BoxGeometry(1, 1, 1), im = new THREE.InstancedMesh(g, mat, 1);
      im.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, BASE + h / 2, 0), new THREE.Quaternion(), new THREE.Vector3(w, h, dd)));
      g.setAttribute('iBld', new THREE.InstancedBufferAttribute(new Float32Array([wt + 4 * fs, seed, fh, 128 * nst]), 4)); im.frustumCulled = false;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
      const bal = 0;   // 品川版:付属物(バルコニー)を作らないので、箱の頂点シェーダはバルコニーの印を足さない
      BLD_WIN_U.uBwDbg.value = 1; BLD_WIN_U.uAttD.value = 1e9;
      // 南の面(z=+dd/2)。u=(x+w/2)
      const S = new THREE.Scene(); void S;
      shoot(im, { wt: wt, fs: fs, L: w, H: h, fh: fh, fl: 128 * nst + bal, seed: seed, tx: -1, tz: 0, nz: 1, far: false }, [0, 1], [0, dd / 2], BASE + h / 2, w, h);
      g.dispose();
    }
    BLD_WIN_U.uBwDbg.value = 0; BLD_WIN_U.uAttD.value = 150;
    return st;
  }, REF);
  await b.close();
  if (res.err) { console.log('NG:', res.err); process.exit(1); }
  const rows = []; let ng = 0;
  const ok = (name, cond, expect, got) => { if (!cond) ng++; rows.push([name, expect, got, cond ? 'OK' : 'NG']); };
  const miss = REF.KINDS.filter((k) => !res.kinds[k]);
  ok('外装の区分 GPU ⇄ 式', res.n >= REF.MIN_PX && res.ok >= REF.MATCH * res.n && miss.length === 0,
    '一致 ' + (REF.MATCH * 100) + '% 以上・' + REF.MIN_PX + '画素以上・区分 1〜10 が現れる',
    res.ok + '/' + res.n + '(' + (res.ok / Math.max(1, res.n) * 100).toFixed(3) + '%)・' + res.panels + '面' + (miss.length ? '・現れない区分 ' + miss.join(',') : '') + (res.bad.length ? '・例 ' + res.bad.join(' | ') : ''));
  ok('夜に灯る部屋 GPU ⇄ 式', res.nl > 20000 && res.okl >= REF.MATCH * res.nl, '窓の画素で一致 ' + (REF.MATCH * 100) + '% 以上', res.okl + '/' + res.nl);
  ok('外装を描く面', res.noFac === 0, '壁の画素はすべて外装を描く(番号が正・横向き)', '描かない画素 ' + res.noFac);
  ok('ページのエラー', errs.length === 0, '0件', errs.length ? errs.slice(0, 3).join(' / ') : '0件');
  console.log('=== 建物の外装:シェーダ ⇄ 検証用の式(画素で) ===');
  for (const r of rows) console.log(r[0].padEnd(24) + ' ' + r[1].padEnd(46) + ' ' + r[2] + '  ' + r[3]);
  console.log('\nRESULT:', ng ? 'FAIL(' + ng + '項目NG)' : 'PASS');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.log('NG: 例外', e && e.stack || e); process.exit(1); });
