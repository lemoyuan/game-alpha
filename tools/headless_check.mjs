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

const mainMod = await import(fileUrl(path.join(COPY, 'main.js')));
const databusMod = await import(fileUrl(path.join(COPY, 'databus.js')));
const {
  BOSS_CHESTS, BOSS_XP_GEMS, chestChance, chestExpectedSeconds,
  CHEST_FIRST_ROLL, CHEST_PITY, CHEST_CHANCE_BASE, CHEST_CHANCE_EXTRA,
} = await import(fileUrl(path.join(COPY, 'npc', 'monster', 'config.js')));
const Enemy = (await import(fileUrl(path.join(COPY, 'npc', 'monster', 'enemy.js')))).default;
const {
  BURN_TICK, BURN_HOLD, BURN_DMG, DAMAGE_TEXT_MAX,
  BOMB_CD, BOMB_BLAST_R, BOMB_BLAST_MS, BOMB_H_SPEED, BOMB_FLY_MIN, BOMB_FLY_MAX, bombDamage,
  ARENA_W, ARENA_H, ITEM_BAR,
} = await import(fileUrl(path.join(COPY, 'consts.js')));
const { UI } = await import(fileUrl(path.join(COPY, 'ui', 'theme.js')));
const { BONUSES } = await import(fileUrl(path.join(COPY, 'npc', 'chest.js')));
const Player = (await import(fileUrl(path.join(COPY, 'player', 'index.js')))).default;
// 两件新实体只要 import 就够（纯检直接驱动它们的原型，不经过主循环）
const Bomb = (await import(fileUrl(path.join(COPY, 'player', 'bomb.js')))).default;
const Bomber = (await import(fileUrl(path.join(COPY, 'player', 'bomber.js')))).default;
const Companion = (await import(fileUrl(path.join(COPY, 'player', 'companion.js')))).default;
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
// 燃烧层数同样钉死，理由和幸运一样：金匣七种加成里就有燃烧，不钉住两组跑的是两种随机 build。
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
let volleyRounds = 0;      // 跟班齐射轮数
const volleySizes = new Set(); // 每轮实际新增的子弹数：只应有一个取值且等于层数
let bombsThrown = 0;   // 扔出的枚数（按 Bomb.init 计，一轮 player.bomber 枚）
let bombBooms = 0;     // 引爆次数：理论上恒等于 bombsThrown，对不上了就是有用量没炸或有弹没飞完
let maxBombs = 0;      // 同屏在飞枚数峰值
let maxBombers = 0;    // 场上炸弹跟班只数峰值：★恒应为 1，长到 2 就是「层数当只数」回潮
let companionPeak = 0; // 同上，射击跟班也只该有一只
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
// 2) 时长两端夹逼：贴脸扔也要有抛物线，超远扔不能让玩家等一秒多才响
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
// 5) 落点选最密的一团，不是最近的一只：砸散兵亏掉的是整整 4 秒冷却
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
  // 蓄力环与弹体在三个冷却阶段各画一遍：读条那条弧的半径由 cdT 推出，最容易在 k=0 处出负值
  for (const k of [0, 0.5, 1]) {
    empty.cdT = BOMB_CD * k;
    empty.draw(ctx);
  }
}

// 暂停详情页的文案探针：把七种加成挂满，逼七行 describe 各拼一次并真画出来。
// ★这类 bug 只住在字符串里：bombDamage 收攻击力却传了整个 player，游戏照跑、数值检查全绿，
//   只有详情页那一行写成「单枚 NaN 点」。不扫文本就永远发现不了
{
  const real = databus.player;
  const probe = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
  // 一刀切写 3 不行：count 是各格自己的口径（子弹数从 1 起算、拾取范围存的是像素），
  // 全写 3 会让 pickupRange 算出负层数、被 ownedItems 当"没拾取过"滤掉，那一行就永远扫不到
  const OWNED = { bulletCount: 4, pierce: 3, shield: 3, companions: 3, bomber: 3, burnBullets: 3, pickupRange: 170 };
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
console.log('boss drops:', bossDrops, '| pet granted:', sawPet ? 'yes' : 'NO', '| peak pets:', maxPets);
console.log('chest spawns (luck=' + LUCK + '):', chestStamps.length,
  '| avg gap:', avgGap.toFixed(1) + 's', '| worst gap:', worstGap.toFixed(1) + 's',
  '| first:', chestStamps.length ? chestStamps[0].toFixed(1) + 's' : '-');
console.log('chest chance:', CURVE_POINTS.map((l, i) => `${l}→${(curve[i] * 100).toFixed(2)}%/${chestExpectedSeconds(l).toFixed(1)}s`).join(' '));
console.log('burn (stacks=' + BURN + '):', burnTicks, 'ticks /', burnDmg, 'dmg | peak burning:', maxBurning,
  '| pure cadence: 1层=' + burn1.ticks + '跳·' + burn1.dmg + '血, 3层=' + burn3.dmg + '血, 中途补枪=' + burnRefresh.ticks + '跳·单跳最大' + burnRefresh.maxTick);
console.log('bomb (stacks=' + BOMBER + '):', fieldThrown, 'thrown /', fieldBooms, 'boomed | peak in flight:', maxBombs,
  '| entity peak: companion', companionPeak, 'bomber', maxBombers);
console.log('companion volleys:', volleyRounds, '| per volley:', volleySizes.size ? [...volleySizes].join('/') : '-',
  '(pinned stacks=' + COMPANIONS + ')');
console.log('damage texts: peak', maxTexts, 'of cap', DAMAGE_TEXT_MAX, '| suppressed', suppressedTexts, 'of', totalTexts,
  `(${totalTexts ? (suppressedTexts / totalTexts * 100).toFixed(1) : '0.0'}%)`);
console.log('non-finite ctx args:', nonFinite, '| errors:', errors.length);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
