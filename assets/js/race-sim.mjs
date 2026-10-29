/**
 * APEX GP — race simulation core
 * ------------------------------------------------------------------
 * 純資料、無框架、無 DOM 的賽車模擬核心，供 `race-cockpit.js` 與 Node
 * 單元測試共用同一份程式碼（single source of truth）：
 *
 *  - `closedCatmullRom()`  閉合向心樣條（弧長參數化）
 *  - `buildTrackData()`    中心線、切線、右向量、yaw、曲率（含正負號）
 *  - `buildRacingLine()`   彎內切線（entry-outside / apex-inside / exit-outside）
 *  - `pathGeometry()`      任意橫向偏移路徑的真實曲率與弧長縮放
 *  - `buildSpeedProfile()` 彎道極速 `v = √(aLat/κ)` ＋ 剎車／加速可行性雙向平滑
 *  - `vehicleStep()`       玩家街機物理（與遊戲內完全相同的積分式）
 *  - `aiStep()`            AI 縱向配速 ＋ 橫向路線 ＋ 避車／超車／失誤模型
 *  - `raceStandings()`     以「完賽時間 → 即時投影進度」排序的正式名次系統
 *
 * 座標約定：世界座標為 XZ 平面，yaw = atan2(tx, tz)，前進向量 (sin yaw, cos yaw)，
 * 右側向量 (-tz, tx)。所有函式皆為純函式或僅修改傳入的 plain object。
 */
import { clamp, forwardSpeedAfterForces } from './race-controls.mjs';

export const TAU = Math.PI * 2;

export const TRACK = Object.freeze({
  halfWidth: 10,          // 賽道半寬（公尺）
  barrierOffset: 2.4,     // 護欄距賽道邊緣
  samples: 1000,          // 中心線取樣數
  controlPoints: 60,      // 極座標控制點數
  arcDivisions: 2400,     // 弧長參數化取樣數（決定等距取樣精度）
});

/**
 * 側向加速度預算（m/s²）。玩家的數值由 `steeringYawRate()` 的轉向 authority
 * 反推：v·ω = v²·authority(v)，在 60–90 m/s 區間約為 37–42 m/s²（≈3.8–4.3g，
 * 與近代 F1 量級相符）。AI 的參考預算刻意低於玩家天花板（保留街機手感），
 * 但因為 AI 是零失誤的完美駕駛，兩者的「整圈表現」經校準後幾乎相等：
 * pace 1.00 ≈ 理想駕駛模擬的極限圈速（見 tests/race-sim.test.mjs）。
 */
export const PLAYER_LAT_ACCEL = 36;
export const AI_LAT_ACCEL = 28;

const dist2 = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z; return dx * dx + dz * dz; };
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ================================================================
 * 1. 閉合向心 Catmull-Rom 樣條（弧長參數化）
 * ============================================================== */
/**
 * Barry–Goldman 非均勻（向心）Catmull-Rom，封閉迴路。
 * 回傳 `point(u)` / `tangent(u)`，u ∈ [0,1) 為弧長參數，因此等距取樣。
 */
