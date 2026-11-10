'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const clockSource = html.slice(html.indexOf('const clock='), html.indexOf('const CORE='));
const tweenSource = html.slice(html.indexOf('  const easing = require(41).default;'),html.indexOf('\n}\n,7:function'));
function harness() {
  const context = vm.createContext({exports:{},require:()=>({default:{Linear:(t,b,c,d)=>b+c*t/d}})});
  vm.runInContext(clockSource+tweenSource+'\nglobalThis.api={clock,...exports};',context);
  return context.api;
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} vs ${b}`);

test('jump rotation joins at 140 ms and follows the same curve at 30, 60, 120 Hz and stalled frames',()=>{
  for(const dt of [1000/30,1000/60,1000/120,137]) {
    const {clock,customAnimation}=harness(),pose={z:0};
    customAnimation.to(pose,.14,{z:-Math.PI});
    customAnimation.to(pose,.18,{z:-2*Math.PI,delay:.14});
    for(const target of [140,200,320]) {
      while(clock.time<target-1e-9)clock.update(Math.min(dt,target-clock.time));
      near(pose.z,target===140?-Math.PI:target===200?-4*Math.PI/3:-2*Math.PI);
    }
    assert.equal(clock.tweens.length,0);assert.equal(clock.timers.size,0);
  }
});

test('a delayed body rebound captures the completed squash before recovering',()=>{
  const {clock,customAnimation}=harness(),pose={y:1};
  customAnimation.to(pose,.1,{y:.7});
  customAnimation.to(pose,.2,{y:1,delay:.1});
  clock.update(150);near(pose.y,.775);
  clock.update(150);near(pose.y,1);
});

test('timer cancellation and restart remove pending animations and callbacks',()=>{
  const {clock,customAnimation}=harness(),pose={y:1};let called=0;
  const id=clock.setTimeout(()=>called++,10);clock.clearTimeout(id);
  customAnimation.to(pose,.1,{y:0,delay:.2,onComplete(){called++;}});
  clock.update(100);clock.reset();clock.update(1000);
  assert.equal(called,0);near(pose.y,1);
  assert.equal(clock.timers.size,0);assert.equal(clock.tweens.length,0);
});
