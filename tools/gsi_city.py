# -*- coding: utf-8 -*-
"""国土地理院のデータ(ベクトルタイル・標高タイル)を、ビューアが読む PLATEAU と同じ形式のファイルにする。

  品川版は PLATEAU(港区・品川区)を取り込めない環境で作ったので、建物・道路・水面・地形を国土地理院のデータで代用する。
  形式を PLATEAU と同じにしておけば、ビューアの PLATEAU 用の処理(建物の占有域・横切る道路に柱を立てない・
  地形に載せる・航空写真の帯)がそのまま働き、後で PLATEAU のファイルに差し替えるだけで済む。

    cd data/raw && python3 -I ../../tools/gsi_city.py --html ../../keikyu_shinagawa_3d.html --outdir ../..

  入力(作業ディレクトリ):gsi/all.json(fetch_gsi.py)・dem_grid.npy(dem.py。旧原点の局所座標 5m 格子)
  出力:
    plateau_bldg.js … globalThis.PLATEAU_BLDG(PLT1:足跡+高さ。高さは国土地理院に無いので建物の種別と面積から推定)
    plateau_land.js … globalThis.PLATEAU_LAND(PLR1:道路=中心線を幅員区分の幅でふくらませた面/PLU1:水面)
    plateau_dem.js  … globalThis.PLATEAU_DEM(10m 格子の標高 TP[m])
    gsi_rail.js     … globalThis.GSI_RAIL(京急以外の鉄道の線路の中心線・無壁舎(ホームの上屋)・線路上空の建物)
  射影はビューアと同じ(HTML の MLAT/MLON・原点=RAW.sta[0] の中心)。plateau_import.py の html_projection で読む。
  出典:国土地理院(ベクトルタイル・標高タイル)。国土地理院コンテンツ利用規約に従い出典を表示する。
"""
import argparse
import base64
import json
import math
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plateau_import import html_projection  # noqa: E402

# 取得データ(fetch_gsi.py・dem.py)の局所座標の原点と定数(取得時のもの。ビューアの原点とは別)
RAW_LAT0, RAW_LON0 = 35.6280, 139.7395
RAW_MLAT, RAW_MLON = 110940.0, 111320.0 * math.cos(math.radians(35.6280))
SOURCE = '国土地理院 ベクトルタイル・標高タイル(建物の高さは推定)'


def dp(pts, tol):
    """Douglas-Peucker(端点保持)"""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    L = math.hypot(*ab)
    best, bi = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i])
        d = abs(ab[0] * (p - a)[1] - ab[1] * (p - a)[0]) / L if L > 1e-9 else math.hypot(*(p - a))
        if d > best:
            best, bi = d, i
    if best > tol:
        return dp(pts[:bi + 1], tol)[:-1] + dp(pts[bi:], tol)
    return [pts[0], pts[-1]]


def hash01(x, z):
    h = 2166136261
    for t in (x, z):
        h = ((h ^ (int(t * 10) & 0xffffffff)) * 16777619) & 0xffffffff
    return (h % 10007) / 10007.0


