import Sprite from '../base/sprite';
import { UI } from '../ui/theme';
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
          let isCrit = false;
          const player = databus.player;
          if (player && Math.random() < player.critRate) {
            dmg = Math.floor(dmg * player.critMult);
            isCrit = true;
          }
          e.takeDamage(dmg, isCrit, databus);
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

  // 整弹造型：与 ui/theme.js 的 bullet 图标同构，旋转到飞行方向，圆点读不出朝向
  draw(ctx) {
    const r = this.radius;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.atan2(this.dy, this.dx) + Math.PI / 2); // 造型朝上画，转到速度方向
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, r * 0.26);
    ctx.strokeStyle = UI.ink;
    ctx.beginPath();
    if (r < 4) {
      // 跟班子弹太小：只留弹头 + 直弹壳，底缘外扩在这个尺寸下会糊成短横杠
      ctx.moveTo(-r * 0.55, r * 0.2);
      ctx.quadraticCurveTo(-r * 0.55, -r * 0.8, 0, -r * 1.3);
      ctx.quadraticCurveTo(r * 0.55, -r * 0.8, r * 0.55, r * 0.2);
      ctx.lineTo(r * 0.55, r * 0.9);
      ctx.lineTo(-r * 0.55, r * 0.9);
    } else {
      ctx.moveTo(-r * 0.52, -r * 0.3);
      ctx.quadraticCurveTo(-r * 0.52, -r * 0.95, 0, -r * 1.35);
      ctx.quadraticCurveTo(r * 0.52, -r * 0.95, r * 0.52, -r * 0.3);
      ctx.lineTo(r * 0.52, r * 0.75);
      ctx.lineTo(r * 0.7, r * 0.75);
      ctx.lineTo(r * 0.7, r * 1.1);
      ctx.lineTo(-r * 0.7, r * 1.1);
      ctx.lineTo(-r * 0.7, r * 0.75);
      ctx.lineTo(-r * 0.52, r * 0.75);
    }
    ctx.closePath();
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.stroke();
    if (r >= 4) { // 弹头与弹壳分界；跟班子弹省略，避免糊掉轮廓
      ctx.beginPath();
      ctx.moveTo(-r * 0.52, -r * 0.3);
      ctx.lineTo(r * 0.52, -r * 0.3);
      ctx.stroke();
    }
    ctx.restore();
  }
}
