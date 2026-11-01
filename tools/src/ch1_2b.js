/* ============ 1. 与件データ(国土地理院データ由来の実座標・WGS84) ============ */
// 線形は「京急の現況中心線(国土地理院)+別線の振り(RAW.shift)+新設区間の平滑化(RAW.smooth)」で生成する。
// 座標・振り量・縦断を直せば全構造物が自動追従する(保守はこの RAW ブロックを編集)。
// 高さ Y は標高 TP から 3.0m を引いた値(品川駅付近の低地=JR の線路の地盤を 0 にする。地形は絶対の起伏)。
const DECK_DROP=.55, GIRDER=2.4;
const Y_TP=3.0;                                        // ワールドの Y=0 の標高 TP[m]
const RAW={
 // [名称, 配線表示, タイプ, 意匠色, 工区kk, 南端緯度,南端経度, 北端緯度,北端経度](ホームの両端。南=新馬場方=s の小さい側)
 // 品川は現況の高架駅の中心から泉岳寺方へ50m(推定)。ホーム延長は東京都の資料で 品川 約221m・北品川 約113m。新馬場(既存)は 120m(推定)
 sta:[
  ['新馬場','相対式2面2線・既存高架','side',0x9aa0a6,0, 35.6160091,139.7415717, 35.6170761,139.7413543],
  ['北品川','相対式2面2線・高架','side',0x9fc4d8,1, 35.6219592,139.7394197, 35.6229576,139.7391730],   // ホーム延長 約113m(東京都の資料)
  ['品川','島式2面4線・地平(推定)','quad',0xd8183a,1, 35.6272149,139.7380781, 35.6292150,139.7381379]],
 // 京急 現況中心線:国土地理院ベクトルタイル(2500レベル)の上下線2本の中点を平滑化。北(泉岳寺)→南、10m 刻み(配列は1行1要素)
 line:[
/*@@RAWLINE@@*/
 ],
 // 別線(現況の東側へ敷設):[振り始め, 全振り開始, 全振り終了, 戻り終了(現況線の北端からの距離 m), 東への振り量 m](推定)
 shift:[[1600,1735,1985,2150,10]],
 // 新設区間の線形の平滑化(現況線の折れ=国土地理院の線形の誤差を含む を均す):[台形4点(同上の距離 m), ガウスσ m](推定)
 smooth:[
  [1380,1410,1480,1510,25],
  [1500,1580,1780,1860,50],
  [1930,1960,2040,2080,30],
  [2160,2210,2300,2350,20]],
 // 縦断:[s, レール面 Y(=TP−3.0)](推定)。間は直線勾配、折点は長さ vc の縦曲線で丸める
 //   新馬場の既存高架(TP12.0)→ 北品川の高架駅(TP17.4)→ 35‰で下り、八ツ山で JR と品川第一踏切の道路を越える
 //   → 品川は地平のホーム(TP4.9。JR 側の地盤より約1.9m 上)→ 31‰で下り、掘割を経てトンネル(泉岳寺方)へ
 prof:[
  [-646,9.0],
  [293.6,9.0],
  [563.6,14.4],
  [850.6,14.4],             // 北品川の高架駅の泉岳寺方から 35‰ で下る(八ツ山で JR を跨ぐ桁下 6.0m を取る)
  [1207.6,1.9],             // 品川駅 Y1.9(TP4.9)。東京都の標準横断図では線路は JR 側の地盤の高さ。JR の桁下と 35‰ から決まる最低の高さ(推定)
  [1683.6,1.9],
  [2653.6,-27.8]],
 vc:70,                    // 縦曲線の長さ[m](35‰の変化で半径2000m)
 dom:[-266,2024],          // 表示する線路の範囲 s(北端=トンネル坑口)
 ps:253.6,                 // 事業区間の南端(これより南=新馬場方の既存高架)。北端は掘割の先のトンネル(約1.7km・推定)
 // 除却3踏切 [名称, 緯度, 経度](現況線と道路中心線の交点。名称は東京都の資料。位置は道路中心線との交点で、品川第一・第二の割当は推定)
 xings:[
  ['品川第一',35.6243719,139.7390336],
  ['品川第二',35.624179,139.7390546],
  ['北品川第一',35.6217696,139.7395066]],   // 名称は東京都の資料(品川第一=補助第149号線・品川第二・北品川第一)
 lm:{jr:[35.6284958,139.7391795], yatsu:[35.6246108,139.7387043], shinYatsu:[35.6230604,139.7383948],
     meguro:[35.6160836,139.7415446], r15:[35.6285408,139.7375328]}
};

