import Sprite from '../base/sprite';
import Bullet from './bullet';
import { UI } from '../ui/theme';
import {
  TWIN_CD, TWIN_SALVO, TWIN_RANGE, TWIN_SPRITE, TWIN_SIZE,
  TWIN_MUZZLE_DX, TWIN_MUZZLE_DY, TWIN_BULLET_RADIUS, TWIN_BULLET_COLOR,
  twinDamage, BULLET_RANGE_BUFFER, BURN_DMG,
} from '../consts';

/**
 * 双联炮座（Boss 掉落道具「双子核心」）：拾取那一刻在角色脚下落一座，之后坐标永不改变，只守自己 TWIN_RANGE 那一小块地。
 *
 * 它和金匣第 10 种「炮台」是同一家族的两件东西，分工写在 consts.js 的 TWIN_* 那一块：炮台射程 220、一层一座可以叠很多座，
 * 买的是「铺地」；这一座射程只有 130、一局只落一座，但一轮两发、单发 2×攻击力，买的是「这一小块地值不值得站」。
 *
 * 外观是双子那对菌体立在地上（奶白菌垫 + 根足 + 两只正对镜头的炮管 + 中间一对绿球菌），
 * ★整张图不转：两只炮口天生朝镜头，没有「单一朝向」可画，所以它不像 turret.js 那样切两半绕枢轴转。
 *   代价是它永远读不出「背对你」—— 这件道具唯一的限制就是那个 130 的圈，圈外的怪它一律不管。
 *   好处是它没有死角：任何方向的怪都在同一张嘴的射程里，两发各打最近的一只才和画面上那两张嘴对得上。
 */
export default class TwinBattery extends Sprite {
  constructor() {
    super(TWIN_SPRITE, TWIN_SIZE, TWIN_SIZE, 0, 0);
    // 全场没有任何友方实体可被打（每条伤害路径都终结在 player），炮座自然也不参与碰撞；
    // 这个 radius 只是 Sprite 的子类约定，留个值免得读代码时以为漏了判定（同 turret.js 那条）
    this.radius = TWIN_SIZE / 2;
    this.cdT = 0;   // 距上一轮齐射已过的毫秒数（dt 累加）
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;

    // 坐标一次写定、永不移动也永不追踪（同 turret.js / zone.js 那条约定）。
    // 计时一律 dt 累加、不读 Date.now：main.js 在三选一面板开着时整条跳过 databus.update，
    // 墙上时钟却照走，读它的后果是面板一关就立刻补出积压的那几轮齐射
    this.cdT += dt * 1000;
    if (this.cdT < TWIN_CD) return;
    if (this.fire(databus, player)) this.cdT = 0;
    // 射程内一只怪都没有就不空放，把这一轮攒着：怪一进圈下一帧立刻打出第一轮（turret.js 同款）。
    // ★钉在 TWIN_CD 而不是继续涨，才让「面板冻住多久都不欠发」这条成立
    else this.cdT = TWIN_CD;
  }

  /**
   * 一轮齐射：两只炮口各打射程内最近的一怪，圈里只剩一只时两发都给同一只。
   * ★不是打最挤的：那是炸弹跟班的活儿，重炮只负责把最靠前那两只挡在圈子外。
   * 索敌只在开火那一刻做，与主角/跟班/bomber/turret 同一口径；比较用平方距离不开方，
   * 因为空闲时 cdT 被钉满、这段扫描每帧都在跑
   * @returns {boolean} 有没有打出去（false = 这一圈里没有怪）
   */
  fire(databus, player) {
    const lim = TWIN_RANGE * TWIN_RANGE;
    const near = [];   // 射程内由近及远的前 TWIN_SALVO 只：最多两格，插入排序比建堆便宜
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= lim) continue;
      let i = near.length;
      while (i > 0 && near[i - 1].d2 > d2) i--;
      near.splice(i, 0, { e, d2 });
      if (near.length > TWIN_SALVO) near.length = TWIN_SALVO;
    }
    if (!near.length) return false;

    for (let i = 0; i < TWIN_SALVO; i++) {
      const t = near[i] || near[0];
      const mx = this.x + (i ? TWIN_MUZZLE_DX : -TWIN_MUZZLE_DX);
      const my = this.y + TWIN_MUZZLE_DY;
      // ★方向必须从【炮口】算而不是从实体中心算：炮口在中心上方 26.5、外侧 18.3，
      //   把中心算出的单位向量平移过去，正下方那只怪会偏出 30 多像素 —— 大于怪半径加弹半径，等于这一发凭空打空
      const dx = t.e.x - mx;
      const dy = t.e.y - my;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;

      const bullet = databus.pool.getItemByClass('bullet', Bullet);
      bullet.init(mx, my, dx / d, dy / d, twinDamage(player.attack));
      bullet.radius = TWIN_BULLET_RADIUS;
      bullet.color = TWIN_BULLET_COLOR;
      // ★init 不重置 maxRange（只重置 radius/color/pierce/burn），漏了这一发会继承上一发别人的飞行距离。
      //   缓冲 50 之外还要盖住炮口离中心那 32.5 像素：怪正好站在圈线上时，弹要能再走一格才够得着
      bullet.maxRange = TWIN_RANGE + BULLET_RANGE_BUFFER;
      bullet.pierceLeft = player.pierce;
      bullet.burnDamage = player.burnBullets * BURN_DMG;
      databus.bullets.push(bullet);
    }
    return true;
  }

  /**
   * 贴图未解码时回退成同格同大小的奶白实心 + 粗墨描边（同 turret.js / companion.js / bomber.js 的口径）
   */
  draw(ctx) {
    if (this.drawSprite(ctx)) return;
    const h = TWIN_SIZE / 2;
    ctx.fillStyle = UI.cream;
    ctx.beginPath();
    ctx.arc(this.x, this.y, h, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
}
