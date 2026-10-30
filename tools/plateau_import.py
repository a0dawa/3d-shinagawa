# -*- coding: utf-8 -*-
"""PLATEAU(国土交通省 3D都市モデル)の建築物 CityGML から、沿線の建物の
「平面形(足跡)+高さ」を取り出し、ビューアに埋め込める小さな2進データにする(試作)。

  python3 -I tools/plateau_import.py --html keio_elevated_3d.html --out reference/plateau/bldg.bin \
      <建築物の CityGML(bldg/*.gml)> [...]

  ・入力は G空間情報センターの「3D都市モデル(Project PLATEAU)」の CityGML(bldg)。
    沿線は 渋谷区(笹塚)・杉並区・世田谷区・調布市(仙川)。1km の3次メッシュごとのファイルを渡す。
  ・座標は JGD2011 の緯度・経度・標高(EPSG:6697。posList は 緯度 経度 高さ の順)。
    ビューアと同じ近似(1度あたり MLAT/MLON m、原点=笹塚駅の中心)でワールド座標(X=東・Z=南)にする。
    定数は HTML から読む(ビューアの射影と必ず一致させる)。
  ・足跡は lod0FootPrint → lod0RoofEdge → lod1Solid の最も低い面 の順で探す。
    高さは measuredHeight、無ければ lod1Solid の高さの幅。
  ・駅の並びの外側 600m より遠いもの・小さすぎる物(既定 15m² 未満)は捨てる。
    高架橋・道路・駅などとの重なりの最終判定はビューア側(占有域 KEEP と同じ)で行う。
  ・入力は外部のデータなので、DOCTYPE/ENTITY を含むファイルは読まない(実体展開の攻撃を避ける)。

  出力(リトルエンディアン):b'PLT1' + 件数(uint32) + 件数×{頂点数 n(uint8)・高さ(uint16,0.1m)・
  階数(uint8,0=不明)・1点目 x,z(int32,0.1m)・2点目以降 (dx,dz)(int16,0.1m)×(n−1)}
  ライセンス:PLATEAU のデータは CC BY 4.0 ほか。画面に「出典:国土交通省 Project PLATEAU」を出すこと。
"""
import argparse
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET

NS = {
    'gml': 'http://www.opengis.net/gml',
    'bldg': 'http://www.opengis.net/citygml/building/2.0',
    'core': 'http://www.opengis.net/citygml/2.0',
}
BLDG = '{%s}Building' % NS['bldg']
# 建物の用途(Building_usage)→ ビューアの区分。0=不明/1=戸建て住宅/2=店舗・作業所併用住宅/3=共同住宅(店舗併用を含む)/
# 4=業務/5=商業・宿泊/6=官公庁・文教厚生/7=運輸倉庫/8=工場/9=供給処理/10=農林漁業ほか
USAGE = {'411': 1, '413': 2, '415': 2, '412': 3, '414': 3, '401': 4, '402': 5, '403': 5, '404': 5,
         '421': 6, '422': 6, '431': 7, '441': 8, '461': 9, '451': 10, '452': 10, '453': 10, '454': 10}


def html_projection(path):
    """ビューアの射影の定数(MLAT・MLON・原点)と駅の緯度経度を HTML から読む。"""
    src = open(path, encoding='utf-8').read()
    m = re.search(r'const MLAT=(\d+),MLON=(\d+);', src)
    if not m:
        raise SystemExit('HTML に MLAT/MLON が見つからない')
    mlat, mlon = float(m.group(1)), float(m.group(2))
    sta = re.findall(r"\['([^']+)','[^']*','\w+',0x[0-9a-f]+,\d+, ([\d.]+),([\d.]+), ([\d.]+),([\d.]+)\]", src)
    if len(sta) < 2:
        raise SystemExit('HTML に駅の座標が見つからない')
    pts = [((float(a) + float(c)) / 2, (float(b) + float(d)) / 2) for _, a, b, c, d in sta]
    lat0, lon0 = pts[0]                              # 原点=笹塚駅の中心(HTML の LAT0/LON0 と同じ)
    return mlat, mlon, lat0, lon0, pts