/* ============ 2. 平面線形エンジン(現況中心線+別線の振り+平滑化) ============ */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sstep=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const plateau=(x,c,half,taper)=>{const d=Math.abs(x-c);return d<=half?1:d>=half+taper?0:1-sstep((d-half)/taper)};
const MLAT=110952,MLON=90594;                        // 1度あたりのメートル(北緯35.62°。GRS80 の近似。tools と同じ値)
const LAT0=(RAW.sta[0][5]+RAW.sta[0][7])/2, LON0=(RAW.sta[0][6]+RAW.sta[0][8])/2;   // 原点=新馬場駅の中心
const toXY=(la,lo)=>({x:(lo-LON0)*MLON, z:-(la-LAT0)*MLAT});   // ワールド:X=東+/Z=南+(北=-Z)
// --- 現況中心線を 2m 刻みに(sc=北端からの距離) ---
const CURL=(()=>{
  const P=RAW.line.map(p=>toXY(p[0],p[1])),o={x:[],z:[],s:[]};
  const push=(x,z)=>{const n=o.x.length;o.s.push(n?o.s[n-1]+Math.hypot(x-o.x[n-1],z-o.z[n-1]):0);o.x.push(x);o.z.push(z);};
  for(let i=0;i<P.length-1;i++){const A=P[i],B=P[i+1],n=Math.max(1,Math.ceil(Math.hypot(B.x-A.x,B.z-A.z)/2));
    for(let k=0;k<n;k++)push(A.x+(B.x-A.x)*k/n, A.z+(B.z-A.z)*k/n);}
  push(P[P.length-1].x,P[P.length-1].z);
  return o;
})();
function trap(x,a,b,c,d){if(x<=a||x>=d)return 0;if(x<b)return sstep((x-a)/(b-a));if(x<=c)return 1;return 1-sstep((x-c)/(d-c));}
function eastShift(sc){let e=0;for(const r of RAW.shift)e+=r[4]*trap(sc,r[0],r[1],r[2],r[3]);return e;}
// --- 事業後の中心線(DP:南→北。s の増す向き)。現況線を東へ振り → 平滑化 → 南北を反転 ---
const DP={x:[],z:[],s:[]};
{
  const N=CURL.x.length,px=[],pz=[];
  for(let i=0;i<N;i++){
    const j0=Math.max(0,i-2),j1=Math.min(N-1,i+2);
    let tx=CURL.x[j1]-CURL.x[j0],tz=CURL.z[j1]-CURL.z[j0];const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;
    let nx=-tz,nz=tx; if(nx<0){nx=-nx;nz=-nz;}          // 線路に直角で東を向く単位ベクトル
    const e=eastShift(CURL.s[i]);
    px.push(CURL.x[i]+nx*e); pz.push(CURL.z[i]+nz*e);
  }
  for(const sm of RAW.smooth){                           // 指定区間をガウス平滑(重みは台形で滑らかに)
    const sg=sm[4],K=Math.ceil(sg*3/2),wk=[];for(let k=-K;k<=K;k++)wk.push(Math.exp(-.5*(k*2/sg)**2));
    const gx=px.slice(),gz=pz.slice();
    for(let i=0;i<N;i++){const w=trap(CURL.s[i],sm[0],sm[1],sm[2],sm[3]);if(w<=0)continue;
      let sx=0,sz=0,sw=0;for(let k=-K;k<=K;k++){const j=clamp(i+k,0,N-1);sx+=px[j]*wk[k+K];sz+=pz[j]*wk[k+K];sw+=wk[k+K];}
      gx[i]=px[i]*(1-w)+sx/sw*w;gz[i]=pz[i]*(1-w)+sz/sw*w;}
    for(let i=0;i<N;i++){px[i]=gx[i];pz[i]=gz[i];}
  }
  for(let pass=0;pass<3;pass++){                         // 移動平均(±4m)で再標本の折れを除去
    const bx=px.slice(),bz=pz.slice();
    for(let i=2;i<N-2;i++){px[i]=(bx[i-2]+bx[i-1]+bx[i]+bx[i+1]+bx[i+2])/5;pz[i]=(bz[i-2]+bz[i-1]+bz[i]+bz[i+1]+bz[i+2])/5;}
  }
  for(let i=N-1;i>=0;i--){const n=DP.x.length;
    DP.s.push(n?DP.s[n-1]+Math.hypot(px[i]-DP.x[n-1],pz[i]-DP.z[n-1]):0);DP.x.push(px[i]);DP.z.push(pz[i]);}
}
// --- 射影ヘルパ:任意座標→線路距離s・横断オフセットoff(+=s の増す向きの右=おおむね東) ---
let S_OFS=0;
function prjXY(x,z){
  let bi=0,bd=1e18;
  for(let i=0;i<DP.x.length;i+=5){const d=(DP.x[i]-x)**2+(DP.z[i]-z)**2;if(d<bd){bd=d;bi=i;}}
  let s=DP.s[bi],off=0,b2=1e18;
  for(let i=Math.max(1,bi-6);i<Math.min(DP.x.length,bi+7);i++){
    const ax=DP.x[i-1],az=DP.z[i-1],bx=DP.x[i],bz=DP.z[i];
    const dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz;if(!L2)continue;
    let u=((x-ax)*dx+(z-az)*dz)/L2;u=clamp(u,0,1);
    const cx=ax+dx*u,cz=az+dz*u,d=(cx-x)**2+(cz-z)**2;
    if(d<b2){b2=d;s=DP.s[i-1]+Math.sqrt(L2)*u;
      const iL=Math.sqrt(L2);off=((x-cx)*(-dz/iL)+(z-cz)*(dx/iL));}   // N=(-dz,dx)/|d| は s の増す向きの右
  }
  return {s:s-S_OFS,off:off};
}
const prj=(la,lo)=>{const p=toXY(la,lo);return prjXY(p.x,p.z);};
// s=0 を新馬場駅の中心に設定
S_OFS=prj(LAT0,LON0).s+S_OFS;
// --- 均一グリッドCT(10m刻み)+方位aのアンラップ → frame(s,off) ---
const CTS0=Math.ceil((DP.s[0]-S_OFS)/10)*10+10;
const CTS1=Math.floor((DP.s[DP.s.length-1]-S_OFS)/10)*10-10;
const CT={x:[],z:[],a:[]};
{
  let j=1;
  for(let s=CTS0;s<=CTS1;s+=10){
    const sa=s+S_OFS;
    while(j<DP.s.length-1&&DP.s[j]<sa)j++;
    const t=(sa-DP.s[j-1])/Math.max(1e-6,DP.s[j]-DP.s[j-1]);
    CT.x.push(DP.x[j-1]+(DP.x[j]-DP.x[j-1])*t);
    CT.z.push(DP.z[j-1]+(DP.z[j]-DP.z[j-1])*t);
    CT.a.push(0);
  }
  for(let i=0;i<CT.x.length;i++){
    const j0=Math.max(0,i-1),j1=Math.min(CT.x.length-1,i+1);
    CT.a[i]=Math.atan2(CT.z[j1]-CT.z[j0],CT.x[j1]-CT.x[j0]);
  }
  for(let i=1;i<CT.a.length;i++){   // ±π跨ぎのアンラップ
    while(CT.a[i]-CT.a[i-1]> Math.PI)CT.a[i]-=2*Math.PI;
    while(CT.a[i]-CT.a[i-1]<-Math.PI)CT.a[i]+=2*Math.PI;
  }
  for(let p2=0;p2<2;p2++){          // 方位の3点平滑化×2
    const b2=CT.a.slice();
    for(let i=1;i<CT.a.length-1;i++)CT.a[i]=(b2[i-1]+b2[i]*2+b2[i+1])/4;
  }
}
function frame(s,off){
  const f=clamp((s-CTS0)/10,0,CT.x.length-2),i=f|0,t=f-i;
  const x=CT.x[i]+(CT.x[i+1]-CT.x[i])*t, z=CT.z[i]+(CT.z[i+1]-CT.z[i])*t, a=CT.a[i]+(CT.a[i+1]-CT.a[i])*t;
  return {x:x-Math.sin(a)*off, z:z+Math.cos(a)*off, a:a};
}
function nearestS(px,pz){
  const r=prjXY(px,pz);return clamp(r.s,DOM.x0,DOM.x1);
}

