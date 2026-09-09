import Pool from './base/pool';
import Companion from './player/companion';

let instance;

export default class DataBus {
  constructor() {
    if (instance) return instance;
    instance = this;
    this.reset();
  }

  reset() {
    this.pool = new Pool();
    this.player = null;
    this.enemys = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.xpGems = [];
    this.chests = [];
    this.companions = [];
    this.frame = 0;
    this.isGameOver = false;
    this.isPaused = false;
    this.camera = null;
    this.arena = null;
    this.joystick = null;
    this.spawner = null;
    this.hud = null;
    this.upgradeScreen = null;
  }

  update(dt) {
    for (const b of this.bullets) b.update(dt, this);
    for (const b of this.enemyBullets) b.update(dt, this);
    for (const e of this.enemys) e.update(dt, this);
    for (const g of this.xpGems) g.update(dt, this);
    for (const c of this.chests) c.update(dt, this);
    if (this.player) {
      while (this.companions.length < this.player.companions) {
        const comp = new Companion(this.companions.length);
        comp.x = this.player.x; // 在角色脚下出生，避免从地图角落飞过来
        comp.y = this.player.y;
        this.companions.push(comp);
      }
      for (const comp of this.companions) comp.update(dt, this);
      this.player.update(dt, this);
    }
  }

  removeEnemy(index) {
    this.enemys.splice(index, 1);
  }

  removeBullet(index) {
    this.bullets.splice(index, 1);
  }

  removeEnemyBullet(index) {
    this.enemyBullets.splice(index, 1);
  }

  removeXpGem(index) {
    this.xpGems.splice(index, 1);
  }

  removeChest(index) {
    this.chests.splice(index, 1);
  }
}
