/**
 * APEX GP — Cockpit Racer
 * ------------------------------------------------------------------
 * 雙視角 3D 賽車體驗（WebGL / Three.js r160 / 程序化生成）
 *
 * 技術重點：
 *  - 程序化賽道：極座標閉合向心樣條（自寫弧長參數化）→ 柏油帶狀幾何、路緣石、護欄、看台、廣告板
 *  - 賽車線求解：Laplacian 鬆弛 + 彎道餘弦剖面，產生 entry-outside / apex-inside / exit-outside 路線
 *  - 鏡頭：駕駛艙與第三人稱追車視角、玩家車模型、方向盤與後視鏡
 *  - 街機物理：可調轉向、自動排檔、油門／煞車／漂移、草地減速、護欄碰撞、尾流與 DRS
 *  - AI 對手：賽車線導航 + forward/backward 剎車可行性剖線 + 避車／超車／失誤模型 + 四級難度
 *  - 名次系統：完賽時間 → 即時中心線投影進度的正式計時排序，含間距與完賽時間差
 *  - 程序化音效：多層引擎聲（排氣脈動／進氣／渦輪／傳動）、回火、多普勒對手車、可調音量
 *  - 後製特效：Bloom 明亮通道 + 徑向速度模糊、色差、暗角、碰撞紅閃、膠片顆粒
 *  - 效能：InstancedMesh 大量物件、低解析度鏡面／Bloom RT、像素比上限、能見度自動暫停
 *  - 無障礙：prefers-reduced-motion 停用鏡頭晃動與顆粒；鍵盤可完整操作；觸控 UI 自動顯示
 *
 * 相依：three.module.min.js（已於本儲存庫內 vendor，無外部 CDN 相依）
 *      race-sim.mjs / race-controls.mjs（純邏輯，可於 Node 直接單元測試）
 */
import * as THREE from '../vendor/three.module.min.js';
import {
  DrivingInput, DEFAULT_SETTINGS, DIFFICULTIES, resolveDifficulty, sanitizeSettings,
  selectAutomaticGear, masterGainForVolume,
} from './race-controls.mjs';
import {
  TRACK, AI_LAT_ACCEL, buildTrackData, buildRacingLine, pathGeometry, buildSpeedProfile,
  buildPlayerProfile, vehicleStep, aiStep, raceStandings, gapSeconds, formatGap, slipstreamAmount,
  detectLapCrossing, trackProgress, crossingsToFinish,
} from './race-sim.mjs';

/* ================================================================
 * 0. 常數與工具
 * ============================================================== */
const CFG = {
  trackHalfWidth: TRACK.halfWidth,   // 賽道半寬（公尺）
  trackSamples: TRACK.samples,       // 賽道取樣數
  barrierOffset: TRACK.barrierOffset,
  totalLaps: 3,
  topSpeed: 92,                // 玩家極速 m/s（≈331 km/h）
  engineAccel: 16.5,           // 引擎加速度基值 m/s²
  brakeAccel: 28,              // 煞車減速度 m/s²
  rollResist: 0.7,             // 滾動阻力
  grassDecel: 15,              // 草地減速
  grip: 8.5,                   // 橫向抓地力衰減率（越大越黏）
  yawAuthority: 1.75,          // 轉向 authority 基值（與 race-controls 同步）
  idleRpm: 1300,
  redlineRpm: 12500,
  gears: [0, 15, 25, 38, 51, 64, 76, 85, 93], // 各檔位速域（m/s）
  aiTopSpeed: 92,              // AI 極速上限（與玩家相同，靠尾流才超得動）
  aiLatAccel: AI_LAT_ACCEL,    // AI 參考側向加速度預算（經整圈校準）
  maxOpponents: 9,             // 一次建置的最大對手數（難度決定實際出場數）
  slipstreamDrag: 0.055,       // 完整尾流可減少 5.5% 空氣阻力
  drsDrag: 0.022,              // DRS 於直路再減少 2.2%
  jumpStartPenaltyMs: 3000,    // 搶跑罰秒
};

/** 對手車手（虛構展示用）：代號、全名與塗裝色 */
const DRIVERS = [
  { code: 'KES', name: 'V. Kessler', color: 0xff4c38 },
  { code: 'NAK', name: 'A. Nakamura', color: 0x39c6ff },
  { code: 'MOR', name: 'L. Moreau', color: 0xf5a623 },
  { code: 'OKO', name: 'R. Okonkwo', color: 0xb06bff },
  { code: 'DUA', name: 'M. Duarte', color: 0xff5fa2 },
  { code: 'LIN', name: 'S. Lindqvist', color: 0x2fe3c0 },
  { code: 'BIA', name: 'D. Bianchi', color: 0xffd23d },
  { code: 'ADE', name: 'K. Adeyemi', color: 0x4f7dff },
  { code: 'VOL', name: 'T. Volkov', color: 0xc9d2c8 },
];
const PLAYER = { code: 'YOU', name: 'PLAYER', color: 0xd8ff3e };

/* F1 風格發車燈：五盞依序亮起，全滅即起跑 */
const START_LIGHT_COUNT = 5;
const START_LIGHT_INTERVAL = 0.62;
const START_LIGHTS_OUT_AT = START_LIGHT_COUNT * START_LIGHT_INTERVAL + 0.58;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const fmtTime = (ms) => {
  if (!isFinite(ms) || ms <= 0) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
};

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_COARSE = window.matchMedia('(pointer: coarse)').matches;

function detectQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (IS_COARSE || cores <= 4 || mem <= 4) return 'low';
  return 'high';
}

