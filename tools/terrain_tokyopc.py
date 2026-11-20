# -*- coding: utf-8 -*-
"""東京都デジタルツイン実現プロジェクト 区部点群データの「グリッドデータDEM(0.5m)」で、plateau_dem.js の標高を作り直す(2026-11-20)。

  データ:G空間情報センター tokyopc-23ku-2024(CC BY 4.0。東京都)。1/500 図郭の ZIP の GeoTIFF(float32・0.5m・EPSG:6677・T.P.。
  建物・樹木を除いた地盤で、建物の下・橋の下は内挿)。図郭は索引 https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2024/dig/Vectortile/23ku/grd50/{z}/{x}/{y}.pbf
  (z10 の 1 枚に全部ある)の属性 MESH_NO・URL で引く。外部のデータなので GeoTIFF は空のフォルダへ展開して渡す(画素を読むだけ)。

  使い方:python3 -I tools/terrain_tokyopc.py --html keikyu_shinagawa_3d.html --base plateau_dem.js --out plateau_dem.js <GeoTIFF…>
    ・格子は --base(国土地理院 DEM5A の 10m 格子。tools/gsi_city.py が作る)と同じ。各点は周りの 10m 四方(20×20 画素)の平均
    ・**水面**(--base で値が 0.6 ちょうどの点=DEM5A の欠測=水面)は 0.6 のまま(0.5m の DEM は水の上を内挿した地盤を持つので、水面を浮かせない)
    ・図郭の外(欠け)は --base の値のまま
  出力は --base と同じ形式(x0・z0・dx・nx・nz・h0・q・r64・h64)で、source を書き換える。
"""
import argparse, base64, json, re, sys
import numpy as np, tifffile
from pyproj import Transformer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', required=True)
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('tif', nargs='+')
    a = ap.parse_args()
    h = open(a.html, encoding='utf-8').read()
    sta = re.search(r"sta:\[\s*\['新馬場'[^\]]*?0x[0-9a-f]+,\d,\s*([\d.]+),([\d.]+),\s*([\d.]+),([\d.]+)\]", h)
    la0, lo0, la1, lo1 = [float(x) for x in sta.groups()]
    LAT0, LON0 = (la0 + la1) / 2, (lo0 + lo1) / 2
    mm = re.search(r'const MLAT=(\d+),MLON=(\d+)', h); MLAT, MLON = float(mm.group(1)), float(mm.group(2))
    js = open(a.base, encoding='utf-8').read()
    D = json.loads(js[js.index('{'):js.rindex('}') + 1])
    nx, nz, dx, x0, z0, h0, q = D['nx'], D['nz'], D['dx'], D['x0'], D['z0'], D['h0'], D['q']
    rows = np.frombuffer(base64.b64decode(D['r64']), '<u2').reshape(-1, 2)
    hv = np.frombuffer(base64.b64decode(D['h64']), '<u2')
    G = np.full((nz, nx), np.nan); k = 0
    for j in range(nz):
        i0, n = rows[j]
        for i in range(n):
            G[j, i0 + i] = np.nan if hv[k] == 65535 else h0 + hv[k] * q; k += 1
    tiles = []
    for f in a.tif:
        p = tifffile.TiffFile(f).pages[0]; tg = {g.name: g.value for g in p.tags.values()}
        sc, tp = tg['ModelPixelScaleTag'], tg['ModelTiepointTag']
        if abs(sc[0] - .5) > 1e-6 or 6677 not in tg.get('GeoKeyDirectoryTag', ()): sys.exit('0.5m・EPSG:6677 ではない: ' + f)
        arr = p.asarray().astype(np.float32); arr[arr < -1000] = np.nan; tiles.append((tp[3], tp[4], arr))
    e0 = min(t[0] for t in tiles); n1 = max(t[1] for t in tiles)
    e1 = max(t[0] + t[2].shape[1] * .5 for t in tiles); n0 = min(t[1] - t[2].shape[0] * .5 for t in tiles)
    W, H = int(round((e1 - e0) / .5)), int(round((n1 - n0) / .5)); M = np.full((H, W), np.nan, np.float32)
    for te, tn, arr in tiles:
        c, r = int(round((te - e0) / .5)), int(round((n1 - tn) / .5)); M[r:r + arr.shape[0], c:c + arr.shape[1]] = arr
    kk = int(round(dx / .5)); V = np.nan_to_num(M).astype(np.float64); C = (~np.isnan(M)).astype(np.float64)
    S = np.pad(V.cumsum(0).cumsum(1), ((1, 0), (1, 0))); N = np.pad(C.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    tr = Transformer.from_crs('EPSG:6668', 'EPSG:6677')
    X, Z = np.meshgrid(x0 + (np.arange(nx) + .5) * dx, z0 + (np.arange(nz) + .5) * dx)
    nn, ee = tr.transform(LAT0 - Z / MLAT, LON0 + X / MLON)
    c = np.round((ee - e0) / .5).astype(int); r = np.round((n1 - nn) / .5).astype(int)
    r0 = np.clip(r - kk // 2, 0, H); r1 = np.clip(r0 + kk, 0, H); c0 = np.clip(c - kk // 2, 0, W); c1 = np.clip(c0 + kk, 0, W)
    tot = S[r1, c1] - S[r0, c1] - S[r1, c0] + S[r0, c0]; cnt = N[r1, c1] - N[r0, c1] - N[r1, c0] + N[r0, c0]
    T = np.where(cnt >= 0.5 * kk * kk, tot / np.maximum(cnt, 1), np.nan)
    water = np.isfinite(G) & (np.abs(G - 0.6) < 1e-6)
    out = np.where(np.isfinite(T) & ~water, T, G)
    print('格子 %d×%d・0.5m で置き換え %d 点・水面のまま %d 点・図郭の外(5A のまま) %d 点' % (nx, nz, int((np.isfinite(T) & ~water & np.isfinite(G)).sum()), int(water.sum()), int((~np.isfinite(T) & np.isfinite(G)).sum())))
    nh0 = np.floor(np.nanmin(out)); rr, o = [], bytearray()
    for j in range(nz):
        idx = np.where(np.isfinite(G[j]))[0]
        if len(idx) == 0: rr += [0, 0]; continue
        i0, i1 = int(idx[0]), int(idx[-1]) + 1; rr += [i0, i1 - i0]
        for i in range(i0, i1): o += np.uint16(round((out[j, i] - nh0) / 0.01)).tobytes()
    D.update({'source': '東京都デジタルツイン実現プロジェクト 区部点群データ グリッドデータDEM(0.5m。水面は国土地理院 DEM5A の欠測の高さ)', 'license': 'CC BY 4.0(東京都)・国土地理院コンテンツ利用規約',
              'h0': float(nh0), 'r64': base64.b64encode(np.array(rr, '<u2').tobytes()).decode(), 'h64': base64.b64encode(bytes(o)).decode()})
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('// 沿線の地形(10m 格子の標高 TP)。出典:東京都デジタルツイン実現プロジェクト 区部点群データ(CC BY 4.0)のグリッドデータDEM(0.5m)。水面は国土地理院 DEM5A の欠測の高さ。tools/terrain_tokyopc.py が作る\n')
        f.write('globalThis.PLATEAU_DEM=' + json.dumps(D, ensure_ascii=False) + ';\n')
    print('h0=%.1f → %s' % (nh0, a.out))


if __name__ == '__main__':
    main()
