import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DrivingInput, DEFAULT_SETTINGS, DEFAULT_DIFFICULTY, DIFFICULTIES,
  resolveDifficulty, sanitizeSettings, signedDeadzone, pedalDeadzone,
  steeringYawRate, selectAutomaticGear, forwardSpeedAfterForces,
} from '../assets/js/race-controls.mjs';

const gears = [0, 14, 24, 36, 49, 62, 74, 83, 89];
const config = { topSpeed: 88, engineAccel: 16.5, brakeAccel: 28, rollResist: 0.7, grassDecel: 15 };

class FakeTarget {
  constructor() { this.listeners = {}; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, data = {}) {
    const event = { target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; }, ...data };
    for (const listener of this.listeners[type] || []) listener(event);
    return event;
  }
}
function makeInput({ pads = [], coarse = false, getGamepads = () => pads } = {}) {
  const target = new FakeTarget();
  const input = new DrivingInput({ target, getGamepads, coarse });
  input.setActive(true);
  return { input, target };
}
function makePad(index = 0) {
  return { index, connected: true, mapping: 'standard', axes: [0, 0, 0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false })) };
}
function hold(input, seconds = 1) {
  for (let i = 0; i < seconds * 60; i++) input.poll(1 / 60);
}

test('A/left and D/right produce motion on the correct side of the camera at every heading', () => {
  for (const [key, expected] of [['KeyA', -1], ['ArrowLeft', -1], ['KeyD', 1], ['ArrowRight', 1]]) {
    const { input, target } = makeInput();
    target.dispatch('keydown', { code: key });
    hold(input);
    assert.equal(Math.sign(input.steer), expected);
    for (const heading of [0, Math.PI / 2, Math.PI, -1.2]) {
      const delta = steeringYawRate(input.steer, 1, 20) * 0.01;
      // Camera looks along (sin heading, cos heading); its right is (-cos, sin).
      const screenRight = -Math.cos(heading) * (Math.sin(heading + delta) - Math.sin(heading)) +
        Math.sin(heading) * (Math.cos(heading + delta) - Math.cos(heading));
      assert.equal(Math.sign(screenRight), expected, `${key} at ${heading}`);
    }
  }
});

test('steering sensitivity affects keyboard and analogue turn authority and reverses when backing up', () => {
  const normal = steeringYawRate(1, 1, 25);
  assert.ok(normal < 0);
  assert.equal(steeringYawRate(1, 0.5, 25), normal * 0.5);
  assert.equal(steeringYawRate(1, 1.5, 25), normal * 1.5);
  assert.ok(steeringYawRate(1, 1, -10) > 0);
  assert.equal(steeringYawRate(1, 1, 0), 0);
  assert.ok(Math.abs(steeringYawRate(0.4, 1, 25, true)) > Math.abs(steeringYawRate(0.4, 1, 25)));
});

test('steering smoothing is frame-rate independent and returns to centre', () => {
  const fast = makeInput(), slow = makeInput();
  fast.target.dispatch('keydown', { code: 'KeyD' });
  slow.target.dispatch('keydown', { code: 'KeyD' });
  for (let i = 0; i < 60; i++) fast.input.poll(1 / 60);
  for (let i = 0; i < 30; i++) slow.input.poll(1 / 30);
  assert.ok(Math.abs(fast.input.steer - slow.input.steer) < 1e-12);
  fast.target.dispatch('keyup', { code: 'KeyD' });
  hold(fast.input, 2);
  assert.equal(fast.input.steer, 0);
});

test('opposite keyboard directions cancel and arrows prevent page scrolling only in game', () => {
  const { input, target } = makeInput();
  assert.equal(target.dispatch('keydown', { code: 'ArrowLeft' }).prevented, true);
  target.dispatch('keydown', { code: 'ArrowRight' });
  hold(input);
  assert.equal(input.steer, 0);
  input.setActive(false);
  assert.equal(target.dispatch('keydown', { code: 'ArrowLeft' }).prevented, undefined);
});

