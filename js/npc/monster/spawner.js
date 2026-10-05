import Enemy from './enemy';
import Boss from './boss';
import BossSeaFire from './bossSeaFire';
import BossFilm from './bossFilm';
import {
  MONSTER_TYPES, FAST_UNLOCK_TIME, TANK_UNLOCK_TIME, RANGED_UNLOCK_TIME,
  hpScaleAt, MUTANT_CHANCE,
  CHEST_ROLL_INTERVAL, CHEST_FIRST_ROLL, CHEST_PITY, chestChance,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_RAMP, SPAWN_INTERVAL_MIN,
  BOSS_SPAWN_INTERVAL_MULT,
  BOSS_SCHEDULE, BOSS_RESPAWN_GAP,
} from './config';
import { clampToCoast } from '../../arena/coast';
import { markEncountered } from '../../storage';

// 类型 → Boss 类。映射只能放这里，不能放进 config：boss.js 会 import config，
// config 反过来 import 类就成环，ES Module 下会解析出 undefined class
const BOSS_CLASS = { boss1: Boss, boss2: BossSeaFire, boss3: BossFilm };

// 刷怪控制器：普通怪随时间加密，宝箱怪按幸运值的概率刷新，Boss 定时出场
export default class Spawner {
  constructor() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestRollT = 0;      // 距上次「掷骰」累计的毫秒，满 CHEST_ROLL_INTERVAL 掷一次
    this.chestSinceLast = 0;  // 距上次真正刷出金匣累计的毫秒 —— 保底计数器，满 CHEST_PITY 强制刷一只
    this.bossIndex = 0; // BOSS_SCHEDULE 读到第几条，出场即自增
    // 场上没有 Boss 时累计的毫秒数：Boss 之间的冷却。
    // ★初值是 GAP 而不是 0：这条冷却说的是「上一只死亡后还要缓多久」，开局并没有上一只。
    //   留 0 就等于让一号 Boss 也空攒一遍冷却，而 GAP 现在和 BOSS_FIRST_SPAWN_TIME 都是 120 秒，
    //   一号 Boss 会不会迟到只剩「这两条恰好相等」这个巧合，谁把其中一个动一下就静默失灵
    this.bossRest = BOSS_RESPAWN_GAP;
  }

  reset() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestRollT = 0;
    this.chestSinceLast = 0;
    this.bossIndex = 0;
    this.bossRest = BOSS_RESPAWN_GAP; // 同上：新开局没有「上一只」要等，一号 Boss 只看自己的 time
  }

  update(dt, databus) {
    this.elapsed += dt;
    this.timer += dt * 1000;

    // 普通怪刷新间隔：开局3秒1只，随时间逐渐压缩到下限0.5秒
    this.interval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - this.elapsed * SPAWN_INTERVAL_RAMP);

    // Boss 存活期间普通刷怪降速不降停：间隔乘 BOSS_SPAWN_INTERVAL_MULT（2 = 密度减半）。
    // 不能停刷——Boss 血量 ×10 后一场要两分钟起步，停刷等于这段时间全图零新怪、玩家 build 成长暂停
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

    // Boss 出场表逐条走：到点 + 场上没 Boss 且已冷却够久才刷下一只
    // bossRest 少了不行：玩家提前秒杀 Boss 时 elapsed 早已越过下一个出场时间，
    // 没有这道冷却，海火会在毒王尸体消失的同一帧贴脸刷出来
    const next = BOSS_SCHEDULE[this.bossIndex];
    this.bossRest = bossAlive ? 0 : this.bossRest + dt * 1000;
    if (next && this.bossRest > BOSS_RESPAWN_GAP && this.elapsed > next.time) {
      this.bossIndex++;
      this.spawnBoss(databus, next);
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

  spawnBoss(databus, entry = BOSS_SCHEDULE[0]) {
    if (!databus.player) return;
    const config = MONSTER_TYPES[entry.type];
    const BossClass = BOSS_CLASS[entry.type] || Boss;
    const pos = this.placeAroundPlayer(databus, config.radius, 400);
    const boss = new BossClass(entry.type, config);
    boss.init(pos.x, pos.y);
    databus.enemys.push(boss);
    markEncountered(entry.type); // 遭遇即解锁图鉴，无需击杀
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
