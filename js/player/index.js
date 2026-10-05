import Sprite from '../base/sprite';
import Bullet from './bullet';
import {
  PLAYER_RADIUS, PLAYER_SPEED, PLAYER_MAX_HP, PLAYER_SPRITE, PLAYER_SPRITE_SIZE,
  PLAYER_MUZZLE_LEN, PLAYER_MUZZLE_FLASH,
  PLAYER_ATK, PLAYER_DEF, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_CD,
  PLAYER_INVINCIBLE, BULLET_SPEED, BULLET_DAMAGE,
  PLAYER_CRIT_RATE, PLAYER_CRIT_MULT, PLAYER_LUCK,
  BULLET_RANGE_BUFFER, SHOT_SPREAD, xpForLevel, LEVEL_UP_BONUS,
  XP_PICKUP_RANGE,
  POISON_TICK, BURN_DMG,
  ARENA_W, ARENA_H,
} from '../consts';
import { settings } from '../storage';
import { UI } from '../ui/theme';
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
    this.luck = PLAYER_LUCK;            // 幸运值，每点提高金匣刷新概率（升级项：幸运值；曲线在 config.js 的 chestChance）
    this.bulletCount = 1;               // 每轮子弹数（宝箱：子弹数+1）
    this.pierce = 0;                    // 子弹可穿透敌人数（宝箱：子弹穿透+1）
    this.shield = 0;                    // 护盾层数，每层挡一次伤害（宝箱：护盾+1）
    this.shieldBroken = 0;              // 本局被打破的护盾层数，只增不减：shield + shieldBroken 才是「拾取过几层」（HUD 道具格用）
    this.companions = 0;                // 射击跟班每轮发数（宝箱：跟班+1）：★场上恒为一只，层数加的是「一次齐射几发」，不是跟班只数
    this.bomber = 0;                    // 炸弹跟班层数（宝箱：炸弹跟班+1）：场上只有一只，层数 = 一轮扔几枚。节奏与爆风在 consts.js 的 BOMB_CD/BOMB_BLAST_R
    this.pickupRange = XP_PICKUP_RANGE; // 经验磁吸半径（像素），宝石在这个距离内往角色飞（宝箱：经验拾取范围，每次 +XP_PICKUP_STEP）
    this.burnBullets = 0;               // 燃烧子弹层数（宝箱：燃烧子弹+1）：子弹命中挂 5 秒燃烧，每跳跳的血 = 这个层数；节拍与单跳基数在 consts.js 的 BURN_TICK/BURN_DMG
    this.lastAttack = 0;                // 上次攻击时间戳（内部用）
    this.invincibleUntil = 0;           // 受击无敌截止时间戳（内部用）
    this.slowMult = 1;                  // 当前移速倍率（1 = 未被减速），由黏液洼写入 applySlow
    this.slowLeft = 0;                  // 减速剩余毫秒数：离开黏液后还要拖一会儿才恢复，黏滞感来自这个尾巴
    this.poisonLeft = 0;                // 中毒剩余毫秒数（赤潮池写入 applyPoison）：离开池子还在身上，这才是"持续掉血"
    this.poisonTickLeft = 0;            // 距下一跳伤害的毫秒数（内部用），节奏是 POISON_TICK，和受击无敌帧互不相干
    this.poisonDamage = 0;              // 每跳掉多少血：重叠的毒只取最强的一片，绝不相乘
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

    // 中毒：同样的 dt 时钟，但走自己这条路结算——不碰 takeDamage，所以不吃受击无敌帧、也不被护盾挡。
    // 无敌帧是「一次撞击」的限流器，护盾挡的是「一次攻击」，毒素既不被撞完也不该被盾白吞
    if (this.poisonLeft > 0) {
      this.poisonLeft = Math.max(0, this.poisonLeft - dt * 1000);
      this.poisonTickLeft -= dt * 1000;
      if (this.poisonTickLeft <= 0) {
        this.poisonTickLeft += POISON_TICK;
        this.hp -= this.poisonDamage;
      }
      if (this.poisonLeft === 0) {
        this.poisonDamage = 0;
        this.poisonTickLeft = 0;
      }
    }

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
    for (let i = 0; i < this.bulletCount; i++) {
      const angle = baseAngle + (i - (this.bulletCount - 1) / 2) * SHOT_SPREAD;
      const bullet = databus.pool.getItemByClass('bullet', Bullet);
      bullet.init(mx, my, Math.cos(angle), Math.sin(angle), this.attack);
      bullet.maxRange = this.attackRange + BULLET_RANGE_BUFFER;
      bullet.pierceLeft = this.pierce;
      // 开火时快照层数：飞在路上的子弹不会因为中途又开一个匣子就变强
      bullet.burnDamage = this.burnBullets * BURN_DMG;
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

  // 赤潮毒素：和 applySlow 同一套规矩——重叠的池只取最强的一片、时长刷新不叠加。
  // 刚挂上时把跳血时钟对齐到 0，第一跳立刻到手，玩家才有"踩到了"的即时反馈
  applyPoison(damage, hold) {
    const fresh = this.poisonLeft <= 0;
    if (fresh) this.poisonDamage = damage;
    else this.poisonDamage = Math.max(this.poisonDamage, damage);
    this.poisonLeft = Math.max(this.poisonLeft, hold);
    if (fresh) this.poisonTickLeft = 0;
  }

  effectiveSpeed() {
    return this.slowLeft > 0 ? this.speed * this.slowMult : this.speed;
  }

  takeDamage(amount, now) {
    if (now < this.invincibleUntil) return;
    this.invincibleUntil = now + PLAYER_INVINCIBLE;
    if (this.shield > 0) {
      this.shield--;
      this.shieldBroken++; // 记一笔：道具格要的是「拾取过几层」，破掉的不该从花名册里退场
      return;
    }
    const dmg = Math.max(1, amount - this.defence);
    this.hp -= dmg;
    if (settings.vibrate) wx.vibrateShort({ type: 'light' });
  }

  // 回血：唯一的一处血包入口（血块，见 npc/bloodclot.js），别让掉落方直接改 this.hp。
  // 返回实际回复量而不是布尔——差 1 血时捡到一颗回 2 的血块，只该算回复了 1
  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.hp + amount, this.maxHp);
    return this.hp - before;
  }

  // 一次只结一级：面板关掉时 upgrade.js 会再调 addXp(0) 把溢出经验接着结算成下一张卡。
  // 不要改成 while 循环——那等于一颗宝石白送好几次升级而不给对应的卡
  addXp(amount, databus) {
    this.xp += amount;
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

    // 中毒自查反馈：身上一圈毒素膜 + 三滴往下淌的毒液，每次跳血整组亮一下——
    // "持续掉血"这件事必须看得见，否则玩家只会觉得血条莫名其妙在自己少。
    // 动画按 poisonLeft / poisonTickLeft 走（都是 dt 时钟），三选一面板开着时和跳血一起冻结，不会留下挂着的假毒
    if (this.poisonLeft > 0) {
      const s = Math.min(1, this.poisonLeft / 900); // 最后 0.9 秒渐退，别突然消失
      const pulse = 1 - Math.min(1, this.poisonTickLeft / POISON_TICK); // 刚跳过血 = 1，下一次跳血前衰减到 0
      ctx.save();
      ctx.strokeStyle = UI.toxic;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = (0.4 + 0.3 * pulse) * s;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = UI.toxic;
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * this.radius * 0.55;
        const len = 3 + 7 * pulse * (i === 1 ? 1 : 0.7);
        ctx.globalAlpha = 0.75 * s;
        ctx.beginPath();
        ctx.ellipse(this.x + ox, this.y + this.radius * 0.85 + len * 0.5, 2.2, len * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
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
