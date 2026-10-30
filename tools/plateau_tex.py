# -*- coding: utf-8 -*-
"""PLATEAU の LOD2 の建物の写真テクスチャ(航空写真から作った壁と屋根の画像)を、ビューアが読む plateau_tex.js にする。

  python3 -I tools/plateau_tex.py --html keio_elevated_3d.html --bldg plateau_bldg.js \
      --images <画像を置いたフォルダ> --out plateau_tex.js <建築物の CityGML(bldg/*.gml)…>

  ・建物の並びと LOD2 の面は plateau_import.py と同じ読み方(同じ引数)で作り直し、plateau_bldg.js の PLT1・PL2A と
    バイト単位で一致することを確かめてから使う(一致しなければ止まる。面の番号がずれると写真が別の面に貼られる)。
  ・面ごとの写真の座標は CityGML の app:ParameterizedTexture(画像)/app:target(面)/app:textureCoordinates(輪)から、
    外周の LinearRing の gml:id で引く。閉じた輪で終点を除いた面は、座標の最後の組も除く(PL2A の点と1対1)。
  ・画像は --images の下に CityGML と同じ相対パス(<メッシュ>_bldg_6697_appearance/xxx.jpg)で置く
    (G空間情報センターの zip の udx/bldg/ の下。--zip <zip の URL> を渡すと、無い画像だけを zip から範囲指定で取り出して置く)。
  ・--used(tools/plateau_used.js の出力)を渡すと、ビューアが描く建物の写真だけを詰める。
  ・画像は面の大きさから写真の細かさ(1m あたりの画素)を測り、--ppm を超える分だけ縮めて、s の並びの近い建物ごとに
    詰め合わせの画像(最大 --atlas 画素四方、JPEG)にまとめる。詰めた画像の周りは --pad 画素だけ縁の画素で延ばす
    (縮小の段=ミップマップで隣の写真が混ざらない)。
  出力:globalThis.PLATEAU_TEX={source, license, atlases:[{w,h,jpg(base64)}], uv64(PTX1), …}
    PTX1(リトルエンディアン):b'PTX1' + 建物の数(uint32) + 建物ごとに {建物の番号(uint32・PLT1 の並び)・面の数(uint16・PL2A と同じ)・
    平均色(RGB uint8×3)・面ごとに {詰め合わせの番号(uint8・255=写真なし)・(写真ありなら)点ごとに u,v(uint16・0〜65535)}}
  ライセンス:PLATEAU のデータ(画像を含む)は CC BY 4.0。画面に出典を出すこと。
  入力は外部のデータなので、DOCTYPE/ENTITY を含むファイルは読まない。画像は Pillow で開くだけ(実行しない)。
"""
import argparse
import base64
import io
import json
import math
import os
import pickle
import re
import struct
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plateau_import as PI   # noqa: E402

APP = 'http://www.opengis.net/citygml/appearance/2.0'
NSA = {'app': APP}


def read_appearance(path):
    """CityGML の先頭の外観(app:appearanceMember)から、輪の id → (画像の相対パス, [u0,v0,u1,v1,…])。建物が始まったら止める"""
    raw = open(path, 'rb').read(4096)
    if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:
        raise SystemExit('DOCTYPE/ENTITY を含むファイルは読まない: ' + path)
    tex = {}
    for ev, el in ET.iterparse(path, events=('start', 'end')):
        if ev == 'start':
            if el.tag == PI.BLDG:
                break
            continue
        if el.tag == '{%s}ParameterizedTexture' % APP:
            im = el.find('app:imageURI', NSA)
            img = (im.text or '').strip() if im is not None else ''
            for tg in el.findall('app:target', NSA):
                for tc in tg.iter('{%s}textureCoordinates' % APP):
                    ring = (tc.get('ring') or '').lstrip('#')
                    try:
                        v = [float(x) for x in (tc.text or '').split()]
                    except ValueError:
                        continue
                    if ring and img:
                        tex[ring] = (img, v)
            el.clear()
    return tex