export function closedCatmullRom(control, alpha = 0.5) {
  const n = control.length;
  const at = (i) => control[((i % n) + n) % n];
  const segments = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    let dt0 = Math.pow(Math.sqrt(dist2(p0, p1)) || 1e-6, alpha);
    let dt1 = Math.pow(Math.sqrt(dist2(p1, p2)) || 1e-6, alpha);
    let dt2 = Math.pow(Math.sqrt(dist2(p2, p3)) || 1e-6, alpha);
    if (dt1 < 1e-4) dt1 = 1;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const slope = (a, b, c, d0, d1) => ({
      x: ((b.x - a.x) / d0 - (c.x - a.x) / (d0 + d1) + (c.x - b.x) / d1) * dt1,
      z: ((b.z - a.z) / d0 - (c.z - a.z) / (d0 + d1) + (c.z - b.z) / d1) * dt1,
    });
    const m1 = slope(p0, p1, p2, dt0, dt1);
    const m2 = slope(p1, p2, p3, dt1, dt2);
    const coef = (a, b, ma, mb) => ({
      c0: a, c1: ma, c2: -3 * a + 3 * b - 2 * ma - mb, c3: 2 * a - 2 * b + ma + mb,
    });
    segments.push({ x: coef(p1.x, p2.x, m1.x, m2.x), z: coef(p1.z, p2.z, m1.z, m2.z) });
  }

  const evalSegment = (index, w, axis) => {
    const c = segments[index][axis];
    return c.c0 + c.c1 * w + c.c2 * w * w + c.c3 * w * w * w;
  };
  const evalSlope = (index, w, axis) => {
    const c = segments[index][axis];
    return c.c1 + 2 * c.c2 * w + 3 * c.c3 * w * w;
  };
  const raw = (u) => {
    const p = n * u;
    let i = Math.floor(p);
    const w = p - i;
    i = ((i % n) + n) % n;
    return { x: evalSegment(i, w, 'x'), z: evalSegment(i, w, 'z') };
  };
  const rawSlope = (u) => {
    const p = n * u;
    let i = Math.floor(p);
    const w = p - i;
    i = ((i % n) + n) % n;
    return { x: evalSlope(i, w, 'x'), z: evalSlope(i, w, 'z') };
  };

  // 弧長表 + 二分反查，讓 u 成為真正的等距參數
  const divisions = TRACK.arcDivisions;
  const lengths = new Float64Array(divisions + 1);
  let prev = raw(0);
  for (let d = 1; d <= divisions; d++) {
    const cur = raw(d / divisions);
    lengths[d] = lengths[d - 1] + Math.sqrt(dist2(prev, cur));
    prev = cur;
  }
  const totalLength = lengths[divisions];

  const uToParam = (u) => {
    const target = clamp(u, 0, 1) * totalLength;
    let lo = 0, hi = divisions;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (lengths[mid] < target) lo = mid + 1; else hi = mid; }
    const hiIdx = Math.max(1, lo);
    const segLen = lengths[hiIdx] - lengths[hiIdx - 1];
    const frac = segLen > 1e-9 ? (target - lengths[hiIdx - 1]) / segLen : 0;
    return (hiIdx - 1 + clamp(frac, 0, 1)) / divisions;
  };

  return {
    totalLength,
    point(u) { return raw(uToParam(u)); },
    /** 切線（單位向量），以解析導數求得，方向與前進方向一致 */
    tangent(u) {
      const d = rawSlope(uToParam(u));
      const len = Math.hypot(d.x, d.z) || 1;
      return { x: d.x / len, z: d.z / len };
    },
  };
}

/* ================================================================
 * 2. 賽道資料
 * ============================================================== */
export function buildTrackData(config = {}) {
  const S = config.samples || TRACK.samples;
  const halfWidth = config.halfWidth || TRACK.halfWidth;

  const radiusAt = (th) =>
    380 + 72 * Math.sin(2 * th + 0.6) + 46 * Math.sin(3 * th + 1.7) + 24 * Math.sin(5 * th + 0.4);

  const control = [];
  const N = config.controlPoints || TRACK.controlPoints;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    const r = radiusAt(th);
    control.push({ x: Math.cos(th) * r * 1.25, z: Math.sin(th) * r * 0.95 });
  }
  const curve = closedCatmullRom(control, 0.5);

  const points = [], tangents = [], rights = [], yaws = [];
  for (let i = 0; i < S; i++) {
    const u = i / S;
    points.push(curve.point(u));
    const tg = curve.tangent(u);
    tangents.push(tg);
    rights.push({ x: -tg.z, z: tg.x }); // 右側（橫向偏移正方向）
    yaws.push(Math.atan2(tg.x, tg.z));
  }

  const totalLength = curve.totalLength;
  const segLen = totalLength / S;

  // 曲率：無正負號（供極速計算）與有正負號（供內外側判定）
  const curvature = new Float32Array(S);
  const curvatureSigned = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    const a = tangents[i], b = tangents[(i + 1) % S];
    const dot = clamp(a.x * b.x + a.z * b.z, -1, 1);
    const cross = a.z * b.x - a.x * b.z;   // >0 表示 yaw 增加（向左彎）
    const k = Math.acos(dot) / segLen;
    curvature[i] = k;
    curvatureSigned[i] = Math.sign(cross) * k;
  }
  // 輕度平滑，抑制取樣噪音造成的假彎道
  const smoothCurvature = new Float32Array(S);
  const smoothSigned = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    let sum = 0, sumSigned = 0, w = 0;
    for (let k = -2; k <= 2; k++) {
      const j = (i + k + S) % S;
      const weight = 1 - Math.abs(k) * 0.18;
      sum += curvature[j] * weight; sumSigned += curvatureSigned[j] * weight; w += weight;
    }
    smoothCurvature[i] = sum / w; smoothSigned[i] = sumSigned / w;
  }

  return {
    curve, points, tangents, rights, yaws,
    curvature: smoothCurvature, curvatureSigned: smoothSigned,
    totalLength, segLen, S, halfWidth, radiusAt,
  };
}

