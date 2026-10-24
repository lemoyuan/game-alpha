import Enemy from './enemy';
import Boss from './boss';
import BossSeaFire from './bossSeaFire';
import BossFilm from './bossFilm';
import BossTwins from './bossTwins';
import {
  MONSTER_TYPES, FAST_UNLOCK_TIME, TANK_UNLOCK_TIME, RANGED_UNLOCK_TIME,
  hpScaleAt, MUTANT_CHANCE,
  CHEST_ROLL_INTERVAL, CHEST_FIRST_ROLL, CHEST_PITY, chestChance,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_RAMP, SPAWN_INTERVAL_MIN,
  BOSS_SPAWN_INTERVAL_MULT,
  BOSS_SLOTS, BOSS_PAIR_MULT, BOSS_RESPAWN_GAP, buildBossOrder,
} from './config';
import { clampToCoast } from '../../arena/coast';
import { markEncountered } from '../../storage';

// 类型 → Boss 类。映射只能放这里，不能放进 config：boss.js 会 import config，
// config 反过来 import 类就成环，ES Module 下会解析出 undefined class
// ★下面那句 `|| Boss` 兜底是这套结构里最贵的一处静默失效：漏登记不会报错，
//   只会「用新 Boss 的数值跑毒王的冲锋」——血条、掉落、图鉴、刷怪降速全部正常。
//   所以加一只 Boss 必须同时在这里加一行，config 名册（BOSS_SCHEDULE）里那一行才算接上
const BOSS_CLASS = { boss1: Boss, boss2: BossSeaFire, boss3: BossFilm, boss4: BossTwins };