def load_bldg_js(path):
    src = open(path, encoding='utf-8').read()
    return json.loads(src[src.index('{'):src.rindex('}') + 1])


def parse_all(gmls, proj, a):
    """建物(plateau_import と同じ並び)と、輪の id → 写真の座標"""
    blds, tex = [], {}
    for g in gmls:
        t = read_appearance(g)
        d = os.path.basename(g)
        for k, v in t.items():
            tex[(d, k)] = v
        for b in PI.read_buildings(g, proj, a.margin, a.min_area, a.tol, a.band, ids=True):
            blds.append(b + (d,))
        print('  %s: 建物 %d・写真の輪 %d' % (d, len(blds), len(t)), flush=True)
    return blds, tex


def along(proj, margin):
    """駅を結ぶ折れ線(plateau_import と同じ。両端は延長)に沿った距離 s(笹塚=0・西へ増える)と、折れ線からの距離。
    ビューアの s(曲線に沿う営業距離)とは数十m ずれうるので、詰め合わせのまとまりの目安だけに使う"""
    mlat, mlon, lat0, lon0, pts = proj
    P = [((q[1] - lon0) * mlon, -(q[0] - lat0) * mlat) for q in pts]

    def ext(a, b, L):
        dx, dz = a[0] - b[0], a[1] - b[1]
        n = math.hypot(dx, dz) or 1
        return (a[0] + dx / n * L, a[1] + dz / n * L)
    P = [ext(P[0], P[1], margin)] + P + [ext(P[-1], P[-2], margin)]
    acc = [-margin]
    for a, b in zip(P, P[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))

    def f(x, z):
        best = (1e18, 0.0)
        for i, ((ax, az), (bx, bz)) in enumerate(zip(P, P[1:])):
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            u = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L2)) if L2 else 0.0
            d = math.hypot(x - ax - dx * u, z - az - dz * u)
            if d < best[0]:
                best = (d, acc[i] + u * math.sqrt(L2))
        return best[1], best[0]
    return f, acc[-2]


