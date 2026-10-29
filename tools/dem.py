# 地理院 DEM5A(PNG標高タイル z15)を取得し、局所座標の等間隔グリッド(npy)にする
import math, os, subprocess, sys
import numpy as np
from PIL import Image
Z=15
LAT0, LON0 = 35.6280, 139.7395
KX=111320*math.cos(math.radians(LAT0)); KY=110940
def tile(lat, lon):
    n=2**Z; r=math.radians(lat)
    return (lon+180)/360*n, (1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n
cache={}
def tileimg(tx,ty,kind):
    k=(tx,ty,kind)
    if k in cache: return cache[k]
    p=f'dem/{kind}_{tx}_{ty}.png'
    if not os.path.exists(p):
        subprocess.run(['curl','-sS','-m','30','-o',p,f'https://cyberjapandata.gsi.go.jp/xyz/{kind}/{Z}/{tx}/{ty}.png'])
    try: a=np.array(Image.open(p).convert('RGB')).astype(np.int64)
    except Exception: a=None
    cache[k]=a; return a
def h_at(x,y):
    lat=LAT0+y/KY; lon=LON0+x/KX
    fx,fy=tile(lat,lon); tx,ty=int(fx),int(fy)
    for kind in ('dem5a_png','dem5b_png','dem_png'):
        a=tileimg(tx,ty,kind)
        if a is None: continue
        px=min(255,int((fx-tx)*256)); py=min(255,int((fy-ty)*256))
        R,G,B=a[py,px]; v=R*65536+G*256+B
        if v==8388608: continue
        if v>8388608: v-=16777216
        return v*0.01
    return float('nan')
X0,X1,Y0,Y1,ST=-800,850,-1800,1300,5
xs=np.arange(X0,X1+1,ST); ys=np.arange(Y0,Y1+1,ST)
H=np.array([[h_at(x,y) for x in xs] for y in ys])
np.save('dem_grid.npy',H)
print(H.shape, np.nanmin(H), np.nanmax(H), np.isnan(H).sum())
