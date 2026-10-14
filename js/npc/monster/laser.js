import Sprite from '../../base/sprite';
import { UI } from '../../ui/theme';

/**
 * 海火的旋转激光：光束角度 = Boss 身体自转角 + 这颗眼在体侧的固定角，**永不朝玩家修正**。
 * 瞄准只在施法瞬间定一次，之后整条光束是被细胞自转「扫」出去的（对应真实的横鞭毛驱动自转），
 * 玩家读的是节奏和缝，不是被制导 —— 见「子弹不得追踪/拐弯」的既定规则。
 *
 * 三段生命周期，全部用 dt 累加推进（升级三选一会暂停 databus.update，时间戳写法会在暂停里白白流逝）：
 *   蓄力（细瞄准线，不判定）→ 扫射（判定）→ 淡出（不判定）
 * 归对象池管理，init 必须重置全部可变字段。
 */

// 5 颗「眼」（细胞核，真实机制里叫 scintillon）在体侧的固定位置
// a = 相对贴图水平轴的体侧角（弧度），r = 距 body 中心的比例；实测自 images/entity/boss_giantcell.png
// 相邻间隔依次 76°/60°/63°/82°/79°，改贴图眼位必须同步改这里，否则光和眼会脱开
export const LASER_EYES = [
  { a: -2.723, r: 0.35 }, // -156°
  { a: -1.396, r: 0.35 }, // -80°
  { a: -0.349, r: 0.35 }, // -20°
  { a: 0.750, r: 0.35 },  // +43°
  { a: 2.182, r: 0.35 },  // +125°
];

// 血量越低依次多点亮哪几颗眼（取前 N 个）：先点间隔最宽的，保证任何档下光束之间的缝 ≥60°
// 3 道 {0,4,2} 最小缝 79° / 4 道 {0,4,2,1} 60° / 5 道全亮 60°，N 由 config 的 eyeStages 给
export const LASER_LIGHT_ORDER = [0, 4, 2, 1, 3];

// 换向前多少毫秒开始画反向人字箭头：反向读不出来，玩家只会觉得"莫名其妙被切了一刀"
// 由 bossSeaFire 在每段扫射的末尾这么长时间里置 owner.warnTurn
export const TURN_WARN = 120;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 光束本体的三层描边：外晕 → 主束 → 内芯。禁渐变禁 shadowBlur（见 ART.md 第三节）。
 * ★导出是给友方那一根用的（js/player/laserCross.js「海火核心」放的就是这招）：敌我共用一条画法，
 *   宽度的三个比例才不会出现「Boss 那根看着比我的粗」这种两边各算一次的结果。
 *   判定宽度 = 主束 beamW，外晕故意只多 35% —— 晕再宽就是在画一条不存在的安全间隙，
 *   玩家会照着晕的边缘走位，然后被主束打到。
 * @param {number} a 整体亮度 0~1（淡出段传递减到 0 的值；蓄力段不走这里，走 paintTelegraph）
 */
export function paintBeam(ctx, ox, oy, ux, uy, len, beamW, tint, a) {
  const ex = ox + ux * len;
  const ey = oy + uy * len;
  ctx.lineCap = 'round';

  ctx.strokeStyle = tint;
  ctx.lineWidth = beamW * 1.35;
  ctx.globalAlpha = clamp01(a * 0.16);
  strokeBeam(ctx, ox, oy, ex, ey);

  ctx.lineWidth = beamW;
  ctx.globalAlpha = clamp01(a * 0.5);
  strokeBeam(ctx, ox, oy, ex, ey);

  ctx.strokeStyle = UI.cream;
  ctx.lineWidth = beamW * 0.26;
  ctx.globalAlpha = clamp01(a * 0.95);
  strokeBeam(ctx, ox, oy, ex, ey);
}

// 蓄力那根细瞄准线：宽度与颜色比例和主束同源，节奏（脉动、渐亮）各家自己定
export function paintTelegraph(ctx, ox, oy, ux, uy, len, tint, a) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = clamp01(a);
  strokeBeam(ctx, ox, oy, ox + ux * len, oy + uy * len);
}

