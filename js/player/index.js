import Sprite from '../base/sprite';
import Bullet from './bullet';
import LaserCross from './laserCross';
import {
  PLAYER_RADIUS, PLAYER_SPEED, PLAYER_MAX_HP, PLAYER_SPRITE, PLAYER_SPRITE_SIZE,
  PLAYER_MUZZLE_LEN, PLAYER_MUZZLE_FLASH,
  PLAYER_ATK, PLAYER_DEF, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_CD,
  PLAYER_INVINCIBLE, BULLET_SPEED, BULLET_DAMAGE,
  PLAYER_CRIT_RATE, PLAYER_CRIT_MULT, PLAYER_LUCK,
  BULLET_RANGE_BUFFER, SHOT_SPREAD, xpForLevel, LEVEL_UP_BONUS,
  XP_PICKUP_RANGE,
  POISON_TICK, BURN_DMG, LEECH_CHANCE, VIAL_GAIN_CD, VIAL_OUT_CD, VIAL_OUT,
  LASER_CROSS_CD,
  MEMBRANE_HOLD, MEMBRANE_CD, membraneDamage,
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
    this.turrets = 0;                   // 场上炮台座数（宝箱：炮台+1，一层一座、不封顶）。★和上面两条跟班相反：这里层数买的是「几只」而不是「一轮几发」，
                                        //   因为那两条的前提是实体只有一个位置，而炮台的位置就是它的内容（落位由 databus 观察这个数来做）
    this.laserCross = 0;                // 海火核心层数（Boss 掉落道具，见 config 的 BOSS_DROPS.boss2）：每次真正掉血放出一根旋转十字光束。
                                        //   ★层数只买「每次结算几点伤害」，节拍 / 束长 / 束数全部钉死在 consts 的 LASER_CROSS_*——
                                        //   十字是这件道具图标许下的形状，八层的它就不叫十字了
    this.laserCrossT = 0;               // 距下一次可触发的毫秒数（dt 累加，同下面 vialGainT 那条）：★不用 Date.now，
                                        //   三选一面板开着时 main.js 整条跳过 databus.update，墙上时钟会照走，
                                        //   后果是「选卡那几秒攒出一根免费十字」，关门瞬间白放一发
    this.membrane = 0;                  // 有没有「薄膜核心」（Boss 掉落道具，见 config 的 BOSS_DROPS.boss3）。★只取 0 / 1，不是层数：
                                        //   boss3 一局只掉一只，且没有任何常量乘这个数 —— 所以 chestGrant 那行写的是 = 1 而不是 += 1，
                                        //   以后读代码的人一眼看出这件不叠层（海火核心那种「层数买伤害」的经济在这里不存在）
    this.membraneT = 0;                 // 膜剩余毫秒数（dt 累加，同上面 laserCrossT：面板开着时必须跟着冻住，否则 3 秒保护在选卡界面里白烧完）
    this.membraneCdT = 0;               // 主动键冷却剩余毫秒数（dt 累加）：★在放火那一刻顶满，不在膜烧完时才顶，
                                        //   否则「按一次等 3 秒再等 40 秒」会把真实周期写成 43 秒
    this.twinBattery = 0;               // 有没有「双子核心」（Boss 掉落道具，见 config 的 BOSS_DROPS.boss4）。★同样只取 0 / 1：
                                        //   boss4 一局只掉一只匣（掉落口那道按 type 的记账门保证），chestGrant 那行写的也是 = 1
                                        //   和上面两条 Boss 掉落的核心区别：这一件的计时器不在角色身上 —— 它落的是地上的一座实体，
                                        //   由 databus.twinBatteries 驱动、节拍住在 consts.js 的 TWIN_CD，所以本类里没有它的 dt 行
    this.pickupRange = XP_PICKUP_RANGE; // 经验磁吸半径（像素），宝石在这个距离内往角色飞（宝箱：经验拾取范围，每次 +XP_PICKUP_STEP）
    this.burnBullets = 0;               // 燃烧子弹层数（宝箱：燃烧子弹+1）：子弹命中挂 5 秒燃烧，每跳跳的血 = 这个层数；节拍与单跳基数在 consts.js 的 BURN_TICK/BURN_DMG
    this.leech = 0;                     // 嗜血层数（宝箱：嗜血+1）：每次击杀有 LEECH_CHANCE 概率回这么多血。★层数加的是「一口回几血」，概率恒为 0.5%、不随层数变
    this.vial = 0;                      // 血瓶层数（宝箱：血瓶+1）：场上恒为一只瓶子，层数 = 每 VIAL_GAIN_CD 攒几滴。★节拍恒定，同燃烧/嗜血的口径
    this.vialDrops = 0;                 // 瓶内存量（滴）。★无上限，是定过的口径：夹住它等于让满血时的溢出重新变成白扔，那正是这件道具要治的病
    this.vialGainT = 0;                 // 距下一次自增的毫秒数（dt 累加，见 pumpVial）：不用 Date.now，三选一面板开着时要跟着冻住
    this.vialOutT = 0;                  // 距下一次输送的毫秒数：只在「残血且瓶里有货」时才累加，其余时候钉回 0（否则一残血就连吐几滴）
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

    // 海火核心的触发冷却：和上面减速、下面血瓶同一把 dt 尺，所以三选一面板开着时一起冻住
    this.laserCrossT = Math.max(0, this.laserCrossT - dt * 1000);

    // 主动键那层膜的两个计时器同样按 dt 走：面板开着时「这 3 秒」必须跟着停，
    // 否则一次选卡就能把保护整段烧完，玩家等于被面板偷走一次技能
    this.membraneT = Math.max(0, this.membraneT - dt * 1000);
    this.membraneCdT = Math.max(0, this.membraneCdT - dt * 1000);

    // 中毒：同样的 dt 时钟，但走自己这条路结算——不碰 takeDamage，所以不吃受击无敌帧、也不被护盾挡。
    // 无敌帧是「一次撞击」的限流器，护盾挡的是「一次攻击」，毒素既不被撞完也不该被盾白吞
    if (this.poisonLeft > 0) {
      this.poisonLeft = Math.max(0, this.poisonLeft - dt * 1000);
      this.poisonTickLeft -= dt * 1000;
      if (this.poisonTickLeft <= 0) {
        this.poisonTickLeft += POISON_TICK;
        // ★中毒跳是三条掉血通道里的第三条，所以膜也要在这里过一遍：
        //   2026-10-24 拍板「三条全盖」，漏掉这一条的话「按膜蹚赤潮」这条合法解就是假的
        this.hp -= this.membraneOn() ? membraneDamage(this.poisonDamage) : this.poisonDamage;
      }
      if (this.poisonLeft === 0) {
        this.poisonDamage = 0;
        this.poisonTickLeft = 0;
      }
    }

    this.pumpVial(dt); // 和上面中毒同一条 dt 尺：面板开着时（main.js 跳过 update）两条一起冻住

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

  takeDamage(amount, now, databus) {
    if (now < this.invincibleUntil) return;
    this.invincibleUntil = now + PLAYER_INVINCIBLE;
    if (this.shield > 0) {
      this.shield--;
      this.shieldBroken++; // 记一笔：道具格要的是「拾取过几层」，破掉的不该从花名册里退场
      return;
    }
    // 先扣防御力（加法）再过膜（乘法）：顺序会改变结论，所以全项目只留这一条通路，见 consts 的 membraneDamage
    const dmg = Math.max(1, amount - this.defence);
    this.hp -= this.membraneOn() ? membraneDamage(dmg) : dmg;
    // ★膜生效期间挨的每一下仍然掉血（membraneDamage 有 Math.max(1,…) 兜底），所以海火核心的十字照旧一根根放得出来；
    //   而上面那道护盾 return 在这行之前 —— 膜不消耗护盾层，被盾挡掉的那一下也照旧不送十字
    if (settings.vibrate) wx.vibrateShort({ type: 'light' });
    this.fireLaserCross(databus);
  }

  /**
   * 主动技「薄膜」在不在身上的唯一判据：三条掉血通道（takeDamage / applyBlast / 中毒跳）都问这一句。
   * ★只看 membraneT 不看 membrane：放火那一刻两个数一起写，但「有道具」和「膜正开着」是两件事，
   *   分开判才写得出「按下去但没生效」这种空按（见 activateMembrane 的返回值）
   */
  membraneOn() {
    return this.membrane > 0 && this.membraneT > 0;
  }

  /**
   * 右下角主动键唯一的放火口（main.js 的触点、预览台的操作台按钮都从这里过，不许有第二条路）。
   * 返回 false 时一个数都不动 —— 那一下是空按，HUD 上不该有任何代价，也不该把冷却顶满
   */
  activateMembrane() {
    if (this.membrane <= 0 || this.membraneT > 0 || this.membraneCdT > 0) return false;
    this.membraneT = MEMBRANE_HOLD;
    this.membraneCdT = MEMBRANE_CD; // ★放火那一刻就顶满：真实周期是 40 秒而不是 43 秒
    return true;
  }

  /**
   * 海火核心（Boss 掉落道具）唯一的触发口：只有「真的掉血了」才放十字。
   * ★三条不触发的路各有理由，别顺手合并：
   *   无敌帧压掉的那一下没受伤、护盾挡掉的那一下也没受伤 —— 护盾和这件都是「活下来」的道具，
   *   但一个管挡、一个管反击，挡掉的那一下不该顺便送一次输出（否则两件叠起来就是"挨打白赚"）；
   *   applyBlast（双子自溶爆、囊泡溶血素）和中毒跳血那两条根本不走 takeDamage，所以也不触发 ——
   *   那两条是「不吃无敌帧」的通道，接上触发等于站进毒里白嫖常驻十字，
   *   把这件道具从「挨打的反击」翻成「越中毒越强」的反向激励，而正确玩法（躲开每一刀）反而拿最少输出
   */
  fireLaserCross(databus) {
    if (this.laserCross <= 0 || this.laserCrossT > 0 || !databus) return;
    this.laserCrossT = LASER_CROSS_CD;
    const cross = databus.pool.getItemByClass('laserCross', LaserCross);
    // 起始朝向取角色当前朝向（它本来就是上一发子弹对准目标算出来的），所以这根十字是从"你正盯着的那边"转出去的。
    // ★不在这里索敌：朝向只在触发那一刻定一次，之后按固定角速度转，同「子弹不得追踪/拐弯」那条规则
    cross.x = this.x;
    cross.y = this.y;
    cross.init(this.laserCross, this.attack, Math.atan2(this.dirY, this.dirX));
    databus.laserCrosses.push(cross);
  }

  /**
   * 爆发伤害（双子 Boss 的 LytA 自溶爆、囊泡落地的溶血素）：独立于 takeDamage 的第二条结算通道。
   * ★为什么不并进 takeDamage：那 1500ms 受击无敌帧是「一次撞击」的限流器，而这两下必然撞在贴身接触
   *   刚刚刷新的那帧上（自爆的前提就是已经贴脸）。照赤潮池当年的旧账（config.js 的 poolDamage 注释），
   *   走 takeDamage 实测整场只结算到个位数，「铺一场赤潮封走位」在数据上等于没放。
   * ★为什么不消耗护盾：护盾挡的是「打到我身上的那一下」，一片泼过来的溶血素不是一下，和 applyPoison 同一条理由
   * ★为什么不复用 applyPoison：applyPoison 的「重叠只取最强一片、时长取最长」会让爆发那一下（现 18，
   *   见 config.js 的 burstDamage）覆盖住赤潮那 2 点，玩家离开毒池后还在按 18 跳——那是把两笔账记成一笔
   * ★★调用方口径：这条通道没有无敌帧那种限流器，伤害频率只由【放它的那个人】的冷却决定，
   *   所以数值必须自己按「每秒上限」算再除以冷却，不能照 takeDamage 的量级给。
   *   双子初值 18 时操作台实测站桩 3.27 秒死亡（40 血），就是这个数没按这条算出来的代价
   */
  applyBlast(amount) {
    // 第二条不吃无敌帧的通道同样要过膜：这一条才是「按下去能活过最坏三秒」里最狠的那部分
    // （双子自溶爆 18 一下、不吃无敌帧），漏掉它的话膜在最需要的那一下上等于不存在
    const dmg = Math.max(1, amount - this.defence);
    this.hp -= this.membraneOn() ? membraneDamage(dmg) : dmg;
    if (settings.vibrate) wx.vibrateShort({ type: 'heavy' });
  }

  // 回血：唯一的一处血包入口（血块，见 npc/bloodclot.js；嗜血，见下面 onKill），别让掉落方直接改 this.hp。
  // 返回实际回复量而不是布尔——差 1 血时捡到一颗回 2 的血块，只该算回复了 1
  // ★溢出这一段是血瓶唯一的进货口：两条来源都从这里过，所以「存几滴」只有一条公式，不会两边算歪。
  //   this.vial > 0 必须显式判：没这件道具时浪费照旧吞掉（10-11 定的口径），也防住往 undefined 上 += 造出 NaN 存量
  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.hp + amount, this.maxHp);
    const healed = this.hp - before;
    const waste = amount - healed;
    if (waste > 0 && this.vial > 0) this.vialDrops += waste;
    return healed;
  }

  // 嗜血：击杀结算点（main.js 每确认一次击杀调一次）。返回实际回复量，0 表示这一杀什么都没回
  // ★满血照掷是定过的口径：不判 hp < maxHp，也不留「存着下次再触发」的缓冲。
  //   这一下到底进不进瓶由 heal() 判（10-11 加了血瓶），onKill 这边不该多知道这件事
  //   唯一的短路是层数为 0 —— 那不是「满血浪费」，是这件道具还没拾取到，掷了连回多少都没有
  onKill(databus) {
    if (this.leech <= 0) return 0;
    if (Math.random() >= LEECH_CHANCE) return 0;
    const healed = this.heal(this.leech);
    if (healed > 0) databus.addDamageText(this.x, this.y - this.radius, `+${healed}`, false, UI.blood);
    return healed;
  }

  // 血瓶（金匣第 9 种）两条节拍都在这儿，实体 js/player/bloodVial.js 只负责把存量画出来：
  // 计时留在 player 身上才吃得到 main.js 那道 isPaused 门（面板开着时整条 update 被跳过），
  // 挂在实体上就等于两套时钟，三选一期间瓶子照走、身上的不走的对不上账
  pumpVial(dt) {
    if (this.vial <= 0) return; // 没这层道具就整条短路：不空转两个累加器，也不会「将来捡到瓶子时瞬间吐出攒了几分钟的滴」
    const ms = dt * 1000;

    // 自增：满不满血都在攒，这是玩家口中的那句「每 30 秒血瓶 +1」，层数买的是每跳几滴
    this.vialGainT += ms;
    if (this.vialGainT >= VIAL_GAIN_CD) {
      this.vialGainT -= VIAL_GAIN_CD; // 是减不是清零：掉帧攒出几秒时不许把余数扔掉，否则慢帧里这条 30 秒会越拖越长
      this.vialDrops += this.vial;
    }

    // 输送只在「身上有缺口 且 瓶里有货」时走。★两个条件任一不成立都必须把 vialOutT 钉回 0：
    //   累加排在这道门之后，所以满血期间它不会自己长，能留下的只有「挨打攒到一半的那几百毫秒」——
    //   不清零的话下次残血第一口会提前冒出（最多提前整整一秒），玩家数的「一秒一口」就成了错觉
    const full = this.hp >= this.maxHp;
    const empty = this.vialDrops <= 0;
    if (full || empty) {
      this.vialOutT = 0;
      return;
    }

    this.vialOutT += ms;
    if (this.vialOutT < VIAL_OUT_CD) return;
    this.vialOutT -= VIAL_OUT_CD;
    const out = Math.min(VIAL_OUT, this.vialDrops, this.maxHp - this.hp);
    this.vialDrops -= out;
    this.heal(out); // 走 heal()：out 已按缺口夹过，heal 里的 waste 恒为 0，不会自己攒回自己
  }

  // 一次只结一级：面板关掉时 upgrade.js 会再调 addXp(0) 把溢出经验接着结算成下一张卡。
  // 不要改成 while 循环——那等于一颗宝石白送好几次升级而不给对应的卡
  addXp(amount, databus) {
    this.xp += amount;
    const needed = xpForLevel(this.level);
    if (this.xp >= needed) {
      this.xp -= needed;
      this.level++;
      this.applyLevelBonus(databus); // held 由它自己声明为 true：这笔成长属于紧接着打开的那扇面板
      databus.isPaused = true;
      databus.upgradeScreen.show(databus);
    }
  }

  // 「一包加成」的统一入口：升级自动成长、三选一选卡、Boss 掉落道具（chestGrant.js 的 core_cmv）
  // 共用这一套四舍五入，也共用「落完属性就弹 +x」这一个触发口——谁加的属性谁负责弹字，
  // 不会出现「属性涨了没动画」或「弹了字没涨属性」的断链
  // ★保留两位小数不是显示层的事：0.1/0.02 这类值连加会攒出 1.9000000000000001 的浮点尾数，
  //   面板显示前那次 Math.round 只是遮症状，属性本身还是脏的（暴击率参与掷骰时会带着尾数走）
  // key 必须与 Player 的属性名完全一致，否则写入静默落到一个 undefined 属性上——headless 的注册面扫描专治这个
  // held 由调用方声明，不在这里猜 upgradeScreen.visible：同一帧里「宝石经验升级开面板」可能先于
  //   「踩到匣子」发生，靠猜会把核心那笔飘字误挂起到下一扇面板去。规则很简单——
  //   面板会话内发生的两笔（升级成长、选卡）传 true，场面上拾取的核心传 false
  applyBoost(bonus, databus, held) {
    for (const key of Object.keys(bonus)) {
      this[key] = Math.round((this[key] + bonus[key]) * 100) / 100;
    }
    if (databus && databus.hud) databus.hud.popStats(bonus, held);
  }

  // 升级自动全属性成长，在三选一之外额外叠加。held 恒 true：addXp 紧接着就开面板，这笔字必须等关面板再弹
  applyLevelBonus(databus) {
    this.applyBoost(LEVEL_UP_BONUS, databus, true);
  }

  draw(ctx) {
    const now = Date.now();
    const blink = now < this.invincibleUntil && Math.floor(now / 80) % 2;
    // 贴图按「枪口朝右（+x）」出图，这里旋转到索敌方向，人物就永远举枪对准目标
    const angle = Math.atan2(this.dirY, this.dirX);

    // 主动技「薄膜」：画在角色之前，所以人是浮在膜上的（膜是「套在外面的一层」，不是身上的贴图）
    // ★刻意不照护盾那样画成「贴身一根圈」：护盾那圈在 radius+5，膜再画一圈就会读成同一个东西。
    //   这里走 Boss 自己那套语言（bossFilm.drawFilm）：有面积的平涂 + 一圈描边，不用渐变也不用 shadowBlur
    if (this.membraneOn()) {
      const restP = this.membraneT / MEMBRANE_HOLD;   // 剩余比例：dt 时钟的派生量，面板开着时自然停住
      const R = this.radius + 12;                     // 28：和护盾的 21 拉开一档，两圈同帧也读得出是两层
      const spin = (1 - restP) * 0.9;                 // 慢转：相位由剩余时长推出来，不用构造期随机数也不碰墙上时钟
      ctx.save();
      ctx.globalAlpha = 0.26;                         // 概念页实测 0.16 在 1× 上几乎只剩描边起作用，平涂那层要给足才读得出「有面积」
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const r = R * (1 + 0.13 * Math.cos(5 * a + spin - Math.PI / 2)); // 五叶软边：膜的轮廓不是正圆，才读得出是「一层活的东西」
        const x = this.x + Math.cos(a) * r;
        const y = this.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = UI.membrane;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = UI.membrane;
      ctx.stroke();
      if (restP < 0.5) { // 剩余时长短弧：只在后半程出现、越接近结束越长（照 bomber.js:137-151 那条口径）
        ctx.beginPath();
        ctx.strokeStyle = UI.cream;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.arc(this.x, this.y, R + 4, Math.PI / 2, Math.PI / 2 + (Math.PI / 2) * ((0.5 - restP) * 2));
        ctx.stroke();
      }
      ctx.restore();
    }

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
