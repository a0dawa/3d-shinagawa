# -*- coding: utf-8 -*-
"""航空写真(国土地理院 地理院タイル「全国最新写真(シームレス)」z18)の緑から、沿線の木(樹冠)の位置と半径を推定する(2026-11)。

  python3 -I tools/ortho_trees.py --html keikyu_shinagawa_3d.html --cache <タイルを置くフォルダ> --out gsi_trees.js [--band 480]

  ・帯:駅の中心を結ぶ折れ線(両端は延長)から --band [m] 以内に掛かる z18 のタイル(約124m 角・1画素 約0.49m)を読む。
    --cache に置き、あれば読み直さない(SSL_CERT_FILE で証明書の束を渡せる)
  ・緑:2G−R−B > 18 かつ G > 45。芝生と木を分けるため、明るさ (R+G+B)/3 < 125 か、5×5 の G のばらつき(標準偏差)> 7 の所だけ
    (木の樹冠は芝より暗く、葉の陰で粗い)
  ・3×3 で開いて閉じ、6m² 未満の塊を除き、距離変換(八角の近似)の極大(7×7 の窓で最大・半径 1.2m 以上)を樹冠の中心、
    その距離×1.1 を半径(上限 5m)にする。近い中心は大きい方を残す(中心の間 < max(2m, 0.7×(r1+r2)))
  ・タイルの境で樹冠が切れないよう、6×6 枚の窓を 4 枚ずつずらし、窓の真ん中の 4×4 枚に中心がある物だけ取る
  出力:globalThis.GSI_TREES={src, o:[緯度,経度], n, d:'x,z,r,…'}(原点からの東・南の 0.1m と半径 0.1m。x の順に並べ、x と z は前の木からの差)。
  ビューア(8章)が建物・道路・水面・線路の帯を避けて植える(ここでは避けない)。
  入力のタイルは外部のデータ:画像として画素を読むだけ。
"""
import argparse
import io
import math
import os
import ssl
import sys
import time
import urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from plateau_import import html_projection  # noqa: E402

Z = 18
URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/%d/%d/%d.jpg'
_CTX = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or None)


def tile_of(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def latlon_of(tx, ty):
    n = 2 ** Z
    lon = tx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    return lat, lon


def fetch(cache, x, y):
    p = os.path.join(cache, '%d_%d.jpg' % (x, y))
    if not os.path.exists(p):
        for k in range(4):
            try:
                req = urllib.request.Request(URL % (Z, x, y), headers={'User-Agent': 'shinagawa-3d-viewer-tools'})
                with urllib.request.urlopen(req, context=_CTX, timeout=60) as r:
                    b = r.read()
                open(p, 'wb').write(b)
                time.sleep(0.05)
                break
            except OSError as e:
                if getattr(e, 'code', None) == 404:
                    open(p, 'wb').write(b'')
                    break
                time.sleep(2 ** (k + 1))
    if os.path.getsize(p) == 0:
        return None
    try:
        return np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)
    except Exception:
        return None


def shift(a, dy, dx, fill):
    o = np.full_like(a, fill)
    H, W = a.shape
    ys, yd = (slice(dy, H), slice(0, H - dy)) if dy >= 0 else (slice(0, H + dy), slice(-dy, H))
    xs, xd = (slice(dx, W), slice(0, W - dx)) if dx >= 0 else (slice(0, W + dx), slice(-dx, W))
    o[ys, xs] = a[yd, xd]
    return o


def erode(m, cross):
    o = m.copy()
    for dy, dx in ([(-1, 0), (1, 0), (0, -1), (0, 1)] if cross else [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]):
        o &= shift(m, dy, dx, False)
    return o


def dilate(m):
    o = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            o |= shift(m, dy, dx, False)
    return o


def box_mean(a, r):
    """(2r+1)² の窓の平均(積分画像)"""
    c = np.pad(a.astype(np.float64), ((r + 1, r), (r + 1, r)), mode='edge').cumsum(0).cumsum(1)
    k = 2 * r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def label_small(m, min_px):
    """4近傍の塊のうち min_px 未満を消す(行ごとの走査で番号を付ける)"""
    H, W = m.shape
    lab = np.zeros((H, W), np.int32)
    parent = [0]

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    nid = 1
    for y in range(H):
        row = m[y]
        for x in np.nonzero(row)[0]:
            up = lab[y - 1, x] if y else 0
            lf = lab[y, x - 1] if x else 0
            if up and lf:
                a, b = find(up), find(lf)
                lab[y, x] = min(a, b)
                if a != b:
                    parent[max(a, b)] = min(a, b)
            elif up or lf:
                lab[y, x] = up or lf
            else:
                parent.append(nid)
                lab[y, x] = nid
                nid += 1
    roots = np.array([find(i) for i in range(nid)], np.int32)
    lab = roots[lab]
    cnt = np.bincount(lab.ravel())
    keep = cnt >= min_px
    keep[0] = False
    return keep[lab]