/**
 * 賽車線（racing line）求解。
 *
 * 真正的賽車線不是「固定切內」——固定偏移反而會縮小通過半徑。這裡以幾何構造
 * 產生 entry-outside → apex-inside → exit-outside 的切弦路線：
 *  1. 以帶正負號曲率切分出方向一致的彎道區段（含入彎／出彎的展開長度）；
 *  2. 每個彎道以「最大曲率點」為 apex，用餘弦剖面把偏移從外側推到內側再推回外側；
 *  3. 重疊區段（連續 S 彎）以權重正規化混合，避免路線跳變；
 *  4. 最後做環狀平滑並以 Laplacian 鬆弛收斂（在已去除全域收縮模式的前提下，
 *     鬆弛只會把彎道進一步拉直）。
 *
 * @returns Float32Array 每個取樣點的橫向偏移（公尺，正值沿 `rights` 方向）
 */
export function buildRacingLine(track, options = {}) {
  const { halfWidth = track.halfWidth, margin = 1.5, relaxIterations = 260, relax = 0.5 } = options;
  const { points, rights, curvatureSigned, S } = track;
  const limit = Math.max(0, halfWidth - margin);

  let maxK = 0;
  for (let i = 0; i < S; i++) maxK = Math.max(maxK, Math.abs(curvatureSigned[i]));
  const cornerThreshold = maxK * 0.16;

  // --- 1. 切分彎道區段（曲率符號一致且超過門檻的連續區段） ---
  const corners = [];
  let run = null;
  for (let i = 0; i <= S; i++) {
    const idx = i % S;
    const k = curvatureSigned[idx];
    const active = Math.abs(k) > cornerThreshold;
    if (active) {
      if (!run || Math.sign(k) !== run.sign) {
        if (run) corners.push(run);
        run = { sign: Math.sign(k), start: i, end: i, apex: idx, apexK: Math.abs(k) };
      } else {
        run.end = i;
        if (Math.abs(k) > run.apexK) { run.apexK = Math.abs(k); run.apex = idx; }
      }
    } else if (run) { corners.push(run); run = null; }
  }
  if (run) corners.push(run);

  // --- 2./3. 每個彎道產生餘弦剖面，重疊處以權重混合 ---
  const num = new Float64Array(S), den = new Float64Array(S);
  for (const corner of corners) {
    const length = corner.end - corner.start + 1;
    // 入彎／出彎的展開長度隨彎道長度與嚴重度增加
    const ramp = Math.round(clamp(length * 1.15 + corner.apexK * S * 12, 10, S * 0.16));
    const half = Math.round(length / 2) + ramp;
    const inside = -corner.sign;          // 向左彎（k>0）時內側在負偏移方向
    const severity = smoothstep(cornerThreshold, maxK * 0.7, corner.apexK);
    for (let d = -half; d <= half; d++) {
      const i = ((corner.apex + d) % S + S) % S;
      const phase = (d / half) * Math.PI;             // -π..π，apex 處為 0
      const shape = Math.cos(phase);                  // +1 apex、-1 兩端（外側）
      // 權重以「離 apex 的距離」決定：重疊的連續彎由最近的 apex 主導
      const w = Math.pow(1 - Math.abs(d) / half, 1.6) + 1e-3;
      num[i] += inside * limit * severity * Math.sign(shape) * Math.pow(Math.abs(shape), 0.55) * w;
      den[i] += w;
    }
  }
  const offset = new Float32Array(S);
  for (let i = 0; i < S; i++) offset[i] = den[i] > 0 ? clamp(num[i] / den[i], -limit, limit) : 0;

  // --- 4. 環狀平滑，消除混合邊界的折角 ---
  const smooth = new Float32Array(S);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < S; i++) {
      let sum = 0, w = 0;
      for (let k = -5; k <= 5; k++) {
        const weight = 1 - Math.abs(k) / 6;
        sum += offset[(i + k + S) % S] * weight; w += weight;
      }
      smooth[i] = clamp(sum / w, -limit, limit);
    }
    offset.set(smooth);
  }

  // --- Laplacian 鬆弛：把彎道再拉直一點，同時移除常數模式避免封閉迴路整體收縮 ---
  const px = new Float64Array(S), pz = new Float64Array(S);
  const project = () => {
    for (let i = 0; i < S; i++) {
      px[i] = points[i].x + rights[i].x * offset[i];
      pz[i] = points[i].z + rights[i].z * offset[i];
    }
  };
  project();
  const next = new Float64Array(S);
  for (let it = 0; it < relaxIterations; it++) {
    for (let i = 0; i < S; i++) {
      const a = (i - 1 + S) % S, b = (i + 1) % S;
      const qx = (px[a] + px[b]) * 0.5, qz = (pz[a] + pz[b]) * 0.5;
      const e = (qx - points[i].x) * rights[i].x + (qz - points[i].z) * rights[i].z;
      next[i] = clamp(offset[i] + (e - offset[i]) * relax, -limit, limit);
    }
    offset.set(next);
    let mean = 0;
    for (let i = 0; i < S; i++) mean += offset[i];
    mean /= S;
    for (let i = 0; i < S; i++) offset[i] = clamp(offset[i] - mean, -limit, limit);
    project();
  }
  return offset;
}

