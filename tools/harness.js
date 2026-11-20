// スタブ実行ハーネス:HTML内の<script>を Node で走らせ、ReferenceError や
// 初期化順序バグ(前方参照)を検出する。ブラウザ専用APIはProxyでスタブ化する。
//   使い方: node tools/harness.js [path/to/keikyu_shinagawa_3d.html]
const fs = require('fs');
const path = process.argv[2] || 'keikyu_shinagawa_3d.html';
const html = fs.readFileSync(path, 'utf8');
// 本体:2026-11 から <script id="keio-main" type="text/x-keio">。ブラウザの読み込み係と同じく「//@@PART n」の行で分け、
// 片ごとに別のスクリプト(vm.runInThisContext=classic な script と同じく、トップレベルの const・let・function は後の片から見える)として
// 実行する。関数の巻き上げは片の中だけなので、前の片が実行中に後の片の関数を呼ぶと ReferenceError になる(それを見つける)
const m = html.match(/<script id="keio-main" type="text\/x-keio">([\s\S]*?)<\/script>/) || html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('NO_SCRIPT'); process.exit(1); }
const code = m[1];
const PARTS = code.split(/^\/\/@@PART\s+\d+.*$/m);
// 別ファイルの沿線の建物データ(あれば先に読む)
{
  for (const nm of ['plateau_bldg.js', 'plateau_land.js', 'plateau_tex.js', 'plateau_dem.js', 'gsi_rail.js', 'gsi_trees.js']) {
    const pl = require('path').join(require('path').dirname(path), nm);
    if (html.includes('<script src="' + nm + '">') && fs.existsSync(pl)) (0, eval)(fs.readFileSync(pl, 'utf8'));
  }
}

// 何でも受け止めるProxy(メソッド呼び出し・プロパティアクセス・new すべて許容)
const anything = new Proxy(function () {}, {
  get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => 0;
    if (k === 'length') return 0;
    return anything;
  },
  apply: () => anything,
  construct: () => anything,
  set: () => true,
});

// ブラウザ環境のスタブ
global.THREE = anything;
global.Image = class { constructor() { this.onload = null; } set src(v) { if (this.onload) this.onload(); } };
global.document = new Proxy({}, {
  get: (t, k) => {
    if (k === 'getElementById' || k === 'querySelector') return () => anything;
    if (k === 'createElement') return () => ({
      getContext: () => anything, appendChild: () => {}, style: {}, classList: { add(){}, remove(){}, toggle(){} },
      setAttribute(){}, width: 0, height: 0,
    });
    if (k === 'addEventListener') return () => {};
    return anything;
  },
});
global.window = global;
global.navigator = { userAgent: 'node', maxTouchPoints: 0 };
global.screen = { width: 1920, height: 1080, orientation: { lock: () => Promise.resolve() } };
global.performance = { now: () => 0 };
global.devicePixelRatio = 1;
global.innerWidth = 1920;
global.innerHeight = 1080;
global.requestAnimationFrame = () => 0;
global.addEventListener = () => {};
global.localStorage = anything;

let rafN = 0;
global.requestAnimationFrame = () => { rafN++; return rafN; };

let partNo = 0;
try {
  const vm = require('vm');
  for (; partNo < PARTS.length; partNo++)
    vm.runInThisContext((partNo ? "'use strict';\n" : '') + PARTS[partNo], { filename: 'keio_part' + partNo + '.js' });
  console.log('RUNTIME_OK (rafN=' + rafN + '・' + PARTS.length + '片)');
} catch (e) {
  console.error('RUNTIME_ERROR: 片 ' + partNo + '/' + PARTS.length + ' ' + e.constructor.name + ' ' + e.message);
  console.error(String(e.stack).split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}
