/**
 * Race simulation regression tests — track geometry, racing line, AI pacing,
 * difficulty calibration, and the lap/standings logic that decides the result.
 *
 * Everything under test is the exact code the browser runs (`assets/js/*.mjs`),
 * with no browser or WebGL required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK, AI_LAT_ACCEL, PLAYER_LAT_ACCEL,
  closedCatmullRom, buildTrackData, buildRacingLine, pathGeometry, buildSpeedProfile,
  buildPlayerProfile, vehicleStep, aiStep, raceStandings, gapSeconds, formatGap,
  slipstreamAmount, detectLapCrossing, trackProgress, crossingsToFinish,
} from '../assets/js/race-sim.mjs';
import { DIFFICULTIES, resolveDifficulty, sanitizeSettings } from '../assets/js/race-controls.mjs';

const PLAYER_CFG = {
  topSpeed: 92, engineAccel: 16.5, brakeAccel: 28, rollResist: 0.7,
  grassDecel: 15, grip: 8.5, yawAuthority: 1.75,
};
const TOTAL_LAPS = 3;

/* ---------- shared world (built once; ~2 900 m closed circuit) ---------- */
const track = buildTrackData();
const line = buildRacingLine(track);
const lineGeo = pathGeometry(track, line);
const centerGeo = pathGeometry(track, null);
const trackWithPathScale = { ...track, pathScale: lineGeo.scale };
const aiProfile = buildSpeedProfile(lineGeo.curvature, lineGeo.ds, {
  latAccel: AI_LAT_ACCEL, topSpeed: 92, brakeDecel: 22, accel: 13,
});
const playerProfile = buildPlayerProfile(track, { topSpeed: PLAYER_CFG.topSpeed, line });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// 由切線叉積取得 i 點的彎向（>0 表示 yaw 增加／向左），作為有符號曲率的獨立實作
const crossAt = (tr, i) => {
  const a = tr.tangents[i], b = tr.tangents[(i + 1) % tr.S];
  return a.z * b.x - a.x * b.z;
};
const wrap = (a) => { let x = a; while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };
const authorityOf = (v) => Math.max(0.3, Math.min(PLAYER_CFG.yawAuthority, PLAYER_CFG.yawAuthority / (1 + Math.abs(v) * 0.03)));
const harmonicLap = (profile, ds) => {
  let time = 0;
  for (let i = 0; i < profile.length; i++) time += ds[i] / Math.max(profile[i], 1);
  return time;
};

/**
 * Drives the *player* physics model with a curvature feed-forward + heading
 * feedback controller. Used as the calibration reference for AI difficulty:
 * it is the fastest a car obeying `vehicleStep` can realistically go.
 */
