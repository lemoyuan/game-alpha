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
  // 负半径在浏览器里抛 IndexSizeError：它是真异常但不是 NaN，上面的 check 抓不到
  const checkRadius = (name, r) => {
    if (typeof r === 'number' && r < 0) errors.push(`negative radius in ctx.${name}(${r})`);
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
    arc(...a) { check('arc', a); checkRadius('arc', a[2]); },
    ellipse(...a) { check('ellipse', a); checkRadius('ellipse', a[2]); checkRadius('ellipse', a[3]); },
    rect(...a) { check('rect', a); },
    roundRect(...a) { check('roundRect', a); },
    quadraticCurveTo(...a) { check('quadraticCurveTo', a); },
    bezierCurveTo(...a) { check('bezierCurveTo', a); },
    arcTo(...a) { check('arcTo', a); checkRadius('arcTo', a[4]); },
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

let firstCanvas = true;

globalThis.wx = {
  // 与真机一致：首次 createCanvas 返回屏幕画布，之后返回离屏画布（地面贴图靠它）
  createCanvas: () => {
    if (firstCanvas) {
      firstCanvas = false;
      return canvas;
    }
    return { width: 0, height: 0, getContext: () => makeCtx(), toDataURL: () => '' };
  },
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
const {
  BOSS_CHESTS, BOSS_XP_GEMS, chestChance, chestExpectedSeconds,
  CHEST_FIRST_ROLL, CHEST_PITY, CHEST_CHANCE_BASE, CHEST_CHANCE_EXTRA,
} = await import(fileUrl(path.join(COPY, 'npc', 'monster', 'config.js')));
const Enemy = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'enemy.js')))).default;
const { BURN_TICK, BURN_HOLD, BURN_DMG, DAMAGE_TEXT_MAX } = await import(fileUrl(path.join(COPY, 'consts.js')));
const { UI } = await import(fileUrl(path.join(COPY, 'ui', 'theme.js')));
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
let maxLasers = 0; // 只看历史峰值：抽样打印会漏掉活几秒钟的实体
let maxZones = 0;
let filmPeak = 0;
let filmBreaks = 0;
let prevFilm = 0;
let maxColonies = 0;
let slowFrames = 0;
let poisonFrames = 0; // 中毒状态覆盖的帧数：赤潮池的 applyPoison 有没有真挂上
let poisonTicks = 0;  // 中毒结算次数：poisonTickLeft 在两帧之间变大就说明这一帧跳了一次血
let prevPoisonTick = 0;
let bossDrops = 0;   // Boss 死亡掉落结算次数
let sawPet = false;  // 专属匣是否真的授出过跟班（bot 不拾取就一直是 false）
let maxPets = 0;
const colonySeen = new Set(); // 按对象身份数菌群：小怪会被回收复用，只有 home 能把它和杂兵区分开
let burnTicks = 0;      // 燃烧跳血次数（按飘字颜色识别，比逐帧比对时钟可靠）
let burnDmg = 0;        // 燃烧累计造成的伤害
let maxBurning = 0;     // 同屏燃烧怪数峰值
let maxTexts = 0;       // 飘字并发峰值：用来判 DAMAGE_TEXT_MAX 这道闸够不够宽
let totalTexts = 0;     // 飘字请求总量：suppressed 只有对着这个分母才读得出严不严
let suppressedTexts = 0; // 被上限吃掉的飘字数

// 幸运值钉成定值再用：bot 每帧 pick(0) 抽到的卡里可能就有幸运，
// 不钉住的话 LUCK=0 与 LUCK=4 那两组实测间隔量的其实是两种随机 build，A/B 直接不成立
const LUCK = Number(process.env.LUCK || 0);
// 燃烧层数同样钉死，理由和幸运一样：金匣现在六种里就有燃烧，不钉住两组跑的是两种随机 build。
// ★默认 0 时子弹根本不会调 applyBurn，所以 BURN=0 那次必须与改动前的基线逐字一致——这就是「新代码零副作用」的证明
const BURN = Number(process.env.BURN || 0);
const chestStamps = []; // 每只金匣刷出时刻（游戏秒），用来算相邻间隔

