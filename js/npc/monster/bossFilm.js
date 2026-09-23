import Enemy from './enemy';
import Colony from './colony';
import Slime from './slime';
import EnemyBullet from './enemyBullet';
import { MONSTER_TYPES } from './config';
import { clampToCoast } from '../../arena/coast';
import { UI } from '../../ui/theme';

/**
 * 三号 Boss「膜王」（Pseudomonas aeruginosa 生物膜态）
 *
 * 和前两只正交：毒王考「躲」，海火考「走缝」，这一场考「优先级目标」。
 * 本体几乎不动、玩家射程又长，本可以白嫖站桩 —— 是爬回来补膜的菌群把站桩变成了
 * 必须回头清场的仗。所以本文件最要紧的不是弹道，而是膜层与三条冷却的耦合。
 *
 * 为什么不 extends Boss：boss.js 是毒王的套件（硬编 chargeSpeed/ringCount/summonCount 和
 * `skillIndex % 3`），海火已经验证过「直接继承 Enemy + dt 时间轴」这条路。
 *
 * 三条独立冷却（齐射 / 吐菌 / 黏液）+ 一个正交的膜层：
 *   膜没有自己的 state，只有 film 数值和 exposed 标记；破膜期间三条冷却照常走，
 *   破膜不是停手期，玩家要边躲边打。
 *
 * 瞄准模型是「倾身」不是「炮塔」：本体只在 ±leanMax（约 24°）之间歪一下身子（贴图有明确上下，
 *   整圈转会看成一条侧躺的蛞蝓）。三根管口本身的张角只有 47°，靠 ejectArc 放宽到 ±83°
 *   才把可打范围撑到约 303°，正下方约 57° 仍是死角 —— 死角不是安全区，
 *   那个方向上齐射会改喷菌群，也就是玩家最该回头清场的位置（见 tryCast）。
 *
 * 时间轴一律 dt 累加（+= dt * 1000），不用 Date.now()：main.js 在升级三选一（isPaused）
 * 时整段跳过 update，用时间戳会在暂停里白白流逝，回来就"卡在转向中途"。
 */

// 贴图几何：实测自 images/entity/boss_biofilm.png（见 .preview/shots/sf_biofilm_mark.png）
// a = 相对贴图水平轴的角（弧度，y 朝下），r = 距中心的比例 × 贴图半边长（spriteSize 96 → 48px）
// ★改贴图必须同步改这里，否则液滴会从管子旁边喷出去
export const CHIMNEY = [
  { a: -2.461, r: 0.60 }, // 左管，219°
  { a: -1.536, r: 0.65 }, // 中管，272° —— 对齐时以这一根为准
  { a: -0.913, r: 0.69 }, // 右管，308°
];

// 底部孔口：菌群从这里被喷出去，也是回嵌的入口（牵引线画到这儿）
const HOLE = { a: 0.332, r: 0.70 };

// 膜里封着的三颗菌：key 指向它对应的杂兵类型，高亮色直接从 MONSTER_TYPES 取，改配色不会脱开
const EMBEDDED = [
  { a: 2.862, r: 0.52, key: 'basic' },
  { a: 2.967, r: 0.26, key: 'tank' },
  { a: 0.187, r: 0.13, key: 'fast' },
];

// 黏液洼的 6 个等分槽位半径（像素）。相邻槽位心距 = 2R·sin30° = R，必须 > 2×slimeRadius
// 才封不成一整圈：110×2=220 < 230，所以任意两片的边缘之间恒留 10px 以上能挤过去的缝
const SLIME_RING = 230;

// 常态的"看向玩家"只允许用满倾身幅度的一小部分：静止直立才显出齐射前那次倾身是读招
const IDLE_TRACK = 0.14;

// 破膜瞬间的世界空间爆环时长（毫秒）：不用 toast —— 单条 toast 会被出场提示抢掉，
// 而"膜破了"正是玩家该立刻知道的事，画在场上比弹一行字诚实
const FILM_BURST = 360;

// 孔口吐菌群的鼓胀动画时长（毫秒）
const MOUTH_POP = 520;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// 本体倾身范围：贴图有明确上下（烟囱朝上、孔口和基座垫朝下），转过了就成一条侧躺的蛞蝓
const clampLean = (a, max) => (a > max ? max : a < -max ? -max : a);