function driveReferenceLap(profile, { margin = 1, kp = 9, lookTime = 0.45, laps = 2 } = {}) {
  const st = { x: track.points[0].x, z: track.points[0].z, vx: 0, vz: 0, heading: track.yaws[0], onTrack: true, speed: 0 };
  const inp = { steer: 0, throttle: 1, brake: 0, handbrake: false, sensitivity: 1 };
  const dt = 1 / 240;
  let idx = 0, steer = 0, prev = 0, time = 0, lapStart = 0, crossings = 0, offTrack = 0;
  const times = [];
  for (let step = 0; step < 240 * 600; step++) {
    let best = idx, bestD = Infinity;
    for (let k = -46; k <= 46; k++) {
      const i = (idx + k + track.S * 2) % track.S;
      const dx = track.points[i].x - st.x, dz = track.points[i].z - st.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    prev = idx; idx = best;
    const lateral = (st.x - track.points[idx].x) * track.rights[idx].x + (st.z - track.points[idx].z) * track.rights[idx].z;
    st.onTrack = Math.abs(lateral) < TRACK.halfWidth;
    if (!st.onTrack) offTrack += dt;

    const look = Math.max(3, Math.round((st.speed * lookTime) / track.segLen));
    const j = (idx + look) % track.S;
    const err = wrap(Math.atan2(lineGeo.px[j] - st.x, lineGeo.pz[j] - st.z) - st.heading);
    const v = Math.max(st.speed, 1);
    const feedForward = -(lineGeo.curvatureSigned[idx] * v) / authorityOf(v);
    const target = Math.max(-1, Math.min(1, feedForward - err * kp));
    steer += (target - steer) * (1 - Math.exp(-dt * 6.5));   // same smoothing as DrivingInput
    inp.steer = Math.abs(steer) < 0.005 ? 0 : steer;

    const vTarget = profile[idx] * margin;
    if (st.speed > vTarget + 0.5) { inp.throttle = 0; inp.brake = Math.min(1, (st.speed - vTarget) / 6); }
    else { inp.throttle = 1; inp.brake = 0; }

    vehicleStep(st, inp, PLAYER_CFG, dt);
    time += dt;
    if (detectLapCrossing(prev, idx, track.S, st.speed)) {
      crossings++;
      if (crossings >= 2) { times.push(time - lapStart); lapStart = time; } else lapStart = time;
    }
    if (times.length >= laps) break;
  }
  return { best: Math.min(...times), offTrack, crossings };
}

function driveAiLap(level, { laps = 2, mistakeRate = 0 } = {}) {
  const field = level.opponents;
  const cars = [];
  for (let k = 0; k < field; k++) {
    const spread = field > 1 ? (k / (field - 1) - 0.5) * level.paceSpread : 0;
    const pace = level.pace * (1 + spread);
    const profile = new Float32Array(track.S);
    for (let i = 0; i < track.S; i++) profile[i] = aiProfile[i] * pace;
    // 與遊戲 buildGrid 相同的發車格：每列 7 個取樣間隔、左右交錯、依序延遲起步
    const rowGap = 7;
    const t = (((0 - k * rowGap) % track.S) + track.S) / track.S;
    const idx = Math.floor(t * track.S) % track.S;
    const side = field > 1 ? (k % 2 === 0 ? -3.3 : 3.3) : 0;
    cars.push({
      id: k, t, idx, speed: 0, lateral: clamp(line[idx] + side, -8.6, 8.6), prevLateral: line[idx],
      aggression: level.aggression, accel: level.accel, brake: level.brake,
      mistakeRate, mistakeTimer: 0, mistakeScale: 1, crossings: 0, progress: t,
      launchDelay: field > 1 ? 0.08 + k * 0.055 : 0,
      profile, laps: 0, finished: false, finishTime: Infinity,
    });
  }
  const dt = 1 / 240;
  // 記錄每次越線的時刻；相鄰兩次之差即為一圈（第一圈含靜止起步，取最小值時自然被排除）
  const crossingTimes = cars.map(() => []);
  let time = 0;
  let minSeparation = Infinity;
  for (let step = 0; step < 240 * 600; step++) {
    for (const car of cars) aiStep(car, trackWithPathScale, car.profile, line, cars, dt);
    time += dt;
    cars.forEach((car, i) => {
      while (car.crossings > crossingTimes[i].length) crossingTimes[i].push(time);
    });
    if (cars.length > 1 && step % 6 === 0) {
      for (let a = 0; a < cars.length; a++) {
        for (let b = a + 1; b < cars.length; b++) {
          const ia = cars[a].idx, ib = cars[b].idx;
          const ax = lineGeo.px[ia] + track.rights[ia].x * cars[a].lateral;
          const az = lineGeo.pz[ia] + track.rights[ia].z * cars[a].lateral;
          const bx = lineGeo.px[ib] + track.rights[ib].x * cars[b].lateral;
          const bz = lineGeo.pz[ib] + track.rights[ib].z * cars[b].lateral;
          minSeparation = Math.min(minSeparation, Math.hypot(ax - bx, az - bz));
        }
      }
    }
    if (crossingTimes.every((log) => log.length >= laps + 1)) break;
  }
  const durations = crossingTimes.map((log) => log.slice(1).map((t, i) => t - log[i]));
  return {
    cars,
    fastest: Math.min(...durations.map((log) => Math.min(...log))),
    durations, crossingTimes, minSeparation,
  };
}

/* ================================================================== */
test('closed spline is periodic, arc-length parameterised and free of cusps', () => {
  const curve = closedCatmullRom([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]);
  const a = curve.point(0), b = curve.point(1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6, 'curve must close');
  // equal steps in u must give near-equal steps in distance (arc-length param)
  const steps = [];
  for (let i = 0; i < 64; i++) {
    const p0 = curve.point(i / 64), p1 = curve.point((i + 1) / 64);
    steps.push(Math.hypot(p1.x - p0.x, p1.z - p0.z));
  }
  const mean = steps.reduce((x, y) => x + y, 0) / steps.length;
  assert.ok(steps.every((d) => Math.abs(d - mean) / mean < 0.02), 'arc-length parameterisation drift');
  // 向心 Catmull-Rom 會稍微外擴通過角點，故周長略大於 40
  assert.ok(curve.totalLength > 40.5 && curve.totalLength < 44, `square perimeter ${curve.totalLength}`);
  for (let i = 0; i < 32; i++) {
    const t = curve.tangent(i / 32);
    assert.ok(Math.abs(Math.hypot(t.x, t.z) - 1) < 1e-9, 'tangent must be unit length');
  }
});

test('generated circuit is closed, sampled evenly and never self-intersects locally', () => {
  assert.equal(track.S, TRACK.samples);
  assert.ok(track.totalLength > 2500 && track.totalLength < 3500, `length ${track.totalLength}`);
  const first = track.points[0], last = track.points[track.S - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < track.segLen * 1.5, 'closure gap');
  const lengths = [];
  for (let i = 0; i < track.S; i++) {
    const a = track.points[i], b = track.points[(i + 1) % track.S];
    lengths.push(Math.hypot(b.x - a.x, b.z - a.z));
  }
  const mean = lengths.reduce((x, y) => x + y, 0) / lengths.length;
  assert.ok(lengths.every((d) => Math.abs(d - mean) / mean < 0.05), 'sample spacing must be even');
  const rawSign = (i) => Math.sign(crossAt(track, i));
  let inflectionDisagreements = 0;
  for (let i = 0; i < track.S; i++) {
    const t = track.tangents[i], r = track.rights[i];
    assert.ok(Math.abs(t.x * r.x + t.z * r.z) < 1e-9, 'right vector must be perpendicular');
    assert.ok(Math.abs(Math.hypot(r.x, r.z) - 1) < 1e-9, 'right vector must be unit');
    assert.ok(track.curvature[i] >= 0, 'unsigned curvature');
    // 有符號曲率的大小不會超過無符號曲率（左右彎交界處平滑會互相抵銷）
    assert.ok(Math.abs(track.curvatureSigned[i]) <= track.curvature[i] + 1e-9, 'signed curvature magnitude');
    // 方向必須與切線叉積一致；唯一允許的例外是反曲點附近（平滑視窗跨越左右彎）
    if (Math.abs(track.curvatureSigned[i]) > 1e-9 && Math.sign(track.curvatureSigned[i]) !== rawSign(i)) {
      const nearInflection = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
        .some((k) => rawSign((i + k + track.S) % track.S) !== rawSign((i + k + 1 + track.S) % track.S));
      assert.ok(nearInflection, `curvature sign disagrees away from an inflection at ${i}`);
      inflectionDisagreements++;
    }
    assert.equal(Math.round(Math.atan2(t.x, t.z) * 1e6) / 1e6, Math.round(track.yaws[i] * 1e6) / 1e6);
  }
  assert.ok(inflectionDisagreements < track.S * 0.02, `too many sign disagreements: ${inflectionDisagreements}`);
});

test('racing line stays inside the track and is quicker than the centre line', () => {
  const limit = TRACK.halfWidth - 1.5;
  for (let i = 0; i < track.S; i++) {
    assert.ok(Math.abs(line[i]) <= limit + 1e-9, `offset ${line[i]} out of bounds at ${i}`);
  }
  // The line must actually use both sides of the track (cut in, run out).
  assert.ok(Math.max(...line) > limit * 0.55, 'line never uses the right side');
  assert.ok(Math.min(...line) < -limit * 0.55, 'line never uses the left side');
  // Cornering advantage: total curvature energy must be lower than the centre line.
  const energy = (geo) => geo.curvature.reduce((sum, k) => sum + k * k, 0);
  assert.ok(energy(lineGeo) < energy(centerGeo), 'racing line must reduce curvature energy');
  // And it must be a shorter lap at the same average speed.
  assert.ok(lineGeo.length < centerGeo.length, 'racing line must be shorter');
  // Smoothness: no step changes that would snap the steering.
  for (let i = 0; i < track.S; i++) {
    const d = Math.abs(line[(i + 1) % track.S] - line[i]);
    assert.ok(d < 0.55, `lateral jump ${d} at ${i}`);
  }
});

test('speed profile respects the lateral budget and is physically followable', () => {
  for (let i = 0; i < track.S; i++) {
    const k = lineGeo.curvature[i];
    const latAccel = aiProfile[i] * aiProfile[i] * k;
    assert.ok(latAccel <= AI_LAT_ACCEL + 0.6, `corner ${i} demands ${latAccel.toFixed(1)} m/s²`);
    // braking feasibility: must be able to slow to the next sample's limit
    const next = aiProfile[(i + 1) % track.S];
    const needed = (aiProfile[i] * aiProfile[i] - next * next) / (2 * lineGeo.ds[i]);
    assert.ok(needed <= 22 + 0.75, `sample ${i} needs ${needed.toFixed(1)} m/s² of braking`);
  }
  assert.ok(Math.max(...aiProfile) > 88, 'straights must reach top speed');
  assert.ok(Math.min(...aiProfile) > 40, 'no corner should crawl');
  // the player's own grip law must allow more corner speed than the AI budget
  assert.ok(PLAYER_LAT_ACCEL > AI_LAT_ACCEL);
  const tightest = lineGeo.curvature.indexOf(Math.max(...lineGeo.curvature));
  assert.ok(playerProfile[tightest] > aiProfile[tightest], 'player corner ceiling must exceed AI');
});

test('vehicleStep reproduces the shipped longitudinal model and stays frame-rate independent', () => {
  const state = (speed) => ({ x: 0, z: 0, vx: 0, vz: speed, heading: 0, onTrack: true, speed });
  const input = { steer: 0, throttle: 1, brake: 0, handbrake: false, sensitivity: 1 };
  const coarse = state(0), fine = state(0);
  for (let i = 0; i < 600; i++) vehicleStep(coarse, input, PLAYER_CFG, 1 / 60);
  for (let i = 0; i < 2400; i++) vehicleStep(fine, input, PLAYER_CFG, 1 / 240);
  assert.ok(coarse.speed > 60, `coarse speed ${coarse.speed}`);
  assert.ok(Math.abs(coarse.speed - fine.speed) < 1.5, `${coarse.speed} vs ${fine.speed}`);
  assert.ok(coarse.fSpeed <= PLAYER_CFG.topSpeed + 1e-9);
  // slipstream raises both top speed and acceleration
  const clean = state(0), towed = state(0);
  for (let i = 0; i < 1200; i++) {
    vehicleStep(clean, input, PLAYER_CFG, 1 / 60, 1);
    vehicleStep(towed, input, PLAYER_CFG, 1 / 60, 0.945);
  }
  assert.ok(towed.speed > clean.speed, 'slipstream must raise top speed');
  assert.ok(towed.speed <= PLAYER_CFG.topSpeed * 1.06 + 1e-6);
  // off track bleeds speed, handbrake reduces grip
  const grass = state(40); grass.onTrack = false;
  vehicleStep(grass, { ...input, throttle: 0 }, PLAYER_CFG, 1);
  assert.ok(grass.speed < 30, 'grass must slow the car');
  const drift = state(30);
  vehicleStep(drift, { ...input, steer: 1, handbrake: true }, PLAYER_CFG, 0.4);
  assert.ok(Math.abs(drift.lSpeed) > 0.5, 'handbrake must break traction');
});

test('lap crossing and progress follow the start-line convention', () => {
  assert.equal(detectLapCrossing(990, 5, 1000, 40), true);
  assert.equal(detectLapCrossing(990, 5, 1000, 1), false, 'must ignore being pushed backwards');
  assert.equal(detectLapCrossing(400, 500, 1000, 40), false);
  assert.equal(detectLapCrossing(990, 300, 1000, 40), false, 'must not fire twice in one lap');
  assert.equal(crossingsToFinish(TOTAL_LAPS), TOTAL_LAPS + 1);
  assert.equal(trackProgress(0, 970, 1000), 0.97);
  assert.equal(trackProgress(4, 0, 1000), 4);
});

test('REGRESSION: the car that crosses the line first wins, whatever the grid said', () => {
  // 舊版 bug：progress 在 crossings++ **之前**寫入，衝線當下玩家整整落後一圈；
  // 而舊的名次計算只比較 progress，於是結算畫面永遠是 P4。
  const legacyPosition = (mine, others) => 1 + others.filter((o) => o > mine).length;

  const field = [
    { id: 'p1', code: 'A', progress: trackProgress(3, 995, 1000), laps: 2, finished: false, finishTime: Infinity },
    { id: 'p2', code: 'B', progress: trackProgress(3, 990, 1000), laps: 2, finished: false, finishTime: Infinity },
    { id: 'p3', code: 'C', progress: trackProgress(3, 985, 1000), laps: 2, finished: false, finishTime: Infinity },
    { id: 'you', code: 'YOU', progress: trackProgress(3, 900, 1000), laps: 2, finished: false, finishTime: Infinity },
  ];
  const rivals = () => field.slice(0, 3).map((c) => c.progress);
  assert.equal(raceStandings(field).find((r) => r.id === 'you').position, 4, 'starts last');

  // 玩家先過終點線：progress 必須已含最新一圈
  const crossing = { ...field[3], crossings: 4, progress: trackProgress(4, 2, 1000), finished: true, finishTime: 96000, laps: 3 };
  const atFlag = raceStandings([...field.slice(0, 3), crossing]);
  assert.equal(atFlag.find((r) => r.id === 'you').position, 1, 'crossing first must win');

  // 舊規則 + 舊的過期 progress ⇒ 正是使用者看到的 P4
  const staleProgress = trackProgress(3, 2, 1000);
  assert.equal(legacyPosition(staleProgress, rivals()), 4, 'stale progress + progress-only ranking forced P4');
  assert.equal(legacyPosition(crossing.progress, rivals()), 1, 'corrected progress is what fixes it');

  // 就算某台車忘了標記 finished，新排名依然以 progress 決定，不會退化成 P4
  const unlapped = { ...crossing, finished: false, finishTime: Infinity };
  assert.equal(raceStandings([...field.slice(0, 3), unlapped]).find((r) => r.id === 'you').position, 1);

  // 已完賽且時間更短的 AI 必須排在玩家前面
  const earlier = { ...field[0], finished: true, finishTime: 95000 };
  assert.equal(raceStandings([earlier, ...field.slice(1, 3), crossing]).find((r) => r.id === 'you').position, 2);
});

test('standings rank finishers by time, then the running order by projected progress', () => {
  const racers = [
    { id: 'slowFinisher', progress: 4.05, laps: 3, finished: true, finishTime: 120000 },
    { id: 'fastFinisher', progress: 4.02, laps: 3, finished: true, finishTime: 110000 },
    { id: 'leader', progress: 3.98, laps: 2, finished: false, finishTime: Infinity },
    { id: 'middle', progress: 3.55, laps: 2, finished: false, finishTime: Infinity },
    { id: 'lapped', progress: 2.99, laps: 2, finished: false, finishTime: Infinity },
  ];
  const order = raceStandings(racers).map((r) => r.id);
  assert.deepEqual(order, ['fastFinisher', 'slowFinisher', 'leader', 'middle', 'lapped']);
  assert.deepEqual(raceStandings(racers).map((r) => r.position), [1, 2, 3, 4, 5]);
  // stable: equal progress keeps input order instead of flickering every frame
  const tie = [{ id: 'a', progress: 1.5, laps: 1, finished: false }, { id: 'b', progress: 1.5, laps: 1, finished: false }];
  assert.deepEqual(raceStandings(tie).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(raceStandings([]), []);
});

test('gaps and slipstream read sensibly', () => {
  const leader = { progress: 1.20, finished: false, speed: 80 };
  const follower = { progress: 1.10, finished: false, speed: 80 };
  const gap = gapSeconds(leader, follower, track.totalLength);
  assert.ok(Math.abs(gap - (0.10 * track.totalLength) / 80) < 1e-9);
  assert.equal(gapSeconds(follower, leader, track.totalLength), 0, 'negative gaps clamp to zero');
  assert.equal(formatGap(0), 'LEADER');
  assert.equal(formatGap(1.2346), '+1.235s');
  assert.equal(formatGap(12.34), '+12.3s');
  assert.equal(formatGap(5, 2), '+2 LAPS');
  assert.equal(formatGap(NaN), '--');
  const both = { finished: true, finishTime: 100000 };
  assert.equal(gapSeconds(both, { ...both, finishTime: 101500 }, 3000), 1.5);

  assert.equal(slipstreamAmount(40, 0), 0, 'too far ahead');
  assert.equal(slipstreamAmount(-5, 0), 0, 'behind us is not a slipstream');
  assert.equal(slipstreamAmount(12, 20), 0, 'different racing line');
  assert.ok(slipstreamAmount(12, 0) > slipstreamAmount(28, 0), 'closer is stronger');
  assert.ok(slipstreamAmount(12, 0) > slipstreamAmount(12, 2.6), 'centred is stronger');
  assert.ok(slipstreamAmount(6, 0) <= 1 && slipstreamAmount(6, 0) > 0.8);
});

test('difficulty ladder is monotonic and calibrated against the reference driver', () => {
  const reference = driveReferenceLap(playerProfile).best;
  assert.ok(reference > 30 && reference < 42, `reference lap ${reference}`);
  const results = DIFFICULTIES.map((level) => ({ level, lap: driveAiLap(level).fastest }));
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].lap < results[i - 1].lap, `${results[i].level.id} must be quicker than ${results[i - 1].id}`);
    assert.ok(results[i].level.opponents > results[i - 1].level.opponents, 'more opponents as difficulty rises');
    assert.ok(results[i].level.pace > results[i - 1].level.pace, 'pace must rise');
    assert.ok(results[i].level.mistakeRate < results[i - 1].level.mistakeRate, 'fewer mistakes as difficulty rises');
  }
  const ratio = (id) => results.find((r) => r.level.id === id).lap / reference;
  // Rookie must be comfortably beatable; Legend must beat a perfect lap.
  assert.ok(ratio('rookie') > 1.12, `rookie too quick: ${ratio('rookie')}`);
  assert.ok(ratio('pro') > 1.02 && ratio('pro') < 1.12, `pro out of band: ${ratio('pro')}`);
  assert.ok(ratio('elite') > 0.98 && ratio('elite') < 1.05, `elite out of band: ${ratio('elite')}`);
  assert.ok(ratio('legend') < 1.0, `legend must be quicker than the reference: ${ratio('legend')}`);
});

