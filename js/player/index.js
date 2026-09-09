import Sprite from '../base/sprite';
import Bullet from './bullet';
import {
  PLAYER_RADIUS, PLAYER_SPEED, PLAYER_MAX_HP,
  PLAYER_ATK, PLAYER_DEF, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_CD,
  PLAYER_INVINCIBLE, BULLET_SPEED, BULLET_DAMAGE,
  PLAYER_CRIT_RATE, PLAYER_CRIT_MULT, PLAYER_LUCK, LUCK_XP_BONUS,
  BULLET_RANGE_BUFFER, xpForLevel,
  ARENA_W, ARENA_H,
} from '../consts';

export default class Player extends Sprite {
  constructor() {
    super(null, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2, ARENA_W / 2, ARENA_H / 2);
    this.radius = PLAYER_RADIUS;        // 碰撞半径（像素）
    this.hp = PLAYER_MAX_HP;            // 当前生命
    this.maxHp = PLAYER_MAX_HP;         // 生命上限（升级项：生命上限）
    this.speed = PLAYER_SPEED;          // 移动速度（升级项：移动速度）
    this.attack = PLAYER_ATK;           // 攻击力，子弹伤害（升级项：攻击力）
    this.defence = PLAYER_DEF;          // 防御力，减伤（升级项：防御力）
    this.attackRange = PLAYER_ATTACK_RANGE; // 索敌距离，子弹飞距离=此值+缓冲（升级项：攻击距离）
    this.attackCd = PLAYER_ATTACK_CD;   // 基础攻击间隔（毫秒），实际间隔 = 此值 ÷ 攻速
    this.atkSpeed = 1;                  // 攻速 = 每秒射击次数，1.0 = 1秒1发（升级项：攻击速度，每次+0.2）
    this.critRate = PLAYER_CRIT_RATE;   // 暴击率 0~1（升级项：暴击率）
    this.critMult = PLAYER_CRIT_MULT;   // 暴击伤害倍数
    this.luck = PLAYER_LUCK;            // 幸运值，每点+2%经验获取（升级项：幸运值）
    this.bulletCount = 1;               // 每轮子弹数（宝箱：子弹数+1）
    this.pierce = 0;                    // 子弹可穿透敌人数（宝箱：子弹穿透+1）
    this.shield = 0;                    // 护盾层数，每层挡一次伤害（宝箱：护盾+1）
    this.companions = 0;                // 跟班数量（宝箱：跟班+1）
    this.lastAttack = 0;                // 上次攻击时间戳（内部用）
    this.invincibleUntil = 0;           // 受击无敌截止时间戳（内部用）
    this.dirX = 0;                      // 朝向X（跟随子弹方向）
    this.dirY = -1;                     // 朝向Y（跟随子弹方向）
    this.xp = 0;                        // 当前经验
    this.level = 1;                     // 等级
    this.kills = 0;                     // 击杀数
  }

  update(dt, databus) {
    const dir = databus.joystick ? databus.joystick.getDirection() : { x: 0, y: 0 };
    let moveX = 0;
    let moveY = 0;
    if (dir.x !== 0 || dir.y !== 0) {
      moveX = dir.x;
      moveY = dir.y;
      this.x += dir.x * this.speed * dt;
      this.y += dir.y * this.speed * dt;
      this.x = Math.max(this.radius, Math.min(ARENA_W - this.radius, this.x));
      this.y = Math.max(this.radius, Math.min(ARENA_H - this.radius, this.y));
    }

    const now = Date.now();
    if (now - this.lastAttack > this.attackCd / this.atkSpeed) {
      let nearest = null;
      let minDist = this.attackRange;
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
      if (nearest) {
        const dx = nearest.x - this.x;
        const dy = nearest.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.dirX = dx / dist;
        this.dirY = dy / dist;
        this.shoot(databus, this.dirX, this.dirY);
      } else {
        if (moveX !== 0 || moveY !== 0) {
          this.dirX = moveX;
          this.dirY = moveY;
        }
        this.shoot(databus, this.dirX, this.dirY);
      }
    }
  }

  shoot(databus, dx, dy) {
    this.lastAttack = Date.now();
    const baseAngle = Math.atan2(dy, dx);
    const spread = 0.18;
    for (let i = 0; i < this.bulletCount; i++) {
      const angle = baseAngle + (i - (this.bulletCount - 1) / 2) * spread;
      const bullet = databus.pool.getItemByClass('bullet', Bullet);
      bullet.init(this.x, this.y, Math.cos(angle), Math.sin(angle), this.attack);
      bullet.maxRange = this.attackRange + BULLET_RANGE_BUFFER;
      bullet.pierceLeft = this.pierce;
      databus.bullets.push(bullet);
    }
  }

  takeDamage(amount, now) {
    if (now < this.invincibleUntil) return;
    this.invincibleUntil = now + PLAYER_INVINCIBLE;
    if (this.shield > 0) {
      this.shield--;
      return;
    }
    const dmg = Math.max(1, amount - this.defence);
    this.hp -= dmg;
  }

  addXp(amount, databus) {
    this.xp += Math.floor(amount * (1 + this.luck * LUCK_XP_BONUS));
    const needed = xpForLevel(this.level);
    if (this.xp >= needed) {
      this.xp -= needed;
      this.level++;
      databus.isPaused = true;
      databus.upgradeScreen.show(databus);
    }
  }

  draw(ctx) {
    const blink = Date.now() < this.invincibleUntil && Math.floor(Date.now() / 80) % 2;
    ctx.fillStyle = blink ? 'rgba(52,152,219,0.4)' : '#3498db';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    if (this.shield > 0) {
      const pulse = 0.3 + 0.3 * Math.sin(Date.now() / 160);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = pulse * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + this.dirX * this.radius * 1.5, this.y + this.dirY * this.radius * 1.5);
    ctx.stroke();
  }
}