/**
 * 任意橫向偏移路徑的真實幾何：由偏移後的實際點列計算曲率與弧長縮放。
 * 這是賽車線優化的正確來源——固定切內會讓半徑變小，只有「變化中的偏移」
 * （切弦）才會放大實際通過半徑。
 * @returns { curvature: Float32Array, scale: Float32Array, ds: Float32Array, length: number }
 */
export function pathGeometry(track, lateral) {
  const { points, rights, S, segLen } = track;
  const px = new Float64Array(S), pz = new Float64Array(S);
  for (let i = 0; i < S; i++) {
    const e = lateral ? lateral[i] : 0;
    px[i] = points[i].x + rights[i].x * e;
    pz[i] = points[i].z + rights[i].z * e;
  }
  const ds = new Float32Array(S);
  let length = 0;
  for (let i = 0; i < S; i++) {
    const j = (i + 1) % S;
    const d = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
    ds[i] = d; length += d;
  }
  const curvature = new Float32Array(S);
  const curvatureSigned = new Float32Array(S);
  const scale = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    const a = (i - 1 + S) % S, b = (i + 1) % S;
    const ax = px[i] - px[a], az = pz[i] - pz[a];
    const bx = px[b] - px[i], bz = pz[b] - pz[i];
    const la = Math.hypot(ax, az) || 1e-6, lb = Math.hypot(bx, bz) || 1e-6;
    const dot = clamp((ax * bx + az * bz) / (la * lb), -1, 1);
    const cross = az * bx - ax * bz;   // >0 表示 yaw 增加（向左彎）
    const k = Math.acos(dot) / ((la + lb) / 2);
    curvature[i] = k;
    curvatureSigned[i] = Math.sign(cross) * k;
    scale[i] = ds[i] / segLen;
  }
  // 平滑曲率，避免離散取樣在長直路上產生假彎
  const smooth = new Float32Array(S);
  const smoothSigned = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    let sum = 0, sumSigned = 0, w = 0;
    for (let k = -2; k <= 2; k++) {
      const weight = 1 - Math.abs(k) * 0.2;
      sum += curvature[(i + k + S) % S] * weight;
      sumSigned += curvatureSigned[(i + k + S) % S] * weight;
      w += weight;
    }
    smooth[i] = sum / w; smoothSigned[i] = sumSigned / w;
  }
  return { curvature: smooth, curvatureSigned: smoothSigned, scale, ds, length, px, pz };
}

