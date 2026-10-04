import Sprite from '../base/sprite';
import Bomb from './bomb';
import { UI } from '../ui/theme';
import { clampToCoast } from '../arena/coast';
import {
  COMPANION_RADIUS, COMPANION_FOLLOW_DIST, COMPANION_SLOT_ANGLE,
  BOMBER_SPRITE, BOMBER_SPRITE_SIZE,
  BOMB_CD, BOMB_BLAST_R, BOMB_CLUSTER_N, bombDamage,
} from '../consts';

// 黄金角：同一批落点彼此错开又不叠在一起，js/npc/monster/zone.js 内部那几颗亮斑用的是同一个数
const GOLDEN = 2.39996;

/**
 * 炸弹跟班（金匣第 7 种加成）：站角色身后偏左那一格，攒满 BOMB_CD 就往怪最密的一团扔一枚。
 * ★场上恒为一只，player.bomber 是「一轮扔几枚」，同 companion.js 的口径。
 *
 * 和射击跟班的分工就是这件道具的全部意义：跟班每 0.67 秒单发刮一条线，它 5 秒砸一片。
 * 所以它不追最近的怪，追**最挤**的怪——落点选错，低频率就永远换不回高总量。
 *
 * 贴图走的是 companion.png 同一批语言，但刻意用暖沙色弹体 + 圆光滑剪影：两只跟班并排站在角色身后，
 * 同色同形就分不清谁在投弹（2026-10-04 之前它是代码画的一颗近黑实心盘，和旁边那颗奶蓝贴图摆在一起
 * 既大一圈又是两种质感，用户拍板出图统一）。
 * 读条只在后半程出现（2026-10-04 定稿：整圈和"前半程也画"两个版本都被否）：攒过 2 秒才在弹体左下象限
 * 烧出一根 90° 弧，前半程身上什么都没有。这样它永远闭不成一个环，也不会常年挂着一圈东西压过旁边那只，
 * 而"快好了"这个信息恰好留在玩家真正需要它的时刻。
 */
export default class Bomber extends Sprite {
  constructor() {
    super(BOMBER_SPRITE, BOMBER_SPRITE_SIZE, BOMBER_SPRITE_SIZE, 0, 0);
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
   * 亏掉的是整整一轮 BOMB_CD 的冷却。
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
    this.drawCharge(ctx); // 画在贴图底下：弧的外沿只比框多 1.25px，压上去会啃掉弹体那一圈描边
    if (this.drawSprite(ctx)) return;
    // 贴图还没加载完 → 同格同大小的奶白实心 + 粗墨描边占位（同 companion.js 的兜底口径）
    ctx.fillStyle = UI.cream;
    ctx.beginPath();
    ctx.arc(this.x, this.y, BOMBER_SPRITE_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  /**
   * 蓄力读条：90° 行程全留给后半程，攒满 BOMB_CD 时刚好烧满一个象限。
   * ★象限取 6 点 → 9 点（左下）：v3 的引信和火星在弹体右上，那截剪影是这只跟班唯一的身份标识，弧绝不能压
   * ★半径取贴图边框本身（直径 22），和射击跟班同格，不往外撑
   * 索敌范围内没怪时 cdT 被钉在 BOMB_CD 上（见 update），所以这根弧会一直亮满档 = 「我好了，在等目标」
   */
  drawCharge(ctx) {
    const k = this.cdT / BOMB_CD;
    if (k < 0.5) return;
    const p = (k - 0.5) * 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = UI.burn;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.75 + 0.25 * p;
    ctx.beginPath();
    ctx.arc(0, 0, BOMBER_SPRITE_SIZE / 2, Math.PI / 2, Math.PI / 2 + (Math.PI / 2) * p);
    ctx.stroke();
    ctx.restore();
  }
}