function strokeBeam(ctx, x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export default class Laser extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = 0;        // 判定不靠圆（圆心距会把光束缩成一个点），见 hits()
    this.owner = null;      // 发光的 Boss，光束原点每帧贴着它转
    this.eye = 0;           // 用的是 LASER_EYES 里第几颗眼
    this.phase = 0;         // 0 蓄力 / 1 扫射 / 2 淡出
    this.phaseT = 0;        // 当前段已经过的毫秒数
    this.telegraph = 1100;
    this.fireTime = 4900;
    this.fade = 260;
    this.len = 470;
    this.beamW = 26;
    this.damage = 9;
    this.tint = '#22d3ee';
    this.ox = 0;            // 光束起点（眼位）
    this.oy = 0;
    this.ux = 1;            // 光束单位方向，终点 = 起点 + 单位方向 × len
    this.uy = 0;
    this.isDestroyed = false;
  }

  /**
   * @param {Object} cfg 光束参数：telegraph/fade/width/length/damage/tint
   * @param {number} fireTime 扫射段时长（毫秒）= Boss 整轮扫射的时长，跨多次换向不重启
   */
  init(owner, eye, cfg, fireTime) {
    this.owner = owner;
    this.eye = eye;
    this.telegraph = cfg.telegraph;
    this.fade = cfg.fade;
    this.beamW = cfg.width;
    this.len = cfg.length;
    this.damage = cfg.damage;
    this.tint = cfg.tint;
    this.fireTime = fireTime;
    this.phase = 0;
    this.phaseT = 0;
    this.isDestroyed = false;
    // 当场算一次端点：池里的上一份残留可能在地图另一头，不算就会在复用第 0 帧画出一条横跨全图的长线
    this.follow();
  }

  // 原点跟着转动的身体走：眼长在体侧 0.35×半径处，所以整束光是从那颗眼里"扫"出去的
  follow() {
    const e = LASER_EYES[this.eye];
    const a = this.owner.spin + e.a;
    const sr = this.owner.radius * e.r;
    this.ox = this.owner.x + Math.cos(a) * sr;
    this.oy = this.owner.y + Math.sin(a) * sr;
    this.ux = Math.cos(a);
    this.uy = Math.sin(a);
  }

  update(dt, databus) {
    const ms = dt * 1000;
    this.phaseT += ms;

    if (this.owner.isDead) {
      // Boss 死了就地熄灭：冻在最后一帧的光束上淡出，不去照"尸体留下的光"
      if (this.phase !== 2) {
        this.phase = 2;
        this.phaseT = 0;
      }
    } else {
      this.follow();
      if (this.phase === 0) {
        if (this.phaseT >= this.telegraph) {
          this.phase = 1;
          this.phaseT = 0;
        }
      } else if (this.phase === 1 && this.phaseT >= this.fireTime) {
        this.phase = 2;
        this.phaseT = 0;
      }
    }

    if (this.phase === 2) {
      if (this.phaseT >= this.fade) this.isDestroyed = true;
      return;
    }
    if (this.phase !== 1) return;

    const player = databus.player;
    // 命中后不置 isDestroyed：激光是持续伤害源，靠角色 500ms 无敌帧限流
    // （照抄 enemyBullet 的"命中即回收"会得到一根只响一次的激光）
    if (player && this.hits(player)) {
      player.takeDamage(this.damage, Date.now(), databus); // databus 是给角色那根十字激光的：见 Player.fireLaserCross
    }
  }

  // 点到线段距离：投影长度夹到 [0, len]，再量垂距，全程无除法
  hits(p) {
    const px = p.x - this.ox;
    const py = p.y - this.oy;
    let t = px * this.ux + py * this.uy;
    if (t < 0) t = 0;
    else if (t > this.len) t = this.len;
    const dx = px - this.ux * t;
    const dy = py - this.uy * t;
    const r = this.beamW / 2 + p.radius;
    return dx * dx + dy * dy < r * r;
  }

  draw(ctx) {
    ctx.save();
    if (this.phase === 0) this.drawTelegraph(ctx);
    else this.drawBeam(ctx);
    ctx.restore();
  }

  // 蓄力：一根脉动的细瞄准线 + 眼里聚光的点，明确表达"这条线现在还不疼"
  drawTelegraph(ctx) {
    const pulse = Math.abs(Math.sin(this.phaseT / 90));
    paintTelegraph(ctx, this.ox, this.oy, this.ux, this.uy, this.len, this.tint, 0.18 + 0.34 * pulse);
    // 光根只有 Boss 那一侧有：奶白点在"眼"里聚起来，友方那一根的原点是角色自己，画上去只会糊住脸
    ctx.globalAlpha = clamp01(0.35 + 0.6 * (this.phaseT / this.telegraph));
    ctx.fillStyle = UI.cream;
    ctx.beginPath();
    ctx.arc(this.ox, this.oy, 2 + 2 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // 扫射/淡出：三层描边见模块级 paintBeam
  drawBeam(ctx) {
    const a = this.phase === 2 ? 1 - this.phaseT / this.fade : 1;
    paintBeam(ctx, this.ox, this.oy, this.ux, this.uy, this.len, this.beamW, this.tint, a);
    if (this.phase === 1 && this.owner.warnTurn) this.drawTurnArrows(ctx, a);
  }

  // 换向预告：三枚人字箭头指向"下一段要扫回来的方向"（当前转向的反方向）
  // 距离按像素定死，不按光束长度取比例：470 的光束上 50% 已经在画面外，玩家看不见预告
  drawTurnArrows(ctx, a) {
    const turn = -this.owner.spinDir;
    const px = -this.uy * turn; // 垂直于光束、指向即将扫过去的方向
    const py = this.ux * turn;
    const s = 9;
    ctx.strokeStyle = UI.cream;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = clamp01(a * 0.85);
    for (const d of [90, 135, 180]) {
      const cx = this.ox + this.ux * d;
      const cy = this.oy + this.uy * d;
      ctx.beginPath();
      ctx.moveTo(cx - px * s * 0.5 - this.ux * s * 0.7, cy - py * s * 0.5 - this.uy * s * 0.7);
      ctx.lineTo(cx + px * s, cy + py * s);
      ctx.lineTo(cx - px * s * 0.5 + this.ux * s * 0.7, cy - py * s * 0.5 + this.uy * s * 0.7);
      ctx.stroke();
    }
  }
}
