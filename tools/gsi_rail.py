#!/usr/bin/env python3
"""国土地理院のベクトルタイル(地理院ベクトル・experimental_bvmap)から、交差鉄道の線路の位置を取り出す。

  地理院ベクトルタイルの railway 層には、基盤地図情報(1/2,500・1/500)の「軌道の中心線」が**線路ごと**に入っている
  (ftCode 2801 通常部・2802 その他・2803 橋・高架・2804 トンネル。属性に路線は無い)。路線の名前(rtCode)は
  1/25,000 の鉄道の線(ftCode 8201)にだけあるので、その線に沿う所の線路ごとの線を拾う。

  手順:
    1. 中心(--origin)のまわりの z16 のタイルを読む(--tiles にあれば使い、無ければ取りに行く)
    2. 路線の 1/25,000 の線を 2m ごとにならし(σ10m)、参照の中心線 Rc にする
    3. 線路ごとの線を 1m ごとの点にし、Rc への射影 (u, d) を取る(|d|<9m)。d の正負で2本に分ける
    4. 2m ごとの中央値で2本の d を取り、その中ほどへ Rc を寄せる(2回)。2本の d は σ3m でならす
    5. u=0 は --origin を Rc へ射影した所。u は --north の向き(北の端)へ増える。--u0〜--u1 を --step ごとに、
       2本の線路の中心の緯度・経度を書き出す(JSON。HTML の RAW.rail.<線>.tr に貼る)。線路が途切れる所(終端)は
       --u1 を超えて伸ばさない(1本でも無ければそこで切る)

  使い方(京王線の3D ビューア):
    python3 -I tools/gsi_rail.py --route 40202000101 --origin 35.668177,139.650556 --u0 -460 --u1 460 \
      --tiles <タイルの置き場> --out ino.json        # 京王井の頭線(u=0 は京王線と交わる所)
    python3 -I tools/gsi_rail.py --route 40202000203 --origin 35.666116,139.641381 --u0 -400 --u1 60 \
      --tiles <タイルの置き場> --out seta.json       # 東急世田谷線(下高井戸の終端まで)
  出典:国土地理院 地理院タイル(ベクトルタイル)。使うときは出典の表示が要る(CREDITS.txt)
"""
import argparse, json, math, os, struct, sys, urllib.request

MLAT, MLON = 110950.0, 90440.0          # ビューアの toXY と同じ 1度あたりのメートル(近似)


# ---- Mapbox Vector Tile(protobuf)を手で読む ----------------------------------------------
def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7f) << s; s += 7
        if c < 0x80: return r, i

def _fields(b):
    i, out = 0, []
    while i < len(b):
        k, i = _varint(b, i); f, t = k >> 3, k & 7
        if t == 0: v, i = _varint(b, i)
        elif t == 2: n, i = _varint(b, i); v = b[i:i + n]; i += n
        elif t == 1: v = b[i:i + 8]; i += 8
        elif t == 5: v = b[i:i + 4]; i += 4
        else: raise ValueError('protobuf の型 %d' % t)
        out.append((f, t, v))
    return out

def _zz(n): return (n >> 1) ^ (-(n & 1))

def _packed(b):
    i, r = 0, []
    while i < len(b): v, i = _varint(b, i); r.append(v)
    return r

def _value(b):
    for f, t, v in _fields(b):
        if f == 1: return v.decode('utf-8', 'replace')
        if f == 2: return struct.unpack('<f', v)[0]
        if f == 3: return struct.unpack('<d', v)[0]
        if f in (4, 5): return v
        if f == 6: return _zz(v)
        if f == 7: return bool(v)

def _geom(cmds):
    i = x = y = 0; parts = []; cur = None
    while i < len(cmds):
        c = cmds[i]; i += 1; op, n = c & 7, c >> 3
        if op in (1, 2):
            for _ in range(n):
                x += _zz(cmds[i]); y += _zz(cmds[i + 1]); i += 2
                if op == 1: cur = [(x, y)]; parts.append(cur)
                else: cur.append((x, y))
    return parts

