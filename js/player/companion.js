import Sprite from '../base/sprite';
import Bullet from './bullet';
import {
  COMPANION_RADIUS, COMPANION_FOLLOW_DIST,
  COMPANION_SPRITE, COMPANION_SPRITE_SIZE,
  COMPANION_BULLET_RADIUS, COMPANION_BULLET_COLOR,
  COMPANION_ATK_SPEED, COMPANION_DAMAGE_RATIO,
  BULLET_RANGE_BUFFER, BURN_DMG, SHOT_SPREAD,
} from '../consts';

/**
 * 射击跟班：★场上恒为一只，player.companions 是「一次齐射几发」而不是「几只跟班」。
 * 站位取角色正后方一格——那是旧版多只弧形展开的中间格，炸弹跟班站它左边一格（见 bomber.js）。
 */
export default class Companion extends Sprite {
  constructor() {
    // 显示尺寸与碰撞半径解耦：贴图比判定大一圈（伪足伸出去），和 Boss 贴图的约定一致
    super(COMPANION_SPRITE, COMPANION_SPRITE_SIZE, COMPANION_SPRITE_SIZE, 0, 0);
    this.radius = COMPANION_RADIUS;
    this.x = 0;
    this.y = 0;
    this.cdT = 0; // 距上次齐射已过的毫秒数（dt 累加）
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;

    const seat = Math.atan2(player.dirY, player.dirX) + Math.PI;
    const tx = player.x + Math.cos(seat) * COMPANION_FOLLOW_DIST;
    const ty = player.y + Math.sin(seat) * COMPANION_FOLLOW_DIST;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);

    // 计时一律 dt 累加、不读 Date.now：main.js 在三选一面板开着时跳过 databus.update，
    // 墙上时钟却照走。读它的后果是面板期间跟班看着停火、面板一关又立刻补出积压的那几轮连发
    this.cdT += dt * 1000;
    // 跟班攻速固定 1.5 次/秒，不随角色攻速升级变化
    if (this.cdT < player.attackCd / COMPANION_ATK_SPEED) return;
    this.cdT = 0;
    this.volley(databus, player);
  }

  // 一轮齐射：扇形张角与主角共用 SHOT_SPREAD，两张弹扇同帧飞出时才像同一套机械
  volley(databus, player) {
    // 索敌每轮只做一次：几发弹同点出发，逐发重算只会拿到同一个目标
    let dx = player.dirX;
    let dy = player.dirY;
    const nearest = this.nearestEnemy(databus, player.attackRange);
    if (nearest) {
      dx = nearest.x - this.x;
      dy = nearest.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d;
      dy /= d;
    }

    const baseAngle = Math.atan2(dy, dx);
    const count = Math.max(1, player.companions);
    const damage = Math.max(1, Math.floor(player.attack * COMPANION_DAMAGE_RATIO));
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (i - (count - 1) / 2) * SHOT_SPREAD;
      const bullet = databus.pool.getItemByClass('bullet', Bullet);
      bullet.init(this.x, this.y, Math.cos(angle), Math.sin(angle), damage);
      bullet.radius = COMPANION_BULLET_RADIUS;
      bullet.color = COMPANION_BULLET_COLOR;
      bullet.maxRange = player.attackRange + BULLET_RANGE_BUFFER;
      bullet.pierceLeft = player.pierce;
      // 跟班继承主人的燃烧层数：多发只提高「燃烧覆盖率」，不会提高每跳伤害——
      // 因为燃烧只刷新时长不叠伤害，这是「只刷时间」那条规则的必然推论，不是漏洞
      bullet.burnDamage = player.burnBullets * BURN_DMG;
      databus.bullets.push(bullet);
    }
  }

  nearestEnemy(databus, range) {
    let nearest = null;
    let minDist = range;
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        nearest = e;
      }
    }
    return nearest;
  }

  draw(ctx) {
    // angle 传 0：正面朝上出的图，不旋转（有脸的贴图一转就朝天朝地），射击方向由子弹表达
    if (this.drawSprite(ctx)) return;
    // 贴图还没加载完 → 回退到原来的纯色圆占位
    ctx.fillStyle = '#5dade2';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
