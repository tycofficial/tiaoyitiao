'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fn(name){
 const start=html.indexOf('function '+name+'(');assert.ok(start>=0);let depth=0,quote='',comment='';
 for(let i=html.indexOf('{',start);i<html.length;i++){
  const c=html[i],n=html[i+1];if(comment==='line'){if(c==='\n')comment='';continue;}if(comment==='block'){if(c==='*'&&n==='/'){comment='';i++;}continue;}
  if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}if('"\'`'.includes(c)){quote=c;continue;}
  if(c==='/'&&n==='/'){comment='line';i++;continue;}if(c==='/'&&n==='*'){comment='block';i++;continue;}
  if(c==='{')depth++;if(c==='}'&&--depth===0)return html.slice(start,i+1);
 }throw Error('Unclosed '+name);
}
test('graphics availability covers native loss before its event and pending renderer restoration',()=>{
 const h=vm.createContext({graphicsLost:false,renderer:undefined});vm.runInContext(fn('graphicsUnavailable'),h);assert.equal(h.graphicsUnavailable(),false);
 for(const rawLost of [false,true])for(const eventLost of [false,true]){h.graphicsLost=eventLost;h.renderer={getContext:()=>({isContextLost:()=>rawLost})};assert.equal(h.graphicsUnavailable(),rawLost||eventLost);}
});
test('lost graphics reject resume, scene replacement and input before touching current progress',()=>{
 const untouched=()=>assert.fail('Unavailable graphics must preserve current state');
 const h=vm.createContext({graphicsUnavailable:()=>true,renderer:{},ready:true,mode:'play',paused:true,activePointer:1,bottle:{status:'stop'},flight:null,
  score:17,best:3200,relay:null,clearScene:untouched,hide:untouched,unlockPlatformAudio:untouched,performance:{now:untouched}});
 vm.runInContext(['setPaused','closeMenu','startGame','home','beginCharge','endCharge','resize'].map(fn).join('\n'),h);
 h.setPaused(false);h.closeMenu();h.startGame();h.home();h.resize();assert.equal(h.beginCharge(2,100),false);
 h.paused=false;h.activePointer=null;assert.equal(h.beginCharge(2,100),false);h.activePointer=1;h.bottle.status='prepare';assert.equal(h.endCharge(1,undefined,150),false);
 assert.equal(h.score,17);assert.equal(h.best,3200);assert.equal(h.mode,'play');assert.equal(h.flight,null);
});
test('frames keep a current wall clock but never advance or draw during native context loss',()=>{
 let advances=0,draws=0,frames=0;const h=vm.createContext({Math,ready:true,lastFrame:100,document:{hidden:false},paused:false,nativeUI:null,
  graphicsUnavailable:()=>true,requestAnimationFrame(){frames++;},advanceFrame(){advances++;},drawFrame(){draws++;}});
 vm.runInContext(fn('frame'),h);h.frame(500);h.frame(1500);assert.equal(h.lastFrame,1500);assert.equal(advances,0);assert.equal(draws,0);assert.equal(frames,2);
 h.graphicsUnavailable=()=>false;h.frame(1510);assert.ok(advances>0);assert.equal(draws,1);assert.equal(h.lastFrame,1510);
});
