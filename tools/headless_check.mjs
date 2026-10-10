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

// 双子的出场时刻也改副本钉值：TWINS=1 把 boss4 的最早出场时刻从 480 秒压到 150 秒。
// ★必须有这一条：480 那一档走的是「上一只死 + BOSS_RESPAWN_GAP 120 秒」的节奏，
//   900 秒的测试局很可能整局都不出场，那样下面每一条双子断言都是空跑 —— 读到的零是抽样零，不是代码零
// ★光钉 time 还不够：调度门是 bossRest > GAP && elapsed > next.time，而指针要先走完 boss1/2/3 三行，
//   每行都得等上一只死了再 +120 秒。所以 TWINS=1 还要在循环里把 bossIndex 直接按到 boss4 那一行（见下）
const TWINS = process.env.TWINS;
if (TWINS !== undefined) {
  const f = path.join(COPY, 'npc', 'monster', 'config.js');
  const code = fs.readFileSync(f, 'utf8');
  const re = /export const BOSS_FOURTH_SPAWN_TIME = \d+/;
  // ★同样用 re.test() 判命中，不比替换前后的字符串
  if (!re.test(code)) errors.push(`副本 config.js 里找不到 BOSS_FOURTH_SPAWN_TIME，TWINS=${TWINS} 这一组等于没跑`);
  else fs.writeFileSync(f, code.replace(re, `export const BOSS_FOURTH_SPAWN_TIME = ${TWINS === '1' ? 150 : 480}`));
}

const mainMod = await import(fileUrl(path.join(COPY, 'main.js')));
const databusMod = await import(fileUrl(path.join(COPY, 'databus.js')));
const {
  BOSS_CHESTS, BOSS_CHESTS_ENABLED, BOSS_XP_GEMS, chestChance, chestExpectedSeconds,
  CHEST_FIRST_ROLL, CHEST_PITY, CHEST_CHANCE_BASE, CHEST_CHANCE_EXTRA,
  MONSTER_TYPES, MUTANT_CHANCE, BLOOD_CLOT_HEAL,
  BOSS_SCHEDULE, CODEX_ORDER, BOSS_FOURTH_SPAWN_TIME,
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
const Vesicle = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'vesicle.js')))).default;
const BossTwins = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'bossTwins.js')))).default;
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
let gameOverAt = -1;    // 第一次 game over 的游戏时刻（秒），-1 = 活到了最后：
                        //   玩家一死 main.js 就不再驱动 databus.update，这一秒之后的每一条实场读数都是冻结帧上的旧值

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

// —— 双子（四号 Boss）——
// 期望值一律从出场表读，不在断言里硬写 2：pair 是配置项，硬写等于把「改配置要同步改测试」这条规矩反着立
const boss4Index = BOSS_SCHEDULE.findIndex((s) => s.type === 'boss4');
const twinPair = boss4Index >= 0 ? (BOSS_SCHEDULE[boss4Index].pair || 1) : 1;
// 成对出场按「spawnBoss 那一帧新增的那一组」登记，不靠逐帧扫 enemys：
// 两只同 hp、同削血节奏时会死在同一帧，逐帧数只能读到「一直 2 → 一下 0」，出场事件一次都抓不到
const twinsGroups = [];      // 每次出场的两只（对象引用）
let twinsPeak = 0;           // 同屏 boss4 只数峰值：pair 语义的唯一读数
let twinsEnraged = false;    // 是否真读到过 enraged = true 的活体
let twinsRageCd = Infinity;  // 激怒态实际生效的最小 throwCd
let twinsPlainCd = 0;        // 平时态实际生效的最大 throwCd
let twinsThrowReady = 0;     // 抛弹冷却「到过点」的次数（一次到点只记一遍）
let twinsThrowBlocked = 0;   // 其中被 throwMinDist 挡下的次数：站桩测台上玩家一直贴脸，这一支就会整场 0 枚
const twinsThrowArmed = new WeakMap(); // 上一帧是否已在到点状态：只在跳变那一帧记一次，否则每帧 +1
let twinsBursts = 0;         // 自溶爆起爆次数（包实例的 detonateSelf）
const twinsAlive = new Set();   // 还在场的 boss4（按对象身份登记，召唤那一帧就记）
let twinsDeaths = 0;         // 死掉并被回收的双子只数：激怒断言的门控 —— 要"真死过一只"才谈得上丧兄
let vesiclesThrown = 0;      // 囊泡抛枚数（包 Vesicle.prototype.init，纯检前要快照）
let vesicleBooms = 0;        // 囊泡落地引爆次数
let maxVesicles = 0;         // 同屏在飞囊泡枚数峰值：两兄弟同时抛时应该能到 2 枚以上
let vesicleHits = 0;         // 囊泡真砸到玩家的次数（applyBlast 参数 = vesicleDamage）
let burstHits = 0;           // 自溶爆真砸到玩家的次数（参数 = burstDamage）
let blastCalls = 0;
let blastDmg = 0;            // 结算到的总伤害：> 0 才证明第 ★1 条通道不是白写的
const stainZonesSeen = new Set(); // 按对象身份数毒渍：zone 走对象池，长度数不出「出现过几片」
const zoneTintPeak = new Map();   // tint → 并发峰值：★赤潮那一桶必须逐值不变，否则新池污染了旧池

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

