import Sprite from '../base/sprite';
import { BULLET_SPEED, BULLET_RADIUS, BULLET_COLOR, BULLET_RANGE_BUFFER } from '../consts';

export default class Bullet extends Sprite {
  constructor() {
    super(null, BULLET_RADIUS * 2, BULLET_RADIUS * 2, 0, 0);
    this.radius = BULLET_RADIUS;
    this.dx = 0;
    this.dy = 0;
    this.speed = BULLET_SPEED;
    this.damage = 10;
    this.maxRange = BULLET_RANGE_BUFFER;
    this.startX = 0;
    this.startY = 0;
    this.pierceLeft = 0;
    this.hitList = [];
    this.isDestroyed = false;
  }

  init(x, y, dx, dy, damage) {
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
    this.dx = dx;
    this.dy = dy;
    this.damage = damage;
    this.radius = BULLET_RADIUS;
    this.color = BULLET_COLOR; // 对象池复用必须重置，否则跟班的蓝色会"传染"给主角子弹
    this.pierceLeft = 0;
    this.hitList = [];
    this.isDestroyed = false;
  }

  update(dt, databus) {
    this.x += this.dx * this.speed * dt;
    this.y += this.dy * this.speed * dt;

    const distSq = (this.x - this.startX) ** 2 + (this.y - this.startY) ** 2;
    if (distSq > this.maxRange * this.maxRange) {
      this.isDestroyed = true;
    }

    if (this.x < -50 || this.x > 2050 || this.y < -50 || this.y > 2050) {
      this.isDestroyed = true;
    }

    if (!this.isDestroyed) {
      for (const e of databus.enemys) {
        if (e.isDead) continue;
        if (this.hitList.indexOf(e) !== -1) continue;
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.radius + e.radius) {
          let dmg = this.damage;
          const player = databus.player;
          if (player && Math.random() < player.critRate) {
            dmg = Math.floor(dmg * player.critMult);
          }
          e.hp -= dmg;
          if (e.hp <= 0) {
            e.isDead = true;
          }
          this.hitList.push(e);
          this.pierceLeft--;
          if (this.pierceLeft < 0) {
            this.isDestroyed = true;
          }
          break;
        }
      }
    }
  }

  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
