const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const runtimeStart = page.indexOf('// Embedded sounds share');
const runtimeEnd = page.indexOf('function releaseBonus()', runtimeStart);
assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart, 'index.html must contain the integrated audio runtime');
const runtime = page.slice(runtimeStart, runtimeEnd);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness({ nativeMedia = false, state = 'running', deferDecode = false, rejectResume = false } = {}) {
  const contexts = [], media = [];
  class Param {
    constructor(value = 1) { this.value = value; this.events = []; }
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
    linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
    cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
    cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  }
  class Node {
    constructor() { this.connections = []; this.disconnected = false; }
    connect(node) { this.connections.push(node); }
    disconnect() { this.disconnected = true; }
  }
  class FakeContext {
    constructor() {
      this.state = state; this.currentTime = 10; this.destination = new Node();
      this.sources = []; this.gains = []; this.pendingDecodes = []; this.failDecodeOnce = false;
      contexts.push(this);
    }
    createGain() { const node = new Node(); node.gain = new Param(); this.gains.push(node); return node; }
    createDynamicsCompressor() {
      const node = new Node();
      for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[name] = new Param();
      return node;
    }
    createBufferSource() {
      const node = new Node();
      node.start = (when, offset) => { node.started = { when, offset }; };
      node.stop = when => { node.stopped = when; };
      this.sources.push(node); return node;
    }
    resume() {
      if (rejectResume) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      this.state = 'running'; return Promise.resolve();
    }
    decodeAudioData(bytes) {
      if (this.failDecodeOnce) { this.failDecodeOnce = false; return Promise.reject(new Error('bad mp3')); }
      const buffer = { duration: new Uint8Array(bytes)[0] === 1 ? .8 : .25 };
      if (deferDecode) { const task = deferred(); this.pendingDecodes.push({ ...task, buffer }); return task.promise; }
      return Promise.resolve(buffer);
    }
  }
  class FakeAudio {
    constructor() { this.duration = 8; this.currentTime = 0; this.pauseCount = 0; this.requests = []; media.push(this); }
    setAttribute() {}
    load() {}
    pause() { this.pauseCount++; }
    play() { const task = deferred(); this.requests.push(task); return task.promise; }
  }
  const context = vm.createContext({
    window: { AudioContext: FakeContext }, Audio: FakeAudio,
    navigator: { audioSession: { type: 'auto' } }, document: { hidden: false },
    performance: { now: () => 1000 }, setTimeout, clearTimeout,
    Uint8Array, atob: globalThis.atob, console,
    nativeMedia,
    ASSETS: Object.fromEntries(['scale_intro', 'scale_loop', 'success', 'sing', 'water'].map(name => [
      'res/' + name + '.mp3', 'data:audio/mpeg;base64,' + Buffer.from([name === 'scale_intro' ? 1 : 2]).toString('base64')
    ])), C: { AUDIO: {} }
  });
  vm.runInContext(`
    let audio = null, audioGeneration = 0, chargeGeneration = 0, playing = new Set();
    let soundEnabled = true, paused = false, mode = 'play', bottle = { status: 'prepare' }, pressWall = 800;
    let sounds = new Map(), platformPlayer = null, platformVoices = new Map(), audioIssue = '';
    ${runtime}
    globalThis.api = { audioContext, playSound, decodeSound, playPlatformMedia, unlockPlatformAudio,
      startChargeSound, stopAudio, getAudioDiagnostics,
      mute() { soundEnabled = false; }, setPaused(value) { paused = value; },
      get playingCount() { return playing.size; }, get soundCache() { return sounds; } };
  `, context);
  return { api: context.api, context, contexts, media };
}

test('a pending decode cannot start a voice after stopAudio invalidates its generation', async () => {
  const h = harness({ deferDecode: true });
  const result = h.api.playSound('success'); await settle();
  const ctx = h.contexts[0]; assert.equal(ctx.pendingDecodes.length, 1);
  h.api.stopAudio(); ctx.pendingDecodes[0].resolve(ctx.pendingDecodes[0].buffer);
  assert.equal(await result, null); assert.equal(ctx.sources.length, 0);
});

test('charge intro and loop share an exact audio-clock boundary and both cancel on release', async () => {
  const h = harness(); await h.api.startChargeSound();
  const [intro, loop] = h.contexts[0].sources;
  assert.equal(intro.started.offset, .2);
  assert.ok(Math.abs(loop.started.when - (intro.started.when + .8 - .2)) < 1e-10);
  assert.equal(loop.loop, true); assert.equal(h.api.playingCount, 2);
  h.api.stopAudio(false); assert.equal(h.api.playingCount, 0);
  assert.equal(intro.stopped, 10); assert.equal(loop.stopped, 10);
  intro.onended(); loop.onended();
  assert.equal(intro.disconnected, true); assert.equal(loop.gainNode.disconnected, true);
});

