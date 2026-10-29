# GSI ベクトルタイル(z16)を範囲取得し、railway/road/building 等を緯度経度の GeoJSON 風 JSON に変換
import math, json, os, sys, subprocess
import mapbox_vector_tile as m
OUT = sys.argv[1]
Z = 16
def tile(lat, lon):
    n = 2**Z
    x = (lon+180)/360*n
    r = math.radians(lat)
    y = (1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n
    return x, y
x0, y0 = tile(35.6420, 139.7330)
x1, y1 = tile(35.6150, 139.7470)
feats = {}
for tx in range(int(x0), int(x1)+1):
    for ty in range(int(y0), int(y1)+1):
        p = os.path.join(OUT, f'{tx}_{ty}.pbf')
        if not os.path.exists(p):
            subprocess.run(['curl','-sS','-m','30','-o',p,f'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{Z}/{tx}/{ty}.pbf'],check=True)
        d = m.decode(open(p,'rb').read())
        for lname, layer in d.items():
            ext = layer.get('extent', 4096)
            def cv(c):
                X = (tx + c[0]/ext)/2**Z*360-180
                Y = ty + 1 - c[1]/ext  # mapbox_vector_tile は y 上向き
                lat = math.degrees(math.atan(math.sinh(math.pi*(1-2*Y/2**Z))))
                return [round(lat,7), round(X,7)]
            for f in layer['features']:
                g = f['geometry']; t = g['type']; cs = g['coordinates']
                if t == 'Point': cs = cv(cs)
                elif t == 'LineString': cs = [cv(c) for c in cs]
                elif t == 'MultiLineString': cs = [[cv(c) for c in l] for l in cs]
                elif t == 'Polygon': cs = [[cv(c) for c in l] for l in cs]
                elif t == 'MultiPolygon': cs = [[[cv(c) for c in l] for l in pg] for pg in cs]
                feats.setdefault(lname, []).append({'p': f['properties'], 't': t, 'c': cs})
json.dump(feats, open(os.path.join(OUT,'all.json'),'w'), ensure_ascii=False)
for k,v in feats.items(): print(k, len(v))
