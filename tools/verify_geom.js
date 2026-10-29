// 数値検証:線形・縦断・構造・自動運転を「数値で」確認する(見た目の確認の代わり)
//   使い方: node tools/verify_geom.js [keikyu_shinagawa_3d.html]
//   HTML内の<script>を harness と同じスタブ環境で実行し、末尾に検査コードを足して評価する。
//   判定:NG が1つでもあれば終了コード1。推定値に依存する項目は「参考」として表示のみ。
const fs = require('fs');
const path = process.argv[2] || 'keikyu_shinagawa_3d.html';
const html = fs.readFileSync(path, 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const anything = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'length' ? 0 : anything),
  apply: () => anything, construct: () => anything, set: () => true,
});
global.THREE = anything;
global.Image = class { set src(v) { if (this.onload) this.onload(); } };
global.document = new Proxy({}, { get: (t, k) => {
  if (k === 'getElementById' || k === 'querySelector') return () => anything;
  if (k === 'createElement') return () => ({ getContext: () => anything, style: {}, width: 0, height: 0 });
  if (k === 'addEventListener') return () => {};
  return anything; } });
global.window = global;
global.navigator = { userAgent: 'node', maxTouchPoints: 0 };
global.screen = { width: 1920, height: 1080 };
global.performance = { now: () => 0 };
global.devicePixelRatio = 1; global.innerWidth = 1920; global.innerHeight = 1080;
global.requestAnimationFrame = () => 0; global.addEventListener = () => {};
const _log = console.log; console.log = () => {};