def railway_features(data):
    """railway 層の地物:[(属性, [[(px,py)…]…], extent)]"""
    out = []
    for f, t, v in _fields(data):
        if f != 3: continue
        name = None; keys = []; vals = []; feats = []; ext = 4096
        for f2, t2, v2 in _fields(v):
            if f2 == 1: name = v2.decode()
            elif f2 == 3: keys.append(v2.decode())
            elif f2 == 4: vals.append(_value(v2))
            elif f2 == 5: ext = v2
            elif f2 == 2: feats.append(v2)
        if name != 'railway': continue
        for fb in feats:
            tags = []; g = []
            for f3, t3, v3 in _fields(fb):
                if f3 == 2: tags = _packed(v3)
                elif f3 == 4: g = _packed(v3)
            props = {keys[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags), 2)}
            out.append((props, _geom(g), ext))
    return out


# ---- 幾何 ---------------------------------------------------------------------------------
def resample(P, step):
    """折れ線を step ごとの点に"""
    out = [P[0]]; acc = 0.0
    for a, b in zip(P, P[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L == 0: continue
        t = step - acc
        while t <= L:
            out.append((a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)); t += step
        acc = (acc + L) % step
    return out

def gauss_line(P, sigma_pts):
    k = int(3 * sigma_pts) + 1; W = [math.exp(-0.5 * (j / sigma_pts) ** 2) for j in range(-k, k + 1)]
    out = []
    for i in range(len(P)):
        sx = sz = sw = 0.0
        for j in range(-k, k + 1):
            q = P[min(len(P) - 1, max(0, i + j))]; w = W[j + k]; sx += q[0] * w; sz += q[1] * w; sw += w
        out.append((sx / sw, sz / sw))
    return out

class Curve:
    def __init__(self, P):
        self.P = P; self.U = [0.0]
        for a, b in zip(P, P[1:]): self.U.append(self.U[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    def prj(self, x, z):
        best = None
        for i in range(len(self.P) - 1):
            a, b = self.P[i], self.P[i + 1]; dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz
            t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) if L2 else 0.0
            px, pz = a[0] + dx * t, a[1] + dz * t; d2 = (x - px) ** 2 + (z - pz) ** 2
            if best is None or d2 < best[0]:
                L = math.sqrt(L2) or 1; nx, nz = -dz / L, dx / L
                best = (d2, self.U[i] + t * math.sqrt(L2), (x - px) * nx + (z - pz) * nz)
        return best[1], best[2]
    def at(self, u):
        i = 0
        while i < len(self.U) - 2 and self.U[i + 1] < u: i += 1
        a, b = self.P[i], self.P[i + 1]; L = self.U[i + 1] - self.U[i] or 1; t = (u - self.U[i]) / L
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -dz, dx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--route', required=True, help='路線の rtCode(1/25,000 の鉄道の線)')
    ap.add_argument('--origin', required=True, help='u=0 の緯度,経度')
    ap.add_argument('--u0', type=float, required=True); ap.add_argument('--u1', type=float, required=True)
    ap.add_argument('--step', type=float, default=5.0)
    ap.add_argument('--tiles', required=True, help='z16 のタイルの置き場(無いタイルは取りに行く)')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    la0, lo0 = map(float, a.origin.split(','))
    toM = lambda la, lo: ((lo - lo0) * MLON, -(la - la0) * MLAT)
    toLL = lambda x, z: (la0 - z / MLAT, lo0 + x / MLON)
    Z = 16; n = 2 ** Z; R = max(-a.u0, a.u1) + 300
    def tile(la, lo): return int((lo + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n)
    xa, ya = tile(la0 + R / MLAT, lo0 - R / MLON); xb, yb = tile(la0 - R / MLAT, lo0 + R / MLON)
    os.makedirs(a.tiles, exist_ok=True)
    route, tracks = [], []
    for tx in range(xa, xb + 1):
        for ty in range(ya, yb + 1):
            p = os.path.join(a.tiles, '%d_%d_%d.pbf' % (Z, tx, ty))
            if not os.path.exists(p):
                urllib.request.urlretrieve('https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/%d/%d/%d.pbf' % (Z, tx, ty), p)
            for props, parts, ext in railway_features(open(p, 'rb').read()):
                for part in parts:
                    pts = []
                    for px, py in part:
                        lo = (tx + px / ext) / n * 360 - 180
                        la = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / ext) / n))))
                        pts.append(toM(la, lo))
                    if len(pts) < 2: continue
                    if props.get('ftCode') == 8201 and str(props.get('rtCode')) == a.route: route.append(pts)
                    elif props.get('ftCode') in (2801, 2802, 2803, 2804) and str(props.get('orgGILvl')) in ('2500', '500'): tracks.append(pts)
    if not route: sys.exit('路線 %s の線が無い' % a.route)
    # 2. 路線の線の点を南北に並べる(タイルの境で切れた片は重なるので、つながずに z の順に並べて 1m 内の点をまとめる。
    #    京王線と交わる2線はどちらも南北に単調)
    rp = sorted((p for s in route for p in resample(s, 1.0)), key=lambda p: p[1])
    dedup = [rp[0]]
    for p in rp[1:]:
        if math.hypot(p[0] - dedup[-1][0], p[1] - dedup[-1][1]) > 1.0: dedup.append(p)
    Rc = Curve(gauss_line(resample(dedup, 2.0), 5))
    # u の向き:北の端(z の小さい方)へ増える
    if Rc.P[-1][1] > Rc.P[0][1]: Rc = Curve(Rc.P[::-1])
    pts = []
    for t in tracks:
        for p in resample(t, 1.0): pts.append(p)
    for it in range(3):
        bins = {}
        for x, z in pts:
            u, d = Rc.prj(x, z)
            if abs(d) < 9 and 0 < u < Rc.U[-1]: bins.setdefault(int(u // 2), ([], []))[0 if d < 0 else 1].append(d)
        ks = sorted(bins)
        dA = {k: sorted(bins[k][0])[len(bins[k][0]) // 2] for k in ks if bins[k][0]}
        dB = {k: sorted(bins[k][1])[len(bins[k][1]) // 2] for k in ks if bins[k][1]}
        if it == 2: break
        newP = []
        for i, (x, z) in enumerate(Rc.P):
            k = int(Rc.U[i] // 2)
            if k in dA and k in dB:
                _, _, nx, nz = Rc.at(Rc.U[i]); m = (dA[k] + dB[k]) / 2; newP.append((x + m * nx, z + m * nz))
        Rc = Curve(gauss_line(resample(newP, 2.0), 3))
    # 4. u=0 と出力の範囲
    uO, _ = Rc.prj(0.0, 0.0)
    both = sorted(k for k in dA if k in dB)
    uLo, uHi = both[0] * 2 + 2 - uO, both[-1] * 2 - uO          # 2本とも線路のある所
    u0, u1 = max(a.u0, uLo), min(a.u1, uHi)
    def smooth_at(D, k):                                        # 2m の箱の d を σ3m でならす(無い箱は飛ばす)
        sx = sw = 0.0
        for j in range(-5, 6):
            if k + j in D: w = math.exp(-0.5 * (j * 2 / 3) ** 2); sx += D[k + j] * w; sw += w
        return sx / sw if sw else None
    out = {'source': '国土地理院 地理院タイル(ベクトルタイル・experimental_bvmap)railway 層の軌道の中心線(1/2,500・1/500)',
           'route': a.route, 'origin': [la0, lo0], 'step': a.step, 'u0': None, 'tr': [[], []]}
    u = math.ceil(u0 / a.step) * a.step
    out['u0'] = u
    while u <= u1 + 1e-9:
        uu = u + uO; k = int(uu // 2); x, z, nx, nz = Rc.at(uu)
        da, db = smooth_at(dA, k), smooth_at(dB, k)
        if da is None or db is None: break
        for j, d in ((0, da), (1, db)):
            la, lo = toLL(x + d * nx, z + d * nz); out['tr'][j].append([round(la, 8), round(lo, 8)])
        u += a.step
    out['n'] = len(out['tr'][0])
    gaps = [math.hypot(*(p - q for p, q in zip(toM(*A), toM(*B)))) for A, B in zip(*out['tr'])]
    out['spacing'] = [round(min(gaps), 2), round(max(gaps), 2)]
    json.dump(out, open(a.out, 'w'), ensure_ascii=False)
    print('点 %d(u %.0f〜%.0f)・線路の間 %.2f〜%.2f m' % (out['n'], out['u0'], out['u0'] + (out['n'] - 1) * a.step, *out['spacing']))

if __name__ == '__main__':
    main()
