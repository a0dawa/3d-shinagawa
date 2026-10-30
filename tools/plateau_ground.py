# -*- coding: utf-8 -*-
"""PLATEAU の建築物の地盤の高さ(LOD1 の立体の最も低い標高)を、plateau_bldg.js と同じ建物の並びで書き出す。
地形(plateau_dem.js)の検証の基準(tools/verify_city.js の「地形」)に使う。建物の地盤の高さは地形モデル(dem)とは別の
データ(bldg)なので、ビューアの地形の起伏が実際の建物の地盤の高さの差と合うかを独立に確かめられる。

  python3 -I tools/plateau_ground.py --html keio_elevated_3d.html --bldg plateau_bldg.js \
      --out reference/plateau/bldg_ground.json <建築物の CityGML(bldg/*.gml)…>

  ・建物の並びは plateau_import.py と同じ読み方(同じ引数)で作り直し、plateau_bldg.js の PLT1 とバイト単位で一致することを
    確かめてから書く(一致しなければ止まる)。GML は plateau_bldg.js を作ったときと同じ順に渡す
  出力:{source, license, made, n, z0, q, b64}。b64 = 建物ごとの (標高 − z0)/q の uint16(リトルエンディアン。65535=立体が無い)
  ライセンス:PLATEAU のデータは CC BY 4.0。入力は外部のデータなので、DOCTYPE/ENTITY を含むファイルは読まない(plateau_import と同じ)。
"""
import argparse
import base64
import datetime
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plateau_import as PI   # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--html', default='keio_elevated_3d.html')
    ap.add_argument('--bldg', default='plateau_bldg.js', help='一致を確かめる建物のデータ')
    ap.add_argument('--margin', type=float, default=600.0)
    ap.add_argument('--min-area', type=float, default=25.0)
    ap.add_argument('--tol', type=float, default=0.5)
    ap.add_argument('--band', type=float, default=540.0)
    ap.add_argument('--q', type=float, default=0.05, help='標高の刻み[m]')
    ap.add_argument('--out', default='reference/plateau/bldg_ground.json')
    ap.add_argument('--source', default='国土交通省 3D都市モデル(Project PLATEAU)')
    ap.add_argument('gml', nargs='+')
    a = ap.parse_args()
    proj = PI.html_projection(a.html)
    blds = []
    for g in a.gml:
        n0 = len(blds)
        blds += PI.read_buildings(g, proj, a.margin, a.min_area, a.tol, a.band, zmin=True)
        print('  %s: 建物 %d' % (os.path.basename(g), len(blds) - n0), flush=True)
    src = open(a.bldg, encoding='utf-8').read()
    D = json.loads(src[src.index('{'):src.rindex('}') + 1])
    if PI.encode([b[:5] for b in blds]) != base64.b64decode(D['b64']):
        raise SystemExit('plateau_bldg.js と建物の並びが一致しない(引数・HTML の射影・GML の順を確かめる)')
    zs = [b[5] for b in blds]
    ok = [z for z in zs if not math.isnan(z)]
    z0 = math.floor(min(ok))
    vals = [65535 if math.isnan(z) else int(round((z - z0) / a.q)) for z in zs]
    if max(v for v in vals if v != 65535) >= 65535:
        raise SystemExit('標高の幅が uint16 に入らない')
    out = {'source': a.source, 'license': 'CC BY 4.0', 'made': datetime.date.today().isoformat(),
           'note': 'plateau_bldg.js(PLT1)と同じ並びの建物ごとの地盤の高さ(LOD1 の立体の最も低い標高[m])。tools/plateau_ground.py が作る',
           'n': len(vals), 'z0': z0, 'q': a.q,
           'b64': base64.b64encode(struct.pack('<%dH' % len(vals), *vals)).decode('ascii')}
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
        f.write('\n')
    print('plateau_bldg.js と一致:建物 %d(地盤の高さあり %d)・%.1f〜%.1fm・%.0f KB'
          % (len(vals), len(ok), min(ok), max(ok), os.path.getsize(a.out) / 1e3))


if __name__ == '__main__':
    main()
