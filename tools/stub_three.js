// HTML内の<script>を Node で実行するための共通スタブ。
//
//   THREE を「あとから測定できる実体」に差し替え、ブラウザ専用APIは Proxy で潰す。
//   これにより、描画を目視できなくてもモデルや運転ロジックを機械的に検査できる。
//   verify_car.js(ジオメトリ検証)と verify_run.js(運転検証)が共用する。
//
//   使い方:
//     const X = require('./stub_three')('keio_elevated_3d.html', 'K8:K8,STA:STA');
//     // X.K8 / X.STA が取り出せる
const fs = require('fs');
const nodePath = require('path');

/* ---- 何でも受け止めるProxy(測定に関係しないブラウザ/描画APIはこれで潰す) ---- */
const anything = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'length' ? 0 : anything),
  apply: () => anything, construct: () => anything, set: () => true,
});
// 実体クラスに「知らないプロパティは anything」を足す薄いラッパ
const soft = (o) => new Proxy(o, {
  get: (t, k) => (typeof k === 'symbol' || k in t ? t[k] : anything),
  set: (t, k, v) => { t[k] = v; return true; },
});

/* ---- 測定に必要なぶんだけ本物として実装した THREE ---- */
class V3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  crossVectors(a, b) {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  applyQuaternion() { return this; }
  applyMatrix4() { return this; }
}
// 2・4成分のベクトル(シェーダへ渡す uniform の値を検査できるように実体で持つ)
class V2 { constructor(x, y) { this.x = x || 0; this.y = y || 0; }
  set(x, y) { this.x = x; this.y = y; return this; } }
class V4 { constructor(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w || 0; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; } }
class Obj3D {
  constructor() {
    this.children = []; this.position = new V3(); this.rotation = new V3();
    this.scale = new V3(1, 1, 1); this.quaternion = soft({ setFromRotationMatrix() {} });
    this.userData = {}; this.visible = true;
    // three.js と同じ型の目印。走査で「メッシュだけ」を厳密に選ぶために要る
    // (Proxy の既定値は何でも真になるので、=== true で比べられる実値を置く)
    this.isMesh = false;
    return soft(this);
  }
  add(...o) {
    // 親子関係も実体で持つ(「この群に属するか」で分岐する処理を検査できる)
    for (const c of o) { this.children.push(c); if (c && typeof c === 'object') c.parent = this; }
    return this;
  }
  remove() { return this; }
  traverse(f) { f(this); for (const c of this.children) if (c && c.traverse) c.traverse(f); }
}
class Group extends Obj3D {}
class Scene extends Obj3D {}   // traverse を効かせて場面全体を走査できるようにする
// 透視投影カメラ。near/far を実値で持ち、空ドームが遠方面の内側にあるか等を測れる
class PerspCam extends Obj3D {
  constructor(fov, aspect, near, far) {
    super();
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    this.up = new V3(0, 1, 0);
    this.look = new V3(0, 0, 0);   // lookAt で与えられた注視点(撮影モードの検査に使う)
    return soft(this);
  }
  // 行列は組まないが「どこを見ているか」だけは実値で残す
  lookAt(x, y, z) {
    if (x && typeof x === 'object') this.look.set(x.x, x.y, x.z);
    else this.look.set(x, y, z);
    return this;
  }
  updateProjectionMatrix() { return this; }
  // 視線の向き(lookAt の注視点−位置。航空写真の窓をカメラの前に置く処理が使う)
  getWorldDirection(v) {
    const d = new V3(this.look.x - this.position.x, this.look.y - this.position.y, this.look.z - this.position.z).normalize();
    return (v || new V3()).set(d.x, d.y, d.z);
  }
}
/* 描画器。影の設定・色空間・露出を実値で持つ(ここを Proxy にすると、
   トーンマッピングの逆算のように露出を読む処理が検査できない)。 */