// 刷怪控制器：普通怪随时间加密，宝箱怪按幸运值的概率刷新，Boss 定时出场
export default class Spawner {
  constructor() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestRollT = 0;      // 距上次「掷骰」累计的毫秒，满 CHEST_ROLL_INTERVAL 掷一次
    this.chestSinceLast = 0;  // 距上次真正刷出金匣累计的毫秒 —— 保底计数器，满 CHEST_PITY 强制刷一只
    // 本局的 Boss 出场顺序：身份名册洗一遍。★谁在第几场 = 这里，第几场多硬 = BOSS_SLOTS，两张表各管一件事
    this.bossOrder = buildBossOrder();
    this.bossIndex = 0; // 走到第几【槽】：bossOrder 和 BOSS_SLOTS 都用它当下标，出场即自增
    // 场上没有 Boss 时累计的毫秒数：Boss 之间的冷却。
    // ★初值是 GAP 而不是 0：这条冷却说的是「上一只死亡后还要缓多久」，开局并没有上一只。
    //   留 0 就等于让第 1 槽也空攒一遍冷却，而 GAP 现在和 BOSS_FIRST_SPAWN_TIME 都是 120 秒，
    //   第 1 槽会不会迟到只剩「这两条恰好相等」这个巧合，谁把其中一个动一下就静默失灵
    this.bossRest = BOSS_RESPAWN_GAP;
  }

  reset() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestRollT = 0;
    this.chestSinceLast = 0;
    this.bossOrder = buildBossOrder(); // ★每局重洗：不重洗就等于第二局沿用第一局的顺序，「每局随机」退化成「全局固定」
    this.bossIndex = 0;
    this.bossRest = BOSS_RESPAWN_GAP; // 同上：新开局没有「上一只」要等，第 1 槽只看自己那条 time
  }

  update(dt, databus) {
    this.elapsed += dt;
    this.timer += dt * 1000;

    // 普通怪刷新间隔：开局3秒1只，随时间逐渐压缩到下限0.5秒
    this.interval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - this.elapsed * SPAWN_INTERVAL_RAMP);

    // Boss 存活期间普通刷怪降速不降停：间隔乘 BOSS_SPAWN_INTERVAL_MULT（2 = 密度减半）。
    // 不能停刷——Boss 的血按槽位给到几千上万，一场要两分钟起步，停刷等于这段时间全图零新怪、玩家 build 成长暂停
    const bossAlive = databus.enemys.some((e) => e.isBoss);
    const gate = this.interval * (bossAlive ? BOSS_SPAWN_INTERVAL_MULT : 1);
    if (this.timer >= gate) {
      this.timer = 0;
      this.spawn(databus);
    }

    // 宝箱怪：按幸运概率刷新，每秒掷一次骰，60 秒没中就强制刷一只（保底）
    // ★掷骰挂在自己那条 1 秒计时器上，绝不挂到上面的普通刷怪事件里：
    //   普通怪间隔会从 2500 毫秒压到 450，按事件掷骰等于幸运随时间自动变强 4.4 倍，概率曲线当场作废
    // ★也绝不放进 Boss 降速门：Boss 战期间密度会砍一半，而那恰恰是最需要金匣兑现的时段，
    //   等于让幸运在整局最关键的 30 秒里失效
    if (this.elapsed > CHEST_FIRST_ROLL) {
      this.chestRollT += dt * 1000;
      this.chestSinceLast += dt * 1000;
      const p = chestChance(databus.player ? databus.player.luck : 0);
      while (this.chestRollT >= CHEST_ROLL_INTERVAL) {
        this.chestRollT -= CHEST_ROLL_INTERVAL; // ★减不是清零：一帧跨两次掷骰时不能白丢一次
        if (Math.random() < p || this.chestSinceLast >= CHEST_PITY) {
          this.chestSinceLast = 0;
          this.spawn(databus, 'chest');
          break; // 已经刷出，本帧剩下的骰没有意义
        }
      }
    }

    // Boss 槽位逐格走：到点 + 场上没 Boss 且已冷却够久才进下一格
    // ★这里读的是【两张表的下标同一个数】：bossOrder 回答"这一场是谁"，BOSS_SLOTS 回答"这一场多硬"。
    //   两者都由 bossIndex 定位，所以顺序怎么洗都不影响节奏，节奏怎么改都不影响谁拿到哪一份血
    // bossRest 少了不行：玩家提前秒杀 Boss 时 elapsed 早已越过下一槽的 time，
    // 没有这道冷却，下一只会在尸体消失的同一帧贴脸刷出来
    const slot = BOSS_SLOTS[this.bossIndex];
    const entry = this.bossOrder[this.bossIndex];
    this.bossRest = bossAlive ? 0 : this.bossRest + dt * 1000;
    if (entry && slot && this.bossRest > BOSS_RESPAWN_GAP && this.elapsed > slot.time) {
      this.bossIndex++;
      this.spawnBoss(databus, entry, slot);
    }
  }

  // 在玩家周围 minDist~minDist+100px 随机方向刷出，并夹回海岸线内
  placeAroundPlayer(databus, radius, minDist) {
    const player = databus.player;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * 100;
    const pos = {
      x: player.x + Math.cos(angle) * dist,
      y: player.y + Math.sin(angle) * dist,
    };
    clampToCoast(pos, radius + 10);
    return pos;
  }

  spawnBoss(databus, entry = this.bossOrder[0], slot = BOSS_SLOTS[0]) {
    if (!databus.player) return;
    const config = MONSTER_TYPES[entry.type];
    const BossClass = BOSS_CLASS[entry.type] || Boss;
    const count = entry.pair || 1;
    // 成对出场：每只【各】拿槽位量的 BOSS_PAIR_MULT（2026-10-24 口径：一对 = 一只半），不是整槽也不是平分
    const each = count > 1 ? Math.round(slot.hp * BOSS_PAIR_MULT) : slot.hp;
    const eachXp = count > 1 ? Math.round(slot.xp * BOSS_PAIR_MULT) : slot.xp;
    const centre = this.placeAroundPlayer(databus, config.radius, 400);
    const group = [];
    for (let i = 0; i < count; i++) {
      // 成对出场：两只并排落在同一个落点两侧（双球菌态就是裂殖之后不分开，镜下像一副眼镜）。
      // ★pairSpan 是【中心距】，同一个数还被 bossTwins.separateFromTwin 拿去当场上维持的下限——
      //   只在这里调会出现「出生很开、追两秒就挤成一坨」（2026-10-10 实测过这一坑）
      const span = config.pairSpan || config.radius * 2 + 6;
      const at = { x: centre.x + (i - (count - 1) / 2) * span, y: centre.y };
      clampToCoast(at, config.radius + 10);
      const boss = new BossClass(entry.type, config);
      boss.init(at.x, at.y);
      // 血量与经验归【槽位】，本局谁走到第几场由 bossOrder 决定，所以这里必须在 init 之后覆盖到实例上：
      // Enemy.init 会把 hp 复位成 maxHp（对象池约定），写在 init 前等于没写；同下面普通怪那条 hpScaleAt 的写法。
      // ★绝不写回 MONSTER_TYPES —— 那张表是模块单例、没有任何 reset() 重建它，写进去会污染第二局，而图鉴读的就是它
      boss.maxHp = each;
      boss.hp = each;
      boss.xpValue = eachXp;
      // ★mirror / twinIndex 必须在 init 之后写：Enemy.init 会复位 mirror（对象池约定），写反了就是"永远不镜像"
      if (count > 1) {
        boss.mirror = i % 2 === 1;
        boss.twinIndex = i;
      }
      group.push(boss);
      databus.enemys.push(boss);
    }
    // 跨实体引用：全项目没有事件钩子，"兄弟死了"只能靠活引用轮询 isDead（见 bossTwins.update）。
    // 只处理两只：pair 一旦上 3，这条边就得从"一个引用"改成"一个列表"，那时再改，不在这里预埋
    if (group.length === 2) {
      group[0].twin = group[1];
      group[1].twin = group[0];
    }
    markEncountered(entry.type); // 遭遇即解锁图鉴，无需击杀；成对也只解锁这一条
    if (databus.hud) databus.hud.showToast(entry.toast, 2500);
  }

  spawn(databus, forceType) {
    const player = databus.player;
    if (!player) return;

    let type = forceType;
    if (!type) {
      const types = ['basic'];
      if (this.elapsed > FAST_UNLOCK_TIME) types.push('fast');
      if (this.elapsed > TANK_UNLOCK_TIME) types.push('tank');
      if (this.elapsed > RANGED_UNLOCK_TIME) types.push('ranged');
      // 按权重随机选怪：weight 越大出现越频繁
      let total = 0;
      for (const t of types) total += MONSTER_TYPES[t].weight;
      let r = Math.random() * total;
      for (const t of types) {
        r -= MONSTER_TYPES[t].weight;
        if (r <= 0) {
          type = t;
          break;
        }
      }
      if (!type) type = types[types.length - 1]; // 浮点兜底
    }
    const config = MONSTER_TYPES[type];
    markEncountered(type); // 遭遇即解锁图鉴（首次会写一次本地存储）

    const pos = this.placeAroundPlayer(databus, config.radius, 400);

    const enemy = new Enemy(type, config);
    enemy.init(pos.x, pos.y);

    // 突变型：只给刺头掷骰，type 仍然是 'basic'（数值、图鉴、HUD 计数全不动，它只多一个掉落）。
    // ★必须在 init 之后：init 会把 mutant 复位（对象池约定），放前面等于刚刷出来就被自己擦掉。
    //   forceType='chest' 走不到这里（type 不是 basic），Boss 走 spawnBoss、膜王菌群自己 new，都不经过这一行
    if (type === 'basic' && Math.random() < MUTANT_CHANCE) enemy.mutant = true;

    // 只有普通刷怪池吃这条时间曲线：Boss 走下面的 spawnBoss、膜王菌群自己 new，
    // 都不经过这里，所以它们那些按实测反解出来的血量不会被后期涨血扫坏
    const scale = hpScaleAt(this.elapsed);
    if (scale > 1) {
      enemy.hp = Math.floor(enemy.hp * scale);
      enemy.maxHp = enemy.hp;
    }

    databus.enemys.push(enemy);
  }
}