def poslist(el):
    v = [float(t) for t in el.text.split()]
    return [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v) - 2, 3)]


def rings(el):
    """要素の下の LinearRing(外周)の posList を全部返す。"""
    out = []
    for pl in el.iter('{%s}posList' % NS['gml']):
        out.append(poslist(pl))
    return out


def area2d(p):
    a = 0.0
    for i in range(len(p)):
        x0, z0 = p[i]
        x1, z1 = p[(i + 1) % len(p)]
        a += x0 * z1 - x1 * z0
    return abs(a) / 2


def simplify(p, tol):
    """閉じた多角形の Douglas–Peucker(始点を固定)。"""
    if len(p) <= 4:
        return p

    def rdp(pts):
        if len(pts) < 3:
            return pts
        (x0, z0), (x1, z1) = pts[0], pts[-1]
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz) or 1e-9
        k, dmax = 0, -1.0
        for i in range(1, len(pts) - 1):
            d = abs(dz * (pts[i][0] - x0) - dx * (pts[i][1] - z0)) / L
            if d > dmax:
                k, dmax = i, d
        if dmax <= tol:
            return [pts[0], pts[-1]]
        return rdp(pts[:k + 1])[:-1] + rdp(pts[k:])
    q = rdp(p + [p[0]])[:-1]
    return q if len(q) >= 3 else p


def read_buildings(path, proj, margin, min_area, tol, band=0, ids=False, zmin=False):
    raw = open(path, 'rb').read(4096)
    if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:
        raise SystemExit('DOCTYPE/ENTITY を含むファイルは読まない: ' + path)
    mlat, mlon, lat0, lon0, pts = proj
    la0 = min(p[0] for p in pts) - margin / mlat
    la1 = max(p[0] for p in pts) + margin / mlat
    lo0 = min(p[1] for p in pts) - margin / mlon
    lo1 = max(p[1] for p in pts) + margin / mlon
    # 駅の中心を結ぶ折れ線(両端は延長)からの距離で帯に絞る。正確な (s,off) の判定はビューアが行う
    P = [((q[1] - lon0) * mlon, -(q[0] - lat0) * mlat) for q in pts]
    def ext(a, b, L):
        dx, dz = a[0] - b[0], a[1] - b[1]; n = math.hypot(dx, dz) or 1
        return (a[0] + dx / n * L, a[1] + dz / n * L)
    P = [ext(P[0], P[1], margin)] + P + [ext(P[-1], P[-2], margin)]
    def band_dist(x, z):
        best = 1e18
        for (ax, az), (bx, bz) in zip(P, P[1:]):
            dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz
            u = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L2)) if L2 else 0.0
            best = min(best, math.hypot(x - ax - dx * u, z - az - dz * u))
        return best
    out = []
    for ev, el in ET.iterparse(path, events=('end',)):
        if el.tag != BLDG:
            continue
        foot = None
        for tag in ('lod0FootPrint', 'lod0RoofEdge'):
            f = el.find('bldg:%s' % tag, NS)
            if f is not None:
                rr = rings(f)
                if rr:
                    foot = max(rr, key=len)
                    break
        solid = el.find('bldg:lod1Solid', NS)
        zs = []
        if solid is not None:
            rr = rings(solid)
            for r in rr:
                zs += [q[2] for q in r]
            if foot is None and rr:                      # 最も低い面=底面
                foot = min(rr, key=lambda r: sum(q[2] for q in r) / len(r))
        if not foot:
            el.clear()
            continue
        lod2 = read_lod2(el, ids) if el.find('bldg:lod2Solid', NS) is not None else None
        h = el.find('bldg:measuredHeight', NS)
        height = float(h.text) if h is not None and h.text and float(h.text) > 0 else (max(zs) - min(zs) if zs else 0.0)
        us = el.find('bldg:usage', NS)
        usage = USAGE.get((us.text or '').strip(), 0) if us is not None else 0
        st = el.find('bldg:storeysAboveGround', NS)
        storeys = int(st.text) if st is not None and st.text and st.text.strip().isdigit() else 0
        clat = sum(q[0] for q in foot) / len(foot)
        clon = sum(q[1] for q in foot) / len(foot)
        el.clear()
        if not (la0 <= clat <= la1 and lo0 <= clon <= lo1) or height <= 0:
            continue
        p = [((q[1] - lon0) * mlon, -(q[0] - lat0) * mlat) for q in foot]   # X=東・Z=南(ビューアの toXY)
        if band and band_dist(sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)) > band:
            continue
        if len(p) > 1 and math.hypot(p[0][0] - p[-1][0], p[0][1] - p[-1][1]) < 1e-6:
            p = p[:-1]                                    # 閉じた輪の終点を除く
        if len(p) < 3 or area2d(p) < min_area:
            continue
        p = simplify(p, tol)
        if lod2:
            lod2 = [(s[0], [((q[1] - lon0) * mlon, -(q[0] - lat0) * mlat, q[2]) for q in s[1]]) + tuple(s[2:]) for s in lod2]
        # zmin=True:LOD1 の立体の最も低い標高(地盤の高さ。無ければ nan)を最後に足す(tools/plateau_ground.py が地形の検証の基準に使う)
        out.append((p, height, storeys, lod2, usage) + ((min(zs) if zs else float('nan')),) * bool(zmin))
    return out


