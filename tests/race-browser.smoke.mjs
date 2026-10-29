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
  assert.equal(await page.locator('#start-volume').inputValue(), '70', 'engine audio must default loud (PR9 regression)');
  assert.equal(await page.evaluate(() => __raceTestGame.settings.difficulty), 'pro', 'default difficulty');
  assert.equal(await page.locator('#screen-start [data-difficulty="pro"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#screen-start [data-difficulty="pro"] .difficulty-row em').isVisible(), true);

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

  // Difficulty changes on the start screen apply immediately (grid size + AI pace).
  await page.locator('#screen-start [data-difficulty="legend"]').click();
  const legend = await page.evaluate(() => ({
    difficulty: __raceTestGame.settings.difficulty,
    opponents: __raceTestGame.difficulty.opponents,
    meta: document.querySelector('#screen-start [data-difficulty-meta]').textContent,
  }));
  assert.equal(legend.difficulty, 'legend');
  assert.equal(legend.opponents, 9);
  assert.ok(/下一場生效/.test(legend.meta) === false, `start-screen meta must not be queued: ${legend.meta}`);
  assert.equal(await page.locator('#screen-start [data-difficulty="legend"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#screen-pause [data-difficulty="legend"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#screen-start [data-difficulty="pro"]').getAttribute('aria-pressed'), 'false');
  await screenshot(page, 'race-start.png');
  await page.locator('#start-btn').click();
  await page.waitForSelector('#hud:not(.hidden)');
  assert.equal(await page.evaluate(() => __raceTestGame.state), 'countdown');
  // 5 顆發車燈依 0.62s 間隔逐一亮起，全亮後 0.58s 熄燈（= 3.68s）
  // 在同一個 evaluate 內取樣，避免 rAF 在斷言之間把倒數跑完
  const lights = await page.evaluate(() => {
    const g = __raceTestGame;
    const lit = () => document.querySelectorAll('#start-lights .light-led.on').length;
    const at = (t) => { g.countdownT = t; g.updateStartLights(); return { lit: lit(), out: g.lightsOut, state: g.state }; };
    return {
      at0: at(0.10), at1: at(0.70), at4: at(2.60), at5: at(3.30),
      visible: !document.querySelector('#start-lights').classList.contains('hidden'),
      leds: document.querySelectorAll('#start-lights .light-led').length,
    };
  });
  assert.equal(lights.leds, 5, 'five start lights');
  assert.equal(lights.visible, true);
  assert.deepEqual([lights.at0.lit, lights.at1.lit, lights.at4.lit, lights.at5.lit], [0, 1, 4, 5]);
  assert.equal(lights.at5.state, 'countdown', 'lights must still be on before lights-out');
  // 玩家從最後一格發車：名次必須等於對手持數 + 1，而不是固定的 P4
  const grid = await page.evaluate(() => ({
    ai: __raceTestGame.activeAi.length,
    position: __raceTestGame.computePosition(),
    text: document.querySelector('#hud-position').textContent,
    total: document.querySelector('#hud-pos-total').textContent,
    towerRows: document.querySelectorAll('#hud-tower .tower-row').length,
    leaderGap: document.querySelector('#hud-gap-ahead').textContent,
  }));
  assert.equal(grid.ai, 9);
  assert.equal(grid.position, 10, `grid position ${JSON.stringify(grid)}`);
  assert.equal(grid.text, 'P10');
  assert.equal(grid.total, '10');
  assert.equal(grid.towerRows, 10);
  assert.ok(grid.leaderGap.length > 0);
  await page.evaluate(() => { __raceTestGame.countdownT = 3.69; });
  await page.waitForFunction(() => __raceTestGame.state === 'racing', null, { timeout: 30000 });
  assert.equal(await page.locator('#start-lights').getAttribute('class').then((c) => c.includes('out')), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#start-lights .light-led.on').length), 0);
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
    g.trackCollision = () => {}; g.activeAi = [];
    p.pos.set(0, 0, 0); p.heading = 0; p.vel.set(0, 0); p.fSpeed = 0; p.speed = 0; p.gear = 1; p.onTrack = true;
    g.input.poll(1 / 60);
    for (let i = 0; i < 720; i++) g.physicsStep(1 / 60, false);
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
      for (let i = 0; i < 20; i++) g.physicsStep(1 / 60, false);
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
  assert.equal(await page.evaluate(() => __raceTestGame.settings.volume), 0.7);
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
  assert.equal(await page.evaluate(() => __raceTestGame.settings.difficulty), 'legend', 'difficulty must persist');
  assert.equal(await page.locator('#screen-start [data-difficulty="legend"]').getAttribute('aria-pressed'), 'true');

  // Mid-race difficulty changes are queued for the next race (never applied live).
  await page.locator('#screen-start [data-difficulty="elite"]').click();
  await page.locator('#start-btn').click();
  await page.waitForSelector('#hud:not(.hidden)');
  await page.evaluate(() => { __raceTestGame.countdownT = 3.7; });
  await page.waitForFunction(() => __raceTestGame.state === 'racing', null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => __raceTestGame.activeAi.length), 7, 'elite field must be seven opponents');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause:not(.hidden)');
  await page.locator('#screen-pause [data-difficulty="rookie"]').click();
  const queued = await page.evaluate(() => ({
    pending: __raceTestGame.pendingDifficulty,
    live: __raceTestGame.difficulty.id,
    field: __raceTestGame.activeAi.length,
    meta: document.querySelector('#screen-pause [data-difficulty-meta]').textContent,
  }));
  assert.equal(queued.pending, 'rookie');
  assert.equal(queued.live, 'elite', 'live field must stay elite until the next race');
  assert.equal(queued.field, 7);
  assert.ok(/下一場生效/.test(queued.meta), `queued meta must say so: ${queued.meta}`);

  // ---- 搶跑罰則：暫停狀態下直接驗證偵測邏輯，避免 frame loop 干擾 ----
  const jump = await page.evaluate(() => {
    const g = __raceTestGame, p = g.player;
    g.jumpStart = false; g.lightsOut = false; g.penaltyMs = 0; p.speed = 4;
    g.detectJumpStart();
    const caught = { jumpStart: g.jumpStart, penaltyMs: g.penaltyMs };
    g.jumpStart = false; g.penaltyMs = 0; p.speed = 0; g.lightsOut = true;
    return caught;
  });
  assert.equal(jump.jumpStart, true);
  assert.equal(jump.penaltyMs, 3000);

  await page.locator('#resume-btn').click();
  await page.waitForSelector('#hud:not(.hidden)');

  // ---- 結算分類表（回歸：過去結算永遠顯示 P4）----
  const finish = await page.evaluate(() => {
    const g = __raceTestGame, p = g.player, S = g.track.S;
    // 玩家率先衝線，AI 仍在場上
    p.crossings = 4; p.laps = 3; p.nearestIdx = 6; p.progress = 4 + 6 / S; p.speed = 72; p.finished = false;
    g.raceTime = 96000; g.lapTimes = [32000, 31800, 32200]; g.bestLap = 31800;
    g.activeAi.forEach((car, i) => { car.crossings = 3; car.laps = 2; car.progress = 3.985 - i * 0.004; car.finished = false; car.speed = 70; });
    g.finishRace();
    const rows = [...document.querySelectorAll('#finish-stats .result-row')];
    return {
      state: g.state,
      field: g.activeAi.length,
      rowCount: rows.length,
      youRow: document.querySelector('#finish-stats .result-row.is-you')?.textContent ?? '',
      firstRow: rows[0]?.textContent ?? '',
      headline: document.querySelector('#finish-stats .stat-row.big strong')?.textContent ?? '',
      gridRow: document.querySelectorAll('#finish-stats .stat-row')[1]?.textContent ?? '',
      classification: !!document.querySelector('#finish-stats .classification'),
      screenVisible: !document.querySelector('#screen-finish').classList.contains('hidden'),
    };
  });
  assert.equal(finish.state, 'finished');
  assert.equal(finish.screenVisible, true);
  assert.equal(finish.classification, true);
  assert.equal(finish.rowCount, finish.field + 1, `classification rows: ${finish.rowCount}`);
  assert.ok(finish.youRow.startsWith('P1'), `the car that crosses first must win: ${finish.youRow}`);
  assert.equal(finish.firstRow, finish.youRow, 'player must head the classification');
  assert.equal(finish.headline, `P1 / ${finish.field + 1}`);
  assert.ok(/WINNER/.test(finish.youRow), finish.youRow);
  assert.ok(new RegExp(`P${finish.field + 1}`).test(finish.gridRow), `grid row must show the back-of-grid start: ${finish.gridRow}`);
  await screenshot(page, 'race-finish.png');
  await context.close();
  console.log('Desktop: keyboard, pad neutrality, automatic gears, cameras, audio, difficulty, start lights, classification and persistence passed.');
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
