import Enemy from './enemy';
import EnemyBullet from './enemyBullet';
import { MONSTER_TYPES } from './config';
import { ARENA_W, ARENA_H } from '../../consts';
import { clampToCoast } from '../../arena/coast';

// 出场到第一个技能的间隔（毫秒）：给玩家一段"先看看它长什么样"的时间
const FIRST_SKILL_DELAY = 3000;

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
    this.skillT = 0;              // 距上个技能已过的毫秒数（dt 累加）
    this.charging = false;
    this.chargeLeft = 0;          // 冲锋剩余毫秒（dt 累加）
    this.chargeDx = 0;
    this.chargeDy = 0;
  }

  init(x, y) {
    super.init(x, y);
    this.skillIndex = 0;
    this.charging = false;
    // 出场 3 秒后才放第一个技能：倒着算比再加一个"是否首招"的标记省一个状态
    this.skillT = this.skillCd - FIRST_SKILL_DELAY;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const ms = dt * 1000;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    if (this.charging) {
      this.angle = Math.atan2(this.chargeDy, this.chargeDx); // 冲锋期间锁定冲刺朝向
      if (this.chargeLeft > 0) {
        this.x += this.chargeDx * this.chargeSpeed * dt;
        this.y += this.chargeDy * this.chargeSpeed * dt;
        this.chargeLeft -= ms;
      } else {
        this.charging = false;
      }
    } else {
      this.angle = Math.atan2(dy, dx);
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
      this.skillT += ms;
      if (this.skillT >= this.skillCd) {
        this.castSkill(databus, dx / dist, dy / dist);
        this.skillT = 0;
      }
    }

    clampToCoast(this, this.radius);
  }

  // 三技能循环：冲锋 → 环形弹幕 → 召唤小怪
  castSkill(databus, nx, ny) {
    const skill = this.skillIndex % 3;
    this.skillIndex++;
    if (skill === 0) {
      this.charging = true;
      this.chargeDx = nx;
      this.chargeDy = ny;
      this.chargeLeft = this.chargeTime;
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
