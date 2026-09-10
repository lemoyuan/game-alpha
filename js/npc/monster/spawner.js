import Enemy from './enemy';
import Boss from './boss';
import {
  MONSTER_TYPES, FAST_UNLOCK_TIME, TANK_UNLOCK_TIME, RANGED_UNLOCK_TIME,
  HP_SCALE_TIME, HP_SCALE_MULT,
  CHEST_SPAWN_INTERVAL, CHEST_FIRST_SPAWN,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_RAMP, SPAWN_INTERVAL_MIN,
  BOSS_FIRST_SPAWN_TIME,
} from './config';
import { ARENA_W, ARENA_H } from '../../consts';

// 刷怪控制器：普通怪随时间加密，宝箱怪按固定间隔出现，Boss 定时出场
export default class Spawner {
  constructor() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestTimer = 0;
    this.bossSpawned = false;
  }

  reset() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestTimer = 0;
    this.bossSpawned = false;
  }

  update(dt, databus) {
    this.elapsed += dt;
    this.timer += dt * 1000;
    this.chestTimer += dt * 1000;

    // 普通怪刷新间隔：开局3秒1只，随时间逐渐压缩到下限0.5秒
    this.interval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - this.elapsed * SPAWN_INTERVAL_RAMP);

    // Boss 存活期间停止刷新普通小怪（Boss 自己召唤的小怪除外）
    // Boss 死亡后从 enemys 中移除，下面的判定自动恢复刷新；计时清零避免击杀瞬间立刻冒出一只
    const bossAlive = databus.enemys.some((e) => e.isBoss);
    if (bossAlive) {
      this.timer = 0;
    } else if (this.timer >= this.interval) {
      this.timer = 0;
      this.spawn(databus);
    }

    if (this.elapsed > CHEST_FIRST_SPAWN && this.chestTimer >= CHEST_SPAWN_INTERVAL) {
      this.chestTimer = 0;
      this.spawn(databus, 'chest');
    }

    if (!this.bossSpawned && this.elapsed > BOSS_FIRST_SPAWN_TIME) {
      this.bossSpawned = true;
      this.spawnBoss(databus);
    }
  }

  // 在玩家周围 minDist~minDist+100px 随机方向刷出，并夹到场地内
  placeAroundPlayer(databus, radius, minDist) {
    const player = databus.player;
    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * 100;
    const x = player.x + Math.cos(angle) * dist;
    const y = player.y + Math.sin(angle) * dist;
    return {
      x: Math.max(radius + 10, Math.min(ARENA_W - radius - 10, x)),
      y: Math.max(radius + 10, Math.min(ARENA_H - radius - 10, y)),
    };
  }

  spawnBoss(databus) {
    if (!databus.player) return;
    const config = MONSTER_TYPES.boss1;
    const pos = this.placeAroundPlayer(databus, config.radius, 400);
    const boss = new Boss('boss1', config);
    boss.init(pos.x, pos.y);
    databus.enemys.push(boss);
    if (databus.hud) databus.hud.showToast('Boss 出现了！', 2500);
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
