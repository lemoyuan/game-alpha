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
// 本帧画出来的文案：每帧 step() 前清空。drawnTexts 只答得了「整局画过没有」，
// 而「+x 逐行错开」要答的是「每一句第一次出现在第几帧」——那必须有一份按帧的账本
const frameTexts = new Set();

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
    fillText(t, ...a) { check('fillText', a); drawnTexts.add(String(t)); frameTexts.add(String(t)); },
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

// Boss 掉落道具（巨细胞核）的开关：这一件默认是开的，所以 BOSSDROP=0 才是「反常」那一组，
// 用途和上面那条正好相反 —— 钉住「关掉之后场上一个都不出现、属性一点都不涨」（见下面的两端断言）
const BOSSDROP = process.env.BOSSDROP;
if (BOSSDROP !== undefined) {
  const f = path.join(COPY, 'npc', 'monster', 'config.js');
  const code = fs.readFileSync(f, 'utf8');
  const re = /export const BOSS_DROPS_ENABLED = \w+/;
  // ★同样用 re.test() 判命中：BOSSDROP=0 那一组本来就不改字符串，比前后会假报「没命中」
  if (!re.test(code)) errors.push(`副本 config.js 里找不到 BOSS_DROPS_ENABLED，BOSSDROP=${BOSSDROP} 这一组等于没跑`);
  else fs.writeFileSync(f, code.replace(re, `export const BOSS_DROPS_ENABLED = ${BOSSDROP === '1' ? 'true' : 'false'}`));
}

// 海火核心（十字激光）单独一头旋钮：LASER=0 把副本里 BOSS_DROPS.boss2 那一行挪到一个表不读的兄弟键上，
// 于是这一件在游戏内整条不可达，而 id 仍然进 CHEST_KIND_BY_ID（建表循环吃的是 Object.values，兄弟键也在内）——
// 这样「关掉」那一端只掐掉掉落与触发，注册面扫描照旧覆盖它，不会把「表里删了一行」和「门没钉住」混报。
// ★为什么不复用 BOSSDROP：那道门管的是整张表，翻到 0 会把巨细胞核一起掐掉，A/B 读到的就不是这一件的账
const LASER = process.env.LASER;
if (LASER !== undefined && LASER !== '1') {
  const f = path.join(COPY, 'npc', 'monster', 'config.js');
  const code = fs.readFileSync(f, 'utf8');
  // ★必须先从 BOSS_DROPS 切一刀再改：BOSS_CHESTS 里也有一行 `boss2: [],`（那只匣子的机制待发），
  //   非全局 replace 命中的是先出现的那一行，于是这一组掐掉的是本来就不存在的匣子、海火核心照掉
  const at = code.indexOf('export const BOSS_DROPS = {');
  const re = /^(\s*)boss2: \[/m;
  const tail = at < 0 ? '' : code.slice(at);
  // ★用 re.test() 判命中，不比替换前后的字符串
  if (!re.test(tail)) errors.push(`副本 config.js 的 BOSS_DROPS 里找不到 boss2: [ ，LASER=${LASER} 这一组等于没跑`);
  else fs.writeFileSync(f, `${code.slice(0, at)}${tail.replace(re, '$1boss2: [], $1boss2Parked: [')}`);
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
  BOSS_CHESTS, BOSS_CHESTS_ENABLED, BOSS_DROPS, BOSS_DROPS_ENABLED, BOSS_XP_GEMS, chestChance, chestExpectedSeconds,
  CHEST_FIRST_ROLL, CHEST_PITY, CHEST_CHANCE_BASE, CHEST_CHANCE_EXTRA,
  MONSTER_TYPES, MUTANT_CHANCE, BLOOD_CLOT_HEAL,
  BOSS_SCHEDULE, CODEX_ORDER, BOSS_FOURTH_SPAWN_TIME, CHEST_KIND_BY_ID,
} = await import(fileUrl(path.join(COPY, 'npc', 'monster', 'config.js')));
const { CHEST_GRANTS } = await import(fileUrl(path.join(COPY, 'npc', 'chestGrant.js')));
// HUD 左栏那七行的 key：BOSS_DROPS 的 boost 不许有落在这七行之外的项（见下面的注册面扫描）
const { STAT_ROWS } = await import(fileUrl(path.join(COPY, 'ui', 'hud.js')));
const STAT_KEYS = STAT_ROWS.map((r) => r.key);
const Enemy = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'enemy.js')))).default;
const {
  BURN_TICK, BURN_HOLD, BURN_DMG, DAMAGE_TEXT_MAX,
  BOMB_CD, BOMB_BLAST_R, BOMB_BLAST_MS, BOMB_H_SPEED, BOMB_FLY_MIN, BOMB_FLY_MAX, bombDamage,
  ARENA_W, ARENA_H, ITEM_BAR, LEECH_CHANCE, VIAL_GAIN_CD, VIAL_OUT_CD, VIAL_OUT,
  TURRET_CD, TURRET_RANGE, TURRET_MUZZLE_LEN, TURRET_PIVOT_Y, TURRET_BULLET_RADIUS, TURRET_BULLET_COLOR, turretDamage, BULLET_RANGE_BUFFER,
  STAT_CORE_BOOST, statBoostText, STAT_POP_STAGGER, STAT_POP_MS, UPGRADES, LEVEL_UP_BONUS,
  LASER_CROSS_TELEGRAPH, LASER_CROSS_FIRE, LASER_CROSS_FADE, LASER_CROSS_SPIN,
  LASER_CROSS_WIDTH, LASER_CROSS_LEN, LASER_CROSS_DMG, LASER_CROSS_HIT_GAP, LASER_CROSS_CD, laserCrossDamage,
  canvasW, canvasH,
} = await import(fileUrl(path.join(COPY, 'consts.js')));
const { UI } = await import(fileUrl(path.join(COPY, 'ui', 'theme.js')));
// 卡片顶边要避开的那条线：wx 桩里给的是刘海机（safeTop 47 / 胶囊底边 83），详情页排版探针读这两个数
const { safeTop, capsuleBottom } = await import(fileUrl(path.join(COPY, 'render.js')));
const { BONUSES } = await import(fileUrl(path.join(COPY, 'npc', 'chest.js')));
const Player = (await import(fileUrl(path.join(COPY, 'player', 'index.js')))).default;
// 这几件实体只要 import 就够（纯检直接驱动它们的原型，不经过主循环）
const Bomb = (await import(fileUrl(path.join(COPY, 'player', 'bomb.js')))).default;
const Bomber = (await import(fileUrl(path.join(COPY, 'player', 'bomber.js')))).default;
const BloodVial = (await import(fileUrl(path.join(COPY, 'player', 'bloodVial.js')))).default;
const Turret = (await import(fileUrl(path.join(COPY, 'player', 'turret.js')))).default;
const LaserCross = (await import(fileUrl(path.join(COPY, 'player', 'laserCross.js')))).default;
const Bullet = (await import(fileUrl(path.join(COPY, 'player', 'bullet.js')))).default;
const Companion = (await import(fileUrl(path.join(COPY, 'player', 'companion.js')))).default;
const BloodClot = (await import(fileUrl(path.join(COPY, 'npc', 'bloodclot.js')))).default;
const Vesicle = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'vesicle.js')))).default;
const BossTwins = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'bossTwins.js')))).default;
const databus = new databusMod.default();

// —— Boss 掉落道具「巨细胞核」的账本 ——
// ★声明必须排在下面装钩子之前：钩子在紧接着的第一次 step() 里就可能被调到，
//   let 的暂时性死区会让那一刻抛 ReferenceError，而不是安静地少记一笔
let statPopCalls = 0;          // popStats 总调用次数：三个来源（核心/升级/选卡）加在一起
let corePopCalls = 0;          // 其中加成包 === STAT_CORE_BOOST 的 = 拾取了几截核心
let levelPopCalls = 0;         // 其中 === LEVEL_UP_BONUS 的 = 升了几级（身份比对象，不比内容）
let cardPopCalls = 0;          // 其中单 key 且 key 在 UPGRADES 里的 = 选了几张卡
let releaseCalls = 0;          // releaseStatPops 被调几次 = 三选一关了几扇门
let heldLeaks = 0;             // 面板开着却被立即盖章的条数：这些飘字会整段死在黑遮罩后面
let stuckHeld = 0;             // 面板没开却被挂起的条数：永远等不到 release，左栏会少弹字
const strayPopBoosts = [];     // 三个来源都认不出的加成包：有新的属性写入点没登记进这本账
const statPopBoosts = [];      // 核心那几次传进来的加成包，用来验「弹的字和落的属性是同一份数据」
let coreBoostCalls = 0;        // player.applyBoost(STAT_CORE_BOOST) 的次数
const coreBoostMismatch = [];  // 加前加后求差 ≠ 加成包的项，逐条留下好定位是哪个 key 断的
let sawStatChest = false;      // 场上是否出现过带 boost 的匣（掉落道具里的「巨细胞核」）：关掉开关时这条必须一直 false
let sawPetChest = false;       // 场上是否出现过带 pet 的匣（休眠的专属匣）：同上
// —— Boss 掉落道具「海火核心」（十字激光）的账本 ——
// ★这一本和上面那本分家是对的：两件掉落道具的表相邻、开关相邻，但一条链是「属性 + 弹字」、
//   另一条是「层数 + 受伤触发 + 实体扫射」，混在一本账里任何一端归零都分不清是哪件出的事
let sawDropChest = false;      // 场上出现过 BOSS_DROPS 里任意一种匣：掉落口总账，BOSSDROP 两端都读它
let sawCrossChest = false;     // 其中海火核心那一种真的掉到地上过
let boss2Drops = 0;            // 海火死了几只：0 时上面那条的零是抽样零，不能当断链判
let crossGrants = 0;           // CHEST_GRANTS.core_seafire 被调的次数 = 拾取了几截核心
let crossHpLosses = 0;         // 带着层数时「真正掉血」的次数：触发分母，用来分清抽样零和代码零
let crossBlockedShield = 0;    // 被无敌帧或盾挡下、按设计不该触发的那些次数
let crossFires = 0;            // 真正放出到场上的十字根数
let crossPeak = 0;             // 同时在场的根数峰值：CD 大于整段扫射时长时必须是 1
let crossSettles = 0;          // 扫射段的结算帧数
let crossHits = 0;             // 命中的「怪·次」总数
let crossDmg = 0;              // 十字累计造成的伤害：报 DPS 用
let crossTexts = 0;            // 十字扫射期间抽到的飘字条数：静默改造后恒为 0，非 0 即红（见海火核心那组断言）
const crossFireAt = [];        // 每次放出的时刻（毫秒，DT 累加）：相邻间隔用来验 CD
const crossHpLossAt = [];      // 每次「真正掉血」的时刻：和 crossFireAt 配对用，一根十字必须对上一次掉血
const crossInitLayers = [];    // 每根十字 init 时拿到的层数：验伤害公式与「层数只来自拾取」
let insideCross = false;       // 正在十字的 settle 里：这段时间的 Enemy.takeDamage 都算十字的战果
let frameMs = 0;               // 主循环当前的仿真时刻：钩子只在装钩子那一帧闭包一次 i，读数必须走这个
// BOSS_DROPS 全表的 id：判「这只匣子是不是掉落道具」按 id 认，不按「有没有某个字段」认。
// ★LASER=0 那一组把 boss2 那一行挪到了兄弟键 boss2Parked 上，Object.values 照样扫得到，
//   所以这张 id 集在两端都完整 —— 掐断的是掉落口，不是注册面
const DROP_IDS = new Set();
for (const kinds of Object.values(BOSS_DROPS)) for (const k of kinds) DROP_IDS.add(k.id);
const popFirstFrame = new Map(); // 每句 +x 文案第一次被画出来是第几帧：错开那条断言读这个，不读「有没有画过」
let popQueueLen = -1;          // 拾取当帧 popStats 排进队列的条数（-1 = 还没拾取过）
let popSpread = -1;            // 拾取当帧队列首尾 t0 的跨度，应等于 (行数-1) × STAT_POP_STAGGER
let popFrame0Texts = null;     // 拾取当帧画出来的文案集合
let popAtFrame = -1;           // 第一次拾取发生在主循环第几帧：错开断言的零点

