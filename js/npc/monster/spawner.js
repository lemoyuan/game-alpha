import Enemy from './enemy';
import {
  MONSTER_TYPES, FAST_UNLOCK_TIME, TANK_UNLOCK_TIME, RANGED_UNLOCK_TIME,
  HP_SCALE_TIME, HP_SCALE_MULT,
  CHEST_SPAWN_INTERVAL, CHEST_FIRST_SPAWN,
  SPAWN_INTERVAL_START, SPAWN_INTERVAL_RAMP, SPAWN_INTERVAL_MIN,
} from './config';
import { ARENA_W, ARENA_H } from '../../consts';

// 刷怪控制器：普通怪随时间加密，宝箱怪按固定间隔出现
export default class Spawner {
  constructor() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestTimer = 0;
  }

  reset() {
    this.timer = 0;
    this.interval = SPAWN_INTERVAL_START;
    this.elapsed = 0;
    this.chestTimer = 0;
  }

  update(dt, databus) {
    this.elapsed += dt;
    this.timer += dt * 1000;
    this.chestTimer += dt * 1000;

    // 普通怪刷新间隔：开局3秒1只，随时间逐渐压缩到下限0.5秒
    this.interval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - this.elapsed * SPAWN_INTERVAL_RAMP);

    if (this.timer >= this.interval) {
      this.timer = 0;
      this.spawn(databus);
    }

    if (this.elapsed > CHEST_FIRST_SPAWN && this.chestTimer >= CHEST_SPAWN_INTERVAL) {
      this.chestTimer = 0;
      this.spawn(databus, 'chest');
    }
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

    // 在玩家周围 400~500px 随机方向刷出
    const angle = Math.random() * Math.PI * 2;
    const dist = 400 + Math.random() * 100;
    let x = player.x + Math.cos(angle) * dist;
    let y = player.y + Math.sin(angle) * dist;

    x = Math.max(config.radius + 10, Math.min(ARENA_W - config.radius - 10, x));
    y = Math.max(config.radius + 10, Math.min(ARENA_H - config.radius - 10, y));

    const enemy = new Enemy(type, config);
    enemy.init(x, y);

    if (this.elapsed > HP_SCALE_TIME) {
      enemy.hp = Math.floor(enemy.hp * HP_SCALE_MULT);
      enemy.maxHp = enemy.hp;
    }

    databus.enemys.push(enemy);
  }
}