def read_lod2(el, ids=False):
    """LOD2 の屋根面・壁面(boundedBy の RoofSurface/WallSurface の lod2MultiSurface)を [(種別1=屋根/2=壁, 外周の点(緯度,経度,標高)…)]。
    高さの基準は GroundSurface(無ければ全ての面)の最も低い標高。返す点の標高は基準からの高さ。
    ids=True なら各面に外周の LinearRing の gml:id と、閉じた輪で終点を除いたか・元の点の数を足す
    (写真テクスチャの座標 app:textureCoordinates は ring の id で引く。tools/plateau_tex.py が使う)。面と点の並びは変えない"""
    surf, zs, gz = [], [], []
    for b in el.findall('bldg:boundedBy', NS):
        for s in b:
            k = s.tag.rsplit('}', 1)[-1]
            t = {'RoofSurface': 1, 'WallSurface': 2, 'GroundSurface': 0}.get(k)
            if t is None:
                continue
            for pg in s.iter('{%s}Polygon' % NS['gml']):
                ext = pg.find('gml:exterior', NS)
                if ext is None:
                    continue
                rid = {}
                if ids:
                    for lr in ext.iter('{%s}LinearRing' % NS['gml']):
                        for pl in lr.iter('{%s}posList' % NS['gml']):
                            rid[id(pl)] = lr.get('{%s}id' % NS['gml'])
                for pl in ext.iter('{%s}posList' % NS['gml']):
                    r = poslist(pl)
                    n0, closed = len(r), False
                    if len(r) > 1 and r[0] == r[-1]:
                        r = r[:-1]
                        closed = True
                    if len(r) < 3:
                        continue
                    zs += [q[2] for q in r]
                    if t == 0:
                        gz += [q[2] for q in r]
                    elif ids:
                        surf.append((t, r, rid.get(id(pl)), closed, n0))
                    else:
                        surf.append((t, r))
    if not surf:
        return None
    base = min(gz) if gz else min(zs)
    return [(s[0], [(q[0], q[1], q[2] - base) for q in s[1]]) + tuple(s[2:]) for s in surf]


def encode(blds):
    b = bytearray(b'PLT1') + struct.pack('<I', len(blds))
    for p, h, st, *_ in blds:
        q = [(round(x * 10), round(z * 10)) for x, z in p][:255]
        b += struct.pack('<BHB', len(q), min(65535, round(h * 10)), min(255, st))
        b += struct.pack('<ii', q[0][0], q[0][1])
        for i in range(1, len(q)):
            dx, dz = q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]
            b += struct.pack('<hh', max(-32768, min(32767, dx)), max(-32768, min(32767, dz)))
    return bytes(b)


