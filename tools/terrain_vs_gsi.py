# -*- coding: utf-8 -*-
"""モデルの地面の標高 TP を、国土地理院の標高タイル DEM5A(dem5a_png。z15)と比べる(品川版)。
姉妹作 3d-togoshikoen の terrain_vs_gsi.py を、品川の地形(絶対の標高+線路の帯は地盤にそろえる)に合わせたもの。

  使い方: node tools/terrain_points.js keikyu_shinagawa_3d.html > points.json
          python3 -I tools/terrain_vs_gsi.py points.json [--bin 100] [--check]
  ・タイルの標高は (R×65536+G×256+B)/100 m(R=128,G=0,B=0 = 8388608 は欠測)。出典:国土地理院
  ・区間(線路からの距離 off)ごとに分けて見る:
      帯(|off|≤21m)  … 線路の地盤 Gs(s)(60m のぼかし)にそろえる設計。DEM とは違って当然(参考表示。判定しない)
      境(21〜61m)   … 帯から地形へなじませる区間(参考)
      地形(61〜480m) … 標高のまま。ここを判定する(基準面のずれ・RMSE・95%点)
      遠(480m〜)     … 平らへ消える区間(参考)
  ・--bin M:線路に沿う距離 s を M[m] ごとに分け、区間ごとの中央値(一定のずれ)を引いた残差も出す(基準が区間ごとに違う方式の見方)
  ・独立した検証ではない:モデルの標高は東京都の区部点群のグリッドDEM(0.5m)から、比べる相手は国土地理院の DEM5A。
    どちらも航空レーザ測量が元で近いが、データの取得元・格子・処理は別。DEM5A は橋・構造物の上面を拾うので、線路沿いでは差が出る(仕様)
  ・--check:判定(地形の区間で 基準面のずれ 0.1m 以内・RMSE 1.0m 以内・95%点 2.0m 以内)を満たさなければ終了コード 1。ネットに繋がらなければ SKIP(終了コード 0)
  依存:numpy・Pillow
"""
import io, json, math, sys, urllib.request
import numpy as np
from PIL import Image

Z = 15
cache = {}
# 判定の基準(地形の区間)。RMSE 1.0m は台地の崖(御殿山など)で 10m 格子→25m の網にした誤差と DEM5A のタイル(約4m の画素)の最近傍を含む。
# 平地(標高 3m 未満)だけなら 0.44m、傾斜地で 0.7〜1.2m(2026-11-21 の測定)。基準を通すために緩めたのではなく、傾斜地の分を見込んだ値
BIAS_MAX, RMSE_MAX, P95_MAX = 0.10, 1.00, 2.00


def tile(tx, ty):
    k = (tx, ty)
    if k not in cache:
        try:
            b = urllib.request.urlopen('https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/%d/%d/%d.png' % (Z, tx, ty), timeout=30).read()
            a = np.array(Image.open(io.BytesIO(b)).convert('RGB')).astype(np.int64)
            v = a[:, :, 0] * 65536 + a[:, :, 1] * 256 + a[:, :, 2]
            cache[k] = np.where(v == 8388608, np.nan, np.where(v < 8388608, v, v - 16777216) / 100.0)
        except Exception:
            cache[k] = None
    return cache[k]


def elev(lat, lon):
    n = 2 ** Z
    fx = (lon + 180) / 360 * n
    fy = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    tx, ty = int(fx), int(fy)
    t = tile(tx, ty)
    if t is None:
        return None
    v = t[min(255, int((fy - ty) * 256)), min(255, int((fx - tx) * 256))]
    return None if np.isnan(v) else float(v)


ZONES = [('帯(≤21m)', 0, 21, False), ('境(21〜61m)', 21, 61, False), ('地形(61〜480m)', 61, 480, True), ('遠(480m〜)', 480, 1e9, False)]


def stats(name, d, judged):
    if len(d) == 0:
        print('  %-14s 点 0' % name); return None
    bias = float(np.median(d)); r = d - bias
    rmse0 = float(np.sqrt(np.mean(d ** 2)))   # ずれを引かない RMSE(地形のなじみ具合)
    print('  %-14s n=%3d  ずれ(地理院−モデル)の中央値 %+.2f m・ずれを引いた RMSE %.2f m・95%%点 %.2f m・最大 %.2f m・引かない RMSE %.2f m%s'
          % (name, len(d), bias, math.sqrt(np.mean(r ** 2)), np.percentile(np.abs(r), 95), np.max(np.abs(r)), rmse0, '  ←判定' if judged else ''))
    return bias, rmse0, float(np.percentile(np.abs(d), 95))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    binw = 0
    if '--bin' in sys.argv:
        binw = float(sys.argv[sys.argv.index('--bin') + 1]); args = [a for a in args if a != str(sys.argv[sys.argv.index('--bin') + 1])]
    d = json.load(open(args[0], encoding='utf-8'))
    rows = [(p['y'], e, abs(p['off']), p['s'], 1 if p.get('inDom', True) else 0) for p in d['pts'] for e in [elev(p['lat'], p['lon'])] if e is not None]
    bad = sum(1 for v in cache.values() if v is None)
    if not rows or bad == len(cache):
        print('SKIP: 国土地理院の標高タイルに繋がらない'); return 0
    a = np.array(rows); diff = a[:, 1] - a[:, 0]
    print('線路の区間の外(s が DOM の外。端の先は平らへ消える設計)の点 %d を除いて見る' % int((a[:, 4] == 0).sum()))
    a = a[a[:, 4] == 1]; diff = a[:, 1] - a[:, 0]
    print('点 %d(失敗したタイル %d/%d)・モデルの標高 %.1f〜%.1f m・地理院 %.1f〜%.1f m(起伏 %.1f m)'
          % (len(a), bad, len(cache), a[:, 0].min(), a[:, 0].max(), a[:, 1].min(), a[:, 1].max(), a[:, 1].max() - a[:, 1].min()))
    res = {}
    for name, lo, hi, j in ZONES:
        m = (a[:, 2] >= lo) & (a[:, 2] < hi)
        res[name] = stats(name, diff[m], j)
    if binw:
        print('区間(s を %.0fm ごと)の中央値を引いた残差(地形の区間):' % binw)
        m = (a[:, 2] >= 61) & (a[:, 2] < 480)
        k = np.floor(a[m, 3] / binw); dd = diff[m]; rr = np.empty_like(dd)
        for kk in np.unique(k):
            rr[k == kk] = dd[k == kk] - np.median(dd[k == kk])
        print('  RMSE %.2f m・95%%点 %.2f m(区間 %d)' % (math.sqrt(np.mean(rr ** 2)), np.percentile(np.abs(rr), 95), len(np.unique(k))))
    if '--check' in sys.argv:
        r = res['地形(61〜480m)']
        if r is None: print('FAIL: 地形の区間に点が無い'); return 1
        bias, rmse0, p95 = r
        ok = abs(bias) <= BIAS_MAX and rmse0 <= RMSE_MAX and p95 <= P95_MAX
        print('%s: 基準面のずれ %+.2f m(≤%.2f)・引かない RMSE %.2f m(≤%.2f)・95%%点 %.2f m(≤%.2f)' % ('OK' if ok else 'FAIL', bias, BIAS_MAX, rmse0, RMSE_MAX, p95, P95_MAX))
        return 0 if ok else 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
