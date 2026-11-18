// 音效：WebAudio 程序化合成，零素材。微生物主题 = 湿 / 黏 / 气泡 / 膜。
// ★全项目没有事件总线（见 spawner.js 注释），所以音效同振动那条路：直接挂在各结算点上，
//   由调用方 playSfx(name)，本模块只负责合成 + 节流 + 优先级 + 并发上限。
// ★开关读 settings.sound（storage 的实时共享对象），首页「音效」行改写后立即生效。
// ★首次手势解锁：浏览器/微信的 autoplay 策略要求用户手势后才能出声，unlockAudio() 挂在触点上。
import { settings } from '../storage';

let ctx = null;
let master = null;
let noiseBuf = null;

// 节流间隔（毫秒）：密集战斗每帧几十次命中/击杀，不限流就是一锅噪声。
// 高优先音（暴击/升级/Boss/膜/结算）不走这张表，天然低频或签名级，不该被压。
const MIN_GAP = { shoot: 40, hit: 80, kill: 80, xp: 60 };
const HIGH = {
  crit: 1, levelup: 1, chest: 1, bossSpawn: 1, bossDeath: 1,
  membrane: 1, gameover: 1, victory: 1,
};
const VOICE_CAP = 8; // 同时发声上限：超出丢低优先战斗音，高优先不受限

const last = {};      // name -> 上次发声的 Date.now()
let voices = [];      // 未过期的发声到期时刻（Date.now() 毫秒），play 时清理，不用 setTimeout
let xpCombo = 0;      // 拾取经验连拾计数：音高随连拾递增，间隔久了归零
let xpLast = 0;

function ensure() {
  if (ctx) return ctx;
  if (typeof wx === 'undefined' || typeof wx.createWebAudioContext !== 'function') return null;
  ctx = wx.createWebAudioContext();
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 1.0);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// 首次触摸调用：创建/恢复上下文。play 内部也会兜底 ensure，但帧驱动的首声可能早于手势，
// 那时浏览器仍静音——所以触点上的 unlock 才是真正开声的那一下。
export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended' && typeof c.resume === 'function') c.resume();
}

function now() { return ctx.currentTime; }

// 单音：振荡器 + 频率滑移 + 包络，可串低通
function tone(o) {
  const t = now() + (o.at || 0);
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
  const g = ctx.createGain();
  const peak = o.gain == null ? 0.3 : o.gain;
  const atk = o.attack == null ? 0.005 : o.attack;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  let node = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    node.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
  return o.dur;
}