// 只能在刷怪入口挂钩数出场：金匣被打死后会从 enemys 里消失，数组长度同时混合了「刷出」和「死亡」；
// player.kills 又不区分怪种。委托式包装保留原行为，只加一次记录
{
  const spawner = databus.spawner;
  const origSpawn = Object.getPrototypeOf(spawner).spawn;
  spawner.spawn = (db, forceType) => {
    if (forceType === 'chest') chestStamps.push(db.spawner.elapsed);
    return origSpawn.call(spawner, db, forceType);
  };
}

// 跳血按飘字颜色认领：燃烧是唯一带 UI.burn 的伤害源，比逐帧比对时钟可靠（重新挂上时时钟会被归位）
{
  const dbProto = Object.getPrototypeOf(databus);
  const origAdd = dbProto.addDamageText;
  dbProto.addDamageText = function (x, y, damage, isCrit, color) {
    if (color === UI.burn) { burnTicks++; burnDmg += damage; }
    const before = this.damageTexts.length;
    origAdd.call(this, x, y, damage, isCrit, color);
    // 不区分来源：白字被顶掉同样要紧，peak 撞到上限就说明这道闸在吃玩家该看到的数字
    totalTexts++;
    if (this.damageTexts.length === before) suppressedTexts++;
  };
}

