import Sprite from '../base/sprite';
import { UI } from '../ui/theme';
import { KILL_BLAST_MS, killBlastDamage, killBlastRadius } from '../consts';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 六角不规则星芒：和「炸壳」图标（theme.js itemGlyph 'killBlast'）同一组 [半径系数, 角度]，
// 长尖 ~0.9h 与短谷 ~0.55h 交替。图标许下的形状就是爆风画出来的形状，玩家才读得出「这一炸是那件道具放的」。
// ★FX 与图标各存一份这 12 个点是有意的：一个在 UI 层按 h 缩放、一个在玩法层按 blastR 缩放，
//   跨层共用一个数组会把两条缩放语义耦在一起；形状相同靠的是同一组数，不是同一份代码
const STAR = [
  [0.99, -90], [0.55, -60], [0.90, -30], [0.58, 0],
  [0.99, 30], [0.52, 60], [0.88, 90], [0.58, 120],
  [0.97, 150], [0.55, 180], [0.90, 210], [0.58, 240],
];

function starPath(ctx, cx, cy, r, rot) {
  ctx.beginPath();
  STAR.forEach(([rr, deg], i) => {
    const a = (deg * Math.PI) / 180 + rot;
    const x = cx + Math.cos(a) * r * rr;
    const y = cy + Math.sin(a) * r * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/**
 * 炸壳（金匣第 11 种加成）的效果实体：一只普通小怪被击杀，就在它原地炸开一次 AoE。
 * 一条实体两阶段，但比炸弹（bomb.js）少了飞行段 —— 怪已经死了，爆炸是瞬时的：
 *   生成后第一帧 detonate 一次结清伤害 → 星芒爆风放完 KILL_BLAST_MS 就回收。
 * ★不另开「爆炸」列表：爆风只是这同一条实体的第二阶段，画在 draw 里、寿命跟着 blastT 走完
 *   （同 bomb.js / zone.js 那条「不再加列表」的约定）。
 *
 * ★伤害 silent（不掉飘字）：这件每杀一只就炸一次、一次压一群，触发频率远高于炸弹（每 5 秒一枚），
 *   逐只跳字会把飘字池（DAMAGE_TEXT_MAX=160）灌满、把玩家普攻的数字顶掉（同 laserCross.settle 那条旧账）。
 *   星芒爆风本身就是这一炸的反馈，不需要第二层数字重复说一遍。
 * ★暴击每炸掷一次、不是每只怪掷一次（同 bomb.js detonate）：一锅炸到五只时要么全暴要么全不暴，
 *   逐只掷会让暴击率在 AoE 上偷偷翻倍。silent 之下暴击只影响伤害、不影响（被压住的）字色。
 *
 * 归对象池管理，init 必须重置全部可变字段（漏了 detonated 就是「池里复用的第二枚刚生成就跳过结算」）。
 */
export default class KillBlast extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = 0;          // 不参与圆碰撞（同 LaserCross）：AoE 在 detonate 里按 blastR 自己量，不走 isCollideWith
    this.blastR = 0;          // 爆炸半径（像素），init 按层数从 killBlastRadius 取
    this.damage = 0;          // 单炸伤害，init 按层数 + 攻击力快照（同子弹开火快照 burnDamage：在飞的爆炸不许中途变强）
    this.blastT = 0;          // 爆风已经过的毫秒数（dt 累加，面板开着时自然冻住）
    this.detonated = false;   // 是否已结算过伤害：第一帧 detonate 一次，之后只放爆风
    this.isDestroyed = false;
  }

  /**
   * @param {number} x 爆炸中心（被击杀那只小怪的位置）
   * @param {number} y 同上
   * @param {number} layers 炸壳层数（player.killBlast），买的是「这一炸多大、多疼」
   * @param {number} attack 击杀那一刻的角色攻击力，单炸伤害 = killBlastDamage(layers, attack)
   */
  init(x, y, layers, attack) {
    this.x = x;
    this.y = y;
    this.blastR = killBlastRadius(layers);
    this.damage = killBlastDamage(layers, attack);
    this.blastT = 0;
    this.detonated = false;
    this.isDestroyed = false;
  }

  update(dt, databus) {
    if (!this.detonated) {
      this.detonated = true;
      this.detonate(databus);
    }
    this.blastT += dt * 1000;
    if (this.blastT >= KILL_BLAST_MS) this.isDestroyed = true;
  }

  // 一次结清：只遍历一遍怪，每只最多被这一炸打到一次，所以不需要 laserCross 那种 hitSet 限流
  // （那条是每帧都扫一遍路径，得记住已经刮过谁；这里一炸就是一次，没有第二次）
  detonate(databus) {
    const player = databus.player;
    let dmg = this.damage;
    let isCrit = false;
    if (player && Math.random() < player.critRate) {
      dmg = Math.floor(dmg * player.critMult);
      isCrit = true;
    }
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const r = this.blastR + e.radius;
      if (dx * dx + dy * dy < r * r) {
        // 第 4 个参数 color 留空、第 5 个 silent 置真：理由见类头那条（频繁 AoE 不灌飘字池）
        e.takeDamage(dmg, isCrit, databus, undefined, true);
      }
    }
  }

  // 星芒爆风：外层 gold 星芒 + 内层 cream 亮芯 + 一圈墨描边，从中心摊开、边淡出边长大。
  // ★形状走星芒而不是炸弹那三层圆盘：这是「炸壳」自己的脸（同图标），同屏和炸弹一眼分得出谁炸的。
  //   平涂无渐变无 shadowBlur，同 bomb.drawBlast / zone 的画法语言
  draw(ctx) {
    const k = clamp(this.blastT / KILL_BLAST_MS, 0, 1);
    const a = 1 - k;
    // arc/星芒传负半径会出错，缩到底也留个下限（同 bomb.drawBlast 那条）
    const r = Math.max(0.5, this.blastR * (0.34 + 0.66 * k));
    // 慢转：相位由 blastT 推出，不用构造期随机数也不在 draw 里调 Math.random（每帧随机会让星芒每帧变形）
    const rot = k * 0.5;
    ctx.save();
    ctx.lineJoin = 'round';
    // 外盘星芒
    starPath(ctx, this.x, this.y, r, rot);
    ctx.fillStyle = UI.gold;
    ctx.globalAlpha = 0.4 * a;
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.6 * a;
    ctx.stroke();
    // 内芯星芒：比外盘小一档、更亮，读成「炸心的那团白」
    starPath(ctx, this.x, this.y, r * 0.55, rot);
    ctx.fillStyle = UI.cream;
    ctx.globalAlpha = 0.7 * a;
    ctx.fill();
    ctx.restore();
  }
}