test('every difficulty is far quicker than the pre-fix AI (the "too easy" report)', () => {
  // The shipped AI used a 13.5 m/s² budget with a 9 m/s² brake smoothing pass.
  const legacyProfile = buildSpeedProfile(centerGeo.curvature, centerGeo.ds, {
    latAccel: 13.5, topSpeed: 92, brakeDecel: 9, accel: 1e6,
  });
  const legacy = new Float32Array(track.S);
  for (let i = 0; i < track.S; i++) legacy[i] = legacyProfile[i] * 0.941;  // the quickest old opponent
  const legacyLap = harmonicLap(legacy, centerGeo.ds);
  for (const level of DIFFICULTIES) {
    const lap = driveAiLap(level).fastest;
    assert.ok(lap < legacyLap * 0.88, `${level.id} (${lap.toFixed(1)}s) must beat legacy AI (${legacyLap.toFixed(1)}s) by >12%`);
  }
});

test('a full nine-car field races without stacking, and traffic costs little time', () => {
  const legend = resolveDifficulty('legend');
  const solo = driveAiLap({ ...legend, opponents: 1 }).fastest;
  const packed = driveAiLap(legend);
  assert.equal(packed.cars.length, 9);
  assert.ok(packed.minSeparation > 3.0, `cars overlapped: ${packed.minSeparation.toFixed(2)} m`);
  assert.ok(packed.fastest < solo * 1.08, `traffic collapsed the pace: ${packed.fastest} vs ${solo}`);
  for (const car of packed.cars) {
    assert.ok(Math.abs(car.lateral) <= TRACK.halfWidth * 0.9 + 1e-9, 'AI must stay on the track');
    assert.ok(car.progress > 1.5, 'AI must complete laps');
  }
});