def enc_poly_items(magic, items, head):
    """PLR1/PLU1 の並び:{種別 uint8・区間 uint8・頂点数 uint16・1点目 int32×2・差分 int16×2}(0.1m)"""
    b = bytearray(magic) + struct.pack('<I', len(items))
    for it in items:
        k, sec, P = head(it)
        q = [(int(round(x * 10)), int(round(z * 10))) for x, z in P]
        b += struct.pack('<BBH', k, sec, len(q)) + struct.pack('<ii', *q[0])
        for (x0, z0), (x1, z1) in zip(q, q[1:]):
            b += struct.pack('<hh', max(-32768, min(32767, x1 - x0)), max(-32768, min(32767, z1 - z0)))
    return bytes(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--band', type=float, default=650, help='線路(駅を結ぶ折れ線)から取り込む範囲[m]')
    a = ap.parse_args()
    mlat, mlon, lat0, lon0, pts = html_projection(a.html)
    W = lambda la, lo: ((lo - lon0) * mlon, -(la - lat0) * mlat)        # 緯度経度 → ワールド(X=東・Z=南)
    d = json.load(open('gsi/all.json'))
    # 帯:駅を結ぶ折れ線(両端を band 延ばす)からの距離
    P = [W(*q) for q in pts]

    def ext(p, q, L):
        dx, dz = p[0] - q[0], p[1] - q[1]
        n = math.hypot(dx, dz) or 1
        return (p[0] + dx / n * L, p[1] + dz / n * L)
    P = [ext(P[0], P[1], a.band)] + P + [ext(P[-1], P[-2], a.band)]

    def dist_line(x, z):
        best = 1e18
        for (ax, az), (bx, bz) in zip(P, P[1:]):
            dx, dz = bx - ax, bz - az
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
            best = min(best, math.hypot(x - ax - dx * t, z - az - dz * t))
        return best
    inband = lambda q: dist_line(*q) < a.band
    # 京急の現況線(rtCode 40202000122 の 25000 レベルと、近い 2500 レベルの線)を JR 等から除くための中心線
    cen = json.load(open('center_ref.json'))                         # 旧原点の局所 (x, y北)
    toll = lambda x, y: (RAW_LAT0 + y / RAW_MLAT, RAW_LON0 + x / RAW_MLON)
    CEN = np.array([W(*toll(x, y)) for x, y in cen])
    CS = np.r_[0, np.cumsum(np.hypot(*np.diff(CEN, axis=0).T))]

    def keikyu(p, t):
        dv = CEN - np.array(p)
        i = int(np.argmin(np.hypot(dv[:, 0], dv[:, 1])))
        j0, j1 = max(0, i - 1), min(len(CEN) - 1, i + 1)
        u = CEN[j1] - CEN[j0]
        u = u / (np.hypot(*u) + 1e-9)
        dist = float(np.hypot(*(CEN[i] - np.array(p))))
        par = abs(float(u @ t)) > math.cos(math.radians(25))
        return (dist < 13.0 and par) or (1705 <= CS[i] <= 2150 and dist < 16.0)

    def lines_of(f):
        return [f['c']] if f['t'] == 'LineString' else (f['c'] if f['t'] == 'MultiLineString' else [])

    # ---------- 鉄道(京急以外) ----------
    rails = []
    for f in d['railway']:
        p = f['p']
        if p.get('orgGILvl') != '2500' or p['ftCode'] in (2804, 2814, 2844):
            continue
        for l in lines_of(f):
            q = [W(*c) for c in l]
            if not any(inband(t) for t in q):
                continue
            seg = [q[0]]
            for s0, s1 in zip(q, q[1:]):
                v = np.array(s1) - np.array(s0)
                lv = math.hypot(*v)
                m = ((s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2)
                if lv > 1e-6 and keikyu(m, v / lv):
                    if len(seg) >= 2:
                        rails.append(seg)
                    seg = [s1]
                else:
                    seg.append(s1)
            if len(seg) >= 2:
                rails.append(seg)
    rails = [dp(s, 0.25) for s in rails]
    RP = np.array([p for s in rails for p in s])                    # 線路の点(線路上空の建物の判定)

    def in_poly(x, z, R):
        c = False
        for i in range(len(R)):
            ax, az = R[i]
            bx, bz = R[i - 1]
            if (az > z) != (bz > z) and x < (bx - ax) * (z - az) / (bz - az) + ax:
                c = not c
        return c

    # ---------- 建物 ----------
    blds, roofs, decks = [], [], []
    for f in d['building']:
        if f['t'] not in ('Polygon', 'MultiPolygon'):
            continue
        code = f['p']['ftCode']
        for pg in ([f['c']] if f['t'] == 'Polygon' else f['c']):
            R = [W(*c) for c in pg[0]]
            if len(R) < 4 or not all(inband(t) for t in R):
                continue
            R = dp(R[:-1] + [R[0]], 0.4)[:-1]
            if len(R) < 3:
                continue
            A = np.array(R)
            area = 0.5 * abs(np.dot(A[:, 0], np.roll(A[:, 1], 1)) - np.dot(A[:, 1], np.roll(A[:, 0], 1)))
            if area < 15:
                continue
            cx, cz = A.mean(axis=0)
            r = hash01(cx, cz)
            if code == 3111:                                          # 無壁舎(ホームの上屋・車庫):薄い屋根で別に描く
                roofs.append(R)
                continue
            # 高さ(推定):高層=55〜150m、堅ろう=10〜56m、普通=5.5〜10.5m。面積が大きいほど高い
            if code == 3103:
                h, use = 55 + min(95, area / 60) * (0.6 + 0.4 * r), 4
            elif code == 3102:
                h, use = 10 + min(40, area / 90) * (0.5 + 0.5 * r) + 6 * r, (3 if r < 0.5 else 4)
            else:
                h, use = 5.5 + 5 * r, 1
            x0, x1, z0, z1 = A[:, 0].min(), A[:, 0].max(), A[:, 1].min(), A[:, 1].max()
            near = RP[(RP[:, 0] > x0) & (RP[:, 0] < x1) & (RP[:, 1] > z0) & (RP[:, 1] < z1)] if len(RP) else []
            over = sum(1 for p in near if in_poly(p[0], p[1], R))
            if over >= 4:                                             # 線路の上の建物(駅の自由通路・駅ビル):人工地盤
                decks.append([R, min(10.0, h)])
                continue
            blds.append((R, h, max(1, round(h / 3.3)), use))
    # PLT1(plateau_import.py の encode と同じ並び)
    bb = bytearray(b'PLT1') + struct.pack('<I', len(blds))
    for R, h, st, _ in blds:
        q = [(int(round(x * 10)), int(round(z * 10))) for x, z in R]
        bb += struct.pack('<BHB', len(q), min(65535, int(round(h * 10))), min(255, st)) + struct.pack('<ii', *q[0])
        for (x0_, z0_), (x1_, z1_) in zip(q, q[1:]):
            bb += struct.pack('<hh', x1_ - x0_, z1_ - z0_)
    l2 = b'PL2A' + struct.pack('<I', 0)
    meta = {'source': SOURCE, 'license': '国土地理院コンテンツ利用規約', 'files': ['gsi/experimental_bvmap z16'],
            'count': len(blds), 'b64': base64.b64encode(bytes(bb)).decode(), 'lod2': 0,
            'lod2b64': base64.b64encode(l2).decode(), 'use64': base64.b64encode(bytes(b[3] for b in blds)).decode()}
    with open(os.path.join(a.outdir, 'plateau_bldg.js'), 'w', encoding='utf-8') as fo:
        fo.write('// 沿線の建物(足跡+推定の高さ)。出典:%s。tools/gsi_city.py が作る。手で直さない\n' % SOURCE)
        fo.write('globalThis.PLATEAU_BLDG=' + json.dumps(meta, ensure_ascii=False) + ';\n')

    # ---------- 道路(中心線 → 幅でふくらませた面) ----------
    W_OF = {0: 2.5, 1: 4.5, 2: 8.0, 3: 15.0, 4: 22.0}

    def ribbon(q, w):
        """折れ線を半幅 w/2 でふくらませた多角形(左を往き・右を還り)"""
        L, Rr = [], []
        for i in range(len(q)):
            p0 = q[max(0, i - 1)]
            p1 = q[min(len(q) - 1, i + 1)]
            tx, tz = p1[0] - p0[0], p1[1] - p0[1]
            n = math.hypot(tx, tz) or 1
            nx, nz = -tz / n * w / 2, tx / n * w / 2
            L.append((q[i][0] + nx, q[i][1] + nz))
            Rr.append((q[i][0] - nx, q[i][1] - nz))
        return L + Rr[::-1]

    def crosses_rail(q, w):
        """道路の折れ線が線路(京急以外)の上を通るか=橋(八ツ山橋・新八ツ山橋など)"""
        if not len(RP):
            return False
        Q = np.array(q)
        for (ax, az), (bx, bz) in zip(Q, Q[1:]):
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            if l2 < 1e-6:
                continue
            m = (RP[:, 0] > min(ax, bx) - w) & (RP[:, 0] < max(ax, bx) + w) & (RP[:, 1] > min(az, bz) - w) & (RP[:, 1] < max(az, bz) + w)
            for px, pz in RP[m]:
                t = max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
                if math.hypot(px - ax - dx * t, pz - az - dz * t) < w / 2:
                    return True
        return False
    roads = []
    for f in d['road']:
        p = f['p']
        if p.get('ftCode') != 2701:
            continue
        for l in lines_of(f):
            q = [W(*c) for c in l]
            if not any(inband(t) for t in q):
                continue
            q = dp(q, 0.3)
            w = float(p.get('Width') or W_OF.get(p.get('rnkWidth', 1), 4.5))
            k = 2 if p.get('rdCtg') == 3 else (1 if (p.get('rdCtg') in (0, 1) or w >= 13) else 0)
            # 長い道路は 60m ごとに分ける(橋の判定と面の大きさのため)
            seg, acc = [q[0]], 0.0
            parts = []
            for s0, s1 in zip(q, q[1:]):
                seg.append(s1)
                acc += math.hypot(s1[0] - s0[0], s1[1] - s0[1])
                if acc > 60:
                    parts.append(seg)
                    seg, acc = [s1], 0.0
            if len(seg) >= 2:
                parts.append(seg)
            for sq in parts:
                sec = 2 if crosses_rail(sq, w) else 1
                roads.append((k, sec, ribbon(sq, w)))
    waters = []
    for f in d['waterarea']:
        if f['p'].get('orgGILvl') != '2500' or f['t'] != 'Polygon':
            continue
        R = [W(*c) for c in f['c'][0]]
        if any(inband(t) for t in R):
            waters.append((3, 0, dp(R, 0.5)[:-1]))
    land = {'source': SOURCE, 'license': '国土地理院コンテンツ利用規約', 'roads': len(roads),
            'road64': base64.b64encode(enc_poly_items(b'PLR1', roads, lambda it: it)).decode(),
            'lands': len(waters), 'land64': base64.b64encode(enc_poly_items(b'PLU1', waters, lambda it: it)).decode()}
    with open(os.path.join(a.outdir, 'plateau_land.js'), 'w', encoding='utf-8') as fo:
        fo.write('// 沿線の道路(中心線を幅員区分の幅でふくらませた面)・水面。出典:%s。tools/gsi_city.py が作る。手で直さない\n' % SOURCE)
        fo.write('globalThis.PLATEAU_LAND=' + json.dumps(land, ensure_ascii=False) + ';\n')

    # ---------- 地形(10m 格子・TP) ----------
    H = np.load('dem_grid.npy')                                      # 旧原点の局所 (x, y北)・5m・X0=-800, Y0=-1800
    GX0, GY0, GST = -800.0, -1800.0, 5.0
    allx = [p[0] for p in P]
    allz = [p[1] for p in P]
    DX = 10.0
    x0 = math.floor((min(allx) - a.band) / DX) * DX
    z0 = math.floor((min(allz) - a.band) / DX) * DX
    nx = int(math.ceil((max(allx) + a.band - x0) / DX))
    nz = int(math.ceil((max(allz) + a.band - z0) / DX))
    G = np.full((nz, nx), np.nan)
    for j in range(nz):
        for i in range(nx):
            x, z = x0 + (i + 0.5) * DX, z0 + (j + 0.5) * DX
            if dist_line(x, z) > a.band:
                continue
            la, lo = lat0 - z / mlat, lon0 + x / mlon
            xo, yo = (lo - RAW_LON0) * RAW_MLON, (la - RAW_LAT0) * RAW_MLAT
            fi, fj = (xo - GX0) / GST, (yo - GY0) / GST
            ii, jj = int(fi), int(fj)
            if ii < 0 or jj < 0 or ii + 1 >= H.shape[1] or jj + 1 >= H.shape[0]:
                continue
            tx, ty = fi - ii, fj - jj
            v = (H[jj, ii] * (1 - tx) + H[jj, ii + 1] * tx) * (1 - ty) + (H[jj + 1, ii] * (1 - tx) + H[jj + 1, ii + 1] * tx) * ty
            G[j, i] = v if v == v else 0.6                            # 欠測(水面)は水面の高さ
    h0, q = math.floor(np.nanmin(G)), 0.01
    rows, out = [], bytearray()
    for j in range(nz):
        idx = np.where(~np.isnan(G[j]))[0]
        if len(idx) == 0:
            rows += [0, 0]
            continue
        i0, i1 = int(idx[0]), int(idx[-1]) + 1
        rows += [i0, i1 - i0]
        for i in range(i0, i1):
            v = G[j, i]
            out += struct.pack('<H', 65535 if v != v else int(round((v - h0) / q)))
    dem = {'source': SOURCE, 'license': '国土地理院コンテンツ利用規約', 'x0': x0, 'z0': z0, 'dx': DX, 'nx': nx, 'nz': nz,
           'h0': h0, 'q': q, 'r64': base64.b64encode(np.array(rows, '<u2').tobytes()).decode(),
           'h64': base64.b64encode(bytes(out)).decode()}
    with open(os.path.join(a.outdir, 'plateau_dem.js'), 'w', encoding='utf-8') as fo:
        fo.write('// 沿線の地形(10m 格子の標高 TP)。出典:国土地理院 標高タイル(DEM5A)。tools/gsi_city.py が作る。手で直さない\n')
        fo.write('globalThis.PLATEAU_DEM=' + json.dumps(dem, ensure_ascii=False) + ';\n')

    # ---------- 京急以外の鉄道・上屋・線路上空の建物 ----------
    rnd = lambda L: [[round(x, 2), round(z, 2)] for x, z in L]
    gr = {'source': '国土地理院 ベクトルタイル(鉄道・建物)', 'rails': [rnd(s) for s in rails],
          'roofs': [rnd(R) for R in roofs], 'decks': [[rnd(R), round(h, 1)] for R, h in decks]}
    with open(os.path.join(a.outdir, 'gsi_rail.js'), 'w', encoding='utf-8') as fo:
        fo.write('// 京急以外の鉄道の線路の中心線・無壁舎(ホームの上屋)・線路上空の建物。出典:国土地理院 ベクトルタイル。tools/gsi_city.py が作る\n')
        fo.write('globalThis.GSI_RAIL=' + json.dumps(gr, separators=(',', ':')) + ';\n')
    print('bldg', len(blds), 'roofs', len(roofs), 'decks', len(decks), 'roads', len(roads), 'water', len(waters),
          'rails', len(rails), 'dem', nx, 'x', nz)


if __name__ == '__main__':
    main()
