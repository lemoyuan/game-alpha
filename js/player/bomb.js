import Sprite from '../base/sprite';
import { UI } from '../ui/theme';
import {
  BOMB_RADIUS, BOMB_BLAST_R, BOMB_BLAST_MS,
  BOMB_H_SPEED, BOMB_FLY_MIN, BOMB_FLY_MAX, BOMB_GRAVITY_K,
} from '../consts';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 炸弹跟班扔出的那一枚：一条实体两阶段——抛物线飞行 → 落点一次结清 AOE → 爆风放完就回收。
 * ★不另开「爆炸」列表：爆风只是这同一条实体的第二阶段，画在 draw 里、寿命跟着 t 走完，
 *   同 js/npc/monster/zone.js 那条「不再加列表」的约定
 *
 * 为什么走抛物线而不是直接砸一个圈：扔这个动作要被看见。水平位置线性插值、高度走
 * z = 4p(1−p)，落影留在地面上、弹体画在 (x, y − z)——两者分离多远就是飞多高，
 * 这条缝是全部可读性的来源，去掉影子它就变成一枚在地上滑的弹。
 *
 * 伤害只在引爆那一帧结清（BOMB_BLAST_MS 纯表现），所以炸弹是一次性重击，不是第二段 DoT：
 * ★故意不给炸弹挂燃烧。玩家身上已经有两套跳血载体（赤潮毒、燃烧弹），再来一套会让
 *   暂停页那句「每跳 N 点」变成假话，也是双重收益。
 */
export default class Bomb extends Sprite {
  constructor() {
    super(null, BOMB_RADIUS * 2, BOMB_RADIUS * 2, 0, 0);
    this.radius = BOMB_RADIUS;
    this.blastR = BOMB_BLAST_R;
    this.t = 0;          // 已飞行的毫秒数（dt 累加）
    this.flyMs = BOMB_FLY_MIN;
    this.z = 0;          // 当前视觉高度（只影响画法，不参与伤害判定）
    this.zMax = 18;
    this.blastT = -1;    // < 0 = 还在飞；>= 0 = 已引爆，正在放爆风
    this.damage = 0;
    // 着色：弹体火花、落点预警环、爆风外盘三处同源。默认 UI.burn = 玩家那颗一颗没动过；
    // 子类 Vesicle（双子的囊泡）在 init 里换成 config.boss4.stainTint，一路带到毒渍
    this.tint = UI.burn;
    this.isDestroyed = false;
  }

  /**
   * @param {number} sx 出手点（跟班的位置）
   * @param {number} tx 落点（已经由投掷方夹回海岸内）
   */
  init(sx, sy, tx, ty, damage) {
    this.x = sx;
    this.y = sy;
    this.sx = sx;
    this.sy = sy;
    this.tx = tx;
    this.ty = ty;
    this.damage = damage;
    this.t = 0;
    this.z = 0;
    this.blastT = -1;
    this.isDestroyed = false;
    const dist = Math.sqrt((tx - sx) * (tx - sx) + (ty - sy) * (ty - sy));
    // ★时长由距离推、不写死：一轮多枚的落点远近本来就不同，让时长跟着距离走，
    //   它们就自然错开落地。省下的是一个 delay 字段和它那一套对齐逻辑
    // ×1000 是单位换算不是凑数：BOMB_H_SPEED 是像素/秒，而 flyMs 与下面那两个夹逼常量都是毫秒。
    //   漏掉这一乘，任何距离都会撞上 400ms 下限，"远弹飞得久"这条直接消失
    this.flyMs = clamp((dist / BOMB_H_SPEED) * 1000, BOMB_FLY_MIN, BOMB_FLY_MAX);
    this.zMax = 18 + dist * BOMB_GRAVITY_K;
  }

  update(dt, databus) {
    const ms = dt * 1000;
    if (this.blastT >= 0) {
      this.blastT += ms;
      if (this.blastT >= BOMB_BLAST_MS) this.isDestroyed = true;
      return;
    }

    this.t += ms;
    if (this.t >= this.flyMs) {
      this.x = this.tx;
      this.y = this.ty;
      this.z = 0;
      this.blastT = 0;
      this.detonate(databus);
      return;
    }
    const p = this.t / this.flyMs;
    this.x = this.sx + (this.tx - this.sx) * p;
    this.y = this.sy + (this.ty - this.sy) * p;
    this.z = this.zMax * 4 * p * (1 - p);
  }