test('AI respect a standing start and make occasional mistakes only when told to', () => {
  const level = resolveDifficulty('pro');
  const car = {
    t: 0.99, idx: 990, speed: 0, lateral: 0, aggression: level.aggression,
    accel: level.accel, brake: level.brake, mistakeRate: 0, mistakeTimer: 0,
    mistakeScale: 1, crossings: 0, progress: 0, launchDelay: 0.4,
    profile: aiProfile,
  };
  for (let i = 0; i < 20; i++) aiStep(car, trackWithPathScale, car.profile, line, [car], 1 / 60);
  assert.equal(car.speed, 0, 'must not move before the lights go out');
  car.launchDelay = 0;
  for (let i = 0; i < 240; i++) aiStep(car, trackWithPathScale, car.profile, line, [car], 1 / 60);
  assert.ok(car.speed > 5, 'must launch after the lights');
  assert.ok(car.crossings >= 1, 'must cross the line');

  const careless = { ...car, mistakeRate: 5, mistakeTimer: 0, speed: 60 };
  let mistakes = 0;
  for (let i = 0; i < 600; i++) {
    const before = careless.mistakeTimer;
    aiStep(careless, trackWithPathScale, careless.profile, line, [careless], 1 / 60);
    if (before <= 0 && careless.mistakeTimer > 0) mistakes++;
  }
  assert.ok(mistakes > 0, 'mistake model never fired');

  const careful = { ...car, mistakeRate: 0, mistakeTimer: 0 };
  for (let i = 0; i < 600; i++) aiStep(careful, trackWithPathScale, careful.profile, line, [careful], 1 / 60);
  assert.equal(careful.mistakeTimer, 0, 'difficulty 0 must never err');
});