/* ============ 2b. 射影による派生定数(位置はすべて実測由来) ============ */
const STA=RAW.sta.map(r=>({n:r[0],cfg:r[1],t:r[2],c:r[3],kk:r[4],
  x:(prj(r[5],r[6]).s+prj(r[7],r[8]).s)/2, half:Math.abs(prj(r[7],r[8]).s-prj(r[5],r[6]).s)/2}));
const STA_SG=STA.find(st=>st.n==='品川');          // 品川(地平・島式2面4線)
const KMA=[2.7,2.0,1.2];                           // 泉岳寺起点の営業キロ(新馬場・北品川・品川。推定)
function KM(s){                                    // s→泉岳寺起点の営業キロ(駅アンカーの区分線形。s が増えると減る)
  if(s<=STA[0].x)return KMA[0]-(s-STA[0].x)/1000;
  for(let i=0;i<STA.length-1;i++)if(s<=STA[i+1].x)
    return KMA[i]+(KMA[i+1]-KMA[i])*(s-STA[i].x)/(STA[i+1].x-STA[i].x);
  return KMA[KMA.length-1]-(s-STA[STA.length-1].x)/1000;
}
const XINGS=RAW.xings.map(g=>[g[0],prj(g[1],g[2]).s]);
const LM={};for(const k in RAW.lm)LM[k]=prj(RAW.lm[k][0],RAW.lm[k][1]);
const PS0=RAW.ps;                                  // 事業区間の南端(これより南は新馬場方の既存高架)
const DOM={x0:Math.max(CTS0+20,RAW.dom[0]), x1:Math.min(CTS1-20,RAW.dom[1]), z:520};
// --- 縦断(区分直線+縦曲線)。折点 k の前後 L/2 を放物線で置き換える(L=vc と前後区間長の小さい方) ---
function railY(s){
  const P=RAW.prof,n=P.length;
  if(s<=P[0][0])return P[0][1];
  if(s>=P[n-1][0])return P[n-1][1]+(s-P[n-1][0])*(P[n-1][1]-P[n-2][1])/(P[n-1][0]-P[n-2][0]);
  for(let k=1;k<n-1;k++){
    const v=P[k][0],L=Math.min(RAW.vc,v-P[k-1][0],P[k+1][0]-v);
    if(Math.abs(s-v)<L/2){
      const g1=(P[k][1]-P[k-1][1])/(v-P[k-1][0]), g2=(P[k+1][1]-P[k][1])/(P[k+1][0]-v);
      const u=s-(v-L/2);
      return P[k][1]-g1*L/2+g1*u+(g2-g1)*u*u/(2*L);
    }
  }
  for(let k=0;k<n-1;k++)if(s<=P[k+1][0])return P[k][1]+(s-P[k][0])*(P[k+1][1]-P[k][1])/(P[k+1][0]-P[k][0]);
  return P[n-1][1];
}
// 地上到達点(道床 0.8m)= 高架・擁壁の北端。これより北が掘割(5c章)。品川駅の北の下り勾配の上で決まる
const DECK_END=Math.round((function(){let a=STA_SG.x,b=DOM.x1;for(let k=0;k<50;k++){const m=(a+b)/2;if(railY(m)>0.8)a=m;else b=m;}return (a+b)/2;})());
// 地表の高さ。掘割(DECK_END より北)では底=道床の 0.8m 下
const floorY=x=>x<DECK_END?0:Math.min(0,railY(x)-0.8);
// 軌間(ゲージ)。京急は標準軌 1435mm。レールの敷設も車両の車輪位置も、必ずこの定数から導く
const GAUGE=1.435;                       // レール内面間距離[m]
const RAIL_W=0.072;                      // レール頭部の幅[m]
const RAIL_OFF=(GAUGE+RAIL_W)/2;         // 軌道中心からレール中心までの距離[m]=0.7535
const RAIL_TOP=0.06;                     // 道床(railY)からレール頭頂面までの高さ[m]。車両の原点もここ
/* 品川の島式2面4線(推定):内側=本線(±2.0)、外側=副本線。本線から a だけ外・一定区間の半長 h・振り分けの長さ t。
   ホームは島式2面(京王の2面4線と同じ寸法の型 quad=[±7.5,半幅3.95]・副本線 ±13.0)。分岐はホームの端の外 */