  // 一次结清：只遍历一遍怪，每只最多被这一枚打到一次，所以不需要跟班冲锋那种 hitSet
  // （那条是每帧都扫一遍路径，得记住已经刮过谁）
  detonate(databus) {
    const player = databus.player;
    let dmg = this.damage;
    let isCrit = false;
    // ★暴击每枚掷一次，不是每只怪掷一次：一锅炸到五只时要么五只全暴击要么全不暴，
    //   逐只掷会变成「一枚炸弹期望暴五次」，暴击率在 AOE 上偷偷翻了倍
    if (player && Math.random() < player.critRate) {
      dmg = Math.floor(dmg * player.critMult);
      isCrit = true;
    }
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.tx;
      const dy = e.y - this.ty;
      const r = this.blastR + e.radius;
      if (dx * dx + dy * dy < r * r) {
        e.takeDamage(dmg, isCrit, databus);
      }
    }
  }

  draw(ctx) {
    ctx.save();
    if (this.blastT >= 0) this.drawBlast(ctx);
    else {
      this.drawRing(ctx);
      this.drawShadow(ctx);
      this.drawShell(ctx);
    }
    ctx.restore();
  }

  // 落点预警环：抛物线负责"这一下很疼"，这圈负责让它不显得冤枉。
  // 画法和海火赤潮的预警段同一套语法（流动虚线圈 = 这里马上要疼）
  drawRing(ctx) {
    const p = this.t / this.flyMs;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -((this.t / 26) % 21);
    ctx.strokeStyle = this.tint;
    ctx.lineWidth = 2;
    ctx.globalAlpha = Math.min(1, 0.2 + 0.4 * p);
    ctx.beginPath();
    ctx.arc(this.tx, this.ty, this.blastR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // 圆心一点：一圈虚线只说出"是这块地"，点上这个才说出"砸这里"
    ctx.globalAlpha = 0.35 + 0.45 * p;
    ctx.fillStyle = this.tint;
    ctx.beginPath();
    ctx.arc(this.tx, this.ty, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 落影：压扁的墨色椭圆，弹体越高越小越淡——读者拿它当"离地多高"的尺子
  drawShadow(ctx) {
    const k = this.zMax ? this.z / this.zMax : 0;
    const rr = Math.max(0.5, this.radius * (1 - 0.4 * k));
    // 0.42 是实测抬上来的：场地底色是深青，墨色压 0.3 只差一档亮度，影子看不见等于没有高度尺
    ctx.globalAlpha = 0.42 - 0.16 * k;
    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, rr, rr * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 弹体本体：厚描边卡通语言的圆弹——墨黑球 + 奶白贴纸圈 + 一颗高光 + 引信火花。
  // 不出图：额度给实体，而且一张有脸的贴图缩到 12px 只会糊成一团
  drawShell(ctx) {
    const r = this.radius;
    ctx.save();
    ctx.translate(this.x, this.y - this.z); // 局部坐标一律以弹心为原点
    ctx.globalAlpha = 1;
    // 引信：从球顶歪出去的一截墨线，火花在它的末端
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 0.8);
    ctx.quadraticCurveTo(r * 1.1, -r * 1.2, r * 0.9, -r * 1.9);
    ctx.stroke();
    ctx.fillStyle = this.tint;
    ctx.beginPath();
    ctx.arc(r * 0.9, -r * 1.9, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.sticker;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = UI.cream;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(-r * 0.34, -r * 0.34, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 爆风：三层平涂盘从中心摊开、边淡出边长大（同 zone 的赤潮画法，无渐变无 shadowBlur）
  drawBlast(ctx) {
    const k = clamp(this.blastT / BOMB_BLAST_MS, 0, 1);
    const a = 1 - k;
    // arc 传负半径会抛 IndexSizeError，缩到底也留个下限（同 zone.js 那条）
    const rr = Math.max(0.5, this.blastR * (0.34 + 0.66 * k));
    ctx.fillStyle = this.tint;
    ctx.globalAlpha = 0.3 * a;
    ctx.beginPath();
    ctx.arc(this.tx, this.ty, rr, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = UI.gold;
    ctx.globalAlpha = 0.42 * a;
    ctx.beginPath();
    ctx.arc(this.tx, this.ty, rr * 0.62, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = UI.cream;
    ctx.globalAlpha = 0.7 * a;
    ctx.beginPath();
    ctx.arc(this.tx, this.ty, rr * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.6 * a;
    ctx.beginPath();
    ctx.arc(this.tx, this.ty, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
}
