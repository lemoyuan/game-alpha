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
// 画出来的每一句文案。数值算错但被拼进字符串时，NaN 不会经过任何数值检查，只能靠这份文本扫
const drawnTexts = new Set();

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
    fillText(t, ...a) { check('fillText', a); drawnTexts.add(String(t)); },
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
  // 与 preview.html 同一套刘海机实测读数：胶囊 51..83，右上簇照它的底边让位
  getMenuButtonBoundingClientRect: () => ({ top: 51, left: 293, width: 87, height: 32, bottom: 83 }),
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

// A/B 用：MUT=1 把副本里的突变概率改成必出，好把「红斑真的画了」「血块真的掉了」这两条量出来
// （1% 概率下 900 秒也可能一只都不刷，那种跑次的零是抽样零，不是代码零）。
// ★改的是 .hcheck 副本不是 js/ 源码，和当年 HPROLD 那条同一个套路
const MUT = process.env.MUT;
if (MUT !== undefined) {
  const f = path.join(COPY, 'npc', 'monster', 'config.js');
  const code = fs.readFileSync(f, 'utf8');
  const next = code.replace(/(export const MUTANT_CHANCE = )[\d.eE+-]+/, `$1${Number(MUT)}`);
  if (next === code) errors.push(`副本 config.js 里没改到 MUTANT_CHANCE，MUT=${MUT} 这一组等于没跑`);
  else fs.writeFileSync(f, next);
}
// 嗜血的触发概率同样改副本：0.5% 下 900 秒也可能一次都不触发，那种零分不清是抽样零还是代码零。
// LEECHP=1 把「每杀必回」钉成确定路径，现场那条接线才量得准；LEECHP=0 是概率那一端的门
const LEECHP = process.env.LEECHP;
if (LEECHP !== undefined) {
  const f = path.join(COPY, 'consts.js');
  const code = fs.readFileSync(f, 'utf8');
  const next = code.replace(/(export const LEECH_CHANCE = )[\d.eE+-]+/, `$1${Number(LEECHP)}`);
  if (next === code) errors.push(`副本 consts.js 里没改到 LEECH_CHANCE，LEECHP=${LEECHP} 这一组等于没跑`);
  else fs.writeFileSync(f, next);
}

// Boss 专属匣的下线开关也翻得回 true：BOSSCHEST=1 把副本里那个 false 改成 true，
// 用来证明 config 注释上那句「改回 true 就整条恢复」不是空话（关掉的那一端由下面的零断言守）
const BOSSCHEST = process.env.BOSSCHEST;
if (BOSSCHEST !== undefined) {
  const f = path.join(COPY, 'npc', 'monster', 'config.js');
  const code = fs.readFileSync(f, 'utf8');
  const re = /export const BOSS_CHESTS_ENABLED = \w+/;
  // ★不能用「替换后字符串没变」判有没有命中：BOSSCHEST=0 时本来就不变，那样会假报一组没跑
  if (!re.test(code)) errors.push(`副本 config.js 里找不到 BOSS_CHESTS_ENABLED，BOSSCHEST=${BOSSCHEST} 这一组等于没跑`);
  else fs.writeFileSync(f, code.replace(re, `export const BOSS_CHESTS_ENABLED = ${BOSSCHEST === '1' ? 'true' : 'false'}`));
}

const mainMod = await import(fileUrl(path.join(COPY, 'main.js')));
const databusMod = await import(fileUrl(path.join(COPY, 'databus.js')));
const {
  BOSS_CHESTS, BOSS_CHESTS_ENABLED, BOSS_XP_GEMS, chestChance, chestExpectedSeconds,
  CHEST_FIRST_ROLL, CHEST_PITY, CHEST_CHANCE_BASE, CHEST_CHANCE_EXTRA,
  MONSTER_TYPES, MUTANT_CHANCE, BLOOD_CLOT_HEAL,
} = await import(fileUrl(path.join(COPY, 'npc', 'monster', 'config.js')));
const Enemy = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'enemy.js')))).default;
const {
  BURN_TICK, BURN_HOLD, BURN_DMG, DAMAGE_TEXT_MAX,
  BOMB_CD, BOMB_BLAST_R, BOMB_BLAST_MS, BOMB_H_SPEED, BOMB_FLY_MIN, BOMB_FLY_MAX, bombDamage,
  ARENA_W, ARENA_H, ITEM_BAR, LEECH_CHANCE,
} = await import(fileUrl(path.join(COPY, 'consts.js')));
const { UI } = await import(fileUrl(path.join(COPY, 'ui', 'theme.js')));
const { BONUSES } = await import(fileUrl(path.join(COPY, 'npc', 'chest.js')));
const Player = (await import(fileUrl(path.join(COPY, 'player', 'index.js')))).default;
// 这几件实体只要 import 就够（纯检直接驱动它们的原型，不经过主循环）
const Bomb = (await import(fileUrl(path.join(COPY, 'player', 'bomb.js')))).default;
const Bomber = (await import(fileUrl(path.join(COPY, 'player', 'bomber.js')))).default;
const Companion = (await import(fileUrl(path.join(COPY, 'player', 'companion.js')))).default;
const BloodClot = (await import(fileUrl(path.join(COPY, 'npc', 'bloodclot.js')))).default;
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
let sawBossChest = false; // 场上是否出现过带 kindDef 的专属匣：下线期间这条必须一直 false
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
// 燃烧层数同样钉死，理由和幸运一样：金匣八种加成里就有燃烧，不钉住两组跑的是两种随机 build。
// ★BURN=0 曾经兼作「新代码零副作用」的凭据（子弹根本不会调 applyBurn）。
//   但金匣池加到第七种之后这条不再成立：同一颗种子抽到的加成会重新分配，跑出来本来就是另一种 build。
//   零副作用的证据改用下面那条 BOMBER=0 等价式
const BURN = Number(process.env.BURN || 0);
// 炸弹跟班层数同样钉死成单变量，理由同幸运和燃烧。
// ★但这批拿不到「与改动前基线逐字一致」这条证据：金匣池从 6 种变 7 种，
//   同一种子每局抽到的加成会重新分配，跑出来的本来就是另一种 build。
//   零副作用的证明换成下面那条 BOMBER=0 等价式：层数为 0 时既不生成跟班也一枚不扔
const BOMBER = Number(process.env.BOMBER || 0);
// 射击跟班层数同样钉死：这一批改的是「层数 = 一轮几发」，不钉住就量不到多发那条路
const COMPANIONS = Number(process.env.COMPANIONS || 0);
// 嗜血层数同样钉成单变量：金匣八选一里就有它，不吞掉写入的话 LEECH=0 那趟也会长出层数，
// 那条「关掉等价式」就量不出来
const LEECH = Number(process.env.LEECH || 0);
let leechCalls = 0;     // 击杀结算点被真正调到过几次：和 player.kills 一比一，是「接线只此一处」的凭据
let leechProcs = 0;     // 实际回了血（返回值 > 0）的次数
let leechHp = 0;        // 累计回复量
let leechRoom = 0;      // 按「一口 = 层数、封顶取剩余额」应得的回复量：现场那 4 点缺口会被同帧多杀吃掉，
let leechRoomProcs = 0; //   所以断言比的是这两个「算得出来的期望」，不是一句 procs === kills
let volleyRounds = 0;      // 跟班齐射轮数
const volleySizes = new Set(); // 每轮实际新增的子弹数：只应有一个取值且等于层数
let bombsThrown = 0;   // 扔出的枚数（按 Bomb.init 计，一轮 player.bomber 枚）
let bombBooms = 0;     // 引爆次数：理论上恒等于 bombsThrown，对不上了就是有用量没炸或有弹没飞完
let maxBombs = 0;      // 同屏在飞枚数峰值
let maxBombers = 0;    // 场上炸弹跟班只数峰值：★恒应为 1，长到 2 就是「层数当只数」回潮
let companionPeak = 0; // 同上，射击跟班也只该有一只
const chestStamps = []; // 每只金匣刷出时刻（游戏秒），用来算相邻间隔
// 突变型刺头与血块。出生按对象身份数（和 colonySeen 同一条理由：只有身份能把它和杂兵区分开），
// 掉落数挂在 BloodClot.prototype.init 上
const mutantSeen = new Set();
const mutantAlive = new Set();
let mutantDeaths = 0;
let clotsDropped = 0;
let clotPeak = 0;
let clotHeals = 0; // 血块真被吃掉几次（按 UI.blood 色飘字认）：主循环里那条回血线路跑通过的凭据

