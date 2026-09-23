import Enemy from './enemy';
import Laser, { LASER_EYES, LASER_LIGHT_ORDER, TURN_WARN } from './laser';
import Zone from './zone';
import { ABYSS } from '../../consts';
import { UI } from '../../ui/theme';

/**
 * 二号 Boss「海火」（Noctiluca scintillans，夜光藻）
 *
 * 为什么 extends Enemy 而不是 extends Boss：boss.js 不是 Boss 基类，它是毒王的套件——里面硬编了
 * chargeSpeed/ringCount/summonCount 和 `skillIndex % 3` 分支，draw() 那个红圈的含义是「我要冲你了」。
 * 海火整个施法期都定在原地，继承过来就会每次扫射前挂一个骗人的冲锋预警圈。
 * 而 isBoss 只是一个数据标记（HUD 血条、刷怪降速都只读这个布尔），所以共享的东西放在 config 里。
 *
 * 时间轴一律用 dt 累加（stateT/castT += dt*1000），不用 Date.now()：
 * main.js 在升级三选一（isPaused）时整段跳过 update，毒王那套时间戳在暂停期间会白白流逝，
 * 回来就"卡在冲刺中途"。这里天然冻结。
 */

// 出场后多久放第一个技能（毫秒）：比 skillCd 短，玩家刚照面就该看见它转起来
const FIRST_CAST_DELAY = 2600;
// 赤潮环相对 Boss 的布池距离（× poolRadius）：太近会合成一坨，太远封不住走位
// 三片等分在这个半径上，相邻片心距 = √3 × 布池半径 ≈ 2.77 倍池半径，恒大于最小池心距 1.4 倍 → 环上一定留得下缝
const RING_DIST = 1.6;

export default class BossSeaFire extends Enemy {
  constructor(type, config) {
    super(type, config);
    this.skillCd = config.skillCd;
    this.spinIdle = config.spinIdle;     // 平时自转角速度（弧度/秒）
    this.spinSweep = config.spinSweep;   // 扫射角速度；★上限 2.09，见 config 里的公平性注释
    this.sweepLegs = config.sweepLegs;   // 三段扫射时长（毫秒），方向依次 正→反→正
    this.sweepStall = config.sweepStall; // 换向停顿（毫秒）
    this.eyeStages = config.eyeStages;   // 三档血量各点亮几道眼
    this.telegraph = config.laserTelegraph;
    this.poolCount = config.poolCount;
    this.poolRadius = config.poolRadius;
    this.poolWarn = config.poolWarn;
    this.poolLife = config.poolLife;
    this.poolDamage = config.poolDamage;
    // 传给 Laser.init 的光束参数：tint 直接用怪物识别色，改 config.color 就全身跟着变
    this.laserCfg = {
      telegraph: config.laserTelegraph,
      fade: config.laserFade,
      width: config.laserWidth,
      length: config.laserLength,
      damage: config.laserDamage,
      tint: config.color,
    };
    this.zoneTint = config.color;
    this.spin = 0;        // 身体自转角：光束和贴图都只读它，永不朝玩家修正
    this.spinRate = config.spinIdle;
    this.spinDir = 1;     // 本段扫射方向（+1/-1），只按腿表翻，不看玩家在哪
    this.warnTurn = false; // 段尾预告反向，Laser 读它画人字箭头
    this.state = 'chase';
    this.stateT = 0;      // 当前状态已经过的毫秒数
    this.castT = 0;       // 距上次施法开始的毫秒数（skillCd 从这里读）
    this.legIndex = 0;
    this.legT = 0;
    this.litEyes = [];    // 本次扫射点亮的眼序号（非扫射期为空，身上不画亮眼）
    this.hasCast = false; // 是否已放过技能：没放过用 FIRST_CAST_DELAY，之后统一按 skillCd 起调
    this.lastSkill = '';  // 'sweep' | 'bloom'，两个技能交替
  }