// 每帧最多挪 maxStep 朝 target 靠，够近就直接落位：省得绕着目标来回抖
const easeTo = (cur, target, maxStep) => {
  const d = target - cur;
  return Math.abs(d) <= maxStep ? target : cur + (d > 0 ? maxStep : -maxStep);
};

// 把角度差折到 [-π, π]：否则"往左转 350°"会被当成比"往右转 10°"更近
const shortAngle = (a) => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

export default class BossFilm extends Enemy {
  constructor(type, config) {
    super(type, config);
    const cfg = config;
    // —— 膜层 ——
    this.filmMax = cfg.filmMax;
    this.filmReduce = cfg.filmReduce;
    this.filmBurn = cfg.filmBurn;
    this.exposeMult = cfg.exposeMult;
    this.exposeTime = cfg.exposeTime;
    this.filmRegen = cfg.filmRegen;
    this.filmRecover = cfg.filmRecover;
    this.filmPerEmbed = cfg.filmPerEmbed;
    this.film = cfg.filmMax;
    this.exposed = false;
    this.exposeT = 0;
    this.burstT = 0;
    // —— 菌群 ——
    this.colonyCd = cfg.colonyCd;
    this.colonyCount = cfg.colonyCount;
    this.colonyTypes = cfg.colonyTypes;
    this.colonyDist = cfg.colonyDist;
    this.colonyCfg = cfg; // Colony 只要 colonySpeed/HpMult/Burst 几个值，整块传过去最省事
    // —— 齐射 ——
    this.ejectCd = cfg.ejectCd;
    this.alignTime = cfg.alignTime;
    this.turnRate = cfg.turnRate;
    this.leanMax = cfg.leanMax;
    this.spinIdle = cfg.spinIdle;
    this.ejectTelegraph = cfg.ejectTelegraph;
    this.ejectCount = cfg.ejectCount;
    this.ejectSpread = cfg.ejectSpread;
    this.ejectArc = cfg.ejectArc;
    this.bulletDamage = cfg.bulletDamage || cfg.damage;
    // Enemy 只给远程杂兵映射 bullet* 字段，Boss 走的是同一套命名，这里补齐
    this.bulletSpeed = cfg.bulletSpeed;
    this.bulletRadius = cfg.bulletRadius;
    this.bulletColor = cfg.bulletColor;
    // —— 黏液 ——
    this.slimeCd = cfg.slimeCd;
    this.slimeCount = cfg.slimeCount;
    this.slimeRadius = cfg.slimeRadius;
    this.slimeWarn = cfg.slimeWarn;
    this.slimeLife = cfg.slimeLife;
    this.slimeColor = cfg.slimeColor;
    this.slowMult = cfg.slowMult;
    this.slowHold = cfg.slowHold;
    // —— 运行期 ——
    this.spin = 0;         // 本体倾身角，恒在 ±leanMax 内；0 = 直立
    this.leanTarget = 0;   // 本轮齐射要倾到位的角度，beginAlign 时锁死
    this.state = 'idle';   // idle | align | telegraph
    this.stateT = 0;
    this.colonyT = 0;
    this.ejectT = 0;
    this.slimeT = 0;
    this.mouthT = 0;
    this.fireVents = [];   // 本轮真正会开火的管号，前摇画的就是它，绝不事后改口
    this.animT = 0;        // 只做视觉摆动的累计秒数
    this.seed = Math.random() * 100; // 裂纹角度种子：draw 里不许随机，否则每帧换一套裂纹
    this.embeddedTints = EMBEDDED.map((e) => MONSTER_TYPES[e.key].color);
    this.holeAngle = HOLE.a; // 每帧刷新，Colony 拿它画牵引线终点
    this.holeDist = 0;
  }

  init(x, y) {
    super.init(x, y);
    this.spin = 0;
    this.leanTarget = 0;
    this.state = 'idle';
    this.stateT = 0;
    // 三条冷却错开起点：ejectCd(4.2s) < colonyCd(7.6s) < slimeCd(9s)，
    // 都从 0 起走自然就是齐射先来、菌群随后、黏液压轴，不需要额外的 firstDelay
    this.colonyT = 0;
    this.ejectT = 0;
    this.slimeT = 0;
    this.mouthT = 0;
    this.fireVents = [];
    this.film = this.filmMax;
    this.exposed = false;
    this.exposeT = 0;
    this.burstT = 0;
    this.seed = Math.random() * 100;
  }

