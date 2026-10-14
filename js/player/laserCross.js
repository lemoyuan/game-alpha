import Sprite from '../base/sprite';
import { paintBeam, paintTelegraph } from '../npc/monster/laser';
import { UI } from '../ui/theme';
import {
  LASER_CROSS_TELEGRAPH, LASER_CROSS_FIRE, LASER_CROSS_FADE, LASER_CROSS_SPIN,
  LASER_CROSS_WIDTH, LASER_CROSS_LEN, LASER_CROSS_DMG, LASER_CROSS_HIT_GAP, laserCrossDamage,
} from '../consts';

/**
 * 十字激光：Boss 掉落道具「海火核心」的效果实体 —— 挨一下真伤，就以角色为原点放出一根旋转的十字光束。
 * 它是海火那招的友方版，所以画法（模块级 paintBeam / paintTelegraph）和判定几何（点到线段垂距）都从 laser.js 借，
 * 敌我两侧同一条口径；反过来的两件事是故意的：tint 用红而不是海火那身青，原点用角色而不是身体上的某一颗眼。
 *
 * ★与 Boss 那一招的三处不同，每一处都改了语义而不是数值：
 *   ① 光束原点是活的、跟着角色走（Boss 那根的原点长在自转的身体上，所以是"扫"；这根跟着你，所以是"你身上炸开的光"）
 *   ② 朝向不修正、也不索敌，只在触发那一刻取角色朝向当起点，之后按固定角速度转（同"子弹不得追踪"那条规则）
 *   ③ 伤害结在怪身上，靠本根自己的 LASER_CROSS_HIT_GAP 限流 —— 怪没有受击无敌帧，而十字贴身时四根束会同时压在一只怪上
 *
 * 三段生命周期照 Boss 那条一样全用 dt 累加推进（升级三选一会跳过 databus.update，墙上时钟写法会在面板里白白流逝）：
 *   蓄力（细瞄准线，不判定）→ 扫射（判定）→ 淡出（不判定）
 * 归对象池管理，init 必须重置全部可变字段。
 */
const BEAMS = 4;              // ★恒为 4：十字是这件道具的图标许下的形状，不随层数变。层数买的是「每次结算几滴血」，
                              //   买"几根束"会让八层的它读成米老鼠而不是十字（口径同燃烧/嗜血的「节拍恒定」）
const HALF_TURN = Math.PI / 2;