def detect(img, px_m):
    R, G, B = img[..., 0].astype(np.float32), img[..., 1].astype(np.float32), img[..., 2].astype(np.float32)
    exg = 2 * G - R - B
    v = (R + G + B) / 3
    sd = np.sqrt(np.maximum(box_mean(G * G, 2) - box_mean(G, 2) ** 2, 0))
    veg = (exg > 18) & (G > 45) & ((v < 125) | (sd > 7))
    veg = dilate(erode(veg, False))                   # 開く
    veg = erode(dilate(veg), False)                   # 閉じる
    veg = label_small(veg, int(6 / (px_m * px_m)))
    # 距離変換(十字と四角を交互に削る=八角の近似)
    dt = np.zeros(veg.shape, np.float32)
    cur = veg.copy()
    k = 0
    while cur.any() and k < 14:
        dt[cur] += 1
        cur = erode(cur, k % 2 == 0)
        k += 1
    # 7×7 の窓の最大(行と列に分けて)
    mx = dt.copy()
    for d in range(1, 4):
        mx = np.maximum(mx, np.maximum(shift(dt, 0, d, 0), shift(dt, 0, -d, 0)))
    mx2 = mx.copy()
    for d in range(1, 4):
        mx2 = np.maximum(mx2, np.maximum(shift(mx, d, 0, 0), shift(mx, -d, 0, 0)))
    pk = (dt >= max(2.5, 1.2 / px_m)) & (dt >= mx2)
    ys, xs = np.nonzero(pk)
    return [(float(x), float(y), float(dt[y, x]) * px_m * 1.1) for y, x in zip(ys, xs)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default='keikyu_shinagawa_3d.html')
    ap.add_argument('--cache', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--band', type=float, default=480.0)
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    mlat, mlon, lat0, lon0, pts = html_projection(a.html)
    P = [((q[1] - lon0) * mlon, -(q[0] - lat0) * mlat) for q in pts]

    def ext(p, q, L):
        dx, dz = p[0] - q[0], p[1] - q[1]
        n = math.hypot(dx, dz) or 1
        return (p[0] + dx / n * L, p[1] + dz / n * L)
    P = [ext(P[0], P[1], 600)] + P + [ext(P[-1], P[-2], 600)]

    def band_dist(x, z):
        best = 1e18
        for (ax, az), (bx, bz) in zip(P, P[1:]):
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            u = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L2)) if L2 else 0.0
            best = min(best, math.hypot(x - ax - dx * u, z - az - dz * u))
        return best
    to_world = lambda lat, lon: ((lon - lon0) * mlon, -(lat - lat0) * mlat)
    # 帯に掛かるタイル
    tiles = set()
    for (ax, az), (bx, bz) in zip(P, P[1:]):
        L = math.hypot(bx - ax, bz - az)
        for k in range(int(L / 40) + 1):
            x, z = ax + (bx - ax) * k * 40 / max(L, 1), az + (bz - az) * k * 40 / max(L, 1)
            for ox in range(-int(a.band) - 60, int(a.band) + 61, 40):
                for oz in range(-int(a.band) - 60, int(a.band) + 61, 40):
                    if math.hypot(ox, oz) > a.band + 90:
                        continue
                    lat, lon = lat0 - (z + oz) / mlat, lon0 + (x + ox) / mlon
                    tx, ty = tile_of(lat, lon)
                    tiles.add((int(tx), int(ty)))
    print('tiles', len(tiles), file=sys.stderr)
    for i, (x, y) in enumerate(sorted(tiles)):
        fetch(a.cache, x, y)
        if i % 100 == 0:
            print('  fetched', i, file=sys.stderr)
    # 6×6 枚の窓を 4 枚ずつ
    xs = [t[0] for t in tiles]
    ys = [t[1] for t in tiles]
    found = []
    lat_c = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
    px_m = 156543.03392 * math.cos(math.radians(lat_c)) / 2 ** Z
    for wx in range(min(xs) - 1, max(xs) + 1, 4):
        for wy in range(min(ys) - 1, max(ys) + 1, 4):
            core = [(wx + i, wy + j) for i in range(1, 5) for j in range(1, 5)]
            if not any(c in tiles for c in core):
                continue
            img = np.zeros((6 * 256, 6 * 256, 3), np.int16)
            have = False
            for i in range(6):
                for j in range(6):
                    if (wx + i, wy + j) not in tiles:
                        continue
                    t = fetch(a.cache, wx + i, wy + j)
                    if t is not None and t.shape[:2] == (256, 256):
                        img[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = t
                        have = True
            if not have:
                continue
            for px, py, r in detect(img, px_m):
                if not (256 <= px < 5 * 256 and 256 <= py < 5 * 256):
                    continue
                lat, lon = latlon_of(wx + px / 256, wy + py / 256)
                x, z = to_world(lat, lon)
                if band_dist(x, z) > a.band:
                    continue
                found.append((x, z, min(r, 5.0)))
    # 近い中心は大きい方を残す
    found.sort(key=lambda t: -t[2])
    G = {}
    keep = []
    for x, z, r in found:
        gx, gz = int(x // 10), int(z // 10)
        ok = True
        for i in range(gx - 1, gx + 2):
            for j in range(gz - 1, gz + 2):
                for (x2, z2, r2) in G.get((i, j), []):
                    if math.hypot(x - x2, z - z2) < max(2.0, 0.7 * (r + r2)):
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            keep.append((x, z, r))
            G.setdefault((gx, gz), []).append((x, z, r))
    keep.sort()
    o_lat, o_lon = lat0, lon0
    out = []
    px, pz = 0, 0
    for x, z, r in keep:
        X, Zc, Rr = int(round(x * 10)), int(round(z * 10)), int(round(r * 10))
        out += [X - px, Zc - pz, Rr]
        px, pz = X, Zc
    src = '国土地理院 地理院タイル(全国最新写真(シームレス))z18 から樹冠を推定(tools/ortho_trees.py)'
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('// 沿線の木の位置と樹冠の半径(推定)。出典:%s。国土地理院コンテンツ利用規約に従い出典を表示する。tools/ortho_trees.py が作る。手で直さない\n' % src)
        f.write('globalThis.GSI_TREES={src:%r,o:[%.8f,%.8f],n:%d,d:"%s"};\n' % (src, o_lat, o_lon, len(keep), ','.join(map(str, out))))
    print('trees', len(keep), 'bytes', os.path.getsize(a.out), file=sys.stderr)


if __name__ == '__main__':
    main()
