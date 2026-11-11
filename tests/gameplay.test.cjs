'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Test the published artifact itself; no development-only repair scripts are needed.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Missing function ' + name);
  let depth = 0, quote = '', comment = '';
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    const char = html[i], next = html[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = ''; continue; }
    if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  assert.fail('Missing function end ' + name);
}

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, n) { return this.add(v.clone().multiplyScalar(n)); }
  multiplyScalar(n) { this.x *= n; this.y *= n; this.z *= n; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
  distanceTo(v) { return this.clone().sub(v).length(); }
}

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, label + ': ' + actual + ' vs ' + expected);

function jumpHarness(hold, left = false) {
  const y = 2.75 - .033875 * Math.min(99, hold * 60);
  const context = vm.createContext({
    Math, performance: { now: () => hold * 1000 },
    activePointer: 'test', mode: 'play', paused: false, pressWall: 0, pressInput: null, inputBoundary: 0,
    centerMode: false, invincible: false, relay: null, lastSucceed: -Infinity, graphicsUnavailable:()=>false,
    clock: { time: 1000, tweens: [], update() {} },
    current: { rebound() {} }, next: { obj: { position: new Vector(left ? 0 : 20, 0, left ? -20 : 0) } },
    applyCharge() {}, stopAudio() {}, platformTop: () => 2.75,
    tail: { correctPosition() {}, update() {} }, scene: { updateMatrixWorld() {} },
    bottle: {
      status: 'prepare', obj: { position: new Vector(0, y, 0) }, flyingTime: 0,
      jump(axis) { this.axis = axis; this.status = 'jump'; },
      _jump(dt) {
        this.obj.position.add(this.axis.clone().multiplyScalar(this.velocity.vz * dt));
        this.obj.position.y += this.velocity.vy * dt - 360 * dt * dt - 720 * this.flyingTime * dt;
        this.flyingTime += dt;
      }
    },
    hitTest: () => 7, flight: null, active: [], demoPress: null,
    updateFailure() {}, updateClockPlatform() {}
  });
  context.land = f => { context.landing = { f, position: context.bottle.obj.position.clone() }; context.flight = null; };
  vm.runInContext(extractFunction('eventInputTime') + '\n' + extractFunction('chargeHoldAt') + '\n' + extractFunction('endCharge') + '\n' + extractFunction('advanceFrame'), context);
  vm.runInContext("endCharge('test')", context);
  return context;
}

test('event clocks accept page-relative and epoch timestamps and reject unsupported values', () => {
  const origin=1700000000000,context=vm.createContext({performance:{now:()=>500,timeOrigin:origin}});
  vm.runInContext(extractFunction('eventInputTime'),context);
  assert.equal(context.eventInputTime(100),100);assert.equal(context.eventInputTime(origin+100),100);
  for(const stamp of [undefined,null,0,-1,NaN,Infinity,500.1,origin-1,origin+501,'100'])assert.equal(context.eventInputTime(stamp),null);
  context.performance.timeOrigin=undefined;assert.equal(context.eventInputTime(origin+100),null);assert.equal(context.eventInputTime(100),100);
});

test('charge duration uses complete native timestamp pairs and complete processing pairs as fallback', () => {
  const origin=1700000000000,context=vm.createContext({performance:{now:()=>1000,timeOrigin:origin},pressWall:250,pressInput:{eventTime:100},inputBoundary:50});
  vm.runInContext(extractFunction('eventInputTime')+'\n'+extractFunction('chargeHoldAt'),context);
  near(context.chargeHoldAt(150),.05,'Queued release');near(context.chargeHoldAt(origin+150),.05,'Converted epoch release');
  for(const stamp of [undefined,0,NaN,origin+2000])near(context.chargeHoldAt(stamp),.75,'Invalid release uses both processing samples');
  context.pressInput.eventTime=null;near(context.chargeHoldAt(150),.75,'Invalid start does not mix clocks');
  context.pressInput={eventTime:100};near(context.chargeHoldAt(5000,5010),4.9,'Genuine long hold is not truncated');
});