for (let i = 0; i < frames; i++) {
  const p = databus.player;
  if (p) p.hp = p.maxHp;
  if (p) p.luck = LUCK; // 金匣概率是幸运的单变量函数，钉住它才谈得上量间隔
  // 燃烧层数不能照抄 luck 那种「每帧顶部赋值」：金匣的 player[key] += step 就发生在同一帧的
  // chests.update 里、排在 player.update 之前，赋值会漏出一帧。漏出不要紧，燃烧能在怪身上烧满 5 秒，
  // 实测就是 BURN=0 也量到 20 次跳血。这里装个吞掉写入的访问器，把层数钉成单变量
  if (p && !p.__burnPinned) {
    p.__burnPinned = true;
    Object.defineProperty(p, 'burnBullets', { configurable: true, get: () => BURN, set: () => {} });
  }
  // 跟班只能从宝箱随机开出，bot 480 秒往往一个都开不到 → companion.png 的绘制分支一行都没跑过。
  // 开局前 5 秒强制挂一个把加载与 drawSprite 走一遍，第 5 秒撤掉：
  // 留着它会给后面三场 Boss 战额外垫真实 DPS，把 film breaks 这条基线改掉
  if (p) {
    if (i * DT < 5) p.companions = Math.max(p.companions, 1);
    else if (databus.companions.length) { p.companions = 0; databus.companions.length = 0; }
  }
  // bot 站桩没输出，打不动 3000 血的 Boss：出场表会永远停在第一条，
  // 二号 Boss 的激光/赤潮分支一行都跑不到。这里按秒削 Boss 的血，让三只 Boss 在 480 秒里都轮到
  const boss = databus.enemys.find((e) => e.isBoss);
  if (boss && i % 60 === 0) {
    // ★必须走 takeDamage：膜王的减伤和膜的侵蚀全在这个方法里结算，
    //   直接写 boss.hp 会让整条膜路径一帧都不跑，"没破膜"就成了测试台的问题。
    //   削血量取 maxHp/15 而不是更快的击杀节奏：这个原始 DPS 必须高过膜王
    //   「菌群全部回嵌」时的膜量回补速度，否则一局只破一次膜，
    //   破膜 → 破防窗口 → 被补回去 这条循环的后半段一行都测不到
    boss.takeDamage(Math.ceil(boss.maxHp / 15), false, databus);
  }
  // Boss 专属匣只会掉在 Boss 尸体上，bot 未必走过去 → CHEST_GRANTS 和跟班的 update/draw 一行都跑不到。
  // 每帧把匣挪到玩家脚下让它真被拾取一次：跟班约 6 DPS，相对测试台每秒削掉的 maxHp/15 可以忽略，
  // 不会改写 film breaks 这条基线
  if (p) {
    for (const c of databus.chests) {
      if (c.kindDef) { c.x = p.x; c.y = p.y; }
    }
  }
  const dyingBoss = boss && boss.isDead ? boss : null; // 本帧 checkCollisions 会给它结算掉落
  if (boss && boss.filmMax !== undefined) {
    if (boss.film > filmPeak) filmPeak = boss.film;
    if (prevFilm > 0 && boss.film <= 0) filmBreaks++;
    prevFilm = boss.film;
  } else {
    prevFilm = 0;
  }
  let colonies = 0;
  for (const e of databus.enemys) {
    if (!e.home) continue;
    colonies++;
    colonySeen.add(e);
  }
  if (colonies > maxColonies) maxColonies = colonies;
  let burning = 0;
  for (const e of databus.enemys) if (e.burnLeft > 0) burning++;
  if (burning > maxBurning) maxBurning = burning;
  if (databus.damageTexts.length > maxTexts) maxTexts = databus.damageTexts.length;
  if (p && p.slowLeft > 0) slowFrames++;
  // 中毒：本测试台每帧把 hp 回满，所以这里量不到掉血量，只证明状态挂上、跳血在跑
  if (p) {
    if (p.poisonLeft > 0) poisonFrames++;
    if (p.poisonTickLeft > prevPoisonTick) poisonTicks++;
    prevPoisonTick = p.poisonTickLeft;
  }
  const up = databus.upgradeScreen;
  if (up && up.visible && !up.selectAnim) {
    up.pick(0);
    databus.isPaused = false;
  }
  step();
  // Boss 尸体从 enemys 里消失 = 本帧 dropBossLoot 已经跑完，掉落物就在场上
  if (dyingBoss && !databus.enemys.includes(dyingBoss)) {
    bossDrops++;
    if (databus.xpGems.length < BOSS_XP_GEMS) {
      errors.push(`boss ${dyingBoss.type} 死亡只撒了 ${databus.xpGems.length} 颗宝石（应 ≥ ${BOSS_XP_GEMS}）`);
    }
    const table = BOSS_CHESTS[dyingBoss.type];
    if (table && table.length && !databus.chests.some((c) => c.kindDef)) {
      errors.push(`boss ${dyingBoss.type} 死亡没掉专属匣`);
    }
  }
  if (databus.bossPets.length) sawPet = true;
  if (databus.bossPets.length > maxPets) maxPets = databus.bossPets.length;
  for (const pet of databus.bossPets) {
    // 环绕/冲锋的三角函数一旦喂进 NaN 就会一路 NaN 下去，画面上是跟班凭空消失
    if (!Number.isFinite(pet.x) || !Number.isFinite(pet.y)) errors.push('boss pet 坐标出现非有限值');
  }
  if (databus.lasers.length > maxLasers) maxLasers = databus.lasers.length;
  if (databus.zones.length > maxZones) maxZones = databus.zones.length;
  if (p && p.img) playerSpriteSrc = p.img.__src;
  if (fillStyles.has('rgba(255,238,170,0.95)')) sawFlash = true;
  if (i % 1800 === 0) {
    const b = databus.enemys.find((e) => e.isBoss);
    console.log(`t=${(i * DT).toFixed(0)}s lvl=${p && p.level} enemies=${databus.enemys.length} kills=${p && p.kills}`
      + ` boss=${b ? b.type : '-'}${b && b.state ? ':' + b.state : ''}`
      + ` film=${b && b.film !== undefined ? Math.round(b.film) : '-'}`
      + ` lasers=${databus.lasers.length} zones=${databus.zones.length} pets=${databus.bossPets.length} burning=${burning}`);
  }
}