/**
 * 彎道極速剖線。`v = √(aLat/κ)` 之後做三個回合的
 * 「反向剎車可行性 ＋ 正向加速可行性」平滑，等同於簡化的 forward–backward
 * 最佳化，保證任何速限變化都能在物理上被遵循。
 * @param curvature Float32Array 路徑曲率
 * @param ds Float32Array 或 number，各取樣點的弧長
 */
export function buildSpeedProfile(curvature, ds, options = {}) {
  const { latAccel = AI_LAT_ACCEL, brakeDecel = 22, accel = 13, topSpeed = 96, minSpeed = 12 } = options;
  const S = curvature.length;
  const at = (i) => (typeof ds === 'number' ? ds : ds[((i % S) + S) % S]);
  const out = new Float32Array(S);
  for (let i = 0; i < S; i++) out[i] = clamp(Math.sqrt(latAccel / Math.max(curvature[i], 1e-6)), minSpeed, topSpeed);
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < S; k++) {
      const i = (S - 1 - k);
      const next = out[(i + 1) % S];
      out[i] = Math.min(out[i], Math.sqrt(next * next + 2 * brakeDecel * at(i)));
    }
    for (let i = 0; i < S; i++) {
      const prev = out[(i - 1 + S) % S];
      out[i] = Math.min(out[i], Math.sqrt(prev * prev + 2 * accel * at(i)));
    }
  }
  return out;
}

/**
 * 玩家街機抓地力模型的等效極速剖線。
 * 由 `steeringYawRate()` 反推：最大側向加速度 aLat(v) = v · authority(v)，
 * authority(v) = yawAuthority/(1+0.03v)，故半徑 R 的極速為
 * `v = (-κ + √(κ² + 4·0.03·κ·yawAuthority)) / (2·0.03·κ)`。
 */
export function buildPlayerProfile(track, options = {}) {
  const { yawAuthority = 1.75, topSpeed = 92, line = null } = options;
  const geo = line ? pathGeometry(track, line) : null;
  const curvature = geo ? geo.curvature : track.curvature;
  const ds = geo ? geo.ds : track.segLen;
  const S = track.S;
  const out = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    const k = Math.max(curvature[i], 1e-6);
    const v = (-k + Math.sqrt(k * k + 4 * 0.03 * k * yawAuthority)) / (2 * 0.03 * k);
    out[i] = clamp(Number.isFinite(v) ? v : topSpeed, 0, topSpeed);
  }
  // 同樣做剎車／加速可行性平滑：玩家也不能瞬間改變速度
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 0; k < S; k++) {
      const i = (S - 1 - k);
      const next = out[(i + 1) % S];
      out[i] = Math.min(out[i], Math.sqrt(next * next + 2 * 26 * ds[i]));
    }
    for (let i = 0; i < S; i++) {
      const prev = out[(i - 1 + S) % S];
      out[i] = Math.min(out[i], Math.sqrt(prev * prev + 2 * 15 * ds[i]));
    }
  }
  return out;
}

/* ================================================================
 * 3. 玩家車輛物理（純函式，遊戲與測試共用同一份積分式）
 * ============================================================== */
