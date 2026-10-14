const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function recording(initial) {
  let now = 0, stopped = 0, current;
  const errors = [], saves = [];
  class MediaRecorder {
    constructor() { current = this; }
    start() {}
    stop() { queueMicrotask(() => this.onstop()); }
  }
  const window = { MediaRecorder };
  const context = {
    window, MediaRecorder, Blob, setInterval: () => 1, clearInterval() {},
    FileReader: class {
      readAsDataURL() { this.result = 'data:audio/wav;base64,new'; this.onload(); }
    },
    performance: { now: () => now }, document: { hidden: false },
    navigator: { mediaDevices: { getUserMedia: async () => ({
      getTracks: () => [{ stop() { stopped++; } }],
    }) } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/common/voice-recorder.js'), 'utf8'), context);
  const recorder = new window.CaptainVoiceRecorder({
    initial, error: error => errors.push(error), saved: value => saves.push(value),
  });
  return { recorder, errors, saves, advance: value => { now += value; },
    media: () => current, stopped: () => stopped };
}

for (const failure of ['recorder error', 'empty audio']) {
  test(`a failed resumed segment (${failure}) preserves the previous voice preview and duration`, async () => {
    const initial = { data: 'data:audio/wav;base64,previous', duration: 1200, peaks: [0.1, 0.3] };
    const state = recording(initial);
    await state.recorder.start();
    state.advance(800);
    state.recorder.peaks.push(0.9);
    if (failure === 'recorder error') state.media().onerror();
    assert.equal(await state.recorder.pause(), false);
    assert.equal(state.recorder.initial, initial.data);
    assert.equal(state.recorder.duration, 1200);
    assert.deepEqual(Array.from(state.recorder.peaks), [0.1, 0.3]);
    assert.equal(state.recorder.state, 'idle');
    assert.equal(state.stopped(), 1);
    assert.equal(state.errors.length, 1);
    assert.equal(state.saves.length, 0);
    await state.recorder.start();
    state.advance(300);
    assert.equal(state.recorder.elapsed(), 1500);
    await state.recorder.discard();
    assert.equal(state.recorder.duration, 0);
    assert.equal(state.recorder.initial, null);
  });
}

test('a failed first recording does not consume the next recording allowance', async () => {
  const state = recording();
  await state.recorder.start();
  state.advance(30000);
  state.media().onerror();
  assert.equal(await state.recorder.pause(), false);
  assert.equal(state.recorder.duration, 0);
  await state.recorder.start();
  assert.equal(state.recorder.state, 'recording');
  await state.recorder.discard();
});

test('a draft storage failure does not publish an unsaved voice preview', async () => {
  const state = recording();
  state.recorder.saved = async () => { throw new Error('storage unavailable'); };
  await state.recorder.start();
  state.advance(900);
  state.media().mimeType = 'audio/wav';
  state.media().ondataavailable({ data: new Blob(['audio']) });
  assert.equal(await state.recorder.pause(), false);
  assert.equal(state.recorder.initial, null);
  assert.equal(state.recorder.duration, 0);
  assert.equal(state.errors[0].message, 'storage unavailable');
  assert.equal(state.stopped(), 1);
});