class Renderer {
  constructor() {
    this.shadowMap = soft({ enabled: false, type: 0 });
    this.outputEncoding = 3000; this.toneMapping = 0; this.toneMappingExposure = 1;
    this.info = soft({ render: soft({ calls: 0, triangles: 0 }) });
    this.domElement = anything;
    this.frames = 0;
    this.copies = [];       // copyTextureToTexture の記録
    return soft(this);
  }
  setPixelRatio() {} setSize() {} setClearColor() {} compile() {}
  render() { this.frames++; }
  // 画像の一部への書き込み(航空写真のタイルを枠へ書く)。どの画像のどこへ何を書いたか・縮小の段を作り直したか(mip)を残す
  copyTextureToTexture(pos, src, dst) {
    this.copies.push({ x: pos.x, y: pos.y, src: src && src.image ? (src.image.src || (src.image.data ? 'data' : '?')) : '?', dst: dst, mip: !!(dst && dst.generateMipmaps) });
  }
}
/* データの画像(航空写真の窓・線路の帯の印)。中身と大きさ・形式・繰り返し・縮小の段を実値で持つ */
class DataTex {
  constructor(data, width, height, format, type) {
    this.image = { data: data || null, width: width || 1, height: height || 1 };
    this.format = format; this.type = type;
    this.wrapS = 1001; this.wrapT = 1001; this.magFilter = 1003; this.minFilter = 1003;
    this.generateMipmaps = false; this.flipY = false; this.anisotropy = 1; this.unpackAlignment = 1;
    this.encoding = 3000; this.needsUpdate = false; this.isDataTexture = true;
    return soft(this);
  }
}
/* テクスチャ。色空間(encoding)と写像(mapping)を実値で持つ。
   ここを実体にしないと「色テクスチャをsRGBとして読んでいるか」
   「環境マップを正距円筒として読ませているか」を検査できない。 */
class Tex {
  constructor() {
    this.encoding = 3000;   // LinearEncoding
    this.mapping = 300;     // UVMapping
    this.wrapS = 1001; this.wrapT = 1001;
    this.repeat = soft({ x: 1, y: 1, set(a, b) { this.x = a; this.y = b; return this; } });
    this.needsUpdate = false;
    return soft(this);
  }
}
/* 平行光。影の追従(光の向き・写す範囲・テクセルへの吸着)を検査できるように、
   position / target.position / shadow.camera を実体として持つ。 */
class DirLight extends Obj3D {
  constructor(color, intensity) {
    super();
    this.color = (color && color.setRGB) ? color : new Color();
    this.intensity = (intensity === undefined) ? 1 : intensity;
    this.target = new Obj3D();
    this.castShadow = false;
    this.shadow = soft({
      mapSize: soft({ x: 512, y: 512, set(a, b) { this.x = a; this.y = b; return this; } }),
      camera: soft({
        left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 500,
        updateProjectionMatrix() {},
      }),
      bias: 0, normalBias: 0,
    });
    return soft(this);
  }
}
/* 色。r/g/b を**リニア値**で実体として持つ(HTMLは srgb()/setSrgb() で必ず
   リニアへ変換してから渡すので、ここに入る値はリニアである)。
   Proxy のままだと「時刻ごとに光の色が本当に変わったか」を測れない。 */
