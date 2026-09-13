import Sprite from '../../base/sprite';
import EnemyBullet from './enemyBullet';
import { ARENA_W, ARENA_H } from '../../consts';
import { SPRITE_ROTATES } from './config';

// 怪物基类：普通怪/宝箱怪共用，boss 可继承此类扩展
export default class Enemy extends Sprite {
  constructor(type, config) {
    super(config.sprite, config.radius * 2, config.radius * 2, 0, 0);
    this.type = type;
    this.radius = config.radius;   // 碰撞半径
    this.hp = config.hp;           // 当前血量
    this.maxHp = config.hp;        // 最大血量
    this.speed = config.speed;     // 移速
    this.color = config.color;     // 显示颜色
    this.xpValue = config.xp;      // 击杀掉落经验（0 = 不掉经验）
    this.damage = config.damage;   // 接触玩家的伤害（远程怪同时是子弹伤害）
    this.isDead = false;
    // 远程怪专属字段（近战怪为 0，走默认追击逻辑）
    this.attackRange = config.attackRange || 0;  // 索敌距离，玩家进入后停下射击
    this.attackCd = config.attackCd || 0;        // 射击间隔（毫秒）
    this.bulletSpeed = config.bulletSpeed || 0;
    this.bulletRadius = config.bulletRadius || 4;
    this.bulletColor = config.bulletColor || '#fff';
    this.lastAttack = 0;           // 上次射击时间戳（内部用）
    this.angle = 0;                // 朝向弧度（指向玩家）；仅当 SPRITE_ROTATES 为 true 时用于旋转贴图
  }

  init(x, y) {
    this.x = x;
    this.y = y;
    this.isDead = false;
    this.hp = this.maxHp;
    this.lastAttack = 0;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    this.angle = Math.atan2(dy, dx);

    // 远程怪：玩家在索敌距离内停下射击，超出距离才靠近
    if (this.attackRange > 0 && dist <= this.attackRange) {
      const now = Date.now();
      if (now - this.lastAttack > this.attackCd) {
        this.lastAttack = now;
        this.shoot(databus, dx / dist, dy / dist);
      }
    } else if (dist > 0) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }

    this.x = Math.max(this.radius, Math.min(ARENA_W - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(ARENA_H - this.radius, this.y));
  }

  shoot(databus, nx, ny) {
    const bullet = databus.pool.getItemByClass('enemyBullet', EnemyBullet);
    bullet.init(this.x, this.y, nx, ny, this.bulletSpeed, this.damage, this.bulletColor, this.bulletRadius);
    databus.enemyBullets.push(bullet);
  }

  draw(ctx) {
    // 宝箱怪整体闪烁，提示「击杀必掉宝箱」
    const alpha = this.type === 'chest'
      ? 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 200))
      : 1;
    if (!this.drawSprite(ctx, SPRITE_ROTATES ? this.angle : 0, alpha)) {
      if (this.type === 'chest') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
        ctx.fillStyle = '#8b5a00';
        ctx.fillRect(this.x - this.radius, this.y - 3, this.radius * 2, 6);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 血条
    if (this.hp < this.maxHp) {
      const bw = this.radius * 2;
      const bh = 4;
      const bx = this.x - this.radius;
      const by = this.y - this.radius - 8;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}