// 噪声 burst：湿「噗叽」/「嘶」的底料，带通/低通扫频
function noise(o) {
  const t = now() + (o.at || 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = o.filter || 'bandpass';
  f.frequency.setValueAtTime(o.f0 || 800, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t + o.dur);
  f.Q.value = o.Q == null ? 1 : o.Q;
  const g = ctx.createGain();
  const peak = o.gain == null ? 0.2 : o.gain;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (o.attack == null ? 0.004 : o.attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + o.dur + 0.02);
  return o.dur;
}

// 16 核心音。每个返回总时长（秒），供并发计数。
const SFX = {
  shoot() { // 清脆「啪」枪械感：毫秒级高频裂口 + 机械 click + 短 snap + 一点低膛体。
    // ★脆度来自 attack 0.001 和高通裂口：旧版 420→150 三角 + lp1200 + 5ms 起音，能量全在低频、 onset 慢 = 沉闷
    noise({ filter: 'highpass', f0: 2600, f1: 900, dur: 0.055, gain: 0.24, Q: 0.7, attack: 0.001 });
    tone({ type: 'square', f0: 2400, f1: 700, dur: 0.03, gain: 0.07, attack: 0.001 });
    tone({ type: 'triangle', f0: 900, f1: 220, dur: 0.05, gain: 0.12, attack: 0.001, lp: 3000 });
    tone({ type: 'sine', f0: 210, f1: 85, dur: 0.06, gain: 0.09 });
    return 0.07;
  },
  hit() { // 极轻「噗叽」
    return noise({ f0: 900, f1: 400, dur: 0.045, gain: 0.09, Q: 1.2 });
  },
  crit() { // 亮「啵/叮」
    tone({ type: 'triangle', f0: 880, f1: 1500, dur: 0.1, gain: 0.26 });
    return noise({ f0: 3000, f1: 1800, dur: 0.04, gain: 0.1, Q: 2 });
  },
  hurt() { // 闷「咚」
    tone({ type: 'sine', f0: 190, f1: 70, dur: 0.16, gain: 0.34, lp: 600 });
    return noise({ filter: 'lowpass', f0: 500, f1: 160, dur: 0.12, gain: 0.14 });
  },
  blast() { // 更重「咚」
    tone({ type: 'sine', f0: 150, f1: 48, dur: 0.24, gain: 0.42, lp: 500 });
    return noise({ filter: 'lowpass', f0: 700, f1: 120, dur: 0.2, gain: 0.2 });
  },
  kill() { // 湿「啵」破裂
    tone({ type: 'sine', f0: 520, f1: 120, dur: 0.08, gain: 0.24 });
    return noise({ f0: 1600, f1: 500, dur: 0.07, gain: 0.12, Q: 0.9 });
  },
  xp(step) { // 轻「咕」，连拾升调
    const base = 560 * Math.pow(1.06, Math.min(step || 0, 12));
    return tone({ type: 'sine', f0: base, f1: base * 1.5, dur: 0.07, gain: 0.16 });
  },
  levelup() { // 上行「叮铃」三音
    tone({ type: 'triangle', f0: 660, dur: 0.12, gain: 0.24, at: 0 });
    tone({ type: 'triangle', f0: 880, dur: 0.12, gain: 0.24, at: 0.1 });
    tone({ type: 'triangle', f0: 1320, dur: 0.22, gain: 0.26, at: 0.2 });
    return 0.42;
  },
  pick() { // 确认「嗒」
    return tone({ type: 'square', f0: 520, f1: 480, dur: 0.05, gain: 0.16, lp: 2000 });
  },
  chest() { // 「咔—啵」开匣
    noise({ f0: 2600, f1: 1200, dur: 0.05, gain: 0.14, Q: 1.5 });
    tone({ type: 'sine', f0: 300, f1: 620, dur: 0.16, gain: 0.24, at: 0.05 });
    return 0.21;
  },
  bossSpawn() { // 低鸣「嗡——」预警
    tone({ type: 'sawtooth', f0: 78, f1: 120, dur: 0.6, gain: 0.2, attack: 0.12, lp: 400 });
    tone({ type: 'sine', f0: 156, f1: 240, dur: 0.6, gain: 0.1, attack: 0.15 });
    return 0.6;
  },
  bossDeath() { // 大「噗——」破裂
    tone({ type: 'sine', f0: 320, f1: 55, dur: 0.5, gain: 0.36, lp: 900 });
    noise({ f0: 1800, f1: 300, dur: 0.45, gain: 0.22, Q: 0.7 });
    return 0.5;
  },
  membrane() { // 「嘶——」膜展开
    noise({ filter: 'bandpass', f0: 400, f1: 3200, dur: 0.4, gain: 0.18, Q: 1.2, attack: 0.06 });
    tone({ type: 'sine', f0: 300, f1: 600, dur: 0.35, gain: 0.1, attack: 0.05 });
    return 0.4;
  },
  gameover() { // 下行「呜——」消溶
    tone({ type: 'sine', f0: 420, f1: 90, dur: 0.7, gain: 0.3, lp: 1000 });
    tone({ type: 'triangle', f0: 210, f1: 50, dur: 0.7, gain: 0.12, at: 0.05 });
    return 0.75;
  },
  victory() { // 上行胜利铃
    const n = [523, 659, 784, 1046];
    for (let i = 0; i < n.length; i++) tone({ type: 'triangle', f0: n[i], dur: 0.2, gain: 0.24, at: i * 0.11 });
    return 0.6;
  },
  ui() { // 轻「嗒」
    return tone({ type: 'sine', f0: 720, f1: 600, dur: 0.04, gain: 0.14 });
  },
};

// 唯一发声口。opts.high 显式标高优先（一般不用，HIGH 表已覆盖）；opts.force 跳过节流（试听/签名用）。
export function playSfx(name, opts) {
  if (!settings.sound) return false;
  const fn = SFX[name];
  if (!fn) return false;
  const c = ensure();
  if (!c) return false;
  const high = !!(opts && opts.high) || !!HIGH[name];
  const t = Date.now();
  const gap = MIN_GAP[name];
  if (gap && !high && !(opts && opts.force)) {
    if (last[name] && t - last[name] < gap) return false;
  }
  voices = voices.filter((exp) => exp > t);
  if (!high && voices.length >= VOICE_CAP) return false;
  last[name] = t;

  let step = 0;
  if (name === 'xp') {
    xpCombo = (t - xpLast < 600) ? xpCombo + 1 : 0;
    xpLast = t;
    step = xpCombo;
  }
  const dur = fn(step) || 0.1;
  voices.push(t + dur * 1000 + 30);
  return true;
}