  init(x, y) {
    super.init(x, y);
    this.spin = Math.random() * Math.PI * 2; // 出场相位随机，别每局都在同一个角度起手
    this.spinRate = this.spinIdle;
    this.spinDir = 1;
    this.warnTurn = false;
    this.state = 'chase';
    this.stateT = 0;
    this.castT = 0;
    this.legIndex = 0;
    this.legT = 0;
    this.litEyes = [];
    this.hasCast = false;
    this.lastSkill = '';
  }

  // 贴图按身体自转角转，不按"朝玩家"转：这货是灯塔，不是枪手
  spriteAngle() {
    return this.spin;
  }

  update(dt, databus) {
    const ms = dt * 1000;
    this.stateT += ms;
    this.castT += ms;

    switch (this.state) {
      case 'chase':
        this.spinRate = this.spinIdle;
        this.warnTurn = false;
        super.update(dt, databus); // 只有追击态会动；施法期整个定身（含 clampToCoast）
        if (this.castT >= (this.hasCast ? this.skillCd : FIRST_CAST_DELAY)) {
          this.beginCast(databus);
        }
        break;
      case 'telegraph':
        this.spinRate = this.spinIdle; // 蓄力期身体还在慢转，细瞄准线先扫起来给玩家读
        if (this.stateT >= this.telegraph) this.startSweep();
        break;
      case 'sweep':
        this.updateSweep(ms);
        break;
      case 'stall':
        this.spinRate = 0; // 换向前的死点：反向必须读得出来
        this.warnTurn = true;
        if (this.stateT >= this.sweepStall) this.nextLeg();
        break;
      case 'bloom':
        this.spinRate = this.spinIdle;
        if (this.stateT >= this.poolWarn) this.endCast();
        break;
      default:
        break;
    }

    this.spin = (this.spin + this.spinRate * dt) % (Math.PI * 2);
  }

  // 一次施法 = 扫射 / 赤潮 二择循环：上一个技能是扫射就铺池，铺过池就扫射
  // 池子有 poolLife 毫秒寿命，所以"铺池 → 扫射"的次序会让第二轮扫射打在已经布满发光水体的场地上
  beginCast(databus) {
    this.castT = 0;
    this.stateT = 0;
    this.hasCast = true;
    this.litEyes = [];
    if (this.lastSkill === 'sweep') this.castPools(databus);
    else this.castSweep(databus);
  }

  // 血量越低点亮越多眼：只按 LASER_LIGHT_ORDER 的顺序取前 N 颗，
  // 先取间隔最宽的，保证任何档下光束之间的缝都 ≥60°（转过这道缝要 ≥0.5 秒，缝才是避难所）
  pickEyes() {
    const ratio = this.hp / this.maxHp;
    const stage = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
    const n = Math.min(this.eyeStages[stage], LASER_EYES.length);
    return LASER_LIGHT_ORDER.slice(0, n);
  }

  castSweep(databus) {
    this.lastSkill = 'sweep';
    this.litEyes = this.pickEyes();
    // 扫射总时长 = 各段之和 + 段间停顿；光束在这整段时间里持续判定，换向不重启
    const total = this.sweepLegs.reduce((a, b) => a + b, 0)
      + this.sweepStall * (this.sweepLegs.length - 1);
    for (const eye of this.litEyes) {
      const laser = databus.pool.getItemByClass('laser', Laser);
      laser.init(this, eye, this.laserCfg, total);
      databus.lasers.push(laser);
    }
    this.state = 'telegraph';
  }

  startSweep() {
    this.state = 'sweep';
    this.stateT = 0;
    this.legIndex = 0;
    this.legT = 0;
    this.spinDir = 1;
    this.spinRate = this.spinSweep;
  }

  updateSweep(ms) {
    this.spinRate = this.spinSweep * this.spinDir;
    this.legT += ms;
    const dur = this.sweepLegs[this.legIndex];
    this.warnTurn = dur - this.legT <= TURN_WARN;
    if (this.legT >= dur) {
      this.state = 'stall';
      this.stateT = 0;
    }
  }

