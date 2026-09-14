// 无头冒烟测试：把 js/ 复制成 .hcheck/js（补全 .js 后缀），用 wx stub 跑真实主循环
// 用法：node tools/headless_check.mjs [秒数]
// 检查项：贴图是否全部加载绘制、旋转是否生效、ctx 参数是否出现 NaN、循环是否抛错
import fs from 'fs';
import path from 'path';
import { prepareCopy, fileUrl } from './prepare_copy.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENT = path.join(ROOT, 'images', 'entity');
const SRC = path.join(ROOT, 'js');
const COPY = path.join(ROOT, '.hcheck', 'js');

function pngSize(file) {
  try {
    const b = fs.readFileSync(path.join(ENT, file));
    if (b.length > 24 && b.readUInt32BE(12) === 0x49484452) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch (e) { /* 贴图缺失就按未加载处理，走回退分支 */ }
  return { w: 0, h: 0 };
}

let now = 1700000000000;
Date.now = () => now;

const errors = [];
const drawnSrc = new Set();
const fillStyles = new Set();
let rotateCalls = 0;
let nonFinite = 0;

function makeCtx() {
  const state = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', shadowBlur: 0, shadowColor: '',
  };
  const check = (name, args) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) {
        nonFinite++;
        errors.push(`non-finite arg in ctx.${name}(${args.join(',')})`);
        return;
      }
    }
  };
  const methods = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, setLineDash() {},
    translate(...a) { check('translate', a); },
    rotate(...a) { check('rotate', a); rotateCalls++; },
    scale(...a) { check('scale', a); },
    transform(...a) { check('transform', a); },
    setTransform(...a) { check('setTransform', a); },
    moveTo(...a) { check('moveTo', a); },
    lineTo(...a) { check('lineTo', a); },
    arc(...a) { check('arc', a); },
    ellipse(...a) { check('ellipse', a); },
    rect(...a) { check('rect', a); },
    roundRect(...a) { check('roundRect', a); },
    quadraticCurveTo(...a) { check('quadraticCurveTo', a); },
    bezierCurveTo(...a) { check('bezierCurveTo', a); },
    arcTo(...a) { check('arcTo', a); },
    fillRect(...a) { check('fillRect', a); },
    strokeRect(...a) { check('strokeRect', a); },
    clearRect(...a) { check('clearRect', a); },
    fillText(t, ...a) { check('fillText', a); },
    strokeText(t, ...a) { check('strokeText', a); },
    measureText() { return { width: 10 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
    drawImage(img, ...a) {
      check('drawImage', a);
      if (img && img.__src) drawnSrc.add(img.__src);
    },
  };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return methods[k];
    },
    set(t, k, v) {
      if (k === 'fillStyle' && typeof v === 'string') fillStyles.add(v);
      t[k] = v;
      return true;
    },
  });
}

const ctx = makeCtx();
const canvas = { width: 390, height: 844, getContext: () => ctx, toDataURL: () => '' };
const touchHandlers = { start: [], move: [], end: [], cancel: [] };
const store = new Map();
const winInfo = () => ({ windowWidth: 390, windowHeight: 844, safeArea: { top: 47 }, pixelRatio: 2 });

globalThis.wx = {
  createCanvas: () => canvas,
  getWindowInfo: winInfo,
  getSystemInfoSync: winInfo,
  createImage: () => {
    const img = { width: 0, height: 0, onload: null, onerror: null, __src: '' };
    Object.defineProperty(img, 'src', {
      set(v) {
        img.__src = v;
        const s = pngSize(String(v).split('/').pop());
        img.width = s.w;
        img.height = s.h;
        Promise.resolve().then(() => { if (img.onload) img.onload(); });
      },
      get() { return img.__src; },
    });
    return img;
  },
  onTouchStart: (fn) => touchHandlers.start.push(fn),
  onTouchMove: (fn) => touchHandlers.move.push(fn),
  onTouchEnd: (fn) => touchHandlers.end.push(fn),
  onTouchCancel: (fn) => touchHandlers.cancel.push(fn),
  offTouchStart() {}, offTouchMove() {}, offTouchEnd() {}, offTouchCancel() {},
  setStorageSync: (k, v) => store.set(k, v),
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  vibrateShort() {},
};

let rafQueue = [];
globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
globalThis.cancelAnimationFrame = () => {};

const DT = 1 / 60;
function step() {
  now += Math.round(DT * 1000);
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
}
function fire(kind, e) {
  for (const fn of touchHandlers[kind]) fn(e);
}
function touch(x, y, id) {
  return { touches: [{ clientX: x, clientY: y, identifier: id }], changedTouches: [{ clientX: x, clientY: y, identifier: id }], timeStamp: now };
}

prepareCopy(SRC, COPY);

const mainMod = await import(fileUrl(path.join(COPY, 'main.js')));
const databusMod = await import(fileUrl(path.join(COPY, 'databus.js')));
const databus = new databusMod.default();

const main = new mainMod.default();
main.startRequested = true;
step();

fire('start', touch(300, 620, 1));
fire('move', touch(340, 590, 1));

const seconds = Number(process.argv[2] || 60);
const frames = Math.round(seconds / DT);
let sawFlash = false;
let playerSpriteSrc = '';

for (let i = 0; i < frames; i++) {
  const p = databus.player;
  if (p) p.hp = p.maxHp;
  const up = databus.upgradeScreen;
  if (up && up.visible && !up.selectAnim) {
    up.pick(0);
    databus.isPaused = false;
  }
  step();
  if (p && p.img) playerSpriteSrc = p.img.__src;
  if (fillStyles.has('rgba(255,238,170,0.95)')) sawFlash = true;
  if (i % 1800 === 0) {
    console.log(`t=${(i * DT).toFixed(0)}s lvl=${p && p.level} enemies=${databus.enemys.length} kills=${p && p.kills}`);
  }
}

console.log('---');
console.log('drawn textures:', [...drawnSrc].sort().join(', ') || '(none)');
console.log('player texture:', playerSpriteSrc, '| rotate calls:', rotateCalls, '| muzzle flash:', sawFlash);
console.log('non-finite ctx args:', nonFinite, '| errors:', errors.length);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
