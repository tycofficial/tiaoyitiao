'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function fn(name){
  const start=html.indexOf('function '+name+'(');assert.notEqual(start,-1);let depth=0,quote='',comment='';
  for(let i=html.indexOf('{',start);i<html.length;i++){
    const c=html[i],n=html[i+1];
    if(comment==='line'){if(c==='\n')comment='';continue;}
    if(comment==='block'){if(c==='*'&&n==='/'){comment='';i++;}continue;}
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==='/'&&n==='/'){comment='line';i++;continue;}if(c==='/'&&n==='*'){comment='block';i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw Error('Unclosed '+name);
}
class Vector{constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}clone(){return new Vector(this.x,this.y,this.z);}copy(p){return this.set(p.x,p.y,p.z);}}
function harness(){
  const h=vm.createContext({Math,Set,Map,mode:'play',invincible:false,paused:true,failedFlight:null,suspendTimer:null,
    score:17,best:0,combo:4,multiplier:8,lastSucceed:100,centerMarker:{visible:true},platformTop:()=>2.75,
    stopAudio(){},playSound(){},squeezeAt(){},textFeedback(){},updateSettings(){},saveStore(){},ended:0,nativeCompleted:0,tail:{correctPosition(){}},
    exports:{},require:()=>({default:{Linear:(t,b,c,d)=>b+c*t/d}}),
    bottle:{obj:{position:new Vector(40,2.75,0),rotation:new Vector(0,0,1)},stop(){this.status='stop';}}
  });
  const clock=html.slice(html.indexOf('const clock='),html.indexOf('const CORE='));
  const tween=html.slice(html.indexOf('  const easing = require(41).default;'),html.indexOf('\n}\n,7:function'));
  vm.runInContext(clock+tween+'\nglobalThis.clockRef=clock;globalThis.animations=exports;'+['runFailureWork','fail','recoverMiss','setInvincible'].map(fn).join('\n')+'\nfunction endGame(){ended++;mode="over";}',h);
  const nativeFall=()=>{h.bottle.status='fall';h.clockRef.setTimeout(()=>{
    h.animations.customAnimation.to(h.bottle.obj.rotation,.8,{z:2});
    h.clockRef.setTimeout(()=>{h.nativeCompleted++;h.bottle.obj.position.y=-5;},350);
  },200);};
  h.bottle.fall=nativeFall;h.bottle.forerake=nativeFall;h.bottle.hypsokinesis=nativeFall;
  return h;
}

test('enabling invincible during every native failure pose cancels its descendants and preserves unrelated work',()=>{
  for(const hit of [0,3,4,5,6])for(const rescueAt of [0,250,500]){
    const h=harness(),origin=new Vector(12,-.5,-8),f={hit,start:origin};let unrelated=0;
    h.clockRef.setTimeout(()=>unrelated++,900);
    const decoration={x:0};h.animations.customAnimation.to(decoration,1,{x:1});
    h.fail(hit,f);h.clockRef.update(rescueAt);const completed=h.nativeCompleted;
    h.setInvincible(true);assert.equal(h.paused,true);assert.equal(h.mode,'play');assert.equal(h.bottle.status,'recover');
    h.clockRef.update(3000);
    assert.equal(h.ended,0);assert.equal(h.nativeCompleted,completed);assert.equal(unrelated,1);assert.equal(decoration.x,1);
    assert.equal(h.score,17);assert.equal(h.best,17);assert.equal(h.combo,0);assert.equal(h.failedFlight,null);assert.equal(h.bottle.status,'stop');
    assert.deepEqual([h.bottle.obj.position.x,h.bottle.obj.position.y,h.bottle.obj.position.z],[12,2.75,-8]);
    assert.deepEqual([h.bottle.obj.rotation.x,h.bottle.obj.rotation.y,h.bottle.obj.rotation.z],[0,0,0]);
  }
});

test('rapid mode toggles during a rescue do not revive a failed jump',()=>{
  const h=harness();h.fail(0,{start:new Vector(4,1,-3)});h.clockRef.update(250);
  h.setInvincible(true);h.setInvincible(false);h.setInvincible(true);h.setInvincible(false);h.clockRef.update(3000);
  assert.equal(h.invincible,false);assert.equal(h.ended,0);assert.equal(h.mode,'play');assert.equal(h.score,17);
});

test('normal mode still completes its original failure when no rescue is requested',()=>{
  const h=harness();h.fail(0,{start:new Vector()});h.clockRef.update(2100);
  assert.equal(h.ended,1);assert.equal(h.mode,'over');assert.equal(h.nativeCompleted,1);
});

function bonusHarness(){
  const h=vm.createContext({Math,Number,Set,Map,mode:'play',paused:false,soundEnabled:true,current:null,active:[],flight:null,
    bonusState:null,bonusGeneration:0,bonusTimer:null,score:0,relaxLeft:0,awards:[],
    stopAudio(){},bottle:{status:'stop',obj:{position:new Vector()},showAddScore(){}},
    increaseScore(n){h.score+=n;h.awards.push(n);},playBonusAudio(){},clock:null
  });
  vm.runInContext(html.slice(html.indexOf('const clock='),html.indexOf('const CORE='))+'\nglobalThis.clockRef=clock;'+['startBonus','releaseBonus'].map(fn).join('\n'),h);
  return h;
}

test('a special platform awards its stay bonus once, and release/restart cancels an old award',()=>{
  for(const restart of [false,true]){
    const h=bonusHarness(),block={order:24,score:15};h.current=block;h.active=[block];h.startBonus(block);h.clockRef.update(1000);
    if(restart){h.releaseBonus();h.clockRef.reset();h.current={order:0};h.score=0;}
    h.clockRef.update(5000);h.clockRef.update(5000);
    assert.equal(h.score,restart?0:15);assert.equal(h.awards.length,restart?0:1);
  }
});

test('a late special-platform audio completion cannot register effects or schedule repeats in a new run',async()=>{
  const h=bonusHarness();let resolveVoice,registered=0,ended=0,stopped=0,options;
  const block={order:24,musicName:'store',registerAudio(){registered++;},registerEndAudio(){ended++;}};
  h.current=block;h.active=[block];h.bonusState={block,triggered:true,offset:0,repeatTimer:null};
  h.playSound=(name,loop,charge,opts)=>{options=opts;return new Promise(resolve=>resolveVoice=resolve);};
  vm.runInContext(fn('playBonusAudio'),h);h.playBonusAudio();
  h.releaseBonus();h.clockRef.reset();h.current={order:0};
  const voice={stop(){stopped++;}};resolveVoice(voice);await Promise.resolve();await Promise.resolve();
  options.onPlay();const before=ended;options.onEnded();
  assert.equal(stopped,1);assert.equal(voice.cancelled,true);assert.equal(registered,0);assert.equal(ended,before);
  assert.equal(h.clockRef.timers.size,0);assert.equal(h.score,0);
});

test('menu navigation dismisses an existing dialog while keeping the game paused',()=>{
  for(const previous of ['skins','rank','about','home-info']){
    const visible=new Set([previous]),h=vm.createContext({ready:true,mode:'home',paused:true,menuReturn:'home',
      cancelCharge(){},setPaused(value){h.paused=value;},hide:id=>visible.delete(id),show:id=>visible.add(id),$:()=>({textContent:''})
    });
    vm.runInContext(fn('openMenu'),h);h.openMenu();assert.equal(h.paused,true);assert.equal(visible.has('menu'),true);assert.equal(visible.has(previous),false);assert.equal(visible.has('home'),true);
  }
});