test('standard and unmapped pads never interpret a centred right stick as pedals', () => {
  for (const mapping of ['standard', '']) {
    const pad = makePad(); pad.mapping = mapping;
    const { input } = makeInput({ pads: [pad] });
    hold(input);
    assert.equal(input.throttle, 0);
    assert.equal(input.brake, 0);
    pad.axes[2] = 1; pad.axes[5] = 1;
    input.poll(1 / 60);
    assert.equal(input.throttle, 0);
    assert.equal(input.brake, 0);
  }
});

test('trigger buttons work independently and small resting noise is suppressed', () => {
  const pad = makePad();
  const { input } = makeInput({ pads: [pad] });
  pad.buttons[7].value = 0.05; pad.buttons[6].value = 0.08;
  input.poll(1 / 60);
  assert.equal(input.throttle, 0);
  assert.equal(input.brake, 0);
  pad.buttons[7].value = 1;
  input.poll(1 / 60);
  assert.equal(input.throttle, 1);
  assert.equal(input.brake, 0);
  pad.buttons[7].value = 0; pad.buttons[6].value = 0.54;
  input.poll(1 / 60);
  assert.ok(Math.abs(input.brake - 0.5) < 1e-12);
  assert.equal(input.throttle, 0);
  pad.buttons[0].pressed = true;
  input.poll(1 / 60);
  assert.equal(input.handbrake, true);
});

test('stick and pedal dead zones are continuous, bounded, and reject invalid readings', () => {
  assert.equal(signedDeadzone(0.1), 0);
  assert.equal(signedDeadzone(-0.12), 0);
  assert.ok(signedDeadzone(0.121) > 0 && signedDeadzone(0.121) < 0.01);
  assert.equal(signedDeadzone(-1), -1);
  assert.equal(signedDeadzone(5), 1);
  assert.equal(signedDeadzone(NaN), 0);
  assert.equal(pedalDeadzone(-1), 0);
  assert.equal(pedalDeadzone(Infinity), 0);
  assert.equal(pedalDeadzone(1.2), 1);
});

test('already connected pads are discovered and disconnection does not leave a stuck pedal', () => {
  const first = makePad(0), second = makePad(1);
  first.buttons[6].value = 1;
  const pads = [first, second];
  const { input, target } = makeInput({ pads });
  input.poll(1 / 60);
  assert.equal(input.gamepadIndex, 0);
  assert.equal(input.brake, 1);
  first.connected = false;
  target.dispatch('gamepaddisconnected', { gamepad: first });
  input.poll(1 / 60);
  assert.equal(input.gamepadIndex, 1);
  assert.equal(input.brake, 0);
  second.connected = false;
  input.poll(1 / 60);
  assert.equal(input.gamepadIndex, null);
  assert.equal(input.throttle, 0);
  assert.equal(input.brake, 0);
});

test('unavailable Gamepad API does not prevent keyboard driving', () => {
  const { input, target } = makeInput({ getGamepads: () => { throw new Error('denied'); } });
  target.dispatch('keydown', { code: 'KeyW' });
  input.poll(1 / 60);
  assert.equal(input.throttle, 1);
  assert.equal(input.brake, 0);
});

test('blur, pause and touch cancellation clear all latched controls', () => {
  const { input, target } = makeInput({ coarse: true });
  target.dispatch('keydown', { code: 'KeyW' });
  input.touchThrottle = true; input.touchBrake = true; input.touchSteer = 1;
  input.poll(1 / 60);
  assert.equal(input.throttle, 1);
  target.dispatch('blur');
  assert.equal(input.touchThrottle, false);
  assert.equal(input.touchBrake, false);
  assert.equal(input.touchSteer, 0);
  assert.equal(input.throttle, 0);
  input.touchBrake = true;
  input.setActive(false);
  input.setActive(true);
  input.poll(1 / 60);
  assert.equal(input.brake, 0);
});

