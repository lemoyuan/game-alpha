import Sprite from '../base/sprite';
import Bullet from './bullet';
import {
  COMPANION_RADIUS, COMPANION_FOLLOW_DIST,
  COMPANION_BULLET_RADIUS, COMPANION_BULLET_COLOR,
  COMPANION_ATK_SPEED, COMPANION_DAMAGE_RATIO,
  BULLET_RANGE_BUFFER,
} from '../consts';

export default class Companion extends Sprite {
  constructor(slot = 0) {
    super(null, COMPANION_RADIUS * 2, COMPANION_RADIUS * 2, 0, 0);
    this.radius = COMPANION_RADIUS;
    this.slot = slot;
    this.x = 0;
    this.y = 0;
    this.lastAttack = 0;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;

    const total = Math.max(1, databus.companions.length);
    const baseAngle = Math.atan2(player.dirY, player.dirX) + Math.PI;
    const angle = baseAngle + (this.slot - (total - 1) / 2) * 0.7;
    const tx = player.x + Math.cos(angle) * COMPANION_FOLLOW_DIST;
    const ty = player.y + Math.sin(angle) * COMPANION_FOLLOW_DIST;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);

    const now = Date.now();
    // 跟班攻速固定 1.5 次/秒，不随角色攻速升级变化
    if (now - this.lastAttack > player.attackCd / COMPANION_ATK_SPEED) {
      let nearest = null;
      let minDist = player.attackRange;
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
      let dx;
      let dy;
      if (nearest) {
        dx = nearest.x - this.x;
        dy = nearest.y - this.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= d;
        dy /= d;
      } else {
        dx = player.dirX;
        dy = player.dirY;
      }
      this.lastAttack = now;
      const bullet = databus.pool.getItemByClass('bullet', Bullet);
      bullet.init(this.x, this.y, dx, dy, Math.max(1, Math.floor(player.attack * COMPANION_DAMAGE_RATIO)));
      bullet.radius = COMPANION_BULLET_RADIUS;
      bullet.color = COMPANION_BULLET_COLOR;
      bullet.maxRange = player.attackRange + BULLET_RANGE_BUFFER;
      bullet.pierceLeft = player.pierce;
      databus.bullets.push(bullet);
    }
  }

  draw(ctx) {
    ctx.fillStyle = '#5dade2';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