/**
 * @param state  { x, z, vx, vz, heading, onTrack, ... }（會被就地更新）
 * @param input  { steer, throttle, brake, handbrake, sensitivity }
 * @param config { topSpeed, engineAccel, brakeAccel, rollResist, grassDecel, grip, yawAuthority }
 * @param dt     秒
 * @param drag   空氣阻力係數；1 = 乾淨氣流，<1 = 尾流／DRS（提高極速與加速）
 */
export function vehicleStep(state, input, config, dt, drag = 1) {
  const fwdX = Math.sin(state.heading), fwdZ = Math.cos(state.heading);
  const rightX = Math.cos(state.heading), rightZ = -Math.sin(state.heading);
  let fSpeed = state.vx * fwdX + state.vz * fwdZ;
  let lSpeed = state.vx * rightX + state.vz * rightZ;

  // 縱向共用 race-controls 的同一份力學式（含尾流／DRS 的阻力係數）
  const longitudinal = forwardSpeedAfterForces(fSpeed, input.throttle, input.brake, state.onTrack, dt, config, drag);
  fSpeed = longitudinal.speed;
  const lonG = longitudinal.acceleration / 9.81;

  // 車頭以 +Z 為基準，螢幕右側是車體 -X；修正左右符號
  const speedFactor = Math.min(Math.abs(fSpeed) / 9, 1);
  const authority = clamp(config.yawAuthority / (1 + Math.abs(fSpeed) * 0.03), 0.3, config.yawAuthority)
    * (input.handbrake ? 1.55 : 1);
  const yawRate = (input.steer === 0 || fSpeed === 0)
    ? 0
    : -input.steer * input.sensitivity * authority * speedFactor * Math.sign(fSpeed || 1);
  state.heading += yawRate * dt;

  // 離心力產生橫向速度，抓地力將其衰減；手煞車與草地降低抓地
  lSpeed -= yawRate * fSpeed * dt * 0.9;
  const gripK = input.handbrake ? 1.4 : state.onTrack ? config.grip : 2.6;
  lSpeed *= Math.exp(-gripK * dt);

  const nFwdX = Math.sin(state.heading), nFwdZ = Math.cos(state.heading);
  const nRightX = Math.cos(state.heading), nRightZ = -Math.sin(state.heading);
  state.vx = nFwdX * fSpeed + nRightX * lSpeed;
  state.vz = nFwdZ * fSpeed + nRightZ * lSpeed;
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  state.fSpeed = fSpeed;
  state.lSpeed = lSpeed;
  state.speed = Math.hypot(state.vx, state.vz);
  state.yawRate = yawRate;
  state.latG = (yawRate * fSpeed) / 9.81;
  state.lonG = lonG;
  return state;
}

/* ================================================================
 * 4. AI 對手
 * ============================================================== */
/**
 * AI 縱向配速 ＋ 橫向路線更新（就地修改 `car`）。
 * @param car    { t, idx, speed, lateral, pace, aggression, accel, brake, ... }
 * @param track  buildTrackData 的結果
 * @param profile 該車的極速剖線（已含賽車線幾何與難度倍率）
 * @param line   賽車線橫向偏移
 * @param others 所有車輛（含自己與玩家）：{ t, lateral, speed }
 */
