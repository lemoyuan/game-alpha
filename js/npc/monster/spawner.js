import Enemy from './enemy';
import Boss from './boss';
import BossSeaFire from './bossSeaFire';
import BossFilm from './bossFilm';
import {
  MONSTER_TYPES, FAST_UNLOCK_TIME, TANK_UNLOCK_TIME, RANGED_UNLOCK_TIME,
  HP_SCALE_TIME, HP_SCALE_MULT,
  CHEST_SPAWN_INTERVAL, CHEST_FIRST_SPAWN,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_RAMP, SPAWN_INTERVAL_MIN,
  BOSS_SPAWN_INTERVAL_MULT,
  BOSS_SCHEDULE, BOSS_RESPAWN_GAP,
} from './config';
import { clampToCoast } from '../../arena/coast';
import { markEncountered } from '../../storage';

// 类型 → Boss 类。映射只能放这里，不能放进 config：boss.js 会 import config，
// config 反过来 import 类就成环，ES Module 下会解析出 undefined class
const BOSS_CLASS = { boss1: Boss, boss2: BossSeaFire, boss3: BossFilm };

// 刷怪控制器：普通怪随时间加密，宝箱怪按固定间隔出现，Boss 定时出场
export default class Spawner {
  constructor() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestTimer = 0;
    this.bossIndex = 0; // BOSS_SCHEDULE 读到第几条，出场即自增
    this.bossRest = 0;  // 场上没有 Boss 时累计的毫秒数：Boss 之间的冷却
  }

  reset() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestTimer = 0;
    this.bossIndex = 0;
    this.bossRest = 0;
  }

  update(dt, databus) {
    this.elapsed += dt;
    this.timer += dt * 1000;
    this.chestTimer += dt * 1000;

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

    if (this.elapsed > CHEST_FIRST_SPAWN && this.chestTimer >= CHEST_SPAWN_INTERVAL) {
      this.chestTimer = 0;
      this.spawn(databus, 'chest');
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

    if (this.elapsed > HP_SCALE_TIME) {
      enemy.hp = Math.floor(enemy.hp * HP_SCALE_MULT);
      enemy.maxHp = enemy.hp;
    }

    databus.enemys.push(enemy);
  }
}
