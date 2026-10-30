# -*- coding: utf-8 -*-
"""PLATEAU の地形モデル(dem:TINRelief の三角形の網。点は約2.6m おき)を、線路の帯の格子の標高にして plateau_dem.js にする。

  python3 -I tools/plateau_dem.py --html keio_elevated_3d.html --out plateau_dem.js --dx 10 \
      --source '国土交通省 3D都市モデル(Project PLATEAU)2025年度 …' --zip <zip の URL> [--zip …] [dem の GML …]

  ・--zip は G空間情報センターの区市ごとの CityGML の zip(plateau_tex.py と同じ)。udx/dem/ の GML を範囲指定で取り出し、
    解凍しながら流して読む(1ファイル 0.1〜0.7GB を手元に置かない)。GML のファイルを直接渡してもよい
  ・帯にかかる3次メッシュ(plateau_meshes.py と同じ数え方:駅を結ぶ折れ線から --band m)の ReliefFeature だけを読む。
    同じメッシュが区の境で2つのファイルに分かれていることがあるので、全部のファイルを読む
  ・座標はビューアと同じ近似(HTML の MLAT/MLON・原点=笹塚駅の中心。X=東・Z=南)。格子の1マスの標高は、マスに入る
    TIN の点の標高の平均(1マスに十数点。点は三角形ごとに数えるので、共有する点は何回か入る)
  ・点の無いマス(区の境のすき間など)は周りのマスの平均で埋める。折れ線から --keep m より遠いマスはデータ無し(65535)
  出力:globalThis.PLATEAU_DEM={source, license, x0, z0, dx, nx, nz, h0, q, r64, h64}
    格子は nz 行×nx 列(行=z の順、列=x)。マス (i,j) の中心は (x0+(i+0.5)dx, z0+(j+0.5)dx)。帯の外を持たないように、
    r64 = 行ごとの (帯の始まりの列 i0, マスの数 n)(uint16×2・リトルエンディアン)、h64 = その範囲のマスを行の順に並べた
    uint16。標高[m] = h0 + 値×q。65535=データ無し(行の範囲の中でも帯の外のマス)
  ライセンス:PLATEAU のデータは CC BY 4.0。入力は外部のデータなので、数と名前だけを読む(DOCTYPE/ENTITY は読まない)。
"""
import argparse
import base64
import datetime
import json
import math
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plateau_import as PI   # noqa: E402
import plateau_meshes as PM   # noqa: E402

RF = re.compile(rb'<dem:ReliefFeature\b')
NAME = re.compile(rb'<gml:name>(\d{8})</gml:name>')
POS = re.compile(rb'<gml:posList>([^<]*)</gml:posList>')


class Grid:
    def __init__(self, x0, z0, dx, nx, nz):
        self.x0, self.z0, self.dx, self.nx, self.nz = x0, z0, dx, nx, nz
        self.s = np.zeros(nx * nz)
        self.n = np.zeros(nx * nz)

    def add(self, lat, lon, h, proj):
        mlat, mlon, lat0, lon0 = proj[:4]
        x = (lon - lon0) * mlon
        z = -(lat - lat0) * mlat
        i = np.floor((x - self.x0) / self.dx).astype(np.int64)
        j = np.floor((z - self.z0) / self.dx).astype(np.int64)
        ok = (i >= 0) & (i < self.nx) & (j >= 0) & (j < self.nz) & np.isfinite(h)
        k = j[ok] * self.nx + i[ok]
        np.add.at(self.s, k, h[ok])
        np.add.at(self.n, k, 1)


def take(text, grid, proj, want, stat):
    """ReliefFeature 1つ分の文字列から、帯のメッシュなら点を格子に足す"""
    m = NAME.search(text, 0, 4000)
    code = m.group(1).decode() if m else ''
    if code not in want:
        stat['skip'] += 1
        return
    stat['mesh'].add(code)
    pos = b' '.join(POS.findall(text))
    v = np.array(pos.split(), dtype=np.float64)
    if len(v) % 3:
        raise SystemExit('posList の数が3の倍数でない(メッシュ %s)' % code)
    v = v.reshape(-1, 3)
    stat['pts'] += len(v)
    grid.add(v[:, 0], v[:, 1], v[:, 2], proj)