// 挑三句「只可能由这七行飘字画出来」的文案当探针。★用 statBoostText 现算而不是写死字符串：
//   改了格式化函数的话，写死的那三句会一句都匹配不上，断言静默退化成空跑而不是报错。
// 挑这三句的理由：atkSpeed/critRate 带单位、speed 是 +8，三句和八张三选一卡的 desc
//   （+10 / +15% / +3 / +2 / +0.3次 / +30 / +10% / +1）一个都不撞；
//   而 attack 的 +2、luck 与 defence 的 +1 会被卡片污染，所以不拿它们做 1:1 计数
const POP_TEXTS = ['atkSpeed', 'critRate', 'speed'].map((k) => statBoostText(k, STAT_CORE_BOOST[k]));

// ★上面那段「一个都不撞」不能只写在注释里：三选一卡是本测试台自己每帧自动点掉的（up.pick(0)），
//   一旦哪天 STAT_CORE_BOOST 或卡片数值被调到撞车，按帧账本会把卡片的字记成飘字的账，
//   错开那条断言会「看着通过、其实在量别的东西」—— 这是最坏的一种假绿，所以在这里静态钉死
for (const t of POP_TEXTS) {
  const hit = UPGRADES.find((u) => u.desc === t);
  if (hit) {
    errors.push(`+x 探针文案 '${t}' 和三选一卡「${hit.label}」的 desc 撞车：`
      + `本台每帧自动点卡，drawnTexts/frameTexts 分不清这个字是谁画的，错开断言会退化成空跑。`
      + `换一句独有的探针（带单位的行最稳），或改卡面文案`);
  }
}
// 升级成长与选卡现在也弹 +x，它们画出来的文案同样不许和探针撞。成长包是静态的；加法卡的增量也是静态的；
// ★乘算移速卡的增量随当前移速变、枚举不了，但它 = round(speed×0.15)，speed 从 170 起只增不减 → 增量 ≥ 25.5，
//   与三句探针（+0.1/秒 / +3% / +8）天然不相交，这条靠下界保证而不是靠枚举
for (const src of [LEVEL_UP_BONUS, ...UPGRADES.filter((u) => !u.mult).map((u) => ({ [u.key]: u.value }))]) {
  for (const [k, v] of Object.entries(src)) {
    const t = statBoostText(k, v);
    if (POP_TEXTS.includes(t)) {
      errors.push(`+x 探针文案 '${t}' 和「${k} 加 ${v}」这次弹字撞车：升级/选卡的飘字会被记成核心的账`);
    }
  }
}

const main = new mainMod.default();
// 「巨细胞核」弹字链的实场计数：★包实例不包原型，理由和下面 leech/blast 那两条一样。
//   DataBus 是单例（databus.js:14 那句 if (instance) return instance），所以这里的 databus 就是
//   main.js 内部那一个，hud 在 Main 构造函数里已经建好，这一钩子装得上
const origPopStats = databus.hud.popStats;
databus.hud.popStats = function (boost, held) {
  statPopCalls++;
  const before = databus.hud.statPops.length;
  const r = origPopStats.call(this, boost, held);
  const isCore = boost === STAT_CORE_BOOST;
  const isLevel = boost === LEVEL_UP_BONUS;
  const isCard = !isCore && !isLevel && Object.keys(boost).length === 1
    && UPGRADES.some((u) => u.key === Object.keys(boost)[0]);
  // hold 的方向校验按来源核对声明：核心是场面上拾取的，必须立即弹；成长/选卡发生在面板会话内，
  //   必须挂起等关面板。★不读 upgradeScreen.visible 去猜：同一帧里「升级开面板」可能先于「踩匣」，
  //   猜会把核心误挂起——held 是调用方的声明，声明错了就是调用方的 bug
  const expectHeld = !isCore;
  if (isCore || isLevel || isCard) {
    if (held !== expectHeld) heldLeaks++;
    // ★不在这里判「挂起但面板没开」：关面板分支是先落 visible=false 再结溢出经验，
    //   那一级的成长声明 held 时新面板还没 show()，按调用瞬间判会假红。终态检查在下面兜
  }
  if (isCore) {
    corePopCalls++;
    statPopBoosts.push(boost);
    // 拾取当帧的结构快照：只量本次新入队的条目。★不能读整条队列——上一扇三选一关门释放的
    //   升级/选卡飘字可能还没过期（700ms + 错开），读整队会把「七行」量成十几行
    if (popQueueLen < 0) {
      const added = databus.hud.statPops.slice(before);
      popQueueLen = added.length;
      const t0s = added.map((x) => x.t0);
      popSpread = t0s.length ? Math.max(...t0s) - Math.min(...t0s) : 0;
    }
  } else if (isLevel) {
    levelPopCalls++;
  } else if (isCard) {
    cardPopCalls++;
  } else {
    strayPopBoosts.push(boost);
  }
  return r;
};
const origReleaseStatPops = databus.hud.releaseStatPops;
databus.hud.releaseStatPops = function () {
  releaseCalls++;
  return origReleaseStatPops.call(this);
};
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
// ★原先这里有一个 sawBossChest（「场上出现过带 kindDef 的匣」）。它已经拆成上面那对 sawPetChest / sawStatChest：
//   Boss 掉落道具上线后，带 kindDef 的匣有两种，混成一笔账会让「专属匣已下线」那条断言假红
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
// 血瓶层数同样钉成单变量：金匣九选一里就有它，不吞掉写入的话 VIAL=0 那趟照样会长出层数，
// 那条「关掉等价式」根本量不出来。★存量 vialDrops 不钉 —— 它正是这一组要量的因变量
const VIAL = Number(process.env.VIAL || 0);
let maxVials = 0;      // 场上血瓶只数峰值：★恒应为 1，长到 2 就是「层数当只数」回潮
let vialDropsPeak = 0; // 存量峰值：无上限那条口径的凭据，也是「液面钉满」那一段的触发依据
let vialIn = 0;        // 进账累计（自增 + 满血时的溢出），按 vialDrops 的上涨沿计
let vialOut = 0;       // 出账累计（输送到身上的滴数），按 vialDrops 的下降沿计
let vialOutTicks = 0;  // 出账发生在哪几帧：每 VIAL_OUT_CD 一次，这个数就是「输送这条路真跑过几次」
let prevVialDrops = 0; // 上一帧存量：进账/出账都靠这一帧的差值，不钩 pumpVial（钩了会把纯检那几条一起计进账）
// 炮台层数（= 场上座数）同样钉成单变量：金匣十选一里就有它，不吞掉写入的话 TURRET=0 那趟照样会长出炮台。
// ★这一种和前面几种最不一样的地方是「不封顶」，所以峰值那条断言的期望值是 TURRET 本身，不是 1
const TURRET = Number(process.env.TURRET || 0);
let maxTurrets = 0;      // 场上座数峰值：这一条同时兜住「金匣真出货 + 落位链真跑通 + 没被谁偷偷封顶」
let turretShots = 0;     // 实际开火发数。★沿判定用「上一帧 cdT 大于 0、这一帧归零」，不是「上一帧到点」：
                         //   空转时 cdT 被钉在 TURRET_CD，而有怪持续进射程的座子每次都恰好在到点那一帧开火、
                         //   cdT 直接回 0 —— 世界永不停在 armed=true 的帧上，拿「到点沿」当凭据会把连着打的那一整段整条漏掉。
                         //   只判 cdT === 0 又会在玩家死后（世界冻住、cdT 停在 0）每帧重复计一次
const turretPrevCd = new WeakMap(); // 每座上一帧的 cdT：归零沿的凭据，undefined 当作 0（出生那一帧不算开火）
// ★落座时刻推迟到 15 秒：这台子的 bot 一开局就朝一个方向走到角落才停（touch 那两下只发一次，10 秒时角色已在
//   (1836, 91)），而炮台的坐标一次写定。第 0 帧就落座等于把几座全丢在起点 —— 实测 480 秒 3 座 0 发，
//   「一发未出」那条断言必红，而 fire 的整条实场链路（索敌 → 取池 → 入列 → 命中）一次都量不到。
//   15 秒时角色已经停在怪流的中心，这几座才真在打东西
let turretOnAt = -1;      // 实际落座的游戏时刻（秒），-1 = 还没落座
const TURRET_AT = 15;
let turretScanPeak = 0;  // max(座数 × 怪数)：空闲时每帧都在扫，这是索敌开销的代理指标
let firstBossDeathAt = -1; // 首只 Boss 死亡时刻：A/B 要比的是「整条曲线」，只看炮台自己那几发看不出中期崩塌
let volleyRounds = 0;      // 跟班齐射轮数
const volleySizes = new Set(); // 每轮实际新增的子弹数：只应有一个取值且等于层数
let bombsThrown = 0;   // 扔出的枚数（按 Bomb.init 计，一轮 player.bomber 枚）
let bombBooms = 0;     // 引爆次数：理论上恒等于 bombsThrown，对不上了就是有用量没炸或有弹没飞完
let maxBombs = 0;      // 同屏在飞枚数峰值
let maxBombers = 0;    // 场上炸弹跟班只数峰值：★恒应为 1，长到 2 就是「层数当只数」回潮
let companionPeak = 0; // 同上，射击跟班也只该有一只
const chestStamps = []; // 每只金匣刷出时刻（游戏秒），用来算相邻间隔
let chestRollMax = 0;   // 全场见过的最大「距上次出货」毫秒数（spawner.chestSinceLast）
// 突变型刺头与血块。出生按对象身份数（和 colonySeen 同一条理由：只有身份能把它和杂兵区分开），
// 掉落数挂在 BloodClot.prototype.init 上
const mutantSeen = new Set();
const mutantAlive = new Set();
let mutantDeaths = 0;
let clotsDropped = 0;
let clotsDroppedNear = 0; // 其中掉在磁吸半径内的那几颗：只有这些「该」被吃掉（见下面那条实场断言）
let clotsCollected = 0;   // 真被收走几次（collected 由 false 翻 true 的那一帧计一次）
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
    if (insideCross) crossTexts++; // 静默改造前实测这个数字占全部飘字的 95.2%：现在光束走 silent，非 0 就是漏透传
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
  proto.init = function (...args) {
    clotsDropped++;
    // init 的头两个实参就是落点，趁 origInit 还没改 this.x/y 之前直接对表上的玩家算距离
    const p = databus.player;
    if (p) {
      const dx = args[0] - p.x;
      const dy = args[1] - p.y;
      if (dx * dx + dy * dy < p.pickupRange * p.pickupRange) clotsDroppedNear++;
    }
    return origInit.apply(this, args);
  };
}

