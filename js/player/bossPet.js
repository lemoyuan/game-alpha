import Sprite from '../base/sprite';
import { MONSTER_TYPES } from '../npc/monster/config';
import { clampToCoast } from '../arena/coast';
import { UI } from '../ui/theme';

// 迷你毒王跟班（融合匣开出）：在角色周围自由走位找怪，冷却到点朝最近的怪冲锋刮一小片 AOE。
// 冲锋状态机抄 boss.js，但计时一律 dt*1000 累加、不读 Date.now()（Boss 那条不变量优先于跟班的攻击钟写法）
export default class BossPet extends Sprite {
  constructor(def, slot = 0) {
    // 复用毒王贴图，不新出图；显示尺寸与碰撞半径解耦，同 COMPANION 约定
    super(MONSTER_TYPES.boss1.sprite, def.spriteSize, def.spriteSize, 0, 0);
    this.radius = def.radius;
    this.def = def;
    this.slot = slot;
    this.x = 0;
    this.y = 0;
    this.cdT = 0;             // 距上次冲锋已过的毫秒数（dt 累加）
    this.charging = false;
    this.chargeLeft = 0;      // 冲锋剩余毫秒（dt 累加）
    this.chargeDx = 0;
    this.chargeDy = 0;
    this.hitSet = null;       // 本次冲锋已刮过的怪：同一次冲锋不重复结算（同 bullet.hitList 规矩）
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const ms = dt * 1000;

    if (this.charging) {
      if (this.chargeLeft > 0) {
        this.x += this.chargeDx * this.def.chargeSpeed * dt;
        this.y += this.chargeDy * this.def.chargeSpeed * dt;
        this.chargeLeft -= ms;
        this.sweep(databus);
      } else {
        this.charging = false;
        this.hitSet = null;
      }
      clampToCoast(this, this.radius);
      return;
    }

    const dx = this.x - player.x;
    const dy = this.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > this.def.holdLeash) {
      // 掉队就回前方槽位：多只按槽位在角色朝向两侧摊开，同 companion.js 的扇形数学
      const total = Math.max(1, databus.bossPets.length);
      const a = Math.atan2(player.dirY, player.dirX) + (this.slot - (total - 1) / 2) * 0.7;
      this.stepToward(
        player.x + Math.cos(a) * this.def.holdDist,
        player.y + Math.sin(a) * this.def.holdDist,
        this.def.returnSpeed, dt,
      );
    } else {
      // 场内自由：朝够得着的最近怪挪，没怪就站住等。leash 之内它怎么走都不会跑出画面
      const prey = this.nearestEnemy(databus, this.def.pickRange);
      if (prey) this.stepToward(prey.x, prey.y, this.def.roamSpeed, dt);
    }
    clampToCoast(this, this.radius);

    this.cdT += ms;
    if (this.cdT >= this.def.chargeCd) {
      this.startCharge(databus);
      this.cdT = 0;
    }
  }

  stepToward(tx, ty, speed, dt) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return;
    const step = Math.min(d, speed * dt); // 到点就停，别绕着目标画圈
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  nearestEnemy(databus, range) {
    let best = null;
    let min = range;
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < min) {
        min = dist;
        best = e;
      }
    }
    return best;
  }

  startCharge(databus) {
    const player = databus.player;
    let nx = player.dirX;
    let ny = player.dirY;
    // chargeSearch 内没怪就朝角色朝向冲，不为冲锋强行掉头
    const nearest = this.nearestEnemy(databus, this.def.chargeSearch);
    if (nearest) {
      nx = nearest.x - this.x;
      ny = nearest.y - this.y;
      const d = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= d;
      ny /= d;
    }
    this.chargeDx = nx;
    this.chargeDy = ny;
    this.chargeLeft = this.def.chargeTime;
    this.charging = true;
    this.hitSet = new Set();
  }

  // 冲锋刮怪：走唯一受击入口 Enemy.takeDamage（膜王减伤覆写自动兼容），不写 e.hp、不碰玩家无敌帧
  sweep(databus) {
    for (const e of databus.enemys) {
      if (e.isDead || this.hitSet.has(e)) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.def.chargeRadius + e.radius) {
        this.hitSet.add(e);
        e.takeDamage(this.def.chargeDamage, false, databus);
      }
    }
  }

  draw(ctx) {
    // angle 传 0：正面朝上批次不旋转，冲锋方向由位移和预警环表达
    if (!this.drawSprite(ctx)) {
      // 贴图还没加载完 → 纯色圆占位
      ctx.fillStyle = UI.red;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.charging) {
      // 与毒王冲锋预警环同一语言：平涂红环标出这次冲锋的刮怪范围
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = UI.red;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.def.chargeRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
