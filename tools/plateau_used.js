// ビューアが実際に描く PLATEAU の LOD2 の建物の一覧(足跡の1点目 x,z と高さ)を JSON で出す。
// tools/plateau_tex.py --used に渡すと、描かれない建物(事業区間の帯の外・高架下や交差道路などの占有域に掛かる建物)の
// 写真を詰めない(plateau_tex.js が約2割軽くなる)。建物の並びの判定はビューアそのもの(スタブで実行)。
//   node tools/plateau_used.js keio_elevated_3d.html > used.json
const path = process.argv[2] || 'keio_elevated_3d.html';
const X = require('./stub_three')(path, 'CITY:CITY');
const out = X.CITY.buildings.filter((e) => e.plateau && e.lod2 > 0 && e.poly).map((e) => [e.poly[0][0], e.poly[0][1], e.h]);
process.stdout.write(JSON.stringify(out) + '\n');
console.error('LOD2 の描かれる建物 ' + out.length + ' 棟');