// 血块被收走的次数：★10-11 之后「吃掉」和「回了血」是两件事——满血照吃、heal() 返回 0、也就没有红字，
//   所以按飘字计的那个数证明不了生命周期，只能证明「那一次身上确有缺口」。这里数 collected 的跳变本身
{
  const proto = BloodClot.prototype;
  const origUpdate = proto.update;
  proto.update = function (...args) {
    const was = this.collected;
    const r = origUpdate.apply(this, args);
    if (!was && this.collected) clotsCollected++;
    return r;
  };
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

// 十字激光的实场账：三处钩子分头钉「拾取了几次 / 放了几根 / 打了几个怪」，第四处把飘字也归到它名下。
// ★战果归属用一对 insideCross 标记，而不是给游戏代码加「谁打的」参数：
//   Enemy.takeDamage 的签名已经是四参（dmg, isCrit, databus, color），再加一个来源参数的后果是
//   下一个调用点漏传，而漏传只会让战果安静地记到普攻头上 —— 读数看着照样合理，正是最难查的那种
{
  const orig = CHEST_GRANTS.core_seafire;
  // ★注册面扫描在下面还有一条查同一个键，这里先钉一次：登记缺了的话拾取会当场 TypeError，
  //   而那一声报错在几百帧的日志里远不如一句「核心没注册」好定位
  if (!orig) errors.push('CHEST_GRANTS 里没有 core_seafire：chest.js 那句裸 CHEST_GRANTS[kind](databus) 会在拾取瞬间抛 TypeError');
  else CHEST_GRANTS.core_seafire = (db) => { crossGrants++; return orig(db); };
}
{
  const proto = LaserCross.prototype;
  const origInit = proto.init;
  proto.init = function (...args) {
    crossFires++;
    crossFireAt.push(frameMs);
    const r = origInit.apply(this, args);
    // 读的是 origInit 跑完之后的 this.damage：公式若断在 consts，这里当场和 laserCrossDamage 对不上
    crossInitLayers.push({ layers: args[0], dmg: this.damage });
    return r;
  };
  const origSettle = proto.settle;
  proto.settle = function (db) {
    crossSettles++;
    insideCross = true;
    try {
      return origSettle.call(this, db);
    } finally {
      insideCross = false;
    }
  };
}
{
  const proto = Enemy.prototype;
  const orig = proto.takeDamage;
  // ★必须原样转发全部参数：上一版把签名写死成四个，第五个 silent 在这里被吃掉，
  //   于是「光束静默」那条断言永远假红而游戏代码是对的。包别人的方法就是往里插一层，插的那层不许改口径
  proto.takeDamage = function (...args) {
    if (insideCross) { crossHits++; crossDmg += args[0]; }
    return orig.apply(this, args);
  };
}

// 嗜血的实场计数：包的是 player 实例上的方法，不包原型。
// ★理由和当年那批实例钩子一样 —— 下面那段纯检直接 `Player.prototype.onKill.call(假玩家)`，
//   挂在原型上会把纯检的五次调用一起计进现场账，procs 对不上 kills 就成了假红。
//   第一帧才装：player 是开局那一帧才 new 出来的，提前装会挂到 null 上、整组计数空跑

for (let i = 0; i < frames; i++) {
  frameMs = i * DT * 1000; // 钩子只装一次、闭包不到 i，时刻一律从这里取
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
  // 「巨细胞核」的属性落账：只在传进来的正是 STAT_CORE_BOOST 那一个对象时计数。
  // ★比对象身份而不是比内容：config.js 与这里 import 的是同一个 consts.js 模块实例（Node 的 ESM 缓存），
  //   身份相等才说明「弹字读的那份数据」和「落属性的那份数据」是同一个引用，改一个数两边一起动。
  //   applyLevelBonus 走的是 LEVEL_UP_BONUS，不会被这一条误计
  // ★量法是「调用前后各取一次再求差」，不是「整局首尾相减」：升级的 LEVEL_UP_BONUS 同样在动
  //   attack/critRate/attackRange/speed 这四项，首尾相减会把升级的账算到掉落道具头上
  if (p && !p.__boostHooked) {
    p.__boostHooked = true;
    const orig = p.applyBoost;
    // ★必须转发全部参数：databus 是左栏 +x 的触发通道、held 是「立即弹还是挂起」的声明，
    //   钩子少接一个就会把对应行为吞掉，断言全红而游戏代码其实没病
    p.applyBoost = function (bonus, databus, held) {
      if (bonus !== STAT_CORE_BOOST) return orig.call(this, bonus, databus, held);
      coreBoostCalls++;
      const before = {};
      for (const k of Object.keys(STAT_CORE_BOOST)) before[k] = this[k];
      const r = orig.call(this, bonus, databus, held);
      for (const k of Object.keys(STAT_CORE_BOOST)) {
        const got = Math.round((this[k] - before[k]) * 1000) / 1000;
        if (got !== STAT_CORE_BOOST[k]) coreBoostMismatch.push(`${k}: 期望 +${STAT_CORE_BOOST[k]}，实得 +${got}`);
      }
      return r;
    };
  }
  // 十字的触发分母：只有「这一帧真的掉血」那一下才算，破盾那一下按设计不触发，所以另记一笔。
  // ★同样包实例不包原型：下面那些纯检会直接拿假玩家调 Player.prototype 上的方法
  if (p && !p.__crossHooked) {
    p.__crossHooked = true;
    const orig = p.takeDamage;
    p.takeDamage = function (amount, now, db) {
      const hpBefore = this.hp;
      const shieldBefore = this.shield;
      const r = orig.call(this, amount, now, db);
      if (this.laserCross > 0) {
        if (this.hp < hpBefore) { crossHpLosses++; crossHpLossAt.push(frameMs); }
        else if (this.shield < shieldBefore) crossBlockedShield++;
      }
      return r;
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
  // VIAL 同理：输送那条节拍只在「残血」时才走，全程钉满的话 vialOutTicks 恒为 0，
  //   而这份 0 和「pumpVial 压根没接上」同样分不开
  if (p) p.hp = (LEECH > 0 || VIAL > 0) ? p.maxHp - 4 : p.maxHp;
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
  // 血瓶层数同理钉死。★顺带在这一帧重新播种 prevVialDrops：这一段只在一个新 player 上跑一次，
  //   而存量属于那个新对象；不播种的话跨局那一下「存量从 N 掉回 0」会被下面的差值计成一笔出账
  if (p && !p.__vialPinned) {
    p.__vialPinned = true;
    Object.defineProperty(p, 'vial', { configurable: true, get: () => VIAL, set: () => {} });
    prevVialDrops = p.vialDrops;
  }
  if (turretOnAt < 0 && i * DT >= TURRET_AT) turretOnAt = i * DT;
  // 炮台座数不管开没开都要钉：金匣十选一里就有它，不吞掉写入的话 TURRET=0 那趟照样会长出炮台，
  // 那条「关掉等价式」量不出来，TURRET=3 那趟也会顺带开出第四、五座
  if (p && !p.__turretPinned) {
    p.__turretPinned = true;
    // ★落座前恒读 0：这样第 15 秒之前既不会在起点长出座子，匣子那一下裸 += 也照样被 setter 吞掉
    Object.defineProperty(p, 'turrets', { configurable: true, get: () => (turretOnAt < 0 ? 0 : TURRET), set: () => {} });
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
  // Boss 匣只会掉在 Boss 尸体上，bot 未必走过去 → CHEST_GRANTS 和跟班/飘字的 update/draw 一行都跑不到。
  // 每帧把匣挪到玩家脚下让它真被拾取一次：跟班约 6 DPS，相对测试台每秒削掉的 maxHp/15 可以忽略，
  // 不会改写 film breaks 这条基线。
  // ★两种带 kindDef 的匣都要挪（休眠的专属匣、上线的掉落道具），但记账必须分家：
  //   kindDef.pet → sawPetChest（下线期间必须恒 false，BOSSCHEST=1 那一跑才为 true）
  //   id ∈ BOSS_DROPS → sawDropChest（整张表的总账，默认就该为 true，BOSSDROP=0 那一跑必须恒 false）
  //   kindDef.boost → sawStatChest（其中会涨属性那一种，报表分列读它）
  //   共用一个标志的后果是新道具一上线就把「专属匣已下线却还在场上掉出来」顶红，而那条其实在说另一件事
  if (p) {
    for (const c of databus.chests) {
      if (!c.kindDef) continue;
      if (c.kindDef.pet) sawPetChest = true;
      if (DROP_IDS.has(c.kindDef.id)) {
        sawDropChest = true;
        if (c.kindDef.id === 'core_seafire') sawCrossChest = true;
      }
      if (c.kindDef.boost) sawStatChest = true;
      c.x = p.x;
      c.y = p.y;
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
  // 逐帧文案账本要在 step() 之前清：step() 内部一路 update + render，清晚了就把上一帧的字也算进这一帧
  frameTexts.clear();
  step();
  // —— 「巨细胞核」那七行 +x 的按帧账本 ——
  // ★只在核心拾取发生之后才开始记：三选一卡片与升级成长现在也弹 +x，拾取前的字不该算进飘字的账
  //   （本例挑的三句和八张卡的 desc、四级成长的文案都不撞，POP_TEXTS 声明处那条静态检查把这件事钉住了）
  if (corePopCalls > 0) {
    for (const t of POP_TEXTS) {
      if (!popFirstFrame.has(t) && frameTexts.has(t)) popFirstFrame.set(t, i);
    }
  }
  // 拾取首帧的绘制快照：这一帧画面上出现了哪些文案，用来钉「逐行错开」的判别式（当帧只该有第一行）。
  // 队列结构快照（几行 / 首尾跨度）已在 popStats 钩子里量过，这里只记零点帧
  if (popAtFrame < 0 && corePopCalls > 0) {
    popFrame0Texts = new Set(frameTexts);
    popAtFrame = i;
  }
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
    if (dyingBoss.type === 'boss2') boss2Drops++;
    if (firstBossDeathAt < 0) firstBossDeathAt = i * DT;
    if (databus.xpGems.length < BOSS_XP_GEMS) {
      errors.push(`boss ${dyingBoss.type} 死亡只撒了 ${databus.xpGems.length} 颗宝石（应 ≥ ${BOSS_XP_GEMS}）`);
    }
    // ★这条只在开关为 true 时成立：专属匣已整条下线，表非空却查不到匣是设计如此，不是掉了
    // ★判据必须是 c.kindDef.pet 而不是 c.kindDef：boss1 现在同时会掉「掉落道具」那种匣，
    //   笼统地判「有没有带 kindDef 的匣」会被另一只遮住，这条就永远绿 —— 绿得毫无信息量
    if (BOSS_CHESTS_ENABLED) {
      const table = BOSS_CHESTS[dyingBoss.type];
      if (table && table.length && !databus.chests.some((c) => c.kindDef.pet)) {
        errors.push(`boss ${dyingBoss.type} 死亡没掉专属匣`);
      }
    }
    // 掉落道具的同一条：表非空却查不到这一号 Boss 该掉的那种匣，就是掉落口那道门或表本身断了。
    // ★判据是「id ∈ BOSS_DROPS[这只 Boss]」而不是「有没有 boost 字段」：那张表里两件道具的机制不同，
    //   一件涨属性、一件只涨层数，按字段认等于拿一号的口径去问二号掉没掉，海火一死就假红
    if (BOSS_DROPS_ENABLED) {
      const table = BOSS_DROPS[dyingBoss.type];
      if (table && table.length && !databus.chests.some((c) => c.kindDef && table.some((k) => k.id === c.kindDef.id))) {
        errors.push(`boss ${dyingBoss.type} 死亡没掉落道具（表里有 ${table.length} 种，场上没有一种对得上号）`);
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
  if (databus.vials.length > maxVials) maxVials = databus.vials.length;
  // 同时在场的十字根数：CD(4000) 大于整段扫射(260+1500+240=2000) 时这个峰值必须是 1，
  // 读成 2 就说明触发没被冷却挡住（十字会连成一根常驻光棒，见下面的断言）
  if (databus.laserCrosses.length > crossPeak) crossPeak = databus.laserCrosses.length;
  for (const c of databus.laserCrosses) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.spin)) errors.push('十字激光的坐标或朝向出现非有限值');
  }
  for (const v of databus.vials) {
    // 座次那条 lerp 一旦喂进非有限的朝向，瓶子会凭空从画面上消失（同 boss pet 那条的理由）
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) errors.push('血瓶坐标出现非有限值');
  }
  if (databus.turrets.length > maxTurrets) maxTurrets = databus.turrets.length;
  // 掷骰计时器走到过多远：一次匣子都没出时，这个数才是「路径在跑但没掷中」和「门根本没开」的分界
  if (databus.spawner.chestSinceLast > chestRollMax) chestRollMax = databus.spawner.chestSinceLast;
  for (const t of databus.turrets) {
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.aim)) {
      errors.push('炮台坐标或朝向出现非有限值');
      break;
    }
    // update 末尾的 cdT 只有三种取值：0（这一帧打出去了）、TURRET_CD（空转钉满）、不足一拍的累加值。
    // ★所以认一发要看「上一帧还大于 0、这一帧归零」这个下降沿，不能看上一帧是否到点：
    //   有怪持续在射程里时它每拍都在到点的那一帧直接归零，到点沿一帧都观测不到
    const prevCd = turretPrevCd.get(t);
    if (t.cdT === 0 && prevCd !== undefined && prevCd > 0) turretShots++;
    turretPrevCd.set(t, t.cdT);
  }
  // 索敌只在开火那一刻做，但空闲时 cdT 被钉满、这段扫描每帧都跑，所以开销上界是 座数 × 怪数
  const turretScan = databus.turrets.length * databus.enemys.length;
  if (turretScan > turretScanPeak) turretScanPeak = turretScan;
  // 存量按帧间差值记账：进账 = 上涨沿（自增 + 满血时的溢出，两者在实场分不开，精确拆分交给下面的纯检），
  // 出账 = 下降沿（只有 pumpVial 的输送会减它）
  const vd = p ? p.vialDrops : 0;
  const vDelta = vd - prevVialDrops;
  prevVialDrops = vd;
  if (!Number.isFinite(vd)) errors.push(`瓶内存量出现非有限值 ${vd}：heal() 大概往 undefined 上加过数`);
  if (vd < 0) errors.push(`瓶内存量出现负数 ${vd}：输送没按余额夹取，无上限那条口径被写歪了`);
  if (vDelta > 0) vialIn += vDelta;
  else if (vDelta < 0) { vialOut += -vDelta; vialOutTicks++; }
  if (vd > vialDropsPeak) vialDropsPeak = vd;
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
      + ` twins=${twins}${twins && twinsEnraged ? '(enraged)' : ''} vesicles=${databus.vesicles.length} cross=${databus.laserCrosses.length}`);
  }
}