export function aiStep(car, track, profile, line, others, dt) {
  const { S, totalLength } = track;
  const idx = ((car.idx % S) + S) % S;

  // --- 起步反應：發車燈熄滅前不動 ---
  if (car.launchDelay > 0) {
    car.launchDelay = Math.max(0, car.launchDelay - dt);
    car.speed = Math.max(0, car.speed - 6 * dt);
    return car;
  }

  // --- 縱向：前瞻窗口內最嚴格的煞車可行速限 ---
  const lookahead = clamp(Math.round((car.speed * 0.62) / Math.max(track.segLen, 0.1)), 2, 46);
  let limit = Infinity;
  for (let k = 0; k <= lookahead; k++) {
    const j = (idx + k) % S;
    const distance = k * track.segLen;
    limit = Math.min(limit, Math.sqrt(Math.max(0, profile[j] * profile[j] + 2 * car.brake * distance)));
  }
  let target = Math.max(limit, 0);

  // --- 失誤模型：偶發小失誤（難度越高越少），模擬鎖死煞車／錯過彎心 ---
  if (car.mistakeTimer > 0) {
    car.mistakeTimer -= dt;
    target *= car.mistakeScale;
  } else if (car.mistakeRate > 0 && Math.random() < car.mistakeRate * dt) {
    car.mistakeTimer = 0.5 + Math.random() * 0.7;
    car.mistakeScale = 0.80 + Math.random() * 0.13;
  }

  // --- 交通：前方近距離車輛 → 選擇超車側並保持安全距離 ---
  let blocked = 0;
  let overtakeSide = 0;
  const limitOffset = track.halfWidth * 0.86;
  for (const other of others) {
    if (other === car) continue;
    let delta = other.t - car.t;
    delta -= Math.round(delta);                        // 環狀最近距離
    const gapMeters = delta * totalLength;
    if (gapMeters > 52 || gapMeters < -4) continue;      // 太遠，或已在正後方
    const lateralDelta = other.lateral - car.lateral;
    if (Math.abs(lateralDelta) > 4.4 && gapMeters > 3) continue;   // 已在不同路線
    // 距離越近阻塞越強；重疊時視為完全阻塞（緊急煞車＋讓線），絕不直接穿過前車
    blocked = Math.max(blocked, clamp(0.4 + (1 - gapMeters / 52) * 0.6, 0, 1));
    if (overtakeSide === 0) overtakeSide = lateralDelta >= 0 ? -1 : 1;
    if (other.speed < car.speed * 0.99) {
      const safeGap = 6 + car.speed * 0.20 * (1.45 - car.aggression);
      if (gapMeters < safeGap) target = Math.min(target, other.speed * (0.93 + car.aggression * 0.075));
      if (gapMeters < 6) {
        target = Math.min(target, other.speed * 0.82);
        car.brakeBoost = Math.max(car.brakeBoost || 0, clamp(1 - gapMeters / 6, 0, 1));
      }
    }
  }
  car.blocked = blocked;

  // --- 橫向：賽車線 ＋ 超車偏移 ＋ 並排間距維持 ---
  let desired = line[idx];
  if (overtakeSide !== 0) {
    desired = clamp(desired + overtakeSide * 3.6 * (0.4 + car.aggression * 0.6), -limitOffset, limitOffset);
  }
  for (const other of others) {
    if (other === car) continue;
    let delta = other.t - car.t;
    delta -= Math.round(delta);
    if (Math.abs(delta * totalLength) > 15) continue;
    const lateralDelta = other.lateral - car.lateral;
    if (Math.abs(lateralDelta) < 3.1) desired -= Math.sign(lateralDelta || 1) * (3.1 - Math.abs(lateralDelta)) * 0.9;
  }
  car.targetLateral = clamp(desired, -limitOffset, limitOffset);
  const steerRate = 3.0 + car.aggression * 2.6;
  car.lateral += clamp(car.targetLateral - car.lateral, -steerRate * dt, steerRate * dt);

  // --- 縱向積分：低轉速時扭力充沛，高速時加速能力衰減 ---
  const taper = 1 - clamp(car.speed / 118, 0, 0.72);
  if (car.speed < target) {
    car.speed = Math.min(car.speed + Math.max(car.accel * taper, 3.4) * dt, target);
  } else {
    // 近距離阻塞時加壓煞車（最多 +70%），避免追尾
    car.speed = Math.max(car.speed - car.brake * (1 + (car.brakeBoost || 0) * 0.7) * dt, target);
  }
  car.brakeBoost = 0;
  car.speed = Math.max(0, car.speed);

  // 以中心線投影推進進度，並依實際路徑長度縮放補償內外線差異，
  // 使 AI 與玩家（同樣以中心線投影計名次）的進度基準完全一致。
  const scale = clamp(track.pathScale ? track.pathScale[idx] : 1, 0.7, 1.4);
  car.t += (car.speed * dt) / (totalLength * scale);
  while (car.t >= 1) { car.t -= 1; car.crossings++; }
  while (car.t < 0) { car.t += 1; car.crossings--; }
  car.idx = Math.floor(car.t * S) % S;
  car.progress = car.crossings + car.t;
  return car;
}

