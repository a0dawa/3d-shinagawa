// 材質を Lambert から Standard へ移すときの metalness / roughness /
// envMapIntensity を「数値で」決めるための道具。
//
//   Standard にすると、
//     ・拡散が (1-metalness) 倍になる  → 塗色(赤帯・青帯)が沈む
//     ・環境マップの拡散成分が足される  → 逆に持ち上がる
//   の両方が起きる。描画を見られないので、空のグラデーション(HTMLと同じ式)から
//   環境光を積分して、帯の見え方が変わらない組み合わせを探す。
//
//   使い方: node tools/tune_material.js
//   ※ TONE_EXPO・光源・空の色を変えたら引き直すこと
const s2l = v => (v <= 0.04045) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => (v <= 0.0031308) ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const hex = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const IN = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
const mul = (M, c) => [0, 1, 2].map(i => M[0][i] * c[0] + M[1][i] * c[1] + M[2][i] * c[2]);
const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const aces = (c, e) => { let x = c.map(v => v * e / 0.6); x = mul(IN, x).map(fit); return mul(OUT, x).map(v => Math.min(1, Math.max(0, v))); };
const EXPO = 1.18;
const show = c => aces(c, EXPO).map(l2s);                       // リニア → 画面上の値
const px = c => c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
const dE = (a, b) => Math.max(...[0, 1, 2].map(i => Math.abs(a[i] - b[i])));   // 表示値の差[/255]

/* ---- 光源(HTMLと同じ) ---- */
const SKY_L = hex(0xe4ecf4).map(s2l), GND_L = hex(0x8a8d90).map(s2l), IH = 0.82;
const SUN_C = hex(0xfff4e0).map(s2l), ID = 0.72;
const L = (() => { const d = [2400, 3200, 1600], n = Math.hypot(...d); return d.map(v => v / n); })();
/* ---- 空(HTMLの skyTexture と同じ式) ---- */
const SKY = { TOP: hex(0x71a7ff), HOR: hex(0xc2f3ff), BOT: hex(0xadc0cd), SUN: hex(0xfffabf) };
function skyRadiance(d) {                       // 向き d の空の色(リニア)
  const cy = d[1], t = (cy >= 0) ? Math.pow(cy, 0.55) : Math.pow(-cy, 0.75);
  const a = (cy >= 0) ? SKY.TOP : SKY.BOT;
  const g = Math.pow(Math.max(0, d[0] * L[0] + d[1] * L[1] + d[2] * L[2]), 7) * 0.85;
  return [0, 1, 2].map(k => {
    const base = SKY.HOR[k] + (a[k] - SKY.HOR[k]) * t;
    return s2l(Math.min(1, base + (SKY.SUN[k] - base) * g));
  });
}
// 法線 N まわりの、余弦重み付き平均の空の輝き(= 拡散の環境光)
function envDiffuse(N) {
  const acc = [0, 0, 0]; let w = 0;
  for (let i = 0; i < 4000; i++) {              // 半球を一様サンプリング
    const u = Math.random(), v = Math.random();
    const th = Math.acos(1 - u), ph = 2 * Math.PI * v;
    let d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    // N を +Y とみなした局所系から世界へ(N が +Y でない場合は簡易に回転)
    if (N[1] < 0.999) {
      const ax = [-N[2], 0, N[0]], al = Math.hypot(ax[0], ax[2]) || 1;
      const a = [ax[0] / al, 0, ax[2] / al], c = N[1], s = Math.sqrt(1 - c * c);
      const dr = [
        d[0] * (c + a[0] * a[0] * (1 - c)) + d[1] * (a[2] * s) + d[2] * (a[0] * a[2] * (1 - c)),
        d[0] * (-a[2] * s) + d[1] * c + d[2] * (a[0] * s),
        d[0] * (a[0] * a[2] * (1 - c)) + d[1] * (-a[0] * s) + d[2] * (c + a[2] * a[2] * (1 - c))];
      d = dr;
    }
    const nd = Math.max(0, d[0] * N[0] + d[1] * N[1] + d[2] * N[2]);
    if (nd <= 0) continue;
    const r = skyRadiance(d);
    for (let k = 0; k < 3; k++) acc[k] += r[k] * nd;
    w += nd;
  }
  return acc.map(v => v / (w || 1));
}
function lightAt(N) {                            // 直接光(半球光+平行光)
  const t = 0.5 + 0.5 * N[1], dl = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
  return [0, 1, 2].map(k => (GND_L[k] * (1 - t) + SKY_L[k] * t) * IH + SUN_C[k] * ID * dl);
}
const lambert = (c, N) => { const li = lightAt(N); return c.map((v, k) => v * li[k]); };
function standard(c, N, m, rough, envI) {
  const li = lightAt(N), ed = envDiffuse(N);
  // 鏡面:視線を法線方向とみなした近似(split-sum の A/B は粗さから概算)
  const A = 1 - rough * 0.75, B = 0.04 * (1 - rough);
  const spec = skyRadiance(N);                   // 反射先の空(上向き面なら天頂側)
  return c.map((v, k) => {
    const F0 = 0.04 * (1 - m) + c[k] * m;
    return v * (1 - m) * (li[k] + envI * ed[k]) + (F0 * A + B) * spec[k] * envI;
  });
}

