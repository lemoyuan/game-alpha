import Enemy from './enemy';
import Zone from './zone';
import PhageMissile from './phageMissile';
import { clampToCoast } from '../../arena/coast';
import { UI } from '../../ui/theme';

/**
 * 五号 Boss（终极通关）：噬君（T4 肌尾噬菌体）。固定最后登场（config.buildBossOrder 钉末位），
 * 杀死它 = 新增通关胜利态（main.js 在死亡口置 databus.isVictory，与 isGameOver 平行）。
 *
 * 三机制都对应真实感染行为，不是三个随机技能：
 *   燃烧路径 = 裂解酶灼烧菌苔：移动时在脚下留一片橙盘（复用 Zone + applyPoison，不吃无敌帧）；
 *   追踪导弹 = 子代病毒体漂向新宿主：慢速 + 转向帽 + 有限寿命（专用实体 phageMissile）；
 *   瞬移刀砍 = 再吸附新宿主 + 尾针穿刺注入：落点环预警 → 瞬移 → 挥刀前摇弧 → 命中，全程可走位躲。
 *
 * ★普通 Enemy 子类，走 main.js 现成的接触伤害 / 掉落 / 图鉴解锁，没有专属结算路径。
 * ★计时一律 dt*1000 累加（升级三选一暂停 update 时天然冻结），不用 Date.now()；
 *   只有命中那一下的 takeDamage 时间戳用 inline Date.now()（同 enemyBullet 的既有例外）。
 */

// 出场到第一个技能的间隔（毫秒）：先给玩家一段"看清这是最后一只"的时间（同 bossTwins）
const FIRST_SKILL_DELAY = 2500;
// 瞬移落点相对玩家的侧向偏移（像素）：不落在正脸上，留一个"它要扑过来"的读招距离
const BLINK_OFFSET = 60;

export default class BossPhage extends Enemy {
  constructor(type, config) {
    super(type, config);
    this.isBoss = true;

    // —— 被动：燃烧路径 ——
    this.trailRadius = config.trailRadius;
    this.trailLife = config.trailLife;
    this.trailDamage = config.trailDamage;
    this.trailHold = config.trailHold;
    this.trailCd = config.trailCd;
    this.trailTint = config.trailTint;
    this.trailT = 0;

    // —— 攻击一：追踪导弹 ——
    this.missileCd = config.missileCd;
    this.missileCount = config.missileCount;
    this.missileSpeed = config.missileSpeed;
    this.missileTurn = config.missileTurn;
    this.missileLife = config.missileLife;
    this.missileDamage = config.missileDamage;
    this.missileRadius = config.missileRadius;
    this.missileT = 0;

    // —— 攻击二：瞬移 + 刀砍 ——
    this.teleportCd = config.teleportCd;
    this.teleportWarn = config.teleportWarn;
    this.slashWarn = config.slashWarn;
    this.slashDamage = config.slashDamage;
    this.slashRadius = config.slashRadius;
    this.slashArc = config.slashArc;
    this.teleportT = 0;

    // 状态机：stalk（追击+铺路+抛导弹）→ telegraph（落点环）→ windup（挥刀前摇弧）→ 回 stalk。
    // 瞬移发生在 telegraph→windup 的那一帧，命中判定发生在 windup→stalk 的那一帧（各一次，不重复结算）
    this.state = 'stalk';
    this.telegraphLeft = 0;
    this.windupLeft = 0;
    this.destX = 0;
    this.destY = 0;
    this.slashAngle = 0;
  }

  init(x, y) {
    super.init(x, y);
    this.state = 'stalk';
    this.telegraphLeft = 0;
    this.windupLeft = 0;
    this.trailT = 0;
    // 倒着算比再加一个"是否首招"的标记省一个状态（同 bossTwins）
    this.missileT = this.missileCd - FIRST_SKILL_DELAY;
    this.teleportT = this.teleportCd - FIRST_SKILL_DELAY;
  }