const LOOP={a:11.0,h:118,t:85};
function mainOff(x){return 2.0;}
// --- ホームの範囲と外縁(桁幅の算出と停止位置の双方が参照する) ---
const STOP_BACK=3;
function platRange(st){return [st.x-st.half, st.x+st.half];}
const STOP_ADJ={};
// 進行方向ごとの停止位置(先頭=運転台を着ける位置)。dir>0(北行き=上り)は北端に、dir<0(南行き=下り)は南端に着ける
function stopPosOf(st,dir){
  const d=(dir||1)>0?1:-1, r=platRange(st), adj=(STOP_ADJ[st.n]||0)*d;
  return (d>0 ? r[1]-STOP_BACK : r[0]+STOP_BACK) + adj;
}
// 駅種別ごとのホーム外縁[m](7章の PLT と同じ値。片方だけ変えないこと)
const PLAT_EDGE={isl:3.50, hachi:3.00, side:8.10, quad:11.45, ctx:8.55, gnd:14.55};
const PLAT_EDGE_STA={};
const platEdgeOf=st=>(PLAT_EDGE_STA[st.n]!==undefined?PLAT_EDGE_STA[st.n]:(PLAT_EDGE[st.t]||0));
function platOuter(x){                     // その地点のホーム外縁(駅を外れれば0)
  let e=0;
  for(const st of STA){
    if(st.t==='quad') continue;      // 2面4線は副本線がいつもホームの外(桁幅は副本線で決まる)
    const r=platRange(st), c=(r[0]+r[1])/2, h=(r[1]-r[0])/2+8, pe=platEdgeOf(st);
    e=Math.max(e,pe*plateau(x,c,h,Math.max(60,pe*7)));
  }
  return e;
}
function outerOff(x){   // その地点で最も外側にある軌道中心のオフセット
  let o=mainOff(x);
  for(const st of STA)if(st.t==='quad')o=Math.max(o,2.0+LOOP.a*plateau(x,st.x,LOOP.h,LOOP.t));   // 2面4線の副本線
  return o;
}
// 桁半幅:①最外軌道+2.45m ②ホーム外縁+0.6m ③複線区間の標準4.45m の最大
const DECK_MIN=2.0+2.45;
function deckHalf(x){
  return Math.max(DECK_MIN, outerOff(x)+2.45, platOuter(x)+0.6);
}
/* ---- 品川の北の掘割(5c章)の寸法。幅(片側。sg=+1:東/-1:西)は桁幅と同じ決め方 ---- */
const PLAT_EDGE_SN={};
const CUT_W={T:0.24, OUT:0.06, TOP:0.15, MID:0.09, FENCE:1.2};
const CUT_END=DOM.x1;                        // 掘割の北端(トンネル坑口。その手前は覆い=トンネルの入口で終える)
function cutHalf(x,sg){
  let e=0;
  for(const st of STA){ const E=PLAT_EDGE_SN[st.t]; if(!E) continue;
    const r=platRange(st), c=(r[0]+r[1])/2, h=(r[1]-r[0])/2+8;
    e=Math.max(e,E[sg>0?1:0]*plateau(x,c,h,60)); }
  return Math.max(DECK_MIN, outerOff(x)+2.45, e+0.6);
}
const cutWallTop=x=>Math.max(CUT_W.TOP,railY(x)+2.1);
const cutIn=(s,off,m)=>s>DECK_END&&s<CUT_END&&off>-(cutHalf(s,-1)+m)&&off<cutHalf(s,1)+m;
const CUT_BB=(function(){const b=[1e9,-1e9,1e9,-1e9];
  for(let s=DECK_END;s<=CUT_END+1e-6;s+=2) for(const sg of[-1,1]){const f=frame(s,sg*(cutHalf(s,sg)+CUT_W.OUT));
    b[0]=Math.min(b[0],f.x);b[1]=Math.max(b[1],f.x);b[2]=Math.min(b[2],f.z);b[3]=Math.max(b[3],f.z);}
  return [b[0]-1,b[1]+1,b[2]-1,b[3]+1];})();
