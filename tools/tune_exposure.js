// トーンマッピングの露出を「数値で」決めるための道具。
//
//   AIは自分が生成した描画を見られないので、露出を目分量で決められない。
//   そこで three.js r128 のシェーダ(ACESFilmicToneMapping)と Lambert の
//   照明式をそのまま移植し、「色管理を入れる前と後で代表的な面の表示輝度が
//   どれだけ変わるか」を計算して、中間調が保たれる露出を解く。
//
//   ・変更前に白飛びしている面は、その表示値自体が本来の色ではないので
//     合わせる対象から外す(合わせると白飛びを再現してしまう)
//   ・結果は keio_elevated_3d.html の TONE_EXPO に手で反映する
//
//   使い方: node tools/tune_exposure.js
//   ※ 光源の設定・代表面の色を変えたら、この表も合わせて更新すること
const s2l = v => (v <= 0.04045) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => (v <= 0.0031308) ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const hex = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// r128 tonemapping_pars_fragment.glsl.js の ACESFilmicToneMapping をそのまま移植
const IN = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const OUT = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
const mul = (M, c) => [0, 1, 2].map(i => M[0][i] * c[0] + M[1][i] * c[1] + M[2][i] * c[2]);
const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
function aces(c, expo) {
  let x = c.map(v => v * expo / 0.6);
  x = mul(IN, x).map(fit);
  return mul(OUT, x).map(v => Math.min(1, Math.max(0, v)));
}

// 光源(現状の設定)
const SKY = hex(0xe4ecf4), GND = hex(0x8a8d90), IH = 0.82;
const SUN = hex(0xfff4e0), ID = 0.72;
const L = (() => { const d = [2400, 3200, 1600], n = Math.hypot(...d); return d.map(v => v / n); })();

// 面の代表:上向き(地表・桁・ホーム)と側面(車体・建物)
const NORM = { up: [0, 1, 0], side: [0.85, 0, 0.53] };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function shade(albedo, N, lin) {
  const f = lin ? s2l : (v => v);
  const t = 0.5 + 0.5 * dot(N, [0, 1, 0]);
  const dl = Math.max(0, dot(N, L));
  return [0, 1, 2].map(i => {
    const hemi = (f(GND[i]) * (1 - t) + f(SKY[i]) * t) * IH;
    const dir = f(SUN[i]) * ID * dl;
    return f(albedo[i]) * (hemi + dir);
  });
}
// 変更前:sRGB値のまま計算し、そのまま出力(クランプのみ)
const before = (a, N) => shade(a, N, false).map(v => Math.min(1, Math.max(0, v)));
// 変更後:リニアで計算 → ACES → sRGBで出力
const after = (a, N, e) => aces(shade(a, N, true), e).map(l2s);

const SURF = [
  ['地表', hex(0xb9d0a2), 'up'], ['高架桁', hex(0xc9cdd2), 'up'], ['桁側面', hex(0xc9cdd2), 'side'],
  ['ホーム', hex(0xc7c8c3), 'up'], ['上屋', hex(0xdfdfd8), 'up'], ['スラブ', hex(0x686d74), 'up'],
  ['レール', hex(0xe6e9ee), 'up'], ['橋脚', hex(0xbfc3c8), 'side'],
  ['車体ステンレス', [0.66, 0.69, 0.72], 'side'], ['京王レッド', [0.776, 0.0, 0.322], 'side'],
  ['京王ブルー', [0.0, 0.2, 0.627], 'side'], ['屋根', [0.57, 0.6, 0.63], 'side'],
  ['建物A', hex(0xd8d2c6), 'side'], ['建物B', hex(0xbfb8ab), 'side'], ['樹木', hex(0x7fa268), 'side'],
];
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/* 変更前に飽和している面(どれかの成分が255に張り付いている)は、その表示値自体が
   本来の色ではない。合わせる対象から外し、中間調だけで露出を決める。 */
const clipped = c => c.some(v => v >= 0.99);
const FIT = SURF.filter(([, a, n]) => !clipped(before(a, NORM[n])));
console.log('変更前に白飛びしている面:', SURF.length - FIT.length, '/', SURF.length,
  '→', SURF.filter(([, a, n]) => clipped(before(a, NORM[n]))).map(r => r[0]).join(' '));
let best = null;
for (let e = 0.60; e <= 2.60; e += 0.005) {
  let se = 0;
  for (const [, a, n] of FIT) se += Math.pow(lum(after(a, NORM[n], e)) - lum(before(a, NORM[n])), 2);
  const rms = Math.sqrt(se / FIT.length);
  if (!best || rms < best.rms) best = { e: e, rms: rms };
}
console.log('最適な露出 =', best.e.toFixed(3), ' 中間調の輝度RMS差 =', best.rms.toFixed(4));
console.log('変更後に白飛びする面:',
  SURF.filter(([, a, n]) => clipped(after(a, NORM[n], best.e))).length, '/', SURF.length, '\n');
console.log('面'.padEnd(16) + '変更前'.padEnd(20) + '変更後'.padEnd(20) + '輝度差');
for (const [nm, a, n] of SURF) {
  const b = before(a, NORM[n]), f = after(a, NORM[n], best.e);
  const p = c => c.map(v => Math.round(v * 255)).join(',').padEnd(16);
  console.log(nm.padEnd(14) + p(b) + '  ' + p(f) + '  ' + (lum(f) - lum(b) >= 0 ? '+' : '') + (lum(f) - lum(b)).toFixed(3));
}