  // 贴图跟着倾身角转：三根管口的位置关系就是这个 Boss 的全部读招，不能朝玩家单独修正
  spriteAngle() {
    return this.spin;
  }

  update(dt, databus) {
    const ms = dt * 1000;
    this.stateT += ms;
    this.colonyT += ms;
    this.ejectT += ms;
    this.slimeT += ms;
    this.mouthT = Math.max(0, this.mouthT - ms);
    this.burstT = Math.max(0, this.burstT - ms);
    this.animT += dt;

    this.updateFilm(ms);

    switch (this.state) {
      case 'idle': {
        super.update(dt, databus); // 只有常态会挪窝；speed 26 只是"会长"级别的蠕动，不构成追击压力
        const player = databus.player;
        // 常态只是把身子微微朝玩家歪一点，幅度压到 IDLE_TRACK：留足"直立 = 没要打"的余量
        const target = player ? this.leanTo(player) * IDLE_TRACK : 0;
        this.spin = easeTo(this.spin, target, this.spinIdle * dt);
        this.tryCast(databus);
        break;
      }
      case 'align':
        this.updateAlign(dt);
        break;
      case 'telegraph':
        // ★倾身角一个字都不动：管子还在晃的话，画出去的瞄准线就是骗人的
        if (this.stateT >= this.ejectTelegraph) this.fire(databus);
        break;
      default:
        break;
    }

    const half = this.width / 2;
    this.holeAngle = this.spin + HOLE.a;
    this.holeDist = HOLE.r * half;
  }

  // 膜层推进：破膜窗口是固定时长（弱 build 也一定拿得到），窗口过后自己只能分泌到 filmRecover
  updateFilm(ms) {
    if (this.exposed) {
      this.exposeT -= ms;
      if (this.exposeT <= 0) {
        this.exposed = false;
        this.exposeT = 0;
      }
      return;
    }
    if (this.film < this.filmRecover) {
      this.film = Math.min(this.filmRecover, this.film + this.filmRegen * (ms / 1000));
    }
  }

  // 冷却到点就在常态里择机发动；倾身/前摇期间只记账不发动，避免两层前摇叠在一起读不清
  tryCast(databus) {
    if (this.ejectT >= this.ejectCd) {
      this.ejectT = 0;
      const player = databus.player;
      if (!player) return;
      // ★管号必须按"倾到位之后"的角度算。用当前角度选会把齐射死角量宽整整一个 leanMax，
      //   而且倾完身才发现某根管其实对得上了，本轮少打的几发等于白扣
      const lean = this.leanTo(player);
      const vents = this.ventsFacing(player, lean);
      // 一根都对不上 = 玩家站在穹体正下方的死角里，本体倾不过去：这一轮改喷菌群。
      // 死角因此不是安全区，而是"菌落正朝你脸上爬、你必须回头清场"的那一侧
      if (vents.length) this.beginAlign(lean, vents);
      else this.ejectColonies(databus);
      return;
    }
    if (this.colonyT >= this.colonyCd) {
      this.ejectColonies(databus);
      return;
    }
    if (this.slimeT >= this.slimeCd) {
      this.secretSlime(databus);
    }
  }

  // 把中管（编号 1）压到「本体→玩家」方向所需的倾身角，收进 ±leanMax
  leanTo(player) {
    const aim = Math.atan2(player.y - this.y, player.x - this.x);
    return clampLean(shortAngle(aim - CHIMNEY[1].a), this.leanMax);
  }

  // 倾到 lean 这个角度后，管口径向与「本体→玩家」夹角在 ejectArc 内的才算这一轮的火力
  ventsFacing(player, lean) {
    const out = [];
    if (!player) return out;
    const aim = Math.atan2(player.y - this.y, player.x - this.x);
    for (let i = 0; i < CHIMNEY.length; i++) {
      if (Math.abs(shortAngle(lean + CHIMNEY[i].a - aim)) <= this.ejectArc) out.push(i);
    }
    return out;
  }

