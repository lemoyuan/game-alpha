import Sprite from '../base/sprite';
import Bomb from './bomb';
import { UI } from '../ui/theme';
import { clampToCoast } from '../arena/coast';
import {
  COMPANION_RADIUS, COMPANION_FOLLOW_DIST, COMPANION_SLOT_ANGLE,
  BOMB_CD, BOMB_BLAST_R, BOMB_CLUSTER_N, bombDamage,
} from '../consts';

// 黄金角：同一批落点彼此错开又不叠在一起，js/npc/monster/zone.js 内部那几颗亮斑用的是同一个数
const GOLDEN = 2.39996;

/**
 * 炸弹跟班（金匣第 7 种加成）：站角色身后偏左那一格，攒满 BOMB_CD 就往怪最密的一团扔一枚。
 * ★场上恒为一只，player.bomber 是「一轮扔几枚」，同 companion.js 的口径。
 *
 * 和射击跟班的分工就是这件道具的全部意义：跟班每 0.67 秒单发刮一条线，它 4 秒砸一片。
 * 所以它不追最近的怪，追**最挤**的怪——落点选错，低频率就永远换不回高总量。
 *
 * 代码绘制，不出图：额度给实体；而且复用 companion.png 会让两只跟班看着是同一张贴图的重影。
 * 也正因为 4 秒里它什么都不做，那圈蓄力环是必需品——没有可见读条，4 秒会被玩家读成「这道具没生效」。
 */
export default class Bomber extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.radius = COMPANION_RADIUS; // 与射击跟班同一条判定：两个都是贴身站位的友方实体，没必要分开调
    this.cdT = 0;                   // 距上轮投掷已过的毫秒数（dt 累加）
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;

    // 座次：射击跟班站在角色正后方，炸弹跟班站它左边一格（COMPANION_SLOT_ANGLE 就是老的多只弧距）
    const seat = Math.atan2(player.dirY, player.dirX) + Math.PI - COMPANION_SLOT_ANGLE;
    const tx = player.x + Math.cos(seat) * COMPANION_FOLLOW_DIST;
    const ty = player.y + Math.sin(seat) * COMPANION_FOLLOW_DIST;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);

    // 计时一律 dt 累加、不读 Date.now：三选一面板开着时 main.js 跳过 update，墙上时钟却照走
    this.cdT += dt * 1000;
    if (this.cdT < BOMB_CD) return;
    if (this.volley(databus, player)) this.cdT = 0;
    // 索敌距离内一只怪都没有就不空扔，把这一轮攒着：怪一进圈立刻砸出去。
    // ★这条同时把空闲代价压成"一次不带分配的距离遍历"——没有候选时 cands 全程为空
    else this.cdT = BOMB_CD;
  }

  /**
   * 一轮投掷：count = player.bomber 枚，落点以密集中心为原点向外圈摊。
   * @returns {boolean} 有没有扔出去（false = 场上没有够得着的怪）
   */
  volley(databus, player) {
    const spot = this.densestSpot(databus, player);
    if (!spot) return false;

    const count = Math.max(1, player.bomber);
    const damage = bombDamage(player.attack);
    for (let i = 0; i < count; i++) {
      // 太阳花排布：i 从 0 起算，所以第一枚永远正砸中心，其余往外摊开去覆盖更大一片。
      // 各枚落点距离不同 → flyMs 不同 → 它们自己就会错开落地，不需要 delay 字段
      const r = BOMB_BLAST_R * 0.55 * Math.sqrt(i / count);
      const a = i * GOLDEN;
      const target = { x: spot.x + Math.cos(a) * r, y: spot.y + Math.sin(a) * r };
      // ★只夹落点，飞行那条弦不夹：夹弦线会让弹贴着海岸急转弯，那是 bug 不是手感
      clampToCoast(target, 4);
      const bomb = databus.pool.getItemByClass('bomb', Bomb);
      bomb.init(this.x, this.y, target.x, target.y, damage);
      databus.bombs.push(bomb);
    }
    return true;
  }

  /**
   * 落点：够得着的怪里挑「邻居最多的那一只」。不是挑最近的单只——一炸弹砸在一只散兵身上，
   * 亏掉的是它 4 秒的冷却。
   * 两段式：先 O(n) 收最近 BOMB_CLUSTER_N 只，再在这十几只里 O(k²) 数邻居。
   * 同票留更近的那一只（near 已按距离升序，所以严格 > 天然就是这个语义）。
   */
  densestSpot(databus, player) {
    const cands = [];
    for (const e of databus.enemys) {
      if (e.isDead) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < player.attackRange) cands.push({ x: e.x, y: e.y, d });
    }
    if (!cands.length) return null;

    cands.sort((p, q) => p.d - q.d);
    const near = cands.length > BOMB_CLUSTER_N ? cands.slice(0, BOMB_CLUSTER_N) : cands;
    const lim = BOMB_BLAST_R * BOMB_BLAST_R;
    let best = near[0];
    let bestNeighbors = -1;
    for (let i = 0; i < near.length; i++) {
      let n = 0;
      for (let j = 0; j < near.length; j++) {
        if (i === j) continue;
        const dx = near[i].x - near[j].x;
        const dy = near[i].y - near[j].y;
        if (dx * dx + dy * dy < lim) n++;
      }
      if (n > bestNeighbors) {
        bestNeighbors = n;
        best = near[i];
      }
    }
    return best;
  }

  draw(ctx) {
    // 显示比判定大一圈（同 COMPANION_SPRITE_SIZE / COMPANION_RADIUS 那个比值），
    // 判定收在体内、剪影伸出去，和怪与 Boss 的约定一致
    const dr = this.radius * 1.4;
    ctx.save();
    ctx.translate(this.x, this.y);
    this.drawCharge(ctx, dr);

    const k = Math.min(1, this.cdT / BOMB_CD);
    // 引信：攒满一轮的过程中烧到尽头，所以它同时是第二根读条
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(dr * 0.3, -dr * 0.78);
    ctx.quadraticCurveTo(dr * 1.05, -dr * 1.1, dr * 0.86, -dr * 1.72);
    ctx.stroke();
    ctx.fillStyle = UI.burn;
    ctx.globalAlpha = 0.45 + 0.55 * k;
    ctx.beginPath();
    ctx.arc(dr * 0.86, -dr * 1.72, dr * (0.16 + 0.16 * k), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.arc(0, 0, dr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.sticker;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 两只眼：圆弹加脸就是"一只跟班"，不加脸就是"一颗弹"——场上同时有两者，这个区别不能丢
    ctx.fillStyle = UI.cream;
    ctx.beginPath();
    ctx.arc(-dr * 0.34, -dr * 0.1, dr * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dr * 0.34, -dr * 0.1, dr * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 蓄力环：底圈是流动虚线（和赤潮预警、毒王冲锋同一套"这里马上要疼"的语法），
   * 上面压一段实心弧表示已经攒到几分之几。攒满时整圈烧成橙，下一帧就扔
   */
  drawCharge(ctx, dr) {
    const r = dr + 5;
    const k = Math.min(1, this.cdT / BOMB_CD);
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -((this.cdT / 22) % 13);
    ctx.strokeStyle = UI.burn;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.5 + 0.5 * k;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