test('sliders retain arrow keys and repeated shortcuts do not toggle the game', () => {
  const { input, target } = makeInput();
  let pauses = 0, cameras = 0;
  input.onPause = () => pauses++;
  input.onCamera = () => cameras++;
  const slider = { tagName: 'INPUT' };
  assert.equal(target.dispatch('keydown', { code: 'ArrowRight', target: slider }).prevented, undefined);
  assert.equal(target.dispatch('keydown', { code: 'Space', target: { tagName: 'BUTTON' } }).prevented, undefined);
  input.poll(1 / 60);
  assert.equal(input.steer, 0);
  assert.equal(input.handbrake, false);
  target.dispatch('keydown', { code: 'KeyC' });
  target.dispatch('keydown', { code: 'KeyC', repeat: true });
  target.dispatch('keydown', { code: 'Escape' });
  target.dispatch('keydown', { code: 'Escape', repeat: true });
  assert.equal(cameras, 1);
  assert.equal(pauses, 1);
});

test('automatic gearbox upshifts and downshifts across multiple boundaries', () => {
  assert.equal(selectAutomaticGear(0, 1, gears), 1);
  assert.equal(selectAutomaticGear(13.9, 1, gears), 1);
  assert.equal(selectAutomaticGear(14, 1, gears), 2);
  assert.equal(selectAutomaticGear(85, 1, gears), 8);
  assert.equal(selectAutomaticGear(0, 8, gears), 1);
  assert.equal(selectAutomaticGear(-7, 7, gears), 1);
  assert.equal(selectAutomaticGear(NaN, 1, gears), 1);
});

test('gear hysteresis prevents hunting near a shift point', () => {
  let gear = selectAutomaticGear(14.1, 1, gears);
  assert.equal(gear, 2);
  for (const speed of [13.9, 13, 13.8, 12.5]) {
    gear = selectAutomaticGear(speed, gear, gears);
    assert.equal(gear, 2);
  }
  assert.equal(selectAutomaticGear(12.4, gear, gears), 1);
});

test('accelerating from rest reliably leaves first gear without a ghost brake', () => {
  let speed = 0, gear = 1;
  for (let i = 0; i < 60 * 12; i++) {
    speed = forwardSpeedAfterForces(speed, 1, 0, true, 1 / 60, config).speed;
    gear = selectAutomaticGear(speed, gear, gears);
  }
  assert.ok(speed > 50, `speed=${speed}`);
  assert.ok(gear >= 5, `gear=${gear}`);
});

test('resistance never reverses a coasting car and reverse requires brake input', () => {
  for (const initial of [0, 0.001, 0.1, 5, -0.001, -0.1, -5]) {
    let speed = initial;
    for (let i = 0; i < 1000; i++) {
      const next = forwardSpeedAfterForces(speed, 0, 0, true, 1 / 60, config).speed;
      assert.ok(next === 0 || Math.sign(next) === Math.sign(initial), `${initial} became ${next}`);
      speed = next;
    }
    assert.equal(speed, 0);
  }
  assert.ok(forwardSpeedAfterForces(0, 0, 1, true, 1 / 60, config).speed < 0);
});

test('stored settings fall back safely and stay within supported bounds', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ sensitivity: 5, volume: -1, view: 'chase', muted: true }), {
    sensitivity: 1.5, volume: 0, view: 'chase', muted: true, difficulty: DEFAULT_DIFFICULTY,
  });
  assert.deepEqual(sanitizeSettings({ sensitivity: NaN, volume: 'loud', view: 'bad', muted: 'true' }), DEFAULT_SETTINGS);
  // 難度：未知值退回預設，已知值原樣保留，且絕不會漏掉這個欄位（缺欄位 = 舊存檔升級）
  assert.equal(sanitizeSettings({ difficulty: 'impossible' }).difficulty, DEFAULT_DIFFICULTY);
  assert.equal(sanitizeSettings({ difficulty: 'legend' }).difficulty, 'legend');
  assert.equal(sanitizeSettings({ sensitivity: 1, volume: 0.5, view: 'cockpit', muted: false }).difficulty, DEFAULT_DIFFICULTY);
  assert.equal(DEFAULT_SETTINGS.volume, 0.7, 'engine audio default must stay loud (PR9 regression)');
  assert.deepEqual(DIFFICULTIES.map((level) => level.id), ['rookie', 'pro', 'elite', 'legend']);
  assert.ok(DIFFICULTIES.every((level) => DIFFICULTIES.includes(resolveDifficulty(level.id))), 'every id must resolve to itself');
});