function cutHit(px,pz,r){
  r=r||0;
  if(px<CUT_BB[0]-r||px>CUT_BB[1]+r||pz<CUT_BB[2]-r||pz>CUT_BB[3]+r) return false;
  const q=prjXY(px,pz);
  return q.s>DECK_END-r&&q.s<CUT_END+r&&cutIn(q.s,q.off,CUT_W.OUT+r);
}
const CUT_DECKS=[];
const DECK_BOT=-0.70;                        // 道路橋・覆いの床版の下端(き電ちょう架線=レール面+5.9m より 0.3m 以上上)
// 曲率[1/m]:曲線部では架線柱スパンを詰める(直線50m / 曲線25m)
function curvAt(x){
  const i=clamp(Math.round((x-CTS0)/10),1,CT.a.length-1);
  return Math.abs(CT.a[i]-CT.a[i-1])/10;
}
function poleStep(x){return (curvAt(x)>1/1200)?25:50;}
const WIRE_CAT=5.90;   // き電ちょう架線(支持点での高さ)
const WIRE_TRO=4.95;   // トロリ線(接触線)。パンタのすり板の上面と同じ
const WIRE_SAG=0.32;   // 50m の柱間の中央での垂れ
const POLE_TOP=7.40;   // 架線柱の頂部(門型ビームの上弦)
const BEAM_LOW=POLE_TOP-0.70;
/* 橋脚を省略する横断部(道路・鉄道・河川の直上に柱を立てない)。旧踏切の道路+実際の道路(4章 ROAD_XING)+JR 等の線路(下の JR_SKIP) */
const ROAD_SKIP=[];
for(const gq of XINGS)ROAD_SKIP.push([gq[1],7]);
/* JR 等の線路(国土地理院。gsi_rail.js)が高架の下を通る所:桁の両端と中心の3点のどれかが線路から 3m 以内の s の範囲を、
   柱を立てない所に足す(八ツ山跨線線路橋)。線路の点の格子は 4章でも使う */