// —— 金匣概率刷新：先查纯函数，再查实场 ——
// 曲线形状是确定性的，必须逐项对上；出场间隔是随机的，只用来验证「真的在跑」和「保底兜得住」
const CURVE_POINTS = [0, 1, 2, 3, 4, 6, 10];
// 边际检查必须逐 1 级取样：一张卡 = 幸运 +1，跨两级的采样点（4→6）差值天然更大，
// 拿混用步长的差值比大小会把饱和曲线误报成「越堆越值」
const MARGINAL_POINTS = [];
for (let l = 0; l <= 12; l++) MARGINAL_POINTS.push(l);
const marginal = MARGINAL_POINTS.map((l) => chestChance(l));
for (let i = 1; i < marginal.length; i++) {
  if (!(marginal[i] > marginal[i - 1])) errors.push(`chestChance 在幸运 ${i} 处不再单调递增`);
  const d = marginal[i] - marginal[i - 1];
  if (i > 1 && d > marginal[i - 1] - marginal[i - 2] + 1e-12) {
    errors.push(`chestChance 的边际收益在幸运 ${i} 处变大：曲线不是饱和形，幸运会变成越堆越值`);
  }
}
const curve = CURVE_POINTS.map((l) => chestChance(l));
if (!(curve[curve.length - 1] < CHEST_CHANCE_BASE + CHEST_CHANCE_EXTRA + 1e-12)) {
  errors.push('chestChance 撞上或超过了 BASE+EXTRA 这条顶，幸运上限失去意义');
}

const chestGaps = [];
for (let i = 1; i < chestStamps.length; i++) chestGaps.push(chestStamps[i] - chestStamps[i - 1]);
const worstGap = chestGaps.length ? Math.max(...chestGaps) : 0;
const avgGap = chestGaps.length ? chestGaps.reduce((a, b) => a + b, 0) / chestGaps.length : 0;
// 掷骰粒度是 1 秒，所以保底触发时的真实间隔允许比 CHEST_PITY 多出这个零头
const gapCeiling = CHEST_PITY / 1000 + 1.5;
if (!chestStamps.length) errors.push(`${seconds}s 内一只金匣都没刷出：概率那条路径根本没跑`);
if (chestStamps[0] < CHEST_FIRST_ROLL) {
  errors.push(`金匣在第 ${chestStamps[0].toFixed(1)}s 就出现了，早于首次掷骰 ${CHEST_FIRST_ROLL}s`);
}
if (worstGap > gapCeiling) {
  errors.push(`金匣最大间隔 ${worstGap.toFixed(1)}s 超过保底上限 ${gapCeiling}s：CHEST_PITY 没在兜，概率制会留下空窗体感`);
}

