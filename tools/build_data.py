# -*- coding: utf-8 -*-
"""国土地理院データ → HTML埋め込み用の圧縮データ(GSIPACK)を生成する。

  前提(作業ディレクトリ=data/raw で実行):
    gsi/all.json      … fetch_gsi.py の出力(ベクトルタイルを緯度経度化したもの)
    dem_grid.npy      … dem.py の出力(5m格子の標高[m], 局所座標)
    center_ref.json   … extract_line.py の出力(京急 現況中心線・局所座標)
  出力:
    ../gsipack.js     … `const GSIPACK={...};` の1行JS(HTMLのマーカー間に差し込む)
    ../line.json      … 中心線などの緯度経度(RAWに転記する元データ)

  使い方: cd data/raw && python3 ../../tools/build_data.py
  局所座標: 原点 LAT0/LON0、x=東[m]、y=北[m](JS側では z=-y)。MLAT/MLON はJSと同じ定数。
"""
import base64
import json
import math
import zlib

import numpy as np

LAT0, LON0 = 35.6280, 139.7395
MLAT = 110940.0
MLON = 111320.0 * math.cos(math.radians(LAT0))
# 収録範囲(局所座標[m])。線路から東西±650m程度・泉岳寺方〜新馬場の先まで
BX0, BX1, BY0, BY1 = -700.0, 680.0, -1720.0, 880.0
Q = 0.5   # 座標の量子化[m](int16 で ±16km まで表現)


def xy(c):
    return ((c[1] - LON0) * MLON, (c[0] - LAT0) * MLAT)


def ll(x, y):
    return (round(LAT0 + y / MLAT, 7), round(LON0 + x / MLON, 7))


def inside(p, pad=0.0):
    return BX0 - pad <= p[0] <= BX1 + pad and BY0 - pad <= p[1] <= BY1 + pad


def dp_simplify(pts, tol):
    """Douglas-Peucker 簡略化(端点保持)"""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = np.hypot(*ab)
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i])
        d = abs(ab[0] * (p - a)[1] - ab[1] * (p - a)[0]) / L if L > 1e-9 else np.hypot(*(p - a))
        if d > best:
            best, bi = d, i
    if best > tol:
        return dp_simplify(pts[:bi + 1], tol)[:-1] + dp_simplify(pts[bi:], tol)
    return [pts[0], pts[-1]]


def b64(arr):
    """typed array → zlib圧縮しない素のbase64(JS側で atob→TypedArray)"""
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()


def pack_lines(lines):
    """[[(x,y),...],...] → Int16 [n, x0,y0, x1,y1, ...] の連結"""
    out = []
    for l in lines:
        out.append(len(l))
        for x, y in l:
            out.append(int(round(x / Q)))
            out.append(int(round(y / Q)))
    return np.array(out, dtype='<i2')


def hash01(*v):
    h = 2166136261
    for t in v:
        h = ((h ^ (int(t * 10) & 0xffffffff)) * 16777619) & 0xffffffff
    return (h % 10007) / 10007.0


