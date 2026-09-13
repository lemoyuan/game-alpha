import Enemy from './enemy';
import EnemyBullet from './enemyBullet';
import { MONSTER_TYPES } from './config';
import { ARENA_W, ARENA_H } from '../../consts';

// 一号 Boss：追击玩家 + 技能循环（冲锋 → 环形弹幕 → 召唤小怪）
export default class Boss extends Enemy {
  constructor(type, config) {
    super(type, config);
    this.isBoss = true;          // HUD 顶部血条 / 停止刷小怪的标记
    this.skillCd = config.skillCd || 4000;
    this.chargeSpeed = config.chargeSpeed || 500;
    this.chargeTime = config.chargeTime || 700;
    this.ringCount = config.ringCount || 12;
    this.bulletDamage = config.bulletDamage || config.damage;
    this.summonCount = config.summonCount || 3;
    this.skillIndex = 0;
    this.nextSkillAt = 0;
    this.charging = false;
    this.chargeUntil = 0;
    this.chargeDx = 0;
    this.chargeDy = 0;
  }

  init(x, y) {
    super.init(x, y);
    this.skillIndex = 0;
    this.charging = false;
    this.nextSkillAt = Date.now() + 3000; // 出场 3 秒后放第一个技能
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const now = Date.now();
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    if (this.charging) {
      this.angle = Math.atan2(this.chargeDy, this.chargeDx); // 冲锋期间锁定冲刺朝向
      if (now < this.chargeUntil) {
        this.x += this.chargeDx * this.chargeSpeed * dt;
        this.y += this.chargeDy * this.chargeSpeed * dt;
      } else {
        this.charging = false;
      }
    } else {
      this.angle = Math.atan2(dy, dx);
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
      if (now >= this.nextSkillAt) {
        this.castSkill(databus, dx / dist, dy / dist);
        this.nextSkillAt = now + this.skillCd;
      }
    }

    this.x = Math.max(this.radius, Math.min(ARENA_W - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(ARENA_H - this.radius, this.y));
  }

  // 三技能循环：冲锋 → 环形弹幕 → 召唤小怪
  castSkill(databus, nx, ny) {
    const skill = this.skillIndex % 3;
    this.skillIndex++;
    if (skill === 0) {
      this.charging = true;
      this.chargeDx = nx;
      this.chargeDy = ny;
      this.chargeUntil = Date.now() + this.chargeTime;
    } else if (skill === 1) {
      const offset = Math.random() * Math.PI * 2;
      for (let i = 0; i < this.ringCount; i++) {
        const a = offset + (i / this.ringCount) * Math.PI * 2;
        const bullet = databus.pool.getItemByClass('enemyBullet', EnemyBullet);
        bullet.init(this.x, this.y, Math.cos(a), Math.sin(a),
          this.bulletSpeed, this.bulletDamage, this.bulletColor, this.bulletRadius);
        databus.enemyBullets.push(bullet);
      }
    } else {
      for (let i = 0; i < this.summonCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 60 + Math.random() * 60;
        const minion = new Enemy('basic', MONSTER_TYPES.basic);
        minion.init(
          Math.max(30, Math.min(ARENA_W - 30, this.x + Math.cos(a) * d)),
          Math.max(30, Math.min(ARENA_H - 30, this.y + Math.sin(a) * d))
        );
        databus.enemys.push(minion);
      }
    }
  }

  draw(ctx) {
    super.draw(ctx);
    // 冲锋期间画一圈警示红圈
    if (this.charging) {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