export default class LaserCross extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = 0;          // 判定不靠圆（同 Laser：圆心距会把一束光缩成一个点），见 hits()
    this.spin = 0;            // 十字的当前朝向（弧度），扫射段每帧按 dt 推进
    this.phase = 0;           // 0 蓄力 / 1 扫射 / 2 淡出
    this.phaseT = 0;          // 当前段已经过的毫秒数
    this.clock = 0;           // 本根十字已经过的总毫秒数，只用来给同目标限流（不用 Date.now：面板冻住时限流表会照跑）
    this.damage = LASER_CROSS_DMG;
    this.beamW = LASER_CROSS_WIDTH;
    this.len = LASER_CROSS_LEN;
    this.tint = UI.red;
    this.hitAt = new Map();   // 怪 → 上一次被本根结算时的 clock 读数
    this.isDestroyed = false;
  }

  /**
   * @param {number} layers 海火核心的层数（player.laserCross），只涨每次结算的血
   * @param {number} angle  触发那一刻的角色朝向，四根束里有一根从它出发
   */
  init(layers, angle) {
    this.damage = laserCrossDamage(layers);
    this.spin = angle;
    this.phase = 0;
    this.phaseT = 0;
    this.clock = 0;
    // ★必须清：上一根的限流表带进这一根，同一只怪会在开头 500ms 里免结，
    //   而"贴脸那一下最疼"正是这件道具唯一读得出来的反馈
    this.hitAt.clear();
    this.isDestroyed = false;
  }

  update(dt, databus) {
    const player = databus.player;
    // 原点是角色本人，角色不在了这根光就没有主人（结算面板接管屏幕的那一帧起 databus.update 已经不再跑，
    // 这条只是兜住"同帧内被回收"那种边角，不打算让它成为常态）
    if (!player) {
      this.isDestroyed = true;
      return;
    }
    const ms = dt * 1000;
    this.clock += ms;
    this.phaseT += ms;
    this.x = player.x;
    this.y = player.y;

    if (this.phase === 2) {
      // 淡出段连朝向一起钉住：不判定却一直往前扫，玩家会照着这根假光走位，然后被下一根真的打
      if (this.phaseT >= LASER_CROSS_FADE) this.isDestroyed = true;
      return;
    }

    this.spin += LASER_CROSS_SPIN * dt;

    if (this.phase === 0) {
      if (this.phaseT >= LASER_CROSS_TELEGRAPH) {
        this.phase = 1;
        this.phaseT = 0;
      }
      return; // 蓄力不判定
    }

    if (this.phaseT >= LASER_CROSS_FIRE) {
      this.phase = 2;
      this.phaseT = 0;
      return;
    }
    this.settle(databus);
  }

  /**
   * 扫射段的逐帧结算。★不吃暴击，两个理由都记在 consts 的 LASER_CROSS_DMG 上：
   * 它的伤害不按攻击力取比例，再乘 critMult 等于把「暴击 +10%」那张卡也接进这件道具；
   * 而一轮扫射要结几十只怪，逐只掷会让暴击率在 AOE 上偷偷翻倍（bomb.js detonate 那条旧账），
   * 整根掷一次又说不清"三段 × 每段多次结算"里到底掷了几回。所以两边都不接。
   */
  settle(databus) {
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const last = this.hitAt.get(e);
      if (last !== undefined && this.clock - last < LASER_CROSS_HIT_GAP) continue;
      if (!this.hits(e)) continue;
      this.hitAt.set(e, this.clock);
      // 第 4 个参数 color 留空、第 5 个 silent 置真：这根光束不掉字。
      // 一轮扫射同时压住几十只怪，逐只跳会把飘字池（DAMAGE_TEXT_MAX=160）灌满，
      // 玩家自己普攻的数字反而一条都看不到（实测 420 秒站桩局：光束占掉全部飘字的 95.2%）。
      // 光束自己那 1.5 秒的扫射就是这根的反馈，不需要第二层数字重复说一遍
      e.takeDamage(this.damage, false, databus, undefined, true);
    }
  }

  // 点到线段垂距，四根束各自量一次。比较全程用平方、无除法（同 Laser.hits）；
  // t 不夹到 [0, len] 而是直接判掉：光束是有向的，束尾背后那一侧不该也疼
  hits(e) {
    const px = e.x - this.x;
    const py = e.y - this.y;
    const r = this.beamW / 2 + e.radius;
    const rr = r * r;
    for (let k = 0; k < BEAMS; k++) {
      const a = this.spin + k * HALF_TURN;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const t = px * ux + py * uy;
      if (t <= 0 || t > this.len) continue;
      const dx = px - ux * t;
      const dy = py - uy * t;
      if (dx * dx + dy * dy < rr) return true;
    }
    return false;
  }

  draw(ctx) {
    ctx.save();
    if (this.phase === 0) {
      // 四根细线同时脉动：相位取 clock 而不是 phaseT，这样蓄力段末尾不会看到某个方向先亮
      const pulse = 0.18 + 0.34 * Math.abs(Math.sin(this.clock / 90));
      for (let k = 0; k < BEAMS; k++) {
        const a = this.spin + k * HALF_TURN;
        paintTelegraph(ctx, this.x, this.y, Math.cos(a), Math.sin(a), this.len, this.tint, pulse);
      }
    } else {
      const alpha = this.phase === 2 ? 1 - this.phaseT / LASER_CROSS_FADE : 1;
      for (let k = 0; k < BEAMS; k++) {
        const a = this.spin + k * HALF_TURN;
        paintBeam(ctx, this.x, this.y, Math.cos(a), Math.sin(a), this.len, this.beamW, this.tint, alpha);
      }
    }
    ctx.restore();
  }
}
