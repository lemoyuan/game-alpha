import Sprite from '../../base/sprite';

/**
 * 黏液洼：膜王分泌的 EPS 黏液，踩进去会被拖住，但**不扣血**。
 * 坐标在 init 一次写定，之后永不移动——黏液是地面上的东西，不是会追人的弹。
 *
 * 为什么不复用 Zone（海火的赤潮池）：
 *   Zone 的伤害走 player.takeDamage，而那条 500ms 无敌帧是全项目伤害的统一限流器。
 *   减速是一段持续状态，必须每帧都刷新，走 takeDamage 会被无敌帧吞掉；
 *   更要命的是它会白占一次无敌帧，导致"踩了一下黏液，结果下一发子弹没扣血"这种诡异的白嫖。
 *   所以这里完全不碰 takeDamage。
 *
 * 但它**复用 databus.zones 这个列表**：回收、更新、渲染都只按 isDestroyed / update / draw 走，
 * 再加一条第五处接线纯属浪费。语义上两者都是「地面危害池」。
 */

// 实亮阶段最后多少时间开始"边淡出边缩"：和赤潮同一条约定，判定跟着视觉一起收
const SHRINK_RATIO = 0.2;

// 内部气泡/黏丝的确定性散列：draw 里不许 Math.random，否则每帧闪、截图不可复现
const frac = (v) => v - Math.floor(v);
const hash = (n) => frac(Math.sin(n) * 43758.5453);

export default class Slime extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = 0;      // 当前判定半径（缩小时跟着缩），0 = 尚未生效
    this.r0 = 110;        // 满尺寸半径，只在 init 写一次
    this.life = 0;
    this.maxLife = 7000;
    this.warnTime = 800;
    this.slowMult = 0.55;
    this.slowHold = 700;
    this.tint = '#9BB08C';
    this.seed = 0;
    this.alpha = 0;
    this.grabbing = false; // 本帧是否粘住了玩家，只用来给描边一个受力反馈
    this.isDestroyed = false;
  }

  /**
   * @param {number} maxLife 总寿命（毫秒），含预警段
   * @param {number} slowHold 离开后还粘多久（毫秒）——黏滞感全在这个尾巴上
   */
  init(x, y, radius, maxLife, warnTime, slowMult, slowHold, tint) {
    this.x = x;
    this.y = y;
    this.r0 = radius;
    this.radius = 0;
    this.maxLife = maxLife;
    this.warnTime = warnTime;
    this.slowMult = slowMult;
    this.slowHold = slowHold;
    this.life = 0;
    this.alpha = 0;
    this.grabbing = false;
    this.tint = tint || '#9BB08C';
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
      this.radius = 0; // 预警期只画圈，不粘人
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
    // 每帧都刷新：applySlow 内部只取最强的一片，重叠不会叠乘成站不动
    if (this.grabbing) player.applySlow(this.slowMult, this.slowHold);
  }

  draw(ctx) {
    ctx.save();
    if (this.life < this.warnTime) this.drawWarn(ctx);
    else this.drawGel(ctx);
    ctx.restore();
  }

  // 预警：虚线圈 + 一小滩正在洇开的湿痕。视觉语法和海火赤潮、毒王冲锋圈一致 = 这里马上要有事
  drawWarn(ctx) {
    const t = this.life / this.warnTime;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = (this.life / 22) % 24; // 往反方向流，和赤潮的预警圈区分开
    ctx.strokeStyle = this.tint;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = Math.min(1, 0.25 + 0.5 * t);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = this.tint;
    ctx.globalAlpha = 0.08 * t;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r0 * (0.3 + 0.5 * t), 0, Math.PI * 2);
    ctx.fill();
  }

  // 本体：厚描边的胶状盘 + 内部黏丝和气泡。画成"稠"而不是"亮"，才不会和发光的水体混读
  drawGel(ctx) {
    // arc 传负半径会抛 IndexSizeError（不是 NaN，是真异常），缩到底也要留个下限
    const r = Math.max(0.5, this.r0 * this.alpha);
    const a = this.alpha;

    ctx.fillStyle = this.tint;
    ctx.globalAlpha = 0.26 * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.2 * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.68, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.16 * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.36, 0, Math.PI * 2);
    ctx.fill();

    // 黏丝：三根固定角度的短弧，缓慢摆动。用 seed 算死，不用随机
    const s = this.life / 1000;
    ctx.strokeStyle = this.tint;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.26 * a;
    for (let i = 0; i < 3; i++) {
      const base = this.seed + i * 2.0944; // 三等分，不会挤在一起
      const wob = Math.sin(s * 0.9 + base) * 0.35;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * (0.3 + i * 0.19), base + wob, base + wob + 1.1);
      ctx.stroke();
    }

    // 气泡：黏液里憋着的气，比赤潮的亮斑更暗更慢
    ctx.fillStyle = '#C8D6B0';
    for (let i = 0; i < 4; i++) {
      const ang = this.seed * 0.7 + i * 2.39996; // 黄金角散布
      const rr = r * (0.2 + 0.6 * hash(ang));
      const drift = ang + s * 0.25;
      ctx.globalAlpha = 0.3 * a;
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(drift) * rr, this.y + Math.sin(drift) * rr, 1.6 + hash(ang + 7) * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 描边：厚描边卡通风格的地面版。必须是**亮边**——压暗的描边在这套深色地面上等于没有边，
    // 一滩没有边的东西就会被读成一块石头。粘住玩家时换成高光色并加粗，给一个"被拽紧了"的受力反馈
    ctx.strokeStyle = this.grabbing ? '#C8D6B0' : this.tint;
    ctx.lineWidth = this.grabbing ? 4 : 3;
    ctx.globalAlpha = (this.grabbing ? 0.85 : 0.6) * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