def encode_lod2(blds):
    """LOD2 の面:b'PL2A' + 件数(uint32) + 件数×{建物の番号(uint32・PLT1 の並び)・面の数(uint16)・
    面ごとに {種別(uint8 1=屋根/2=壁)・点の数(uint8)・点ごとに (x,z は足跡の1点目からの差 int16 0.1m・高さ uint16 0.1m)}}"""
    items = [(i, b[3]) for i, b in enumerate(blds) if b[3]]
    out = bytearray(b'PL2A') + struct.pack('<I', len(items))
    for i, surf in items:
        x0, z0 = round(blds[i][0][0][0] * 10), round(blds[i][0][0][1] * 10)
        surf = [(t, r[:255]) for t, r in surf][:65535]
        out += struct.pack('<IH', i, len(surf))
        for t, r in surf:
            out += struct.pack('<BB', t, len(r))
            for x, z, y in r:
                out += struct.pack('<hhH', max(-32768, min(32767, round(x * 10) - x0)), max(-32768, min(32767, round(z * 10) - z0)),
                                   max(0, min(65535, round(y * 10))))
    return bytes(out), len(items)


def decode(b):
    assert b[:4] == b'PLT1'
    n = struct.unpack_from('<I', b, 4)[0]
    o, out = 8, []
    for _ in range(n):
        k, h, st = struct.unpack_from('<BHB', b, o); o += 4
        x, z = struct.unpack_from('<ii', b, o); o += 8
        p = [(x / 10, z / 10)]
        for _ in range(k - 1):
            dx, dz = struct.unpack_from('<hh', b, o); o += 4
            x += dx; z += dz
            p.append((x / 10, z / 10))
        out.append((p, h / 10, st, None, 0))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--html', default='keio_elevated_3d.html')
    ap.add_argument('--out', required=True, help='2進(.bin)か、ビューアが読む JS(.js:globalThis.PLATEAU_BLDG に base64 で入れる)')
    ap.add_argument('--source', default='国土交通省 3D都市モデル(Project PLATEAU)', help='出典の表示')
    ap.add_argument('--margin', type=float, default=600.0, help='駅の並びの外側に取る幅[m]')
    ap.add_argument('--min-area', type=float, default=15.0, help='これより小さい足跡は捨てる[m²]')
    ap.add_argument('--tol', type=float, default=0.3, help='足跡の単純化の許容[m]')
    ap.add_argument('--band', type=float, default=540.0, help='駅を結ぶ折れ線からこの距離[m]より遠い建物は捨てる(0=絞らない)')
    ap.add_argument('gml', nargs='+')
    a = ap.parse_args()
    proj = html_projection(a.html)
    blds = []
    for g in a.gml:
        blds += read_buildings(g, proj, a.margin, a.min_area, a.tol, a.band)
    data = encode(blds)
    l2, n2 = encode_lod2(blds)
    if a.out.endswith('.js'):
        import base64, json, datetime
        meta = {'source': a.source, 'license': 'CC BY 4.0', 'files': [g.split('/')[-1] for g in a.gml],
                'made': datetime.date.today().isoformat(), 'count': len(blds),
                'lod2': n2, 'lod2b64': base64.b64encode(l2).decode('ascii'),
                # 用途:PLT1 の並びと同じ順に1棟1バイト(上の USAGE の区分)
                'use64': base64.b64encode(bytes(b[4] for b in blds)).decode('ascii')}
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write('// 沿線の建物(足跡+高さ)。出典:%s(CC BY 4.0)。tools/plateau_import.py が作る。手で直さない\n' % a.source)
            f.write('globalThis.PLATEAU_BLDG=' + json.dumps(dict(meta, b64=base64.b64encode(data).decode('ascii')), ensure_ascii=False) + ';\n')
    else:
        open(a.out, 'wb').write(data)
    nv = sum(len(b[0]) for b in blds)
    hs = sorted(b[1] for b in blds) or [0]
    print('建物 %d 棟 / 頂点 %d / %d バイト(base64 で約 %d)/ 高さ 中央 %.1fm 最大 %.1fm / LOD2 %d 棟 %d バイト'
          % (len(blds), nv, len(data), len(data) * 4 // 3, hs[len(hs) // 2], hs[-1], n2, len(l2)))


if __name__ == '__main__':
    main()
