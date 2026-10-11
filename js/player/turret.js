import Sprite from '../base/sprite';
import Bullet from './bullet';
import { UI } from '../ui/theme';
import {
  TURRET_CD, TURRET_RANGE, TURRET_MUZZLE_LEN, TURRET_PIVOT_Y, TURRET_SOCKET_RX,
  TURRET_SPRITE, TURRET_SIZE, TURRET_BULLET_RADIUS, TURRET_BULLET_COLOR, turretDamage,
  BULLET_RANGE_BUFFER, BURN_DMG,
} from '../consts';

/**
 * 固定炮台（金匣第 10 种加成）：拾取那一刻在角色脚下落一座，之后坐标永不改变，只守自己周围 TURRET_RANGE 那一圈。
 * ★场上可以有很多座，player.turrets 就是座数——和 companion.js / bomber.js 那条「恒为一只、层数买几发」相反，
 *   因为那两条的前提是实体只有一个位置，而这里每个位置各自就是一座，位置本身就是这件道具的内容。
 *
 * 分工：跟班每 0.67 秒跟着你刮一条线，炮台 1.2 秒一发高伤单体、但站在原地。所以它的价值来自「这块地守不守得住」——
 * 站桩不追的喷子（进 250 就停）和只挪一条膜的膜王，是它唯一能独占、而你的火力还得腾出手去够的靶子。
 *
 * 外观是跟班家族第四员（奶沙主体 + 一道深蓝粗描边 + 一个深色核），但转法破了家族约定：
 * 一张贴图在绘制时按实测切线裁成两半——下半（根足底座）钉住不转，上半（炮头）绕颈部那圈金环的环心转到 aim。
 * ★底座不转正是这件道具的存在理由：它会跟着跑的就不叫炮台了。而「站得笔直、只有炮头在转」的剪影把这件事画在了表面上，
 *   比先前那套「身子不转 + 代码画一根炮管」更一眼读得出这是个炮塔（俯视的墩座看不出炮，是用户否掉两轮的根因）
 */
export default class Turret extends Sprite {
  constructor() {
    super(TURRET_SPRITE, TURRET_SIZE, TURRET_SIZE, 0, 0);
    // 全场没有任何友方实体可被打（每条伤害路径都终结在 player），炮台自然也不参与碰撞；
    // 这个 radius 只是 Sprite 的子类约定，留个值免得读代码时以为漏了判定
    this.radius = TURRET_SIZE / 2;
    this.cdT = 0;   // 距上一发已过的毫秒数（dt 累加）
    this.aim = 0;   // 上一发的朝向；两次开火之间钉着不动 = 「它刚在打哪边」，出生时取拾取那一刻的角色朝向
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;

    // 坐标一次写定、永不移动也永不追踪（同 zone.js 那条约定）：炮台是地面上的东西，会跟着跑的就不叫炮台了。
    // 计时一律 dt 累加、不读 Date.now：main.js 在三选一面板开着时整条跳过 databus.update，
    // 墙上时钟却照走，读它的后果是面板一关就立刻补出积压的那几发
    this.cdT += dt * 1000;
    if (this.cdT < TURRET_CD) return;
    if (this.fire(databus, player)) this.cdT = 0;
    // 射程内一只怪都没有就不空放，把这一轮攒着：怪一进圈下一帧立刻开第一发（bomber.js 同款）。
    // ★钉在 TURRET_CD 而不是继续涨，才让「面板冻住多久都不欠发」这条成立
    else this.cdT = TURRET_CD;
  }