test('stale or duplicate releases cannot consume a newer active charge', () => {
  const context=jumpHarness(.05);context.activePointer='test';context.flight=null;context.bottle.status='prepare';context.pressInput={eventTime:100};context.inputBoundary=90;context.pressWall=200;context.performance.now=()=>500;
  let applied=0;context.applyCharge=()=>applied++;
  assert.equal(context.endCharge('test',undefined,99),false);assert.equal(context.activePointer,'test');assert.equal(context.flight,null);assert.equal(applied,0);
  assert.equal(context.endCharge('other',undefined,150),false);assert.equal(context.activePointer,'test');
  assert.equal(context.endCharge('test',undefined,150),true);assert.equal(context.pressInput,null);assert.equal(applied,1);
  const flight=context.flight;assert.equal(context.endCharge('test',undefined,151),false);assert.equal(context.flight,flight);assert.equal(applied,1);
});

test('queued release applies the actual hold to the release pose and unchanged trajectory calculation', () => {
  const context=jumpHarness(.05),expected=context.flight;context.activePointer='test';context.flight=null;context.bottle.status='prepare';context.pressInput={eventTime:100};context.inputBoundary=0;context.pressWall=300;context.performance.now=()=>900;
  let applied;context.applyCharge=hold=>{applied=hold;context.bottle.obj.position.y=2.75-.033875*Math.min(99,hold*60);};
  assert.equal(context.endCharge('test',undefined,150),true);near(applied,.05,'Final compression');near(context.flight.hold,.05,'Physical interval');near(context.flight.vy,expected.vy,'Original vertical speed');near(context.flight.duration,expected.duration,'Original flight time');near(context.flight.end.x,expected.end.x,'Original rounded range');
});

test('queued starts from before a pause boundary and duplicate starts are rejected before state changes', () => {
  const context=vm.createContext({performance:{now:()=>1000,timeOrigin:1700000000000},ready:true,mode:'play',paused:false,activePointer:null,bottle:{status:'stop'},flight:null,relay:null,inputBoundary:900,graphicsUnavailable:()=>false,unlockPlatformAudio(){assert.fail('Rejected start must not change state');}});
  vm.runInContext(extractFunction('eventInputTime')+'\n'+extractFunction('beginCharge'),context);
  assert.equal(context.beginCharge(1,800),false);context.activePointer=1;assert.equal(context.beginCharge(1,950),false);context.activePointer=null;context.paused=true;assert.equal(context.beginCharge(1,950),false);
});

test('normal jumps retain the classic rounded range while the visible trajectory reaches the same endpoint', () => {
  for (const left of [false, true]) for (const hold of [.001, .05, .2, .719, 1, 1.65, 2, 3]) {
    const context = jumpHarness(hold, left), f = context.flight;
    const originalVz = +Math.min(hold * 70, 150).toFixed(2), roundedY = +f.start.y.toFixed(2);
    const roundedTime = +((f.vy / 360) - +((-f.vy + Math.sqrt(Math.max(0, f.vy * f.vy - 1440 * (2.75 - roundedY)))) / -720).toFixed(2)).toFixed(2);
    const expected = +(originalVz * roundedTime).toFixed(2);
    near(left ? -f.end.z : f.end.x, expected, 'original rounded range');
    near(f.vz * f.duration, f.end.clone().sub(f.start).dot(f.axis), 'velocity and collision endpoint agree');
    near(f.start.y + f.vy * f.duration - 360 * f.duration * f.duration, 2.75, 'flight ends on platform height');
  }
});