const TEST = String.raw`
;(function(){
  const out=[];let ng=0;
  const row=(name,val,cond,ref)=>{const ok=cond===null?'参考':(cond?'OK':'NG');if(cond===false)ng++;out.push([name,val,ok,ref||'']);};
  // 1) 平面線形:最小曲線半径(新線・事業範囲内)
  let rmin=1e9,rs=0;
  for(let s=DOM.x0+20;s<DOM.x1-20;s+=2){const k=curvAt(s);if(k>1e-6&&1/k<rmin){rmin=1/k;rs=s;}}
  row('最小曲線半径[m]',rmin.toFixed(0)+' (s='+rs.toFixed(0)+')',rmin>=140,'≥140(京急の急曲線を想定)');
  // 2) 縦断:最急勾配・駅部の勾配
  let gmax=0,gs=0;for(let s=DOM.x0;s<DOM.x1;s+=2){const g=Math.abs(gradAt(s));if(g>gmax){gmax=g;gs=s;}}
  row('最急勾配[‰]',(gmax*1000).toFixed(1)+' (s='+gs.toFixed(0)+')',gmax<=0.0355,'≤35‰');
  for(const st of STA){let g=0;for(let s=st.x-st.half;s<=st.x+st.half;s+=2)g=Math.max(g,Math.abs(gradAt(s)));
    row(st.n+' ホーム内勾配[‰]',(g*1000).toFixed(2),g<=0.005,'≤5‰');}
  // 3) 構造:桁(構造)半幅 − 最外軌道 ≥ 2.34m(2m刻み)
  let mm=1e9,ms=0;for(let s=DOM.x0;s<=DOM.x1;s+=2){const m=deckHalf(s)-outerOff(s);if(m<mm){mm=m;ms=s;}}
  row('構造半幅−最外軌道 最小[m]',mm.toFixed(2)+' (s='+ms.toFixed(0)+')',mm>=2.34,'≥2.34');
  // 4) 離隔:高架の桁下と、その下の JR 線路(レール面)・道路(路面)
  const minClr={rail:[1e9,0],road:[1e9,0]};
  for(let s=DOM.x0;s<=DOM.x1;s+=2){
    if(zoneAt(s)!=='via')continue;
    const hw=deckHalf(s);
    for(let o=-hw;o<=hw;o+=1.5){const p=frame(s,o);
      for(const kind of['rail','road']){
        const i=Math.floor(p.x/OBS_C),j=Math.floor(p.z/OBS_C);
        for(let a=i-1;a<=i+1;a++)for(let b=j-1;b<=j+1;b++){const L=OBS.get(a+','+b);if(!L)continue;
          for(const q of L){if(q.kind!==kind||Math.hypot(q.x-p.x,q.z-p.z)>q.r)continue;
            if(kind==='road'&&q.w<4)continue;
            const c=yBot(s)-q.y;if(c<minClr[kind][0])minClr[kind]=[c,s];}}
      }}
  }
  row('JR線路上の桁下離隔[m]',minClr.rail[0].toFixed(2)+' (s='+minClr.rail[1].toFixed(0)+')',minClr.rail[0]>=6.0,'≥6.0(架線を含む建築限界の目安)');
  row('道路上の桁下離隔[m]',minClr.road[0].toFixed(2)+' (s='+minClr.road[1].toFixed(0)+')',minClr.road[0]>=4.7,'≥4.7(道路構造令の建築限界)');
  // 5) 旧踏切位置の離隔(道路は踏切で線路と同じ高さにあった=現況地盤)
  for(const g of XINGS){const p=frame(g[1],0);row('旧'+g[0]+'踏切 桁下−地盤[m]',(yBot(g[1])-demY(p.x,p.z)).toFixed(2),null,'推定縦断による値');}
  // 6) 橋脚:JR線路の上に立っていないこと
  let bad=0;for(const pr of PIERS){if(pr.abut)continue;const hw=deckHalf(pr.s);
    for(const o of[-(hw-1.3),hw-1.3]){const p=frame(pr.s,o);const q=obsNear(p.x,p.z,.7);if(q&&q.kind==='rail')bad++;}}
  row('JR線路上の橋脚[本]',bad,bad===0,'0');
  let span=0,spanS=0;for(let i=0;i<PIERS.length-1;i++){const L=PIERS[i+1].s-PIERS[i].s;if(L>span){span=L;spanS=PIERS[i].s;}}
  row('最大径間[m](八ツ山跨線線路橋)',span.toFixed(1)+' (s='+spanS.toFixed(0)+'〜)',null,'推定');
  // 7) 架線柱と架線の吊り点:同じ配列 POLES を参照(構造的に一致)
  row('架線柱の本数',POLES.length,POLES.length>10,'>10');
  // 8) 自動運転シミュレーション:下り快特(本線)を走らせ、制限速度の厳守と品川の停止位置正着を確認
  const t={dir:1,x:DOM.x0+5,x0:DOM.x0,v:vEntry(DOM.x0+5,1),st:'run',dwell:0,target:null,len:trains[0].len,stops:[SG]};
  let over=0,stopErr=null,maxV=0;
  for(let k=0;k<20000&&t.x<DOM.x1-5;k++){
    driveTrain(t,0.05);
    let lim=999;for(let s=t.x-t.len;s<=t.x;s+=2)lim=Math.min(lim,VLIM(clamp(s,DOM.x0,DOM.x1)));
    if(t.v*3.6>lim+1.5)over++;
    maxV=Math.max(maxV,t.v*3.6);
    if(t.st==='dwell'&&stopErr===null)stopErr=t.x-stopPosOf(SG,1);
  }
  row('自動運転 制限超過[コマ]',over,over===0,'0');
  row('自動運転 最高速度[km/h]',maxV.toFixed(1),maxV<=90.5,'≤90');
  // 上り(上り本線)も同様に
  const u={dir:-1,x:DOM.x1-5,x0:DOM.x1,v:vEntry(DOM.x1-5,-1),st:'run',dwell:0,target:null,len:trains[0].len,stops:[SG]};
  let overU=0,stopU=null;
  for(let k=0;k<20000&&u.x>DOM.x0+5;k++){driveTrain(u,0.05);let lim=999;for(let s=u.x;s<=u.x+u.len;s+=2)lim=Math.min(lim,VLIM(clamp(s,DOM.x0,DOM.x1)));
    if(u.v*3.6>lim+1.5)overU++;if(u.st==='dwell'&&stopU===null)stopU=u.x-stopPosOf(SG,-1);}
  row('自動運転(上り) 制限超過[コマ]',overU,overU===0,'0');
  row('品川(上り) 停止位置誤差[m]',stopU===null?'停車せず':stopU.toFixed(2),stopU!==null&&Math.abs(stopU)<1.0,'±1.0');
  // 平滑化による現況線からのずれ(別線の振り量を除いた量)
  let dev=0,devS=0;for(let i=0;i<CUR.x.length;i+=5){const r=prjXY(CUR.x[i],CUR.z[i]);if(r.s<DOM.x0||r.s>DOM.x1)continue;
    const d=Math.abs(Math.abs(r.off)-eastShift(CUR.s[i]));if(d>dev){dev=d;devS=r.s;}}
  row('平滑化による現況線からのずれ 最大[m]',dev.toFixed(2)+' (s='+devS.toFixed(0)+')',null,'別線の振り量を除く');
  row('品川 停止位置誤差[m]',stopErr===null?'停車せず':stopErr.toFixed(2),stopErr!==null&&Math.abs(stopErr)<1.0,'±1.0');
  // 9) 区間種別の一覧
  out.push(['区間種別',ZONES.map(z=>z.t+'['+z.s0.toFixed(0)+','+z.s1.toFixed(0)+']').join(' '),'参考','']);
  out.push(['駅位置 s',STA.map(s=>s.n+'='+s.x.toFixed(0)).join(' '),'参考','']);
  out.push(['旧踏切 s',XINGS.map(g=>g[0]+'='+g[1].toFixed(0)).join(' '),'参考','']);
  global.__OUT={out:out,ng:ng};
})();`;
try { eval(code + TEST); } catch (e) { console.log = _log; console.error('RUNTIME_ERROR', e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); }
console.log = _log;
const R = global.__OUT;
console.log('=== 数値検証(線形・縦断・構造・自動運転) ===');
for (const [n, v, ok, ref] of R.out) console.log(`${ok.padEnd(3)} ${n}: ${v}${ref ? '   [基準 ' + ref + ']' : ''}`);
console.log('\nRESULT:', R.ng ? `FAIL(${R.ng}項目NG)` : 'PASS');
process.exit(R.ng ? 1 : 0);