const GSR=(typeof globalThis!=='undefined'&&globalThis.GSI_RAIL&&globalThis.GSI_RAIL.rails)?globalThis.GSI_RAIL:null;
const JR_GRID=new Map(), JR_CELL=10;
if(GSR) for(const l of GSR.rails) for(let i=0;i<l.length-1;i++){
  const A=l[i],B=l[i+1],n=Math.max(1,Math.ceil(Math.hypot(B[0]-A[0],B[1]-A[1])/2));
  for(let k=0;k<=n;k++){const x=A[0]+(B[0]-A[0])*k/n, z=A[1]+(B[1]-A[1])*k/n, key=Math.floor(x/JR_CELL)+','+Math.floor(z/JR_CELL);
    let c=JR_GRID.get(key); if(!c){c=[];JR_GRID.set(key,c);} c.push([x,z]);}
}
function jrNear(x,z,r){                     // 点の r 以内に JR 等の線路の中心があるか
  for(let gx=Math.floor((x-r)/JR_CELL);gx<=Math.floor((x+r)/JR_CELL);gx++)
    for(let gz=Math.floor((z-r)/JR_CELL);gz<=Math.floor((z+r)/JR_CELL);gz++){
      const c=JR_GRID.get(gx+','+gz); if(c) for(const p of c) if(Math.hypot(p[0]-x,p[1]-z)<r) return true;}
  return false;
}
const JR_SKIP=[];
{let a=null;
 for(let s=Math.floor(DOM.x0);s<=DECK_END+1;s++){
   const dh=deckHalf(s), on=[0,-dh,dh,-dh/2,dh/2].some(o=>{const f=frame(s,o);return jrNear(f.x,f.z,3.0);});
   if(on){ if(a===null) a=s; }
   else if(a!==null){ JR_SKIP.push([a,s-1]); ROAD_SKIP.push([(a+s-1)/2,(s-a)/2+3]); a=null; }
 }}