def area3(V):
    """3次元の多角形の面積(Newell)"""
    nx = ny = nz = 0.0
    for i in range(len(V)):
        a, b = V[i], V[(i + 1) % len(V)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    return math.hypot(nx, ny, nz) / 2


def area2(U):
    A = 0.0
    for i in range(len(U)):
        a, b = U[i], U[(i + 1) % len(U)]
        A += a[0] * b[1] - b[0] * a[1]
    return abs(A) / 2


class Skyline:
    """詰め合わせ(skyline の左下詰め)。place(w,h) → (x,y) か None"""
    def __init__(self, W, H):
        self.W, self.H, self.sk = W, H, [[0, 0, W]]   # [x, y, 幅]

    def place(self, w, h):
        best = None
        for i in range(len(self.sk)):
            x = self.sk[i][0]
            if x + w > self.W:
                break
            y, rem, j = 0, w, i
            while rem > 0:
                y = max(y, self.sk[j][1])
                rem -= self.sk[j][2]
                j += 1
            if y + h > self.H:
                continue
            if best is None or y + h < best[1] + best[2] or (y + h == best[1] + best[2] and x < best[0]):
                best = (x, y, h, i)
        if best is None:
            return None
        x, y, h, i = best
        new = [x, y + h, w]
        # 覆った区間を切り詰める
        rest, k = [], i
        end = x + w
        out = self.sk[:i] + [new]
        while k < len(self.sk):
            sx, sy, sw = self.sk[k]
            if sx + sw <= end:
                k += 1
                continue
            if sx < end:
                out.append([end, sy, sx + sw - end])
            else:
                out.append([sx, sy, sw])
            k += 1
        # 同じ高さの隣を1つに
        m = [out[0]]
        for seg in out[1:]:
            if seg[1] == m[-1][1]:
                m[-1][2] += seg[2]
            else:
                m.append(seg)
        self.sk = m
        return x, y

    def used_h(self):
        return max(s[1] for s in self.sk)


def build(blds, tex, a, proj):
    import numpy as np
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 50_000_000
    f_s, s_end = along(proj, a.margin)
    # 1) LOD2 の面ごとに写真の座標(PL2A と同じ切り詰め:面 65535 まで・点 255 まで)
    S = []            # (建物の番号, 面の番号, 画像, [(x,y) 画素], 3次元の面積, 壁か)
    keep = {}
    for bi, b in enumerate(blds):
        if not b[3]:
            continue
        cx = sum(p[0] for p in b[0]) / len(b[0])
        cz = sum(p[1] for p in b[0]) / len(b[0])
        s, d = f_s(cx, cz)
        if s < -a.margin_s or s > s_end + a.margin_s or d > a.dist:
            continue                          # ビューアの帯(事業区間・±470m)の外は詰めない
        if a.used is not None and (round(b[0][0][0] * 10), round(b[0][0][1] * 10), round(b[1] * 10)) not in a.used:
            continue                          # ビューアが描かない建物
        keep[bi] = s
        for j, srf in enumerate(b[3][:65535]):
            t = tex.get((b[5], srf[2]))
            nv = min(255, len(srf[1]))
            if not t or len(t[1]) != 2 * srf[4]:
                continue
            S.append((bi, j, t[0], [(t[1][2 * i], t[1][2 * i + 1]) for i in range(nv)],
                      area3([(p[0], p[2], p[1]) for p in srf[1][:nv]]), srf[0] == 2))
    # 2) 画像ごとに面の矩形が重なる物をまとめる(まとまり=切り出す単位)
    by_img = {}
    for k, e in enumerate(S):
        by_img.setdefault(e[2], []).append(k)
    isl = []          # (画像, x0,y0,x1,y1 画素, [面の番号 k], s, 画素/m)
    imsize = {}
    for img, ks in by_img.items():
        im = Image.open(os.path.join(a.images, img))
        W, H = im.size
        imsize[img] = (W, H)
        bb = []
        for k in ks:
            U = S[k][3]
            xs = [u[0] * W for u in U]
            ys = [(1 - u[1]) * H for u in U]
            bb.append([min(xs), min(ys), max(xs), max(ys)])
        par = list(range(len(ks)))

        def root(i):
            while par[i] != i:
                par[i] = par[par[i]]
                i = par[i]
            return i
        order = sorted(range(len(ks)), key=lambda i: bb[i][0])
        for ii in range(len(order)):                     # x で並べて重なる候補だけ見る
            i = order[ii]
            for jj in range(ii + 1, len(order)):
                j = order[jj]
                if bb[j][0] > bb[i][2] + 1:
                    break
                if bb[j][1] <= bb[i][3] + 1 and bb[i][1] <= bb[j][3] + 1:
                    ri, rj = root(i), root(j)
                    if ri != rj:
                        par[ri] = rj
        grp = {}
        for i in range(len(ks)):
            grp.setdefault(root(i), []).append(i)
        groups = []
        for g in grp.values():
            # まとまりの矩形に余白(元の画像の灰)が多ければ、面ごとの矩形に分ける(詰め合わせの画素を減らす)
            gx0, gy0 = min(bb[i][0] for i in g), min(bb[i][1] for i in g)
            gx1, gy1 = max(bb[i][2] for i in g), max(bb[i][3] for i in g)
            fill = sum(area2([(u[0] * W, (1 - u[1]) * H) for u in S[ks[i]][3]]) for i in g) / max(1.0, (gx1 - gx0) * (gy1 - gy0))
            groups += [g] if len(g) == 1 or fill >= a.fill else [[i] for i in g]
        for g in groups:
            x0 = max(0, math.floor(min(bb[i][0] for i in g)) - 1)
            y0 = max(0, math.floor(min(bb[i][1] for i in g)) - 1)
            x1 = min(W, math.ceil(max(bb[i][2] for i in g)) + 1)
            y1 = min(H, math.ceil(max(bb[i][3] for i in g)) + 1)
            px = sum(area2([(u[0] * W, (1 - u[1]) * H) for u in S[ks[i]][3]]) for i in g)
            m2 = sum(S[ks[i]][4] for i in g)
            isl.append([img, x0, y0, x1, y1, [ks[i] for i in g], min(keep[S[ks[i]][0]] for i in g),
                        math.sqrt(px / m2) if m2 > 0 and px > 0 else a.ppm])
    # 3) 縮める(細かすぎる分だけ)・縁を延ばす・s の並びで詰める
    P = a.pad
    for e in isl:
        k = min(1.0, a.ppm / e[7]) if e[7] > 0 else 1.0
        w, h = e[3] - e[1], e[4] - e[2]
        k = min(k, (a.atlas - 2 * P) / w, (a.atlas - 2 * P) / h)    # 詰め合わせより大きいまとまりは入る大きさまで縮める
        e.append((max(2, round(w * k)), max(2, round(h * k))))
    isl.sort(key=lambda e: (math.floor(e[6] / a.group), -e[8][1], -e[8][0]))
    atl, cur, place = [], None, {}
    for n, e in enumerate(isl):
        w, h = e[8][0] + 2 * P, e[8][1] + 2 * P
        pos = cur.place(w, h) if cur else None
        if pos is None:
            cur = Skyline(a.atlas, a.atlas)
            atl.append(cur)
            pos = cur.place(w, h)
            if pos is None:
                raise SystemExit('詰め合わせに入らない大きさ %dx%d' % (w, h))
        place[n] = (len(atl) - 1, pos[0], pos[1])
    canv = []
    for t in atl:
        H = min(a.atlas, ((t.used_h() + 63) // 64) * 64)
        canv.append(np.zeros((H, a.atlas, 3), np.uint8) + 128)
    occ = [np.zeros(c.shape[:2], bool) for c in canv]
    cache = {}
    for n in sorted(range(len(isl)), key=lambda n: isl[n][0]):    # 画像ごとに1回だけ開く
        e = isl[n]
        img = e[0]
        if img not in cache:
            cache.clear()
            cache[img] = np.asarray(Image.open(os.path.join(a.images, img)).convert('RGB'))
        src = cache[img][e[2]:e[4], e[1]:e[3]]
        w, h = e[8]
        im = np.asarray(Image.fromarray(src).resize((w, h), Image.LANCZOS)) if (w, h) != (src.shape[1], src.shape[0]) else src
        im = np.pad(im, ((P, P), (P, P), (0, 0)), mode='edge')
        ai, x, y = place[n]
        if occ[ai][y:y + h + 2 * P, x:x + w + 2 * P].any():
            raise SystemExit('詰め合わせで切り出しが重なった(詰める処理の誤り)')
        occ[ai][y:y + h + 2 * P, x:x + w + 2 * P] = True
        canv[ai][y:y + h + 2 * P, x:x + w + 2 * P] = im
    # 4) 面の点の座標を詰め合わせの中へ(u = 横/幅、v = 1 − 縦/高さ。three.js の画像は上下を返して貼る)
    uv = {}           # (建物, 面) → (詰め合わせ, [(u,v)])
    col = {}          # 建物 → [Σ色×面積, Σ面積](壁)
    for n, e in enumerate(isl):
        img, x0, y0, x1, y1, ks = e[:6]
        W, H = imsize[img]
        w, h = e[8]
        ai, ax, ay = place[n]
        AH, AW = canv[ai].shape[0], canv[ai].shape[1]
        kx, ky = w / (x1 - x0), h / (y1 - y0)
        for k in ks:
            bi, j, _, U, m2, wall = S[k]
            pts = []
            for u, v in U:
                X = ax + P + (u * W - x0) * kx
                Y = ay + P + ((1 - v) * H - y0) * ky
                pts.append((X / AW, 1 - Y / AH))
            uv[(bi, j)] = (ai, pts)
            if wall and m2 > 0:
                xs = [p[0] * AW for p in pts]
                ys = [(1 - p[1]) * AH for p in pts]
                r = canv[ai][max(0, int(min(ys))):int(max(ys)) + 1, max(0, int(min(xs))):int(max(xs)) + 1].reshape(-1, 3)
                if len(r):
                    c = col.setdefault(bi, [np.zeros(3), 0.0])
                    c[0] += r.mean(axis=0) * m2
                    c[1] += m2
    return keep, uv, col, canv, isl


def encode_ptx(blds, keep, uv, col):
    out = bytearray(b'PTX1')
    items = [bi for bi in sorted(keep) if any((bi, j) in uv for j in range(min(65535, len(blds[bi][3]))))]
    out += struct.pack('<I', len(items))
    for bi in items:
        surf = blds[bi][3][:65535]
        c = col.get(bi)
        rgb = [int(round(v)) for v in (c[0] / c[1])] if c and c[1] > 0 else [255, 255, 255]
        out += struct.pack('<IHBBB', bi, len(surf), *[max(0, min(255, v)) for v in rgb])
        for j, srf in enumerate(surf):
            e = uv.get((bi, j))
            if not e:
                out += struct.pack('<B', 255)
                continue
            out += struct.pack('<B', e[0])
            if len(e[1]) != min(255, len(srf[1])):
                raise SystemExit('点の数が合わない')
            for u, v in e[1]:
                out += struct.pack('<HH', max(0, min(65535, round(u * 65535))), max(0, min(65535, round(v * 65535))))
    return bytes(out), len(items)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--html', default='keio_elevated_3d.html')
    ap.add_argument('--bldg', default='plateau_bldg.js', help='一致を確かめる建物のデータ')
    ap.add_argument('--margin', type=float, default=600.0)
    ap.add_argument('--min-area', type=float, default=25.0)
    ap.add_argument('--tol', type=float, default=0.5)
    ap.add_argument('--band', type=float, default=540.0)
    ap.add_argument('--images', default=None, help='画像を置いたフォルダ(CityGML と同じ相対パス)')
    ap.add_argument('--out', default='plateau_tex.js')
    ap.add_argument('--source', default='国土交通省 3D都市モデル(Project PLATEAU)')
    ap.add_argument('--ppm', type=float, default=5.0, help='写真の細かさの上限[画素/m]。これより細かい写真は縮める')
    ap.add_argument('--atlas', type=int, default=2048, help='詰め合わせの画像の一辺[画素]')
    ap.add_argument('--pad', type=int, default=4, help='切り出した写真の周りに延ばす画素')
    ap.add_argument('--fill', type=float, default=0.6, help='まとまりの矩形のうち面が占める割合がこれ未満なら面ごとに切り出す')
    ap.add_argument('--group', type=float, default=240.0, help='同じ詰め合わせに寄せる s の幅[m](ビューアのまとまりと同じ)')
    ap.add_argument('--margin-s', type=float, default=80.0, help='事業区間の両端の外へ取る余裕[m]')
    ap.add_argument('--dist', type=float, default=500.0, help='折れ線からこの距離より遠い建物の写真は詰めない[m]')
    ap.add_argument('--quality', type=int, default=82, help='JPEG の品質')
    ap.add_argument('--zip', action='append', default=[], help='画像が無いとき取り出す区市の CityGML の zip の URL(先に書いた方を優先)')
    ap.add_argument('--used', default=None, help='ビューアが描く LOD2 の建物の一覧(tools/plateau_used.js の出力)。その建物の写真だけ詰める')
    ap.add_argument('--cache', default=None, help='読んだ結果を pickle で置く所(作り直しを速くする。中身は自分が作った物だけ)')
    ap.add_argument('gml', nargs='+')
    a = ap.parse_args()
    proj = PI.html_projection(a.html)
    if a.cache and os.path.exists(a.cache):
        blds, tex = pickle.load(open(a.cache, 'rb'))
    else:
        blds, tex = parse_all(a.gml, proj, a)
        if a.cache:
            pickle.dump((blds, tex), open(a.cache, 'wb'))
    # plateau_bldg.js と同じ並び・同じ LOD2 の面か(面の番号で写真を対応させるので必須)
    D = load_bldg_js(a.bldg)
    strip = [(b[0], b[1], b[2], [(s[0], s[1]) for s in b[3]] if b[3] else None, b[4]) for b in blds]
    plt1 = PI.encode(strip)
    pl2a, _ = PI.encode_lod2(strip)
    if plt1 != base64.b64decode(D['b64']) or pl2a != base64.b64decode(D['lod2b64']):
        raise SystemExit('plateau_bldg.js と建物の並び・LOD2 の面が一致しない(引数・HTML の射影・入力の並びを確かめる)')
    print('plateau_bldg.js と一致:建物 %d・LOD2 %d 棟' % (len(blds), sum(1 for b in blds if b[3])))
    if not a.images:
        return
    if a.zip:                                    # 無い画像だけ zip から取り出す
        import plateau_zip as Z
        need = set()
        for b in blds:
            for s in (b[3] or []):
                t = tex.get((b[5], s[2]))
                if t and not os.path.exists(os.path.join(a.images, t[0])) and '..' not in t[0]:
                    need.add(t[0])
        for url in a.zip:
            if not need:
                break
            E = [e for e in Z.listing(url) if '/udx/bldg/' in '/' + e['n'] and e['n'].split('udx/bldg/', 1)[1] in need and e['c'] > 0]
            for n, d in Z.read_many(url, E).items():
                rel = n.split('udx/bldg/', 1)[1]
                fn = os.path.join(a.images, rel)
                os.makedirs(os.path.dirname(fn), exist_ok=True)
                open(fn, 'wb').write(d)
                need.discard(rel)
            print('画像を取り出した:', url.rsplit('/', 1)[-1], '残り', len(need), flush=True)
        if need:
            raise SystemExit('zip に無い画像がある: ' + ' '.join(sorted(need)[:3]))
    if a.used:                                   # 足跡の1点目と高さ(0.1m 単位の整数)の組
        a.used = set((round(x * 10), round(z * 10), round(h * 10)) for x, z, h in json.load(open(a.used)))
    from PIL import Image
    keep, uv, col, canv, isl = build(blds, tex, a, proj)
    ptx, nb = encode_ptx(blds, keep, uv, col)
    atl = []
    for c in canv:
        buf = io.BytesIO()
        Image.fromarray(c).save(buf, 'JPEG', quality=a.quality, optimize=True)
        atl.append({'w': c.shape[1], 'h': c.shape[0], 'jpg': base64.b64encode(buf.getvalue()).decode('ascii')})
    import datetime
    meta = {'source': a.source, 'license': 'CC BY 4.0', 'made': datetime.date.today().isoformat(),
            'ppm': a.ppm, 'pad': a.pad, 'count': nb, 'surfaces': len(uv), 'islands': len(isl), 'atlases': atl,
            'uv64': base64.b64encode(ptx).decode('ascii')}
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('// 沿線の LOD2 の建物の写真テクスチャ(詰め合わせの画像と面ごとの座標)。出典:%s(CC BY 4.0)。'
                'tools/plateau_tex.py が作る。手で直さない\n' % a.source)
        f.write('globalThis.PLATEAU_TEX=' + json.dumps(meta, ensure_ascii=False) + ';\n')
    px = sum(c.shape[0] * c.shape[1] for c in canv)
    jb = sum(len(t['jpg']) * 3 // 4 for t in atl)
    print('写真のある建物 %d 棟・面 %d・切り出し %d・詰め合わせ %d 枚(%s)・%.1f M画素・JPEG %.2f MB・ファイル %.2f MB'
          % (nb, len(uv), len(isl), len(canv), ' '.join('%dx%d' % (c.shape[1], c.shape[0]) for c in canv),
             px / 1e6, jb / 1e6, os.path.getsize(a.out) / 1e6))


if __name__ == '__main__':
    main()