// 只能在刷怪入口挂钩数出场：金匣被打死后会从 enemys 里消失，数组长度同时混合了「刷出」和「死亡」；
// player.kills 又不区分怪种。委托式包装保留原行为，只加一次记录
{
  const spawner = databus.spawner;
  const origSpawn = Object.getPrototypeOf(spawner).spawn;
  spawner.spawn = (db, forceType) => {
    if (forceType === 'chest') chestStamps.push(db.spawner.elapsed);
    const before = db.enemys.length;
    const r = origSpawn.call(spawner, db, forceType);
    // ★突变体在刷出这一帧就登记，不等下一帧扫 enemys：刷出和死亡可能落在同一个 step 里
    //   （跟班的子弹正好扫到出生点），漏登记就是「血块掉了一颗而死亡数没涨」——1:1 那条会假红
    for (let i = before; i < db.enemys.length; i++) {
      const e = db.enemys[i];
      if (!e.mutant) continue;
      mutantSeen.add(e);
      mutantAlive.add(e);
    }
    return r;
  };
}

// 跳血按飘字颜色认领：燃烧是唯一带 UI.burn 的伤害源，比逐帧比对时钟可靠（重新挂上时时钟会被归位）
{
  const dbProto = Object.getPrototypeOf(databus);
  const origAdd = dbProto.addDamageText;
  dbProto.addDamageText = function (x, y, damage, isCrit, color) {
    if (color === UI.burn) { burnTicks++; burnDmg += damage; }
    if (color === UI.blood) clotHeals++; // 血块被吃掉才会有的洋红跳字：主循环里那条回血线路的唯一实场读数
    const before = this.damageTexts.length;
    origAdd.call(this, x, y, damage, isCrit, color);
    // 不区分来源：白字被顶掉同样要紧，peak 撞到上限就说明这道闸在吃玩家该看到的数字
    totalTexts++;
    if (this.damageTexts.length === before) suppressedTexts++;
  };
}

// 炸弹的扔出与引爆：两条都挂在原型上做委托式包装（保留原行为、只加一次记录）。
// 数量对不上比数量本身更有信息：thrown > booms 说明有弹被局末掐掉或在飞中被回收，
// booms > thrown 不可能出现，出现就是引爆跑了两遍
{
  const proto = Bomb.prototype;
  const origInit = proto.init;
  proto.init = function (...args) { bombsThrown++; return origInit.apply(this, args); };
  const origDetonate = proto.detonate;
  proto.detonate = function (db) { bombBooms++; return origDetonate.call(this, db); };
}

// 血块掉落数：挂在 init 上，和上面炸弹那条一样是委托式包装（保留原行为、只加一次记录）。
// ★下面「突变型」那节的纯检也会调 init，所以实场取值必须先快照
{
  const proto = BloodClot.prototype;
  const origInit = proto.init;
  proto.init = function (...args) { clotsDropped++; return origInit.apply(this, args); };
}

// 跟班一轮净加几发子弹：一轮之内没有别处会往 databus.bullets 里塞东西，所以差值就是发数。
// 这个量是「层数 = 每轮发数」的唯一实场读数，纯检那条只能证明代码写了循环
{
  const proto = Companion.prototype;
  const origVolley = proto.volley;
  proto.volley = function (db, player) {
    const before = db.bullets.length;
    const r = origVolley.call(this, db, player);
    volleyRounds++;
    volleySizes.add(db.bullets.length - before);
    return r;
  };
}

// 嗜血的实场计数：包的是 player 实例上的方法，不包原型。
// ★理由和当年那批实例钩子一样 —— 下面那段纯检直接 `Player.prototype.onKill.call(假玩家)`，
//   挂在原型上会把纯检的五次调用一起计进现场账，procs 对不上 kills 就成了假红。
//   第一帧才装：player 是开局那一帧才 new 出来的，提前装会挂到 null 上、整组计数空跑