const PIERS=[];   // 建てた橋脚のs座標(検証用の登録簿)
const STA_BLDG=st=>(st.t!=='ctx'&&st.t!=='gnd'&&st.t!=='quad');   // 高架下駅舎を持つ駅(品川は地平なので持たない)
const STA_BLDG_HALF=23;
const BLDG_AT={};
const bldgSpan=st=>{const r=BLDG_AT[st.n]||[-STA_BLDG_HALF,STA_BLDG_HALF];return [st.x+r[0],st.x+r[1]];};
const STAIR_AT={};
const CONC_AT={}, CONC_HALF=18;
const CONC_CUT=7.02;
const concMid=st=>{const r=platRange(st);return (r[0]+r[1])/2+(CONC_AT[st.n]||0);};
CUT_DECKS.push({kind:'覆い',aS:CUT_END-20,bS:CUT_END,aN:CUT_END-20,bN:CUT_END,bot:DECK_BOT,top:0.10});
function poleOffDecks(){
  for(let i=0;i<POLE_S.length;i++){
    const s=POLE_S[i]; if(s<DECK_END) continue;
    const D=CUT_DECKS.find(d=>s>Math.min(d.aS,d.aN)-2&&s<Math.max(d.bS,d.bN)+2); if(!D) continue;
    const lo=Math.max(D.aS,D.aN)+0.3, hi=Math.min(D.bS,D.bN)-0.3;
    POLE_S[i]=lo<=hi?clamp(s,lo,hi):(lo+hi)/2;
  }
  POLE_S.sort((p,q)=>p-q);
  for(let i=POLE_S.length-1;i>0;i--) if(POLE_S[i]>DECK_END&&POLE_S[i]-POLE_S[i-1]<12) POLE_S.splice(i,1);
}
/* 大屋根の駅(7章):品川(島式2面4線)・北品川(相対式)。新馬場は既存の片持ちの上屋(推定)。
   大屋根の下には架線柱を建てず、架線は屋根の梁から可動ブラケットで吊る(6b章 buildCatenary) */
const BIGROOF=st=>(st.n==='品川'||st.n==='北品川');
const staRoofHalf=st=>st.half+3;                   // 大屋根の半長[m](ホームの半長+3m)
const STA_ROOF_HALF=Math.max(...STA.map(staRoofHalf));
const inStaRoof=s=>STA.some(st=>BIGROOF(st)&&Math.abs(s-st.x)<staRoofHalf(st));
// --- 工区(事業区間を1つにまとめる。南=既存高架/北=掘割) ---
const KOUKU=[
 {no:1,s0:PS0,s1:DECK_END,sh:'品川',name:'泉岳寺〜新馬場間 連続立体交差事業(品川駅付近 地平化・北品川駅付近 高架化)',jv:'',m:'',note:'工区の割り振りは未反映(推定の1工区)。'},
];
// --- 架線柱のs座標(全線)。柱の建植・架線の吊り点・ブラケットは、すべてこの配列だけを見る ---
const POLE_S=(function(){
  const out=[];
  const add=(r0,r1)=>{for(let x=r0+22;x<r1-8;x+=poleStep(x))out.push(x);};
  add(DOM.x0,PS0);
  for(const K of KOUKU)add(K.s0,K.s1);
  for(let x=DECK_END+15;x<DOM.x1-8;x+=poleStep(x))out.push(x);
  return out.sort((a,b)=>a-b);
})();

