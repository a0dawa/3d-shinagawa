# -*- coding: utf-8 -*-
"""線路の帯にかかる3次メッシュ(JIS X 0410 の 1km 区画。PLATEAU の CityGML はこの単位のファイル)を数える。
新しい線区で PLATEAU のどのファイルを取り出せばよいかを決めるのに使う(HANDOVER_NEW_LINE.md の5章)。

  python3 -I tools/plateau_meshes.py --html keio_elevated_3d.html [--band 650] [--ext 600]
  python3 -I tools/plateau_meshes.py --pts 35.6737,139.6673 35.6620,139.5851 [--band 650]

  ・駅の中心(HTML の RAW.sta の東端と西端の中点。plateau_import.py と同じ読み方)を結ぶ折れ線を、両端で ext [m]
    延ばし、その両側 band [m] の帯にかかるメッシュを全部出す。--pts で緯度,経度の点を直接渡してもよい
    (駅間で線路が駅を結ぶ折れ線から大きく外れる線区は、曲線の中ほどの点も足す)。
  ・帯の端でかすめるだけのメッシュも出るので、多めになる(京王 笹塚〜仙川で 23枚。取り込みに使ったのは 22枚)。
  ・1度あたりの距離はその緯度で計算する(HTML の MLAT/MLON は 35.67° の値で、別の緯度では使えない)。
  ・2次メッシュ(10km。土地利用 luse のファイル)は8桁の先頭6桁。
"""
import argparse
import math
import re


def mesh3(lat, lon):
    """3次メッシュのコード(8桁)。1次=緯度×1.5 の整数部・経度−100、2次=その端数×8、3次=さらに端数×10"""
    a = lat * 1.5
    p, u = int(a), int(lon) - 100
    q, v = int((a - p) * 8), int((lon - int(lon)) * 8)
    r, w = int((a * 8 - int(a * 8)) * 10), int((lon * 8 - int(lon * 8)) * 10)
    return '%02d%02d%d%d%d%d' % (p, u, q, v, r, w)


def deg_len(lat):
    """緯度 lat[°] での 1度あたりの南北・東西の距離[m](WGS84 の近似式)"""
    f = math.radians(lat)
    mlat = 111132.92 - 559.82 * math.cos(2 * f) + 1.175 * math.cos(4 * f)
    mlon = 111412.84 * math.cos(f) - 93.5 * math.cos(3 * f)
    return mlat, mlon


def meshes(pts, band, ext=600.0, step=25.0):
    lat0 = sum(p[0] for p in pts) / len(pts)
    mlat, mlon = deg_len(lat0)
    xy = [((lo - pts[0][1]) * mlon, (la - pts[0][0]) * mlat) for la, lo in pts]

    def extend(a, b):
        dx, dy = a[0] - b[0], a[1] - b[1]
        n = math.hypot(dx, dy) or 1
        return (a[0] + dx / n * ext, a[1] + dy / n * ext)
    if len(xy) >= 2:
        xy = [extend(xy[0], xy[1])] + xy + [extend(xy[-1], xy[-2])]
    out = set()
    for (x0, y0), (x1, y1) in zip(xy, xy[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6:
            continue
        n = max(1, int(L / step))
        tx, ty = (x1 - x0) / L, (y1 - y0) / L
        for i in range(n + 1):
            x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            for k in range(-int(band / step), int(band / step) + 1):
                o = k * step
                px, py = x - ty * o, y + tx * o
                out.add(mesh3(pts[0][0] + py / mlat, pts[0][1] + px / mlon))
    return sorted(out)


def html_stations(path):
    src = open(path, encoding='utf-8').read()
    sta = re.findall(r"\['([^']+)','[^']*','\w+',0x[0-9a-f]+,\d+, ([\d.]+),([\d.]+), ([\d.]+),([\d.]+)\]", src)
    if len(sta) < 2:
        raise SystemExit('HTML に駅の座標(RAW.sta の行)が見つからない')
    return [((float(a) + float(c)) / 2, (float(b) + float(d)) / 2) for _, a, b, c, d in sta]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=None, help='駅の座標を読む HTML(RAW.sta の行の形は plateau_import.py と同じ)')
    ap.add_argument('--pts', nargs='*', default=[], help='緯度,経度 の点(線路に沿って順に)')
    ap.add_argument('--band', type=float, default=650.0, help='折れ線の両側の幅[m]')
    ap.add_argument('--ext', type=float, default=600.0, help='両端で折れ線を延ばす長さ[m]')
    a = ap.parse_args()
    pts = [tuple(float(t) for t in p.split(',')) for p in a.pts] if a.pts else html_stations(a.html or 'keio_elevated_3d.html')
    m = meshes(pts, a.band, a.ext)
    print('3次メッシュ %d枚:' % len(m), ' '.join(m))
    print('2次メッシュ(土地利用 luse):', ' '.join(sorted(set(c[:6] for c in m))))


if __name__ == '__main__':
    main()
