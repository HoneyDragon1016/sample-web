/** Input and vehicle helpers shared by the game and its regression tests. */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1,
  volume: 0.6,
  difficulty: 'pro',
  view: 'cockpit',
  muted: false,
});

export function sanitizeSettings(value) {
  const settings = value && typeof value === 'object' ? value : {};
  const numberOr = (v, fallback, min, max) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  return {
    sensitivity: numberOr(settings.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.5, 1.5),
    volume: numberOr(settings.volume, DEFAULT_SETTINGS.volume, 0, 1),
    view: settings.view === 'chase' ? 'chase' : 'cockpit',
    difficulty: ['rookie', 'pro', 'elite'].includes(settings.difficulty) ? settings.difficulty : 'pro',
    muted: settings.muted === true,
  };
}

// Remap the remaining travel, rather than jumping when leaving the dead zone.
export function signedDeadzone(value, deadzone = 0.12) {
  const v = Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  const magnitude = Math.abs(v);
  return magnitude <= deadzone ? 0 : Math.sign(v) * (magnitude - deadzone) / (1 - deadzone);
}

export function pedalDeadzone(value, deadzone = 0.08) {
  const v = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  return v <= deadzone ? 0 : (v - deadzone) / (1 - deadzone);
}

function buttonValue(button) {
  if (!button) return 0;
  const value = Number.isFinite(button.value) ? button.value : (button.pressed ? 1 : 0);
  return pedalDeadzone(value);
}

function isEditing(target) {
  if (!target) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '') || target.isContentEditable;
}

/**
 * Standard Gamepad API triggers are buttons 6 and 7. Axes 2/5 must not be
 * guessed as pedals: on many controllers they are a centred right stick (0),
 * which would otherwise look like 50% throttle and 50% brake at rest.
 */
export class DrivingInput {
  constructor({ target = window, getGamepads = () => navigator.getGamepads?.() || [], coarse = false } = {}) {
    this.keys = {};
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.touchSteer = 0;
    this.touchThrottle = false;
    this.touchBrake = false;
    this.sensitivity = 1;
    this.gamepadIndex = null;
    this.active = false;
    this.coarse = coarse;
    this.getGamepads = getGamepads;
    this.onPause = null;
    this.onCamera = null;

    target.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        if (!event.repeat && this.onPause) this.onPause();
        return;
      }
      if (!this.active || isEditing(event.target)) return;
      // Leave Space to a focused button/link so keyboard users can activate it.
      if (event.code === 'Space' && /^(BUTTON|A)$/.test(event.target?.tagName || '')) return;
      if (event.code === 'KeyC') {
        if (!event.repeat && this.onCamera) this.onCamera();
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
      this.keys[event.code] = true;
    });
    target.addEventListener('keyup', (event) => { this.keys[event.code] = false; });
    target.addEventListener('blur', () => this.clear());
    target.addEventListener('gamepadconnected', (event) => { this.gamepadIndex = event.gamepad.index; });
    target.addEventListener('gamepaddisconnected', (event) => {
      if (event.gamepad.index === this.gamepadIndex) this.gamepadIndex = null;
    });
  }

  clear() {
    this.keys = {};
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.touchSteer = 0;
    this.touchThrottle = false;
    this.touchBrake = false;
  }

  setActive(active) {
    this.active = active;
    if (!active) this.clear();
  }

  poll(dt) {
    if (!this.active) return;
    const k = this.keys;
    let target = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    let throttle = k.ArrowUp || k.KeyW ? 1 : 0;
    let brake = k.ArrowDown || k.KeyS ? 1 : 0;
    let handbrake = !!k.Space;

    // A pad may have been connected before the page loaded; discover it as well
    // as listening for connection events. A denied API must not stop the race.
    let pads = [];
    try { pads = this.getGamepads() || []; } catch (_) { /* API unavailable */ }
    let pad = this.gamepadIndex == null ? null : pads[this.gamepadIndex];
    if (!pad || pad.connected === false) {
      pad = Array.from(pads).find((candidate) => candidate && candidate.connected !== false) || null;
      this.gamepadIndex = pad ? pad.index : null;
    }
    if (pad) {
      const stick = signedDeadzone(pad.axes?.[0]);
      if (stick !== 0) target = stick;
      throttle = Math.max(throttle, buttonValue(pad.buttons?.[7]));
      brake = Math.max(brake, buttonValue(pad.buttons?.[6]));
      if (pad.buttons?.[0]?.pressed) handbrake = true;
    }

    if (this.coarse) {
      if (this.touchSteer) target = clamp(this.touchSteer, -1, 1);
      if (this.touchThrottle) throttle = 1;
      if (this.touchBrake) brake = 1;
    }

    const rate = target === 0 ? 9 : 6.5;
    this.steer += (target - this.steer) * (1 - Math.exp(-Math.max(0, dt) * rate));
    if (Math.abs(this.steer) < 0.005) this.steer = 0;
    this.throttle = throttle;
    this.brake = brake;
    this.handbrake = handbrake;
  }
}

/** Positive input means screen-right; heading increases towards screen-left. */
export function steeringYawRate(steer, sensitivity, forwardSpeed, handbrake = false) {
  if (steer === 0 || forwardSpeed === 0) return 0;
  const speedFactor = Math.min(Math.abs(forwardSpeed) / 9, 1);
  const authority = clamp(1.75 / (1 + Math.abs(forwardSpeed) * 0.03), 0.3, 1.75) * (handbrake ? 1.55 : 1);
  return -steer * sensitivity * authority * speedFactor * Math.sign(forwardSpeed || 1);
}

/** Speed-based automatic gearbox with hysteresis to prevent shift hunting. */
export function selectAutomaticGear(forwardSpeed, previousGear, thresholds, hysteresis = 1.5) {
  const speed = Number.isFinite(forwardSpeed) ? Math.max(0, forwardSpeed) : 0;
  let gear = Number.isInteger(previousGear) ? clamp(previousGear, 1, thresholds.length - 1) : 1;
  while (gear < thresholds.length - 1 && speed >= thresholds[gear]) gear++;
  while (gear > 1 && speed < thresholds[gear - 1] - hysteresis) gear--;
  return gear;
}

/** Apply propulsion and resistance without rolling resistance crossing through zero. */
export function forwardSpeedAfterForces(speed, throttle, brake, onTrack, dt, config) {
  const previous = speed;
  let acceleration = config.engineAccel * throttle * (1 - speed / config.topSpeed);
  if (brake > 0) acceleration -= (speed > 0.5 ? config.brakeAccel : 5) * brake;
  speed += acceleration * dt;
  const resistance = config.rollResist + (onTrack ? 0 : config.grassDecel * Math.min(1, Math.abs(speed) / 8));
  speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - resistance * dt);
  speed = clamp(speed, -7, config.topSpeed);
  return { speed, acceleration: dt > 0 ? (speed - previous) / dt : 0 };
}

/** Both racers use completed start-line crossings plus fractional track progress.
 * Call after incrementing crossings on a wrap, including the finish crossing. */
export function raceProgress(crossings, sampleIndex, sampleCount) {
  return crossings + sampleIndex / sampleCount;
}

export const AI_DIFFICULTY = Object.freeze({
  rookie: Object.freeze({ speed: 0.94, accel: 12 }),
  pro: Object.freeze({ speed: 1.07, accel: 16 }),
  elite: Object.freeze({ speed: 1.18, accel: 20 }),
});