class Color {
  constructor(r, g, b) { this.r = 1; this.g = 1; this.b = 1; if (typeof r === 'number' && typeof g === 'number') this.setRGB(r, g, b); return soft(this); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  setScalar(s) { return this.setRGB(s, s, s); }
  lerp(c, a) { return this.setRGB(this.r + (c.r - this.r) * a, this.g + (c.g - this.g) * a, this.b + (c.b - this.b) * a); }
  copy(c) { return this.setRGB(c.r, c.g, c.b); }
  clone() { return new Color().copy(this); }
  multiplyScalar(s) { return this.setRGB(this.r * s, this.g * s, this.b * s); }
  getHexString() { return ('000000' + this.getHex().toString(16)).slice(-6); }
  getHex() {
    const l2s = (v) => (v <= 0.0031308) ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    const q = (v) => Math.max(0, Math.min(255, Math.round(l2s(Math.max(0, v)) * 255)));
    return (q(this.r) << 16) | (q(this.g) << 8) | q(this.b);
  }
}
class Fog {
  constructor(c, near, far) { this.color = c; this.near = near; this.far = far; return soft(this); }
}
// 半球光。撮影モードが時刻ごとに色と強さを差し替えるので実体で持つ
class HemiLight extends Obj3D {
  constructor(sky, ground, intensity) {
    super();
    this.color = (sky && sky.setRGB) ? sky : new Color();
    this.groundColor = (ground && ground.setRGB) ? ground : new Color();
    this.intensity = (intensity === undefined) ? 1 : intensity;
    return soft(this);
  }
}
// 点群(雪・花びら)。位置の配列と表示状態を実体で持つ
class Points extends Obj3D {
  constructor(g, mat) { super(); this.geometry = g; this.material = mat; this.isPoints = true;
    this.frustumCulled = true; return soft(this); }
}
// 線分(雨)。点群と同じく位置の配列と表示状態を実体で持つ
class LineSeg extends Obj3D {
  constructor(g, mat) { super(); this.geometry = g; this.material = mat; this.isLineSegments = true;
    this.frustumCulled = true; return soft(this); }
}
class Mesh extends Obj3D {
  constructor(g, mat) { super(); this.geometry = g; this.material = mat; this.isMesh = true; }
}
/* 回転(三角関数の式は three.js r128 の Quaternion.setFromEuler と同じ)。インスタンスの向き(車の縦の傾き)を測れるように実体で持つ */
class Euler {
  constructor(x, y, z, order) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.order = order || 'XYZ'; return soft(this); }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; this.order = order || this.order; return this; }
  copy(e) { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this; }
}
class Quat {
  constructor(x, y, z, w) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.w = w === undefined ? 1 : w; this.isQuaternion = true; return soft(this); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  setFromEuler(e) {
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2), s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
    const o = e.order || 'XYZ';
    if (o === 'XYZ') this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
    else if (o === 'YXZ') this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
    else if (o === 'ZXY') this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
    else if (o === 'ZYX') this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
    else if (o === 'YZX') this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
    else if (o === 'XZY') this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
    return this;
  }
}
// 位置・回転・拡大率を記録する Matrix4。インスタンスの配置を後から測れるようにする。
class M4 {
  constructor() { this.p = null; this.s = null; this.q = null; return soft(this); }
  compose(pos, q, sc) {
    this.p = { x: pos.x, y: pos.y, z: pos.z };
    this.s = { x: sc.x, y: sc.y, z: sc.z };
    this.q = (q && q.isQuaternion === true) ? { x: q.x, y: q.y, z: q.z, w: q.w } : null;
    return this;
  }
  makeBasis() { return this; }
  identity() { return this; }
}
// InstancedMesh:setMatrixAt で渡された配置を配列 mats に保持する
class Inst extends Mesh {
  constructor(g, mat, n) {
    super(g, mat);
    this.count = n; this.mats = []; this.cols = [];
    this.instanceMatrix = soft({ needsUpdate: false });
    this.instanceColor = soft({ needsUpdate: false });
    return soft(this);
  }
  // インスタンスの色も記録する(季節の着色が本当に全数へ行き渡ったかを測る)
  setColorAt(i, c) { this.cols[i] = (c && c.getHex) ? c.getHex() : null; }
  setMatrixAt(i, m) {
    this.mats[i] = (m && m.p) ? { p: { x: m.p.x, y: m.p.y, z: m.p.z },
                                  s: m.s ? { x: m.s.x, y: m.s.y, z: m.s.z } : null, q: m.q || null } : null;
  }
  getMatrixAt() {}
}
class Attr {
  constructor(a, is) { this.array = a; this.itemSize = is; this.count = a.length / is; return soft(this); }
  setXYZ(i, x, y, z) { const k = i * this.itemSize; this.array[k] = x; this.array[k + 1] = y; this.array[k + 2] = z; return this; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class BufGeo {
  constructor() { this.attributes = {}; this.index = null; this.drawRange = { start: 0, count: Infinity }; this.userData = {}; return soft(this); }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  setDrawRange(s, c) { this.drawRange.start = s; this.drawRange.count = c; }
  setIndex(a) { this.index = soft({ array: a, count: a.length }); return this; }
  computeVertexNormals() {} dispose() {}
  translate() { return this; } rotateX() { return this; } rotateY() { return this; } scale() { return this; }
  // three.js と同じく属性と添字を持った別の実体を返す(複製した形の頂点も測れるように)
  clone() {
    const g = new BufGeo();
    for (const k of Object.keys(this.attributes)) g.attributes[k] = this.attributes[k];
    if (this.index) g.setIndex(this.index.array);
    if (this.boundingSphere) g.boundingSphere = this.boundingSphere;
    return g;
  }
}
const param = (type) => class extends BufGeo {
  constructor(...a) { super(); this.type = type; this.p = a; return soft(this); }
};
/* 材質。three.js は Lambert/Phong/Standard に必ず emissive(黒のColor)を持たせるので、
   省略されたときも実体を置く。ここが Proxy のままだと
   「夜に emissive を足して昼に戻す」といった処理を数値で検査できない。 */
const Mat = (type) => class {
  constructor(o) {
    Object.assign(this, o || {});
    this.type = type;
    if (type !== 'basic' && type !== 'line' && type !== 'points' && !(this.emissive && this.emissive.setRGB))
      this.emissive = new Color().setRGB(0, 0, 0);
    if (!this.userData || typeof this.userData !== 'object') this.userData = {};
    return soft(this);
  }
  // three.js と同じく別の実体を返す(車両ごとに複製する材質を検査できるように)
  clone() {
    const c = new (Object.getPrototypeOf(this).constructor)();
    for (const k of Object.keys(this)) c[k] = this[k];
    c.userData = {};
    return c;
  }
};
// 環境マップの前処理器。scene.environment を実体として測れるようにする
class PMREM {
  constructor() { return soft(this); }
  compileEquirectangularShader() {}
  fromEquirectangular(t) { const o = new Tex(); o.mapping = 306 /* CubeUVReflectionMapping */;
    o.source = t; return soft({ texture: o }); }
  dispose() {}
}
const REAL = {
  Vector3: V3, Vector2: V2, Vector4: V4, Object3D: Obj3D, Group, Scene, Mesh, BufferGeometry: BufGeo, DirectionalLight: DirLight,
  PerspectiveCamera: PerspCam, CanvasTexture: Tex, Texture: Tex, DataTexture: DataTex, WebGLRenderer: Renderer,
  Matrix4: M4, InstancedMesh: Inst, Color, Fog, Euler, Quaternion: Quat,
  Float32BufferAttribute: Attr, BufferAttribute: Attr, InstancedBufferAttribute: Attr, HemisphereLight: HemiLight,
  BoxGeometry: param('Box'), CylinderGeometry: param('Cyl'), PlaneGeometry: param('Plane'),
  SphereGeometry: param('Sph'), ConeGeometry: param('Cone'), CircleGeometry: param('Cir'),
  MeshLambertMaterial: Mat('lambert'), MeshBasicMaterial: Mat('basic'),
  MeshPhongMaterial: Mat('phong'), MeshStandardMaterial: Mat('standard'),
  LineBasicMaterial: Mat('line'), LineSegments: LineSeg, PMREMGenerator: PMREM, Points, PointsMaterial: Mat('points'),
  DoubleSide: 2, FrontSide: 0, BackSide: 1,
  // three.js の定数(実値)。スタブが Proxy を返すと材質の設定を数値で検査できない
  LinearEncoding: 3000, sRGBEncoding: 3001,
  UVMapping: 300, EquirectangularReflectionMapping: 303,
  MultiplyOperation: 0, MixOperation: 1, AddOperation: 2,
  NoToneMapping: 0, ACESFilmicToneMapping: 4,
  BasicShadowMap: 0, PCFShadowMap: 1, PCFSoftShadowMap: 2,
  RepeatWrapping: 1000, ClampToEdgeWrapping: 1001,
  NearestFilter: 1003, LinearFilter: 1006, LinearMipmapLinearFilter: 1008,
  UnsignedByteType: 1009, RGBAFormat: 1023, LuminanceFormat: 1024,
};

function install() {
  global.THREE = new Proxy(REAL, { get: (t, k) => (k in t ? t[k] : anything) });
  // 画像:src を入れるとすぐ読めたことにする(航空写真のタイルは URL を残す。検査は読み込みの順と枠を見る)
  global.Image = class { constructor() { this.onload = null; this._src = ''; } set src(v) { this._src = v; if (this.onload) this.onload(); } get src() { return this._src; } };
  global.document = new Proxy({}, {
    get: (t, k) => {
      if (k === 'getElementById' || k === 'querySelector') return () => anything;
      if (k === 'createElement') return () => ({
        getContext: () => anything, appendChild: () => {}, style: {},
        classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, width: 0, height: 0,
      });
      if (k === 'addEventListener') return () => {};
      return anything;
    },
  });
  global.window = global;
  global.navigator = { userAgent: 'node', maxTouchPoints: 0 };
  global.screen = { width: 1920, height: 1080, orientation: { lock: () => Promise.resolve() } };
  global.performance = { now: () => 0 };
  global.devicePixelRatio = 1; global.innerWidth = 1920; global.innerHeight = 1080;
  global.requestAnimationFrame = () => 0; global.addEventListener = () => {};
  global.localStorage = anything;
}

/**
 * HTMLのスクリプトをスタブ環境で実行し、指定した識別子を取り出す。
 *   htmlPath   … HTMLのパス
 *   exportExpr … "K8:K8,STA:STA" のようなオブジェクトリテラルの中身
 * 実行に失敗したらメッセージを出してプロセスを終了する。
 */
module.exports = function runHtml(htmlPath, exportExpr) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) { console.error('NO_SCRIPT'); process.exit(1); }
  install();
  // 別ファイルの沿線の建物データ(<script src="plateau_bldg.js">)。HTML と同じ場所にあれば先に読む
  for (const nm of ['plateau_bldg.js', 'plateau_land.js', 'plateau_tex.js', 'plateau_dem.js', 'gsi_rail.js']) {
    const pl = nodePath.join(nodePath.dirname(htmlPath), nm);
    if (html.includes('<script src="' + nm + '">') && fs.existsSync(pl)) (0, eval)(fs.readFileSync(pl, 'utf8'));
  }
  try {
    // eval に export 文を継ぎ足す:同一スコープなので const/let で宣言された値も取り出せる
    eval(m[1] + '\n;globalThis.__X={' + exportExpr + '};');
  } catch (e) {
    console.error('RUNTIME_ERROR: ' + e.constructor.name + ' ' + e.message);
    console.error(e.stack.split('\n').slice(0, 5).join('\n'));
    process.exit(1);
  }
  const X = globalThis.__X;
  X.__html = html;
  return X;
};
