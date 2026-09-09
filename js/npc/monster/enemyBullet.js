import Sprite from '../../base/sprite';
import { ARENA_W, ARENA_H } from '../../consts';

// 怪物子弹：直线飞行、无射程上限，命中角色或飞出地图边界才消失
export default class EnemyBullet extends Sprite {
  constructor() {
    super(null, 8, 8, 0, 0);
    this.radius = 4;
    this.dx = 0;
    this.dy = 0;
    this.speed = 220;
    this.damage = 6;
    this.color = '#1abc9c';
    this.isDestroyed = false;
  }

  // 对象池复用必须重置全部可变字段
  init(x, y, dx, dy, speed, damage, color, radius) {
    this.x = x;
    this.y = y;
    this.dx = dx;
    this.dy = dy;
    this.speed = speed;
    this.damage = damage;
    this.color = color;
    this.radius = radius;
    this.isDestroyed = false;
  }

  update(dt, databus) {
    this.x += this.dx * this.speed * dt;
    this.y += this.dy * this.speed * dt;

    // 无射程限制，只做地图边界回收，避免子弹无限累积
    if (this.x < -60 || this.x > ARENA_W + 60 || this.y < -60 || this.y > ARENA_H + 60) {
      this.isDestroyed = true;
      return;
    }

    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    if (dx * dx + dy * dy < (this.radius + player.radius) ** 2) {
      player.takeDamage(this.damage, Date.now());
      this.isDestroyed = true;
    }
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