test('release during cold charge decoding prevents intro and loop from ever starting', async () => {
  const h = harness({ deferDecode: true });
  const result = h.api.startChargeSound(); await settle(); h.api.stopAudio(false);
  const ctx = h.contexts[0];
  for (const task of ctx.pendingDecodes) task.resolve(task.buffer);
  await result; assert.equal(ctx.sources.length, 0);
});

test('a superseded media play promise cannot pause the newer platform song', async () => {
  const h = harness({ nativeMedia: true }); let oldStarted = 0, newStarted = 0;
  const first = h.api.playPlatformMedia('sing', { onPlay() { oldStarted++; } });
  const element = h.media[0], oldEnded = element.onended;
  h.api.stopAudio();
  const second = h.api.playPlatformMedia('water', { onPlay() { newStarted++; } });
  element.requests[1].resolve(); const newVoice = await second;
  const pauses = element.pauseCount;
  element.requests[0].resolve(); assert.equal(await first, null);
  oldEnded();
  assert.equal(element.pauseCount, pauses); assert.equal(element.__voice, newVoice);
  assert.equal(h.api.playingCount, 1); assert.equal(oldStarted, 0); assert.equal(newStarted, 1);
});

test('late silent-unlock completion cannot pause a song which already owns the element', async () => {
  const h = harness({ nativeMedia: true });
  h.api.unlockPlatformAudio(); const element = h.media[0];
  const result = h.api.playPlatformMedia('water');
  element.requests[1].resolve(); const voice = await result;
  const pauses = element.pauseCount;
  element.requests[0].resolve(); await settle();
  assert.equal(element.pauseCount, pauses); assert.equal(element.__voice, voice);
  assert.equal(element.__track, 'water'); assert.equal(element.muted, false);
});

test('a caller can mark a media voice cancelled before asking it to stop', async () => {
  const h = harness({ nativeMedia: true });
  const result = h.api.playPlatformMedia('sing');
  h.media[0].requests[0].resolve(); const voice = await result;
  const pauses = h.media[0].pauseCount;
  voice.cancelled = true; voice.stop();
  assert.equal(h.media[0].pauseCount, pauses + 1); assert.equal(h.api.playingCount, 0);
});

test('failed audio decoding is evicted so the next gesture can retry', async () => {
  const h = harness(); h.api.audioContext().failDecodeOnce = true;
  assert.equal(await h.api.decodeSound('success'), null); assert.equal(h.api.soundCache.size, 0);
  assert.ok(await h.api.decodeSound('success')); assert.equal(h.api.soundCache.size, 1);
});

test('active Web Audio voices fade before stop, disconnect, and never fire cancelled callbacks', async () => {
  const h = harness(); let ended = 0;
  const voice = await h.api.playSound('success', false, false, { onEnded() { ended++; } });
  h.context.document.hidden = true; h.api.stopAudio();
  assert.ok(Math.abs(voice.stopped - 10.012) < 1e-10);
  assert.ok(voice.gainNode.gain.events.some(event => event[0] === 'ramp' && event[1] === 0));
  voice.onended(); assert.equal(ended, 0); assert.equal(voice.disconnected, true);
  assert.equal(await h.api.playSound('success'), null);
});

test('iOS prefers ambient Web Audio and routes simultaneous sounds through the peak limiter', async () => {
  const h = harness({ nativeMedia: true });
  const voice = await h.api.playSound('sing', false, false, { platformMusic: true });
  assert.ok(voice && !voice.element); assert.equal(h.media.length, 0);
  assert.equal(h.context.navigator.audioSession.type, 'ambient');
  const bus = voice.gainNode.connections[0], limiter = bus.connections[0];
  assert.equal(bus.gain.value, .75); assert.equal(limiter.threshold.value, -3);
  assert.equal(limiter.connections[0], h.contexts[0].destination);
});

test('a rejected context resume does not queue a sound which could unexpectedly play later', async () => {
  const h = harness({ state: 'suspended', rejectResume: true });
  assert.equal(await h.api.playSound('success'), null);
  assert.equal(h.contexts[0].sources.length, 0);
  assert.match(h.api.getAudioDiagnostics().issue, /context-not-running/);
});

test('muted and paused playback create no sources or media elements', async () => {
  const h = harness({ nativeMedia: true }); h.api.mute();
  h.api.unlockPlatformAudio();
  assert.equal(await h.api.playSound('success'), null);
  assert.equal(await h.api.playPlatformMedia('sing'), null);
  h.api.setPaused(true); assert.equal(await h.api.playSound('success'), null);
  assert.equal(h.media.length, 0);
  assert.equal(h.contexts[0]?.sources.length || 0, 0);
});
