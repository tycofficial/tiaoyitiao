'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function functionAt(start){
  const brace=html.indexOf('{',start);let depth=0,quote='',comment='';
  for(let i=brace;i<html.length;i++){
    const c=html[i],n=html[i+1];
    if(comment==='line'){if(c==='\n')comment='';continue;}if(comment==='block'){if(c==='*'&&n==='/'){comment='';i++;}continue;}
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==='/'&&n==='/'){comment='line';i++;continue;}if(c==='/'&&n==='*'){comment='block';i++;continue;}
    if('"\'`'.includes(c)){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw Error('Unclosed function');
}
const fn=name=>functionAt(html.indexOf('function '+name+'('));
const method=name=>functionAt(html.indexOf('function(',html.indexOf('key: "'+name+'"')));
class Vector{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){Object.assign(this,{x,y,z});return this;}
  clone(){return new Vector(this.x,this.y,this.z);}copy(v){return this.set(v.x,v.y,v.z);}toArray(){return[this.x,this.y,this.z];}
  sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);}add(v){return this.set(this.x+v.x,this.y+v.y,this.z+v.z);}
  multiplyScalar(n){return this.set(this.x*n,this.y*n,this.z*n);}addScaledVector(v,n){return this.add(v.clone().multiplyScalar(n));}
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);
function harness(hold,direction='straight'){
  const frames=Math.min(99,hold*60),scale=1-.005*frames;
  const h=vm.createContext({exports:{},require:()=>({default:{Linear:(t,b,c,d)=>b+c*t/d}}),a:{BLOCK:{height:5.5}},
    bottle:{body:{scale:new Vector(1+.007*frames,scale,1+.007*frames)},head:{position:new Vector(0,4.725-.018*frames,0)},human:{rotation:new Vector()},obj:{position:new Vector()},velocity:{vz:Math.min(hold*70,150)},direction,resetParticles(){},stop(){this.status='stop';},showAddScore(){},scatterParticles(){},lookAt(){}},
    mode:'play',score:0,jumps:0,combo:0,multiplier:1,lastSucceed:-Infinity,scoreScale:false,blockScale:1,active:[],
    current:{obj:{position:new Vector()},radius:5},next:{obj:{position:new Vector(20,0,0)},radius:5},
    incoming:{obj:{position:new Vector()},radius:5,popup(){}},C:{BLOCK:{maxDistance:17}},CORE:()=>({random:()=>.5}),THREE:{Vector3:Vector},
    platformTop:()=>2.75,playSound(){},addWaves(){},ground:{changeColor(){}},scene:{add(){}},followPlatforms(){},startBonus(){},
    centerMarker:{visible:false,position:new Vector(),scale:{setScalar(){}}},increaseScore(n){h.score+=n;}
  });
  vm.runInContext(html.slice(html.indexOf('const clock='),html.indexOf('const CORE='))+html.slice(html.indexOf('  const easing = require(41).default;'),html.indexOf('\n}\n,7:function'))+'\nconst s=exports;globalThis.clockRef=clock;'+fn('squeezeAt')+'\n'+fn('land')+'\nbottle.jump='+method('jump')+';bottle.squeeze='+method('squeeze')+';function selectBlock(){return incoming;}',h);
  const vy=+Math.min(135+hold*15,180).toFixed(2),y=2.75-.033875*frames;
  h.duration=(vy+Math.sqrt(vy*vy+1440*(y-2.75)))/720;h.bottle.jump(new Vector(1,0,0));
  return h;
}

test('a successful landing preserves the airborne body scale at contact and settles in 300 ms',()=>{
  for(const direction of ['straight','left'])for(const hold of [.05,.719,1,1.65,2.2])for(const hz of [30,60,120]){
    const h=harness(hold,direction);let elapsed=0;
    while(elapsed<h.duration*1000-1e-8){const dt=Math.min(1000/hz,h.duration*1000-elapsed);h.clockRef.update(dt);elapsed+=dt;}
    const before=h.bottle.body.scale.toArray();
    h.land({hit:7,end:new Vector(20,2.75,0)});
    h.bottle.body.scale.toArray().forEach((v,i)=>near(v,before[i]));
    h.clockRef.update(150);near(h.bottle.body.scale.y,.9);near(h.bottle.body.scale.x,1.07);
    h.clockRef.update(150);h.bottle.body.scale.toArray().forEach(v=>near(v,1));
    h.clockRef.update(700);h.bottle.body.scale.toArray().forEach(v=>near(v,1));assert.equal(h.score,1);assert.equal(h.jumps,1);
  }
});

test('current-platform landings and safety recovery still reset an incomplete pose',()=>{
  for(const fromCurrent of [false,true]){
    const h=harness(.719);h.clockRef.update(h.duration*1000);
    if(fromCurrent)h.land({hit:2,end:new Vector(2,2.75,0)});else h.squeezeAt();
    h.bottle.body.scale.toArray().forEach(v=>near(v,1));assert.equal(h.score,0);assert.equal(h.jumps,0);
    h.clockRef.update(1000);h.bottle.body.scale.toArray().forEach(v=>near(v,1));
  }
});
