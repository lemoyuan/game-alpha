import Sprite from '../base/sprite';
import Bullet from './bullet';
import {
  PLAYER_RADIUS, PLAYER_SPEED, PLAYER_MAX_HP, PLAYER_SPRITE, PLAYER_SPRITE_SIZE,
  PLAYER_MUZZLE_LEN, PLAYER_MUZZLE_FLASH,
  PLAYER_ATK, PLAYER_DEF, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_CD,
  PLAYER_INVINCIBLE, BULLET_SPEED, BULLET_DAMAGE,
  PLAYER_CRIT_RATE, PLAYER_CRIT_MULT, PLAYER_LUCK, LUCK_XP_BONUS,
  BULLET_RANGE_BUFFER, xpForLevel, LEVEL_UP_BONUS,
  ARENA_W, ARENA_H,
} from '../consts';
import { settings } from '../storage';
import { clampToCoast } from '../arena/coast';

export default class Player extends Sprite {
  constructor() {
    super(PLAYER_SPRITE, PLAYER_SPRITE_SIZE, PLAYER_SPRITE_SIZE, ARENA_W / 2, ARENA_H / 2);
    this.radius = PLAYER_RADIUS;        // 碰撞半径（像素）
    this.hp = PLAYER_MAX_HP;            // 当前生命
    this.maxHp = PLAYER_MAX_HP;         // 生命上限（升级项：生命上限）
    this.speed = PLAYER_SPEED;          // 移动速度（升级项 +15%，每级自动 +5）
    this.attack = PLAYER_ATK;           // 攻击力，子弹伤害（升级项 +3，每级自动 +1）
    this.defence = PLAYER_DEF;          // 防御力，减伤（升级项 +2）
    this.attackRange = PLAYER_ATTACK_RANGE; // 索敌距离，子弹飞距离=此值+缓冲（升级项 +30，每级自动 +5）
    this.attackCd = PLAYER_ATTACK_CD;   // 基础攻击间隔（毫秒），实际间隔 = 此值 ÷ 攻速
    this.atkSpeed = 1;                  // 攻速 = 每秒射击次数，1.0 = 1秒1发（升级项 +0.3次）
    this.critRate = PLAYER_CRIT_RATE;   // 暴击率 0~1（升级项 +10%，每级自动 +2%）
    this.critMult = PLAYER_CRIT_MULT;   // 暴击伤害倍数
    this.luck = PLAYER_LUCK;            // 幸运值，每点+2%经验获取（升级项：幸运值）
    this.bulletCount = 1;               // 每轮子弹数（宝箱：子弹数+1）
    this.pierce = 0;                    // 子弹可穿透敌人数（宝箱：子弹穿透+1）
    this.shield = 0;                    // 护盾层数，每层挡一次伤害（宝箱：护盾+1）
    this.companions = 0;                // 跟班数量（宝箱：跟班+1）
    this.lastAttack = 0;                // 上次攻击时间戳（内部用）
    this.invincibleUntil = 0;           // 受击无敌截止时间戳（内部用）
    this.slowMult = 1;                  // 当前移速倍率（1 = 未被减速），由黏液洼写入 applySlow
    this.slowLeft = 0;                  // 减速剩余毫秒数：离开黏液后还要拖一会儿才恢复，黏滞感来自这个尾巴
    this.dirX = 0;                      // 朝向X（跟随子弹方向）
    this.dirY = -1;                     // 朝向Y（跟随子弹方向）
    this.xp = 0;                        // 当前经验
    this.level = 1;                     // 等级
    this.kills = 0;                     // 击杀数
  }

