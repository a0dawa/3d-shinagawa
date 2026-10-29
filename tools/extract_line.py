# -*- coding: utf-8 -*-
"""京急 現況中心線の抽出(作業ディレクトリ=data/raw)。
  手順1: 25000レベルの京急路線(rtCode 40202000122)の粗い中心線を案内線にする
  手順2: 2500レベルの各線(1本ずつの線路)を点群化し、案内線の左右で「間隔3.2〜4.6mの2線」を探して中点を取る
  手順3: 補正量を外れ値除去+ガウス平滑(σ=25m)して center_ref.json(10m刻み・北→南)を出力
  使い方: cd data/raw && python3 ../../tools/extract_line.py
"""
import json, math
import numpy as np
d=json.load(open('gsi/all.json'))
LAT0, LON0 = 35.6280, 139.7395
KX=111320*math.cos(math.radians(LAT0)); KY=110940
def xy(c): return ((c[1]-LON0)*KX, (c[0]-LAT0)*KY)
def ll(x,y): return (LAT0+y/KY, LON0+x/KX)
# 粗い中心線(北→南):25000レベル京急(rtCode 40202000122)の頂点を北から順に並べたもの
chain=[(80,1262),(16,1118),(-78,829),(-88,764),(-116,592),(-122,494),(-122,475),(-118,269),(-121,85),(-131,-141),(-114,-226),(-85,-328),(-49,-370),(-28,-570),(-10,-662),(14,-722),(31,-757),(109,-919),(162,-1174),(169,-1217),(175,-1257),(195,-1372),(253,-1713)]
# 案内線を5m刻みに再標本
g=np.array(chain,float)
L=np.r_[0,np.cumsum(np.hypot(*np.diff(g,axis=0).T))]
S=np.arange(0,L[-1],5.0)
G=np.c_[np.interp(S,L,g[:,0]),np.interp(S,L,g[:,1])]
# 2500レベル線の頂点を高密度化して点群に
pts=[]; kinds=[]
for f in d['railway']:
    p=f['p']
    if p.get('orgGILvl')!='2500': continue
    ls=[f['c']] if f['t']=='LineString' else (f['c'] if f['t']=='MultiLineString' else [])
    for l in ls:
        q=[xy(c) for c in l]
        for (ax,ay),(bx,by) in zip(q,q[1:]):
            n=max(1,int(math.hypot(bx-ax,by-ay)/1.0))
            for k in range(n):
                pts.append((ax+(bx-ax)*k/n, ay+(by-ay)*k/n)); kinds.append(p['ftCode'])
pts=np.array(pts); kinds=np.array(kinds)
np.save('rail_pts.npy',pts); np.save('rail_kind.npy',kinds)
out=[]
for i in range(len(S)):
    j0=max(0,i-1); j1=min(len(S)-1,i+1)
    t=G[j1]-G[j0]; t/=np.linalg.norm(t); n=np.array([-t[1],t[0]])
    dv=pts-G[i]; along=dv@t; perp=dv@n
    m=(np.abs(along)<2.5)&(np.abs(perp)<14)
    out.append((S[i], G[i][0],G[i][1], sorted(np.round(perp[m]).astype(int).tolist())))
json.dump([[a,b,c,sorted(set(e))] for a,b,c,e in out],open('perp.json','w'))

# ---- 手順2 ----
import numpy as np
pts=np.load('rail_pts.npy')
chain=[(80,1262),(16,1118),(-78,829),(-88,764),(-116,592),(-122,494),(-122,475),(-118,269),(-121,85),(-131,-141),(-114,-226),(-85,-328),(-49,-370),(-28,-570),(-10,-662),(14,-722),(31,-757),(109,-919),(162,-1174),(169,-1217),(175,-1257),(195,-1372),(253,-1713)]
g=np.array(chain,float)
L=np.r_[0,np.cumsum(np.hypot(*np.diff(g,axis=0).T))]
S=np.arange(0,L[-1],10.0)
G=np.c_[np.interp(S,L,g[:,0]),np.interp(S,L,g[:,1])]
res=[]
for i in range(len(S)):
    j0=max(0,i-1); j1=min(len(S)-1,i+1)
    t=G[j1]-G[j0]; t/=np.linalg.norm(t); n=np.array([-t[1],t[0]])   # n=左(進行方向南下時=東)
    dv=pts-G[i]; along=dv@t; perp=dv@n
    m=(np.abs(along)<3)&(np.abs(perp)<9)
    v=np.sort(perp[m])
    # クラスタ化(1.2m以内を同一線)
    cl=[]
    for x in v:
        if cl and x-cl[-1][-1]<1.2: cl[-1].append(x)
        else: cl.append([x])
    c=[float(np.mean(k)) for k in cl]
    # 間隔3.2〜4.6mの組で中点が0に最も近いもの
    best=None
    for a in range(len(c)):
        for b in range(a+1,len(c)):
            sp=c[b]-c[a]
            if 3.2<=sp<=4.6:
                mid=(c[a]+c[b])/2
                if best is None or abs(mid)<abs(best[0]): best=(mid,sp)
    res.append((S[i],G[i],best,c))
json.dump([[float(s),float(p[0]),float(p[1]),None if b is None else b[0]] for s,p,b,c in res],open('center_raw.json','w'))

# ---- 手順3 ----
r=json.load(open('center_raw.json'))
S=np.array([a[0] for a in r]); P=np.array([[a[1],a[2]] for a in r]); M=[a[3] for a in r]
ok=np.array([m is not None and abs(m)<8 for m in M])
# 曖昧区間(駅構内 1250-1430 等)は補正0とみなす点を明示
force0=(S>1250)&(S<1430)
mv=np.array([m if (m is not None and abs(m)<8) else 0 for m in M],float)
use=ok|force0
mv[force0]=0
# 外れ値除去:近傍中央値との差>1.8mを除外
from statistics import median
for i in np.where(use)[0]:
    nb=[mv[j] for j in range(max(0,i-3),min(len(S),i+4)) if use[j] and j!=i]
    if nb and abs(mv[i]-median(nb))>1.8 and not force0[i]: use[i]=False
corr=np.interp(S,S[use],mv[use])
# 平滑化(ガウス σ=25m)
k=np.exp(-0.5*((np.arange(-8,9)*10)/25.0)**2); k/=k.sum()
cp=np.pad(corr,8,mode='edge'); corr_s=np.convolve(cp,k,mode='valid')
T=np.gradient(P,axis=0); T/=np.linalg.norm(T,axis=1)[:,None]; N=np.c_[-T[:,1],T[:,0]]
Q=P+N*corr_s[:,None]
json.dump(Q.round(2).tolist(),open('center_ref.json','w'))