test('variable frame lengths clamp the final physics step without an early or penetrating landing', () => {
  for (const frameDt of [1 / 30, 1 / 60, 1 / 120, .137]) for (const hold of [.001, .719, 1, 2]) {
    const context = jumpHarness(hold), f = context.flight;
    let steps = 0;
    while (!context.landing && steps++ < 200) vm.runInContext('advanceFrame(' + frameDt + ')', context);
    assert.ok(context.landing, 'jump must land');
    near(context.landing.position.x, f.end.x, 'x before landing correction');
    near(context.landing.position.z, f.end.z, 'z before landing correction');
    near(context.landing.position.y, f.end.y, 'height before landing correction');
    near(f.elapsed, f.duration, 'no elapsed overshoot');
  }
});

test('clock platform keeps working after scene time resets and refreshes the real minute', () => {
  let hour = 9, minute = 8;
  class FakeDate { getHours() { return hour; } getMinutes() { return minute; } }
  const block = { order: 25, plane: { visible: true }, numbers: Array.from({ length: 10 }, () => Array.from({ length: 4 }, () => ({ visible: false, position: { x: 0 } }))) };
  const context = vm.createContext({ Date: FakeDate, String, Number, Math, clock: { time: 0 }, block });
  vm.runInContext(extractFunction('updateClockPlatform'), context);
  const tick = time => { context.clock.time = time; vm.runInContext('updateClockPlatform(block)', context); };
  const digits = () => [0, 1, 2, 3].map(place => block.numbers.findIndex(row => row[place].visible)).join('');
  tick(0); assert.equal(digits(), '0908'); assert.equal(block.plane.visible, true);
  tick(1000); assert.equal(block.plane.visible, false);
  hour = 10; minute = 27;
  tick(0); assert.equal(digits(), '1027'); assert.equal(block.plane.visible, true);
  tick(1000); assert.equal(block.plane.visible, false);
  tick(2000); assert.equal(block.plane.visible, true);
  for (let place = 0; place < 4; place++) assert.equal(block.numbers.filter(row => row[place].visible).length, 1);
  assert.equal(block.numbers[1][0].position.x, -3.2);
});

test('landing back on the current platform settles the complete pose without changing score or platforms', () => {
  const unrelated = {}, context = vm.createContext({
    clock: { tweens: [] }, current: {}, next: {}, relay: null, flight: {}, score: 12,
    platformTop: () => 2.75,
    bottle: { obj: { position: new Vector() }, human: { rotation: new Vector(0, 0, -5) }, body: { scale: new Vector(1.4, .7, 1.4) }, head: { position: new Vector(.3, 3, -.5) }, stop() { this.status = 'stop'; }, squeeze() { this.squeezed = true; } }
  });
  context.clock.tweens = [context.bottle.body.scale, context.bottle.head.position, context.bottle.human.rotation, unrelated].map(target => ({ target }));
  const current = context.current, next = context.next;
  vm.runInContext(extractFunction('squeezeAt') + '\n' + extractFunction('land'), context);
  context.f = { hit: 2, end: new Vector(.1, 2.75, .2) };
  vm.runInContext('land(f)', context);
  assert.equal(context.score, 12); assert.equal(context.current, current); assert.equal(context.next, next);
  assert.equal(context.bottle.status, 'stop'); assert.equal(context.bottle.squeezed, true);
  assert.deepEqual([context.bottle.head.position.x, context.bottle.head.position.y, context.bottle.head.position.z], [0, 4.725, 0]);
  assert.deepEqual([context.bottle.body.scale.x, context.bottle.body.scale.y, context.bottle.body.scale.z], [1, 1, 1]);
  assert.equal(context.clock.tweens.length, 1); assert.equal(context.clock.tweens[0].target, unrelated);
});