// —— Boss 专属匣的两端断言：下线期间「整条不可达」，翻回 true 时「授予链真能跑通」 ——
// ★读的是 sawPetChest（带 kindDef.pet 的匣），不是「任何带 kindDef 的匣」：
//   后者现在恒为真（Boss 掉落道具默认上线），拿它当判据这条会永远红，而红的原因和它想说的完全无关
if (!BOSS_CHESTS_ENABLED) {
  if (sawPetChest) {
    errors.push('专属匣已下线却还在场上掉出来：main.js 的门没钉住，或者还有第二个掉落口没关');
  }
  if (maxPets) {
    errors.push(`专属匣已下线却生成过 ${maxPets} 只跟班：CHEST_GRANTS 被掉落以外的地方调用了`);
  }
} else if (bossDrops > 0 && !sawPet) {
  errors.push(`开关翻回 true、也死了 ${bossDrops} 只 Boss，却没有一只跟班：掉落→拾取→授予→bossPet 断了一环，"改回 true 即恢复"不成立`);
}

// —— Boss 掉落道具「巨细胞核」的两端断言 ——
// 这一件默认是开的，所以「关掉」那一端才是反常组：它要证明的是 main.js 那道门真的钉得住，
// 而不是「反正没人调用所以看不见」。两端都要跑，只跑一端等于没跑（同 2026-10-06 那条教训）
if (!BOSS_DROPS_ENABLED) {
  if (sawDropChest) errors.push('掉落道具已关掉却还在场上掉出来：main.js 的 BOSS_DROPS_ENABLED 那道门没钉住，或者还有第二个掉落口');
  if (corePopCalls) errors.push(`掉落道具已关掉却弹过 ${corePopCalls} 次核心 +x：CHEST_GRANTS.core_cmv 被掉落以外的地方调用了`);
  if (coreBoostCalls) errors.push(`掉落道具已关掉却给玩家加过 ${coreBoostCalls} 次全属性：applyBoost 还有别的调用口`);
  if (databus.bossChests.core_cmv) errors.push(`掉落道具已关掉但 HUD 计数里有 core_cmv ×${databus.bossChests.core_cmv}：右栏会凭空多出一格`);
  if (databus.bossChests.core_seafire) errors.push(`掉落道具已关掉但 HUD 计数里有 core_seafire ×${databus.bossChests.core_seafire}：右栏会凭空多出一格`);
  if (crossFires) errors.push(`掉落道具已关掉却放出过 ${crossFires} 根十字：层数只能由拾取那条链写进 player`);
} else {
  // 空跑防护：一只 Boss 都没死时，上面/下面这些零与「没接上」长得一模一样，必须显式说出来
  if (bossDrops === 0) {
    errors.push(`掉落道具开着却整局没有一只 Boss 死亡（bossDrops=0）：这一组读到的全是抽样零，不是代码零。把测试时长拉长再跑`);
  } else {
    if (!sawDropChest) errors.push(`死了 ${bossDrops} 只 Boss，场上却从没出现过 BOSS_DROPS 里的任何一种匣：掉落口没接上（表里 boss1 有 ${BOSS_DROPS.boss1.length} 种）`);
    if (!corePopCalls) errors.push('匣出现过却没弹一次 +x：拾取→CHEST_GRANTS.core_cmv→applyBoost→hud.popStats 断了一环');
    if (coreBoostCalls !== corePopCalls) {
      errors.push(`属性加了 ${coreBoostCalls} 次、核心 +x 弹了 ${corePopCalls} 次：授予函数里两步不同源，玩家会看到「弹了字没涨属性」或反过来`);
    }
    if (coreBoostMismatch.length) {
      errors.push(`全属性加成没逐项落对：${coreBoostMismatch.slice(0, 4).join(' | ')}`);
    }
    if (!statPopBoosts.every((b) => b === STAT_CORE_BOOST)) {
      errors.push('弹字拿到的加成包不是 STAT_CORE_BOOST 那一个对象：config 表里的 boost 被复制过一份，改数值只有一半地方跟着动');
    }
    const owned = databus.bossChests.core_cmv || 0;
    if (owned !== corePopCalls) {
      errors.push(`HUD 计数 core_cmv ×${owned} 与拾取次数 ${corePopCalls} 对不上：右栏那格与暂停页那行会少报/多报`);
    }
    // 排版结构：七行都进了队列、首尾 t0 的跨度正好是 (行数-1) × 错开。
    // ★这一条与绘制无关，所以「字被画到屏幕外」它照样绿 —— 它钉的是 popStats 的排队逻辑本身
    const wantRows = Object.keys(STAT_CORE_BOOST).length;
    if (popQueueLen !== wantRows) {
      errors.push(`拾取当帧只排进 ${popQueueLen} 条 +x（加成包有 ${wantRows} 项）：有属性涨了却没弹字，或者弹了不属于面板的行`);
    }
    if (popSpread !== (wantRows - 1) * STAT_POP_STAGGER) {
      errors.push(`+x 首尾错开 ${popSpread}ms，应为 (行数-1)×STAT_POP_STAGGER = ${(wantRows - 1) * STAT_POP_STAGGER}ms`);
    }
    // 绘制事实（判别式那一条）：拾取当帧只可能有第一行。
    // ★必须真的有区分度 —— 把 STAT_POP_STAGGER 改成 0，七行会全挤在这一帧，下面这条就该红；
    //   不红说明这条断言在空跑，那比没有断言更糟（它会让人以为错开被验过了）
    if (popFrame0Texts) {
      const leaked = POP_TEXTS.filter((t) => popFrame0Texts.has(t));
      if (leaked.length) {
        errors.push(`拾取当帧就画出了 ${leaked.join(' ')}：这三行分别排在第 2/4/5 位，t0 都晚于当帧，`
          + `出现即说明「逐行错开」没生效（STAT_POP_STAGGER 被改成 0 了？），七行会同时糊在面板右侧`);
      }
    }
    // 三句探针都要真被画出来，且首现帧号严格递增、相邻间隔不短于一个错开档。
    // ★读「第几帧首现」而不是「有没有画过」：drawnTexts 只答得了后者，
    //   而七行同时弹出与逐行弹出在「有没有画过」这个问法下答案完全一样
    const STEP_MS = Math.round(DT * 1000); // 每帧推进的墙上时钟毫秒数，step() 里那个 Math.round
    const minGapFrames = Math.floor(STAT_POP_STAGGER / STEP_MS); // 80/17 = 4 帧
    const missing = POP_TEXTS.filter((t) => !popFirstFrame.has(t));
    if (missing.length) {
      errors.push(`这几行 +x 整局都没被画出来：${missing.join(' ')}。要么 drawStatPops 没接到绘制循环，要么字被画到了屏幕外`);
    } else {
      const offs = POP_TEXTS.map((t) => popFirstFrame.get(t) - popAtFrame);
      for (let k = 1; k < offs.length; k++) {
        if (offs[k] <= offs[k - 1]) {
          errors.push(`+x 出场顺序倒了：${POP_TEXTS[k - 1]} 在第 ${offs[k - 1]} 帧、${POP_TEXTS[k]} 在第 ${offs[k]} 帧。`
            + `面板行序是 攻击/攻速/射程/暴击/移速/幸运/防御，飘字必须照这个序从上往下弹（hud.js 的 STAT_ROWS 被改过序？）`);
        } else if (offs[k] - offs[k - 1] < minGapFrames) {
          errors.push(`${POP_TEXTS[k - 1]} → ${POP_TEXTS[k]} 只隔了 ${offs[k] - offs[k - 1]} 帧（应 ≥ ${minGapFrames} 帧 = STAT_POP_STAGGER ${STAT_POP_STAGGER}ms）：错开被压扁了，肉眼看是同时弹`);
        }
      }
      // 上界：最后一句不能晚于「整段动画结束」那一刻，否则说明 drawStatPops 的过期判定把还在播的条目提前摘了、
      //   玩家看到的是弹到一半就断。界由真实常量推出来，不写死帧数
      const endFrame = Math.ceil(((wantRows - 1) * STAT_POP_STAGGER + STAT_POP_MS) / STEP_MS);
      const lastOff = offs[offs.length - 1];
      if (lastOff > endFrame) {
        errors.push(`最后一句 +x 迟到第 ${lastOff} 帧才首现，晚于整段动画的结束帧 ${endFrame}：条目被提前摘掉了`);
      }
    }
  }
}

// —— Boss 掉落道具「海火核心」（十字激光）的两端断言 ——
// ★门读的是表本身而不是某个新加的常量：LASER=0 那一组只是把 boss2 那一行挪出了这张表，
//   道具仍然登记着（注册面扫描照旧覆盖它），所以「表里这一号空不空」就是游戏内可达性的唯一真相
const SEAFIRE_ON = BOSS_DROPS.boss2.length > 0;
const CROSS_SWEEP_MS = LASER_CROSS_TELEGRAPH + LASER_CROSS_FIRE + LASER_CROSS_FADE;
if (!SEAFIRE_ON) {
  if (sawCrossChest) errors.push('海火核心已不可达却还掉出过匣：LASER=0 的旋钮没把 BOSS_DROPS.boss2 那一行掐住');
  if (crossGrants) errors.push(`海火核心已不可达却授予过 ${crossGrants} 次层数：CHEST_GRANTS.core_seafire 被掉落以外的地方调用了`);
  if (databus.player && databus.player.laserCross) errors.push(`海火核心已不可达玩家却有 ${databus.player.laserCross} 层：层数还有别的写入口`);
  if (crossFires) errors.push(`海火核心已不可达却放出过 ${crossFires} 根十字：fireLaserCross 没看层数`);
} else if (boss2Drops === 0) {
  errors.push(`海火核心开着却整局没死过海火（boss2Drops=0）：这一组读到的全是抽样零，不是代码零。把测试时长拉长再跑`);
} else {
  if (!sawCrossChest) errors.push(`死了 ${boss2Drops} 只海火，场上却没出现海火核心那件匣：main.js 的掉落口没按 Boss 号对上表`);
  if (!crossGrants) errors.push('匣掉过却没授予一次层数：拾取→CHEST_GRANTS.core_seafire 断了一环（chest.js 那句 CHEST_GRANTS[kind] 没跑到？）');
  if (crossHpLosses === 0) errors.push(`带着 ${crossGrants} 层却整局没真正掉过血：触发分母是零，下面每条读数都是空跑（测台每帧回血？还是无敌帧太长？）`);
  // 一根十字只可能由一次掉血换来：多出来的那几根说明触发点写重了（或冷却门没生效）
  if (crossFires > crossHpLosses) {
    errors.push(`放出 ${crossFires} 根十字但只有 ${crossHpLosses} 次真正掉血：一次挨打放了不止一根，触发口被接了两遍`);
  }
  // ★逐根配对，不是只比总数：负向测试实测「把触发口另外接到中毒跳血上」时掉血次数一点没涨，
  //   上面那条计数不等式照样是绿的（76 根对 223 次），只有这一条会红。
  //   两个时刻都取同一个 frameMs（放出发生在 takeDamage 内部），所以判据是「同帧」而不是「相差若干毫秒」
  const lossFrames = new Set(crossHpLossAt);
  const orphan = crossFireAt.find((t) => !lossFrames.has(t));
  if (orphan !== undefined) {
    errors.push(`t=${Math.round(orphan)}ms 放出的一根十字对不上任何一次真正掉血：触发口接到了 takeDamage 掉血分支以外`
      + '（中毒跳血 / applyBlast / 无敌帧或护盾挡掉的那一下），站进毒里就能白嫖常驻十字');
  }
  // 有层数、有掉血却没有十字 = 触发链断了；这一条和上面那条一起把「fires」夹在中间
  if (crossFires === 0) errors.push(`带着层数挨了 ${crossHpLosses} 下真伤却没放出过一根十字：takeDamage 的掉血分支没接 fireLaserCross，或 fireLaserCross 的三道门（层数 / 冷却 / databus）里有一道恒假`);
  // 冷却：相邻两次放出的间隔必须不短于 LASER_CROSS_CD（放火那一下就把冷却顶满，所以这是硬下界）。
  // ★先钉住「CD 大于整段扫射」这条不变式本身：下面那条峰值断言的守卫读的就是它，
  //   谁把 CD 调到 2000 以下，那条会自己变成永真、一根都不报，而画面上的症状是「光棒叠成一片常驻白光」
  if (LASER_CROSS_CD <= CROSS_SWEEP_MS) {
    errors.push(`LASER_CROSS_CD(${LASER_CROSS_CD}ms) 不大于整段扫射(${CROSS_SWEEP_MS}ms)：`
      + '上一根还没淡完下一根就亮起，挨打越密越像常驻光柱，而"同时在场只有一根"那条判据会静默失效');
  }
  const STEP = Math.round(DT * 1000);
  for (let k = 1; k < crossFireAt.length; k++) {
    const gap = crossFireAt[k] - crossFireAt[k - 1];
    if (gap < LASER_CROSS_CD - STEP) {
      errors.push(`第 ${k + 1} 根十字只隔了 ${gap}ms 就放出，短于 LASER_CROSS_CD=${LASER_CROSS_CD}ms：`
        + '冷却门没挡住下一次挨打，站进怪堆里十字会连成一根常驻光棒');
      break;
    }
  }
  // 同时在场根数：CD 大于整段扫射时长时，上一根一定已经回收，峰值只能是 1
  if (LASER_CROSS_CD > CROSS_SWEEP_MS && crossPeak > 1) {
    errors.push(`CD(${LASER_CROSS_CD}ms) 已大于整段扫射(${CROSS_SWEEP_MS}ms)，场上却同时有过 ${crossPeak} 根十字：`
      + '要么冷却没生效，要么十字没在 FADE 放完后回收');
  }
  // 伤害公式：每根十字的伤害必须正好等于「层数 × 每层基数」，读的是 init 之后的实例字段
  const badDmg = crossInitLayers.filter((c) => c.dmg !== laserCrossDamage(c.layers));
  if (badDmg.length) {
    errors.push(`${badDmg.length} 根十字的伤害不等于 laserCrossDamage(层数)（首例 层${badDmg[0].layers} 伤害${badDmg[0].dmg}）：`
      + 'init 里那句赋值和 consts 的公式不同源，改每层基数只会改到一半');
  }
  const badLayers = crossInitLayers.filter((c) => !(c.layers >= 1 && c.layers <= crossGrants));
  if (badLayers.length) {
    errors.push(`十字的层数读出 ${badLayers[0].layers}，而整局只授予过 ${crossGrants} 次：层数来源不是 player.laserCross，或它被别处加成过`);
  }
  for (let k = 1; k < crossInitLayers.length; k++) {
    if (crossInitLayers[k].layers < crossInitLayers[k - 1].layers) {
      errors.push('十字的层数往回走过：一局之内海火核心只进不出，回退说明读的是别的字段或被 reset 过');
      break;
    }
  }
  // 扫射真的在判定：phase 门写错的话光棒照画、一血不掉，画面上看着完全正常
  if (crossFires && !crossSettles) errors.push('放出过十字却一次都没进扫射段结算：蓄力→扫射的相位门断了');
  if (crossSettles && !crossHits) errors.push('扫射段结算跑过却一个怪都没命中：hits() 的垂距或束长判据写歪（光在空转）');
  // 光束静默：settle 里那次 takeDamage 传了 silent，飘字池一条都不该抽。
  // ★这条是有区分度的：Enemy.takeDamage 目前只有一个覆写（膜王），覆写漏透传 silent 就只有膜王身上跳字，
  //   而膜王血厚、一根扫射在它身上结十几次——正是画面里最刺眼的那一只，不会「局部错而读数不变」
  if (crossTexts) {
    errors.push(`十字扫射期间还抽了 ${crossTexts} 条飘字：光束的伤害没静默。`
      + `实测过一根就占掉全部飘字的 95%，把玩家普攻的数字挤没（DAMAGE_TEXT_MAX=${DAMAGE_TEXT_MAX} 时抑制率 28.7%）`);
  }
}

