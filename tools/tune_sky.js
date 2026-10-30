// 空とフォグの色を「数値で」決めるための道具。
//
//   空ドームもフォグも、地物と同じ経路(リニア→ACES→sRGB)を通る。
//   16進をそのまま書くと画面上では沈むので、「こう見せたい色」から
//   書くべき著作値を逆算する。
//
//   ・ACESは行列で成分を混ぜるため、成分ごとに別々に解くと色がずれる。
//     3成分まとめて反復で追い込む
//   ・逆算値が表現範囲(0〜255)を超える色は誤差が残る。誤差が大きい場合は
//     狙いを少し弱める(彩度を落とす)
//   ・フォグは地平と同じ値にする(遠景が空へ溶けて境目が出ない)
//
//   使い方: node tools/tune_sky.js
//   ※ TONE_EXPO を変えたらこの表も引き直すこと
const s2l=v=>(v<=0.04045)?v/12.92:Math.pow((v+0.055)/1.055,2.4);
const l2s=v=>(v<=0.0031308)?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;
const IN=[[0.59719,0.07600,0.02840],[0.35458,0.90834,0.13383],[0.04823,0.01566,0.83777]];
const OUT=[[1.60475,-0.10208,-0.00327],[-0.53108,1.10813,-0.07276],[-0.07367,-0.00605,1.07602]];
const mul=(M,c)=>[0,1,2].map(i=>M[0][i]*c[0]+M[1][i]*c[1]+M[2][i]*c[2]);
const fit=v=>(v*(v+0.0245786)-0.000090537)/(v*(0.983729*v+0.432951)+0.238081);
const aces=(c,e)=>{let x=c.map(v=>v*e/0.6);x=mul(IN,x).map(fit);return mul(OUT,x).map(v=>Math.min(1,Math.max(0,v)));};
const EXPO=1.18;
const out=hexArr=>aces(hexArr.map(s2l),EXPO).map(l2s);   // 著作値(0-1 sRGB) → 画面上の値
const hex=h=>[((h>>16)&255)/255,((h>>8)&255)/255,(h&255)/255];
const toHex=c=>'#'+c.map(v=>Math.round(Math.min(1,Math.max(0,v))*255).toString(16).padStart(2,'0')).join('');

/* 狙いの見え方から著作値を逆算する。ACESは行列で成分を混ぜるので、
   成分ごとに別々に解くと色がずれる。3成分まとめて反復で追い込む。 */
function invert(target){
  let c=target.slice();
  for(let i=0;i<200;i++){
    const o=out(c);
    let moved=0;
    for(let k=0;k<3;k++){
      const r=(o[k]>1e-6)?target[k]/o[k]:1.6;
      const nv=Math.min(1,Math.max(0,c[k]*Math.pow(r,0.7)));
      moved=Math.max(moved,Math.abs(nv-c[k])); c[k]=nv;
    }
    if(moved<1e-7) break;
  }
  return c;
}
const dist=(a,b)=>Math.max(...[0,1,2].map(i=>Math.abs(a[i]-b[i])*255));
console.log('狙いの見え方 → 書くべき著作値 → 検算(画面上の値) → 誤差[/255]\n');
for(const [nm,h] of [['地平(現在の背景色)',0xd6e4ef],['天頂',0x9cc0e8],['地平下',0xc6d0d6],['太陽まわり',0xf2e6d4]]){
  const t=hex(h), src=invert(t), chk=out(src);
  console.log(nm.padEnd(18), toHex(t), '→', toHex(src), '→', toHex(chk), ' 誤差', dist(t,chk).toFixed(1));
}