  // 倾身以中管为准，够不着的管自动少打几发：玩家可以绕着穹体跑，把管口数从三根绕成一根
  beginAlign(lean, vents) {
    this.stateT = 0;
    this.state = 'align';
    this.fireVents = vents;
    this.leanTarget = lean;
  }

  updateAlign(dt) {
    const d = this.leanTarget - this.spin;
    if (Math.abs(d) <= this.turnRate * dt) {
      this.spin = this.leanTarget;
      this.beginTelegraph();
      return;
    }
    // alignTime 只是兜底上限（turnRate 被人调慢时才用）：到点就地开火，不许瞬移补差
    if (this.stateT >= this.alignTime) {
      this.beginTelegraph();
      return;
    }
    this.spin += d > 0 ? this.turnRate * dt : -this.turnRate * dt;
  }

  beginTelegraph() {
    this.state = 'telegraph';
    this.stateT = 0;
  }

  // ★子弹只沿管口径向直线飞出，永不再朝玩家修正：前摇画的就是这条线
  fire(databus) {
    const half = this.width / 2;
    for (const vent of this.fireVents) {
      const c = CHIMNEY[vent];
      const wa = this.spin + c.a;
      const mx = this.x + Math.cos(wa) * c.r * half;
      const my = this.y + Math.sin(wa) * c.r * half;
      for (let k = 0; k < this.ejectCount; k++) {
        // 单口两发以管口径向为轴对称展开；ejectCount=1 时不偏移
        const off = (k - (this.ejectCount - 1) / 2) * this.ejectSpread;
        const a = wa + off;
        const bullet = databus.pool.getItemByClass('enemyBullet', EnemyBullet);
        bullet.init(mx, my, Math.cos(a), Math.sin(a),
          this.bulletSpeed, this.bulletDamage, this.bulletColor, this.bulletRadius);
        databus.enemyBullets.push(bullet);
      }
    }
    this.fireVents = [];
    this.endCast();
  }

  endCast() {
    this.state = 'idle';
    this.stateT = 0;
  }

  // 分散（dispersal）：从底部孔口喷出一批细胞，飞到位后掉头爬回来重新定植
  ejectColonies(databus) {
    this.colonyT = 0;
    this.mouthT = MOUTH_POP;
    const half = this.width / 2;
    const holeA = this.spin + HOLE.a;
    const hx = this.x + Math.cos(holeA) * HOLE.r * half;
    const hy = this.y + Math.sin(holeA) * HOLE.r * half;
    const n = this.colonyCount;
    for (let i = 0; i < n; i++) {
      const type = this.colonyTypes[i % this.colonyTypes.length];
      const colony = new Colony(type, MONSTER_TYPES[type], this.colonyCfg);
      // 一个孔口扇形喷出，别三只叠成一只
      const a = holeA + (i - (n - 1) / 2) * 0.42;
      const flipAt = this.colonyDist[0] + Math.random() * (this.colonyDist[1] - this.colonyDist[0]);
      colony.init(hx, hy);
      colony.launch(this, Math.cos(a), Math.sin(a), flipAt);
      databus.enemys.push(colony);
    }
  }

  // 黏液洼：6 个等分槽位里点 3 个。减速不结算伤害（见 slime.js 的说明），所以踩多少片都不占无敌帧
  secretSlime(databus) {
    this.slimeT = 0;
    const slots = this.pickSlots();
    const step = (Math.PI * 2) / 6;
    const offset = Math.random() * Math.PI * 2;
    for (const slot of slots) {
      const a = offset + slot * step;
      const pos = { x: this.x + Math.cos(a) * SLIME_RING, y: this.y + Math.sin(a) * SLIME_RING };
      clampToCoast(pos, this.slimeRadius * 0.5); // 整片都甩到岸外的黏液等于没铺
      const slime = databus.pool.getItemByClass('slime', Slime);
      slime.init(pos.x, pos.y, this.slimeRadius, this.slimeLife, this.slimeWarn,
        this.slowMult, this.slowHold, this.slimeColor);
      databus.zones.push(slime);
    }
  }

