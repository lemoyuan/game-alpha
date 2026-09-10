import Pool from './base/pool';
import Companion from './player/companion';
import DamageText from './fx/damageText';

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
    this.damageTexts = [];
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
    // 飘字先更新：本帧子弹命中新生成的飘字不会被重复推进
    for (const t of this.damageTexts) t.update(dt, this);
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

  // 伤害飘字：子弹命中时调用，isCrit 决定黄色高亮+放大
  addDamageText(x, y, damage, isCrit) {
    const text = this.pool.getItemByClass('damageText', DamageText);
    text.init(x, y, damage, isCrit);
    this.damageTexts.push(text);
  }

  removeDamageText(index) {
    this.damageTexts.splice(index, 1);
  }
}
