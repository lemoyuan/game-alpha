import Pool from './base/pool';
import Companion from './player/companion';
import Bomber from './player/bomber';
import BloodVial from './player/bloodVial';
import Turret from './player/turret';
import LaserCross from './player/laserCross';
import DamageText from './fx/damageText';
import { settings } from './storage';
import { DAMAGE_TEXT_MAX } from './consts';

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
    this.pauseScreen = null;
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
    this.clots = [];    // 血块（突变型刺头掉落）：和经验宝石同一条生命周期，落地不动、磁吸追人、collected 后由 main.js 回收
    this.chests = [];
    this.companions = [];
    this.bombers = [];    // 炸弹跟班（金匣第 7 种加成）：与 companions 同一条规矩，场上封顶一只，层数加的是每轮枚数
    this.vials = [];      // 血瓶跟随体（金匣第 9 种加成）：同样封顶一只，层数加的是每 30 秒攒几滴；它只把存量画成液面，节拍在 Player.pumpVial
    // 炮台（金匣第 10 种加成）：★不封顶，player.turrets 是几就落几座，位置本身就是这件道具的内容。
    // ★必须写在 reset() 而不是构造函数：DataBus 是单例，漏了这一行会带着上一局的几座继续开火，
    //   而新一局 player.turrets 从 0 起、生成条件永不成立，headless 又只开一局 —— 这个错一个字都不会报错
    this.turrets = [];
    // 十字激光（Boss 掉落道具「海火核心」）：角色挨一下真伤就放出一根，友方一侧，一根一根自己排在这里。
    // ★不并进上面的 this.lasers：那条数组里每一条的判定都是「打中角色」，两家共用等于让友方光束照自己、
    //   而 headless 的敌方光束断言（眼数、换向预告）会读进玩家放的那几根。和 bombs / vesicles 是同一条分家的理由
    this.laserCrosses = [];
    this.bombs = [];      // 在飞的炸弹：一枚两阶段（抛物线飞行 → 落点引爆），爆风不另开列表、画在这同一条实体上
    // 双子 Boss 在飞的囊泡：与 bombs 同形（继承 Bomb 的抛物线与爆风），但必须自己一条列表。
    // ★上面那句「不再加列表」在这里破例的原因：headless 的 thrown / booms / 「一轮几枚」三条断言
    //   口径全是「玩家自己的炸弹」，两家共用一条数组等于把道具报表读成敌我混合，而且敌方弹根本不该暴击
    this.vesicles = [];
    this.bossPets = [];   // 迷你毒王跟班（融合匣开出）：不挂 player.companions 计数，由宝箱授予直接管理
    this.bossChests = {}; // 本局 Boss 专属匣开启记录：id → 次数，HUD 右栏读它
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
    // 炸弹排在生成它的 bomber 循环之前：同上面两条子弹循环的次序，本帧扔出的那一枚下一帧才开始飞
    for (const b of this.bombs) b.update(dt, this);
    for (const v of this.vesicles) v.update(dt, this); // 次序同上面 bombs：本帧抛出的那一枚下一帧才开始飞
    for (const e of this.enemys) e.update(dt, this);
    // 燃烧跳血单独一遍，且必须挂在这里：Enemy.update 里放不下它——毒王 Boss 从不调 super.update，
    // 海火只在 chase、膜王只在 idle、菌群只在 lost 才调，写进 Enemy.update 等于燃烧在三只 Boss 身上失效
    for (const e of this.enemys) e.updateBurn(dt, this);
    // 必须排在 enemys 之后：光束每帧从 owner.spin 重算端点，读上一帧的自转角会让眼和光脱开
    // （1.05 弧度/秒 × 0.05 秒 = 3°，在 470px 末端差出 25px）
    for (const l of this.lasers) l.update(dt, this);
    for (const z of this.zones) z.update(dt, this);
    for (const g of this.xpGems) g.update(dt, this);
    for (const cl of this.clots) cl.update(dt, this);
    for (const c of this.chests) c.update(dt, this);
    if (this.player) {
      // ★封顶一只：player.companions 存的是「一次齐射几发」，不是跟班只数。
      //   按层数补实体等于把发数当只数，三层会跑出三只各自单发的跟班
      if (this.player.companions > 0 && !this.companions.length) {
        const comp = new Companion();
        comp.x = this.player.x; // 在角色脚下出生，避免从地图角落飞过来
        comp.y = this.player.y;
        this.companions.push(comp);
      }
      if (this.player.bomber > 0 && !this.bombers.length) {
        const bomber = new Bomber();
        bomber.x = this.player.x;
        bomber.y = this.player.y;
        this.bombers.push(bomber);
      }
      if (this.player.vial > 0 && !this.vials.length) {
        const vial = new BloodVial();
        vial.x = this.player.x;
        vial.y = this.player.y;
        this.vials.push(vial);
      }
      // ★形状和上面三条不一样：那是「封顶一只」，这里一层就是一整座。
      //   匣子那条裸 player.turrets += 1 不带坐标，所以落位只能在这里观察层数变化来做 ——
      //   这一帧正好是角色站在匣子上被拾取的那一刻，炮台落在脚边 28px 内
      while (this.turrets.length < this.player.turrets) {
        const t = new Turret();
        t.x = this.player.x;
        t.y = this.player.y;
        t.aim = Math.atan2(this.player.dirY, this.player.dirX);
        this.turrets.push(t);
      }
      for (const comp of this.companions) comp.update(dt, this);
      for (const p of this.bossPets) p.update(dt, this);
      for (const b of this.bombers) b.update(dt, this);
      for (const v of this.vials) v.update(dt, this);
      for (const t of this.turrets) t.update(dt, this);
      this.player.update(dt, this);
      // ★必须排在 player.update 之后：这根十字的原点每帧贴着角色走，读上一帧位置会让光和身子脱开一格
      //   （同上面 lasers 那条「读上一帧自转角会让眼和光脱开」，只是这里脱开的是角色自己的位移 ——
      //   光束是从人身上发出来的，人已经挪走了、光还留在原地，读起来就像道具坏了）
      for (const c of this.laserCrosses) c.update(dt, this);
    }
  }

  removeEnemy(index) {
    this.enemys.splice(index, 1);
  }

  removeBullet(index) {
    this.bullets.splice(index, 1);
  }

  // 炸弹：引爆后还要把爆风放完（BOMB_BLAST_MS）才算 isDestroyed，回收由 main.js 现成的那批寿命循环做
  removeBomb(index) {
    this.bombs.splice(index, 1);
  }

  removeVesicle(index) {
    this.vesicles.splice(index, 1);
  }

  removeEnemyBullet(index) {
    this.enemyBullets.splice(index, 1);
  }

  removeLaser(index) {
    this.lasers.splice(index, 1);
  }

  removeLaserCross(index) {
    this.laserCrosses.splice(index, 1);
  }

  removeZone(index) {
    this.zones.splice(index, 1);
  }

  removeXpGem(index) {
    this.xpGems.splice(index, 1);
  }

  removeClot(index) {
    this.clots.splice(index, 1);
  }

  removeChest(index) {
    this.chests.splice(index, 1);
  }

  removeBossPet(index) {
    this.bossPets.splice(index, 1);
  }

  // 伤害飘字：子弹命中时调用，isCrit 决定黄色高亮+放大；设置项关闭时直接跳过
  // color 只给燃烧这类非普攻伤害源用；普攻不传，走 damageText.js 里的白字/暴击黄默认
  // ★上限是烧出来的保险：一只怪 5 秒内多 10 条字，三十几只同时燃烧时是每帧好几条新分配。
  //   满了就丢新来的这一条、不区分来源，所以真被顶到时普攻也会缺字——headless 的 peakTexts 专门用来看它够不够宽
  addDamageText(x, y, damage, isCrit, color) {
    if (!settings.damageText) return;
    if (this.damageTexts.length >= DAMAGE_TEXT_MAX) return;
    const text = this.pool.getItemByClass('damageText', DamageText);
    text.init(x, y, damage, isCrit, color);
    this.damageTexts.push(text);
  }

  removeDamageText(index) {
    this.damageTexts.splice(index, 1);
  }
}