  // 6 个等分槽位里随机取 slimeCount 个。不用额外挑：相邻槽位心距 230 > 2×110，两片永远不重叠；
  // 而 3 段间隔加起来正好 6 格，最大的一段必然 ≥2 格 = 120°，减速中的玩家永远绕得出去
  pickSlots() {
    const order = [0, 1, 2, 3, 4, 5];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    return order.slice(0, this.slimeCount);
  }

  /**
   * 受击结算：全项目唯一一个带减伤的覆写。
   * ★侵蚀必须按【原始伤害】算，和减伤解耦：否则减伤会把侵蚀也一起减掉，膜永远破不开（软锁）。
   *   破满膜固定需要 filmMax ÷ filmBurn = 1000 点原始伤害，与玩家 build 无关。
   * 减伤比例按膜厚线性折算（不是"有膜就满额"）：1 点膜也吃 68% 减伤是在撒谎，
   * 而且会让 filmRecover 那条自分泌底线变成一堵墙。
   */
  takeDamage(dmg, isCrit, databus) {
    let applied = dmg;
    if (this.film > 0) {
      this.film = Math.max(0, this.film - dmg * this.filmBurn);
      const ratio = this.film / this.filmMax;
      applied = Math.max(1, Math.round(dmg * (1 - this.filmReduce * ratio)));
      if (this.film === 0) this.onFilmBreak();
    } else if (this.exposed) {
      applied = Math.round(dmg * this.exposeMult);
    }
    super.takeDamage(applied, isCrit, databus); // 飘字读到手伤害，别报原始值骗玩家
  }

  onFilmBreak() {
    this.exposed = true;
    this.exposeT = this.exposeTime;
    this.burstT = FILM_BURST;
  }

  // 菌群嵌回膜里：这是"拦下菌群"这件事的惩罚面 —— 补回来的不只是膜，还会直接掐掉破膜窗口
  absorb() {
    this.film = Math.min(this.filmMax, this.film + this.filmPerEmbed);
    if (this.exposed) {
      this.exposed = false;
      this.exposeT = 0;
    }
  }

  draw(ctx) {
    super.draw(ctx);
    this.drawFilm(ctx);
    this.drawCracks(ctx);
    this.drawVents(ctx);
    this.drawHole(ctx);
    this.drawBurst(ctx);
  }