for (let i = 0; i < frames; i++) {
  const p = databus.player;
  if (p && !p.__leechHooked) {
    p.__leechHooked = true;
    const orig = p.onKill;
    p.onKill = function (db) {
      leechCalls++;
      // 期望值在调用前算：一口 = 层数，但封顶取「还差几血」，同帧第二杀常常只剩零头
      const room = Math.max(0, this.maxHp - this.hp);
      leechRoom += Math.min(LEECH, room);
      if (room > 0) leechRoomProcs++;
      const healed = orig.call(this, db);
      if (healed > 0) leechProcs++;
      leechHp += healed;
      return healed;
    };
  }
  // ★开了 LEECH 时把每帧的回满改成「留 4 点缺口」：血每次都是满的话 heal() 恒返回 0，
  //   现场读数会永远是 0，而那个 0 和「功能根本没接上」长得一模一样
  if (p) p.hp = LEECH > 0 ? p.maxHp - 4 : p.maxHp;
  if (p) p.luck = LUCK; // 金匣概率是幸运的单变量函数，钉住它才谈得上量间隔
  // 燃烧层数不能照抄 luck 那种「每帧顶部赋值」：金匣的 player[key] += step 就发生在同一帧的
  // chests.update 里、排在 player.update 之前，赋值会漏出一帧。漏出不要紧，燃烧能在怪身上烧满 5 秒，
  // 实测就是 BURN=0 也量到 20 次跳血。这里装个吞掉写入的访问器，把层数钉成单变量
  if (p && !p.__burnPinned) {
    p.__burnPinned = true;
    Object.defineProperty(p, 'burnBullets', { configurable: true, get: () => BURN, set: () => {} });
  }
  // 炸弹跟班同样钉成定值：金匣七选一里就有一种是它，不吞掉写入的话 BOMBER=0 那次也会长出跟班，
  // 那条「关掉就等价于没做」的等价式根本量不出来
  if (p && !p.__bomberPinned) {
    p.__bomberPinned = true;
    Object.defineProperty(p, 'bomber', { configurable: true, get: () => BOMBER, set: () => {} });
  }
  // ★钉了层数时下面那段「5 秒后清零」必须让路：清零会让跟班每帧被回收再重建，
  //   新建的 cdT 从 0 起攒，永远攒不满一轮 → 齐射发数这条量不到。
  //   代价和 BURN>0 一样：这只跟班会给全场多垫一份 DPS，所以这条只在单独跑 A/B 时开
  if (COMPANIONS > 0 && p && !p.__companionPinned) {
    p.__companionPinned = true;
    Object.defineProperty(p, 'companions', { configurable: true, get: () => COMPANIONS, set: () => {} });
  }
  // 嗜血层数不管开没开都要钉：金匣八选一里就有它，不吞掉写入的话 LEECH=0 那趟照样会长出层数，
  // 那条「关掉等价式」量不出来，LEECH=3 那趟也会顺带开出第四、五层
  if (p && !p.__leechPinned) {
    p.__leechPinned = true;
    Object.defineProperty(p, 'leech', { configurable: true, get: () => LEECH, set: () => {} });
  }
  // 跟班只能从宝箱随机开出，bot 480 秒往往一个都开不到 → companion.png 的绘制分支一行都没跑过。
  // 开局前 5 秒强制挂一个把加载与 drawSprite 走一遍，第 5 秒撤掉：
  // 留着它会给后面三场 Boss 战额外垫真实 DPS，把 film breaks 这条基线改掉
  if (p && COMPANIONS === 0) {
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
  // 不会改写 film breaks 这条基线。★专属匣已整条下线（BOSS_CHESTS_ENABLED = false）时场上不会有
  // kindDef 的匣，这段自然一行都不做；它只在 BOSSCHEST=1 那一跑里负责保证「授予链真被跑到」
  if (p) {
    for (const c of databus.chests) {
      if (c.kindDef) {
        sawBossChest = true;
        c.x = p.x;
        c.y = p.y;
      }
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
  // 突变体从 enemys 里消失 = 本帧它的死亡结算跑完了，血块要是有掉也就在这一帧掉
  for (const m of mutantAlive) {
    if (databus.enemys.includes(m)) continue;
    mutantAlive.delete(m);
    if (!databus.isGameOver) mutantDeaths++;
  }
  if (databus.clots.length > clotPeak) clotPeak = databus.clots.length;
  // Boss 尸体从 enemys 里消失 = 本帧 dropBossLoot 已经跑完，掉落物就在场上
  if (dyingBoss && !databus.enemys.includes(dyingBoss)) {
    bossDrops++;
    if (databus.xpGems.length < BOSS_XP_GEMS) {
      errors.push(`boss ${dyingBoss.type} 死亡只撒了 ${databus.xpGems.length} 颗宝石（应 ≥ ${BOSS_XP_GEMS}）`);
    }
    // ★这条只在开关为 true 时成立：专属匣已整条下线，表非空却查不到匣是设计如此，不是掉了
    if (BOSS_CHESTS_ENABLED) {
      const table = BOSS_CHESTS[dyingBoss.type];
      if (table && table.length && !databus.chests.some((c) => c.kindDef)) {
        errors.push(`boss ${dyingBoss.type} 死亡没掉专属匣`);
      }
    }
  }
  if (databus.bossPets.length) sawPet = true;
  if (databus.bossPets.length > maxPets) maxPets = databus.bossPets.length;
  for (const pet of databus.bossPets) {
    // 环绕/冲锋的三角函数一旦喂进 NaN 就会一路 NaN 下去，画面上是跟班凭空消失
    if (!Number.isFinite(pet.x) || !Number.isFinite(pet.y)) errors.push('boss pet 坐标出现非有限值');
  }
  if (databus.bombs.length > maxBombs) maxBombs = databus.bombs.length;
  if (databus.bombers.length > maxBombers) maxBombers = databus.bombers.length;
  if (databus.companions.length > companionPeak) companionPeak = databus.companions.length;
  for (const b of databus.bombs) {
    // z 是抛物线算出来的视觉高度，它一旦非有限，落影与弹体会在同一帧双双消失
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) {
      errors.push('炸弹坐标或高度出现非有限值');
      break;
    }
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

// —— Boss 专属匣的两端断言：下线期间「整条不可达」，翻回 true 时「授予链真能跑通」 ——
if (!BOSS_CHESTS_ENABLED) {
  if (sawBossChest) {
    errors.push('专属匣已下线却还在场上掉出来：main.js 的门没钉住，或者还有第二个掉落口没关');
  }
  if (maxPets) {
    errors.push(`专属匣已下线却生成过 ${maxPets} 只跟班：CHEST_GRANTS 被掉落以外的地方调用了`);
  }
} else if (bossDrops > 0 && !sawPet) {
  errors.push(`开关翻回 true、也死了 ${bossDrops} 只 Boss，却没有一只跟班：掉落→拾取→授予→bossPet 断了一环，"改回 true 即恢复"不成立`);
}

// —— 炸弹跟班实场断言 ——
// 先快照：下面那些纯检会直接调 Bomb.prototype.init/detonate，不先取值的话 fieldThrown 会把纯检也算进账
const fieldThrown = bombsThrown;
const fieldBooms = bombBooms;
if (BOMBER === 0 && (fieldThrown || maxBombers)) {
  errors.push(`炸弹跟班 0 层却量到扔出 ${fieldThrown} 枚、跟班峰值 ${maxBombers} 只：0 层这道门没关掉，"没这个道具"的局也在跑新代码`);
}
if (BOMBER > 0 && maxBombers === 0) {
  errors.push(`炸弹跟班 ${BOMBER} 层场上却一只是一只都没生成：databus 那条封顶判断没接上`);
}
if (BOMBER > 0 && fieldThrown === 0) {
  errors.push(`炸弹跟班 ${BOMBER} 层 ${seconds}s 内一枚都没扔出：索敌、冷却或 databus 更新循环有一条没通`);
}
// ★这两条是「层数当只数」回潮最省事的拦网：语义一旦改回去，测试台会立刻变红而不是静默放行
if (maxBombers > 1) errors.push(`场上出现 ${maxBombers} 只炸弹跟班：层数的口径是「一轮几枚」，不是「几只」`);
if (companionPeak > 1) errors.push(`场上出现 ${companionPeak} 只射击跟班：同上，现在恒应为一轮多发的一只`);
if (fieldBooms > fieldThrown) errors.push(`引爆 ${fieldBooms} 次 > 扔出 ${fieldThrown} 枚：有弹炸了两遍`);
// 一只跟班一轮几发：差值集合只应有一个取值，且它就是钉进去的层数
if (COMPANIONS > 0) {
  if (volleyRounds === 0) errors.push(`射击跟班 ${COMPANIONS} 层却一轮齐射都没量到：cdT 那道门或 databus 更新循环没通`);
  else if (volleySizes.size > 1) errors.push(`同一只跟班的齐射发数在 ${[...volleySizes].join('/')} 之间跳：层数没被读稳`);
  else if ([...volleySizes][0] !== COMPANIONS) {
    errors.push(`钉了 ${COMPANIONS} 层，每轮实际射出 ${[...volleySizes][0]} 发：「层数 = 每轮发数」这条不成立`);
  }
}


// —— 嗜血实场断言 ——
// 先快照：下面那段纯检会直接驱动 Player.prototype.onKill（不经过这个实例钩子），但 kills 会一直涨到局末
const fieldKills = databus.player ? databus.player.kills : 0;
// 这条是所有断言里最硬的一条：接线点既不能漏杀（procs 上不去）也不能一杀两掷（红字翻倍）
if (leechCalls !== fieldKills) {
  errors.push(`结算了 ${fieldKills} 次击杀而 onKill 被调了 ${leechCalls} 次：main.js 那条「一次算一杀」的接线对不上`);
}
if (LEECH === 0 && (leechProcs || leechHp)) {
  errors.push(`嗜血 0 层却量到 ${leechProcs} 次回血共 ${leechHp} 点：0 层那道门没关掉，没捡到这个道具的局也在跑新代码`);
}
if (LEECHP !== undefined) {
  const pin = Number(LEECHP);
  if (pin === 0 && (leechProcs || leechHp)) {
    errors.push(`概率钉成 0 却回了 ${leechHp} 点血（${leechProcs} 次）：LEECH_CHANCE 那道门没生效`);
  }
  if (pin === 1) {
    if (LEECH > 0 && leechProcs === 0) {
      errors.push(`概率钉成 1、层数 ${LEECH} 却一口都没回：现场那条接线没通（纯检过了不代表 main 接上了）`);
    }
    if (leechProcs !== leechRoomProcs) {
      errors.push(`必触发下回了血 ${leechProcs} 次，按「有余血才回得进」算应有 ${leechRoomProcs} 次：概率钉死了还在掷骰`);
    }
    if (leechHp !== leechRoom) {
      errors.push(`必触发下累计回 ${leechHp} 点，按「一口 ${LEECH} 点、封顶取剩余额」算应得 ${leechRoom} 点：一口的量不是层数`);
    }
  }
}

// —— 突变型刺头与血块：先实场断言，再补纯检 ——
// 先快照：下面那段纯检会直接 new BloodClot 并调 init，不先取值的话 fieldDrops 会把纯检也算进账
const fieldMutants = mutantSeen.size;
const fieldDrops = clotsDropped;
const fieldPeak = clotPeak;
const fieldHeals = clotHeals;
if (MUT !== undefined && fieldMutants === 0) {
  errors.push(`MUT=${MUT} 却一只突变体都没刷出来：spawner 那条掷骰根本没跑，这一组是空跑的`);
}
// 掉落的账必须平：死掉的每只掉且只掉一颗，还活着的那颗都不该掉
if (fieldDrops !== mutantDeaths) {
  errors.push(`突变体死了 ${mutantDeaths} 只、血块掉了 ${fieldDrops} 颗：1:1 那条不成立`);
}
if (fieldMutants && !fillStyles.has(UI.blood)) {
  errors.push(`场上出现过 ${fieldMutants} 只突变体，却没有一笔画过 UI.blood：那块血斑根本没画出来`);
}
// ★测试台只在每帧【顶部】把 hp 回满，而同一帧里的接触伤害排在血块 update 之前，所以场上确实存在残血窗口：
//   掉出来的血块该被真吃掉。heals 这颗数就是「回血在主循环里真跑通了」的实场凭据
//   （纯检那几条只驱动原型，证明不了 databus/main 接了线）
// ★clotHeals 那个计数器现在是两家共用：血块被吃掉的红字和嗜血回血的红字在 addDamageText 上长得
//   一模一样（都是 +N、都是 UI.blood），分不开只能按笔数相减。嗜血每次回血必出一条红字
//   （onKill 里 healed > 0 才画），所以减 leechProcs 是精确的，不是估的
const clotEats = fieldHeals - leechProcs;
if (clotEats > fieldDrops) {
  errors.push(`血块被吃掉 ${clotEats} 次 > 掉出 ${fieldDrops} 颗：有那颗结算了两遍，回收没跟上`);
}
if (fieldDrops > 0 && clotEats <= 0) {
  errors.push(`掉了 ${fieldDrops} 颗血块却一颗都没被吃掉：主循环里那条回血路径没接上（纯检过了不代表 databus/main 通了）`);
}

// —— 血块纯检：回多少、差 1 血时的封顶、满血那道门。这三条实场读不出数值（回血主循环里量不到具体加了几）
function clotRun(hp, maxHp, dist) {
  const player = Object.create(Player.prototype);
  player.x = 0; player.y = 0; player.radius = 14; player.pickupRange = 90;
  player.hp = hp; player.maxHp = maxHp;
  const texts = [];
  const db = { player, addDamageText(x, y, damage, isCrit, color) { texts.push({ damage, color }); } };
  const clot = new BloodClot();
  clot.init(player.x + dist, player.y, BLOOD_CLOT_HEAL);
  const sx = clot.x; const sy = clot.y;
  clot.update(1 / 60, db);
  return { player, clot, texts, moved: Math.hypot(clot.x - sx, clot.y - sy) };
}
const clotFull = clotRun(40, 40, 10);      // 满血，而且已经贴到接触距离里了
const clotHurt = clotRun(20, 40, 10);      // 残血，接触即回
const clotEdge = clotRun(39, 40, 10);      // 只差 1 血：吃一颗回 2 的，应该只结算 1
const clotNear = clotRun(20, 40, 60);      // 在磁吸半径内、还没碰上
const clotFar = clotRun(20, 40, 120);      // 磁吸半径外：该一动不动
if (clotFull.clot.collected || clotFull.player.hp !== 40 || clotFull.moved !== 0 || clotFull.texts.length) {
  errors.push(`满血时那颗血块被吃了/被吸动了（collected=${clotFull.clot.collected} moved=${clotFull.moved.toFixed(1)}）：开局第一颗血块会白送`);
}
if (!clotHurt.clot.collected || clotHurt.player.hp !== 22) {
  errors.push(`残血拾取后 hp=${clotHurt.player.hp}（应 22）、collected=${clotHurt.clot.collected}：回 BLOOD_CLOT_HEAL 那条没生效`);
}
if (clotHurt.texts.length !== 1 || clotHurt.texts[0].damage !== `+${BLOOD_CLOT_HEAL}` || clotHurt.texts[0].color !== UI.blood) {
  errors.push(`拾血红字不对：${JSON.stringify(clotHurt.texts)}（应一条 +${BLOOD_CLOT_HEAL}、颜色 UI.blood）`);
}
if (clotEdge.player.hp !== 40 || (clotEdge.texts[0] || {}).damage !== '+1') {
  errors.push(`差 1 血时吃了回 2 的血块，hp=${clotEdge.player.hp}、字面=${clotEdge.texts[0] && clotEdge.texts[0].damage}：封顶或飘字取的不是实际回复量`);
}
if (!(clotNear.moved > 0) || clotNear.clot.collected || clotNear.player.hp !== 20) {
  errors.push(`磁吸没跑（移动 ${clotNear.moved.toFixed(1)}px）或者还没碰上就结算了：拾取范围这条改不了体验`);
}
if (clotFar.moved !== 0) {
  errors.push(`磁吸半径外那颗也自己飞过来了（移动 ${clotFar.moved.toFixed(1)}px）：pickupRange 这道门没生效`);
}
// Enemy.init 必须复位 mutant（对象池约定）。漏了不会当场出问题，只会在池化接上之后污染后面所有刺头
{
  const e = new Enemy('basic', MONSTER_TYPES.basic);
  e.init(0, 0);
  e.mutant = true;
  e.init(0, 0);
  if (e.mutant) errors.push('Enemy.init 没把 mutant 复位：一旦接上对象池，第一只突变体会污染后面所有刺头');
}

// —— 嗜血纯检：这一条才是「0.5% / 一口 N 血 / 满血浪费」三条口径的凭据。
//   现场样本证不了概率（0.5% 下 900 秒只期望几口，跑一万次也报不出「恰好 0.5%」），
//   所以把 Math.random 钉到两端、直接驱动原型，一次一条口径
function leechRun(stacks, hp, maxHp) {
  const player = Object.create(Player.prototype);
  player.x = 0; player.y = 0; player.radius = 14;
  player.hp = hp; player.maxHp = maxHp; player.leech = stacks;
  const texts = [];
  const db = { addDamageText(x, y, damage, isCrit, color) { texts.push({ damage, color }); } };
  const healed = Player.prototype.onKill.call(player, db);
  return { player, healed, texts };
}
const prevRandom = Math.random;
const canForce = LEECH_CHANCE > 0; // LEECHP=0 那趟里 `0 >= 0` 也算不命中，必触发那几条无从证明，直接跳过
let leechOne; let leechA; let leechB; let leechC; let leechE; let leechD;
Math.random = () => 0;
leechOne = leechRun(1, 10, 40);
leechA = leechRun(3, 10, 40);
leechB = leechRun(3, 39, 40);
leechC = leechRun(3, 40, 40);
leechE = leechRun(0, 10, 40);
Math.random = () => 1;
leechD = leechRun(10, 10, 40);
Math.random = prevRandom;
if (canForce) {
  if (leechOne.healed !== 1 || leechOne.player.hp !== 11) {
    errors.push(`1 层必触发回了 ${leechOne.healed} 点（应 1）：层数买的是概率不是回血量，口径 1 被改写`);
  }
  if (leechA.healed !== 3 || leechA.player.hp !== 13) {
    errors.push(`3 层必触发回 ${leechA.healed} 点、hp=${leechA.player.hp}（应 3 / 13）：一口的量不是层数`);
  }
  if (leechA.texts.length !== 1 || leechA.texts[0].damage !== '+3' || leechA.texts[0].color !== UI.blood) {
    errors.push(`嗜血红字不对：${JSON.stringify(leechA.texts)}（应一条 +3、颜色 UI.blood）`);
  }
  if (leechB.player.hp !== 40 || leechB.healed !== 1 || (leechB.texts[0] || {}).damage !== '+1') {
    errors.push(`差 1 血时触发一口 3 血，hp=${leechB.player.hp}、返回 ${leechB.healed}、字面=${(leechB.texts[0] || {}).damage}：封顶或飘字报的不是实际回复量`);
  }
  if (leechC.healed !== 0 || leechC.player.hp !== 40 || leechC.texts.length !== 0) {
    errors.push(`满血触发返回 ${leechC.healed}、飘字 ${leechC.texts.length} 条：口径 2 是「照掷、白白浪费」，不该有红字这种假反馈`);
  }
  if (leechE.healed !== 0 || leechE.player.hp !== 10 || leechE.texts.length !== 0) {
    errors.push(`0 层也回了血（${leechE.healed}）：leech <= 0 那道短路没生效，下面那条关掉等价式不成立`);
  }
}
if (leechD.healed !== 0 || leechD.player.hp !== 10 || leechD.texts.length !== 0) {
  errors.push(`掷不中还是回了血（${leechD.healed}）：LEECH_CHANCE 那道门形同虚设`);
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

// —— 炸弹纯检：抛物线、落点选择、多枚不去重。
//   实场那一遍量不准这三条（怪会死、会有减伤、会随机开出别的加成），所以公式本身在这里单独对
const FDT = 1 / 60;
const CENTER = { x: ARENA_W / 2, y: ARENA_H / 2 }; // 落点要躲开海岸：场地中心离四条边都远，clampToCoast 不会来搅

function dummyEnemy(x, y) {
  return { x, y, radius: 12, isDead: false, hits: 0, lastDmg: 0, takeDamage(d) { this.hits++; this.lastDmg = d; } };
}
function dummyDb(player, enemys) {
  return { player, enemys, bombs: [], pool: { getItemByClass: (name, Class) => new Class() } };
}
const clampMs = (v) => Math.min(BOMB_FLY_MAX, Math.max(BOMB_FLY_MIN, v));

// 1) 飞行全程：逐帧 update + draw 跑成一条真实的画面序列，画走全局 ctx 所以 NaN 和负半径都会被记进 errors
{
  const b = new Bomb();
  let booms = 0;
  b.init(CENTER.x, CENTER.y, CENTER.x + 300, CENTER.y, 40);
  b.detonate = function (db) { booms++; Bomb.prototype.detonate.call(this, db); };
  if (Math.abs(b.flyMs - clampMs((300 / BOMB_H_SPEED) * 1000)) > 1e-6) {
    errors.push(`300px 的投掷距离 flyMs=${b.flyMs.toFixed(1)}，不等于夹逼后的时长`);
  }
  if (b.flyMs <= BOMB_FLY_MIN || b.flyMs >= BOMB_FLY_MAX) {
    errors.push(`300px（本应夹在两段中间）撞上了限：时长不是随距离连续变化的`);
  }
  let peakZ = 0; let frames = 0;
  for (let i = 0; i < 400 && !b.isDestroyed; i++) {
    b.update(FDT, dummyDb(null, []));
    if (b.blastT < 0 && b.z < 0) errors.push(`抛物线出现负高度 z=${b.z.toFixed(3)}：落影会翻到弹体上面去`);
    if (b.blastT < 0 && b.z > peakZ) peakZ = b.z;
    b.draw(ctx);
    frames++;
  }
  if (booms !== 1) errors.push(`一枚炸弹飞完全程引爆了 ${booms} 次（应为 1）`);
  if (peakZ < b.zMax * 0.9) errors.push(`抛物线顶点只到 ${peakZ.toFixed(1)}，接近不了 zMax=${b.zMax.toFixed(1)}：这条弧线是扁的`);
  if (b.x !== b.tx || b.y !== b.ty) errors.push('引爆时弹体没有停在落点上');
  if (b.z !== 0) errors.push('落地那一帧高度没归零，弹体会悬在半空炸');
  const expectFrames = Math.round((b.flyMs + BOMB_BLAST_MS) / 1000 / FDT);
  if (Math.abs(frames - expectFrames) > 2) {
    errors.push(`爆风活了 ${frames} 帧，按 BOMB_BLAST_MS 应为 ${expectFrames} 帧：表现时长和常量对不上`);
  }
  for (let i = 0; i < 5; i++) { b.update(FDT, dummyDb(null, [])); b.draw(ctx); }
  if (booms !== 1) errors.push('已回收的炸弹还在继续引爆');
}
// 2) 时长两端夹逼：下限保证贴脸那枚也有抛物线（不是"贴"），上限保证超远投掷不会挂着不落
{
  const near = new Bomb(); near.init(100, 100, 160, 100, 10);
  const far = new Bomb(); far.init(100, 100, 5100, 100, 10);
  if (near.flyMs !== BOMB_FLY_MIN) errors.push(`60px 的贴脸投掷 flyMs=${near.flyMs}，没夹到下限`);
  if (far.flyMs !== BOMB_FLY_MAX) errors.push(`5000px 的超远投掷 flyMs=${far.flyMs}，没夹到上限`);
}
// 3) 爆风命中集：判定用的是「爆风半径 + 怪半径」，圈边的怪不该凭空气吞一发
{
  const edge = new Bomb(); edge.init(CENTER.x, CENTER.y, CENTER.x, CENTER.y, 40);
  const inside = dummyEnemy(CENTER.x + BOMB_BLAST_R + 12 - 1, CENTER.y);
  const outside = dummyEnemy(CENTER.x + BOMB_BLAST_R + 12 + 1, CENTER.y);
  edge.detonate(dummyDb(null, [inside, outside]));
  if (inside.hits !== 1) errors.push('贴着爆风边缘内侧 1px 的怪没被打到：命中判定漏在半径相加那一步');
  if (outside.hits !== 0) errors.push('爆风外 1px 的怪被打到了：命中判定没有收在 blastR + radius 上');
}
// 4) 多枚不去重：两枚砸同一只怪就是两份完整伤害，这正是「多扔一枚」的收益本体
{
  const target = dummyEnemy(CENTER.x, CENTER.y);
  const db = dummyDb(null, [target]);
  for (let i = 0; i < 2; i++) {
    const b = new Bomb(); b.init(CENTER.x - 100, CENTER.y, CENTER.x, CENTER.y, 40);
    b.detonate(db);
  }
  if (target.hits !== 2) errors.push(`两枚炸弹砸同一只怪只结算了 ${target.hits} 次：跨枚去重把层数收益抹平了`);
}
// 5) 落点选最密的一团，不是最近的一只：砸散兵亏掉的是整整一轮 BOMB_CD 冷却
{
  const bomber = new Bomber();
  bomber.x = CENTER.x; bomber.y = CENTER.y;
  const p = { attackRange: 320 };
  const solo = { x: CENTER.x + 120, y: CENTER.y };
  // 成对那团必须真和散兵隔开：放在 150 时它离散兵只有 31px，仍在爆风半径内，
  // 三只的邻居数会打成 2-2-2，「同票取近」又选回散兵，这条用例就白写
  const pair = [{ x: CENTER.x + 300, y: CENTER.y - 10 }, { x: CENTER.x + 300, y: CENTER.y + 10 }];
  const spot = bomber.densestSpot(dummyDb(p, [dummyEnemy(solo.x, solo.y), ...pair.map((q) => dummyEnemy(q.x, q.y))]), p);
  if (!spot) errors.push('密集度索敌在场上有怪时返回了空');
  else if (Math.abs(spot.y - CENTER.y) < 1) {
    errors.push('落点选了更近的那只散兵：密集度那条判据没生效，挑的还是最近的一只');
  }
  const dead = dummyEnemy(CENTER.x + 150, CENTER.y); dead.isDead = true;
  if (bomber.densestSpot(dummyDb(p, [dead]), p)) errors.push('落点选中了已死的怪');
  const faraway = dummyEnemy(CENTER.x + 400, CENTER.y);
  if (bomber.densestSpot(dummyDb({ attackRange: 320 }, [faraway]), { attackRange: 320 })) {
    errors.push('索敌距离外的怪进了候选：炸弹会为了打不着的怪空转冷却');
  }
}
// 6) 一轮枚数 = player.bomber，伤害现读攻击力；第一枚永远正砸中心
{
  const player = { attackRange: 320, attack: 23, bomber: 3, critRate: 0 };
  const db = dummyDb(player, [dummyEnemy(CENTER.x, CENTER.y)]);
  const bomber = new Bomber();
  bomber.x = CENTER.x; bomber.y = CENTER.y;
  if (!bomber.volley(db, player)) errors.push('场上有怪时 volley 仍返回 false：投掷那条路没走通');
  if (db.bombs.length !== 3) errors.push(`3 层扔出 ${db.bombs.length} 枚：层数和枚数不再是 1:1`);
  for (const b of db.bombs) {
    if (b.damage !== bombDamage(23)) errors.push(`单枚伤害 ${b.damage}，应为 ${bombDamage(23)}`);
  }
  const rads = db.bombs.map((b) => Math.hypot(b.tx - CENTER.x, b.ty - CENTER.y));
  if (rads[0] > 1) errors.push(`第一枚偏出密集中心 ${rads[0].toFixed(1)}px：最疼的那一发应该正砸目标`);
  if (!(rads[1] < rads[2])) errors.push('第二枚比第三枚更远：落点外摊的顺序乱了');
  const empty = new Bomber(); empty.x = CENTER.x; empty.y = CENTER.y;
  if (empty.volley(dummyDb(player, []), player)) errors.push('场上没怪也照样空扔一轮：冷却被白白耗掉');
  // 三个冷却阶段各画一遍：0 / 0.5 / 1 正好卡在 drawCharge 那个「后半程才画」的起点两侧，
  // 弧的行程由 (cdT/BOMB_CD - 0.5) * 2 推出，最容易出 0 长度或负角度的就是这一处
  for (const k of [0, 0.5, 1]) {
    empty.cdT = BOMB_CD * k;
    empty.draw(ctx);
  }
}

// 暂停详情页的文案探针：把八种加成挂满，逼八行 describe 各拼一次并真画出来。
// ★这类 bug 只住在字符串里：bombDamage 收攻击力却传了整个 player，游戏照跑、数值检查全绿，
//   只有详情页那一行写成「单枚 NaN 点」。不扫文本就永远发现不了
{
  const real = databus.player;
  const probe = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
  // 一刀切写 3 不行：count 是各格自己的口径（子弹数从 1 起算、拾取范围存的是像素），
  // 全写 3 会让 pickupRange 算出负层数、被 ownedItems 当"没拾取过"滤掉，那一行就永远扫不到
  const OWNED = { bulletCount: 4, pierce: 3, shield: 3, companions: 3, bomber: 3, burnBullets: 3, pickupRange: 170, leech: 3 };
  for (const k in OWNED) probe[k] = OWNED[k];
  probe.shieldBroken = 0;
  databus.player = probe;
  // 临时把 measureText 报成 0：wrapLines 判的是「这行加一个字还塞得下吗」，
  // 报 0 才是永远不折行；报大宽度会每字符折一行，配上 slice(0,2) 只剩头两个字，NaN 那半句根本进不了文本
  ctx.measureText = () => ({ width: 0 });
  const before = drawnTexts.size;
  databus.pauseScreen.visible = true;
  databus.pauseScreen.draw(ctx);
  databus.pauseScreen.visible = false;
  delete ctx.measureText;
  databus.player = real;
  if (drawnTexts.size === before) errors.push('暂停详情页一行文字都没画出来：这条文案检查是空跑的');
  // 逐格点名：哪一行没被画出来，上面那条总量检查是发现不了的（它只要求"有字"）
  for (const t of ITEM_BAR) {
    if (!drawnTexts.has(t.name)) errors.push(`详情页没画出「${t.name}」这一行：ITEM_BAR 有格但 describe 走不到它`);
  }
}
const badTexts = [...drawnTexts].filter((t) => /NaN|undefined|Infinity/.test(t));
if (badTexts.length) errors.push(`界面文字里出现非法数值 ${badTexts.length} 条：${badTexts.slice(0, 3).join(' | ')}`);

// —— 注册面扫描：这一节专治静默失效。漏一处不是崩，是 HUD 少一格、或者开箱有 toast 而什么都不涨
{
  const src = (rel) => fs.readFileSync(path.join(COPY, rel), 'utf8');
  const themeSrc = src(path.join('ui', 'theme.js'));
  const pauseSrc = src(path.join('ui', 'pause.js'));
  if (ITEM_BAR.length !== BONUSES.length) {
    errors.push(`HUD 道具体 ${ITEM_BAR.length} 格、金匣池 ${BONUSES.length} 种：加了一种没同步另一种`);
  }
  const probe = new Player();
  for (const b of BONUSES) {
    if (!Object.prototype.hasOwnProperty.call(probe, b.key)) {
      errors.push(`金匣 key '${b.key}' 不是 Player 的自有属性：chest 那句裸 player[key] += step 会加到 undefined 上，开箱有提示、游戏无变化`);
    }
    if (!ITEM_BAR.some((t) => t.glyph === b.key)) {
      errors.push(`金匣 '${b.key}' 在 HUD 没有对应格：玩家永远看不到自己捡到了它`);
    }
  }
  for (const t of ITEM_BAR) {
    if (!themeSrc.includes(`case '${t.glyph}'`)) errors.push(`theme.js 的 itemGlyph 没有 '${t.glyph}' 分支：HUD 上它会被画成普通白圈`);
    if (!pauseSrc.includes(`case '${t.glyph}'`)) errors.push(`pause.js 的 describe 没有 '${t.glyph}' 分支：详情页那一行的说明是空的`);
  }
  for (const rel of [path.join('player', 'bomb.js'), path.join('player', 'bomber.js')]) {
    const s = src(rel);
    // 读墙上时钟会在三选一面板期间偷跑（main.js 那时跳过 databus.update），面板一关就连发
    if (s.includes('Date.now(')) errors.push(`${rel} 里出现 Date.now(：计时必须按 dt 累加`);
    // 绕过 takeDamage 会跳过减伤、膜、飘字和掉落，Boss 战会被这行代码悄悄改写
    if (/\.hp\s*[-+*]?=/.test(s)) errors.push(`${rel} 直接写了 e.hp：伤害必须走 Enemy.takeDamage`);
  }
}

console.log('---');
console.log('drawn textures:', [...drawnSrc].sort().join(', ') || '(none)');
console.log('player texture:', playerSpriteSrc, '| rotate calls:', rotateCalls, '| muzzle flash:', sawFlash);
console.log('peak lasers:', maxLasers, '| peak zones:', maxZones);
console.log('peak film:', filmPeak, '| film breaks:', filmBreaks, '| colonies:', colonySeen.size, 'peak', maxColonies);
console.log('slowed frames:', slowFrames, 'of', frames);
console.log('poisoned frames:', poisonFrames, '| poison ticks:', poisonTicks);
console.log('boss drops:', bossDrops, '| boss chest:', BOSS_CHESTS_ENABLED
  ? `on (${sawBossChest ? 'dropped' : 'NOT dropped'} / pet ${sawPet ? 'granted' : 'NO'} / peak pets ${maxPets})`
  : `off (${sawBossChest ? '泄漏' : '0 只匣'} / peak pets ${maxPets})`);
console.log('chest spawns (luck=' + LUCK + '):', chestStamps.length,
  '| avg gap:', avgGap.toFixed(1) + 's', '| worst gap:', worstGap.toFixed(1) + 's',
  '| first:', chestStamps.length ? chestStamps[0].toFixed(1) + 's' : '-');
console.log('chest chance:', CURVE_POINTS.map((l, i) => `${l}→${(curve[i] * 100).toFixed(2)}%/${chestExpectedSeconds(l).toFixed(1)}s`).join(' '));
console.log('burn (stacks=' + BURN + '):', burnTicks, 'ticks /', burnDmg, 'dmg | peak burning:', maxBurning,
  '| pure cadence: 1层=' + burn1.ticks + '跳·' + burn1.dmg + '血, 3层=' + burn3.dmg + '血, 中途补枪=' + burnRefresh.ticks + '跳·单跳最大' + burnRefresh.maxTick);
console.log('bomb (stacks=' + BOMBER + '):', fieldThrown, 'thrown /', fieldBooms, 'boomed | peak in flight:', maxBombs,
  '| entity peak: companion', companionPeak, 'bomber', maxBombers);
console.log('mutant (chance=' + MUTANT_CHANCE + '):', fieldMutants, 'spawned /', mutantDeaths, 'killed /', fieldDrops,
  'clots, field peak', fieldPeak, '| eaten in main loop:', clotEats,
  `| pure: 满血${clotFull.clot.collected ? '被吞' : '未吞'} 残血hp${clotHurt.player.hp} 封顶hp${clotEdge.player.hp}(${clotEdge.texts[0] && clotEdge.texts[0].damage})`);
console.log('leech (stacks=' + LEECH + ', chance=' + LEECH_CHANCE + '):', leechCalls, 'calls /', leechProcs,
  'procs /', leechHp, 'hp back (clamp-aware expect ' + leechRoom + ')',
  `| 一局 ${fieldKills} 杀 ≈ ${(fieldKills * LEECH_CHANCE).toFixed(1)} 口 = 1层 ${(fieldKills * LEECH_CHANCE).toFixed(1)} 血 / 3层 ${(fieldKills * LEECH_CHANCE * 3).toFixed(1)} 血`,
  `| pure: ${canForce ? `1层${leechOne.healed} 3层${leechA.healed} 封顶${leechB.healed} 满血${leechC.healed} 0层${leechE.healed}` : '跳过（LEECHP=0 钉死不触发）'}`);
console.log('companion volleys:', volleyRounds, '| per volley:', volleySizes.size ? [...volleySizes].join('/') : '-',
  '(pinned stacks=' + COMPANIONS + ')');
console.log('damage texts: peak', maxTexts, 'of cap', DAMAGE_TEXT_MAX, '| suppressed', suppressedTexts, 'of', totalTexts,
  `(${totalTexts ? (suppressedTexts / totalTexts * 100).toFixed(1) : '0.0'}%)`);
console.log('non-finite ctx args:', nonFinite, '| errors:', errors.length);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