// 成对出场只能在召唤入口这一帧抓：两只同一帧进数组，逐帧扫 enemys 数不出「哪一帧算一次出场」。
// 委托式包装保留原行为，只把这一帧新增的 boss 存成一组给下面的断言用
{
  const spawner = databus.spawner;
  const origBoss = Object.getPrototypeOf(spawner).spawnBoss;
  spawner.spawnBoss = (db, entry) => {
    const before = db.enemys.length;
    const r = origBoss.call(spawner, db, entry);
    if (entry && entry.type === 'boss4') {
      const group = db.enemys.slice(before).filter((e) => e.isBoss);
      twinsGroups.push(group);
      for (const b of group) twinsAlive.add(b);
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
  // ★constructor 守卫：Vesicle extends Bomb 且它的 init 第一句就是 super.init，
  //   不加这一条的话双子抛的每一枚都会计进「玩家炸弹跟班扔了几枚」，那条报表整列被敌我混合污染
  proto.init = function (...args) {
    if (this.constructor === Bomb) bombsThrown++;
    return origInit.apply(this, args);
  };
  const origDetonate = proto.detonate;
  proto.detonate = function (db) {
    if (this.constructor === Bomb) bombBooms++;
    return origDetonate.call(this, db);
  };
}

// 囊泡另包一对：口径和上面炸弹那两条完全平行（抛枚数 / 落地引爆数），只是分母换成双子的
{
  const proto = Vesicle.prototype;
  const origInit = proto.init;
  proto.init = function (...args) { vesiclesThrown++; return origInit.apply(this, args); };
  const origDetonate = proto.detonate;
  proto.detonate = function (db) { vesicleBooms++; return origDetonate.call(this, db); };
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
  // 爆发伤害的实场计数：★包实例不包原型，理由和上面 onKill 那条一样 ——
  //   下面双子那节的纯检会直接 Player.prototype.applyBlast.call(假玩家)，挂原型会把纯检算进现场账。
  //   按传入的 amount 分家：囊泡 = vesicleDamage、自溶爆 = burstDamage，两个数在 config 里刻意不同，
  //   所以砸中的是哪一下读得出来；测台每帧回满血，所以 hp 掉多少量不到，只能记这条通道的结算参数
  if (p && !p.__blastHooked) {
    p.__blastHooked = true;
    const orig = p.applyBlast;
    const cfg4 = MONSTER_TYPES.boss4;
    p.applyBlast = function (amount) {
      blastCalls++;
      blastDmg += Math.max(1, amount - this.defence);
      if (amount === cfg4.vesicleDamage) vesicleHits++;
      else if (amount === cfg4.burstDamage) burstHits++;
      return orig.call(this, amount);
    };
  }
  // 双子实例钩子：detonateSelf 只在实例上包一次（同上，纯检直接驱动原型），起爆次数才算得准
  for (const e of databus.enemys) {
    if (e.type !== 'boss4' || e.__burstHooked) continue;
    e.__burstHooked = true;
    const orig = e.detonateSelf;
    e.detonateSelf = function (db) { twinsBursts++; return orig.call(this, db); };
  }
  // TWINS=1 刻意【不垫血条】：双子这两下（自溶爆 18 + 囊泡 10）不吃无敌帧，本来就是这个 Boss 唯一
  //   能在单帧里打穿初值 40 血的攻击，垫高了就等于把这条威胁从测试台上抹掉。
  //   实测 2026-10-10 降到 18/10 之后 TWINS=1 跑满 900 秒 game over 没触发、deaths 2、激怒照判。
  //   将来谁把这两个数调回去、玩家因此在双子倒下之前死掉，下面第二条空跑防护会直接报错，不要回到这里加 crutch
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
  // TWINS=1：把 Boss 指针按到 boss4 那一行。★只钉 config 里的 time 不够 —— 指针要先走完
  //   boss1/2/3 三行，每行都得等上一只死了再攒满 120 秒冷却，短局里那条门根本过不去，
  //   双子一次不出场而每一条双子断言都读成"通过"，那就是空跑
  if (TWINS === '1' && boss4Index >= 0 && databus.spawner.bossIndex < boss4Index) {
    databus.spawner.bossIndex = boss4Index;
  }
  // bot 站桩没输出，打不动 3000 血的 Boss：出场表会永远停在第一条，
  // 二号 Boss 的激光/赤潮分支一行都跑不到。这里按秒削 Boss 的血，让三只 Boss 在 480 秒里都轮到
  // ★★必须遍历场上每一只 Boss：find 只削得到第一只，双子那一档第二只会一直活着，
  //   「丧兄激怒」这条边一次都触发不到，而血条、掉落、激怒断言全部照样绿着
  // ★游戏结束了就别削了：这段在台子外层，而 main.js 在玩家死后整段跳过 databus.update，
  //   于是每次 takeDamage 产生的那条飘字再也没有帧去让它过期 —— 削一万下就攒一万条永久飘字，
  //   「飘字上限太紧」量的其实是冻住的世界，不是游戏
  const bosses = databus.isGameOver ? [] : databus.enemys.filter((e) => e.isBoss);
  for (let bi = 0; bi < bosses.length; bi++) {
    if (i % 60 !== 0) break;
    // 第二只起隔秒削：两只同 hp、同倍率会死在同一帧，而 bossTwins.update 第一行就是 isDead return，
    //   同帧双亡等于激怒一次都没发生。只在同屏 ≥2 只时才错峰，单只那几只的削血节奏一个数都不动，
    //   film breaks / boss drops 两条基线因此可比
    if (bi > 0 && (i / 60) % 2 !== 0) continue;
    // ★必须走 takeDamage：膜王的减伤和膜的侵蚀全在这个方法里结算，
    //   直接写 boss.hp 会让整条膜路径一帧都不跑，"没破膜"就成了测试台的问题。
    //   削血量取 maxHp/15 而不是更快的击杀节奏：这个原始 DPS 必须高过膜王
    //   「菌群全部回嵌」时的膜量回补速度，否则一局只破一次膜，
    //   破膜 → 破防窗口 → 被补回去 这条循环的后半段一行都测不到
    bosses[bi].takeDamage(Math.ceil(bosses[bi].maxHp / 15), false, databus);
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
  const dyingBosses = bosses.filter((b) => b.isDead); // 本帧 checkCollisions 会给它们结算掉落
  // 膜量读数按「哪只带 filmMax」找，不按「场上第一只 Boss」：同屏两只时 find 盯错的会是一双眼睛
  const filmBoss = bosses.find((b) => b.filmMax !== undefined);
  if (filmBoss) {
    if (filmBoss.film > filmPeak) filmPeak = filmBoss.film;
    if (prevFilm > 0 && filmBoss.film <= 0) filmBreaks++;
    prevFilm = filmBoss.film;
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
  // 双子的逐帧读数：在场只数、激怒有没有真落在一只活体上、激怒前后的 throwCd 各是多少。
  // throwCd 记的是【实际生效值】而不是配置值：断言要比的是"兄弟死了以后它真的抛得更勤"
  let twins = 0;
  for (const e of databus.enemys) {
    if (e.type !== 'boss4') continue;
    twins++;
    if (e.enraged) {
      twinsEnraged = true;
      if (e.throwCd < twinsRageCd) twinsRageCd = e.throwCd;
    } else if (e.throwCd > twinsPlainCd) twinsPlainCd = e.throwCd;
    // 读条期间 bossTwins.update 提前 return、throwT 停表，所以 bursting 的那些帧不算「到点」
    const armed = !e.bursting && e.throwT >= e.throwCd;
    if (armed && twinsThrowArmed.get(e) !== true) {
      twinsThrowReady++;
      if (p && Math.hypot(p.x - e.x, p.y - e.y) < e.throwMinDist) twinsThrowBlocked++;
      twinsThrowArmed.set(e, true);
    } else if (!armed) {
      twinsThrowArmed.set(e, false);
    }
  }
  if (twins > twinsPeak) twinsPeak = twins;
  // 地面池按 tint 分桶：★新增一种毒渍必然把 maxZones 顶上去，只看总数就分不清是"多了一片渍"
  //   还是"赤潮铺得比以前凶"。赤潮那一桶逐值不变才是回归的凭据
  if (databus.zones.length) {
    const tintCount = new Map();
    for (const z of databus.zones) {
      tintCount.set(z.tint, (tintCount.get(z.tint) || 0) + 1);
      if (z.tint === MONSTER_TYPES.boss4.stainTint) stainZonesSeen.add(z);
    }
    for (const [t, n] of tintCount) if (n > (zoneTintPeak.get(t) || 0)) zoneTintPeak.set(t, n);
  }
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
  // 玩家一死，main.js 就整段跳过 databus.update：怪停、飘字永不过期、Boss 也不再被回收成死亡事件。
  // ★这条要记账并印出来：外层那段「每秒削 Boss 血」是台子自己跑的，它不知道世界已经冻住，
  //   会接着往一条不再过期的 damageTexts 里塞字，把「飘字上限太紧」这条真断言顶红；
  //   而 twins 那行的 deaths 0 / enraged no 也会被读成「双子什么都没干」，
  //   实际是「玩家 3 秒就死了，之后的账没人跑」。有这一行才分得开回归和空跑
  if (gameOverAt < 0 && databus.isGameOver) gameOverAt = i * DT;
  // 突变体从 enemys 里消失 = 本帧它的死亡结算跑完了，血块要是有掉也就在这一帧掉
  for (const m of mutantAlive) {
    if (databus.enemys.includes(m)) continue;
    mutantAlive.delete(m);
    if (!databus.isGameOver) mutantDeaths++;
  }
  if (databus.clots.length > clotPeak) clotPeak = databus.clots.length;
  // 双子从 enemys 里消失 = 本帧它的死亡结算跑完了。激怒那条边要有「真死过一只」才判得下去
  for (const t of twinsAlive) {
    if (databus.enemys.includes(t)) continue;
    twinsAlive.delete(t);
    if (!databus.isGameOver) twinsDeaths++;
  }
  // Boss 尸体从 enemys 里消失 = 本帧 dropBossLoot 已经跑完，掉落物就在场上。
  // ★逐只过：双子同屏两只，只处理一只是「掉了一次的账」而不是「掉了几次的账」
  for (const dyingBoss of dyingBosses) {
    if (databus.enemys.includes(dyingBoss)) continue;
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
  // 囊泡走的是同一套抛物线，但它是另一条列表：★这条漏了检查的话，双子那一路的 NaN 只会表现成"弹凭空消失"
  for (const v of databus.vesicles) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
      errors.push('囊泡坐标或高度出现非有限值');
      break;
    }
  }
  if (databus.vesicles.length > maxVesicles) maxVesicles = databus.vesicles.length;
  if (databus.lasers.length > maxLasers) maxLasers = databus.lasers.length;
  if (databus.zones.length > maxZones) maxZones = databus.zones.length;
  if (p && p.img) playerSpriteSrc = p.img.__src;
  if (fillStyles.has('rgba(255,238,170,0.95)')) sawFlash = true;
  if (i % 1800 === 0) {
    const b = databus.enemys.find((e) => e.isBoss);
    console.log(`t=${(i * DT).toFixed(0)}s lvl=${p && p.level} hp=${p && Math.round(p.hp)}/${p && p.maxHp} enemies=${databus.enemys.length} kills=${p && p.kills}`
      + ` boss=${b ? b.type : '-'}${b && b.state ? ':' + b.state : ''}`
      + ` film=${b && b.film !== undefined ? Math.round(b.film) : '-'}`
      + ` lasers=${databus.lasers.length} zones=${databus.zones.length} pets=${databus.bossPets.length} burning=${burning}`
      + ` twins=${twins}${twins && twinsEnraged ? '(enraged)' : ''} vesicles=${databus.vesicles.length}`);
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

// —— 双子（四号 Boss）：先快照实场计数，再逐条断言，最后补纯检 ——
// ★快照必须排在纯检之前：下面的纯检会直接 new Vesicle 调 init/detonate，还会 Player.prototype.applyBlast
//   .call(假玩家)，不先取值的话「抛了几枚、炸了几次、砸中玩家几下」会把纯检一起算进现场账
const fieldVesicles = vesiclesThrown;
const fieldVesicleBooms = vesicleBooms;
const fieldBursts = twinsBursts;
const fieldBlastCalls = blastCalls;
const fieldBlastDmg = blastDmg;
const fieldStains = stainZonesSeen.size;
const twinsCfg = MONSTER_TYPES.boss4;

if (boss4Index < 0) {
  errors.push('BOSS_SCHEDULE 里没有 boss4 那一行：双子写好了类却永远不会出场，整节双子断言无从判起');
}
// 空跑防护：钉了 TWINS=1 却没抓到出场分组，这一组就是白跑的
if (TWINS === '1' && boss4Index >= 0 && twinsGroups.length === 0) {
  errors.push(`TWINS=1 跑了 ${seconds}s 却一组双子都没召唤出来：出场时刻压到 ${BOSS_FOURTH_SPAWN_TIME}s、指针按到第 ${boss4Index + 1} 行仍没走通调度门`);
}
// 空跑防护第二条：TWINS=1 的整条价值在「双子有几十秒可跑、至少死掉一只」，
//   而激怒 / rage 贴图 / 掉落这三条断言都以 deaths>=1 为门控 —— 玩家先死了就是门控替代码兜了底，
//   报表一片绿而三条断言一行都没判，这种跑次必须自己喊出来
if (TWINS === '1' && gameOverAt >= 0 && twinsDeaths === 0) {
  errors.push(`TWINS=1 空跑：玩家 ${gameOverAt.toFixed(1)}s 就死了（双子 ${BOSS_FOURTH_SPAWN_TIME}s 出场），一只双子都没倒下过，激怒 / rage 贴图 / 掉落三条断言这次一条都没判`);
}
for (let g = 0; g < twinsGroups.length; g++) {
  const group = twinsGroups[g];
  if (group.length !== twinPair) {
    errors.push(`第 ${g + 1} 次双子出场只到 ${group.length} 只，出场表 pair=${twinPair}：spawnBoss 那条 count 循环没走完，或者两只没进同一帧`);
    continue;
  }
  // ★漏登记 BOSS_CLASS 时 spawner 的 `|| Boss` 会兜底成毒王：血条、掉落、图鉴全绿，跑的却是冲锋 + 环形弹幕
  for (const b of group) {
    if (b.constructor.name !== 'BossTwins') {
      errors.push(`boss4 出场实例的类型是 ${b.constructor.name}：BOSS_CLASS 缺 boss4 那一行，被 || Boss 兜底成了毒王`);
      break;
    }
  }
  const mirrored = group.filter((b) => b.mirror).length;
  const marked = group.filter((b) => b.twinIndex === 1).length;
  if (mirrored !== 1) errors.push(`一次出场的 ${group.length} 只里有 ${mirrored} 只镜像：两只会画成同一个朝向，读成「同一只的残影」`);
  if (marked !== 1) errors.push(`一次出场的 ${group.length} 只里 twinIndex===1 的有 ${marked} 只：弟弟识别贴只该钉在一只身上`);
}
if (twinsGroups.length && twinsPeak !== twinPair) {
  errors.push(`同屏双子只数峰值 ${twinsPeak}，出场表 pair=${twinPair}：成对出场没有同时到场`);
}
// 技能通路：一只都已经死了，说明这一对至少活了 15 秒（测台削血的节奏），三条通路都该跑过
if (twinsDeaths >= 1) {
  // ★「这一支可达」和「这一支发生」在站桩测台上不是一回事：throwMinDist=120，而双子贴脸后就停在
  //   四十几像素处，抛弹冷却每 3.2 秒到一次点、每次都被这道门挡下 → 整场 0 枚是【正确行为】，
  //   玩家一跑开就会抛（TWINS=1 那一跑实测抛出 2 枚）。所以硬断言钉的是 throwT 这条累加链有没有走通，
  //   而不是抛出几枚；真要钉抛出与落地，交给 TWINS=1 那一跑 + 本节纯检 3 的几何往返
  if (twinsThrowReady === 0) {
    errors.push(`${twinsDeaths} 只双子活过一整轮，抛弹冷却却连一次都没到过点：throwT 的累加、throwCd 或 update 里那条择机没跑通`);
  }
  if (fieldVesicles === 0 && twinsThrowReady > twinsThrowBlocked) {
    errors.push(`有 ${twinsThrowReady - twinsThrowBlocked} 次抛弹冷却到点时玩家已经拉开到 throwMinDist 外，却一枚囊泡都没抛出：throwVesicle 或 databus.vesicles 那条列表没接上`);
  }
  if (fieldVesicleBooms > fieldVesicles) errors.push(`囊泡引爆 ${fieldVesicleBooms} 次 > 抛出 ${fieldVesicles} 枚：有枚结算了两遍`);
  if (fieldVesicles > 0 && fieldVesicleBooms === 0) errors.push(`抛出 ${fieldVesicles} 枚囊泡却一枚都没落地引爆：Vesicle.update 的滞空计时或 databus.vesicles 那条驱动没跑`);
  if (fieldBursts === 0) errors.push('双子活过一整轮却一次自溶爆都没起爆：burstCd 或「dist <= burstRadius×1.15」那道门没生效');
  if (fieldVesicles > 0 && fieldStains === 0) errors.push('囊泡落了地却一片毒渍都没留下：Vesicle.detonate 里那条 zone 生成没跑，「砸出一个坑」的口径塌了');
  // ★这一条是 applyBlast 那条新通道的存在理由：整场结算不到一下，就说明第 ★1 改造是死代码
  if (fieldBlastCalls === 0) errors.push(`双子上场过却一次都没结算到爆发伤害（抛囊泡 ${fieldVesicles} 枚、自爆 ${fieldBursts} 次）：player.applyBlast 那条通道没接上`);
  if (fieldBlastCalls > 0 && !(fieldBlastDmg > 0)) errors.push(`applyBlast 结算了 ${fieldBlastCalls} 次却累计 0 点伤害：减防把爆发吃干了，通道等于没开`);
}
// 丧兄激怒：要「真死过一只」才判得下去，光看秒数会误伤短局
if (twinsDeaths >= 1) {
  if (!twinsEnraged) {
    errors.push(`${twinsDeaths} 只双子已经死了，活着的那只却始终没进激怒态：spawner 的 twin 活引用没接上，或 update 里那句 isDead return 把自己该做的轮询也挡掉了`);
  } else {
    if (!(twinsRageCd < twinsPlainCd)) {
      errors.push(`激怒态实际生效的 throwCd=${twinsRageCd.toFixed(0)} 没比平时态 ${twinsPlainCd.toFixed(0)} 小：倍率写成了乘法，越打越慢`);
    }
    if (Math.abs(twinsRageCd - twinsCfg.throwCd / twinsCfg.enrageRate) > 1) {
      errors.push(`激怒态 throwCd 实测 ${twinsRageCd.toFixed(1)}，按配置 throwCd÷enrageRate 应为 ${(twinsCfg.throwCd / twinsCfg.enrageRate).toFixed(1)}`);
    }
  }
}
// 两张贴图都得真被画过：只写过路径没画出来，等于验收截图在看一个兜底形状
if (twinsGroups.length && !drawnSrc.has(twinsCfg.sprite)) {
  errors.push(`双子出场过却没画过平时态贴图 ${twinsCfg.sprite}：走的是 Enemy 的兜底形状`);
}
if (twinsEnraged && twinsCfg.spriteRage && !drawnSrc.has(twinsCfg.spriteRage)) {
  errors.push(`激怒态生效了却没画过 rage 贴图 ${twinsCfg.spriteRage}：enrage() 里那句换图没落地，玩家读不到「它变了」`);
}
// 三套地面池靠颜色分工，撞色等于玩家分不清「踩下去会怎样」
{
  const others = [MONSTER_TYPES.boss2 && MONSTER_TYPES.boss2.color, MONSTER_TYPES.boss3 && MONSTER_TYPES.boss3.slimeColor, twinsCfg.color].filter(Boolean);
  if (others.includes(twinsCfg.stainTint)) {
    errors.push(`毒渍色 ${twinsCfg.stainTint} 和已有地面/本体识别色撞了（对照 ${others.join(' / ')}）：三套池子叠在一张图上时读不出区别`);
  }
}
// 纯检 1：对象池复位 + 激怒倍率的算式本身（现场量不出「复位」这条，池化接上之后才会暴露）
{
  const t = new BossTwins('boss4', twinsCfg);
  t.init(CENTER.x, CENTER.y);
  if (t.throwCd !== twinsCfg.throwCd || t.burstCd !== twinsCfg.burstCd || t.enraged || t.twin || t.mirror || t.twinIndex !== 0) {
    errors.push(`BossTwins.init 的复位不完整：throwCd=${t.throwCd} burstCd=${t.burstCd} enraged=${t.enraged} twin=${!!t.twin} mirror=${t.mirror} twinIndex=${t.twinIndex}`);
  }
  const before = { throwCd: t.throwCd, burstCd: t.burstCd, speed: t.speed };
  t.mirror = true;
  t.twin = { isDead: true };
  t.enrage();
  if (!t.enraged) errors.push('enrage() 没把 enraged 翻起来：兄弟死了以后它还是原来那只');
  if (t.twin) errors.push('enrage() 后 twin 引用没断开：接上对象池后兄弟会被复用成一条 isDead=false 的新怪，等于「复活即再激怒一次」');
  if (Math.abs(t.throwCd - before.throwCd / twinsCfg.enrageRate) > 1e-6) {
    errors.push(`enrage() 后 throwCd=${t.throwCd}，应为 ${before.throwCd / twinsCfg.enrageRate}：倍率没除在冷却上`);
  }
  if (Math.abs(t.burstCd - before.burstCd / twinsCfg.enrageRate) > 1e-6) {
    errors.push(`enrage() 后 burstCd=${t.burstCd}，应为 ${before.burstCd / twinsCfg.enrageRate}：只加速了抛弹，自爆还是原样`);
  }
  if (t.throwT > before.throwCd || t.burstT > before.burstCd) {
    errors.push(`激怒那一刻 throwT=${t.throwT.toFixed(0)} burstT=${t.burstT.toFixed(0)} 已越过原冷却：丧兄瞬间会变成「齐射 + 自爆」双响，一点喘气的空间都不留`);
  }
  if (twinsCfg.spriteRage && t.img && t.img.__src !== twinsCfg.spriteRage) {
    errors.push(`激怒后贴图是 ${t.img.__src}，应为 ${twinsCfg.spriteRage}`);
  }
  t.init(CENTER.x, CENTER.y);
  if (t.enraged || t.twin || t.mirror || t.throwCd !== before.throwCd || t.burstCd !== before.burstCd
    || Math.abs(t.speed - before.speed) > 1e-6 || (twinsCfg.spriteRage && t.img && t.img.__src !== twinsCfg.sprite)) {
    errors.push('对象池复位不全：激怒过的那只复用出来会自带激怒态（贴图是红的、冷却是除过的、移速是乘过的）');
  }
}
// 纯检 2：applyBlast 这条通道的两条口径 —— 不吃无敌帧、不消耗护盾
{
  const player = Object.create(Player.prototype);
  player.x = 0; player.y = 0; player.radius = 16; player.defence = 0;
  player.hp = 100; player.maxHp = 100; player.shield = 3; player.shieldBroken = 0;
  player.invincibleUntil = now + 100000; // 正挂在受击无敌帧里（自爆的前提就是已经贴脸）
  Player.prototype.applyBlast.call(player, twinsCfg.burstDamage);
  if (player.hp !== 100 - twinsCfg.burstDamage) {
    errors.push(`无敌帧内 applyBlast 后 hp=${player.hp}（应 ${100 - twinsCfg.burstDamage}）：这条通道又被无敌帧吞掉了，就是赤潮池那笔旧账`);
  }
  if (player.shield !== 3 || player.shieldBroken !== 0) {
    errors.push(`applyBlast 吃掉了护盾（shield=${player.shield} broken=${player.shieldBroken}）：口径是护盾只挡「打到我身上的那一下」`);
  }
}
// 纯检 3：囊泡的命中几何、毒渍逐字段参数、以及「打的是玩家不是怪」
function vesicleRun(offset) {
  const hits = [];
  const player = { x: CENTER.x, y: CENTER.y, radius: 16, defence: 0, applyBlast(a) { hits.push(a); } };
  const enemy = dummyEnemy(CENTER.x, CENTER.y);
  const db = {
    player, enemys: [enemy], zones: [], bombs: [],
    pool: { getItemByClass: (name, Class) => new Class() },
  };
  const v = new Vesicle();
  v.init(CENTER.x - 120, CENTER.y, CENTER.x + offset, CENTER.y, twinsCfg.vesicleDamage,
    twinsCfg.stainTint, twinsCfg.vesicleBlastR, {
      radius: twinsCfg.stainRadius, life: twinsCfg.stainLife, damage: twinsCfg.stainDamage, hold: twinsCfg.stainHold,
    });
  v.detonate(db);
  return { hits, zone: db.zones[0], enemy };
}
{
  const on = vesicleRun(0);
  if (on.hits.length !== 1 || on.hits[0] !== twinsCfg.vesicleDamage) {
    errors.push(`正砸玩家脚下结算了 ${JSON.stringify(on.hits)}（应恰好一记 ${twinsCfg.vesicleDamage}）`);
  }
  if (on.enemy.hits !== 0) errors.push('囊泡落地扫了 databus.enemys：detonate 整段覆写却把父类那一段也跑了，方向正好相反');
  const edge = vesicleRun(twinsCfg.vesicleBlastR + 16 - 1);
  const out = vesicleRun(twinsCfg.vesicleBlastR + 16 + 1);
  if (edge.hits.length !== 1) errors.push('贴着爆风边缘内侧 1px 的玩家没被砸到：命中判定漏在「爆风半径 + 玩家半径」那一步');
  if (out.hits.length !== 0) errors.push('爆风外 1px 的玩家被砸到了：判定没收在 blastR + radius 上');
  const z = on.zone;
  if (!z) {
    errors.push('囊泡落地没有 zone 生成：那片毒渍整条不存在');
  } else if (z.tint !== twinsCfg.stainTint || z.r0 !== twinsCfg.stainRadius || z.maxLife !== twinsCfg.stainLife
    || z.damage !== twinsCfg.stainDamage || z.hold !== twinsCfg.stainHold || z.warnTime !== 0) {
    errors.push(`毒渍参数不对：tint=${z.tint} r=${z.r0} life=${z.maxLife} dmg=${z.damage} hold=${z.hold} warn=${z.warnTime}`);
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
  // —— 新增的两个文件同一条规矩 ——
  for (const rel of [path.join('npc', 'monster', 'bossTwins.js'), path.join('npc', 'monster', 'vesicle.js')]) {
    const s = src(rel);
    // ★只拦「把墙上时钟存成计时基准」这种写法：外观呼吸（Math.sin(Date.now()/260)）不算违规，
    //   enemy.js、chest.js 里早有同类用法；但 T = Date.now() 会在三选一面板期间偷跑
    if (/=\s*Date\.now\(\)/.test(s)) errors.push(`${rel} 把墙上时钟存成了计时基准：暂停期间 main.js 跳过 update，冷却会自己走完`);
    // 绕过 takeDamage / applyBlast 直接改血会跳过减伤、膜、飘字和掉落
    if (/\.hp\s*[-+*]?=/.test(s)) errors.push(`${rel} 直接写了 .hp：伤害必须走 Enemy.takeDamage 或 Player.applyBlast`);
  }
  {
    const s = src(path.join('npc', 'monster', 'bossTwins.js'));
    const at = s.indexOf('draw(ctx) {');
    if (at < 0) errors.push('bossTwins.js 里找不到 draw(ctx)：绘制那一段根本没实现');
    else if (s.slice(at).includes('Math.random(')) {
      errors.push('bossTwins 的绘制里出现 Math.random(：每帧换一个相位，截图不可复现，相位必须在构造期定一次');
    }
  }
  // —— 出场表三处对齐：数值表、图鉴、行为类 ——
  // ★漏登记不会崩，只会「血条写着双子的名字、跑的却是毒王的冲锋」或者「打过了图鉴却解锁不了」
  //   行为类那一处 spawner 没有导出 BOSS_CLASS，所以由上面双子分组的 constructor.name 兜住
  for (const entry of BOSS_SCHEDULE) {
    if (!MONSTER_TYPES[entry.type]) {
      errors.push(`BOSS_SCHEDULE 的 '${entry.type}' 在 MONSTER_TYPES 里没有数据块：spawnBoss 会拿 undefined 去 new`);
    }
    if (!CODEX_ORDER.some((c) => c.type === entry.type)) {
      errors.push(`BOSS_SCHEDULE 的 '${entry.type}' 不在图鉴 CODEX_ORDER 里：这只打过也永远解锁不了`);
    }
  }
}

console.log('---');
console.log('drawn textures:', [...drawnSrc].sort().join(', ') || '(none)');
console.log('player texture:', playerSpriteSrc, '| rotate calls:', rotateCalls, '| muzzle flash:', sawFlash);
console.log('peak lasers:', maxLasers, '| peak zones:', maxZones);
console.log('peak zones by tint:', [...zoneTintPeak.entries()].sort().map(([t, n]) => `${t}=${n}`).join(' ') || '(none)',
  `| 毒渍 tint=${MONSTER_TYPES.boss4.stainTint} 出现 ${fieldStains} 片`);
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
// ★这一行要排在 twins / mutant / boss drops 之前读到：玩家中途死了就等于此后 main.js 不再驱动世界，
//   那几行里的 0（deaths 0 / enraged no / stains 0）全是冻结帧上的旧值，不是"这条链没接上"
console.log(gameOverAt < 0
  ? 'game over: none —— 世界整局都在跑，下面所有实场读数全程有效'
  : `game over: t=${gameOverAt.toFixed(1)}s —— 此后 databus.update 停摆，实场读数全部停在这一帧，任何"0"都要先按这条判`);
// ★报表行必须读出 TWINS 钉值和这一局 boss4 的实际出场时刻：否则未来会话看到一行 0 分不清是回归还是根本没出场
console.log(`twins (TWINS=${TWINS === undefined ? 'off' : TWINS}, boss4 time=${BOSS_FOURTH_SPAWN_TIME}s):`,
  `${twinsGroups.length} groups / peak ${twinsPeak} / deaths ${twinsDeaths}`,
  `| thrown ${fieldVesicles} / boomed ${fieldVesicleBooms} / hit ${vesicleHits} / in-flight peak ${maxVesicles}`,
  `| 抛弹 cd 到点 ${twinsThrowReady} 次（被 throwMinDist 挡 ${twinsThrowBlocked}）`,
  `| bursts ${fieldBursts} / hit ${burstHits} | stains ${fieldStains}`,
  `| enraged ${twinsEnraged ? 'yes' : 'no'} (throwCd 平时 ${twinsPlainCd || '-'} → 激怒 ${twinsRageCd === Infinity ? '-' : twinsRageCd.toFixed(0)})`,
  `| blast ${fieldBlastCalls} 次 共 ${fieldBlastDmg} 点`);
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