  // 膜壳：贴着贴图外沿的一层平色盘（禁渐变、禁 shadowBlur），越薄越透、越薄越收回判定边上。
  // 必须画成椭圆：贴图是 192 见方但穹体只有 132 高，画正圆会像套了个泡泡在生物外面
  // 满膜时把本体洗成一片象牙白 —— 那三颗菌被糊住看不见，正是"膜封着菌"的样子
  drawFilm(ctx) {
    const ratio = clamp01(this.film / this.filmMax);
    const rr = this.radius + 2;
    ctx.save();
    if (ratio > 0) {
      ctx.globalAlpha = 0.08 + 0.2 * ratio;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rr * (1 + 0.22 * ratio), rr * (1.02 + 0.07 * ratio), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 判定边：贴图比碰撞盒大一圈，这圈线同时负责说"膜还剩多少"和"贴到哪算撞上"
    ctx.globalAlpha = this.exposed ? 0.9 : 0.45 + 0.45 * ratio;
    ctx.strokeStyle = this.exposed ? '#8C3B3B' : this.color;
    ctx.lineWidth = this.exposed ? 3 : 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 裂纹：膜越薄裂口越多越亮。角度用 init 里的 seed 算死，draw 不许随机
  drawCracks(ctx) {
    const ratio = this.film / this.filmMax;
    if (ratio <= 0 || ratio > 0.66) return;
    const n = ratio > 0.33 ? 3 : 6;
    const half = this.width / 2;
    ctx.save();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5 * (1 - ratio);
    for (let i = 0; i < n; i++) {
      const a = this.spin + this.seed + i * ((Math.PI * 2) / n);
      const r0 = half * 0.3;
      const r1 = half * (0.82 + 0.1 * ((i % 3) / 2));
      const bend = a + 0.22 * (i % 2 ? 1 : -1);
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(a) * r0, this.y + Math.sin(a) * r0);
      ctx.lineTo(this.x + Math.cos(bend) * (r0 + r1) * 0.5, this.y + Math.sin(bend) * (r0 + r1) * 0.5);
      ctx.lineTo(this.x + Math.cos(a) * r1, this.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 三根管口平时也点亮：玩家得先知道"枪在哪"，才读得懂后来哪几根在鼓
  // 倾身期间：本轮会开火的管子先亮起来；前摇期间再鼓起绿脓素液滴 + 一条径向瞄准线，液滴长满就打出去
  drawVents(ctx) {
    const half = this.width / 2;
    const aiming = this.state === 'align' || this.state === 'telegraph';
    const p = this.state === 'telegraph' ? clamp01(this.stateT / this.ejectTelegraph) : 0;
    ctx.save();
    for (let i = 0; i < CHIMNEY.length; i++) {
      const c = CHIMNEY[i];
      const wa = this.spin + c.a;
      const mx = this.x + Math.cos(wa) * c.r * half;
      const my = this.y + Math.sin(wa) * c.r * half;
      const lit = aiming && this.fireVents.indexOf(i) >= 0;

      // 管口本身：深色孔 + 识别色薄边，压在象牙膜上才看得出一排洞
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = UI.ink;
      ctx.beginPath();
      ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = lit ? 1 : 0.5;
      ctx.strokeStyle = this.bulletColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, lit ? 6 + 8 * p : 6, 0, Math.PI * 2);
      ctx.stroke();
      if (!lit) continue;

      // 液滴：从 0 长到 1.15 倍再射；这颗是"要疼的东西"，画得比管口亮
      ctx.globalAlpha = 0.35 + 0.5 * p;
      ctx.fillStyle = this.bulletColor;
      ctx.beginPath();
      ctx.arc(mx, my, 2 + 6 * p, 0, Math.PI * 2);
      ctx.fill();

      // 瞄准线：严格沿管口径向，和 fire() 的初始弹道是同一条线， spin 已冻结所以不会改口
      ctx.strokeStyle = this.bulletColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5 * p;
      const len = 60 + 120 * p;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(wa) * 12, my + Math.sin(wa) * 12);
      ctx.lineTo(mx + Math.cos(wa) * len, my + Math.sin(wa) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 孔口：吐菌群时鼓一下；破膜期间把膜里那三颗菌的高光闪出来 = "露肉"
  drawHole(ctx) {
    const half = this.width / 2;
    const hx = this.x + Math.cos(this.holeAngle) * this.holeDist;
    const hy = this.y + Math.sin(this.holeAngle) * this.holeDist;
    ctx.save();
    const pop = this.mouthT > 0 ? clamp01(1 - this.mouthT / MOUTH_POP) : 0;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    if (pop > 0) {
      // 鼓包先起后落：正弦半周期，收尾回到 0 才像"吐完了"
      const swell = Math.sin(pop * Math.PI) * 9;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(hx, hy, 3 + swell, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.exposed) this.drawEmbedded(ctx, half);
    ctx.restore();
  }

  // 膜里封着的三颗菌：破膜期间轮流反光，把"它靠这几只补膜"这件事画在 Boss 身上
  drawEmbedded(ctx, half) {
    const t = this.animT * 2.4;
    for (let i = 0; i < EMBEDDED.length; i++) {
      const e = EMBEDDED[i];
      const a = this.spin + e.a;
      const d = e.r * half;
      const ex = this.x + Math.cos(a) * d;
      const ey = this.y + Math.sin(a) * d;
      const pulse = 0.5 + 0.5 * Math.sin(t + i * 2.1);
      ctx.globalAlpha = 0.25 + 0.5 * pulse;
      ctx.fillStyle = this.embeddedTints[i];
      ctx.beginPath();
      ctx.arc(ex, ey, 3 + 2 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 破膜爆环：只活 FILM_BURST 毫秒的一圈象牙色扩散环，比 toast 抢不过出场提示更可靠
  drawBurst(ctx) {
    if (this.burstT <= 0) return;
    const p = clamp01(1 - this.burstT / FILM_BURST);
    ctx.save();
    ctx.strokeStyle = UI.cream;
    ctx.lineWidth = 6 * (1 - p) + 1;
    ctx.globalAlpha = 0.75 * (1 - p);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + p * 300, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
