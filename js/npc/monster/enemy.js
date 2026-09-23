import Sprite from '../../base/sprite';
import EnemyBullet from './enemyBullet';
import { clampToCoast } from '../../arena/coast';
import { SPRITE_ROTATES } from './config';

// 怪物基类：普通怪/宝箱怪共用，boss 可继承此类扩展
export default class Enemy extends Sprite {
  constructor(type, config) {
    // 贴图画布边长默认等于碰撞直径；需要「图比碰撞盒大一圈」（如 Boss 的伪足）时由 config.spriteSize 覆盖
    const size = config.spriteSize || config.radius * 2;
    super(config.sprite, size, size, 0, 0);
    this.type = type;
    this.radius = config.radius;   // 碰撞半径
    this.hp = config.hp;           // 当前血量
    this.maxHp = config.hp;        // 最大血量
    this.speed = config.speed;     // 移速
    this.color = config.color;     // 显示颜色
    this.xpValue = config.xp;      // 击杀掉落经验（0 = 不掉经验）
    this.damage = config.damage;   // 接触玩家的伤害（远程怪同时是子弹伤害）
    this.isBoss = !!config.boss;   // Boss 标记：HUD 血条、刷怪降速、图鉴文案都读它，来源和图鉴同源所以不会不一致
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

    clampToCoast(this, this.radius);
  }

  shoot(databus, nx, ny) {
    const bullet = databus.pool.getItemByClass('enemyBullet', EnemyBullet);
    bullet.init(this.x, this.y, nx, ny, this.bulletSpeed, this.damage, this.bulletColor, this.bulletRadius);
    databus.enemyBullets.push(bullet);
  }

  // 受击结算的唯一入口：扣血 / 飘字 / 死亡标记。
  // 减伤类机制（膜王的 EPS 膜）覆写这个方法，不要再去 bullet.js 里加特判
  takeDamage(dmg, isCrit, databus) {
    this.hp -= dmg;
    databus.addDamageText(this.x, this.y - this.radius, dmg, isCrit);
    if (this.hp <= 0) this.isDead = true;
  }

  // 贴图画布旋转角：子类可覆写（海火按身体自转角旋转贴图，而不是朝玩家）
  spriteAngle() {
    return SPRITE_ROTATES ? this.angle : 0;
  }

  draw(ctx) {
    // 宝箱怪整体闪烁，提示「击杀必掉宝箱」
    const alpha = this.type === 'chest'
      ? 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 200))
      : 1;
    if (!this.drawSprite(ctx, this.spriteAngle(), alpha)) {
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