// —— 燃烧节拍纯检：这条才是「5 秒 / 每 0.5 秒掉 1 血 / 每层 +1」的真凭据，不受 RNG 和 build 影响。
//   实场那一遍只用来证明「接线真的通了」，量不准节拍（怪会死、会有膜王减伤）
function burnRun(stacks, reHitAt) {
  let ticks = 0;
  let dmg = 0;
  let maxTick = 0;
  const fake = {
    isDead: false, hp: 1e9, x: 0, y: 0, radius: 10,
    burnLeft: 0, burnTickLeft: BURN_TICK, burnDamage: 0,
    // updateBurn 把 databus 透传给 takeDamage，这里自当成 databus：假怪不需要飘字和掉落
    takeDamage(d) { ticks++; dmg += d; if (d > maxTick) maxTick = d; },
  };
  Enemy.prototype.applyBurn.call(fake, stacks * BURN_DMG, BURN_HOLD);
  const dt = 1 / 60;
  for (let i = 1; i * dt <= 12; i++) {
    if (reHitAt !== undefined && Math.abs(i * dt - reHitAt) < dt / 2) {
      Enemy.prototype.applyBurn.call(fake, stacks * BURN_DMG, BURN_HOLD);
    }
    Enemy.prototype.updateBurn.call(fake, dt, fake);
  }
  return { ticks, dmg, maxTick, left: fake.burnLeft };
}
const expectTicks = Math.round(BURN_HOLD / BURN_TICK);
const burn1 = burnRun(1);
const burn3 = burnRun(3);
const burnRefresh = burnRun(1, 3); // 第 3 秒再命中一次
if (burn1.ticks !== expectTicks) {
  errors.push(`一次完整燃烧跳了 ${burn1.ticks} 下，应为 ${expectTicks} 下（BURN_HOLD ÷ BURN_TICK）：节拍口径和用户说的「5 秒每 0.5 秒」不符`);
}
if (burn1.dmg !== expectTicks * BURN_DMG) {
  errors.push(`1 层燃烧一轮 ${burn1.dmg} 点伤害，应为 ${expectTicks * BURN_DMG}`);
}
if (burn3.dmg !== expectTicks * 3 * BURN_DMG) {
  errors.push(`3 层燃烧一轮 ${burn3.dmg} 点伤害，应为 ${expectTicks * 3 * BURN_DMG}：每多一个道具每跳 +1 没生效`);
}
if (burn1.left !== 0) errors.push('燃烧跑完 burnLeft 没归零，火苗会一直挂在怪身上');
if (burnRefresh.maxTick !== BURN_DMG) {
  errors.push(`中途再命中一次后单跳最大 ${burnRefresh.maxTick} 点（应为 ${BURN_DMG}）：燃烧在乘算，不是只刷时间`);
}
if (!(burnRefresh.ticks > burn1.ticks)) {
  errors.push(`中途再命中没有延长燃烧（${burnRefresh.ticks} 跳 ≤ ${burn1.ticks} 跳）：刷新那条路没接上`);
}
if (BURN === 0 && burnTicks > 0) {
  errors.push(`零层燃烧却量到 ${burnTicks} 次跳血：子弹的 burnDamage=0 那道门没关掉，改动动了基线`);
}
if (BURN > 0 && burnTicks === 0) {
  errors.push(`燃烧 ${BURN} 层却一次跳血都没量到：子弹没带上燃烧，或 applyBurn/updateBurn 有一条没接上`);
}
if (totalTexts && suppressedTexts / totalTexts > 0.1) {
  errors.push(`飘字上限太紧：${(suppressedTexts / totalTexts * 100).toFixed(1)}% 的伤害数字被 DAMAGE_TEXT_MAX 吃掉，热闹时段玩家会看到普攻掉数字`);
}

console.log('---');
console.log('drawn textures:', [...drawnSrc].sort().join(', ') || '(none)');
console.log('player texture:', playerSpriteSrc, '| rotate calls:', rotateCalls, '| muzzle flash:', sawFlash);
console.log('peak lasers:', maxLasers, '| peak zones:', maxZones);
console.log('peak film:', filmPeak, '| film breaks:', filmBreaks, '| colonies:', colonySeen.size, 'peak', maxColonies);
console.log('slowed frames:', slowFrames, 'of', frames);
console.log('poisoned frames:', poisonFrames, '| poison ticks:', poisonTicks);
console.log('boss drops:', bossDrops, '| pet granted:', sawPet ? 'yes' : 'NO', '| peak pets:', maxPets);
console.log('chest spawns (luck=' + LUCK + '):', chestStamps.length,
  '| avg gap:', avgGap.toFixed(1) + 's', '| worst gap:', worstGap.toFixed(1) + 's',
  '| first:', chestStamps.length ? chestStamps[0].toFixed(1) + 's' : '-');
console.log('chest chance:', CURVE_POINTS.map((l, i) => `${l}→${(curve[i] * 100).toFixed(2)}%/${chestExpectedSeconds(l).toFixed(1)}s`).join(' '));
console.log('burn (stacks=' + BURN + '):', burnTicks, 'ticks /', burnDmg, 'dmg | peak burning:', maxBurning,
  '| pure cadence: 1层=' + burn1.ticks + '跳·' + burn1.dmg + '血, 3层=' + burn3.dmg + '血, 中途补枪=' + burnRefresh.ticks + '跳·单跳最大' + burnRefresh.maxTick);
console.log('damage texts: peak', maxTexts, 'of cap', DAMAGE_TEXT_MAX, '| suppressed', suppressedTexts, 'of', totalTexts,
  `(${totalTexts ? (suppressedTexts / totalTexts * 100).toFixed(1) : '0.0'}%)`);
console.log('non-finite ctx args:', nonFinite, '| errors:', errors.length);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
