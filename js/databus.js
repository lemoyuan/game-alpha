import Pool from './base/pool';
import Companion from './player/companion';
import DamageText from './fx/damageText';
import { settings } from './storage';

let instance;

export default class DataBus {
  constructor() {
    if (instance) return instance;
    instance = this;
    // 跨局复用的框架对象：由 Main 创建一次，reset() 不清除
    this.camera = null;
    this.arena = null;
    this.joystick = null;
    this.spawner = null;
    this.hud = null;
    this.upgradeScreen = null;
    this.homeScreen = null;
    this.reset();
  }

  reset() {
    this.pool = new Pool();
    this.screen = 'home'; // home = 停在首页/子页面，game = 一局进行中
    this.player = null;
    this.enemys = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.lasers = [];   // 海火的旋转光束：原点是活的 Boss，不进实体池以外的任何列表
    this.zones = [];    // 地面危害池（海火赤潮 / 膜王黏液）：坐标一次写定，只等寿命走完；两种实体都按 update/draw/isDestroyed 走，不再加列表
    this.xpGems = [];
    this.chests = [];
    this.companions = [];
    this.damageTexts = [];
    this.frame = 0;
    this.chestsOpened = 0; // 本局开箱数（结算写入游戏记录）
    this.isGameOver = false;
    this.isPaused = false;
  }

  update(dt) {
    // 飘字先更新：本帧子弹命中新生成的飘字不会被重复推进
    for (const t of this.damageTexts) t.update(dt, this);
    for (const b of this.bullets) b.update(dt, this);
    for (const b of this.enemyBullets) b.update(dt, this);
    for (const e of this.enemys) e.update(dt, this);
    // 必须排在 enemys 之后：光束每帧从 owner.spin 重算端点，读上一帧的自转角会让眼和光脱开
    // （1.05 弧度/秒 × 0.05 秒 = 3°，在 470px 末端差出 25px）
    for (const l of this.lasers) l.update(dt, this);
    for (const z of this.zones) z.update(dt, this);
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

  removeLaser(index) {
    this.lasers.splice(index, 1);
  }

  removeZone(index) {
    this.zones.splice(index, 1);
  }

  removeXpGem(index) {
    this.xpGems.splice(index, 1);
  }

  removeChest(index) {
    this.chests.splice(index, 1);
  }

  // 伤害飘字：子弹命中时调用，isCrit 决定黄色高亮+放大；设置项关闭时直接跳过
  addDamageText(x, y, damage, isCrit) {
    if (!settings.damageText) return;
    const text = this.pool.getItemByClass('damageText', DamageText);
    text.init(x, y, damage, isCrit);
    this.damageTexts.push(text);
  }

  removeDamageText(index) {
    this.damageTexts.splice(index, 1);
  }
}