test('a cancelled press releases input and cannot turn a later pointer-up into a jump', () => {
  let stopped = 0, rebounded = 0;
  const context = vm.createContext({
    relay: null, mode: 'play', paused: false, activePointer: 'finger', keyHeld: true,
    score: 12, flight: null, pressInput: {eventTime:10}, inputBoundary:0, performance:{now:()=>1000}, platformTop: () => 2.75,
    stopAudio(preserve) { assert.equal(preserve, false); stopped++; },
    current: { rebound() { rebounded++; } },
    bottle: { status: 'prepare', obj: { position: new Vector(0, 1.5, 0) }, stopPrepare() { this.status = 'stop'; } }
  });
  vm.runInContext(extractFunction('cancelCharge') + '\n' + extractFunction('endCharge'), context);
  vm.runInContext("cancelCharge();endCharge('finger');", context);
  assert.equal(stopped, 1); assert.equal(rebounded, 1);
  assert.equal(context.activePointer, null); assert.equal(context.keyHeld, false);
  assert.equal(context.bottle.status, 'stop'); assert.equal(context.bottle.obj.position.y, 2.75);
  assert.equal(context.flight, null); assert.equal(context.score, 12);
  assert.equal(context.pressInput,null);assert.equal(context.inputBoundary,1000);
});

test('older saves migrate to retry mode, preserving progress without enabling unrelated cheats or locked skins', () => {
  const previous = { best: 64, records: [{ score: 64, date: '2026-11-03' }], prefs: { sound: false, quality: 'standard', renderVersion: 3, invincible: true, centerMode: true, scoreScale: true, allSkins: true, skin: 'scarf' } };
  const context = vm.createContext({
    localStorage: { getItem: () => JSON.stringify(previous) },
    best: 0, score: 0, records: [], prefs: {}, soundEnabled: true, quality: 'high',
    invincible: true, centerMode: true, scoreScale: true, allSkins: true, selectedSkin: 'classic',
    updateSettings() {}
  });
  vm.runInContext(extractFunction('skinUnlocked') + '\n' + extractFunction('readStore'), context);
  vm.runInContext('readStore()', context);
  assert.equal(context.best, 64); assert.equal(context.records.length, 1);
  assert.equal(context.soundEnabled, false); assert.equal(context.quality, 'standard');
  assert.equal(context.invincible, true); assert.equal(context.centerMode, false);
  assert.equal(context.scoreScale, false); assert.equal(context.allSkins, false);
  assert.equal(context.selectedSkin, 'classic');
});

test('explicit normal and invincible preferences survive reload without changing saved progress', () => {
  for (const gameplayMode of ['classic', 'invincible']) {
    const previous = { best: 3200, records: [{ score: 42, date: '2026-11-03' }], prefs: { gameplayMode, skin: 'gold', sound: false } };
    let saved;
    const context = vm.createContext({
      localStorage: { getItem: () => JSON.stringify(previous), setItem: (key, value) => { saved = JSON.parse(value); } },
      best: 0, score: 0, records: [], prefs: {}, soundEnabled: true, quality: 'high',
      invincible: true, centerMode: false, scoreScale: false, allSkins: false, selectedSkin: 'classic', updateSettings() {}
    });
    vm.runInContext(['skinUnlocked', 'readStore', 'saveStore'].map(extractFunction).join('\n') + '\nreadStore();saveStore();', context);
    assert.equal(context.invincible, gameplayMode === 'invincible');
    assert.equal(context.selectedSkin, 'gold');
    assert.deepEqual(saved.records, previous.records); assert.equal(saved.best, 3200);
    assert.equal(saved.prefs.gameplayMode, gameplayMode);
    assert.equal(saved.prefs.sound, false);
  }
});

test('manual trajectories keep their intermediate parabolic positions at different frame rates', () => {
  for (const left of [false, true]) for (const hold of [.05, .719, 2]) for (const dt of [1/30, 1/60, 1/120, .137]) {
    const h = jumpHarness(hold, left), f = h.flight;
    for (const fraction of [.1, .3, .5, .8]) {
      const target = f.duration * fraction;
      while (f.elapsed < target - 1e-9) h.advanceFrame(Math.min(dt, target - f.elapsed));
      const expected = f.start.clone().addScaledVector(f.axis, f.vz * target);
      expected.y += f.vy * target - 360 * target * target;
      for (const axis of ['x','y','z']) near(h.bottle.obj.position[axis], expected[axis], 'parabola ' + axis);
    }
  }
});

