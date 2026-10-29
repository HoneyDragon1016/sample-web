// Optional browser smoke test. See README for Playwright setup and invocation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.RACE_BASE_URL || 'http://127.0.0.1:8080';
const args = process.env.RACE_BROWSER_ARGS ? JSON.parse(process.env.RACE_BROWSER_ARGS) : ['--enable-unsafe-swiftshader'];
const launch = () => chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args });
let browser = await launch();
const errors = [];

async function instrument(page) {
  page.on('pageerror', (error) => errors.push(error.message));
  // Only add a test reference; all control and physics code is the served code.
  await page.route('**/assets/js/race-cockpit.js', async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    delete headers['content-length'];
    await route.fulfill({ response, headers, body: `${await response.text()}\nwindow.__raceTestGame = game;` });
  });
  // Tests do not depend on external font services.
  await page.route('https://**/*', (route) => route.abort());
}
async function ready(page) {
  await page.goto(`${base}/RaceCockpit01.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not(.hidden)', { timeout: 90000 });
}
async function changeRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function screenshot(page, name) {
  if (process.env.RACE_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.RACE_SCREENSHOT_DIR, name) });
}

try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await context.addInitScript(() => {
    window.__testPad = {
      index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0, 0, 0],
      buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false })),
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__testPad] });
  });
  const page = await context.newPage();
  await instrument(page);
  await ready(page);
  assert.equal(await page.locator('#start-sensitivity').inputValue(), '100');
  assert.equal(await page.locator('#start-volume').inputValue(), '35');

  // Both quality selections update the renderer, mirror and scenery without a reload.
  await page.locator('#screen-start [data-quality="high"]').click();
  const high = await page.evaluate(() => ({ quality: __raceTestGame.quality, trees: __raceTestGame.treeMeshes[0].count, mirror: __raceTestGame.mirrorMeshes[0].material.map === __raceTestGame.mirrorRT.texture }));
  assert.equal(high.quality, 'high');
  assert.equal(high.mirror, true);
  await page.locator('#screen-start [data-quality="low"]').click();
  const low = await page.evaluate(() => ({ trees: __raceTestGame.treeMeshes[0].count, mirror: __raceTestGame.mirrorMeshes[0].material.map === __raceTestGame.staticMirrorTexture }));
  assert.ok(high.trees > low.trees && low.trees <= 180);
  assert.equal(low.mirror, true);

  await changeRange(page, '#start-sensitivity', 125);
  await changeRange(page, '#start-volume', 20);
  assert.equal(await page.locator('output[for="start-sensitivity"]').textContent(), '125%');
  assert.equal(await page.locator('#pause-sensitivity').inputValue(), '125');
  await page.locator('#screen-start [data-view="chase"]').click();
  assert.equal(await page.locator('#screen-start [data-view="chase"]').getAttribute('aria-pressed'), 'true');
  await screenshot(page, 'race-start.png');
  await page.locator('#start-btn').click();
  await page.waitForSelector('#hud:not(.hidden)');
  await page.evaluate(() => { __raceTestGame.countdownT = 2.99; });
  await page.waitForFunction(() => __raceTestGame.state === 'racing', null, { timeout: 30000 });
  const neutral = await page.evaluate(() => ({ throttle: __raceTestGame.input.throttle, brake: __raceTestGame.input.brake, speed: __raceTestGame.player.fSpeed, chaseVisible: __raceTestGame.playerCar.visible, cockpitVisible: __raceTestGame.cockpit.visible, volume: __raceTestGame.audio.volume }));
  assert.equal(neutral.throttle, 0);
  assert.equal(neutral.brake, 0);
  assert.ok(Math.abs(neutral.speed) < 0.01, `neutral speed ${neutral.speed}`);
  assert.equal(neutral.chaseVisible, true);
  assert.equal(neutral.cockpitVisible, false);
  assert.equal(neutral.volume, 0.2);
  await screenshot(page, 'race-chase.png');

  // Exercise the actual game's player physics with a standard, neutral pad and W.
  await page.keyboard.down('w');
  const accelerating = await page.evaluate(() => {
    const g = __raceTestGame, p = g.player;
    g.trackCollision = () => {}; g.ai = [];
    p.pos.set(0, 0, 0); p.heading = 0; p.vel.set(0, 0); p.fSpeed = 0; p.speed = 0; p.gear = 1; p.onTrack = true;
    g.input.poll(1 / 60);
    for (let i = 0; i < 720; i++) g.physicsStep(1 / 60);
    return { throttle: g.input.throttle, brake: g.input.brake, speed: p.fSpeed, gear: p.gear };
  });
  assert.equal(accelerating.throttle, 1);
  assert.equal(accelerating.brake, 0);
  assert.ok(accelerating.speed > 50 && accelerating.gear >= 5, JSON.stringify(accelerating));
  await page.keyboard.up('w');

  // Screen-left is +X at heading 0; test the full keyboard -> physics path.
  async function turn(key) {
    await page.evaluate(() => {
      const g = __raceTestGame, p = g.player;
      g.input.clear(); p.pos.set(0, 0, 0); p.heading = 0; p.vel.set(0, 20); p.speed = 20; p.fSpeed = 20; p.onTrack = true;
    });
    await page.keyboard.down(key);
    const result = await page.evaluate(() => {
      const g = __raceTestGame;
      g.input.poll(0.6);
      for (let i = 0; i < 20; i++) g.physicsStep(1 / 60);
      return { heading: g.player.heading, x: g.player.pos.x };
    });
    await page.keyboard.up(key);
    return result;
  }
  const left = await turn('a'), right = await turn('d');
  assert.ok(left.heading > 0 && left.x > 0, JSON.stringify(left));
  assert.ok(right.heading < 0 && right.x < 0, JSON.stringify(right));

  await page.keyboard.press('c');
  assert.equal(await page.evaluate(() => __raceTestGame.settings.view), 'cockpit');
  assert.equal(await page.evaluate(() => __raceTestGame.cockpit.visible && !__raceTestGame.playerCar.visible), true);
  await screenshot(page, 'race-cockpit.png');
  await page.locator('#view-btn').click();
  assert.equal(await page.evaluate(() => __raceTestGame.settings.view), 'chase');
  // Space activates a keyboard-focused HUD button instead of driving the car.
  await page.locator('#view-btn').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => __raceTestGame.settings.view), 'cockpit');
  await page.locator('#view-btn').click();
  assert.equal(await page.evaluate(() => __raceTestGame.settings.view), 'chase');
  await page.locator('#mute-btn').click();
  assert.equal(await page.locator('#mute-btn').getAttribute('aria-pressed'), 'true');

  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause:not(.hidden)');
  assert.deepEqual(await page.evaluate(() => [__raceTestGame.input.throttle, __raceTestGame.input.brake, __raceTestGame.input.steer]), [0, 0, 0]);
  await changeRange(page, '#pause-volume', 10);
  assert.equal(await page.locator('#start-volume').inputValue(), '10');
  assert.equal(await page.evaluate(() => __raceTestGame.settings.muted), false);
  await page.locator('#pause-sensitivity').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#pause-sensitivity').inputValue(), '130');
  assert.equal(await page.evaluate(() => __raceTestGame.input.steer), 0);
  await changeRange(page, '#pause-volume', 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#hud:not(.hidden)');
  assert.equal(await page.locator('#mute-btn').getAttribute('aria-pressed'), 'true');
  await page.locator('#mute-btn').click();
  assert.equal(await page.evaluate(() => __raceTestGame.settings.volume), 0.35);
  await page.keyboard.press('Escape');
  await changeRange(page, '#pause-volume', 10);
  await page.keyboard.press('Escape');
  await page.locator('#mute-btn').click();
  assert.equal(await page.locator('#mute-btn').getAttribute('aria-pressed'), 'true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not(.hidden)', { timeout: 90000 });
  assert.equal(await page.locator('#start-sensitivity').inputValue(), '130');
  assert.equal(await page.locator('#start-volume').inputValue(), '10');
  assert.equal(await page.locator('#screen-start [data-view="chase"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => __raceTestGame.settings.muted), true);
  await context.close();
  console.log('Desktop: keyboard, pad neutrality, automatic gears, cameras, audio, pause, quality and persistence passed.');
  // Re-launch between contexts, including on constrained single-process Chromium.
  await browser.close();
  browser = await launch();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  await instrument(mobilePage);
  await ready(mobilePage);
  await screenshot(mobilePage, 'race-mobile-start.png');
  await mobilePage.locator('#start-btn').click(); // scrolls the settings screen if needed
  await mobilePage.waitForSelector('#hud:not(.hidden)');
  assert.equal(await mobilePage.locator('#touch-ui').isVisible(), true);
  const layout = await mobilePage.evaluate(() => {
    const rect = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    return { timing: rect('.hud-timing'), topRight: rect('.hud-topright'), map: rect('.hud-map'), pedals: rect('.touch-pedals'), speedo: rect('.hud-speedo') };
  });
  assert.ok(layout.timing.right <= layout.topRight.left, JSON.stringify(layout));
  assert.ok(layout.map.bottom < layout.pedals.top && layout.speedo.bottom < layout.pedals.top, JSON.stringify(layout));
  const touch = await mobilePage.evaluate(() => {
    const gas = document.querySelector('.touch-gas');
    const steer = document.querySelector('.touch-steer');
    const send = (node, type, id, x, y) => {
      const point = new Touch({ identifier: id, target: node, clientX: x, clientY: y });
      const active = type === 'touchend' || type === 'touchcancel' ? [] : [point];
      node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [point] }));
    };
    send(gas, 'touchstart', 1, 330, 780);
    const gasDown = __raceTestGame.input.touchThrottle;
    send(gas, 'touchend', 1, 330, 780);
    const gasUp = __raceTestGame.input.touchThrottle;
    send(steer, 'touchstart', 2, 50, 400);
    send(steer, 'touchmove', 2, 100, 400);
    __raceTestGame.input.poll(0.5);
    const steerRight = __raceTestGame.input.steer;
    send(steer, 'touchcancel', 2, 100, 400);
    return { gasDown, gasUp, steerRight, reset: __raceTestGame.input.touchSteer };
  });
  assert.equal(touch.gasDown, true);
  assert.equal(touch.gasUp, false);
  assert.ok(touch.steerRight > 0 && touch.reset === 0, JSON.stringify(touch));
  await mobilePage.waitForSelector('#banner.animate:not(.hidden)', { timeout: 15000 });
  assert.equal(await mobilePage.locator('#banner').evaluate((el) => getComputedStyle(el).animationName), 'none');
  await screenshot(mobilePage, 'race-mobile-hud.png');
  await mobile.close();
  console.log('Mobile: scrollable setup, touch controls and HUD layout passed.');
  await browser.close();
  browser = await launch();

  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl' || kind === 'webgl2' ? null : original.call(this, kind, ...args);
    };
  });
  const fallbackPage = await fallbackContext.newPage();
  await instrument(fallbackPage);
  await fallbackPage.goto(`${base}/RaceCockpit01.html`, { waitUntil: 'domcontentloaded' });
  await fallbackPage.waitForSelector('#screen-fallback:not(.hidden)', { timeout: 30000 });
  assert.equal(await fallbackPage.locator('#screen-loading').isVisible(), false);
  await fallbackContext.close();
  assert.deepEqual(errors, []);
  console.log('WebGL fallback and JavaScript error checks passed.');
} finally {
  await browser.close();
}