def main():
    d = json.load(open('gsi/all.json'))
    cen = np.array(json.load(open('center_ref.json')))     # 京急 現況中心線(北→南)
    cs = np.r_[0, np.cumsum(np.hypot(*np.diff(cen, axis=0).T))]

    def keikyu_near(p, tol):
        """現況京急中心線までの距離と、そこでの接線"""
        dv = cen - p
        i = int(np.argmin(np.hypot(dv[:, 0], dv[:, 1])))
        j0, j1 = max(0, i - 1), min(len(cen) - 1, i + 1)
        t = cen[j1] - cen[j0]
        t = t / (np.hypot(*t) + 1e-9)
        return float(np.hypot(*(cen[i] - p))), t, cs[i]

    # ---------- 1. 京急中心線(RAW用・緯度経度、10m刻み) ----------
    line = [ll(*p) for p in cen]          # center_ref は10m刻み

    # ---------- 2. 鉄道(京急以外:JR在来線・新幹線・モノレール等) ----------
    rails = []
    for f in d['railway']:
        p = f['p']
        if p.get('orgGILvl') != '2500':
            continue
        if p['ftCode'] in (2804, 2814, 2844):          # トンネル区間は描かない
            continue
        ls = [f['c']] if f['t'] == 'LineString' else (f['c'] if f['t'] == 'MultiLineString' else [])
        for l in ls:
            q = [xy(c) for c in l]
            if not any(inside(t) for t in q):
                continue
            # 京急自身の線(現況)は除外:中心線から13m以内かつ平行(角度25°未満)
            keep = []
            for a, b in zip(q, q[1:]):
                m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                dist, t, s = keikyu_near(np.array(m), 9)
                v = np.array(b) - np.array(a)
                lv = np.hypot(*v)
                par = lv > 1e-6 and abs(v @ t) / lv > math.cos(math.radians(25))
                # 八ツ山の跨線橋より南〜北品川(京急だけが地上を走る区間)は角度によらず16m以内を除外
                own = 1705 <= s <= 2150 and dist < 16.0
                keep.append(not ((dist < 13.0 and par) or own))
            seg = [q[0]]
            for k, (a, b) in enumerate(zip(q, q[1:])):
                if keep[k]:
                    seg.append(b)
                else:
                    if len(seg) >= 2:
                        rails.append((p['ftCode'], seg))
                    seg = [b]
            if len(seg) >= 2:
                rails.append((p['ftCode'], seg))
    rails = [(k, dp_simplify(s, 0.25)) for k, s in rails]
    rail_kind = {2801: 0, 2802: 0, 2803: 1, 2813: 2, 2841: 0, 2843: 1}  # 0=地上 1=橋・高架 2=モノレール等
    rk = np.array([rail_kind.get(k, 0) for k, _ in rails], dtype='u1')

    # ---------- 3. 道路中心線(幅員区分つき) ----------
    roads, rw = [], []
    W_OF = {0: 2.5, 1: 4.5, 2: 8.0, 3: 15.0, 4: 22.0}       # 幅員区分→描画幅[m](区分の中央値付近)
    for f in d['road']:
        p = f['p']
        if p.get('ftCode') not in (2701,):
            continue
        ls = [f['c']] if f['t'] == 'LineString' else (f['c'] if f['t'] == 'MultiLineString' else [])
        for l in ls:
            q = [xy(c) for c in l]
            if not any(inside(t) for t in q):
                continue
            w = p.get('Width') or W_OF.get(p.get('rnkWidth', 1), 4.5)
            roads.append(dp_simplify(q, 0.3))
            rw.append(min(40, w))
    rw = np.array([int(round(w * 2)) for w in rw], dtype='u1')   # 0.5m単位

    # ---------- 4. 建物(外形+推定高さ) ----------
    blds, bh, bk = [], [], []
    for f in d['building']:
        p = f['p']
        if f['t'] not in ('Polygon', 'MultiPolygon'):
            continue
        polys = [f['c']] if f['t'] == 'Polygon' else f['c']
        for pg in polys:
            ring = [xy(c) for c in pg[0]]
            if len(ring) < 4 or not all(inside(t) for t in ring):
                continue
            ring = dp_simplify(ring[:-1] + [ring[0]], 0.4)[:-1]
            if len(ring) < 3:
                continue
            a = np.array(ring)
            area = 0.5 * abs(np.dot(a[:, 0], np.roll(a[:, 1], 1)) - np.dot(a[:, 1], np.roll(a[:, 0], 1)))
            if area < 12:
                continue
            cx, cy = a.mean(axis=0)
            r = hash01(cx, cy)
            code = p['ftCode']
            # 高さは推定(GSIに高さ情報は無い):建物種別と面積から決める
            if code == 3103:      # 高層建物
                h = 55 + min(95, area / 60) * (0.6 + 0.4 * r)
                kind = 2
            elif code == 3102:    # 堅ろう建物
                h = 10 + min(40, area / 90) * (0.5 + 0.5 * r) + 6 * r
                kind = 1
            elif code == 3111:    # 無壁舎(駅ホーム上屋・車庫等)
                h = 5.5
                kind = 3
            else:                 # 普通建物
                h = 5.5 + 5 * r
                kind = 0
            blds.append(ring)
            bh.append(min(250, int(round(h))))
            bk.append(kind)
    bh = np.array(bh, dtype='u1')
    bk = np.array(bk, dtype='u1')

    # ---------- 5. 水面 ----------
    waters = []
    for f in d['waterarea']:
        if f['p'].get('orgGILvl') != '2500' or f['t'] != 'Polygon':
            continue
        ring = [xy(c) for c in f['c'][0]]
        if not any(inside(t, 50) for t in ring):
            continue
        ring = [(min(BX1 + 60, max(BX0 - 60, x)), min(BY1 + 60, max(BY0 - 60, y))) for x, y in ring]
        waters.append(dp_simplify(ring, 0.5)[:-1])

    # ---------- 6. 標高(10m格子・デシメートル int16。欠測=-32768) ----------
    H = np.load('dem_grid.npy')
    GX0, GY0, GST = -800, -1800, 5
    xs = np.arange(BX0, BX1 + 0.1, 10.0)
    ys = np.arange(BY0, BY1 + 0.1, 10.0)
    dem = np.full((len(ys), len(xs)), -32768, dtype='<i2')
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            v = H[int(round((y - GY0) / GST)), int(round((x - GX0) / GST))]
            if not np.isnan(v):
                dem[iy, ix] = int(round(v * 10))

    pack = {
        'q': Q, 'lat0': LAT0, 'lon0': LON0,
        'dem': {'x0': BX0, 'y0': BY0, 'st': 10, 'nx': len(xs), 'ny': len(ys), 'b': b64(dem)},
        'rail': {'b': b64(pack_lines([s for _, s in rails])), 'k': b64(rk)},
        'road': {'b': b64(pack_lines(roads)), 'w': b64(rw)},
        'bld': {'b': b64(pack_lines(blds)), 'h': b64(bh), 'k': b64(bk)},
        'water': {'b': b64(pack_lines(waters))},
    }
    js = 'const GSIPACK=' + json.dumps(pack, separators=(',', ':')) + ';'
    open('../gsipack.js', 'w').write(js)
    json.dump({'line': line}, open('../line.json', 'w'))
    print('rails', len(rails), 'roads', len(roads), 'blds', len(blds), 'waters', len(waters),
          'dem', dem.shape, 'size(KB)', len(js) // 1024)


if __name__ == '__main__':
    main()
