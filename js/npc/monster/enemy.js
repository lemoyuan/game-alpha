import Sprite from '../../base/sprite';
import { ARENA_W, ARENA_H } from '../../consts';

// 怪物基类：普通怪/宝箱怪共用，boss 可继承此类扩展
export default class Enemy extends Sprite {
  constructor(type, config) {
    super(null, config.radius * 2, config.radius * 2, 0, 0);
    this.type = type;
    this.radius = config.radius;   // 碰撞半径
    this.hp = config.hp;           // 当前血量
    this.maxHp = config.hp;        // 最大血量
    this.speed = config.speed;     // 移速
    this.color = config.color;     // 显示颜色
    this.xpValue = config.xp;      // 击杀掉落经验（0 = 不掉经验）
    this.damage = config.damage;   // 接触玩家的伤害
    this.isDead = false;
  }

  init(x, y) {
    this.x = x;
    this.y = y;
    this.isDead = false;
    this.hp = this.maxHp;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }
    this.x = Math.max(this.radius, Math.min(ARENA_W - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(ARENA_H - this.radius, this.y));
  }

  draw(ctx) {
    if (this.type === 'chest') {
      // 宝箱怪：金色方块 + 闪烁提示
      const blink = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 200));
      ctx.globalAlpha = blink;
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