  /**
   * 打最近的一怪。★不是打最挤的：那是炸弹跟班的活儿，单体高伤的炮台只负责把最靠前那一只挡在圈子外。
   * 索敌只在开火那一刻做，与主角/跟班/bomber 同一口径；比较用平方距离不开方，
   * 因为空闲时 cdT 被钉满、这段扫描每帧都在跑，满场时它是按座数乘的
   * @returns {boolean} 有没有打出去（false = 这一圈里没有怪）
   */
  fire(databus, player) {
    const lim = TURRET_RANGE * TURRET_RANGE;
    let best = null;
    let bestD2 = lim;
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    if (!best) return false;

    const dx = best.x - this.x;
    const dy = best.y - this.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    this.aim = Math.atan2(dy, dx);

    const bullet = databus.pool.getItemByClass('bullet', Bullet);
    // ★纵向基准是枢轴不是贴图中心：炮口绕的是那圈金环，TURRET_MUZZLE_LEN 也是从环心量的，
    //   这里漏掉 PIVOT_Y 就等于炮弹从炮口下方 0.6 像素处凭空冒出来
    bullet.init(
      this.x + Math.cos(this.aim) * TURRET_MUZZLE_LEN,
      this.y + TURRET_PIVOT_Y + Math.sin(this.aim) * TURRET_MUZZLE_LEN,
      dx / d, dy / d, turretDamage(player.attack),
    );
    bullet.radius = TURRET_BULLET_RADIUS;
    bullet.color = TURRET_BULLET_COLOR;
    // ★init 不重置 maxRange（只重置 radius/color/pierce/burn），漏了这一发会继承上一发别人的飞行距离。
    //   缓冲照射击跟班加：怪正好站在圈线上时，弹要能再走一格才够得着
    bullet.maxRange = TURRET_RANGE + BULLET_RANGE_BUFFER;
    bullet.pierceLeft = player.pierce;
    bullet.burnDamage = player.burnBullets * BURN_DMG;
    databus.bullets.push(bullet);
    return true;
  }

  /**
   * 贴图未解码时回退成同格同大小的奶白实心 + 粗墨描边（同 companion.js / bomber.js / bloodVial.js 的口径）
   */
  draw(ctx) {
    const img = this.img;
    if (img && img.width && img.height) {
      this.drawSplit(ctx, img);
      return;
    }
    const h = TURRET_SIZE / 2;
    ctx.fillStyle = UI.cream;
    ctx.beginPath();
    ctx.arc(this.x, this.y, h, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  /**
   * 一张图切两半。枢轴 = 贴图中心往下 TURRET_PIVOT_Y，也就是颈部那圈金环的环心（实测）。
   * ★三段顺序不能换：底座 → 插座孔 → 炮头。孔必须先画，它才盖得住底座顶上那道平头切口；
   *   炮头压在孔上，读成「管子插在底座的孔里」，而孔是椭圆、跟角度无关，所以炮头转到任何朝向都不会露馅。
   *   （反过来把孔画在炮头之上，就等于在关节上糊一块饼——概念图那一轮已经否过一版。）
   * @param {CanvasRenderingContext2D} ctx
   * @param {WechatMinigame.Image} img 已解码的炮台贴图
   */
  drawSplit(ctx, img) {
    const h = TURRET_SIZE / 2;
    const px = this.x;
    const py = this.y + TURRET_PIVOT_Y;

    ctx.save();
    ctx.beginPath();
    ctx.rect(px - h, py, TURRET_SIZE, h - TURRET_PIVOT_Y + 1);
    ctx.clip();
    ctx.drawImage(img, px - h, this.y - h, TURRET_SIZE, TURRET_SIZE);
    ctx.restore();

    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.ellipse(px, py, TURRET_SOCKET_RX, TURRET_SOCKET_RX * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // 图按「炮口朝上」出，所以转到 aim 要加 90°（同 bullet.js「造型朝上画，转到速度方向」那条口径）
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.aim + Math.PI / 2);
    ctx.beginPath();
    ctx.rect(-h - 1, -h - 1, TURRET_SIZE + 2, h + 1);
    ctx.clip();
    ctx.drawImage(img, -h, -h - TURRET_PIVOT_Y, TURRET_SIZE, TURRET_SIZE);
    ctx.restore();
  }
}
