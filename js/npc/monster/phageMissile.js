import Sprite from '../../base/sprite';
import { ARENA_W, ARENA_H } from '../../consts';
import { UI } from '../../ui/theme';

// 噬君的子代病毒体飞镖（温和追踪导弹）。★这是「子弹永不追踪」硬规则的 Boss 专属例外：
// 慢速 + 每帧转向帽（转弯半径 = speed/turnRate，绕圈就甩掉）+ 有限寿命（末段淡出后销毁）。
// ★必须自己一条实体 + 自己一条列表（databus.missiles）：绝不改 EnemyBullet / 玩家 Bullet，
//   否则「怪物子弹直线、玩家子弹不追踪」这两条全局承诺会被这一只 Boss 悄悄改坏。
// 命中走 player.takeDamage（离散弹，与 enemyBullet 同一条无敌帧通道），不是 applyBlast/applyPoison。
const FADE_RATIO = 0.2; // 寿命末段多少比例开始淡出

export default class PhageMissile extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = 7;
    this.heading = 0;      // 当前朝向弧度（每帧朝玩家转，但有上限）
    this.speed = 90;
    this.turnRate = 1.6;   // 转向率上限（弧度/秒）
    this.maxLife = 4200;
    this.life = 0;
    this.damage = 10;
    this.color = '#B03A2E';
    this.isDestroyed = false;
  }

  // 对象池复用必须重置全部可变字段
  init(x, y, heading, speed, turnRate, maxLife, damage, radius, color) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed;
    this.turnRate = turnRate;
    this.maxLife = maxLife;
    this.life = 0;
    this.damage = damage;
    this.radius = radius;
    this.color = color;
    this.isDestroyed = false;
  }

  update(dt, databus) {
    this.life += dt * 1000;
    if (this.life >= this.maxLife) {
      this.isDestroyed = true;
      return;
    }

    const player = databus.player;
    if (player) {
      // 转向帽：每帧最多转 turnRate×dt，所以转弯半径 = speed/turnRate ≈ 56px，玩家绕圈就甩掉
      const want = Math.atan2(player.y - this.y, player.x - this.x);
      let dA = want - this.heading;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      const cap = this.turnRate * dt;
      this.heading += Math.max(-cap, Math.min(cap, dA));
    }
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    if (this.x < -60 || this.x > ARENA_W + 60 || this.y < -60 || this.y > ARENA_H + 60) {
      this.isDestroyed = true;
      return;
    }

    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    if (dx * dx + dy * dy < (this.radius + player.radius) ** 2) {
      player.takeDamage(this.damage, Date.now(), databus); // 离散弹 hit 走无敌帧，同 enemyBullet
      this.isDestroyed = true;
    }
  }

  // 寿命末段淡出：让「它会消失」这件事在画面上读得出来，而不是突然不见
  alpha() {
    const p = this.life / this.maxLife;
    if (p <= 1 - FADE_RATIO) return 1;
    return Math.max(0.08, 1 - (p - (1 - FADE_RATIO)) / FADE_RATIO);
  }

  // 代码绘制飞镖：小二十面体头（尖朝 +x）+ 短尾 + 2 根尾丝 + 金核，沿 heading 朝向
  draw(ctx) {
    const r = this.radius;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    ctx.globalAlpha = this.alpha();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const lw = Math.max(1.2, r * 0.22);
    // 尾丝（向后）
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw * 0.8;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, s * r * 0.2);
      ctx.lineTo(-r * 1.3, s * r * 0.7);
      ctx.stroke();
    }
    // 短尾
    ctx.beginPath();
    ctx.rect(-r * 0.9, -r * 0.28, r * 0.7, r * 0.56);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = UI.ink;
    ctx.stroke();
    // 头（六边形，尖朝前 +x）
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(r * 0.2, -r * 0.72);
    ctx.lineTo(-r * 0.5, -r * 0.5);
    ctx.lineTo(-r * 0.5, r * 0.5);
    ctx.lineTo(r * 0.2, r * 0.72);
    ctx.closePath();
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.stroke();
    // 金核 = 毒素包
    ctx.beginPath();
    ctx.arc(r * 0.15, 0, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = UI.gold;
    ctx.fill();
    ctx.restore();
  }
}