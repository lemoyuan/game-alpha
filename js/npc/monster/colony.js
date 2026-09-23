import Enemy from './enemy';
import { clampToCoast } from '../../arena/coast';

/**
 * 菌群：膜王从底部孔口喷出来、飞到一定距离后掉头、再爬回孔口嵌进膜里的一批细胞。
 *
 * 它是本场唯一的「优先级目标」——本体几乎不动、玩家射程又长，
 * 没有这群东西爬回来补膜，膜王就只是一块站着挨打的石头。
 *
 * 两段行程（对应真实的分散 / 再定植）：
 *   burst 被孔口的压力喷出去（初速远快于回爬速度，"吐"这个动作要一眼看出来）
 *   home  到达折返距离后掉头，慢速爬回本体 —— 只有这一段画牵引线
 *
 * 直接继承 Enemy 并复用真实的杂兵 config（basic/fast/tank），
 * 于是血量、半径、识别色、贴图、接触伤害、掉落经验、图鉴条目全部白拿，
 * HUD 和图鉴都不需要新增分支。
 *
 * 注意：
 *   isBoss 保持 false（杂兵 config 里没有 boss 字段），所以 spawner 的「Boss 存活期间刷怪降速」
 *   和 HUD 的 find(e => e.isBoss) 都不会被它干扰；
 *   不调 markEncountered——它们本来就在普通刷怪池里解锁过，每吐一只写一次盘纯属浪费；
 *   时间轴用 dt 累加（升级三选一会跳过 update，Date.now() 会在暂停里白跑）。
 */
export default class Colony extends Enemy {
  /**
   * @param {object} cfg MONSTER_TYPES.boss3：只取 colonySpeed / colonyHpMult / colonyBurst(Max) 四个调参
   */
  constructor(type, config, cfg) {
    super(type, config);
    // 窜子原始移速 130，会跑赢踩在黏液里的玩家（170 × 0.55 = 93.5），必须统一压到 colonySpeed 以下
    this.speed = Math.min(config.speed, cfg.colonySpeed);
    // 血量加厚是刻意的：太薄会被打别的怪的溅射白嫖干净，「拦不拦」这个决策就等于不存在
    this.maxHp = Math.round(config.hp * cfg.colonyHpMult);
    this.hp = this.maxHp;
    this.burstSpeed = cfg.colonyBurst;   // 喷出段的速度（像素/秒）
    this.burstMax = cfg.colonyBurstMax;  // 喷出段的时间上限（毫秒），被海岸卡住也能按时掉头
    this.home = null;       // 要回嵌的膜王；由 BossFilm 在 launch 时写入
    this.absorbAt = 0;      // 距本体多远算嵌进去
    this.absorbed = false;  // 嵌回孔口（不是被打死）：main.js 读它来决定不掉经验宝石
    this.phase = 'burst';
    this.burstT = 0;        // 喷出段已经过的毫秒数
    this.flipAt = 0;        // 折返距离：离本体这么远就掉头
    this.burstDx = 0;
    this.burstDy = 1;
  }

  /**
   * @param {number} flipAt 折返距离（像素），由 BossFilm 从 colonyDist 里随机取
   */
  launch(home, dirX, dirY, flipAt) {
    this.home = home;
    this.absorbAt = home.radius + this.radius;
    this.flipAt = flipAt;
    this.burstDx = dirX;
    this.burstDy = dirY;
    this.phase = 'burst';
    this.burstT = 0;
  }

  update(dt, databus) {
    // 本体没了就不再回家：留着一群绕尸体转的幽灵是纯噪音，退回普通怪逻辑去追玩家
    if (!this.home || this.home.isDead) {
      this.phase = 'lost';
      super.update(dt, databus);
      return;
    }

    if (this.phase === 'burst') {
      this.burstT += dt * 1000;
      this.x += this.burstDx * this.burstSpeed * dt;
      this.y += this.burstDy * this.burstSpeed * dt;
      clampToCoast(this, this.radius);
      const dx = this.x - this.home.x;
      const dy = this.y - this.home.y;
      // 时间上限不可省：贴着海岸线喷的菌群会被 clamp 卡在原地，永远到不了折返距离
      if (Math.sqrt(dx * dx + dy * dy) >= this.flipAt || this.burstT >= this.burstMax) {
        this.phase = 'home';
        this.angle = Math.atan2(-dy, -dx);
      }
      return;
    }

    const dx = this.home.x - this.x;
    const dy = this.home.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.angle = Math.atan2(dy, dx);

    if (dist <= this.absorbAt) {
      this.home.absorb(this);
      this.absorbed = true;
      this.xpValue = 0; // 被吃回孔口不算击杀：不给经验，免得"该拦它"变成"该喂它"
      this.isDead = true;
      return;
    }

    const step = (this.speed * dt) / dist;
    this.x += dx * step;
    this.y += dy * step;
    clampToCoast(this, this.radius);
  }

  draw(ctx) {
    // 牵引线只画在回嵌段：这是本场最该被看清的信息——"谁正在回家"，比它的血条重要
    if (this.phase === 'home' && this.home && !this.home.isDead && !this.isDead) {
      const hx = this.home.x + Math.cos(this.home.holeAngle) * this.home.holeDist;
      const hy = this.home.y + Math.sin(this.home.holeAngle) * this.home.holeDist;
      ctx.save();
      ctx.strokeStyle = '#EAECEE';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.34;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.restore();
    }
    super.draw(ctx);
  }
}