  update(dt, databus) {
    // 减速按 dt 走：和 Boss 的时间轴同一把尺，升级三选一面板开着时（main.js 跳过 update）自然冻结。
    // 无敌帧用 Date.now() 是因为它是「伤害源的限流器」，不是持续时间，两者不要照抄彼此
    this.slowLeft = Math.max(0, this.slowLeft - dt * 1000);
    if (this.slowLeft === 0) this.slowMult = 1; // 归零必须复位倍率，否则下次只上弱黏液会继承旧的强值

    const dir = databus.joystick ? databus.joystick.getDirection() : { x: 0, y: 0 };
    let moveX = 0;
    let moveY = 0;
    if (dir.x !== 0 || dir.y !== 0) {
      moveX = dir.x;
      moveY = dir.y;
      const v = this.effectiveSpeed();
      this.x += dir.x * v * dt;
      this.y += dir.y * v * dt;
      clampToCoast(this, this.radius); // 停在海岸曲线上，凹角能真的卡住
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
        // dist 可能为 0（玩家和怪被夹进同一角落），此时保持上一次朝向，避免除零出 NaN
        if (dist > 0) {
          this.dirX = dx / dist;
          this.dirY = dy / dist;
        }
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
    const mx = this.x + Math.cos(baseAngle) * PLAYER_MUZZLE_LEN;
    const my = this.y + Math.sin(baseAngle) * PLAYER_MUZZLE_LEN;
    const spread = 0.18;
    for (let i = 0; i < this.bulletCount; i++) {
      const angle = baseAngle + (i - (this.bulletCount - 1) / 2) * spread;
      const bullet = databus.pool.getItemByClass('bullet', Bullet);
      bullet.init(mx, my, Math.cos(angle), Math.sin(angle), this.attack);
      bullet.maxRange = this.attackRange + BULLET_RANGE_BUFFER;
      bullet.pierceLeft = this.pierce;
      databus.bullets.push(bullet);
    }
  }

  // 黏液减速：重叠的池每帧都会调进来，所以只取最强的一片、绝不相乘，
  // 否则两片 0.55 叠成 0.3 再叠成 0.17，玩家会被永久钉在场上
  applySlow(mult, hold) {
    if (this.slowLeft > 0) this.slowMult = Math.min(this.slowMult, mult);
    else this.slowMult = mult;
    this.slowLeft = Math.max(this.slowLeft, hold);
  }

  effectiveSpeed() {
    return this.slowLeft > 0 ? this.speed * this.slowMult : this.speed;
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
    if (settings.vibrate) wx.vibrateShort({ type: 'light' });
  }

  // 一次只结一级：面板关掉时 upgrade.js 会再调 addXp(0) 把溢出经验接着结算成下一张卡。
  // 不要改成 while 循环——那等于一颗宝石白送好几次升级而不给对应的卡
  addXp(amount, databus) {
    this.xp += Math.floor(amount * (1 + this.luck * LUCK_XP_BONUS));
    const needed = xpForLevel(this.level);
    if (this.xp >= needed) {
      this.xp -= needed;
      this.level++;
      this.applyLevelBonus();
      databus.isPaused = true;
      databus.upgradeScreen.show(databus);
    }
  }

  // 升级自动全属性成长，在三选一之外额外叠加；保留两位小数避免攻速/暴击出现浮点尾数
  applyLevelBonus() {
    for (const key of Object.keys(LEVEL_UP_BONUS)) {
      this[key] = Math.round((this[key] + LEVEL_UP_BONUS[key]) * 100) / 100;
    }
  }

  draw(ctx) {
    const now = Date.now();
    const blink = now < this.invincibleUntil && Math.floor(now / 80) % 2;
    // 贴图按「枪口朝右（+x）」出图，这里旋转到索敌方向，人物就永远举枪对准目标
    const angle = Math.atan2(this.dirY, this.dirX);
    if (!this.drawSprite(ctx, angle, blink ? 0.35 : 1)) {
      ctx.fillStyle = blink ? 'rgba(52,152,219,0.4)' : '#3498db';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      // 贴图未加载时用一条白色准星线表达朝向，加载后由枪管本身承担这个信息
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this.dirX * this.radius * 1.5, this.y + this.dirY * this.radius * 1.5);
      ctx.stroke();
    }

    if (this.shield > 0) {
      const pulse = 0.3 + 0.3 * Math.sin(now / 160);
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

    // 被黏液粘住的自查反馈：脚底一层暗膜 + 两滴往下拉丝。
    // 动画按 slowLeft 走而不是按墙上时钟，减速一到就立刻停，不会留下挂着的假黏液
    if (this.slowLeft > 0) {
      const s = Math.min(1, this.slowLeft / 700);
      const sag = 3 + 5 * s;
      ctx.globalAlpha = 0.5 * s;
      ctx.fillStyle = '#9BB08C'; // 象牙绿：黏液本来的颜色，压暗以免和杂兵的青绿识别色混在一起
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + this.radius * 0.7, this.radius * 0.95, this.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9BB08C';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 2; i++) {
        const ox = (i ? 1 : -1) * this.radius * 0.5;
        ctx.beginPath();
        ctx.moveTo(this.x + ox, this.y + this.radius * 0.6);
        ctx.lineTo(this.x + ox * 1.15, this.y + this.radius * 0.6 + sag * (i ? 1 : 0.7));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const flashAge = now - this.lastAttack;
    if (flashAge < PLAYER_MUZZLE_FLASH) {
      const t = 1 - flashAge / PLAYER_MUZZLE_FLASH;
      const mx = this.x + this.dirX * PLAYER_MUZZLE_LEN;
      const my = this.y + this.dirY * PLAYER_MUZZLE_LEN;
      ctx.globalAlpha = t;
      ctx.fillStyle = 'rgba(255,238,170,0.95)';
      ctx.beginPath();
      ctx.arc(mx, my, 2 + 4 * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + this.dirX * 7 * t, my + this.dirY * 7 * t);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
