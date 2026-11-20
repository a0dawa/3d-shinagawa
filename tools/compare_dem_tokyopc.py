# 現行の地形(plateau_dem.js)と 0.5m の GeoTIFF(tokyopc-23ku-2024。空のフォルダ tpc/tifs/ に展開)を同じ 3,000 点で比べる。比較用の以前の DEM5A 版は plateau_dem_5a.js として渡す想定(パスは冒頭を直す)
import json,glob,sys,base64,re,math
import numpy as np, tifffile
from pyproj import Transformer
# 現行の地形(国土地理院 DEM5A の 10m 格子)
js=open('/home/user/3d-shinagawa/plateau_dem.js',encoding='utf-8').read()
D=json.loads(js[js.index('{'):js.rindex('}')+1])
nx,nz,dx,x0,z0,h0,q=D['nx'],D['nz'],D['dx'],D['x0'],D['z0'],D['h0'],D['q']
rows=np.frombuffer(base64.b64decode(D['r64']),'<u2').reshape(-1,2)
hv=np.frombuffer(base64.b64decode(D['h64']),'<u2'); G=np.full((nz,nx),np.nan); k=0
for j in range(nz):
    i0,n=rows[j]
    for i in range(n):
        v=hv[k]; k+=1; G[j,i0+i]=np.nan if v==65535 else h0+v*q
# 0.5m DEM モザイク
tiles=[]
for f in glob.glob('tpc/tifs/*.tif'):
    p=tifffile.TiffFile(f).pages[0]; tg={g.name:g.value for g in p.tags.values()}
    a=p.asarray().astype(np.float32); a[a<-1000]=np.nan; tp=tg['ModelTiepointTag']; tiles.append((tp[3],tp[4],a))
e0=min(t[0] for t in tiles); n1=max(t[1] for t in tiles); e1=max(t[0]+t[2].shape[1]*.5 for t in tiles); n0=min(t[1]-t[2].shape[0]*.5 for t in tiles)
W,H=int(round((e1-e0)/.5)),int(round((n1-n0)/.5)); M=np.full((H,W),np.nan,np.float32)
for te,tn,a in tiles:
    c,r=int(round((te-e0)/.5)),int(round((n1-tn)/.5)); M[r:r+a.shape[0],c:c+a.shape[1]]=a
print('mosaic',W,H,'欠け %.2f%%'%(100*np.isnan(M).mean()))
LAT0=(35.6160091+35.6170761)/2; LON0=(139.7415717+139.7413543)/2; MLAT,MLON=110952,90594
tr=Transformer.from_crs('EPSG:6668','EPSG:6677')
rng=np.random.default_rng(1)
jj,ii=np.where(~np.isnan(G)); sel=rng.choice(len(jj),3000,replace=False); jj,ii=jj[sel],ii[sel]
X=x0+(ii+.5)*dx; Z=z0+(jj+.5)*dx
nn,ee=tr.transform(LAT0-Z/MLAT,LON0+X/MLON)
c=np.round((ee-e0)/.5).astype(int); r=np.round((n1-nn)/.5).astype(int)
k=10  # 10m 箱=20画素
out=[]
for cc,rr,j,i in zip(c,r,jj,ii):
    if cc-k<0 or rr-k<0 or cc+k>=W or rr+k>=H: out.append(np.nan); continue
    b=M[rr-k:rr+k,cc-k:cc+k]; out.append(np.nanmean(b) if np.isfinite(b).any() else np.nan)
out=np.array(out); ours=G[jj,ii]; m=np.isfinite(out)
d=ours[m]-out[m]
print('点',m.sum(),'差(5A-0.5m) 平均 %.2f 標準偏差 %.2f 中央値 %.2f |差|>1m %.1f%% >2m %.1f%% 最大 %.1f 最小 %.1f'%(d.mean(),d.std(),np.median(d),100*(abs(d)>1).mean(),100*(abs(d)>2).mean(),d.max(),d.min()))
np.save('cmp_pts.npy',np.c_[X[m],Z[m],ours[m],out[m]])

# 八ツ山橋付近(橋の上面を地表に持つか):線路に沿う断面で 5A と 0.5m を比べる
def at05(x,z):
    nn,ee=tr.transform(LAT0-z/MLAT,LON0+x/MLON); cc=int(round((ee-e0)/.5)); rr=int(round((n1-nn)/.5)); b=M[rr-4:rr+4,cc-4:cc+4]
    return float(np.nanmean(b)) if np.isfinite(b).any() else float('nan')
def at5a(x,z):
    fi=(x-x0)/dx-.5; fj=(z-z0)/dx-.5; i=int(np.floor(fi)); j=int(np.floor(fj)); u=fi-i; v=fj-j
    return float(G[j,i]*(1-u)*(1-v)+G[j,i+1]*u*(1-v)+G[j+1,i]*(1-u)*v+G[j+1,i+1]*u*v)
for name,(x,z,tx,tz) in {'八ツ山(線路に沿う)':(-295,-744,-.21,.98),'八ツ山(線路を横切る)':(-295,-744,.98,.21)}.items():
    print(name); print(' u    5A    0.5m')
    for u in range(-72,73,12): print('%4d %6.2f %6.2f'%(u,at5a(x+tx*u,z+tz*u),at05(x+tx*u,z+tz*u)))