test('AI slow down for a slower car ahead and choose a passing side', () => {
  const level = resolveDifficulty('elite');
  const profile = aiProfile;
  const fast = {
    t: 0.30, idx: Math.floor(0.30 * track.S), speed: 70, lateral: 0, aggression: level.aggression,
    accel: level.accel, brake: level.brake, mistakeRate: 0, mistakeTimer: 0, mistakeScale: 1,
    crossings: 0, progress: 0.3, launchDelay: 0, profile,
  };
  const slow = { ...fast, t: 0.304, idx: Math.floor(0.304 * track.S), speed: 30, progress: 0.304 };
  const traffic = [fast, slow];

  let maxBlocked = 0, minLateralAtContact = Infinity, minSpeed = Infinity, passedAhead = false;
  for (let i = 0; i < 90; i++) {
    aiStep(fast, trackWithPathScale, profile, line, traffic, 1 / 60);
    aiStep(slow, trackWithPathScale, profile, line, traffic, 1 / 60);
    maxBlocked = Math.max(maxBlocked, fast.blocked);
    minSpeed = Math.min(minSpeed, fast.speed);
    let d = fast.t - slow.t; d -= Math.round(d);
    if (d * track.totalLength > 2) passedAhead = true;
    // 縱向最接近的瞬間，橫向必須已經讓開
    if (Math.abs(d * track.totalLength) < 4) {
      minLateralAtContact = Math.min(minLateralAtContact, Math.abs(fast.lateral - slow.lateral));
    }
  }
  assert.ok(maxBlocked > 0.5, `blocked flag must be reported for HUD/audio use (max ${maxBlocked})`);
  assert.ok(minSpeed < 62, `must brake for the slower car (min ${minSpeed.toFixed(1)} m/s)`);
  assert.ok(minLateralAtContact > 1.2, `must move to a different line to pass (${minLateralAtContact.toFixed(2)} m apart)`);
  assert.ok(passedAhead, 'must actually get past the slower car');
});

