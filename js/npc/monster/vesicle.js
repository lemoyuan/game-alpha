import Bomb from '../../player/bomb';
import Zone from './zone';

/**
 * 囊泡：双子 Boss 投出的那一枚「胞外囊泡」。真机制是它把溶血素（pneumolysin）打包进一层
 * 自己鼓出来的膜泡里往外投递——所以这一下的威胁不在弹体，而在落地之后那片化开的膜。
 *
 * ★为什么不复用 databus.bombs 而走自己的一条列表：炸弹跟班那一路的计数、纯检和断言
 *   （headless_check 里 thrown / booms / 「一轮几枚」）全是按「玩家自己的炸弹」定的口径，
 *   两家共用一条数组等于把玩家道具的报表污染成敌我混合，而那正是「第二处功能污染」的数值版。
 *
 * ★继承 Bomb 只为了两件事：抛物线（z = 4p(1−p) 那套飞行 + 落影 + 落点预警环）和爆风淡出。
 *   detonate 整段覆写、不调 super——父类那一段扫的是 databus.enemys（打怪），囊泡打玩家，
 *   方向相反，套上去就是「Boss 的炸弹给玩家加血以外的地方结算」这种读不通的东西。
 *   暴击也不掷：player.critRate 是玩家的属性，不该出现在敌方弹上。
 */
export default class Vesicle extends Bomb {
  constructor() {
    super();
    // 毒渍参数：null = 不留渍。init 必写，这里只给对象池复用时的兜底形状
    this.stain = null;
  }

  /**
   * @param {string} tint 酸黄色（config.boss4.stainTint）：弹体、爆风、毒渍三处同源，换色只改这一处
   * @param {number} blastR 爆风判定半径（vesicleBlastR），比玩家那颗炸弹的 70 小一档
   * @param {object} stain 毒渍四参 { radius, life, damage, hold }
   *        ★打包成一个对象而不是续在身后四 positional：上面已经有 7 个参数，
   *          再排四个的话 stainRadius 与 stainLife 一旦换序不会报错，只会静默变成「又小又短的渍」
   */
  init(sx, sy, tx, ty, damage, tint, blastR, stain) {
    super.init(sx, sy, tx, ty, damage);
    this.tint = tint;
    this.blastR = blastR;
    this.stain = stain;
  }

  // 落地那一帧一次结清：判定圆内 = 溶血素泼在身上，之后这片地交给毒渍去封
  detonate(databus) {
    const player = databus.player;
    if (player) {
      const dx = player.x - this.tx;
      const dy = player.y - this.ty;
      const r = this.blastR + player.radius;
      if (dx * dx + dy * dy < r * r) {
        // ★走 applyBlast 而不是 takeDamage：这一下必然落在贴身接触刚刷新的那 1500ms 无敌帧里，
        //   走 takeDamage 等于整颗囊泡零结算（赤潮池当年就是这么静默失效的，见 config.js 的 poolDamage）
        player.applyBlast(this.damage);
      }
    }
    if (!this.stain) return;
    const zone = databus.pool.getItemByClass('zone', Zone);
    // warnTime 给 0：预警已经由飞行途中的落点环做完了，落地后再叠一段虚线圈会被读成「这是第二个技能」
    zone.init(
      this.tx,
      this.ty,
      this.stain.radius,
      this.stain.life,
      0,
      this.stain.damage,
      this.stain.hold,
      this.tint
    );
    databus.zones.push(zone);
  }
}