  nextLeg() {
    this.legIndex++;
    if (this.legIndex >= this.sweepLegs.length) {
      this.endCast();
      return;
    }
    this.state = 'sweep';
    this.stateT = 0;
    this.legT = 0;
    this.spinDir = this.legIndex % 2 === 0 ? 1 : -1; // 正→反→正
    this.warnTurn = false;
  }

  // 赤潮铺场：3 片围着转动的自己 + 1 片压在施法瞬间的玩家脚下
  castPools(databus) {
    this.lastSkill = 'bloom';
    const player = databus.player;
    const r = this.poolRadius;
    const ringCount = Math.max(0, this.poolCount - 1);
    const offset = Math.random() * Math.PI * 2;
    const spots = [];
    for (let i = 0; i < ringCount; i++) {
      const a = offset + (i / ringCount) * Math.PI * 2;
      spots.push({ x: this.x + Math.cos(a) * r * RING_DIST, y: this.y + Math.sin(a) * r * RING_DIST });
    }
    if (player && spots.length < this.poolCount) spots.push({ x: player.x, y: player.y });

    const minGap = r * 1.4; // 相邻片心距小于这个数就会糊成一坨没缝可走
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < spots.length; i++) {
        const p = spots[i];
        for (let j = 0; j < spots.length; j++) {
          if (i === j) continue;
          const q = spots[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d < minGap) {
            p.x = q.x + (dx / d) * minGap;
            p.y = q.y + (dy / d) * minGap;
          }
        }
      }
    }
    for (const s of spots) {
      const zone = databus.pool.getItemByClass('zone', Zone);
      zone.init(s.x, s.y, r, this.poolLife, this.poolWarn, this.poolDamage, this.zoneTint);
      databus.zones.push(zone);
    }
    this.state = 'bloom';
  }

  endCast() {
    this.state = 'chase';
    this.stateT = 0;
    // 不重置 castT：冷却从"施法开始"计时（和毒王的 skillT 同一套语义），beginCast 已清过一次
    this.spinRate = this.spinIdle;
    this.spinDir = 1;
    this.warnTurn = false;
    this.litEyes = []; // 追击期不挂亮眼：没准备发光束的时候别骗玩家去数缝
  }

  draw(ctx) {
    // 施法期脚下压一圈静水：把"它定住了"说出来，同时给亮着的眼睛做底色
    // 半径只留 1.45×：贴图半径 38、这圈 49，再大就把暗红本体一起吞进黑洞里
    if (this.state !== 'chase') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ABYSS.far;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    super.draw(ctx);
    this.drawRim(ctx);
    this.drawEyes(ctx);
  }

  // 识别色环：本体是暗红色，压在自家青色光束下会被洗掉，描一圈把"Boss 站在哪"钉住
  // 顺带把碰撞半径可视化——贴图比碰撞盒大一圈，玩家需要知道判定边在哪
  drawRim(ctx) {
    ctx.save();
    ctx.globalAlpha = this.state === 'chase' ? 0.45 : 0.9;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 亮着的眼 = 这一轮真正会发光束的那几颗核；蓄力期按序点亮，玩家据此数清"这次是几道"
  drawEyes(ctx) {
    const n = this.litEyes.length;
    if (!n) return;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const e = LASER_EYES[this.litEyes[i]];
      const a = this.spin + e.a;
      const d = this.radius * e.r;
      const ex = this.x + Math.cos(a) * d;
      const ey = this.y + Math.sin(a) * d;
      const t = n > 1 ? i / (n - 1) : 0;
      const lit = this.state !== 'telegraph' || this.stateT >= this.telegraph * 0.7 * t;
      ctx.globalAlpha = lit ? 0.35 : 0.18;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(ex, ey, lit ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = lit ? 1 : 0.4;
      ctx.fillStyle = UI.cream;
      ctx.beginPath();
      ctx.arc(ex, ey, lit ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