test('difficulty is validated, defaulted and persisted safely', () => {
  assert.equal(resolveDifficulty('legend').id, 'legend');
  assert.equal(resolveDifficulty('nonsense').id, resolveDifficulty(undefined).id);
  assert.equal(resolveDifficulty(resolveDifficulty('elite')).id, 'elite');
  assert.equal(sanitizeSettings({}).difficulty, 'pro');
  assert.equal(sanitizeSettings({ difficulty: 'elite' }).difficulty, 'elite');
  assert.equal(sanitizeSettings({ difficulty: 42 }).difficulty, 'pro');
  assert.equal(sanitizeSettings({ difficulty: null }).difficulty, 'pro');
  assert.equal(new Set(DIFFICULTIES.map((d) => d.id)).size, DIFFICULTIES.length);
  for (const level of DIFFICULTIES) {
    assert.ok(level.opponents >= 3 && level.opponents <= 9);
    assert.ok(level.reaction[0] > 0 && level.reaction[1] >= level.reaction[0]);
    assert.ok(typeof level.blurb === 'string' && level.blurb.length > 8);
  }
});

test('a simulated race classifies the field consistently from grid to flag', () => {
  const level = resolveDifficulty('pro');
  const field = level.opponents;
  const grid = [];
  const poleIdx = track.S - 12;
  for (let i = 0; i <= field; i++) grid.push({ idx: (poleIdx - i * 7 + track.S * 2) % track.S, lateral: i % 2 === 0 ? -3.3 : 3.3 });

  const cars = [];
  for (let k = 0; k < field; k++) {
    const spread = field > 1 ? (k / (field - 1) - 0.5) * level.paceSpread : 0;
    const profile = new Float32Array(track.S);
    for (let i = 0; i < track.S; i++) profile[i] = aiProfile[i] * level.pace * (1 + spread);
    cars.push({
      id: `ai-${k}`, code: `AI${k}`, t: grid[k].idx / track.S, idx: grid[k].idx,
      lateral: grid[k].lateral, aggression: level.aggression, accel: level.accel,
      brake: level.brake, mistakeRate: level.mistakeRate, mistakeTimer: 0, mistakeScale: 1,
      crossings: 0, progress: grid[k].idx / track.S, launchDelay: 0.25 + k * 0.04,
      profile, laps: 0, finished: false, finishTime: Infinity, speed: 0, isPlayer: false,
    });
  }
  // The player starts at the back of the grid, driven by the reference controller.
  const slot = grid[field];
  const player = {
    id: 'you', code: 'YOU', isPlayer: true,
    x: track.points[slot.idx].x + track.rights[slot.idx].x * slot.lateral,
    z: track.points[slot.idx].z + track.rights[slot.idx].z * slot.lateral,
    vx: 0, vz: 0, heading: track.yaws[slot.idx], onTrack: true, speed: 0,
    nearestIdx: slot.idx, crossings: 0, progress: slot.idx / track.S,
    laps: 0, finished: false, finishTime: Infinity,
  };

  const dt = 1 / 120;
  const input = { steer: 0, throttle: 1, brake: 0, handbrake: false, sensitivity: 1 };
  let steer = 0, prevIdx = player.nearestIdx, raceTime = 0, lapStart = 0;
  const lapTimes = [];
  let finishOrder = null;

  for (let step = 0; step < 120 * 400; step++) {
    raceTime += dt * 1000;
    // --- AI ---
    const traffic = cars.concat([{ t: player.nearestIdx / track.S, lateral: 0, speed: player.speed }]);
    for (const car of cars) {
      aiStep(car, trackWithPathScale, car.profile, line, traffic, dt);
      if (!car.finished && car.crossings >= crossingsToFinish(TOTAL_LAPS)) {
        car.finished = true; car.finishTime = raceTime; car.laps = TOTAL_LAPS;
      } else car.laps = Math.max(0, car.crossings - 1);
    }
    // --- player: reference controller on the same physics as the game ---
    let best = player.nearestIdx, bestD = Infinity;
    for (let k = -46; k <= 46; k++) {
      const i = (player.nearestIdx + k + track.S * 2) % track.S;
      const dx = track.points[i].x - player.x, dz = track.points[i].z - player.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    prevIdx = player.nearestIdx;
    player.nearestIdx = best;
    const lateral = (player.x - track.points[best].x) * track.rights[best].x
      + (player.z - track.points[best].z) * track.rights[best].z;
    player.onTrack = Math.abs(lateral) < TRACK.halfWidth;
    traffic[traffic.length - 1].lateral = lateral;
    traffic[traffic.length - 1].t = best / track.S;

    const look = Math.max(3, Math.round((player.speed * 0.45) / track.segLen));
    const j = (best + look) % track.S;
    const err = wrap(Math.atan2(lineGeo.px[j] - player.x, lineGeo.pz[j] - player.z) - player.heading);
    const v = Math.max(player.speed, 1);
    const target = Math.max(-1, Math.min(1, -(lineGeo.curvatureSigned[best] * v) / authorityOf(v) - err * 9));
    steer += (target - steer) * (1 - Math.exp(-dt * 6.5));
    input.steer = Math.abs(steer) < 0.005 ? 0 : steer;
    const vTarget = playerProfile[best];
    if (player.speed > vTarget + 0.5) { input.throttle = 0; input.brake = Math.min(1, (player.speed - vTarget) / 6); }
    else { input.throttle = 1; input.brake = 0; }
    vehicleStep(player, input, PLAYER_CFG, dt);

    if (detectLapCrossing(prevIdx, best, track.S, player.speed)) {
      player.crossings++;
      const lapMs = raceTime - lapStart;
      lapStart = raceTime;
      if (player.crossings >= 2 && lapMs > 20000) lapTimes.push(lapMs);
    }
    // Progress is recomputed *after* the crossing increment (the fix under test).
    player.progress = trackProgress(player.crossings, best, track.S);
    player.laps = Math.max(0, player.crossings - 1);

    if (!player.finished && player.crossings >= crossingsToFinish(TOTAL_LAPS)) {
      player.finished = true;
      player.finishTime = raceTime;
      finishOrder = raceStandings([player, ...cars].map((r) => ({
        id: r.id, code: r.code, isPlayer: !!r.isPlayer, progress: r.progress,
        laps: r.laps, finished: r.finished, finishTime: r.finishTime, speed: r.speed || 0,
      })));
      break;
    }
  }

  assert.ok(finishOrder, 'race never finished');
  assert.equal(finishOrder.length, field + 1);
  assert.deepEqual(finishOrder.map((r) => r.position), Array.from({ length: field + 1 }, (_, i) => i + 1));
  assert.equal(lapTimes.length, TOTAL_LAPS, 'exactly three timed laps');
  assert.equal(player.laps, TOTAL_LAPS);
  const me = finishOrder.find((r) => r.isPlayer);
  // Whoever crossed the line first must be classified first.
  const firstToFinish = [player, ...cars]
    .filter((r) => r.finished)
    .sort((a, b) => a.finishTime - b.finishTime)[0];
  assert.equal(finishOrder[0].id, firstToFinish.id, 'classification must match the finishing order');
  assert.ok(me.position >= 1 && me.position <= field + 1);
  // The player started last, so finishing ahead of anyone is a gained position.
  const beaten = finishOrder.filter((r) => r.position > me.position).length;
  assert.ok(beaten >= 0 && beaten <= field);
});