// —— 左栏 +x 的全源断言：升级成长与三选一选卡现在也走同一条飘字链 ——
// ★这三条与 BOSS_DROPS 开关无关，放在两端断言之外：掉落关着的那一局照样升级、照样选卡，
//   如果只有核心会弹字，说明 applyBoost 的漏斗还有没收进来的写入点
if (seconds >= 300 && gameOverAt < 0) {
  // 1 级开局、每升一级 level +1， harness 不从外部写等级，所以 level-1 就是升过几次。
  // ★在这里读而不是报表处读：再往下的纯检只驱动夹具实例，不动活体玩家，但早读早安心
  const levelUps = databus.player.level - 1;
  if (!levelPopCalls) errors.push('整局升过级却没弹一次升级 +x：applyLevelBonus 没把 databus 传进 applyBoost，成长这笔加成是哑的');
  if (!cardPopCalls) errors.push('整局选过卡却没弹一次选卡 +x：upgrade.js 的 pick 没走 applyBoost 通道，卡片这笔加成是哑的');
  if (!releaseCalls) errors.push('三选一关过门却没释放过一次挂起的 +x：upgrade.js 关闭路径漏了 releaseStatPops，暂存的字永远不弹');
  if (levelPopCalls !== levelUps) {
    errors.push(`升到 ${levelUps} 级却只弹了 ${levelPopCalls} 次成长 +x：有某一级没走 applyLevelBonus（addXp 被旁路了？）`);
  }
}
if (heldLeaks) errors.push(`${heldLeaks} 次 popStats 的 held 声明与来源不符：核心被挂起（玩家要等下一扇面板关才看得到字），或成长/选卡被立即弹（700ms 整段死在黑遮罩后面）`);
if (strayPopBoosts.length) {
  errors.push(`popStats 收到 ${strayPopBoosts.length} 次认不出来源的加成包（首例 keys: ${Object.keys(strayPopBoosts[0]).join('/')}）：`
    + `有新的属性写入点没登记进这本账，它的 +x 不会被来源断言覆盖`);
}
stuckHeld = databus.hud.statPops.filter((p) => p.t0 === null).length;
if (stuckHeld && !databus.upgradeScreen.visible) {
  errors.push(`面板已关闭却还有 ${stuckHeld} 条挂起的 +x 没释放：releaseStatPops 漏了一条关闭路径（或有人在面板外声明了 held=true 却再没开过面板）`);
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
const fieldDropsNear = clotsDroppedNear;
const fieldCollected = clotsCollected;
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
// ★「主循环真跑通了」这条凭据要从 collected 取，不能从 heals 那颗数取：测试台每帧【顶部】把 hp 回满，
//   只有恰好在本帧挨过一下的玩家才有缺口，而炮台会替站桩的 bot 把怪清在 220 像素外，
//   于是出现「血块照吃了、hp 本来就满、一笔红字都没冒」这种正确但读数为 0 的局。
//   回收生命周期只能由实场计，纯检那几条只驱动原型，证明不了 databus/main 接了线
// ★clotHeals 那个计数器现在是两家共用：血块被吃掉的红字和嗜血回血的红字在 addDamageText 上长得
//   一模一样（都是 +N、都是 UI.blood），分不开只能按笔数相减。嗜血每次回血必出一条红字
//   （onKill 里 healed > 0 才画），所以减 leechProcs 是精确的，不是估的
const clotEats = fieldHeals - leechProcs;
if (clotEats > fieldCollected) {
  errors.push(`血块回了血 ${clotEats} 次 > 被收走 ${fieldCollected} 次：有那颗结算了两遍，回收没跟上`);
}
if (fieldDropsNear > 0 && fieldCollected === 0) {
  errors.push(`磁吸半径内有 ${fieldDropsNear} 颗血块（全场掉 ${fieldDrops} 颗）却一颗都没被收走：databus 那条 clots 循环或 main.js 的回收断了（纯检过了不代表实场通了）`);
}
// ★为什么「回了血」不再是硬断言：测试台每帧顶部把 hp 回满，而满血时血块照吃、heal() 返回 0、不画红字
//   （js/npc/bloodclot.js:27 那条 10-11 改的口径）。所以 clotEats 只有在「吃掉那一帧身上恰好有缺口」
//   时才非零，那是战斗密度给的样本，不是接线的凭据。接线由上面那条 collected 兜，
//   「残血时真回得进、差 1 血时封顶」由下面那段纯检兜
// ★为什么还要 fieldDropsNear 这道门：血块只在 player.pickupRange 内才被吸过来（bloodclot.js:34），
//   而任何在这圈外完成的击杀都会把那颗血块永远搁在原地——炮台把这条变成常态（它专在 220 像素外打死怪），
//   但主角的远射本来也做得到。够不着是正确行为，不是接线断了，所以硬断言只对「落在圈里的样本」发言
if (fieldDrops > 0 && fieldCollected > 0 && clotEats === 0) {
  console.log(`血块收走 ${fieldCollected} 次、一次没回出血（全场满血，缺口窗口没赶上）：这条不是回归，纯检那几条才管回血量`);
}
if (fieldDrops > 0 && fieldDropsNear === 0) {
  console.log(`血块 ${fieldDrops} 颗全掉在磁吸半径（${databus.player ? databus.player.pickupRange : '-'}）之外：谁在远处打死的都一样（炮台、主角的远射、跟班），这一局没有可判的回收样本`);
}

// —— 血块纯检：回多少、差 1 血时的封顶、满血时「照吃但进瓶」。这几条实场读不出数值（回血主循环里量不到具体加了几）
function clotRun(hp, maxHp, dist, vial = 0) {
  const player = Object.create(Player.prototype);
  player.x = 0; player.y = 0; player.radius = 14; player.pickupRange = 90;
  player.hp = hp; player.maxHp = maxHp;
  // ★手搓的 player 没有 Player 构造期那些血瓶自有属性，必须显式给：heal() 要读 vial 判「进不进瓶」，
  //   不给就是 undefined，那条 if 恰好为假、测试通过，但量的其实不是「0 层」而是「字段不存在」
  player.vial = vial; player.vialDrops = 0; player.vialGainT = 0; player.vialOutT = 0;
  const texts = [];
  const db = { player, addDamageText(x, y, damage, isCrit, color) { texts.push({ damage, color }); } };
  const clot = new BloodClot();
  clot.init(player.x + dist, player.y, BLOOD_CLOT_HEAL);
  const sx = clot.x; const sy = clot.y;
  clot.update(1 / 60, db);
  return { player, clot, texts, moved: Math.hypot(clot.x - sx, clot.y - sy) };
}
const clotFull = clotRun(40, 40, 10);      // 满血，而且已经贴到接触距离里了
const clotFullBank = clotRun(40, 40, 10, 1); // 同样满血、但有 1 层血瓶：那一整颗该变成瓶里的两滴
const clotHurt = clotRun(20, 40, 10);      // 残血，接触即回
const clotEdge = clotRun(39, 40, 10, 1);   // 只差 1 血、带血瓶：吃一颗回 2 的，身上结 1、瓶里存 1
const clotNear = clotRun(20, 40, 60);      // 在磁吸半径内、还没碰上
const clotFar = clotRun(20, 40, 120);      // 磁吸半径外：该一动不动
// 10-11 这条整条反写：满血不再「不磁吸不吞」，而是照吸照吞、身上不动、也不许飘字
if (!clotFull.clot.collected || clotFull.player.hp !== 40 || clotFull.texts.length || clotFull.moved === 0) {
  errors.push(`满血那颗没照吃/还在原地（collected=${clotFull.clot.collected} moved=${clotFull.moved.toFixed(1)} 飘字 ${clotFull.texts.length} 条）：血瓶改了口径，满血也该吸过来吞掉，但身上没回血就不许冒红字`);
}
if (clotFull.player.vialDrops !== 0) {
  errors.push(`0 层血瓶却存下 ${clotFull.player.vialDrops} 滴：没这件道具时满血溢出必须纯浪费`);
}
if (clotFullBank.player.vialDrops !== BLOOD_CLOT_HEAL) {
  errors.push(`满血吃一颗回 ${BLOOD_CLOT_HEAL} 的血块，瓶里却存了 ${clotFullBank.player.vialDrops} 滴（应 ${BLOOD_CLOT_HEAL}）：heal() 那段溢出收集没接上，或者夹错成了回复量`);
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
if (clotEdge.player.vialDrops !== 1) {
  errors.push(`差 1 血吃一颗回 2 的，瓶里存了 ${clotEdge.player.vialDrops} 滴（应 1）：半程拆分那一段算错，等于把回复量也存了一遍`);
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
function leechRun(stacks, hp, maxHp, vial = 0) {
  const player = Object.create(Player.prototype);
  player.x = 0; player.y = 0; player.radius = 14;
  player.hp = hp; player.maxHp = maxHp; player.leech = stacks;
  player.vial = vial; player.vialDrops = 0; player.vialGainT = 0; player.vialOutT = 0;
  const texts = [];
  const db = { addDamageText(x, y, damage, isCrit, color) { texts.push({ damage, color }); } };
  const healed = Player.prototype.onKill.call(player, db);
  return { player, healed, texts };
}
const prevRandom = Math.random;
const canForce = LEECH_CHANCE > 0; // LEECHP=0 那趟里 `0 >= 0` 也算不命中，必触发那几条无从证明，直接跳过
let leechOne; let leechA; let leechB; let leechC; let leechE; let leechD; let leechBank;
Math.random = () => 0;
leechOne = leechRun(1, 10, 40);
leechA = leechRun(3, 10, 40);
leechB = leechRun(3, 39, 40);
leechC = leechRun(3, 40, 40);
leechBank = leechRun(3, 40, 40, 1);
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
  if (leechC.healed !== 0 || leechC.player.hp !== 40 || leechC.texts.length !== 0 || leechC.player.vialDrops !== 0) {
    errors.push(`满血触发返回 ${leechC.healed}、飘字 ${leechC.texts.length} 条、存量 ${leechC.player.vialDrops} 滴：0 层血瓶时口径仍是「照掷、白白浪费」，既不该有红字也不该凭空存出血`);
  }
  if (leechBank.healed !== 0 || leechBank.player.hp !== 40 || leechBank.texts.length !== 0
    || leechBank.player.vialDrops !== 3) {
    errors.push(`满血带 1 层血瓶触发一口 3 血：hp=${leechBank.player.hp}、返回 ${leechBank.healed}、飘字 ${leechBank.texts.length}、存量 ${leechBank.player.vialDrops}（应 40/0/0/3）：那一口该整份进瓶，身上不动也不许冒红字`);
  }
  if (leechE.healed !== 0 || leechE.player.hp !== 10 || leechE.texts.length !== 0) {
    errors.push(`0 层也回了血（${leechE.healed}）：leech <= 0 那道短路没生效，下面那条关掉等价式不成立`);
  }
}
if (leechD.healed !== 0 || leechD.player.hp !== 10 || leechD.texts.length !== 0) {
  errors.push(`掷不中还是回了血（${leechD.healed}）：LEECH_CHANCE 那道门形同虚设`);
}

// —— 血瓶纯检：两条节拍（每 VIAL_GAIN_CD 按层数自增 / 残血每 VIAL_OUT_CD 送 VIAL_OUT 滴）+ 满血不攒欠债 +
//   输送到空即停 + 按缺口夹 + 无上限 + 液面显示数学。
//   ★实场那两笔进账（自增、满血溢出）在 vialDrops 上长得一模一样、分不开，精确数值只能这样按帧推
function vialFixture(vial, hp, maxHp, drops = 0) {
  const p = Object.create(Player.prototype);
  p.x = 0; p.y = 0; p.radius = 14;
  p.vial = vial; p.vialDrops = drops; p.vialGainT = 0; p.vialOutT = 0;
  p.hp = hp; p.maxHp = maxHp;
  return p;
}
// dt 一律取 0.5 秒（= 500 毫秒，二进制精确）：用 1/60 的话 60 帧累加成 30000.000000000004 或 29999.9999…，
// 「恰好第 N 帧跳」这种断言会偶发红，而且跳点前后的余数也会跟着抖
function pumpSeconds(p, seconds) {
  const n = Math.round(seconds / 0.5);
  for (let k = 0; k < n; k++) Player.prototype.pumpVial.call(p, 0.5);
  return p;
}
const VIAL_SEC = VIAL_GAIN_CD / 1000; // 自增节拍（秒），下面每一条期望值都由它和 VIAL_OUT_CD 推
const vialOff = pumpSeconds(vialFixture(0, 20, 40, 5), VIAL_SEC * 3);   // 0 层：三个跳点一个都不该走
const vialGain1 = pumpSeconds(vialFixture(1, 40, 40), VIAL_SEC);        // 满血 1 层、正好一个跳点
const vialGain3 = pumpSeconds(vialFixture(3, 40, 40), VIAL_SEC * 2);    // 满血 3 层、两个跳点
const vialPour = pumpSeconds(vialFixture(1, 30, 40, 4), 3);              // 残血有货：3 秒该送 3 滴
const vialDebt = vialFixture(1, 30, 40, 3);                              // 欠债夹具，下面按帧演一段真事
pumpSeconds(vialDebt, 0.5);                                              // 残血半秒：vialOutT 攒到 500，还没到拍点
vialDebt.hp = vialDebt.maxHp;                                            // 捡了一颗血块回满
pumpSeconds(vialDebt, 3);                                                // 满血站 3 秒：那半个节拍该被钉回 0
vialDebt.hp = 20;                                                        // 再挨出一身缺口
pumpSeconds(vialDebt, 0.5);                                              // 回到残血的第一帧
if (vialDebt.vialDrops !== 3 || vialDebt.hp !== 20) {
  errors.push(`满血前留了半个节拍、满血站 3 秒后再残血半秒：存量 ${vialDebt.vialDrops}、hp ${vialDebt.hp}（应 3 / 20）：vialOutT 没被钉回 0，那 500 毫秒的余数让第一口提前一整拍冒出，玩家数的「一秒一口」变成「一挨打就先吐一口」`);
}
pumpSeconds(vialDebt, 0.5);                                              // 第二帧正好到拍点：只许送 1 滴
const vialDrain = pumpSeconds(vialFixture(1, 10, 40, 2), 5);            // 瓶里只有 2 滴：送完就该停
const vialGap = pumpSeconds(vialFixture(1, 39, 40, 5), 3);              // 只差 1 血：按缺口夹，不灌溢出
const vialHuge = pumpSeconds(vialFixture(1, 40, 40, 1e6), VIAL_SEC * 2); // 无上限：1e6 滴不该被截断
if (vialOff.vialDrops !== 5 || vialOff.hp !== 20 || vialOff.vialGainT !== 0 || vialOff.vialOutT !== 0) {
  errors.push(`0 层却量到存量 ${vialOff.vialDrops}、hp ${vialOff.hp}、计时 ${vialOff.vialGainT}/${vialOff.vialOutT}：vial <= 0 那道短路没生效，下面那条关掉等价式不成立`);
}
if (vialGain1.vialDrops !== 1) {
  errors.push(`1 层站满 ${VIAL_SEC} 秒存量 = ${vialGain1.vialDrops}（应 1）：自增买的是「每跳几滴 = 层数」，节拍或单位量写歪了`);
}
if (vialGain3.vialDrops !== 6 || vialGain3.vialGainT !== 0) {
  errors.push(`3 层站满 ${VIAL_SEC * 2} 秒存量 = ${vialGain3.vialDrops}（应 6）、余数 ${vialGain3.vialGainT}（应 0）：层数没乘进自增，或者跳点把余数清零了`);
}
if (vialPour.vialDrops !== 1 || vialPour.hp !== 33) {
  errors.push(`残血 3 秒后存量 ${vialPour.vialDrops}、hp ${vialPour.hp}（应送 3 滴 → 存量 1 / hp 33）：输送节拍 VIAL_OUT_CD 或每跳 VIAL_OUT 不是一条一口`);
}
if (vialDebt.vialDrops !== 2 || vialDebt.hp !== 21) {
  errors.push(`清过半个节拍之后第二帧：存量 ${vialDebt.vialDrops}、hp ${vialDebt.hp}（应 2 / 21）：要么复位把节拍一起清死了（永远不出货），要么第一帧那条提前冒出的口把节奏挪了半拍`);
}
if (vialDrain.vialDrops !== 0 || vialDrain.hp !== 12) {
  errors.push(`瓶里 2 滴送完后存量 ${vialDrain.vialDrops}、hp ${vialDrain.hp}（应 0 / 12）：没按余额夹取，或者空瓶还在继续送`);
}
if (vialGap.vialDrops !== 4 || vialGap.hp !== 40) {
  errors.push(`只差 1 血、瓶里 5 滴，站 3 秒后存量 ${vialGap.vialDrops}、hp ${vialGap.hp}（应 4 / 40）：输送没按缺口夹，把满血后的余量也算进了一次跳点`);
}
if (vialHuge.vialDrops !== 1000000 + 2) {
  errors.push(`存量 1e6 滴站 ${VIAL_SEC * 2} 秒后 = ${vialHuge.vialDrops}（应 1000002）：无上限那条口径被 clamp 掉了，满血时的溢出又开始白扔`);
}
{
  const view = new BloodVial();
  if (view.level(0, 40) !== 0) errors.push(`空瓶的液面 = ${view.level(0, 40)}（应 0）：一滴都没有却画着有存货`);
  if (view.level(1, 40) !== 0.14) errors.push(`1 滴的液面 = ${view.level(1, 40)}（应夹到下限 0.14）：1/40 = 0.025 画出来不到半像素，玩家会读成瓶子没收到东西`);
  if (view.level(20, 40) !== 0.5) errors.push(`半瓶的液面 = ${view.level(20, 40)}（应 0.5）：量纲不是 maxHp`);
  if (view.level(1e6, 40) !== 1) errors.push(`超量存的液面 = ${view.level(1e6, 40)}（应 1）：显示没夹满，fillRect 会画到瓶子上面的空气里`);
}

// —— 炮台纯检：这四条全是「漏写一行不报错」的静默失效 —— 不钉冷却会补欠债、忘赋 maxRange 会继承上一发别人的射程、
//   加了跟随逻辑就等于把「站在原地」这件道具改成第四只跟班。实场那遍只量得到打了几发，分不清是哪一种
function turretFixture(x = 0, y = 0) {
  const t = Object.create(Turret.prototype);
  t.x = x; t.y = y; t.radius = 12; t.cdT = 0; t.aim = 0;
  return t;
}
// 最小世界：fire() 只读 enemys 的 x/y/isDead、player 的 attack/pierce/burnBullets，和 pool.getItemByClass
function turretStub(enemys, pool) {
  return {
    player: { attack: 26, pierce: 0, burnBullets: 0 },
    enemys,
    bullets: [],
    pool: pool || { getItemByClass: () => new Bullet() },
  };
}
// dt 一律 0.5 秒一步（= 500 毫秒，二进制精确），同上面 pumpSeconds 那条理由：1/60 累加会让「恰好到拍」偶发红
function pumpTurret(t, db, seconds) {
  const n = Math.round(seconds / 0.5);
  for (let k = 0; k < n; k++) t.update(0.5, db);
  return t;
}
{
  const t = turretFixture();
  const db = turretStub([]);
  pumpTurret(t, db, 30);
  if (t.cdT !== TURRET_CD) {
    errors.push(`射程内一只怪都没有、空转 30 秒后 cdT = ${t.cdT}（应钉在 ${TURRET_CD}）：欠债没被钉掉，怪一进圈就会先补出积压的那一串`);
  }
  if (db.bullets.length !== 0) {
    errors.push(`空转 30 秒打出了 ${db.bullets.length} 发：fire 里「没有目标就返回 false」那道门没生效，等于在给空气上弹药`);
  }
}
{
  const t = turretFixture();
  const db = turretStub([]);
  pumpTurret(t, db, 30);                            // 先空转到钉满
  db.enemys.push({ x: 100, y: 0, radius: 10, isDead: false });
  pumpTurret(t, db, 0.5);                            // 怪进圈之后的第一帧
  if (db.bullets.length !== 1) {
    errors.push(`空转 30 秒后放进一只怪，第一帧打出了 ${db.bullets.length} 发（应 1）：要么钉回的 cdT 没钉、积压的那几拍被一次补完，要么一进圈根本没开火`);
  }
  if (t.x !== 0 || t.y !== 0) {
    errors.push(`打过几发之后炮台挪到了 (${t.x}, ${t.y})：它买的就是「站在原地」，任何跟随逻辑都是把这件道具写成第四只跟班`);
  }
  let steps = 0;
  while (db.bullets.length < 2 && steps < 60) { pumpTurret(t, db, 0.5); steps++; }
  const gapMs = steps * 500;
  if (!(gapMs >= TURRET_CD && gapMs - 500 < TURRET_CD)) {
    errors.push(`两发之间的实测间隔 ${gapMs} 毫秒没落在 ${TURRET_CD} 那一拍上（上一档 ${gapMs - 500}）：冷却门或开火后的归零有一条写歪`);
  }
}
{
  // ★池里捞出来的必须是一颗「别人用过的」弹：Bullet.init 重置 radius/color/pierce/burn，唯独不碰 maxRange，
  //   漏赋这一行不会报错，只会让炮弹按上一发的射程飞
  const stale = new Bullet();
  stale.maxRange = 9999;
  const t = turretFixture();
  const db = turretStub([{ x: 0, y: -100, radius: 10, isDead: false }], { getItemByClass: () => stale });
  pumpTurret(t, db, 1.5);                            // 0.5×3 帧：第三帧 cdT 攒到 1500 ≥ TURRET_CD
  const b = db.bullets[0];
  if (!b) {
    errors.push('目标在正上方 100 像素处却一发没打：索敌那条平方距离比较写歪了');
  } else {
    if (b.maxRange !== TURRET_RANGE + BULLET_RANGE_BUFFER) {
      errors.push(`炮弹射程 = ${b.maxRange}（应 ${TURRET_RANGE + BULLET_RANGE_BUFFER}）：这一行漏赋，弹继承的是上一发那位主人的 9999`);
    }
    if (b.radius !== TURRET_BULLET_RADIUS || b.color !== TURRET_BULLET_COLOR) {
      errors.push(`炮弹外观 = r ${b.radius} / ${b.color}（应 ${TURRET_BULLET_RADIUS} / ${TURRET_BULLET_COLOR}）：三种弹要是同色同粗，画面上就分不出这发是谁打的`);
    }
    if (b.damage !== turretDamage(26)) {
      errors.push(`攻 26 的单发伤害 = ${b.damage}（应 ${turretDamage(26)}）：开火方和详情页必须共用 turretDamage 那一个函数`);
    }
    // 出膛点在炮口（枢轴正上方 TURRET_MUZZLE_LEN），不是炮台中心：从中心出弹会让第一帧就吃掉一截射程。
    // ★纵向基准必须是枢轴：炮口绕的是颈部那圈金环，而金环不在贴图正中（TURRET_PIVOT_Y）
    const muzzleY = TURRET_PIVOT_Y - TURRET_MUZZLE_LEN;
    if (Math.abs(b.x) > 1e-6 || Math.abs(b.y - muzzleY) > 1e-6) {
      errors.push(`炮弹出膛点 = (${b.x.toFixed(2)}, ${b.y.toFixed(2)})（应 0 / ${muzzleY}）：没按炮口出膛、纵向基准用成了贴图中心，或者朝向那一路算歪了`);
    }
  }
}
if (turretDamage(0) !== 1) errors.push(`攻 0 时单发 = ${turretDamage(0)}（应 1）：保底没兜住，纯检这条路会打出 0 伤害的弹`);
if (turretDamage(26) !== 23) errors.push(`攻 26 时单发 = ${turretDamage(26)}（应 23 = floor(26 × 0.9)）：改 TURRET_DAMAGE_RATIO 要连这条期望一起改，它是「一座 ≈ 一层射击跟班」那笔算术的凭据`);

// —— 血瓶实场断言：两端都要钉住 ——
if (VIAL === 0 && (maxVials || vialIn || vialOut)) {
  errors.push(`血瓶 0 层却量到场上 ${maxVials} 只、进账 ${vialIn} 滴、出账 ${vialOut} 滴：0 层这道门没关掉，「没这个道具」的局也在跑新代码`);
}
if (maxVials > 1) {
  errors.push(`场上出现过 ${maxVials} 只血瓶：databus 那条封顶没写，层数被当成了只数`);
}
if (VIAL > 0 && maxVials === 0) {
  errors.push(`血瓶 ${VIAL} 层场上却一只都没生成：databus 的生成条件或 player.vial 属性名断了`);
}
// 期望进账按「这一局世界真跑了多久」推：玩家一死 main.js 就不再驱动 update，此后既不自增也不输送
const vialAlive = gameOverAt < 0 ? frames * DT : gameOverAt;
const vialExpectGain = Math.floor(vialAlive / VIAL_SEC) * VIAL;
if (VIAL > 0 && vialExpectGain > 0 && vialIn < vialExpectGain) {
  errors.push(`血瓶 ${VIAL} 层、存活 ${vialAlive.toFixed(0)} 秒，进账却只有 ${vialIn} 滴（自增就该 ≥ ${vialExpectGain}）：Player.update 里那句 pumpVial 没接上或早退`);
}
if (VIAL > 0 && vialExpectGain > 0 && vialOutTicks === 0) {
  errors.push(`血瓶 ${VIAL} 层攒到峰值 ${vialDropsPeak} 滴却一次都没输送过：残血时那第二条节拍没跑（站桩 bot 全程满血？那这一组量不到输送，换 VIAL 之外再垫一次伤害）`);
}

// —— 炮台实场断言 ——
// 世界跑到的时刻：玩家一死 main.js 就不再驱动 databus.update，此后 cdT 停在原地
const turretAlive = gameOverAt < 0 ? frames * DT : gameOverAt;
const turretActiveMs = turretOnAt < 0 ? 0 : (turretAlive - turretOnAt) / DT * Math.round(DT * 1000);
// ★上界用 17 毫秒而不是 DT 的 16.667：main.js 的 dt 取自 stub 的 Date.now，而 step() 每帧把那只表拨 +Math.round(DT*1000)
const turretShotBound = (Math.floor(turretActiveMs / TURRET_CD) + 1) * maxTurrets;
const turretUtil = turretShotBound ? `${(turretShots / turretShotBound * 100).toFixed(0)}%` : '—';
if (TURRET === 0 && (maxTurrets || turretShots)) {
  errors.push(`炮台 0 层却量到场上 ${maxTurrets} 座、开火 ${turretShots} 发：0 层这道门没关掉，「没这个道具」的局也在跑新代码`);
}
// 局太短就还没落座（台子延到 TURRET_AT 秒才给层数），下面这几条要分叉掉，免得把延时读成回归
if (TURRET > 0 && turretOnAt < 0) {
  console.log(`炮台这局没量到：跑 ${seconds} 秒 < 落座时刻 ${TURRET_AT} 秒，座数与开火两条实场断言跳过`);
}
// ★这条不许照抄上面血瓶那条的 === 1：这一种的口径就是不封顶，一层一座。
//   谁把 databus 那个 while 写成「封顶一只」，金匣开出第 2 层就静默吞掉一座
if (TURRET > 0 && turretOnAt >= 0 && maxTurrets !== TURRET) {
  errors.push(`炮台钉成 ${TURRET} 层，场上峰值却只到 ${maxTurrets} 座：生成条件被写成了封顶一只、加了上限，或者 player.turrets 那条属性名断了`);
}
if (TURRET > 0 && turretOnAt >= 0 && turretShots === 0) {
  errors.push(`炮台 ${maxTurrets} 座、落座后又跑了 ${(turretActiveMs / 1000).toFixed(0)} 秒却一发未出：fire 的索敌、子弹入列或 databus 那条 update 循环有一条没通`);
}
// 节拍上界从「场上有座子之后世界跑了多久」推，不从观测沿推：★旧写法拿「到点次数」当分母，
//   而连着打的座子分子分母一起漏，漏得最凶的那种写法（每帧都开火）恰好最不容易被看见
if (turretShots > turretShotBound) {
  errors.push(`开火 ${turretShots} 发超出节拍上界 ${turretShotBound}（落座后 ${(turretActiveMs / 1000).toFixed(0)} 秒 × ${maxTurrets} 座 ÷ 每 ${TURRET_CD} 毫秒一拍）：有炮弹在没到拍的时候被打出去了`);
}
// 远处的座子到点却一发没打是正确行为（它那一圈里就是没怪），所以利用率只做软读数、写在报表里，不硬断言

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
if (!chestStamps.length) {
  // ★「一只都没出」本身不是回归：0 幸运是每秒 4%，一局 60 秒里门在第 5 秒才开，
  //   全空这一支尾概率 ≈ 0.96^55 ≈ 10%，而 CHEST_PITY 那条 60 秒保底正好落在窗口外、兜不到。
  //   要钉的是掷骰那条计时器真的在走：chestSinceLast 能一路涨就说明门开了、累加在跑，
  //   只是骰子没命中；它压根没动才是 spawner 那段接线断了
  if (chestRollMax < CHEST_FIRST_ROLL * 1000) {
    errors.push(`${seconds}s 内金匣一只没刷出，且掷骰计时只走到 ${(chestRollMax / 1000).toFixed(1)} 秒（首掷门在 ${CHEST_FIRST_ROLL}s）：概率那条路径根本没跑`);
  } else {
    console.log(`${seconds}s 内一只金匣都没刷出，但掷骰计时走到了 ${(chestRollMax / 1000).toFixed(1)} 秒：门开着、骰子没命中（0 幸运 4%/秒的天然尾概率，约 10%），不是回归`);
  }
}
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

// 暂停详情页的文案探针：把九种加成挂满，逼九行 describe 各拼一次并真画出来。
// ★这类 bug 只住在字符串里：bombDamage 收攻击力却传了整个 player，游戏照跑、数值检查全绿，
//   只有详情页那一行写成「单枚 NaN 点」。不扫文本就永远发现不了
{
  const real = databus.player;
  const probe = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
  // 一刀切写 3 不行：count 是各格自己的口径（子弹数从 1 起算、拾取范围存的是像素），
  // 全写 3 会让 pickupRange 算出负层数、被 ownedItems 当"没拾取过"滤掉，那一行就永远扫不到
  const OWNED = { bulletCount: 4, pierce: 3, shield: 3, companions: 3, bomber: 3, turrets: 3, burnBullets: 3, pickupRange: 170, leech: 3, vial: 3 };
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
  // Boss 掉落道具那一行走的是同一条 ownedItems()，但它是「拾取过才占位」，所以门要挂在持有上：
  // 关掉开关、或整局没打到 boss1 时这一行本来就不该出现，无条件硬查会变成假红
  for (const k of Object.values(BOSS_DROPS).flat()) {
    if ((databus.bossChests[k.id] || 0) > 0 && !drawnTexts.has(k.name)) {
      errors.push(`详情页没画出「${k.name}」这一行：拾取了 ${databus.bossChests[k.id]} 次，ownedItems 却没把它收进卡片`);
    }
  }
}
const badTexts = [...drawnTexts].filter((t) => /NaN|undefined|Infinity/.test(t));
if (badTexts.length) errors.push(`界面文字里出现非法数值 ${badTexts.length} 条：${badTexts.slice(0, 3).join(' | ')}`);

// —— 详情页排版守门：★ROW_H 是死的、行数是活的，加一种就是把整张卡片往下顶 50 像素，
//   顶穿屏幕不是崩、是「点开就关不掉」
{
  // 最坏行数 = 金匣那 10 格 + BOSS_DROPS 全表（巨细胞核 + 海火核心 = 12 行），两处都归 ownedItems() 收进同一张卡
  // ★12 行的卡片高 712，刘海机上「居中」和「让开胶囊」两个上界打架，layout 里那道 min 选择把卡片往上顶
  //   （实测 y 从 143 压到 124、底边 836 ≤ 844）。所以往上顶换来的新风险是顶边啃进胶囊 —— 下面那条就是钉它的
  // ★刻意不含 BOSS_CHESTS 那 1 行：专属匣整条下线中（BOSS_CHESTS_ENABLED = false），游戏内不可达。
  //   哪天把它翻回 true 就是 13 行，压 y 也兜不住了（顶边会啃进胶囊）—— 到那时先做滚动或分栏
  const worstRows = [
    ...ITEM_BAR.map((t) => ({ id: t.glyph, name: t.name })),
    ...Object.values(BOSS_DROPS).flat().map((k) => ({ id: k.id, name: k.name })),
  ];
  const L = databus.pauseScreen.layout(worstRows);
  if (L.y + L.h > canvasH) {
    errors.push(`详情页最坏 ${worstRows.length} 行的卡片底边 ${Math.round(L.y + L.h)} 掉出屏幕 ${canvasH}：加行数之前先给这一页做滚动或分栏`);
  }
  if (L.btn.y + L.btn.h > canvasH) {
    errors.push(`详情页「继续战斗」按钮底边 ${L.btn.y + L.btn.h} 掉出屏幕 ${canvasH}：玩家点开这一页就回不去战斗`);
  }
  // 让位让的是「点不动」而不是「看不见」：胶囊盖在画布之上，游戏代码收不到它下面的触点
  if (L.y < capsuleBottom) {
    errors.push(`详情页最坏 ${worstRows.length} 行的卡片顶边 ${Math.round(L.y)} 啃进微信胶囊（底边 ${capsuleBottom}）：`
      + `压 y 已经兜不住了，这一页该做滚动或分栏，别再加行`);
  }
  if (safeTop <= 0) errors.push('详情页探针所在的环境没模拟刘海机（safeTop=' + safeTop + '）：上面三条读数都是空跑');
}

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
  // ★按函数切段再查：theme.js 有两个画图入口，itemGlyph 的 default 分支转调 icon，
  //   整文件 includes 分不清命中在哪一层——写反了会一边假红一边假绿
  const glyphAt = themeSrc.indexOf('export function itemGlyph');
  const iconSrc = themeSrc.slice(0, glyphAt);      // icon()：地上的匣子、图鉴、toast 都走这一层
  const glyphSrc = themeSrc.slice(glyphAt);        // itemGlyph()：右栏那颗徽章，default 兜底转调 icon()
  for (const t of ITEM_BAR) {
    if (!glyphSrc.includes(`case '${t.glyph}'`)) errors.push(`theme.js 的 itemGlyph 没有 '${t.glyph}' 分支：右栏那一格会退回 icon() 的通用画法，不是为这颗徽章调过的形状`);
    if (!pauseSrc.includes(`case '${t.glyph}'`)) errors.push(`pause.js 的 describe 没有 '${t.glyph}' 分支：详情页那一行的说明是空的`);
  }
  // —— Boss 掉落道具（BOSS_DROPS）的注册面 ——
  // 文案两处都查得到就够了：详情页那行由 describe() 分派，先按 glyph 找 case、找不到才落到 default 读 brief。
  //   巨细胞核没有 case（它涨的七行面板上正在显示，重复一遍反而对不上号），海火核心有（层数不在任何面板上，只能这里报）。
  //   所以 brief 是「没有 case 时不许空白」的兜底，两件都要求有
  for (const kinds of Object.values(BOSS_DROPS)) {
    for (const k of kinds) {
      if (!CHEST_KIND_BY_ID[k.id]) {
        errors.push(`BOSS_DROPS 的 '${k.id}' 不在 CHEST_KIND_BY_ID 里：chest.init 会把 kindDef 置 null，`
          + `这只匣子会被当成普通金匣开（随机加一项），不是掉落道具`);
      }
      if (!CHEST_GRANTS[k.id]) {
        errors.push(`CHEST_GRANTS 没有注册 '${k.id}'：chest.js 那句裸 CHEST_GRANTS[kind](databus) 会在拾取瞬间抛 TypeError`);
      }
      // ★查的是 icon() 那一段：掉在地上的那只匣子由 chest.js:94 用 icon(ctx, kindDef.icon, …) 画，
      //   这一层没有分支的话地上的匣子和右栏徽章会一起退化成通用白圈，而掉落链照样全绿
      if (!iconSrc.includes(`case '${k.icon}'`)) {
        errors.push(`theme.js 的 icon 没有 '${k.icon}' 分支：掉在地上的那只匣子会被画成普通白圈，玩家分不清它是什么`);
      }
      // ★describe() 的 switch 键是 item.glyph，而 ownedItems 把掉落物的 glyph 直接设成 config 里的 icon。
      //   撞名不会报错、只会串词：金匣有的那套说明会被念到这件掉落物头上
      if (ITEM_BAR.some((t) => t.glyph === k.icon)) {
        errors.push(`BOSS_DROPS '${k.id}' 的 icon '${k.icon}' 和金匣的 glyph 撞名：详情页会按金匣那条说明念它`);
      }
      if (!k.brief) errors.push(`BOSS_DROPS 的 '${k.id}' 没有 brief：describe 的 default 分支会交出空串，详情页那一行是空的`);
      for (const key of Object.keys(k.boost || {})) {
        if (!STAT_KEYS.includes(key)) {
          errors.push(`BOSS_DROPS '${k.id}' 的 boost 有 '${key}'，不在 HUD 面板那七行里：`
            + `这项会悄悄涨（或加到 undefined 上）却没有对应的 +x 行可弹，玩家看不见`);
        }
      }
    }
  }
  // ★turret.js 进的是这一组（连 Date.now( 都不许出现），不是下面那组纯显示体：它会开火，
  //   读墙上时钟的后果是三选一面板一关就补出积压的那几发，而这条链上的每一发都是真伤害
  for (const rel of [path.join('player', 'bomb.js'), path.join('player', 'bomber.js'), path.join('player', 'turret.js')]) {
    const s = src(rel);
    // 读墙上时钟会在三选一面板期间偷跑（main.js 那时跳过 databus.update），面板一关就连发
    if (s.includes('Date.now(')) errors.push(`${rel} 里出现 Date.now(：计时必须按 dt 累加`);
    // 绕过 takeDamage 会跳过减伤、膜、飘字和掉落，Boss 战会被这行代码悄悄改写
    if (/\.hp\s*[-+*]?=/.test(s)) errors.push(`${rel} 直接写了 e.hp：伤害必须走 Enemy.takeDamage`);
  }
  // —— 新增的三个文件同一条规矩 ——
  // bloodVial.js 有意放这一组而不是上面那组「连 Date.now( 都不许出现」：它是纯显示实体、
  //   两条节拍都不在它身上，瓶身那圈呼吸必须用墙上时钟，逻辑却照样受 isPaused 门管制
  for (const rel of [path.join('npc', 'monster', 'bossTwins.js'), path.join('npc', 'monster', 'vesicle.js'), path.join('player', 'bloodVial.js')]) {
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
// ★「stat drop」那一段必须读出 BOSS_DROPS_ENABLED 本身，不能只印拾取次数：
//   只印次数的话，未来会话看到「拾取 0 次」分不清是「开关被关了」还是「授予链断了」——
//   这正是 2026-10-06 专属匣下线那次踩的坑（报表恒印 off，被当成回归查了半天）
console.log('boss drops:', bossDrops, '| boss chest:', BOSS_CHESTS_ENABLED
  ? `on (${sawPetChest ? 'dropped' : 'NOT dropped'} / pet ${sawPet ? 'granted' : 'NO'} / peak pets ${maxPets})`
  : `off (${sawPetChest ? '泄漏' : '0 只匣'} / peak pets ${maxPets})`,
  '| stat drop:', BOSS_DROPS_ENABLED
    ? `on (${sawStatChest ? 'dropped' : 'NOT dropped'} / 拾取 ${corePopCalls} 次 / 每次 ${popQueueLen < 0 ? '-' : popQueueLen} 行`
      + ` / 错开 ${popSpread < 0 ? '-' : popSpread + 'ms'} / applyBoost ${coreBoostCalls} 次`
      + ` / 注：chestsOpened 连 Boss 匣一起 +1，结算页「宝箱」芯片从此含它)`
    : `off (${sawStatChest ? '泄漏' : '0 只匣'} / 拾取 ${corePopCalls} 次)`,
  '| +x 全源: 升级', levelPopCalls, '/ 选卡', cardPopCalls, '/ 释放', releaseCalls,
  `/ 总弹 ${statPopCalls} | hold 泄漏 ${heldLeaks} / 挂死 ${stuckHeld}`);
// ★这一行必须把可达性本身（SEAFIRE_ON）印出来，而不只印一串零：LASER=0 那一组的零是旋钮掐掉了掉落，
//   不是回归 —— 同 2026-10-06「报表恒印 off 被当回归查了半天」那条坑
console.log(`cross laser (海火核心 ${SEAFIRE_ON ? 'on' : 'off（LASER 旋钮掐掉 boss2 那一行）'}):`,
  SEAFIRE_ON
    ? `海火死 ${boss2Drops} 只 / 拾取 ${crossGrants} 次 / 层数最高 ${crossInitLayers.length ? Math.max(...crossInitLayers.map((c) => c.layers)) : 0}`
      + ` | 掉血 ${crossHpLosses} 次（盾挡 ${crossBlockedShield}）→ 放出 ${crossFires} 根，同时在场峰值 ${crossPeak}`
      + ` | 结算帧 ${crossSettles} / 命中 ${crossHits} 次 共 ${crossDmg} 点（每层 ${LASER_CROSS_DMG}·束宽 ${LASER_CROSS_WIDTH}·束长 ${LASER_CROSS_LEN}·同怪间隔 ${LASER_CROSS_HIT_GAP}ms）`
      + ` | 它的飘字 ${crossTexts} 条（光束已静默，这条要 0）`
    : `海火死 ${boss2Drops} / 授予 ${crossGrants} / 放出 ${crossFires}（这一段要的全是 0）`,
  `| 轨迹 kills ${fieldKills} / lvl ${databus.player && databus.player.level} / enemies ${databus.enemys.length}`);
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
  'clots（磁吸内', fieldDropsNear, '）, field peak', fieldPeak, '| eaten in main loop:', clotEats,
  `| pure: 满血${clotFull.clot.collected ? '照吃' : '未吞'} 残血hp${clotHurt.player.hp} 封顶hp${clotEdge.player.hp}(${clotEdge.texts[0] && clotEdge.texts[0].damage})`);
console.log('leech (stacks=' + LEECH + ', chance=' + LEECH_CHANCE + '):', leechCalls, 'calls /', leechProcs,
  'procs /', leechHp, 'hp back (clamp-aware expect ' + leechRoom + ')',
  `| 一局 ${fieldKills} 杀 ≈ ${(fieldKills * LEECH_CHANCE).toFixed(1)} 口 = 1层 ${(fieldKills * LEECH_CHANCE).toFixed(1)} 血 / 3层 ${(fieldKills * LEECH_CHANCE * 3).toFixed(1)} 血`,
  `| pure: ${canForce ? `1层${leechOne.healed} 3层${leechA.healed} 封顶${leechB.healed} 满血${leechC.healed} 0层${leechE.healed}` : '跳过（LEECHP=0 钉死不触发）'}`);
console.log('vial (stacks=' + VIAL + ', gain=' + VIAL_SEC + 's, out=' + VIAL_OUT_CD / 1000 + 's×' + VIAL_OUT + '):',
  vialIn, 'in /', vialOut, 'out over', vialOutTicks, 'ticks | peak drops', vialDropsPeak, '| entity peak', maxVials,
  `| 存活 ${vialAlive.toFixed(0)}s ≈ 自增 ${vialExpectGain} 滴`,
  `| pure: 1层${vialGain1.vialDrops} 3层${vialGain3.vialDrops} 输送${vialPour.vialDrops}/${vialPour.hp} 欠债${vialDebt.vialDrops}/${vialDebt.hp} 到空${vialDrain.vialDrops}/${vialDrain.hp}`);
// ★报表行必须读出 TURRET 开关：off 那趟要把「两个读数都该是 0」直接印出来，
//   否则未来会话看到一行空字段分不清是回归还是这台子压根没开这个道具
console.log('turret (' + (TURRET === 0 ? 'TURRET=0 → off' : `stacks=${TURRET}, cd=${TURRET_CD / 1000}s, range=${TURRET_RANGE}, 落座 ${TURRET_AT}s`) + '):',
  TURRET === 0 ? `场上 ${maxTurrets} 座 / 开火 ${turretShots} 发（这条要两个都是 0）`
    : `座 ${maxTurrets} / 发 ${turretShots}（节拍利用率 ${turretUtil}，上界 ${turretShotBound}）`,
  `| 单发 ${turretDamage(26)} @攻26`,
  `| 索敌开销峰值 座×怪 ${turretScanPeak}`,
  `| 轨迹 kills ${fieldKills} / lvl ${databus.player && databus.player.level} / enemies ${databus.enemys.length}`
  + ` / 首只 Boss 死于 ${firstBossDeathAt < 0 ? '未出现' : `${firstBossDeathAt.toFixed(0)}s`}`,
  '| ★台子把几座全落在同一格（bot 走到角落就停，那里正是怪流的中心）→ 这条读的是 DPS 上界；真局里匣子摊在跑过的那条路上，老座子多半在空转');
console.log('companion volleys:', volleyRounds, '| per volley:', volleySizes.size ? [...volleySizes].join('/') : '-',
  '(pinned stacks=' + COMPANIONS + ')');
console.log('damage texts: peak', maxTexts, 'of cap', DAMAGE_TEXT_MAX, '| suppressed', suppressedTexts, 'of', totalTexts,
  `(${totalTexts ? (suppressedTexts / totalTexts * 100).toFixed(1) : '0.0'}%)`);
console.log('non-finite ctx args:', nonFinite, '| errors:', errors.length);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