test('every miss retries in invincible mode and retains normal failure behavior when disabled', () => {
  for (const invincible of [false, true]) for (const hit of [0,3,4,5,6]) {
    const recovered=[],failed=[];
    const context = vm.createContext({
      invincible, flight: {}, score: 15, current: {}, next: {}, platformTop: () => 2.75,
      bottle: { obj: { position: new Vector() }, human: { rotation: new Vector() } },
      recoverMiss(f) { recovered.push(f.hit); }, fail(hit) { failed.push(hit); }
    });
    vm.runInContext(extractFunction('land') + `\nland({hit:${hit},start:newStart,end:newEnd});`.replace('newStart', '({x:0,y:2.75,z:0})').replace('newEnd','({x:60,y:2.75,z:0})'), context);
    assert.equal(context.score, 15);
    assert.equal(recovered.length, invincible ? 1 : 0);
    assert.equal(failed.length, invincible ? 0 : 1);
    assert.equal(context.flight, null);
  }
});

test('miss recovery returns to the actual takeoff position and resets the combo without giving points', () => {
  let tween, settled = 0, tailCorrections = 0;
  const context = vm.createContext({
    score: 17, combo: 4, multiplier: 8, lastSucceed: 1200, centerMarker: { visible: true },
    failedFlight: null, clock: {timers: new Map(),tweens: []}, suspendTimer: null,
    stopAudio() {}, squeezeAt() { settled++; }, platformTop: () => 2.75, textFeedback() {},
    tail: { correctPosition() { tailCorrections++; } },
    bottle: { obj: { position: new Vector(60,2.75,-20), rotation: new Vector() }, stop() { this.status='stop'; } },
    animations: { customAnimation: { to(target, duration, props) { tween={target,duration,props}; } } }
  });
  vm.runInContext(extractFunction('recoverMiss'), context);
  context.f = { start: new Vector(12, -0.5, -8) };context.recoverMiss(context.f);
  assert.equal(context.bottle.status, 'recover');assert.equal(context.score, 17);
  assert.equal(context.combo, 0);assert.equal(context.multiplier, 1);assert.equal(context.lastSucceed, -Infinity);
  assert.equal(context.centerMarker.visible, false);assert.equal(tween.duration, .22);
  assert.deepEqual([tween.props.x,tween.props.y,tween.props.z], [12,2.75,-8]);
  tween.props.onComplete();
  assert.equal(context.bottle.status, 'stop');assert.equal(context.score, 17);
  assert.deepEqual([context.bottle.obj.position.x,context.bottle.obj.position.y,context.bottle.obj.position.z],[12,2.75,-8]);
  assert.equal(tailCorrections, 1);assert.equal(settled, 2);
});

test('both home demonstration jumps reach their intended endpoints without a landing snap', () => {
  const context = vm.createContext({
    mode:'home', C:{GAME:{gravity:720}}, current:{shrink(){},rebound(){}}, next:{obj:{position:new Vector(20,0,0)}},
    bottle:{obj:{position:new Vector(-10,-2.75,0)},bottle:{rotation:{}},prepare(){},jump(){}},
    THREE:{Vector3:Vector},tail:{correctPosition(){}},homeBlocks:Array.from({length:7},()=>({hitObj:{material:{}},obj:{position:{}}})),
    animations:{customAnimation:{to(){}}}, clock:{time:0,setTimeout(fn,delay){if(delay===719)context.release=fn;}},
    applyCharge(){context.bottle.obj.position.y=2.75-.033875*.719*60;},flight:null
  });
  vm.runInContext(extractFunction('introJump')+'\n'+extractFunction('demoJump'),context);
  context.introJump();let f=context.flight;
  near(f.start.x+f.vz*f.duration,0,'intro endpoint');
  context.bottle.obj.position.set(0,2.75,0);context.demoJump();context.release();f=context.flight;
  near(f.start.x+f.vz*f.duration,f.end.x,'demo endpoint');
  near(f.start.y+f.vy*f.duration-360*f.duration*f.duration,2.75,'demo height');
});
