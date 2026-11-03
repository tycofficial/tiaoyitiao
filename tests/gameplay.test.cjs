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
    activePointer: 'test', mode: 'play', paused: false, pressWall: 0,
    centerMode: false, invincible: false, relay: null, lastSucceed: -Infinity,
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
  vm.runInContext(extractFunction('endCharge') + '\n' + extractFunction('advanceFrame'), context);
  vm.runInContext("endCharge('test')", context);
  return context;
}

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
    score: 12, flight: null, platformTop: () => 2.75,
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
});

test('loading an older save preserves normal preferences without restoring cheat modes or locked skins', () => {
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
  assert.equal(context.invincible, false); assert.equal(context.centerMode, false);
  assert.equal(context.scoreScale, false); assert.equal(context.allSkins, false);
  assert.equal(context.selectedSkin, 'classic');
});