  update(dt, databus) {
    if (this.isDead) return; // 残尸不做事（同 bossTwins）
    const ms = dt * 1000;
    const player = databus.player;
    if (!player) return;

    if (this.state === 'telegraph') {
      // 预警期间身子钉住：落点环就是倒计时，一边跑一边读圈会被读成蓄力位移
      this.telegraphLeft -= ms;
      if (this.telegraphLeft <= 0) {
        this.x = this.destX;
        this.y = this.destY;
        clampToCoast(this, this.radius);
        this.slashAngle = Math.atan2(player.y - this.y, player.x - this.x);
        this.state = 'windup';
        this.windupLeft = this.slashWarn;
      }
      return;
    }

    if (this.state === 'windup') {
      this.windupLeft -= ms;
      if (this.windupLeft <= 0) {
        this.doSlash(databus);
        this.state = 'stalk';
        this.teleportT = 0; // 刀砍的 6 秒从"砍完"起算，不是从"起念"起算
      }
      return;
    }

    // —— stalk ——
    this.missileT += ms;
    this.teleportT += ms;

    if (this.teleportT >= this.teleportCd) {
      this.startTelegraph(player);
      return;
    }
    if (this.missileT >= this.missileCd) this.fireMissiles(databus);

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    this.x += (dx / dist) * this.speed * dt;
    this.y += (dy / dist) * this.speed * dt;
    clampToCoast(this, this.radius);

    // 移动留下燃烧路径：warn=0 立即生效（复用 Zone，走 applyPoison 不吃无敌帧）
    this.trailT += ms;
    if (this.trailT >= this.trailCd) {
      this.trailT = 0;
      const zone = databus.pool.getItemByClass('zone', Zone);
      zone.init(this.x, this.y, this.trailRadius, this.trailLife, 0, this.trailDamage, this.trailHold, this.trailTint);
      databus.zones.push(zone);
    }
  }

  // 落点快照在玩家侧方 ~60px：预警环画在快照点，900ms 后瞬移过去；玩家走开就扑空
  startTelegraph(player) {
    const a = Math.atan2(player.y - this.y, player.x - this.x);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = a + side * Math.PI / 2;
    const dest = { x: player.x + Math.cos(off) * BLINK_OFFSET, y: player.y + Math.sin(off) * BLINK_OFFSET };
    clampToCoast(dest, this.radius);
    this.destX = dest.x;
    this.destY = dest.y;
    this.state = 'telegraph';
    this.telegraphLeft = this.teleportWarn;
  }

  fireMissiles(databus) {
    this.missileT = 0;
    const player = databus.player;
    if (!player) return;
    const base = Math.atan2(player.y - this.y, player.x - this.x);
    for (let i = 0; i < this.missileCount; i++) {
      const heading = base + (i - (this.missileCount - 1) / 2) * 0.35;
      const m = databus.pool.getItemByClass('phageMissile', PhageMissile);
      m.init(this.x, this.y, heading, this.missileSpeed, this.missileTurn, this.missileLife, this.missileDamage, this.missileRadius, this.color);
      databus.missiles.push(m);
    }
  }

  // 命中判定只在 windup 结束那一帧做一次：半径内且 ~100° 弧内才挨刀（走 takeDamage 吃无敌帧）
  doSlash(databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const r = this.slashRadius + player.radius;
    if (dx * dx + dy * dy > r * r) return;
    let dA = Math.atan2(dy, dx) - this.slashAngle;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    if (Math.abs(dA) <= this.slashArc / 2) player.takeDamage(this.slashDamage, Date.now(), databus);
  }

  draw(ctx) {
    super.draw(ctx);
    if (this.state === 'telegraph') this.drawTelegraphWarn(ctx);
    if (this.state === 'windup') this.drawSlashArc(ctx);
  }

  // 落点环：流动虚线圈 = "这里马上要疼"（语法同 bossTwins.drawWarn / Zone.drawWarn），UI.red
  drawTelegraphWarn(ctx) {
    const t = 1 - this.telegraphLeft / this.teleportWarn;
    ctx.save();
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -((this.teleportWarn - this.telegraphLeft) / 26 % 21);
    ctx.strokeStyle = UI.red;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = Math.min(1, 0.25 + 0.55 * t);
    ctx.beginPath();
    ctx.arc(this.destX, this.destY, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = UI.red;
    ctx.globalAlpha = 0.1 * t;
    ctx.fill();
    ctx.restore();
  }

  // 挥刀前摇弧：~100° 红弧指向快照时的玩家方向，再给 slashWarn 毫秒走位
  drawSlashArc(ctx) {
    ctx.save();
    ctx.strokeStyle = UI.red;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.slashRadius, this.slashAngle - this.slashArc / 2, this.slashAngle + this.slashArc / 2);
    ctx.stroke();
    ctx.restore();
  }
}