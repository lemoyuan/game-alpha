import Sprite from '../../base/sprite';
import { ABYSS } from '../../consts';
import { UI } from '../../ui/theme';

/**
 * 赤潮池：海火暴发性增殖留下的一片发光水体，压住玩家的落脚处。踩上去 = 中毒，
 * 毒素挂在身上按 POISON_TICK 持续跳血，离开池子也还要掉好一会儿——这才是「封落脚处」的代价。
 * 坐标在 init 一次写定，之后**永不移动、永不追踪**——赤潮是死水，不是会追人的弹。
 *
 * 为什么不走 player.takeDamage（旧版是走的）：那条受击无敌帧是全项目伤害的统一限流器，
 * 而海火同时还在发光束、还会上身撞人。实测踩在池子里整场只结算到个位数伤害，
 * 也就是说「铺一场赤潮封走位」这个技能在数据上等于没放。毒素是一段持续状态，
 * 和减速一样必须自己走时钟，所以这里改叫 applyPoison：不吃无敌帧、也不消耗护盾。
 *
 * 三段生命周期，全用 dt 累加推进（升级三选一暂停 update 时时间轴天然冻结）：
 *   预警（只画流动虚线圈，不判定）→ 实亮（三层同心盘）→ 末段边淡出边缩半径（判定跟着缩，撤退是诚实的）
 *
 * 类名叫 Zone 不叫 Pool：databus.pool 已经被对象池占了，同一个词两种含义会读错。
 */

// 实亮阶段最后多少时间开始"边淡出边缩"：太短会像被拔掉电源，太长会一直看不出它要消失
const SHRINK_RATIO = 0.2;

const frac = (v) => v - Math.floor(v);

export default class Zone extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = 0;      // 当前判定半径（缩小时跟着缩），0 = 尚未生效
    this.r0 = 58;         // 满尺寸半径，只在 init 写一次
    this.life = 0;
    this.maxLife = 6000;
    this.warnTime = 900;
    this.damage = 2;      // 每跳掉血（节奏见 consts.POISON_TICK；★兜底值必须与 config.poolDamage 一致，否则调试时读到的初值是假的）
    this.hold = 2600;     // 离开池子后毒素还挂多久（毫秒），每次踩到刷新、不叠加
    this.tint = '#22d3ee';
    this.seed = 0;        // 内部游动亮斑的固定随机种子：draw 里不许 Math.random，否则每帧闪、截图不可复现
    this.alpha = 0;
    this.grabbing = false; // 本帧是否正在给玩家挂毒，只用来给描边一个受力反馈
    this.isDestroyed = false;
  }

  /**
   * @param {number} maxLife 总寿命（毫秒），含预警段
   * @param {number} hold 中毒持续时间（毫秒）——脱战继续掉血全靠它
   */
  init(x, y, radius, maxLife, warnTime, damage, hold, tint) {
    this.x = x;
    this.y = y;
    this.r0 = radius;
    this.radius = 0;
    this.maxLife = maxLife;
    this.warnTime = warnTime;
    this.life = 0;
    this.damage = damage;
    this.hold = hold;
    this.tint = tint;
    this.alpha = 0;
    this.grabbing = false;
    this.seed = Math.random() * 1000;
    this.isDestroyed = false;
  }

  update(dt, databus) {
    this.life += dt * 1000;
    if (this.life >= this.maxLife) {
      this.isDestroyed = true;
      this.radius = 0;
      this.grabbing = false;
      return;
    }

    if (this.life < this.warnTime) {
      this.radius = 0; // 预警期只画圈，不挂毒
      this.alpha = 0;
      this.grabbing = false;
      return;
    }

    const age = this.life - this.warnTime;
    const live = this.maxLife - this.warnTime;
    const shrinkAt = live * (1 - SHRINK_RATIO);
    const p = age > shrinkAt ? (age - shrinkAt) / (live - shrinkAt) : 0;
    this.radius = this.r0 * (1 - p);
    this.alpha = 1 - p;

    const player = databus.player;
    if (!player) {
      this.grabbing = false;
      return;
    }
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const r = this.radius + player.radius;
    this.grabbing = dx * dx + dy * dy < r * r;
    // 每帧刷新：applyPoison 内部只取最强的一片，同时踩进两片不会叠成双倍跳血
    if (this.grabbing) player.applyPoison(this.damage, this.hold);
  }

  draw(ctx) {
    ctx.save();
    if (this.life < this.warnTime) this.drawWarn(ctx);
    else this.drawPool(ctx);
    ctx.restore();
  }

  // 预警圈：和毒王冲锋红圈同一套视觉语法（流动虚线圈 = 这里马上要疼）
  drawWarn(ctx) {
    const t = this.life / this.warnTime;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -((this.life / 26) % 21);
    ctx.strokeStyle = this.tint;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = Math.min(1, 0.25 + 0.55 * t);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = this.tint;
    ctx.globalAlpha = 0.1 * t;
    ctx.fill();
  }

  // 赤潮本体：三层同心淡青盘 + 一圈泡沫描边 + 内部几颗游动的亮斑（藻华在动，但不是追人）
  drawPool(ctx) {
    // arc 传负半径会抛 IndexSizeError（不是 NaN，是真异常），缩到底也要留个下限
    const r = Math.max(0.5, this.r0 * this.alpha);
    ctx.globalAlpha = 0.1 * this.alpha;
    ctx.fillStyle = this.tint;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.16 * this.alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.68, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.24 * this.alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.38, 0, Math.PI * 2);
    ctx.fill();

    // 描边：挂毒中换成中毒紫并加粗，一眼看出是"这片水正在给我上毒"而不是背景花纹
    ctx.strokeStyle = this.grabbing ? UI.toxic : ABYSS.foam;
    ctx.lineWidth = this.grabbing ? 3.5 : 2;
    ctx.globalAlpha = (this.grabbing ? 0.85 : 0.5) * this.alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.stroke();

    const s = this.life / 1000;
    for (let i = 0; i < 4; i++) {
      const a = this.seed + i * 2.39996; // 黄金角散布，四颗亮斑不会叠在一起
      const rr = r * (0.28 + 0.55 * frac(Math.sin(a) * 43758.5453));
      const spin = a + s * (0.5 + 0.6 * frac(Math.cos(a) * 24634.6345));
      ctx.globalAlpha = 0.65 * this.alpha;
      ctx.fillStyle = this.tint;
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(spin) * rr, this.y + Math.sin(spin) * rr, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