/* 程序化 Canvas 紋理 --------------------------------------------- */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function asphaltTexture() {
  const c = makeCanvas(256, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#23262a';
  g.fillRect(0, 0, 256, 512);
  // 瀝青顆粒噪點
  for (let i = 0; i < 9000; i++) {
    const v = 24 + Math.random() * 42 | 0;
    g.fillStyle = `rgba(${v + 8},${v + 9},${v + 10},${0.25 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * 256, Math.random() * 512, 1.6, 1.6);
  }
  // 輪胎rubber racing line（中央偏暗）
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0.36, 'rgba(0,0,0,0)');
  grad.addColorStop(0.44, 'rgba(10,10,12,.32)');
  grad.addColorStop(0.56, 'rgba(10,10,12,.32)');
  grad.addColorStop(0.64, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  // 邊緣白線
  g.fillStyle = 'rgba(235,238,230,.82)';
  g.fillRect(4, 0, 7, 512);
  g.fillRect(245, 0, 7, 512);
  // 中央虛線（上半段有、下半段無 → 沿 v 重複形成虛線）
  g.fillStyle = 'rgba(235,238,230,.55)';
  g.fillRect(125, 0, 6, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function barrierTexture() {
  const c = makeCanvas(128, 32);
  const g = c.getContext('2d');
  g.fillStyle = '#e8eae2';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#d8ff3e';
  g.fillRect(0, 0, 42, 32);
  g.fillStyle = '#ff4c38';
  g.fillRect(86, 0, 42, 32);
  g.fillStyle = 'rgba(0,0,0,.22)';
  g.fillRect(0, 26, 128, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerTexture(cols = 10, rows = 2) {
  const c = makeCanvas(cols * 32, rows * 32);
  const g = c.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2ee';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#41602f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const shade = Math.random();
    g.fillStyle = shade > 0.6 ? 'rgba(92,132,62,.5)' : shade > 0.3 ? 'rgba(52,84,38,.55)' : 'rgba(34,58,26,.5)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // 割草條紋
  for (let x = 0; x < 256; x += 64) {
    g.fillStyle = 'rgba(255,255,255,.035)';
    g.fillRect(x, 0, 32, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function standTexture() {
  const c = makeCanvas(256, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#1a1f22';
  g.fillRect(0, 0, 256, 64);
  const colors = ['#d8ff3e', '#f1f5eb', '#ff4c38', '#39c6ff', '#8b93a1'];
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < 44; i++) {
      if (Math.random() < 0.72) {
        g.fillStyle = colors[(Math.random() * colors.length) | 0];
        g.globalAlpha = 0.5 + Math.random() * 0.5;
        g.fillRect(4 + i * 5.7, 6 + row * 9.6, 4, 5);
      }
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function billboardTexture(text, accent) {
  const c = makeCanvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0f10';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = accent;
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 122);
  g.fillStyle = accent;
  g.font = '900 64px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNameTag(code, color) {
  const c = makeCanvas(256, 64);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,11,12,.78)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillRect(0, 0, 10, 64);
  g.fillStyle = '#f1f5eb';
  g.font = '900 40px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(code, 138, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 });
  return new THREE.Sprite(mat);
}

function gantryTexture() {
  const c = makeCanvas(1024, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0f10';
  g.fillRect(0, 0, 1024, 128);
  for (let x = 0; x < 1024; x += 64) {
    for (let y = 0; y < 128; y += 64) {
      g.fillStyle = (x / 64 + y / 64) % 2 ? '#151a1c' : '#e9ede4';
      g.fillRect(x, y, 64, 64);
    }
  }
  g.fillStyle = 'rgba(8,11,12,.82)';
  g.fillRect(180, 24, 664, 80);
  g.fillStyle = '#d8ff3e';
  g.font = '900 66px "Barlow Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('APEX GP · START / FINISH', 512, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cloudTexture() {
  const c = makeCanvas(256, 96);
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 40 + Math.random() * 176;
    const y = 30 + Math.random() * 40;
    const r = 12 + Math.random() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ================================================================
 * 1. 賽道生成
 *    中心線／曲率／賽車線／極速剖線全部由 race-sim.mjs 提供，
 *    遊戲與 Node 測試共用同一份幾何與物理，避免「測試通過但遊戲不同」。
 * ============================================================== */
function buildRaceTrack() {
  const track = buildTrackData({ samples: CFG.trackSamples, halfWidth: CFG.trackHalfWidth });
  track.racingLine = buildRacingLine(track);
  const geo = pathGeometry(track, track.racingLine);
  track.lineGeometry = geo;
  track.pathScale = geo.scale;                       // AI 進度推進的路徑長度補償
  // AI 參考剖線：pace 1.00 的整圈表現 ≈ 理想駕駛模擬的極限圈速
  track.aiProfile = buildSpeedProfile(geo.curvature, geo.ds, {
    latAccel: CFG.aiLatAccel, topSpeed: CFG.aiTopSpeed, brakeDecel: 22, accel: 13,
  });
  // 玩家理論剖線：僅供 AI 難度校準與除錯比對，不直接限制玩家
  track.playerProfile = buildPlayerProfile(track, { topSpeed: CFG.topSpeed, line: track.racingLine });
  return track;
}

/* 帶狀幾何（賽道 / 路緣石）：filter 可篩選僅在彎道產生（路緣石用） */
function ribbonGeometry(track, uMin, uMax, filter) {
  const { points, rights, S, segLen } = track;
  const vScale = 1 / 12; // 紋理沿賽道每 12m 重複一次
  const pos = [], uv = [], idx = [];
  let run = []; // 目前連續區段的頂點索引
  const flushRun = () => {
    for (let k = 0; k + 3 < run.length; k += 2) {
      const a = run[k], b = run[k + 1], c = run[k + 2], d = run[k + 3];
      idx.push(a, b, c, b, d, c);
    }
    run = [];
  };
  for (let i = 0; i <= S; i++) {
    const ii = i % S;
    if (filter && !filter(ii)) { flushRun(); continue; }
    const c = points[ii], r = rights[ii];
    const v = i * segLen * vScale;
    const base = pos.length / 3;
    pos.push(
      c.x + r.x * uMin, 0.01, c.z + r.z * uMin,
      c.x + r.x * uMax, 0.01, c.z + r.z * uMax
    );
    uv.push(0, v, 1, v);
    run.push(base, base + 1);
  }
  flushRun();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/* ================================================================
 * 2. 音效引擎（Web Audio 程序化合成，零音訊檔案）
 * ------------------------------------------------------------------
 * PR#9 為了「柔和」把 master 從 0.85 降到 volume×0.6（預設 0.35 → 0.21），
 * 同時把引擎層增益砍掉近一半，兩者相乘等於 -17 dB，實際聽感近乎無聲。
 * 這裡重新做 gain staging：
 *   1. 感知音量曲線 `masterGainForVolume()`（v^1.35 × 1.3）取代線性 ×0.6；
 *   2. 引擎改為多層合成：排氣脈動（雙失準鋸齒）、低頻胸腔、進氣噪音、
 *      渦輪高頻哨音、傳動齒輪音，全部經 tanh 軟飽和與低通；
 *   3. 末端串接 compressor + soft-clip 雙重限制，即使全音量也不會削頂破音；
 *   4. 新增對手車多普勒音效（依相對徑向速度改變音高、依方位立體聲定位）。
 * ============================================================== */
class EngineAudio {
  constructor(volume = 0.7, muted = false) {
    this.ctx = null;
    this.ready = false;
    this.volume = clamp(volume, 0, 1);
    this.muted = muted;
    this.rivalPhase = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = new AC(); } catch (_) { return; }
    this.ctx = ctx;

    /* --- 主匯流排：音量 → 壓縮 → 軟截波 → 揚聲器 --- */
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -9; comp.knee.value = 6; comp.ratio.value = 12;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    const limiter = ctx.createWaveShaper();
    const limitCurve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      const x = (i / 2047) * 2 - 1;
      limitCurve[i] = Math.tanh(x * 1.05) * 0.92;   // 保證 |out| < 0.92，絕不削頂
    }
    limiter.curve = limitCurve;
    limiter.oversample = '2x';
    this.master.connect(comp).connect(limiter).connect(ctx.destination);

    /* --- 共用噪音 buffer --- */
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = () => { const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.start(); return src; };

    /* --- 引擎：排氣脈動 + 低頻胸腔 + 進氣 + 渦輪 + 傳動 --- */
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900; this.engFilter.Q.value = 0.7;
    const shaper = ctx.createWaveShaper();
    const curveArr = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      const x = (i / 2047) * 2 - 1;
      curveArr[i] = Math.tanh(x * 2.1) * 0.78;      // 飽和產生奇次泛音＝排氣顆粒感
    }
    shaper.curve = curveArr; shaper.oversample = '2x';
    this.engFilter.connect(shaper).connect(this.engGain).connect(this.master);

    this.oscs = [];
    const defs = [
      { type: 'sawtooth', mult: 1.0, gain: 0.46, detune: -6 },   // 排氣主脈動
      { type: 'sawtooth', mult: 1.0, gain: 0.34, detune: 9 },    // 失準疊加 → V 型引擎節拍
      { type: 'triangle', mult: 0.5, gain: 0.42, detune: 0 },    // 低頻胸腔
      { type: 'square', mult: 2.0, gain: 0.075, detune: 3 },     // 氣門機構高頻
    ];
    for (const d of defs) {
      const o = ctx.createOscillator();
      o.type = d.type; o.frequency.value = 60; o.detune.value = d.detune;
      const g = ctx.createGain(); g.gain.value = d.gain;
      o.connect(g).connect(this.engFilter);
      o.start();
      this.oscs.push({ osc: o, mult: d.mult });
    }

    // 進氣噪音（節氣門開啟時的吸氣嘶聲）
    this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass'; this.intakeFilter.frequency.value = 900; this.intakeFilter.Q.value = 0.85;
    noise().connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);

    // 渦輪／排氣高頻哨音
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine'; this.turboOsc.frequency.value = 900;
    const turboFilter = ctx.createBiquadFilter();
    turboFilter.type = 'bandpass'; turboFilter.frequency.value = 2600; turboFilter.Q.value = 3.5;
    this.turboOsc.connect(turboFilter).connect(this.turboGain).connect(this.master);
    this.turboOsc.start();

    // 傳動／齒輪音（隨車速而非轉速）
    this.transGain = ctx.createGain(); this.transGain.gain.value = 0;
    this.transOsc = ctx.createOscillator();
    this.transOsc.type = 'triangle'; this.transOsc.frequency.value = 120;
    this.transOsc.connect(this.transGain).connect(this.master);
    this.transOsc.start();

    // 風噪
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    const windF = ctx.createBiquadFilter();
    windF.type = 'highpass'; windF.frequency.value = 780;
    noise().connect(windF).connect(this.windGain).connect(this.master);

    // 胎噪尖叫
    this.screechGain = ctx.createGain(); this.screechGain.gain.value = 0;
    const scrF = ctx.createBiquadFilter();
    scrF.type = 'bandpass'; scrF.frequency.value = 2350; scrF.Q.value = 6.5;
    noise().connect(scrF).connect(this.screechGain).connect(this.master);

    // 草地／碎石輾壓聲
    this.gravelGain = ctx.createGain(); this.gravelGain.gain.value = 0;
    const grvF = ctx.createBiquadFilter();
    grvF.type = 'lowpass'; grvF.frequency.value = 420; grvF.Q.value = 1.1;
    noise().connect(grvF).connect(this.gravelGain).connect(this.master);

    // 對手車（多普勒 + 立體聲定位）
    this.rivalGain = ctx.createGain(); this.rivalGain.gain.value = 0;
    this.rivalFilter = ctx.createBiquadFilter();
    this.rivalFilter.type = 'lowpass'; this.rivalFilter.frequency.value = 700; this.rivalFilter.Q.value = 0.8;
    this.rivalOsc = ctx.createOscillator();
    this.rivalOsc.type = 'sawtooth'; this.rivalOsc.frequency.value = 90;
    this.rivalPanner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.rivalOsc.connect(this.rivalFilter).connect(this.rivalGain);
    if (this.rivalPanner) this.rivalGain.connect(this.rivalPanner).connect(this.master);
    else this.rivalGain.connect(this.master);
    this.rivalOsc.start();

    this.ready = true;
    this.applyVolume(0.2);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  applyVolume(timeConstant = 0.08) {
    if (!this.ready) return;
    const target = this.muted ? 0 : masterGainForVolume(this.volume);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, timeConstant);
  }
  setVolume(volume) { this.volume = clamp(volume, 0, 1); this.applyVolume(); }
  setMuted(muted) { this.muted = muted; this.applyVolume(); }

  /**
   * @param dt 秒
   * @param telemetry {
   *   rpmNorm 0..1, throttle 0..1, speedNorm 0..1, slip 0..1, onTrack,
   *   limiter 0..1（轉速限制器作用量）, rival { level 0..1, pan -1..1, doppler } }
   */
  update(dt, telemetry = {}) {
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(dt, 0.1));
    const rpmNorm = telemetry.rpmNorm || 0;
    const throttle = telemetry.throttle || 0;
    const speedNorm = telemetry.speedNorm || 0;
    const slip = telemetry.slip || 0;
    const limiter = telemetry.limiter || 0;

    // 排氣脈動頻率：怠速 42 Hz → 紅線 247 Hz（V8 四行程的排氣基頻量級）
    const f = 42 + rpmNorm * 205;
    const flutter = 1 - limiter * 0.45 * (Math.sin(t * 90) > 0 ? 1 : 0);   // 轉速限制器斷油抖動
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(f * o.mult * flutter, t, 0.025);
    this.engFilter.frequency.setTargetAtTime(420 + rpmNorm * 2600 + throttle * 900, t, 0.07);
    this.engGain.gain.setTargetAtTime(
      (0.30 + throttle * 0.34 + rpmNorm * 0.16) * flutter, t, tau);
    this.intakeGain.gain.setTargetAtTime(throttle * (0.05 + rpmNorm * 0.09), t, 0.07);
    this.intakeFilter.frequency.setTargetAtTime(700 + rpmNorm * 1800 + throttle * 500, t, 0.08);
    this.turboOsc.frequency.setTargetAtTime(700 + rpmNorm * 3200, t, 0.06);
    this.turboGain.gain.setTargetAtTime(throttle * rpmNorm * 0.055, t, 0.09);
    this.transOsc.frequency.setTargetAtTime(110 + speedNorm * 640, t, 0.12);
    this.transGain.gain.setTargetAtTime(0.006 + speedNorm * 0.016, t, 0.2);
    this.windGain.gain.setTargetAtTime(speedNorm * speedNorm * 0.11, t, 0.15);
    this.screechGain.gain.setTargetAtTime(telemetry.onTrack ? slip * slip * 0.20 : 0, t, 0.05);
    this.gravelGain.gain.setTargetAtTime(telemetry.onTrack ? 0 : speedNorm * 0.22, t, 0.08);

    // 對手車：多普勒音高 + 方位定位 + 距離衰減
    const rival = telemetry.rival;
    if (rival && rival.level > 0.001) {
      const soundSpeed = 343;
      const doppler = clamp(rival.doppler || 0, -90, 90);
      this.rivalOsc.frequency.setTargetAtTime((78 + rpmNorm * 90) * (soundSpeed / (soundSpeed - doppler)), t, 0.06);
      this.rivalFilter.frequency.setTargetAtTime(420 + rpmNorm * 1200, t, 0.1);
      this.rivalGain.gain.setTargetAtTime(rival.level * 0.30, t, 0.09);
      if (this.rivalPanner) this.rivalPanner.pan.setTargetAtTime(clamp(rival.pan || 0, -1, 1), t, 0.08);
    } else {
      this.rivalGain.gain.setTargetAtTime(0, t, 0.12);
    }
  }

  blip(freq = 880, dur = 0.14, gain = 0.22) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  crash(intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const level = clamp(intensity, 0, 1);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    g.gain.setValueAtTime(0.62 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.46);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 1600; nf.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.34 * level, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(t); n.stop(t + 0.36);
  }

  /** 升檔／收油回火：短促的排氣爆音 */
  backfire(level = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 380 + Math.random() * 420; f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30 * clamp(level, 0, 1), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.16);
  }

  shiftBlip(upshift = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.cancelScheduledValues(t);
    this.engGain.gain.setTargetAtTime(0.16, t, 0.012);              // 換檔瞬間扭力中斷
    this.engGain.gain.setTargetAtTime(0.62, t + 0.055, 0.045);      // 接合後回補
    if (upshift) this.backfire(0.55);
  }

  /** 發車燈每亮一盞的機械聲 */
  lightOn(final = false) {
    this.blip(final ? 1180 : 520, final ? 0.34 : 0.1, final ? 0.4 : 0.2);
  }
}

/* ================================================================
 * 3. 玩家設定（儲存不可用時仍可遊玩）
 * ============================================================== */
const SETTINGS_KEY = 'apex-gp-racer-settings-v2';
function loadSettings() {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch (_) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch (_) { /* 隱私模式或儲存空間不足：只保留本次設定 */ }
}

/* ================================================================
 * 4. 遊戲主體
 * ============================================================== */
class CockpitRacer {
  constructor() {
    this.quality = detectQuality();
    this.settings = loadSettings();
    this.state = 'loading';   // loading | ready | countdown | racing | paused | finished
    this.dom = {};
    this.audio = new EngineAudio(this.settings.volume, this.settings.muted);
    this.input = new DrivingInput({ coarse: IS_COARSE });
    this.input.sensitivity = this.settings.sensitivity;
    this.chaseSnap = true;
    this.clock = new THREE.Clock();
    this.frame = 0;
    this.shake = 0;
    this.hitFlash = 0;
    this.crashCooldown = 0;
    this.countdownT = 0;
    this.raceTime = 0;
    this.lapTimes = [];
    this.bestLap = Infinity;
    this.bannerDeadline = 0;
    this.pausedByVisibility = false;
    this.difficulty = resolveDifficulty(this.settings.difficulty);
    this.penaltyMs = 0;
    this.jumpStart = false;
    this.slipstream = 0;
    this.drs = 0;
    this.standings = [];
    this.lastPosition = null;
    this.leaderBoard = [];

    // 玩家狀態（pos/vel 為 THREE 向量，模擬核心使用同一組純數值欄位）
    this.player = {
      pos: new THREE.Vector3(), heading: 0,
      vel: new THREE.Vector2(0, 0),  // x/z 平面速度
      speed: 0, lSpeed: 0, fSpeed: 0,
      latG: 0, lonG: 0,
      rpm: CFG.idleRpm, gear: 1,
      nearestIdx: 0, crossings: 0, lapStart: 0, laps: 0,
      onTrack: true, offT: 0,
      progress: 0, finished: false, finishTime: Infinity,
      id: 'player', code: PLAYER.code, name: PLAYER.name, color: PLAYER.color,
    };
    // AI 避車用的玩家代理物件（與 aiStep 的 traffic 契約一致）
    this.playerTraffic = { t: 0, lateral: 0, speed: 0 };
    this.playerSim = {
      x: 0, z: 0, vx: 0, vz: 0, heading: 0, onTrack: true,
      fSpeed: 0, lSpeed: 0, speed: 0, latG: 0, lonG: 0, yawRate: 0,
    };
    this.activeAi = [];
    this.traffic = [];
    this.ai = [];
  }

  /* ---------- 初始化 ---------- */
  async init() {
    this.cacheDom();
    if (!this.initRenderer()) {
      this.showScreen('fallback');
      return;
    }
    this.input.onPause = () => this.togglePause();
    this.input.onCamera = () => this.toggleView();
    this.bindUI();

    await this.buildWorld();
    this.setView(this.settings.view, false);
    this.resetRace();
    this.state = 'ready';
    this.showScreen('start');
    this.dom.loadScreen.classList.add('hidden');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  cacheDom() {
    const q = (id) => document.getElementById(id);
    this.dom = {
      stage: q('stage'),
      loadScreen: q('screen-loading'), loadBar: q('load-bar'), loadPct: q('load-pct'),
      startScreen: q('screen-start'), startBtn: q('start-btn'),
      pauseScreen: q('screen-pause'), resumeBtn: q('resume-btn'), quitBtn: q('quit-btn'),
      finishScreen: q('screen-finish'), finishStats: q('finish-stats'),
      againBtn: q('again-btn'), backBtn: q('back-btn'),
      fallback: q('screen-fallback'),
      hud: q('hud'),
      speed: q('hud-speed'), gear: q('hud-gear'),
      rpmFill: q('rpm-fill'), shiftLeds: Array.from(document.querySelectorAll('.shift-led')),
      lapCur: q('hud-lap-cur'), lapTotal: q('hud-lap-total'),
      lapTime: q('hud-laptime'), lastTime: q('hud-lasttime'), bestTime: q('hud-besttime'),
      position: q('hud-position'), posTotal: q('hud-pos-total'),
      minimap: q('minimap'), gMeter: q('gmeter'),
      pedalGas: q('pedal-gas'), pedalBrake: q('pedal-brake'),
      banner: q('banner'), bannerText: q('banner-text'), bannerSub: q('banner-sub'),
      hitFlash: q('hit-flash'),
      touchUi: q('touch-ui'),
      muteBtn: q('mute-btn'), viewBtn: q('view-btn'),
      pauseBtn: q('pause-btn'),
      viewBtns: Array.from(document.querySelectorAll('[data-view]')),
      sensitivityInputs: Array.from(document.querySelectorAll('[data-setting="sensitivity"]')),
      volumeInputs: Array.from(document.querySelectorAll('[data-setting="volume"]')),
      posBox: q('hud-pos-box'),
      qualityBtns: Array.from(document.querySelectorAll('[data-quality]')),
      raceClock: q('hud-raceclock'),
      tower: q('hud-tower'),
      gapAhead: q('hud-gap-ahead'), gapBehind: q('hud-gap-behind'),
      boostChip: q('hud-boost'), boostChipLabel: q('hud-boost-label'),
      startLights: q('start-lights'),
      lightLeds: Array.from(document.querySelectorAll('#start-lights .light-led')),
      difficultyButtons: Array.from(document.querySelectorAll('[data-difficulty]')),
      difficultyMeta: Array.from(document.querySelectorAll('[data-difficulty-meta]')),
      penaltyChip: q('hud-penalty'),
    };
    this.minimapCtx = this.dom.minimap.getContext('2d');
    this.gmeterCtx = this.dom.gMeter.getContext('2d');
  }

  initRenderer() {
    const test = document.createElement('canvas');
    const gl = test.getContext('webgl2') || test.getContext('webgl');
    if (!gl) return false;
    this.isWebGL2 = !!test.getContext('webgl2');

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality === 'high' ? Math.min(devicePixelRatio, 1.75) : Math.min(devicePixelRatio, 1));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.dom.stage.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xead9bb, 150, this.quality === 'high' ? 2400 : 1200);

    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 6000);
    this.baseFov = 72;
    this.scene.add(this.camera);

    // 後製 RT + 全螢幕 Pass
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      samples: this.isWebGL2 && this.quality === 'high' ? 4 : 0,
    });
    // RT 以 sRGB 編碼儲存：場景 pass 輸出與後製 pass 直寫螢幕保持一致的色彩空間
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBloom: { value: null },
        uBloom: { value: 0 },
        uBloomTexel: { value: new THREE.Vector2(0.004, 0.004) },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uHit: { value: 0 },
        uGrain: { value: REDUCED_MOTION ? 0 : 0.035 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float uTime, uSpeed, uHit, uGrain, uBloom;
        varying vec2 vUv;
        void main(){
          vec2 uv = vUv;
          vec2 c = uv - 0.5;
          float r = length(c);
          vec2 dir = c / max(r, 1e-5);
          float ab = (0.0008 + uSpeed * 0.0055) * r;
          float blur = uSpeed * 0.018;
          vec3 col = vec3(0.0);
          for (int i = 0; i < 6; i++){
            float t = float(i) / 5.0;
            vec2 suv = uv - dir * blur * t;
            col.r += texture2D(tDiffuse, suv + dir * ab).r;
            col.g += texture2D(tDiffuse, suv).g;
            col.b += texture2D(tDiffuse, suv - dir * ab).b;
          }
          col /= 6.0;
          if (uBloom > 0.001) {
            // 4-tap 取樣讓 1/4 解析度的光暈更柔
            vec2 bt = uBloomTexel * 1.5;
            vec3 bl = texture2D(tBloom, uv + vec2( bt.x,  bt.y)).rgb
                    + texture2D(tBloom, uv + vec2(-bt.x,  bt.y)).rgb
                    + texture2D(tBloom, uv + vec2( bt.x, -bt.y)).rgb
                    + texture2D(tBloom, uv + vec2(-bt.x, -bt.y)).rgb;
            col += bl * 0.25 * uBloom;
          }
          col *= smoothstep(1.02, 0.35, r * 1.08);              // 暗角
          col = mix(col, vec3(0.85, 0.06, 0.04), uHit * smoothstep(0.15, 0.85, r) * 0.9); // 碰撞紅閃
          float n = fract(sin(dot(uv * vec2(uTime * 41.0 + 7.0, uTime * 23.0 + 3.0), vec2(12.9898, 78.233))) * 43758.5453);
          col += (n - 0.5) * uGrain;                            // 膠片顆粒
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat));

    // Bloom：1/4 解析度明亮通道 RT（高畫質才啟用）
    this.bloomRT = new THREE.WebGLRenderTarget(Math.max(2, size.x >> 2), Math.max(2, size.y >> 2));
    this.bloomRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.bloomScene = new THREE.Scene();
    this.bloomMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uTexel: { value: new THREE.Vector2(1 / Math.max(2, size.x >> 2), 1 / Math.max(2, size.y >> 2)) },
        uThreshold: { value: 0.58 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float uThreshold;
        varying vec2 vUv;
        vec3 bright(vec2 uv){
          vec3 c = texture2D(tDiffuse, uv).rgb;
          // 軟門檻：保留高光與自發光，避免整張畫面泛白
          float l = max(max(c.r, c.g), c.b);
          return c * smoothstep(uThreshold, uThreshold + 0.35, l);
        }
        void main(){
          vec3 sum = bright(vUv) * 0.28;
          sum += bright(vUv + vec2( uTexel.x, 0.0)) * 0.12;
          sum += bright(vUv + vec2(-uTexel.x, 0.0)) * 0.12;
          sum += bright(vUv + vec2(0.0,  uTexel.y)) * 0.12;
          sum += bright(vUv + vec2(0.0, -uTexel.y)) * 0.12;
          sum += bright(vUv + uTexel) * 0.06;
          sum += bright(vUv - uTexel) * 0.06;
          sum += bright(vUv + vec2(uTexel.x, -uTexel.y)) * 0.06;
          sum += bright(vUv + vec2(-uTexel.x, uTexel.y)) * 0.06;
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    this.bloomScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bloomMat));

    // 後視鏡 RT
    this.mirrorRT = new THREE.WebGLRenderTarget(256, 64);
    this.mirrorRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.mirrorCam = new THREE.PerspectiveCamera(72, 4, 0.1, 400);

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'racing' || this.state === 'countdown') {
          this.pausedByVisibility = true;
          this.setPaused(true);
        }
        this.audio.suspend();
      } else {
        if (this.state === 'racing' || this.state === 'countdown') this.audio.resume();
      }
    });
    return true;
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt.setSize(size.x, size.y);
    if (this.bloomRT) {
      const bw = Math.max(2, size.x >> 2), bh = Math.max(2, size.y >> 2);
      this.bloomRT.setSize(bw, bh);
      this.bloomMat.uniforms.uTexel.value.set(1 / bw, 1 / bh);
      this.postMat.uniforms.uBloomTexel.value.set(1 / bw, 1 / bh);
    }
  }

  /* ---------- 場景搭建（分段建置，回報進度） ---------- */
  async buildWorld() {
    const steps = [
      ['生成賽道幾何…', () => this.buildTrack()],
      ['鋪設路面與路緣…', () => this.buildTrackMeshes()],
      ['設置護欄與設施…', () => this.buildBarriers()],
      ['種植賽道景觀…', () => this.buildScenery()],
      ['搭建天空與群山…', () => this.buildSky()],
      ['組裝駕駛艙…', () => this.buildCockpit()],
      ['組裝玩家賽車…', () => this.buildPlayerCar()],
      ['部署對手賽車…', () => this.buildAI()],
      ['建置胎煙與粒子系統…', () => this.buildTyreFx()],
      ['校準儀器與 HUD…', () => this.buildHudStatics()],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      this.dom.loadPct.textContent = label;
      this.dom.loadBar.style.width = `${((i + 1) / steps.length) * 100}%`;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
      fn();
    }
  }

  buildTrack() {
    this.track = buildRaceTrack();
  }

  buildTrackMeshes() {
    const t = this.track;
    // 地面
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4600, 48),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    this.scene.add(ground);

    // 柏油路面
    const roadGeo = ribbonGeometry(t, -CFG.trackHalfWidth, CFG.trackHalfWidth, null);
    const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
      map: asphaltTexture(), roughness: 0.92, metalness: 0.04, side: THREE.DoubleSide,
    }));
    this.scene.add(road);

    // 路緣石（彎道外側紅白相間）
    const curvMedian = (() => {
      const arr = Array.from(t.curvature).sort((a, b) => a - b);
      return arr[Math.floor(arr.length * 0.7)];
    })();
    const curbFilter = (i) => t.curvature[i] > curvMedian * 1.15;
    const curbGeoL = ribbonGeometry(t, CFG.trackHalfWidth, CFG.trackHalfWidth + 1.5, curbFilter);
    const curbGeoR = ribbonGeometry(t, -CFG.trackHalfWidth - 1.5, -CFG.trackHalfWidth, curbFilter);
    const curbCanvas = makeCanvas(64, 64);
    const cg = curbCanvas.getContext('2d');
    cg.fillStyle = '#e8eae2'; cg.fillRect(0, 0, 64, 64);
    cg.fillStyle = '#e03a26'; cg.fillRect(0, 0, 64, 32);
    const curbTex = new THREE.CanvasTexture(curbCanvas);
    curbTex.wrapS = curbTex.wrapT = THREE.RepeatWrapping;
    curbTex.colorSpace = THREE.SRGBColorSpace;
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7, side: THREE.DoubleSide });
    // 讓紅白格沿 v 每 ~2m 交替：複製 uv.v 縮放
    for (const geo of [curbGeoL, curbGeoR]) {
      const uvAttr = geo.attributes.uv;
      for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, uvAttr.getY(i) * 6);
      uvAttr.needsUpdate = true;
      this.scene.add(new THREE.Mesh(geo, curbMat));
    }

    // 起跑線 + 門架
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.trackHalfWidth * 2, 4),
      new THREE.MeshStandardMaterial({ map: checkerTexture(10, 2), roughness: 0.8 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(t.points[0].x, 0.03, t.points[0].z);
    line.rotation.z = -t.yaws[0];
    this.scene.add(line);

    const gantryMat = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.6, metalness: 0.4 });
    const pillarGeo = new THREE.BoxGeometry(0.9, 8, 0.9);
    const yaw0 = t.yaws[0];
    const r0 = t.rights[0];
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, gantryMat);
      p.position.set(
        t.points[0].x + r0.x * (CFG.trackHalfWidth + 1.5) * s, 4,
        t.points[0].z + r0.z * (CFG.trackHalfWidth + 1.5) * s
      );
      this.scene.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry((CFG.trackHalfWidth + 2) * 2, 2.2, 0.7), gantryMat);
    beam.position.set(t.points[0].x, 8.4, t.points[0].z);
    beam.rotation.y = yaw0;
    this.scene.add(beam);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry((CFG.trackHalfWidth + 1) * 2, 2),
      new THREE.MeshBasicMaterial({ map: gantryTexture() })
    );
    banner.position.set(t.points[0].x, 8.4, t.points[0].z);
    banner.rotation.y = yaw0;
    banner.translateZ(0.4);
    this.scene.add(banner);
  }

  buildBarriers() {
    const t = this.track;
    const S = t.S;
    const step = this.quality === 'high' ? 4 : 6;
    const countPerSide = Math.ceil(S / step);
    const geo = new THREE.BoxGeometry(t.segLen * step + 0.3, 0.95, 0.4);
    const mat = new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: 0.55, metalness: 0.15 });
    const mesh = new THREE.InstancedMesh(geo, mat, countPerSide * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < S; i += step) {
        const c = t.points[i], r = t.rights[i];
        const off = (CFG.trackHalfWidth + CFG.barrierOffset) * side;
        pos.set(c.x + r.x * off, 0.5, c.z + r.z * off);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaws[i] + Math.PI / 2);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(n++, m);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);

    // 彎角輪胎堆
    const tireGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.42, 12);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.95 });
    const hotCorners = [];
    const curvSorted = Array.from(t.curvature).sort((a, b) => b - a);
    const hotThreshold = curvSorted[Math.floor(S * 0.015)] || 0.01;
    for (let i = 0; i < S; i += 12) {
      if (t.curvature[i] > hotThreshold) hotCorners.push(i);
    }
    const stackMesh = new THREE.InstancedMesh(tireGeo, tireMat, hotCorners.length * 12);
    let tn = 0;
    for (const i of hotCorners) {
      const c = t.points[i], r = t.rights[i];
      const side = (i / 12) % 2 === 0 ? 1 : -1;
      for (let layer = 0; layer < 4; layer++) {
        for (let k = 0; k < 3; k++) {
          const off = (CFG.trackHalfWidth + CFG.barrierOffset + 1.2) * side;
          pos.set(
            c.x + r.x * off + (k - 1) * 0.7 * r.x + (layer % 2) * 0.3,
            0.21 + layer * 0.42,
            c.z + r.z * off + (k - 1) * 0.7 * r.z
          );
          m.compose(pos, new THREE.Quaternion(), scl);
          if (tn < stackMesh.count) stackMesh.setMatrixAt(tn++, m);
        }
      }
    }
    stackMesh.count = tn;
    stackMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(stackMesh);

    // 看台（起跑直道兩側）
    const standMat = new THREE.MeshStandardMaterial({ map: standTexture(), roughness: 0.8 });
    for (const [idx, side] of [[18, 1], [18, -1], [S - 24, 1]]) {
      const c = t.points[idx % S], r = t.rights[idx % S];
      const stand = new THREE.Mesh(new THREE.BoxGeometry(70, 9, 10), standMat);
      const off = (CFG.trackHalfWidth + 16) * side;
      stand.position.set(c.x + r.x * off, 4.5, c.z + r.z * off);
      stand.rotation.y = t.yaws[idx % S] + Math.PI / 2;
      this.scene.add(stand);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(72, 0.5, 13),
        new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.5, metalness: 0.3 })
      );
      roof.position.set(stand.position.x, 10.6, stand.position.z);
      roof.rotation.y = stand.rotation.y;
      this.scene.add(roof);
    }

    // 廣告板
    const slogans = [
      ['APEX GP', '#d8ff3e'], ['NO LIMITS', '#ff4c38'], ['TAICHUNG SPEED FEST', '#39c6ff'],
      ['JUST THE LINE', '#d8ff3e'], ['VORTEX R', '#f5a623'], ['FULL SEND', '#ff4c38'],
    ];
    const boardGeo = new THREE.PlaneGeometry(14, 3.5);
    slogans.forEach(([text, color], k) => {
      const mat = new THREE.MeshBasicMaterial({ map: billboardTexture(text, color), side: THREE.DoubleSide });
      for (let j = 0; j < 3; j++) {
        const i = Math.floor((k * 3 + j) * (t.S / 9)) % t.S;
        const c = t.points[i], r = t.rights[i];
        const side = (k + j) % 2 === 0 ? 1 : -1;
        const off = (CFG.trackHalfWidth + 6.5) * side;
        const board = new THREE.Mesh(boardGeo, mat);
        board.position.set(c.x + r.x * off, 2.4, c.z + r.z * off);
        board.rotation.y = t.yaws[i] + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.scene.add(board);
      }
    });

    // 燈柱
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a3136, roughness: 0.5, metalness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe9b8, emissiveIntensity: 0.9 });
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.3, 15, 6);
    const headGeo = new THREE.BoxGeometry(2.6, 0.35, 1.1);
    for (let i = 0; i < t.S; i += 48) {
      const c = t.points[i], r = t.rights[i];
      const off = (CFG.trackHalfWidth + 9) * (i % 96 === 0 ? 1 : -1);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(c.x + r.x * off, 7.5, c.z + r.z * off);
      this.scene.add(pole);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(pole.position.x, 15.1, pole.position.z);
      head.rotation.y = t.yaws[i];
      this.scene.add(head);
    }
  }

  buildScenery() {
    const t = this.track;
    const count = 460; // 配置一次，切換畫質只需調整實例數
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.5, 3.4, 5);
    const crownGeo = new THREE.ConeGeometry(2.9, 7.2, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 12) {
      guard++;
      const th = Math.random() * TAU;
      const rTrack = t.radiusAt(th) * (Math.cos(th) >= 0 ? 1 : 1); // 橢圓縮放另計
      const outer = Math.random() < 0.72;
      const dist = outer ? 26 + Math.random() * 260 : 24 + Math.random() * 90;
      const rx = Math.cos(th) * (rTrack + (outer ? dist : -dist)) * 1.25;
      const rz = Math.sin(th) * (rTrack + (outer ? dist : -dist)) * 0.95;
      // 避開起跑看台區
      if (Math.hypot(rx - t.points[18].x, rz - t.points[18].z) < 60) continue;
      const sc = 0.7 + Math.random() * 1.1;
      p.set(rx, 1.7 * sc, rz); s.set(sc, sc, sc);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * TAU);
      m.compose(p, q, s);
      trunks.setMatrixAt(placed, m);
      p.y = (3.4 + 3.1) * sc;
      m.compose(p, q, s);
      crowns.setMatrixAt(placed, m);
      col.setHSL(0.27 + Math.random() * 0.06, 0.42 + Math.random() * 0.2, 0.24 + Math.random() * 0.1);
      crowns.setColorAt(placed, col);
      placed++;
    }
    this.treeMeshes = [trunks, crowns];
    this.treeCount = placed;
    trunks.count = crowns.count = this.quality === 'high' ? placed : Math.min(180, placed);
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.scene.add(trunks, crowns);
  }

  buildSky() {
    // 天空球（漸層 + 太陽）
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.45, 0.32, -0.83).normalize() },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 zenith  = vec3(0.16, 0.36, 0.66);
          vec3 middle  = vec3(0.55, 0.72, 0.90);
          vec3 horizon = vec3(0.98, 0.83, 0.62);
          vec3 col = mix(horizon, middle, smoothstep(0.0, 0.18, h));
          col = mix(col, zenith, smoothstep(0.14, 0.55, h));
          float sun = max(dot(normalize(vDir), uSunDir), 0.0);
          col += vec3(1.0, 0.85, 0.55) * pow(sun, 350.0) * 2.2;   // 太陽本體
          col += vec3(1.0, 0.72, 0.42) * pow(sun, 9.0) * 0.30;    // 光暈
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4800, 32, 20), skyMat);
    this.scene.add(sky);
    this.sunDir = skyMat.uniforms.uSunDir.value.clone();

    // 太陽光與環境光
    const sun = new THREE.DirectionalLight(0xffe6bd, 2.1);
    sun.position.copy(this.sunDir).multiplyScalar(1500);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfd8f2, 0x3c5633, 0.95));

    // 雲（billboard 平面）
    const cloudTex = cloudTexture();
    const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.85, fog: false, depthWrite: false });
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const w = 500 + Math.random() * 420;
      const c = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.34), cloudMat);
      const ang = (i / 9) * TAU + Math.random() * 0.5;
      const rad = 1700 + Math.random() * 900;
      c.position.set(Math.cos(ang) * rad, 330 + Math.random() * 220, Math.sin(ang) * rad);
      this.scene.add(c);
      this.clouds.push(c);
    }

    // 遠山（位於霧氣邊界內，形成黃金時刻的剪影層次）
    const mtMat = new THREE.MeshStandardMaterial({ color: 0x46586e, roughness: 1, flatShading: true });
    const mtMat2 = new THREE.MeshStandardMaterial({ color: 0x5a6e84, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * TAU + Math.random() * 0.3;
      const rad = 1900 + Math.random() * 900;
      const h = 260 + Math.random() * 620;
      const mt = new THREE.Mesh(new THREE.ConeGeometry(340 + Math.random() * 520, h, 5), i % 2 ? mtMat : mtMat2);
      mt.position.set(Math.cos(ang) * rad, h / 2 - 30, Math.sin(ang) * rad);
      mt.rotation.y = Math.random() * TAU;
      this.scene.add(mt);
    }
  }

  /* ---------- 駕駛艙 ---------- */
  buildCockpit() {
    const cockpit = new THREE.Group();
    this.cockpit = cockpit;

    const carbon = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.42, metalness: 0.55 });
    const carbonDark = new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.5, metalness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xd8ff3e, roughness: 0.35, metalness: 0.2, emissive: 0x6f8a10, emissiveIntensity: 0.5 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.95 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xd8ff3e, roughness: 0.3, metalness: 0.7 });

    const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      cockpit.add(mesh);
      return mesh;
    };

    // 車頭鼻錐 + 前翼（鏡頭前方可見）
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 2.6, 8), carbon);
    add(nose, 0, -0.52, -1.95, Math.PI / 2);
    const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 1.2), carbon);
    add(noseTip, 0, -0.56, -3.0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.62), carbonDark);
    add(wing, 0, -0.6, -3.35);
    const wingFlap = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.3), carbon);
    add(wingFlap, 0, -0.44, -3.5, -0.35);
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.66), accent);
      add(plate, s * 0.95, -0.52, -3.35);
    }

    // 前輪（轉向 + 滾動）
    this.frontWheels = [];
    this.wheelPivots = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.82, -0.5, -1.85);
      const wheel = new THREE.Group();
      const t_ = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.32, 18), tire);
      t_.rotation.z = Math.PI / 2;
      wheel.add(t_);
      const rimDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 12), rim);
      rimDisc.rotation.z = Math.PI / 2;
      wheel.add(rimDisc);
      // 輻條
      for (let k = 0; k < 4; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.05), rim);
        spoke.rotation.x = (k / 4) * Math.PI;
        wheel.add(spoke);
      }
      pivot.add(wheel);
      cockpit.add(pivot);
      this.frontWheels.push(wheel);
      this.wheelPivots.push(pivot);
      // 懸吊臂
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.07), carbonDark);
      add(arm, s * 0.55, -0.5, -1.85);
    }

    // 車身側艙 + 底板
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 2.3), carbon);
      add(pod, s * 0.46, -0.5, -0.55);
      const podTop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 2.0), carbonDark);
      add(podTop, s * 0.46, -0.31, -0.5);
      // 側箱進氣口
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.5), carbonDark);
      add(intake, s * 0.62, -0.4, -1.2);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 2.4), carbonDark);
    add(floor, 0, -0.66, -0.4);

    // 座艙邊緣（環繞視野下緣）
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.3, 1.15), carbon);
    add(tub, 0, -0.52, 0.15);
    const headrestL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.6), carbonDark);
    add(headrestL, -0.46, -0.36, 0.35);
    const headrestR = headrestL.clone();
    add(headrestR, 0.46, -0.36, 0.35);

    // Halo 安全環（F1 標誌性結構）
    const haloMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.35, metalness: 0.65 });
    const haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 8, 28, Math.PI * 1.35), haloMat);
    add(haloRing, 0, -0.16, -1.2, Math.PI / 2, 0, Math.PI * 0.825);
    const haloStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 6), haloMat);
    add(haloStrut, 0, -0.2, -0.98, 0.28);
    for (const s of [-1, 1]) {
      const sideStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.4, 6), haloMat);
      add(sideStrut, s * 0.47, -0.18, -0.52, 0, 0, s * 0.5);
    }

    // 後視鏡
    this.mirrorMeshes = [];
    const mirrorShellGeo = new THREE.BoxGeometry(0.26, 0.1, 0.1);
    const mirrorCanvas = makeCanvas(128, 32);
    const mirrorCtx = mirrorCanvas.getContext('2d');
    const grd = mirrorCtx.createLinearGradient(0, 0, 0, 32);
    grd.addColorStop(0, '#9db9d8'); grd.addColorStop(0.55, '#6f8aa8'); grd.addColorStop(0.56, '#3a4a3a'); grd.addColorStop(1, '#2c3a2c');
    mirrorCtx.fillStyle = grd; mirrorCtx.fillRect(0, 0, 128, 32);
    this.staticMirrorTexture = new THREE.CanvasTexture(mirrorCanvas);
    this.staticMirrorTexture.colorSpace = THREE.SRGBColorSpace;
    const mirrorTex = this.quality === 'high' ? this.mirrorRT.texture : this.staticMirrorTexture;
    for (const s of [-1, 1]) {
      const shell = new THREE.Mesh(mirrorShellGeo, carbon);
      add(shell, s * 0.66, -0.24, -0.72, 0, -s * 0.35, 0);
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(0.23, 0.075),
        new THREE.MeshBasicMaterial({ map: mirrorTex })
      );
      // 鏡面朝駕駛（+Z），並向外偏轉少許角度
      glass.position.set(s * 0.66, -0.235, -0.665);
      glass.rotation.y = s * 0.34;
      cockpit.add(glass);
      this.mirrorMeshes.push(glass);
    }

    // 方向盤總成
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(0, -0.3, -0.62);
    wheelGroup.rotation.x = -0.42;
    this.steerWheel = wheelGroup;
    const rimTorus = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.024, 10, 30), carbonDark);
    wheelGroup.add(rimTorus);
    const gripL = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.03, 8, 10, 0.9), tire);
    gripL.rotation.z = Math.PI * 0.62;
    wheelGroup.add(gripL);
    const gripR = gripL.clone();
    gripR.rotation.z = Math.PI * -0.12;
    wheelGroup.add(gripR);
    // 輻條與中央顯示
    const spokeH = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.03), carbon);
    spokeH.position.z = 0.01;
    wheelGroup.add(spokeH);
    const spokeV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.03), carbon);
    spokeV.position.set(0, -0.09, 0.01);
    wheelGroup.add(spokeV);
    const display = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: 0xd8ff3e, emissiveIntensity: 0.65 }));
    display.position.set(0, 0.045, -0.015);
    wheelGroup.add(display);
    // 換檔燈
    this.ledMeshes = [];
    const ledGeo = new THREE.BoxGeometry(0.022, 0.016, 0.012);
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x111411 });
      const led = new THREE.Mesh(ledGeo, mat);
      const ang = Math.PI * (0.62 + (i / 6) * 0.76);
      led.position.set(Math.cos(ang) * 0.145, Math.sin(ang) * 0.145, -0.012);
      wheelGroup.add(led);
      this.ledMeshes.push(led);
    }
    // 雙手（賽車手套）
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.85 });
    const gloveAccent = new THREE.MeshStandardMaterial({ color: 0xd8ff3e, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const glove = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.055), gloveMat);
      glove.add(palm);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.02, 0.056), gloveAccent);
      stripe.position.y = 0.02;
      glove.add(stripe);
      const ang = s > 0 ? Math.PI * 1.72 : Math.PI * 1.28;
      glove.position.set(Math.cos(ang) * 0.16, Math.sin(ang) * 0.16, -0.03);
      glove.rotation.z = ang - Math.PI / 2;
      wheelGroup.add(glove);
    }
    cockpit.add(wheelGroup);

    // 儀表板
    const dashCurve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.5, 24, 1, true, Math.PI * 0.72, Math.PI * 0.56),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })
    );
    add(dashCurve, 0, -0.42, -0.52);
    const dashBase = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.1, 0.28), carbonDark);
    add(dashBase, 0, -0.55, -0.72, 0.2);

    // 雙儀表（Canvas 即時繪製）
    this.gaugeTach = this.makeGauge();
    this.gaugeSpeedo = this.makeGauge();
    const tachPlane = new THREE.Mesh(
      new THREE.CircleGeometry(0.088, 28),
      new THREE.MeshBasicMaterial({ map: this.gaugeTach.tex })
    );
    tachPlane.position.set(-0.16, -0.4, -0.63);
    tachPlane.rotation.x = -0.55;
    cockpit.add(tachPlane);
    const speedoPlane = new THREE.Mesh(
      new THREE.CircleGeometry(0.088, 28),
      new THREE.MeshBasicMaterial({ map: this.gaugeSpeedo.tex })
    );
    speedoPlane.position.set(0.16, -0.4, -0.63);
    speedoPlane.rotation.x = -0.55;
    cockpit.add(speedoPlane);

    // 將駕駛艙掛在相機上
    this.camera.add(cockpit);
  }

  /* ---------- 第三人稱玩家車：獨立世界模型，不與相機綁定 ---------- */
  buildPlayerCar() {
    const car = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x526b66, emissive: 0x102522, emissiveIntensity: 0.35, metalness: 0.55, roughness: 0.34 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x202a2d, emissive: 0x0c1113, emissiveIntensity: 0.25, metalness: 0.38, roughness: 0.48 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xc6f229, emissive: 0x526500, emissiveIntensity: 0.32, metalness: 0.35, roughness: 0.3 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x171a1b, roughness: 0.94 });
    const rim = new THREE.MeshStandardMaterial({ color: 0x6f8380, metalness: 0.82, roughness: 0.27 });
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      car.add(mesh);
      return mesh;
    };

    // 長鼻錐、地板與具有高對比識別線的側箱。
    add(new THREE.BoxGeometry(1.7, 0.12, 4.9), carbon, 0, 0.18, -0.05);
    add(new THREE.BoxGeometry(0.92, 0.46, 3.15), body, 0, 0.48, -0.1);
    add(new THREE.CylinderGeometry(0.20, 0.36, 2.35, 8), body, 0, 0.42, -2.35, Math.PI / 2);
    add(new THREE.BoxGeometry(0.15, 0.025, 2.2), accent, 0, 0.65, -2.25);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.55, 0.4, 1.9), body, side * 0.67, 0.43, 0.32);
      add(new THREE.BoxGeometry(0.48, 0.035, 1.8), accent, side * 0.68, 0.65, 0.2);
      add(new THREE.BoxGeometry(0.1, 0.22, 0.48), carbon, side * 0.96, 0.53, -0.35);
    }

    // 前後翼與翼端板。
    add(new THREE.BoxGeometry(2.45, 0.07, 0.62), carbon, 0, 0.24, -3.55);
    add(new THREE.BoxGeometry(2.32, 0.045, 0.3), accent, 0, 0.32, -3.7, -0.13);
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.07, 0.36, 0.72), accent, side * 1.22, 0.37, -3.48);
      add(new THREE.BoxGeometry(0.06, 0.67, 0.64), accent, side * 1.08, 1.19, 2.18);
      add(new THREE.BoxGeometry(0.08, 0.7, 0.08), carbon, side * 0.35, 0.87, 2.08);
    }
    add(new THREE.BoxGeometry(2.2, 0.11, 0.62), carbon, 0, 1.43, 2.18);
    add(new THREE.BoxGeometry(2.08, 0.055, 0.12), accent, 0, 1.49, 2.47);
    add(new THREE.BoxGeometry(1.4, 0.12, 0.3), body, 0, 0.34, 2.28);
    for (const x of [-0.5, 0, 0.5]) add(new THREE.BoxGeometry(0.045, 0.18, 0.4), rim, x, 0.25, 2.31);
    const wingLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.3), new THREE.MeshBasicMaterial({ map: billboardTexture('APEX GP', '#d8ff3e') }));
    wingLabel.position.set(0, 1.26, 2.51);
    car.add(wingLabel);

    // 駕駛頭盔與 Halo。
    add(new THREE.SphereGeometry(0.31, 16, 12), accent, 0, 0.98, 0.08);
    add(new THREE.BoxGeometry(0.45, 0.14, 0.08), carbon, 0, 1.02, -0.21);
    add(new THREE.TorusGeometry(0.48, 0.038, 8, 24, Math.PI * 1.5), carbon, 0, 0.93, -0.02, Math.PI / 2, 0, Math.PI * 0.75);
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.42, 6), carbon, 0, 0.73, -0.52, -0.12);

    this.playerWheels = [];
    this.playerFrontPivots = [];
    for (const [x, z] of [[-1.05, -2.1], [1.05, -2.1], [-1.08, 1.55], [1.08, 1.55]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.43, z);
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.4, 20), rubber);
      tyre.rotation.z = Math.PI / 2;
      wheel.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.415, 14), rim);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.025, 18), accent);
      stripe.rotation.z = Math.PI / 2;
      stripe.position.x = x < 0 ? -0.215 : 0.215;
      wheel.add(stripe);
      pivot.add(wheel);
      car.add(pivot);
      this.playerWheels.push(wheel);
      if (z < 0) this.playerFrontPivots.push(pivot);
      add(new THREE.BoxGeometry(0.55, 0.045, 0.06), carbon, x * 0.68, 0.43, z);
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xb41f16 });
    this.playerBrakeLight = add(new THREE.BoxGeometry(0.18, 0.12, 0.06), lightMat, 0, 0.36, 2.55);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.33, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.7, 3.7, 1);
    shadow.position.y = 0.025;
    car.add(shadow);
    car.visible = false;
    this.playerCar = car;
    this.scene.add(car);
  }

  makeGauge() {
    const canvas = makeCanvas(256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx: canvas.getContext('2d'), tex };
  }

  drawGauges() {
    const p = this.player;
    const rpmN = clamp((p.rpm - CFG.idleRpm) / (CFG.redlineRpm - CFG.idleRpm), 0, 1);
    // --- 轉速表 ---
    {
      const g = this.gaugeTach.ctx;
      g.clearRect(0, 0, 256, 256);
      g.fillStyle = 'rgba(8,10,12,.92)';
      g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill();
      g.lineWidth = 14;
      g.strokeStyle = '#1d2226';
      g.beginPath(); g.arc(128, 128, 96, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      // 刻度弧
      const startA = Math.PI * 0.75, endA = Math.PI * 2.25;
      for (let i = 0; i <= 12; i++) {
        const a = startA + (endA - startA) * (i / 12);
        g.strokeStyle = i >= 10 ? '#ff4c38' : '#59635c';
        g.lineWidth = i % 2 === 0 ? 5 : 2.5;
        g.beginPath();
        g.moveTo(128 + Math.cos(a) * 84, 128 + Math.sin(a) * 84);
        g.lineTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70);
        g.stroke();
      }
      // 進度弧
      g.strokeStyle = rpmN > 0.82 ? '#ff4c38' : '#d8ff3e';
      g.lineWidth = 12;
      g.beginPath();
      g.arc(128, 128, 96, startA, startA + (endA - startA) * rpmN);
      g.stroke();
      // 指針
      const na = startA + (endA - startA) * rpmN;
      g.strokeStyle = '#f1f5eb';
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(128, 128);
      g.lineTo(128 + Math.cos(na) * 80, 128 + Math.sin(na) * 80);
      g.stroke();
      g.fillStyle = '#d8ff3e';
      g.font = '700 46px "Barlow Condensed", Arial';
      g.textAlign = 'center';
      g.fillText(p.fSpeed < -0.5 ? 'R' : String(p.gear), 128, 150);
      g.fillStyle = '#7d877f';
      g.font = '500 17px "DM Mono", monospace';
      g.fillText('RPM ×1000', 128, 178);
      this.gaugeTach.tex.needsUpdate = true;
    }
    // --- 時速表 ---
    {
      const g = this.gaugeSpeedo.ctx;
      g.clearRect(0, 0, 256, 256);
      g.fillStyle = 'rgba(8,10,12,.92)';
      g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill();
      const kmh = p.speed * 3.6;
      const spdN = clamp(kmh / 320, 0, 1);
      const startA = Math.PI * 0.75, endA = Math.PI * 2.25;
      g.strokeStyle = '#1d2226';
      g.lineWidth = 14;
      g.beginPath(); g.arc(128, 128, 96, startA, endA); g.stroke();
      g.strokeStyle = '#39c6ff';
      g.beginPath(); g.arc(128, 128, 96, startA, startA + (endA - startA) * spdN); g.stroke();
      g.fillStyle = '#f1f5eb';
      g.font = '700 62px "Barlow Condensed", Arial';
      g.textAlign = 'center';
      g.fillText(String(Math.round(kmh)).padStart(3, '0'), 128, 142);
      g.fillStyle = '#7d877f';
      g.font = '500 17px "DM Mono", monospace';
      g.fillText('KM/H', 128, 172);
      // DRS 風格條
      g.fillStyle = '#1d2226';
      g.fillRect(58, 200, 140, 10);
      g.fillStyle = '#d8ff3e';
      g.fillRect(58, 200, 140 * spdN, 10);
      this.gaugeSpeedo.tex.needsUpdate = true;
    }
  }

  /* ---------- AI 對手 ---------- */
  /**
   * 一次建置 CFG.maxOpponents 台對手車（難度只決定出場數量與 visible），
   * 避免切換難度時重建幾何造成卡頓。每台車有車手身分、塗裝、名牌與煞車燈。
   */
  buildAI() {
    const t = this.track;
    this.ai = [];
    for (let k = 0; k < CFG.maxOpponents; k++) {
      const driver = DRIVERS[k % DRIVERS.length];
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: driver.color, roughness: 0.32, metalness: 0.5 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6 });
      const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.45, metalness: 0.55 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 4.4), bodyMat);
      body.position.y = 0.42;
      group.add(body);
      const noseCone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 1.6, 8), bodyMat);
      noseCone.rotation.x = Math.PI / 2;
      noseCone.position.set(0, 0.36, -2.9);
      group.add(noseCone);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 1.1), dark);
      cabin.position.set(0, 0.82, 0.3);
      group.add(cabin);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 14, Math.PI), carbon);
      halo.rotation.set(Math.PI / 2, 0, 0);
      halo.position.set(0, 1.02, 0.3);
      group.add(halo);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.5), dark);
      wing.position.set(0, 0.95, 2.25);
      group.add(wing);
      const wingStripe = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.02, 0.16), bodyMat);
      wingStripe.position.set(0, 0.99, 2.25);
      group.add(wingStripe);
      const fw = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.5), dark);
      fw.position.set(0, 0.16, -3.4);
      group.add(fw);
      const brakeLight = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.14, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xb41f16, emissive: 0xff2a1a, emissiveIntensity: 0.4, roughness: 0.4 })
      );
      brakeLight.position.set(0, 0.86, 2.52);
      group.add(brakeLight);

      const wheels = [];
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.95 });
      for (const [wx, wz] of [[-0.85, -2.2], [0.85, -2.2], [-0.9, 1.6], [0.9, 1.6]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.34, 14), tireMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.36, wz);
        group.add(w);
        wheels.push(w);
      }
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(2.4, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      group.add(shadow);

      // 車手名牌：Canvas 文字 Sprite，讓玩家在追車視角能辨識前車身分
      const tag = makeNameTag(driver.code, driver.color);
      tag.position.set(0, 2.05, 0.4);
      tag.scale.set(3.2, 0.8, 1);
      group.add(tag);

      group.visible = false;
      this.scene.add(group);

      this.ai.push({
        id: `ai-${k}`, group, wheels, tag, brakeLight, driver,
        idx: 0, t: 0, lateral: 0, targetLateral: 0,
        crossings: 0, speed: 0, progress: 0,
        finished: false, finishTime: Infinity, laps: 0,
        launchDelay: 0, mistakeTimer: 0, mistakeScale: 1,
        blocked: 0, braking: false, code: driver.code, name: driver.name, color: driver.color,
      });
    }
    this.applyDifficulty(this.settings.difficulty, false);
  }

  /** 依難度決定出場對手、發車格與 AI 參數 */
  applyDifficulty(difficulty, reset = true) {
    const level = resolveDifficulty(difficulty);
    this.difficulty = level;
    this.settings.difficulty = level.id;
    const field = level.opponents;
    this.ai.forEach((car, k) => {
      car.active = k < field;
      car.pace = level.pace * (field > 1 ? 1 + (k / (field - 1) - 0.5) * level.paceSpread : 1);
      car.aggression = clamp(level.aggression * (0.86 + ((k * 37) % 29) / 100), 0.1, 1.2);
      car.accel = level.accel;
      car.brake = level.brake;
      car.mistakeRate = level.mistakeRate;
      car.reaction = level.reaction;
      const profile = new Float32Array(this.track.S);
      const base = this.track.aiProfile;
      for (let i = 0; i < profile.length; i++) profile[i] = base[i] * car.pace;
      car.profile = profile;
      if (car.group) car.group.visible = car.active;
    });
    this.activeAi = this.ai.filter((car) => car.active);
    if (this.dom.posTotal) this.dom.posTotal.textContent = String(field + 1);
    this.syncDifficultyUI(level.id);
    if (reset && this.state !== 'racing' && this.state !== 'countdown') this.resetRace();
    saveSettings(this.settings);
    this.buildStandingsBoard();
  }

  /* ---------- HUD 靜態 ---------- */
  /* ---------- HUD 靜態 ---------- */
  buildHudStatics() {
    // 小地圖路徑（正規化）
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of t.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14, W = 172, H = 132;
    const sx = (W - pad * 2) / (maxX - minX);
    const sz = (H - pad * 2) / (maxZ - minZ);
    const sc = Math.min(sx, sz);
    this.minimapPath = t.points.filter((_, i) => i % 8 === 0).map((p) => [
      pad + (p.x - minX) * sc + ((W - pad * 2) - (maxX - minX) * sc) / 2,
      pad + (p.z - minZ) * sc + ((H - pad * 2) - (maxZ - minZ) * sc) / 2,
    ]);
    this.minimapToCanvas = (pos) => [
      pad + (pos.x - minX) * sc + ((W - pad * 2) - (maxX - minX) * sc) / 2,
      pad + (pos.z - minZ) * sc + ((H - pad * 2) - (maxZ - minZ) * sc) / 2,
    ];
    // 小地圖上的賽車線提示
    const line = this.track.racingLine;
    this.minimapLine = this.track.points
      .filter((_, i) => i % 8 === 0)
      .map((c, n) => {
        const i = n * 8;
        const r = this.track.rights[i];
        return this.minimapToCanvas({ x: c.x + r.x * line[i], z: c.z + r.z * line[i] });
      });
    this.dom.lapTotal.textContent = String(CFG.totalLaps);
    this.dom.posTotal.textContent = String(this.activeAi.length + 1);
    if (IS_COARSE) this.dom.touchUi.classList.remove('hidden');
  }

  /* ---------- 可即時套用的畫質、鏡頭與駕駛設定 ---------- */
  setQuality(quality) {
    if (quality !== 'high' && quality !== 'low') return;
    this.quality = quality;
    this.dom.qualityBtns.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.quality === quality)));
    if (!this.renderer) return;
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(devicePixelRatio, 1.75) : Math.min(devicePixelRatio, 1));
    this.scene.fog.far = quality === 'high' ? 2400 : 1200;
    const samples = this.isWebGL2 && quality === 'high' ? 4 : 0;
    if (this.rt.samples !== samples) {
      this.rt.samples = samples;
      this.rt.dispose(); // Three.js 在下次渲染時重建 render target
    }
    if (this.treeMeshes) for (const mesh of this.treeMeshes) {
      mesh.count = quality === 'high' ? this.treeCount : Math.min(180, this.treeCount);
      mesh.computeBoundingSphere(); // 畫質切換後重新計算實例的裁切範圍
    }
    if (this.mirrorMeshes) for (const mirror of this.mirrorMeshes) {
      mirror.material.map = quality === 'high' ? this.mirrorRT.texture : this.staticMirrorTexture;
      mirror.material.needsUpdate = true;
    }
    this.onResize();
  }

  syncSettingsUI() {
    const d = this.dom;
    for (const [inputs, value] of [[d.sensitivityInputs, this.settings.sensitivity], [d.volumeInputs, this.settings.volume]]) {
      for (const input of inputs) {
        const percent = Math.round(value * 100);
        input.value = String(percent);
        input.setAttribute('aria-valuetext', `${percent}%`);
        input.closest('.setting-control').querySelector('output').textContent = `${percent}%`;
      }
    }
    d.viewBtns.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === this.settings.view)));
    d.viewBtn.setAttribute('aria-label', this.settings.view === 'cockpit' ? '切換至第三人稱視角' : '切換至駕駛艙視角');
    d.viewBtn.textContent = this.settings.view === 'cockpit' ? 'CAM' : 'CHASE';
    const silent = this.settings.muted || this.settings.volume === 0;
    d.muteBtn.textContent = silent ? 'MUTE' : 'SND';
    d.muteBtn.setAttribute('aria-pressed', String(silent));
    d.muteBtn.setAttribute('aria-label', silent ? '開啟音效' : '靜音');
  }

  setView(view, persist = true) {
    if (view !== 'cockpit' && view !== 'chase') return;
    if (view !== this.settings.view) this.chaseSnap = true;
    this.settings.view = view;
    if (this.cockpit) this.cockpit.visible = view === 'cockpit';
    if (this.playerCar) this.playerCar.visible = view === 'chase';
    if (persist) saveSettings(this.settings);
    this.syncSettingsUI();
  }

  toggleView() { this.setView(this.settings.view === 'cockpit' ? 'chase' : 'cockpit'); }

  /**
   * 切換難度。發車前／完賽後立即重建發車格與對手參數；
   * 比賽進行中（含暫停）只記錄選擇，於下一次發車生效，避免中途改變賽況。
   */
  setDifficulty(id) {
    const level = resolveDifficulty(id);
    const selected = level.id === (this.pendingDifficulty || this.difficulty.id);
    if (selected) return;
    const midRace = this.state === 'paused' || this.state === 'racing' || this.state === 'countdown';
    this.settings.difficulty = level.id;
    saveSettings(this.settings);
    if (midRace) {
      this.pendingDifficulty = level.id;
      this.syncDifficultyUI(level.id, true);
    } else {
      this.pendingDifficulty = null;
      this.applyDifficulty(level.id, false);
      this.resetRace();
    }
    this.audio.blip(760, 0.1, 0.24);
  }

  syncDifficultyUI(id, pending = false) {
    const level = resolveDifficulty(id);
    for (const button of this.dom.difficultyButtons || []) {
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === level.id));
    }
    for (const meta of this.dom.difficultyMeta || []) {
      meta.textContent = `${level.tag} · ${level.opponents} 位對手 · ${level.blurb}` + (pending ? '（下一場生效）' : '');
    }
  }

  /** 套用排隊中的難度（下一次發車時） */
  flushPendingDifficulty() {
    if (!this.pendingDifficulty) return;
    const id = this.pendingDifficulty;
    this.pendingDifficulty = null;
    this.applyDifficulty(id, false);
    this.resetRace();
  }

  /* ---------- UI 綁定 ---------- */
  bindUI() {
    const d = this.dom;
    d.qualityBtns.forEach((button) => {
      button.addEventListener('click', () => this.setQuality(button.dataset.quality));
      button.setAttribute('aria-pressed', String(button.dataset.quality === this.quality));
    });
    d.viewBtns.forEach((button) => button.addEventListener('click', () => this.setView(button.dataset.view)));
    d.difficultyButtons.forEach((button) => button.addEventListener('click', () => {
      this.setDifficulty(button.dataset.difficulty);
      button.blur();
    }));
    d.sensitivityInputs.forEach((input) => input.addEventListener('input', () => {
      this.settings.sensitivity = clamp(Number(input.value) / 100, 0.5, 1.5);
      this.input.sensitivity = this.settings.sensitivity;
      saveSettings(this.settings);
      this.syncSettingsUI();
    }));
    d.volumeInputs.forEach((input) => input.addEventListener('input', () => {
      this.settings.volume = clamp(Number(input.value) / 100, 0, 1);
      this.audio.setVolume(this.settings.volume);
      if (this.settings.volume > 0 && this.settings.muted) {
        this.settings.muted = false;
        this.audio.setMuted(false);
      }
      saveSettings(this.settings);
      this.syncSettingsUI();
    }));
    this.syncSettingsUI();

    d.startBtn.addEventListener('click', () => this.startRace());
    d.resumeBtn.addEventListener('click', () => this.setPaused(false));
    d.quitBtn.addEventListener('click', () => {
      this.state = 'ready';
      this.audio.suspend();
      this.resetRace();
      this.showScreen('start');
    });
    d.againBtn.addEventListener('click', () => {
      this.resetRace();
      this.showScreen(null);
      this.startCountdown();
    });
    d.backBtn.addEventListener('click', () => { window.location.href = 'RaceDay01.html'; });
    d.pauseBtn.addEventListener('click', () => this.togglePause());
    d.viewBtn.addEventListener('click', (event) => {
      this.toggleView();
      if (event.detail > 0) event.currentTarget.blur(); // 滑鼠點擊後仍可用 Space 手煞車
    });
    d.muteBtn.addEventListener('click', (event) => {
      if (this.settings.muted || this.settings.volume === 0) {
        this.settings.muted = false;
        if (this.settings.volume === 0) {
          this.settings.volume = DEFAULT_SETTINGS.volume;
          this.audio.setVolume(this.settings.volume);
        }
      } else {
        this.settings.muted = true;
      }
      this.audio.setMuted(this.settings.muted);
      saveSettings(this.settings);
      this.syncSettingsUI();
      if (event.detail > 0) event.currentTarget.blur();
    });

    // 觸控控制
    const touchZone = d.touchUi.querySelector('.touch-steer');
    let steerTouchId = null, steerOriginX = 0;
    const setSteerFromEvent = (e) => {
      const dx = e.clientX - steerOriginX;
      this.input.touchSteer = clamp(dx / 70, -1, 1);
    };
    touchZone.addEventListener('touchstart', (e) => {
      const tch = e.changedTouches[0];
      steerTouchId = tch.identifier;
      steerOriginX = tch.clientX;
      this.input.touchSteer = 0;
    }, { passive: true });
    touchZone.addEventListener('touchmove', (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === steerTouchId) setSteerFromEvent(tch);
      }
    }, { passive: true });
    const endSteer = (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === steerTouchId) { steerTouchId = null; this.input.touchSteer = 0; }
      }
    };
    touchZone.addEventListener('touchend', endSteer, { passive: true });
    touchZone.addEventListener('touchcancel', endSteer, { passive: true });

    const bindHold = (el, on, off) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off(); }, { passive: false });
      el.addEventListener('touchcancel', () => off(), { passive: true });
    };
    bindHold(d.touchUi.querySelector('.touch-gas'), () => { this.input.touchThrottle = true; }, () => { this.input.touchThrottle = false; });
    bindHold(d.touchUi.querySelector('.touch-brake'), () => { this.input.touchBrake = true; }, () => { this.input.touchBrake = false; });
  }

  showScreen(name) {
    const d = this.dom;
    d.loadScreen.classList.toggle('hidden', name !== 'loading');
    d.startScreen.classList.toggle('hidden', name !== 'start');
    d.pauseScreen.classList.toggle('hidden', name !== 'pause');
    d.finishScreen.classList.toggle('hidden', name !== 'finish');
    d.fallback.classList.toggle('hidden', name !== 'fallback');
    d.hud.classList.toggle('hidden', !(name === null && (this.state === 'racing' || this.state === 'countdown')));
  }

  showBanner(text, sub = '', duration = 1600) {
    const d = this.dom;
    d.bannerText.textContent = text;
    d.bannerSub.textContent = sub;
    d.banner.classList.remove('hidden');
    d.banner.classList.remove('animate');
    void d.banner.offsetWidth; // 重新觸發動畫
    d.banner.classList.add('animate');
    this.bannerDeadline = performance.now() + duration;
  }

  /* ---------- 賽事流程 ---------- */
  startRace() {
    this.audio.init();
    this.audio.resume();
    this.showScreen(null);
    this.startCountdown();
  }

  startCountdown() {
    this.flushPendingDifficulty();
    this.state = 'countdown';
    this.input.setActive(true);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.countdownT = 0;
    this.lightsLit = 0;
    this.lightsOut = false;
    this.setStartLights(0, false);
    this.dom.hud.classList.remove('hidden');
    this.audio.init();
    this.audio.resume();
  }

  /**
   * 發車格：pole 位於起跑線前，往後依序交錯左右排列，玩家固定排在最後一格。
   * 這樣名次從 P(對手數+1) 開始，整場比賽都有超車目標。
   */
  buildGrid() {
    const t = this.track;
    const field = this.activeAi ? this.activeAi.length : 0;
    const poleIdx = t.S - 12;
    const slots = [];
    for (let i = 0; i <= field; i++) {
      slots.push({ idx: (poleIdx - i * 7 + t.S * 2) % t.S, lateral: i % 2 === 0 ? -3.3 : 3.3 });
    }
    return slots;
  }

  resetRace() {
    this.input.setActive(false);
    this.chaseSnap = true;
    const t = this.track;
    const p = this.player;
    const grid = this.buildGrid();
    const slot = grid[grid.length - 1];      // 玩家：最後一格
    const c = t.points[slot.idx], r = t.rights[slot.idx];
    p.pos.set(c.x + r.x * slot.lateral, 0, c.z + r.z * slot.lateral);
    p.heading = t.yaws[slot.idx];
    p.vel.set(0, 0);
    p.speed = 0; p.fSpeed = 0; p.lSpeed = 0;
    p.rpm = CFG.idleRpm; p.gear = 1;
    p.nearestIdx = slot.idx;
    p.crossings = 0; p.laps = 0; p.lapStart = 0;
    p.finished = false; p.finishTime = Infinity;
    p.latG = 0; p.lonG = 0;
    p.offT = slot.lateral;
    p.progress = slot.idx / t.S;
    this.playerSim = {
      x: p.pos.x, z: p.pos.z, vx: 0, vz: 0, heading: p.heading, onTrack: true,
      fSpeed: 0, lSpeed: 0, speed: 0, latG: 0, lonG: 0, yawRate: 0,
    };
    this.raceTime = 0;
    this.lapTimes = [];
    this.bestLap = Infinity;
    this.penaltyMs = 0;
    this.jumpStart = false;
    this.slipstream = 0;
    this.drs = 0;
    this.drsActive = false;
    this.lastPosition = null;
    this.lightsLit = 0;
    this.lightsOut = false;
    this.countdownT = 0;
    this.lastCountSec = undefined;
    this.shake = 0; this.hitFlash = 0;

    this.ai.forEach((car, k) => {
      const s2 = grid[k] || slot;
      car.gridIdx = s2.idx;
      car.t = s2.idx / t.S;
      car.idx = s2.idx;
      car.lateral = s2.lateral;
      car.prevLateral = s2.lateral;
      car.targetLateral = t.racingLine[s2.idx];
      car.crossings = 0; car.laps = 0;
      car.speed = 0;
      car.progress = car.t;
      car.finished = false; car.finishTime = Infinity;
      car.launchDelay = 0;
      car.mistakeTimer = 0; car.mistakeScale = 1;
      car.blocked = 0; car.braking = false;
    });
    this.updateAiTransforms(true);
    this.buildStandingsBoard();
    this.updateHud(true);
  }

  togglePause() {
    if (this.state === 'racing' || this.state === 'countdown') this.setPaused(true);
    else if (this.state === 'paused') this.setPaused(false);
  }

  setPaused(paused) {
    if (paused && (this.state === 'racing' || this.state === 'countdown')) {
      this.prevState = this.state;
      this.state = 'paused';
      this.input.setActive(false);
      this.showScreen('pause');
      this.audio.suspend();
    } else if (!paused && this.state === 'paused') {
      this.state = this.prevState || 'racing';
      this.input.setActive(true);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.showScreen(null);
      this.dom.hud.classList.remove('hidden');
      this.audio.resume();
      this.clock.getDelta(); // 清除暫停期間累積的 dt
    }
  }

  /**
   * 完賽結算：以 `raceStandings()` 產生正式名次（完賽時間優先，其次即時投影進度），
   * 未完賽者以目前配速推算剩餘時間，輸出完整分類表與時間差。
   */
  finishRace() {
    this.state = 'finished';
    this.input.setActive(false);
    const p = this.player;
    p.finished = true;
    p.finishTime = this.raceTime + this.penaltyMs;
    p.progress = trackProgress(p.crossings, p.nearestIdx, this.track.S);
    const standings = this.computeStandings(true);
    const totalTime = this.lapTimes.reduce((a, b) => a + b, 0);
    const playerRow = standings.find((row) => row.isPlayer);
    const position = playerRow ? playerRow.position : standings.length;
    const gridPosition = this.activeAi.length + 1;

    const rows = standings.map((row) => {
      const gap = row.position === 1 ? (row.isPlayer ? 'WINNER' : formatGap(0)) : row.gapText;
      const time = row.finished
        ? fmtTime(row.finishTime)
        : fmtTime(row.projectedFinish);
      return `<div class="result-row${row.isPlayer ? ' is-you' : ''}">` +
        `<span class="rp">P${row.position}</span>` +
        `<i class="rdot" style="background:#${new THREE.Color(row.color).getHexString()}"></i>` +
        `<span class="rcode">${row.code}</span>` +
        `<span class="rname">${row.isPlayer ? '你（PLAYER）' : row.name}</span>` +
        `<span class="rtime">${row.finished || row.isPlayer ? time : `≈${time}`}</span>` +
        `<span class="rgap">${gap}</span></div>`;
    }).join('');

    const lapRows = this.lapTimes.map((ms, i) =>
      `<div class="stat-row"><span>LAP ${i + 1}</span><strong>${fmtTime(ms)}</strong></div>`
    ).join('');

    this.dom.finishStats.innerHTML =
      `<div class="stat-row big"><span>最終名次</span><strong>P${position} / ${standings.length}</strong></div>` +
      `<div class="stat-row"><span>發車位置</span><strong>P${gridPosition}${position < gridPosition ? ` ▲${gridPosition - position}` : position > gridPosition ? ` ▼${position - gridPosition}` : ''}</strong></div>` +
      `<div class="stat-row"><span>總時間${this.penaltyMs ? '（含罰秒）' : ''}</span><strong>${fmtTime(totalTime + this.penaltyMs)}</strong></div>` +
      (this.penaltyMs ? `<div class="stat-row penalty"><span>搶跑罰則</span><strong>+${(this.penaltyMs / 1000).toFixed(0)}s</strong></div>` : '') +
      `<div class="stat-row"><span>最佳單圈</span><strong>${fmtTime(this.bestLap)}</strong></div>` +
      lapRows +
      `<div class="classification"><span class="cls-head">CLASSIFICATION / 完賽分類</span>${rows}</div>`;
    this.showScreen('finish');
    this.dom.hud.classList.add('hidden');
    this.setStartLights(0, true);
    const podium = position <= 3;
    this.audio.blip(podium ? 1320 : 880, 0.5, podium ? 0.4 : 0.28);
    setTimeout(() => { if (this.state === 'finished') this.audio.suspend(); }, 700);
  }

  /* ---------- 主迴圈 ---------- */
  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.frame++;

    if (this.state === 'paused' || this.state === 'ready' || this.state === 'loading') {
      // 待機時仍渲染畫面（駕駛艙視角微動）
      if (this.state !== 'loading') {
        this.updateCamera(dt, true);
        this.render();
      }
      return;
    }

    this.input.poll(dt);

    if (this.state === 'countdown') {
      this.countdownT += dt;
      this.updateStartLights();
      // 離合器接合後即可催油門／蠕動（搶跑會被記罰）
      if (this.countdownT > 0.35) {
        this.physicsStep(dt, false);
        this.detectJumpStart();
      } else {
        const p = this.player;
        p.rpm = CFG.idleRpm + (3500 + Math.sin(this.countdownT * 9) * 2600) * this.input.throttle;
        this.updateGearRpm(dt, true);
      }
      this.updateCamera(dt);
      this.updateAudio(dt);
      this.updateHud();
      this.render();
      return;
    }

    if (this.state === 'racing') {
      this.raceTime += dt * 1000;
      this.physicsStep(dt, true);
      this.updateAI(dt);
      this.updateCamera(dt);
      this.updateAudio(dt);
      this.updateHud();
    } else if (this.state === 'finished') {
      this.raceTime += dt * 1000;   // 持續計時，讓後方車輛也能取得真實完賽時間
      this.updateAI(dt);
      this.updateCamera(dt, true);
      this.updateTyreFx(dt);
    }
    this.render();
  }

  /* ---------- 發車燈 ---------- */
  updateStartLights() {
    const lit = clamp(Math.floor(this.countdownT / START_LIGHT_INTERVAL), 0, START_LIGHT_COUNT);
    if (lit !== this.lightsLit) {
      this.lightsLit = lit;
      this.setStartLights(lit, false);
      this.audio.lightOn(false);
    }
    if (!this.lightsOut && this.countdownT >= START_LIGHTS_OUT_AT) {
      this.lightsOut = true;
      this.lightsLit = 0;
      this.setStartLights(0, true);
      this.audio.lightOn(true);
      this.showBanner('GO!', 'LIGHTS OUT AND AWAY WE GO', 1000);
      this.state = 'racing';
      this.player.lapStart = 0;
      this.raceTime = 0;
      // 各車依難度的反應時間起步
      const [lo, hi] = this.difficulty.reaction;
      for (const car of this.activeAi) car.launchDelay = lo + Math.random() * Math.max(0, hi - lo);
    }
  }

  setStartLights(lit, out) {
    const d = this.dom;
    if (!d.startLights) return;
    d.startLights.classList.toggle('hidden', !(this.state === 'countdown' || (out && this.state === 'racing')));
    d.startLights.classList.toggle('out', !!out);
    for (let i = 0; i < d.lightLeds.length; i++) d.lightLeds[i].classList.toggle('on', i < lit && !out);
  }

  detectJumpStart() {
    if (this.jumpStart || this.lightsOut) return;
    if (this.player.speed > 1.4) {
      this.jumpStart = true;
      this.penaltyMs += CFG.jumpStartPenaltyMs;
      this.showBanner('JUMP START', `+${CFG.jumpStartPenaltyMs / 1000}s PENALTY`, 2400);
      this.audio.blip(220, 0.4, 0.3);
    }
  }

  /* ---------- 玩家物理 ---------- */
  physicsStep(dt, countProgress = true) {
    const p = this.player;
    const sim = this.playerSim;
    sim.x = p.pos.x; sim.z = p.pos.z;
    sim.vx = p.vel.x; sim.vz = p.vel.y;
    sim.heading = p.heading; sim.onTrack = p.onTrack;

    const drag = this.computeDrag();
    vehicleStep(sim, {
      steer: this.input.steer,
      throttle: this.input.throttle,
      brake: this.input.brake,
      handbrake: this.input.handbrake,
      sensitivity: this.input.sensitivity,
    }, CFG, dt, drag);

    p.pos.x = sim.x; p.pos.z = sim.z;
    p.vel.set(sim.vx, sim.vz);
    p.heading = sim.heading;
    p.fSpeed = sim.fSpeed; p.lSpeed = sim.lSpeed;
    p.speed = sim.speed; p.latG = sim.latG; p.lonG = sim.lonG;

    // 賽道邊界與計圈
    this.trackCollision(dt, countProgress);

    // 與對手車的碰撞（依相對速度決定能量交換）
    for (const car of this.activeAi) {
      const ax = car.group.position.x - p.pos.x;
      const az = car.group.position.z - p.pos.z;
      const d2 = ax * ax + az * az;
      if (d2 < 13.5 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const nx = ax / d, nz = az / d;
        const overlap = 3.7 - d;
        p.pos.x -= nx * overlap * 0.55;
        p.pos.z -= nz * overlap * 0.55;
        car.lateral += (car.lateral > p.offT ? 1 : -1) * overlap * 0.16;
        const rel = Math.abs(p.fSpeed - car.speed);
        const loss = clamp(0.995 - rel * 0.0022, 0.9, 0.995);
        p.vel.multiplyScalar(loss);
        p.speed *= loss;
        car.speed *= clamp(1 - rel * 0.004, 0.9, 1);
        if (this.crashCooldown <= 0 && rel > 2.5) {
          this.shake = Math.max(this.shake, clamp(rel / 26, 0.3, 0.8));
          this.audio.crash(clamp(rel / 30, 0.2, 0.6));
          this.crashCooldown = 0.4;
        }
      }
    }
    this.crashCooldown -= dt;

    // 碰撞可能改變速度，換檔依實際前進速度而非橫滑或倒車速度
    const fwdX = Math.sin(p.heading), fwdZ = Math.cos(p.heading);
    p.fSpeed = p.vel.x * fwdX + p.vel.z * fwdZ;
    p.speed = Math.hypot(p.vel.x, p.vel.y);
    this.updateGearRpm(dt);
    this.updateTyreFx(dt);
  }

  /**
   * 尾流與 DRS：貼在前車正後方可降低空氣阻力（提高極速與加速）；
   * 低曲率直路且高速時 DRS 額外減阻。回傳傳給物理的 drag 係數（1 = 乾淨氣流）。
   */
  computeDrag() {
    const t = this.track;
    const p = this.player;
    const pt = p.nearestIdx / t.S;
    let best = 0;
    for (const car of this.activeAi) {
      let delta = car.t - pt;
      delta -= Math.round(delta);
      const dist = delta * t.totalLength;
      if (dist <= 0.5 || dist > 34) continue;
      best = Math.max(best, slipstreamAmount(dist, car.lateral - p.offT));
    }
    this.slipstream = best;
    const curvature = t.curvature[p.nearestIdx] || 0;
    this.drsActive = curvature < 0.0024 && p.fSpeed > 52;
    this.drs = this.drsActive ? CFG.drsDrag : 0;
    return clamp(1 - (best * CFG.slipstreamDrag + this.drs), 0.9, 1);
  }

  trackCollision(dt, countProgress = true) {
    const p = this.player;
    const t = this.track;
    const S = t.S;

    // 區域搜尋最近中心線取樣點
    let best = p.nearestIdx, bestD = Infinity;
    for (let k = -40; k <= 40; k++) {
      const i = (p.nearestIdx + k + S * 2) % S;
      const dx = t.points[i].x - p.pos.x;
      const dz = t.points[i].z - p.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    const prevIdx = p.nearestIdx;
    p.nearestIdx = best;

    const c = t.points[best], r = t.rights[best];
    const off = (p.pos.x - c.x) * r.x + (p.pos.z - c.z) * r.z; // 帶正負號橫向偏移
    p.offT = off;
    const edge = CFG.trackHalfWidth;
    const limit = edge + CFG.barrierOffset;

    p.onTrack = Math.abs(off) < edge;

    if (Math.abs(off) > limit - 0.3) {
      // 護欄碰撞：夾回 + 消能
      const clamped = Math.sign(off) * (limit - 0.3);
      p.pos.x = c.x + r.x * clamped;
      p.pos.z = c.z + r.z * clamped;
      const outward = (p.vel.x * r.x + p.vel.y * r.z) * Math.sign(off);
      if (outward > 2 && this.crashCooldown <= 0) {
        const intensity = clamp(outward / 22, 0.3, 1);
        p.vel.multiplyScalar(0.55);
        p.speed *= 0.55;
        this.shake = 1;
        this.hitFlash = 1;
        this.audio.crash(intensity);
        this.crashCooldown = 0.5;
        this.spawnTyreFx(p.pos.x, p.pos.z, 1.4, 'spark');
        this.showBanner('💥 碰撞！', 'CHECK YOUR LINE', 1200);
      } else if (outward > 0) {
        // 輕微擦碰：滑過護欄
        const alongX = p.vel.x - r.x * outward * Math.sign(off);
        const alongZ = p.vel.y - r.z * outward * Math.sign(off);
        p.vel.set(alongX * 0.97, alongZ * 0.97);
      }
    }

    /* 越線偵測：起跑格位於線後方，第一次越線＝計時開始 */
    const crossed = detectLapCrossing(prevIdx, best, S, p.speed);
    if (crossed && countProgress) {
      p.crossings++;
      const lapMs = this.raceTime - p.lapStart;
      p.lapStart = this.raceTime;
      if (p.crossings >= 2 && lapMs > 20000) {
        p.laps = p.crossings - 1;
        this.lapTimes.push(lapMs);
        if (lapMs < this.bestLap) {
          this.bestLap = lapMs;
          this.showBanner('⚡ 最快單圈', fmtTime(lapMs), 2200);
        } else {
          this.showBanner(`LAP ${p.laps} 完成`, fmtTime(lapMs), 1800);
        }
        this.audio.blip(990, 0.18, 0.3);
      }
    }
    /*
     * 名次進度必須在 crossings 更新「之後」計算。
     * 舊版先算 progress 再 ++crossings，導致完賽當下玩家進度整整少一圈，
     * 結算時永遠被判定在最後一名（P4）——這就是「不管排第幾都結算 P4」的成因。
     */
    p.progress = trackProgress(p.crossings, best, S);
    p.laps = Math.max(p.laps || 0, p.crossings - 1);

    if (countProgress && !p.finished && p.crossings >= crossingsToFinish(CFG.totalLaps)) {
      this.finishRace();
    }
  }

  updateGearRpm(dt, countdown = false) {
    const p = this.player;
    const gears = CFG.gears;
    const forwardSpeed = Math.max(0, p.fSpeed);
    const g = countdown ? 1 : selectAutomaticGear(forwardSpeed, p.gear, gears);
    if (g !== p.gear && !countdown) {
      const upshift = g > p.gear;
      this.audio.shiftBlip(upshift);
      if (upshift && this.input.throttle > 0.5) this.spawnTyreFx(p.pos.x, p.pos.z, 0.35);
    }
    p.gear = g;
    const lo = gears[g - 1], hi = gears[g] || CFG.topSpeed + 6;
    const gearN = clamp((forwardSpeed - lo) / Math.max(hi - lo, 1), 0, 1);
    const target = countdown
      ? p.rpm
      : CFG.idleRpm + gearN * (CFG.redlineRpm - CFG.idleRpm) * 0.96 + this.input.throttle * 320;
    p.rpm += (target - p.rpm) * Math.min(1, dt * (countdown ? 4 : 14));
  }

  /* ---------- AI 更新 ---------- */
  updateAI(dt) {
    const t = this.track;
    const p = this.player;
    // 玩家以同一份「中心線投影 + 橫向偏移」表示，讓 AI 的避車邏輯一致
    this.playerTraffic.t = p.nearestIdx / t.S;
    this.playerTraffic.lateral = p.offT;
    this.playerTraffic.speed = p.speed;
    const traffic = this.traffic;
    traffic.length = 0;
    for (const car of this.activeAi) traffic.push(car);
    traffic.push(this.playerTraffic);
    for (const car of this.activeAi) {
      const before = car.speed;
      car.prevLateral = car.lateral;
      aiStep(car, t, car.profile, t.racingLine, traffic, dt);
      car.braking = car.speed < before - 0.02;
      // 橫向變化率（每公尺），用於車身偏擺的可視化 yaw
      car.dlDs = (car.lateral - car.prevLateral) / Math.max(car.speed * dt, 0.4);
      if (!car.finished && car.crossings >= crossingsToFinish(CFG.totalLaps)) {
        car.finished = true;
        car.finishTime = this.raceTime;
        car.laps = CFG.totalLaps;
      } else {
        car.laps = Math.max(0, car.crossings - 1);
      }
    }
    this.updateAiTransforms();
  }

  updateAiTransforms(instant = false) {
    const t = this.track;
    for (const car of this.ai) {
      if (!car.active) { car.group.visible = false; continue; }
      car.group.visible = true;
      const i = ((car.idx % t.S) + t.S) % t.S;
      const c = t.points[i], r = t.rights[i];
      car.group.position.set(c.x + r.x * car.lateral, 0, c.z + r.z * car.lateral);
      // 依實際路徑方向計算 yaw：換道時車身會自然偏擺
      const dl = instant ? 0 : (car.dlDs || 0);
      const yaw = t.yaws[i] + Math.atan2(-clamp(dl, -0.6, 0.6), 1);
      car.group.rotation.y = yaw + Math.PI; // 模型車頭朝 -Z，需對齊樣條的前進方向
      const spin = (car.speed * 0.016) || 0;
      for (const w of car.wheels) w.rotation.x += spin;
      car.brakeLight.material.emissiveIntensity = car.braking ? 2.6 : 0.25;
      car.brakeLight.material.color.setHex(car.braking ? 0xff3a24 : 0x8d1a10);
    }
  }

  /**
   * 正式名次：以 race-sim 的 `raceStandings()` 排序，並計算時間差。
   * @param projectFinish 結算時把未完賽車輛以現況配速推算完賽時間
   */
  computeStandings(projectFinish = false) {
    const t = this.track;
    const p = this.player;
    const racers = [{
      id: 'player', code: p.code, name: p.name, color: p.color, isPlayer: true,
      progress: p.progress, laps: p.laps || 0, finished: p.finished,
      finishTime: p.finished ? p.finishTime : Infinity, speed: p.speed,
    }];
    for (const car of this.activeAi) {
      racers.push({
        id: car.id, code: car.code, name: car.name, color: car.color, isPlayer: false,
        progress: car.progress, laps: car.laps || 0, finished: car.finished,
        finishTime: car.finished ? car.finishTime : Infinity, speed: car.speed,
      });
    }
    const sorted = raceStandings(racers);
    const leader = sorted[0];
    sorted.forEach((row, i) => {
      if (i === 0) { row.gapSeconds = 0; row.gapLaps = 0; row.gapText = 'LEADER'; return; }
      const ahead = sorted[i - 1];
      let seconds = gapSeconds(ahead, row, t.totalLength);
      let laps = Math.max(0, Math.floor(ahead.progress - row.progress));
      if (projectFinish && !row.finished) {
        const remaining = Math.max(0, crossingsToFinish(CFG.totalLaps) - row.progress) * t.totalLength;
        row.projectedFinish = this.raceTime + (remaining / Math.max(row.speed, 24)) * 1000;
        if (leader.finished) seconds = (row.projectedFinish - leader.finishTime) / 1000;
      }
      row.gapSeconds = seconds;
      row.gapLaps = laps;
      row.gapText = formatGap(seconds, laps);
    });
    // 對領先者的時間差（供 HUD 顯示）
    for (const row of sorted) {
      row.toLeader = row.position === 1 ? 0 : gapSeconds(leader, row, t.totalLength);
    }
    return sorted;
  }

  computePosition() {
    const row = this.computeStandings().find((entry) => entry.isPlayer);
    return row ? row.position : this.activeAi.length + 1;
  }

  /* ---------- 相機 ---------- */
  updateCamera(dt, idle = false) {
    const p = this.player;
    const speedN = clamp(p.speed / CFG.topSpeed, 0, 1);
    const chase = this.settings.view === 'chase';
    const fov = (chase ? 66 : this.baseFov) + (REDUCED_MOTION ? 0 : speedN * (idle ? 4 : chase ? 10 : 20));
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();

    const targetRoll = clamp(-p.latG * 0.028, -0.05, 0.05);
    this.cameraRoll = lerp(this.cameraRoll || 0, REDUCED_MOTION ? 0 : targetRoll, 1 - Math.exp(-dt * 6));
    const bob = REDUCED_MOTION || idle ? 0 : speedN * speedN * 0.006;
    const bobY = Math.sin(this.frame * 0.21) * bob;
    const bobX = Math.cos(this.frame * 0.13) * bob * 0.6;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.6);
    const sh = REDUCED_MOTION ? 0 : this.shake;
    const shakeX = (Math.random() - 0.5) * sh * 0.16;
    const shakeY = (Math.random() - 0.5) * sh * 0.14;
    const forwardX = Math.sin(p.heading), forwardZ = Math.cos(p.heading);

    if (chase) {
      // 跟隨相機使用時間無關的阻尼，切換視角或重置時立即定位，避免穿越賽車。
      this.chaseDesired = this.chaseDesired || new THREE.Vector3();
      this.chaseLook = this.chaseLook || new THREE.Vector3();
      this.chaseTarget = this.chaseTarget || new THREE.Vector3();
      const distance = 7.9 + speedN * 1.1;
      this.chaseDesired.set(p.pos.x - forwardX * distance, 3.25 + speedN * 0.3, p.pos.z - forwardZ * distance);
      this.chaseTarget.set(p.pos.x + forwardX * 5.5, 0.8, p.pos.z + forwardZ * 5.5);
      if (this.chaseSnap || REDUCED_MOTION) {
        this.camera.position.copy(this.chaseDesired);
        this.chaseLook.copy(this.chaseTarget);
        this.chaseSnap = false;
      } else {
        this.camera.position.lerp(this.chaseDesired, 1 - Math.exp(-dt * 6));
        this.chaseLook.lerp(this.chaseTarget, 1 - Math.exp(-dt * 8));
      }
      this.camera.position.x += shakeX * 0.4;
      this.camera.position.y += shakeY * 0.4;
      this.camera.lookAt(this.chaseLook);
      this.camera.rotateZ(this.cameraRoll * 0.3);
      this.camYaw = p.heading + Math.PI;
    } else {
      // 駕駛艙視點：車中心後方 0.42m；預視方向與實際轉向一致。
      this.camera.position.set(p.pos.x - forwardX * 0.42 + shakeX + bobX, 1.06 + bobY + shakeY, p.pos.z - forwardZ * 0.42);
      const steerPeek = this.input.steer * this.input.sensitivity * (5 + speedN * 7);
      this.camYaw = p.heading - steerPeek * 0.02 + Math.PI;
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(this.camYaw);
      this.camera.rotateX(shakeY * 0.5 + bobY * 0.4);
      this.camera.rotateZ(this.cameraRoll + shakeX);
    }

    // 駕駛艙與追車模型共享同一套方向和速度。
    const steerVis = clamp(this.input.steer * this.input.sensitivity, -1, 1);
    const wheelDt = idle ? 0 : dt;
    this.steerWheel.rotation.z = -steerVis * 2.6;
    for (let i = 0; i < this.wheelPivots.length; i++) {
      this.wheelPivots[i].rotation.y = -steerVis * 0.34;
      this.frontWheels[i].rotation.x -= p.fSpeed * wheelDt * 2.8;
    }
    this.playerCar.position.set(p.pos.x, 0, p.pos.z);
    this.playerCar.rotation.y = p.heading + Math.PI;
    for (const pivot of this.playerFrontPivots) pivot.rotation.y = -steerVis * 0.34;
    for (const wheel of this.playerWheels) wheel.rotation.x -= p.fSpeed * wheelDt / 0.43;
    this.playerBrakeLight.material.color.setHex(this.input.brake > 0.08 ? 0xff4132 : 0xb41f16);

    // 換檔燈
    const rpmN = clamp((p.rpm - CFG.idleRpm) / (CFG.redlineRpm - CFG.idleRpm), 0, 1);
    for (let i = 0; i < this.ledMeshes.length; i++) {
      const led = this.ledMeshes[i];
      const th = 0.55 + (i / this.ledMeshes.length) * 0.42;
      const blink = rpmN > 0.94 ? (Math.sin(this.frame * 0.9) > 0 ? 1 : 0.15) : 1;
      if (rpmN > th) {
        led.material.color.set(i < 4 ? 0x3dff6e : i < 6 ? 0xffd23d : 0xff3b30);
        led.material.color.multiplyScalar(blink);
      } else {
        led.material.color.set(0x141714);
      }
    }

    // 雲緩慢面向相機
    if (this.clouds) for (const c of this.clouds) c.lookAt(this.camera.position.x, c.position.y, this.camera.position.z);
  }

  updateAudio(dt) {
    const p = this.player;
    const rpmN = clamp((p.rpm - CFG.idleRpm) / (CFG.redlineRpm - CFG.idleRpm), 0, 1);
    const slip = clamp(Math.abs(p.lSpeed) / 13, 0, 1) * (this.input.handbrake ? 1.4 : 1);
    // 轉速限制器：油門全開且逼近紅線時斷油
    const limiter = clamp((p.rpm - CFG.redlineRpm * 0.965) / (CFG.redlineRpm * 0.035), 0, 1)
      * (this.input.throttle > 0.5 ? 1 : 0);
    this.audio.update(dt, {
      rpmNorm: rpmN,
      throttle: this.input.throttle,
      speedNorm: clamp(p.speed / CFG.topSpeed, 0, 1),
      slip, onTrack: p.onTrack, limiter,
      rival: this.nearestRivalAudio(),
    });
  }

  /** 最近對手車的多普勒音效參數：音高由徑向相對速度決定，pan 由相機座標系方位決定 */
  nearestRivalAudio() {
    const p = this.player;
    const t = this.track;
    let best = null, bestD = Infinity;
    for (const car of this.activeAi) {
      const dx = car.group.position.x - p.pos.x;
      const dz = car.group.position.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = { car, dx, dz, d }; }
    }
    if (!best || best.d > 150) return null;
    const yaw = t.yaws[((best.car.idx % t.S) + t.S) % t.S];
    const carVx = Math.sin(yaw) * best.car.speed, carVz = Math.cos(yaw) * best.car.speed;
    const nx = best.dx / (best.d || 1), nz = best.dz / (best.d || 1);
    const radial = (carVx - p.vel.x) * nx + (carVz - p.vel.y) * nz;  // <0 表示接近
    const camYaw = this.camYaw || p.heading + Math.PI;
    const rightX = Math.cos(camYaw), rightZ = -Math.sin(camYaw);
    const pan = best.dx * rightX + best.dz * rightZ;
    const proximity = Math.pow(clamp(1 - best.d / 150, 0, 1), 1.5);
    return {
      level: proximity * (0.45 + 0.55 * clamp(best.car.speed / CFG.topSpeed, 0, 1)),
      pan: clamp(pan / (best.d || 1), -1, 1),
      doppler: -radial,
    };
  }

  /* ---------- HUD ---------- */
  updateHud(force = false) {
    if (!force && this.frame % 3 !== 0) return;
    const d = this.dom, p = this.player;

    d.speed.textContent = String(Math.round(p.speed * 3.6)).padStart(3, '0');
    d.gear.textContent = p.fSpeed < -0.5 ? 'R' : String(p.gear);
    const rpmN = clamp((p.rpm - CFG.idleRpm) / (CFG.redlineRpm - CFG.idleRpm), 0, 1);
    d.rpmFill.style.width = `${rpmN * 100}%`;
    d.rpmFill.style.background = rpmN > 0.85 ? '#ff4c38' : rpmN > 0.65 ? '#ffd23d' : '#d8ff3e';

    d.lapCur.textContent = String(clamp((p.laps || 0) + 1, 1, CFG.totalLaps));
    d.lapTime.textContent = fmtTime(this.raceTime - p.lapStart);
    d.lastTime.textContent = this.lapTimes.length ? fmtTime(this.lapTimes[this.lapTimes.length - 1]) : '--:--.---';
    d.bestTime.textContent = fmtTime(this.bestLap);
    d.raceClock.textContent = fmtTime(this.raceTime);

    // 名次與計時塔（正式計時排序：完賽時間優先，其次中心線投影進度）
    const standings = this.computeStandings();
    this.standings = standings;
    const myRow = standings.find((row) => row.isPlayer);
    const pos = myRow ? myRow.position : standings.length;
    d.position.textContent = `P${pos}`;
    d.posBox.dataset.pos = String(pos);
    this.updateTower(standings);
    if (d.gapAhead) d.gapAhead.textContent = myRow && myRow.position > 1 ? myRow.gapText : 'LEADER';
    if (d.gapBehind) {
      const behind = standings[pos];
      d.gapBehind.textContent = behind ? formatGap(behind.gapSeconds) : '--';
    }
    if (this.state === 'racing' && this.lastPosition !== null && pos !== this.lastPosition) {
      const gained = this.lastPosition - pos;
      const neighbour = gained > 0 ? standings[pos - 1] : standings[pos + 1];
      this.showBanner(`P${pos}`, gained > 0
        ? `超車 ${neighbour ? neighbour.code : ''} ▲${gained}`
        : `被超車 ${neighbour ? neighbour.code : ''} ▼${-gained}`, 1300);
      this.audio.blip(gained > 0 ? 1180 : 330, 0.18, 0.32);
    }
    this.lastPosition = pos;

    // 尾流 / DRS 指示
    if (d.boostChip) {
      const slip = this.slipstream > 0.28;
      const drs = this.drsActive && this.state === 'racing';
      d.boostChip.classList.toggle('hidden', !(slip || drs));
      d.boostChipLabel.textContent = slip && drs ? 'DRS + SLIPSTREAM' : slip ? 'SLIPSTREAM' : 'DRS OPEN';
      d.boostChip.dataset.kind = slip ? 'slip' : 'drs';
    }
    if (d.penaltyChip) {
      d.penaltyChip.classList.toggle('hidden', this.penaltyMs <= 0);
      d.penaltyChip.textContent = `+${(this.penaltyMs / 1000).toFixed(0)}s JUMP START`;
    }

    // 換檔指示燈（DOM 燈條）
    for (let i = 0; i < d.shiftLeds.length; i++) {
      const el = d.shiftLeds[i];
      const th = 0.55 + (i / d.shiftLeds.length) * 0.42;
      let cls = '';
      if (rpmN > th) cls = i < 4 ? 'on-green' : i < 6 ? 'on-yellow' : 'on-red';
      if (rpmN > 0.94 && cls && Math.sin(this.frame * 0.9) < 0) cls = '';
      el.className = `shift-led ${cls}`.trim();
    }

    d.pedalGas.style.height = `${this.input.throttle * 100}%`;
    d.pedalBrake.style.height = `${(this.input.brake || (this.input.handbrake ? 1 : 0)) * 100}%`;

    this.drawMinimap(pos);
    this.drawGMeter();
    if (this.settings.view === 'cockpit') this.drawGauges();

    if (this.bannerDeadline && performance.now() >= this.bannerDeadline) {
      d.banner.classList.add('hidden');
      this.bannerDeadline = 0;
    }
    d.hitFlash.style.opacity = String(REDUCED_MOTION ? 0 : this.hitFlash * 0.55);
  }

  drawMinimap() {
    const ctx = this.minimapCtx;
    const W = this.dom.minimap.width, H = this.dom.minimap.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(241,245,235,.22)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.minimapPath.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.stroke();
    // 玩家
    const [px, py] = this.minimapToCanvas(this.player.pos);
    ctx.fillStyle = '#d8ff3e';
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(216,255,62,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.stroke();
    // 賽車線（最佳路線提示）
    if (this.minimapLine) {
      ctx.strokeStyle = 'rgba(216,255,62,.26)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      this.minimapLine.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.stroke();
    }
    // AI 對手
    for (const car of this.activeAi) {
      const [ax, ay] = this.minimapToCanvas(car.group.position);
      ctx.fillStyle = '#' + new THREE.Color(car.color).getHexString();
      ctx.beginPath(); ctx.arc(ax, ay, 3.4, 0, TAU); ctx.fill();
    }
  }

  /** 計時塔：完整名次、塗裝色、車手代號與時間差 */
  updateTower(standings) {
    if (!this.towerRows) return;
    for (let i = 0; i < this.towerRows.length; i++) {
      const row = this.towerRows[i];
      const entry = standings[i];
      if (!entry) { row.el.classList.add('hidden'); continue; }
      row.el.classList.remove('hidden');
      const you = entry.isPlayer;
      row.el.classList.toggle('is-you', you);
      row.el.classList.toggle('is-leader', i === 0);
      row.pos.textContent = `P${entry.position}`;
      row.code.textContent = you ? 'YOU' : entry.code;
      row.dot.style.background = `#${new THREE.Color(entry.color).getHexString()}`;
      row.gap.textContent = i === 0 ? 'LEADER' : formatGap(entry.gapSeconds, entry.gapLaps);
    }
  }

  buildStandingsBoard() {
    const d = this.dom;
    if (!d.tower) return;
    d.tower.innerHTML = '';
    this.towerRows = [];
    const count = this.activeAi.length + 1;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'tower-row';
      el.innerHTML = '<span class="tp"></span><i class="tdot"></i><span class="tcode"></span><span class="tgap"></span>';
      d.tower.appendChild(el);
      this.towerRows.push({
        el,
        pos: el.querySelector('.tp'),
        dot: el.querySelector('.tdot'),
        code: el.querySelector('.tcode'),
        gap: el.querySelector('.tgap'),
      });
    }
  }

  drawGMeter() {
    const ctx = this.gmeterCtx;
    const W = this.dom.gMeter.width, H = this.dom.gMeter.height;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 3;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(241,245,235,.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    const g = 3;
    const x = cx + clamp(this.player.latG / g, -1, 1) * R;
    const y = cy + clamp(-this.player.lonG / g, -1, 1) * R;
    ctx.fillStyle = '#d8ff3e';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
  }

  /* ---------- 胎煙 / 塵土 / 火花粒子 ---------- */
  /**
   * 以單一 THREE.Points + 自訂 ShaderMaterial 實作粒子池：
   * per-particle 大小／顏色／透明度透過 attribute 傳入 GPU，
   * CPU 端只做 260 筆的歐拉積分，零幾何重建、零額外 Draw Call。
   */
  buildTyreFx() {
    const COUNT = 260;
    this.fxCount = COUNT;
    this.fxCursor = 0;
    this.fxLife = new Float32Array(COUNT);
    this.fxMax = new Float32Array(COUNT);
    this.fxVel = new Float32Array(COUNT * 3);
    this.fxSize = new Float32Array(COUNT);
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const alphas = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) positions[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { uScale: { value: innerHeight * 0.5 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        varying float vAlpha;
        void main(){
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.08, d) * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    this.fxPoints = new THREE.Points(geo, mat);
    this.fxPoints.frustumCulled = false;
    this.scene.add(this.fxPoints);
  }

  spawnTyreFx(x, z, amount = 1, kind = 'smoke') {
    if (!this.fxPoints || REDUCED_MOTION) return;
    const geo = this.fxPoints.geometry;
    const pos = geo.attributes.position.array;
    const col = geo.attributes.aColor.array;
    const alpha = geo.attributes.aAlpha.array;
    const size = geo.attributes.aSize.array;
    const n = Math.round((kind === 'spark' ? 9 : 4) * amount);
    for (let k = 0; k < n; k++) {
      const i = this.fxCursor;
      this.fxCursor = (this.fxCursor + 1) % this.fxCount;
      const jitterX = (Math.random() - 0.5) * 1.9;
      const jitterZ = (Math.random() - 0.5) * 1.9;
      pos[i * 3] = x + jitterX;
      pos[i * 3 + 1] = kind === 'spark' ? 0.35 + Math.random() * 0.4 : 0.28 + Math.random() * 0.3;
      pos[i * 3 + 2] = z + jitterZ;
      this.fxVel[i * 3] = jitterX * (kind === 'spark' ? 5 : 1.1);
      this.fxVel[i * 3 + 1] = kind === 'spark' ? 2.4 + Math.random() * 3 : 0.9 + Math.random() * 1.2;
      this.fxVel[i * 3 + 2] = jitterZ * (kind === 'spark' ? 5 : 1.1);
      this.fxMax[i] = kind === 'spark' ? 0.32 + Math.random() * 0.2 : 0.55 + Math.random() * 0.5;
      this.fxLife[i] = this.fxMax[i];
      this.fxSize[i] = kind === 'spark' ? 0.06 + Math.random() * 0.05 : 1.5 + Math.random() * 1.5;
      if (kind === 'spark') { col[i * 3] = 1; col[i * 3 + 1] = 0.72 + Math.random() * 0.25; col[i * 3 + 2] = 0.24; }
      else if (kind === 'dust') { col[i * 3] = 0.46; col[i * 3 + 1] = 0.40; col[i * 3 + 2] = 0.27; }
      else { const g = 0.78 + Math.random() * 0.16; col[i * 3] = g; col[i * 3 + 1] = g; col[i * 3 + 2] = g * 0.98; }
      alpha[i] = kind === 'spark' ? 0.95 : 0.42;
      size[i] = this.fxSize[i];
    }
  }

  updateTyreFx(dt) {
    if (!this.fxPoints) return;
    const p = this.player;
    // 產生：漂移、打滑、草地與護欄火花
    if (this.state === 'racing' || this.state === 'countdown') {
      const slip = Math.abs(p.lSpeed);
      const spin = this.input.throttle > 0.85 && p.fSpeed < 14 && p.fSpeed >= 0;
      if (p.onTrack && (slip > 4.2 || spin)) {
        this.spawnTyreFx(p.pos.x, p.pos.z, clamp((slip - 3) / 9 + (spin ? 0.7 : 0), 0.3, 1.6), 'smoke');
      } else if (!p.onTrack && p.speed > 8) {
        this.spawnTyreFx(p.pos.x, p.pos.z, clamp(p.speed / 42, 0.3, 1.2), 'dust');
      }
    }
    const geo = this.fxPoints.geometry;
    const pos = geo.attributes.position.array;
    const alpha = geo.attributes.aAlpha.array;
    const size = geo.attributes.aSize.array;
    let live = 0;
    for (let i = 0; i < this.fxCount; i++) {
      if (this.fxLife[i] <= 0) { alpha[i] = 0; continue; }
      this.fxLife[i] -= dt;
      const k = i * 3;
      this.fxVel[k + 1] -= 2.2 * dt;                       // 重力／消散
      this.fxVel[k] *= 1 - 1.6 * dt;
      this.fxVel[k + 2] *= 1 - 1.6 * dt;
      pos[k] += this.fxVel[k] * dt;
      pos[k + 1] += this.fxVel[k + 1] * dt;
      pos[k + 2] += this.fxVel[k + 2] * dt;
      if (pos[k + 1] < 0.05) { pos[k + 1] = 0.05; this.fxVel[k + 1] *= -0.18; }
      const ratio = Math.max(0, this.fxLife[i] / this.fxMax[i]);
      alpha[i] = ratio * ratio * (this.fxSize[i] < 0.2 ? 0.95 : 0.40);
      size[i] = this.fxSize[i] * (1 + (1 - ratio) * 1.9);   // 煙霧擴散
      live++;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    this.fxPoints.visible = live > 0;
    this.fxPoints.material.uniforms.uScale.value = innerHeight * 0.5;
  }

  /* ---------- 渲染 ---------- */
  render() {
    const highFx = this.quality === 'high';

    // 後視鏡（僅高畫質、隔幀更新）
    if (highFx && this.settings.view === 'cockpit' && this.mirrorMeshes.length && this.frame % 2 === 0) {
      this.cockpit.visible = false;
      const wPos = this.mirrorWorldPos || (this.mirrorWorldPos = new THREE.Vector3());
      this.camera.getWorldPosition(wPos);
      const yawBack = (this.camYaw || Math.PI) + Math.PI; // 回望車尾方向
      this.mirrorCam.position.copy(wPos);
      this.mirrorCam.position.y += 0.05;
      this.mirrorCam.rotation.set(0, yawBack, 0);
      this.mirrorCam.updateMatrixWorld();
      this.renderer.setRenderTarget(this.mirrorRT);
      this.renderer.render(this.scene, this.mirrorCam);
      this.renderer.setRenderTarget(null);
      this.cockpit.visible = true;
    }

    if (highFx) {
      this.renderer.setRenderTarget(this.rt);
      this.renderer.render(this.scene, this.camera);
      // 明亮通道 → 1/4 解析度 Bloom RT
      this.bloomMat.uniforms.tDiffuse.value = this.rt.texture;
      this.renderer.setRenderTarget(this.bloomRT);
      this.renderer.render(this.bloomScene, this.postCam);
      this.renderer.setRenderTarget(null);
      this.postMat.uniforms.tBloom.value = this.bloomRT.texture;
      this.postMat.uniforms.uBloom.value = REDUCED_MOTION ? 0.42 : 0.62;
      this.postMat.uniforms.uTime.value = performance.now() * 0.001;
      this.postMat.uniforms.uSpeed.value = REDUCED_MOTION ? 0 : clamp(this.player.speed / CFG.topSpeed, 0, 1) * (this.state === 'racing' ? 1 : 0.15);
      this.postMat.uniforms.uHit.value = REDUCED_MOTION ? 0 : this.hitFlash;
      this.renderer.render(this.postScene, this.postCam);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

/* ================================================================
 * 5. 啟動
 * ============================================================== */
const game = new CockpitRacer();
game.init().catch((err) => {
  console.error('[CockpitRacer] init failed:', err);
  window.cockpitLoadError(err);
});