/* ================================================================
 * 5. 計圈與名次系統
 * ============================================================== */
/**
 * 越線偵測：起跑格位於起跑線後方，因此中心線取樣索引由大跳小即代表通過起跑線。
 * 低速度門檻避免碰撞後被推回而誤記一圈。
 */
export function detectLapCrossing(prevIndex, index, samples, speed, minSpeed = 4) {
  return prevIndex > samples * 0.75 && index < samples * 0.25 && speed > minSpeed;
}

/**
 * 計時／名次用的線性進度：已完成越線次數 + 圈內比例。
 * 必須在 crossings 遞增「之後」呼叫；反過來會讓完賽當下的進度少整整一圈，
 * 導致結算永遠排在最後（本遊戲曾出現的「不管排第幾都結算 P4」缺陷）。
 */
export function trackProgress(crossings, index, samples) {
  return crossings + (samples > 0 ? index / samples : 0);
}

/** 完成 totalLaps 圈所需的越線次數（第一次越線只是啟動計時） */
export function crossingsToFinish(totalLaps) {
  return totalLaps + 1;
}
/**
 * 正式名次計算。規則與真實賽事計時一致：
 *  1. 已完賽者依完賽時間排序；
 *  2. 未完賽者依即時投影進度（完成圈數 + 圈內比例）排序，且一律排在完賽者之後；
 *  3. 進度相同時以較多完賽圈數者為先，最後以傳入順序穩定排序（避免抖動）。
 *
 * @param racers [{ id, progress, laps, finished, finishTime, ... }]
 * @returns 依名次排序的新陣列，每筆附加 `position`
 */
export function raceStandings(racers) {
  return racers
    .map((racer, index) => ({ racer, index }))
    .sort((a, b) => {
      const x = a.racer, y = b.racer;
      if (x.finished !== y.finished) return x.finished ? -1 : 1;
      if (x.finished && y.finished) {
        if (x.finishTime !== y.finishTime) return x.finishTime - y.finishTime;
      } else if (x.progress !== y.progress) {
        return y.progress - x.progress;
      } else if (x.laps !== y.laps) {
        return y.laps - x.laps;
      }
      return a.index - b.index;
    })
    .map(({ racer }, i) => ({ ...racer, position: i + 1 }));
}

/** 兩車之間的時間差（秒）。以距離差除以跟車車速估算，符合計時塔的顯示習慣。 */
export function gapSeconds(leader, follower, trackLength) {
  if (leader.finished && follower.finished) return (follower.finishTime - leader.finishTime) / 1000;
  const deltaLaps = leader.progress - follower.progress;
  if (deltaLaps <= 0) return 0;
  const meters = deltaLaps * trackLength;
  const speed = Math.max(follower.speed || 0, 12);
  return meters / speed;
}

export function formatGap(seconds, laps = 0) {
  if (!Number.isFinite(seconds)) return '--';
  if (laps >= 1) return `+${laps} LAP${laps > 1 ? 'S' : ''}`;
  if (seconds <= 0.0005) return 'LEADER';
  return `+${seconds.toFixed(seconds < 10 ? 3 : 1)}s`;
}

/**
 * 尾流（slipstream）：位於前車正後方一定距離內可降低空氣阻力。
 * @returns 0（無尾流）～1（完整尾流）
 */
export function slipstreamAmount(distanceAhead, lateralOffset, { maxDistance = 34, width = 3.4 } = {}) {
  if (!(distanceAhead > 0) || distanceAhead > maxDistance) return 0;
  const lateral = 1 - smoothstep(width * 0.35, width, Math.abs(lateralOffset));
  const longitudinal = 1 - smoothstep(maxDistance * 0.22, maxDistance, distanceAhead);
  return clamp(lateral * longitudinal, 0, 1);
}