def feed(chunks, grid, proj, want, stat):
    """解凍した文字列の列を ReliefFeature ごとに切って take へ"""
    buf = b''
    for c in chunks:
        if c[:4096].lstrip().startswith(b'<?xml') and (b'<!DOCTYPE' in c[:4096] or b'<!ENTITY' in c[:4096]):
            raise SystemExit('DOCTYPE/ENTITY を含むファイルは読まない')
        buf += c
        st = [m.start() for m in RF.finditer(buf)]
        if len(st) >= 2:
            for a, b in zip(st, st[1:]):
                take(buf[a:b], grid, proj, want, stat)
            buf = buf[st[-1]:]
        elif not st and len(buf) > 64 << 20:
            buf = buf[-(1 << 20):]                     # ReliefFeature の外(ヘッダ)が長いとき
    st = [m.start() for m in RF.finditer(buf)]
    if st:
        take(buf[st[0]:], grid, proj, want, stat)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--html', default='keio_elevated_3d.html')
    ap.add_argument('--out', default='plateau_dem.js')
    ap.add_argument('--source', default='国土交通省 3D都市モデル(Project PLATEAU)')
    ap.add_argument('--dx', type=float, default=10.0, help='格子の間隔[m]')
    ap.add_argument('--band', type=float, default=650.0, help='読む3次メッシュ:駅を結ぶ折れ線からこの距離[m]にかかるもの')
    ap.add_argument('--keep', type=float, default=620.0, help='格子に残す範囲:折れ線からこの距離[m]まで')
    ap.add_argument('--q', type=float, default=0.05, help='標高の刻み[m]')
    ap.add_argument('--zip', action='append', default=[], help='区市の CityGML の zip の URL(udx/dem/ を読む)')
    ap.add_argument('--cache', default=None, help='読んだ点の和と数を置く .npz(作り直しを速くする。中身は自分が作った物だけ)')
    ap.add_argument('gml', nargs='*')
    a = ap.parse_args()
    proj = PI.html_projection(a.html)
    mlat, mlon, lat0, lon0, pts = proj
    want = set(PM.meshes(pts, a.band))
    # 格子:折れ線(両端を延長)から keep の範囲の外接矩形
    P = [((q[1] - lon0) * mlon, -(q[0] - lat0) * mlat) for q in pts]
    xs = [p[0] for p in P]; zs = [p[1] for p in P]
    m = a.keep + 700
    x0 = math.floor((min(xs) - m) / a.dx) * a.dx; z0 = math.floor((min(zs) - m) / a.dx) * a.dx
    nx = int(math.ceil((max(xs) + m - x0) / a.dx)); nz = int(math.ceil((max(zs) + m - z0) / a.dx))
    grid = Grid(x0, z0, a.dx, nx, nz)
    stat = {'mesh': set(), 'skip': 0, 'pts': 0}
    files = []
    if a.cache and os.path.exists(a.cache):
        c = np.load(a.cache, allow_pickle=False)
        grid.s, grid.n = c['s'], c['n']
        files, stat['mesh'], stat['pts'] = [str(v) for v in c['files']], set(str(v) for v in c['meshes']), int(c['pts'])
        a.gml, a.zip = [], []
    for g in a.gml:
        print('読む:', g, flush=True)
        def gen(path=g):
            with open(path, 'rb') as f:
                while True:
                    b = f.read(16 << 20)
                    if not b:
                        break
                    yield b
        feed(gen(), grid, proj, want, stat)
        files.append(os.path.basename(g))
    if a.zip:
        import plateau_zip as Z
        for url in a.zip:
            for e in Z.listing(url):
                if re.search(r'udx/dem/[^/]+\.gml$', e['n']):
                    print('読む:', url.rsplit('/', 1)[-1], e['n'], '%.0fMB' % (e['u'] / 1e6), flush=True)
                    feed(Z.stream(url, e), grid, proj, want, stat)
                    files.append(url.rsplit('/', 1)[-1] + ':' + e['n'])
    if a.cache and not os.path.exists(a.cache):
        np.savez(a.cache, s=grid.s, n=grid.n, files=np.array(files), meshes=np.array(sorted(stat['mesh'])), pts=stat['pts'])
    H = np.where(grid.n > 0, grid.s / np.maximum(grid.n, 1), np.nan).reshape(nz, nx)
    # 折れ線からの距離(マスの中心)
    ci = (np.arange(nx) + 0.5) * a.dx + x0
    cj = (np.arange(nz) + 0.5) * a.dx + z0
    X, Zc = np.meshgrid(ci, cj)
    D = np.full(X.shape, np.inf)
    Pe = list(P)
    def ex(p, q, L):
        dx, dz = p[0] - q[0], p[1] - q[1]; n = math.hypot(dx, dz) or 1
        return (p[0] + dx / n * L, p[1] + dz / n * L)
    Pe = [ex(P[0], P[1], 600)] + Pe + [ex(P[-1], P[-2], 600)]
    for (ax, az), (bx, bz) in zip(Pe, Pe[1:]):
        dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz
        u = np.clip(((X - ax) * dx + (Zc - az) * dz) / L2, 0, 1)
        D = np.minimum(D, np.hypot(X - ax - dx * u, Zc - az - dz * u))
    inside = D <= a.keep
    # 点の無いマスを周りから埋める(帯の中だけ)
    hole0 = int(np.sum(inside & np.isnan(H)))
    for it in range(200):
        miss = inside & np.isnan(H)
        if not miss.any():
            break
        Hp = np.pad(H, 1, constant_values=np.nan)
        nb = np.stack([Hp[1:-1, :-2], Hp[1:-1, 2:], Hp[:-2, 1:-1], Hp[2:, 1:-1]])
        cnt = np.sum(np.isfinite(nb), axis=0)
        avg = np.where(cnt > 0, np.nansum(nb, axis=0) / np.maximum(cnt, 1), np.nan)
        H = np.where(miss & (cnt > 0), avg, H)
    left = int(np.sum(inside & np.isnan(H)))
    if left:
        raise SystemExit('埋められないマスが %d ある(データの範囲が帯を覆っていない)' % left)
    Hv = np.where(inside, H, np.nan)
    h0 = math.floor(np.nanmin(Hv))
    Qv = np.where(inside, np.round((H - h0) / a.q), 65535)
    if np.nanmax(np.where(inside, Qv, 0)) >= 65535:
        raise SystemExit('標高の幅が uint16 に入らない')
    rows, vals = [], []
    for j in range(nz):                        # 行ごとに帯の範囲だけ
        idx = np.nonzero(inside[j])[0]
        if len(idx) == 0:
            rows.append((0, 0))
            continue
        i0, i1 = int(idx[0]), int(idx[-1]) + 1
        rows.append((i0, i1 - i0))
        vals.append(Qv[j, i0:i1])
    out = np.concatenate(vals).astype('<u2').tobytes()
    meta = {'source': a.source, 'license': 'CC BY 4.0', 'made': datetime.date.today().isoformat(),
            'files': files, 'meshes': sorted(stat['mesh']), 'x0': x0, 'z0': z0, 'dx': a.dx, 'nx': nx, 'nz': nz,
            'h0': h0, 'q': a.q, 'r64': base64.b64encode(np.array(rows, '<u2').tobytes()).decode('ascii'),
            'h64': base64.b64encode(out).decode('ascii')}
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('// 沿線の地形(格子の標高)。出典:%s(CC BY 4.0)。tools/plateau_dem.py が作る。手で直さない\n' % a.source)
        f.write('globalThis.PLATEAU_DEM=' + json.dumps(meta, ensure_ascii=False) + ';\n')
    print('メッシュ %d(帯の外で飛ばした %d)・点 %d・格子 %dx%d(%.0fm)・帯の中 %d マス(穴 %d を埋めた)・標高 %.1f〜%.1fm・%.0f KB'
          % (len(stat['mesh']), stat['skip'], stat['pts'], nx, nz, a.dx, int(inside.sum()), hole0,
             np.nanmin(Hv), np.nanmax(Hv), os.path.getsize(a.out) / 1e3))


if __name__ == '__main__':
    main()