const N_UP = [0, 1, 0], N_SIDE = (() => { const v = [0.85, 0.05, 0.53], n = Math.hypot(...v); return v.map(x => x / n); })();
const BODY = [['京王レッド', [0.776, 0, 0.322]], ['京王ブルー', [0, 0.2, 0.627]],
['ステンレス地', [0.66, 0.69, 0.72]], ['アイボリー', [0.941, 0.937, 0.918]]];

/* Phong は拡散が Lambert と同一で、環境マップは "混ぜる" だけ(拡散の環境光を
   足さない)。車体のように塗色を守りたい面はこちらが向く。
   出力 = mix(拡散, 環境色, reflectivity) + 鏡面ハイライト
   (ハイライトは狭い範囲にしか出ないのでここでは面の平均には数えない) */
function phong(c, N, refl) {
  const li = lightAt(N), env = skyRadiance(N);
  return c.map((v, k) => (v * li[k]) * (1 - refl) + env[k] * refl);
}

console.log('■ 車体:Standard は環境光の拡散が足されて帯が持ち上がる');
console.log('metal envI  ' + BODY.map(b => b[0].padEnd(12)).join('') + '最大差[/255]');
for (const m of [0.10, 0.20, 0.30]) {
  for (const envI of [0.3, 0.6, 1.0]) {
    let worst = 0; const cols = [];
    for (const [, c0] of BODY) {
      const c = c0.map(s2l);
      const a = px(show(lambert(c, N_SIDE))), b = px(show(standard(c, N_SIDE, m, 0.38, envI)));
      worst = Math.max(worst, dE(a, b)); cols.push(b.join(',').padEnd(12));
    }
    console.log(String(m).padEnd(6) + String(envI).padEnd(5) + ' ' + cols.join('') + worst.toFixed(0));
  }
}

console.log('\n■ 車体:Phong なら拡散はそのまま。環境の映り込みだけを弱く混ぜる');
console.log('refl  ' + BODY.map(b => b[0].padEnd(12)).join('') + '最大差[/255]');
let bestP = null;
for (const refl of [0.00, 0.03, 0.05, 0.07, 0.10]) {
  let worst = 0; const cols = [];
  for (const [, c0] of BODY) {
    const c = c0.map(s2l);
    const a = px(show(lambert(c, N_SIDE))), b = px(show(phong(c, N_SIDE, refl)));
    worst = Math.max(worst, dE(a, b)); cols.push(b.join(',').padEnd(12));
  }
  console.log(String(refl).padEnd(6) + cols.join('') + worst.toFixed(0));
  if (refl > 0 && worst <= 8 && (!bestP || refl > bestP.refl)) bestP = { refl, worst };
}
console.log('\n→ 帯の変化を8/255以内に抑えつつ映り込みを最大にできるのは reflectivity=' +
  (bestP ? bestP.refl + ' (最大差 ' + bestP.worst.toFixed(0) + '/255)' : 'なし'));

console.log('\n■ レール(上向き・金属):光るのが狙いなので差が出てよい');
for (const [m, r] of [[0.85, 0.30], [0.9, 0.22], [0.7, 0.35]]) {
  const c = hex(0xe6e9ee).map(s2l);
  const a = px(show(lambert(c, N_UP))), b = px(show(standard(c, N_UP, m, r, 1.0)));
  console.log('  metal=' + m + ' rough=' + r + '  ' + a.join(',') + ' → ' + b.join(',') +
    '  差 ' + dE(a, b).toFixed(0));
}
