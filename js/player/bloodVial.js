import Sprite from '../base/sprite';
import { UI, FS, stickerLabel } from '../ui/theme';
import { PLAYER_MAX_HP, COMPANION_RADIUS, COMPANION_FOLLOW_DIST, COMPANION_SLOT_ANGLE, VIAL_SPRITE, VIAL_SIZE } from '../consts';

// 液面那四个几何数全是量出来的，不是眼估的：逐行扫 images/entity/vial.png（44×44 画框）的实心像素，
// 按「A>200 且不是深蓝描边」取内腔跨度 → 内腔竖跨 y 2..40、最宽 x 6..37（半宽 15.5，在 y 23..30 那一段）；
// 描边外沿半宽 17.5。★裁剪圆宁可小也别贴边——血面一旦啃穿那圈深蓝描边，就画成「瓶子在漏」。
const BULB_CY = 0.205; // 内腔圆心（量出来的内腔最宽段偏下，圆心 y 26.5 相对画框中心 22，再除以半边长 22）
const BULB_R = 0.63;   // 内腔裁剪半径 = 14/22：取严格内切的那只圆（内腔最宽 15.5 但瓶身是个桶，圆按小的那头收）
const BULB_OUT = 0.80; // 描边外沿半宽：溢出呼吸圈贴这条线外面 2px 画
const SURF_TOP = -0.20; // 满格液面所在行（画框 y 17，正好是瓶肩）：★满瓶也只灌到肩，瓶颈留白才读得出「装着一瓶」，
                        //   再往上一格就淹掉 y 12..16 那张脸，瓶子会读成「泡在血里」而不是「存着血」

/**
 * 血瓶跟随体（金匣第 9 种加成）：站射击跟班右边那一格，瓶里的红色液面 = 瓶内存量。
 * ★场上恒为一只，player.vial 是「每 30 秒攒几滴」，不是几只瓶子，同 companion.js / bomber.js 的口径。
 *
 * 2026-10-11：瓶身从代码画的瓶形换成贴图，为了让第三只跟随体和另两只同一套外观语言。
 * 但液面坚持代码叠：贴图是静态的，「存量」是一件会随每一帧结算变的东西，画进图里就等于把读数冻死。
 * 同 bomber.js 的引信读条是同一个分工——外观归贴图，读数归代码。
 *
 * 这个实体不带任何计时器：两条节拍全在 Player.pumpVial 里（那里才吃得到 main.js 的 isPaused 门）。
 * 它每帧只读 player.vialDrops 把存量画出来，所以液面永远和实际结算同一帧，不会出现「看着满了却没回血」。
 *
 * 液面的量纲取 maxHp 而不是某个固定数：40 血上限下「一瓶满」正好等于「一次血条从空到满」，
 * 玩家看懂的是同一件事。存量无上限，所以超过一整瓶时液面钉在满格、描边呼吸、把精确滴数标在旁边。
 */
export default class BloodVial extends Sprite {
  constructor() {
    super(VIAL_SPRITE, VIAL_SIZE, VIAL_SIZE, 0, 0);
    this.radius = COMPANION_RADIUS; // 同两条跟班：都是贴身站位的友方实体，没必要分开调
    this.drops = 0;                 // 存量快照，draw 只读它：update 每帧从 player 抄一次
    this.maxHp = PLAYER_MAX_HP;     // 液面量纲的快照（构造期只是过渡值，第一帧 update 就会被真实上限覆盖）
    // 呼吸相位在构造期定一次，绘制里不许出现 Math.random（每帧换相位 = 截图不可复现）
    this.phase = Math.random() * Math.PI * 2;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    this.drops = player.vialDrops;
    this.maxHp = player.maxHp;

    // 座次：射击跟班正后方，炸弹跟班偏 -COMPANION_SLOT_ANGLE 那侧，血瓶取 + 那侧 → 三只拉开 31 / 58px
    const seat = Math.atan2(player.dirY, player.dirX) + Math.PI + COMPANION_SLOT_ANGLE;
    const tx = player.x + Math.cos(seat) * COMPANION_FOLLOW_DIST;
    const ty = player.y + Math.sin(seat) * COMPANION_FOLLOW_DIST;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);
  }

  draw(ctx) {
    const h = VIAL_SIZE / 2;
    const cy = this.y + BULB_CY * h;
    const r = BULB_R * h;
    const overflow = this.drops > this.maxHp;

    if (overflow) {
      // 满出来的呼吸圈画在贴图底下：球体下沿那一弧露出来就够读明了，压上去会啃掉瓶身描边
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260 + this.phase);
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.35 * pulse;
      ctx.strokeStyle = UI.blood;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, cy, BULB_OUT * h + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (!this.drawSprite(ctx)) {
      // 贴图还没加载完 → 同格同大小的奶白实心 + 粗墨描边占位（同 companion.js / bomber.js 的兜底口径）
      ctx.fillStyle = UI.cream;
      ctx.beginPath();
      ctx.arc(this.x, this.y, h, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    this.drawLevel(ctx, this.level(this.drops, this.maxHp), cy, r, h);

    // 超过一整瓶：液面已经钉满，得另给一个读数，否则「攒了多少」这件事在画面上变成黑箱
    if (overflow) {
      stickerLabel(ctx, `${this.drops}`, this.x + h + 9, this.y, {
        size: FS.small, color: UI.blood, width: 2.5,
      });
    }
  }

  /**
   * 存量 → 液面高度比例。★空瓶给 0、有货至少给 0.14：
   * 只有 1 滴时按比例是 1/40 = 0.025，画出来不到半像素，玩家会读成「瓶子没收到东西」
   */
  level(drops, maxHp) {
    if (drops <= 0) return 0;
    return Math.min(1, Math.max(0.14, drops / maxHp));
  }

  drawLevel(ctx, frac, cy, r, h) {
    if (frac <= 0) return;
    const bottom = cy + r;
    const surface = bottom - frac * (bottom - (this.y + SURF_TOP * h));
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = UI.blood;
    ctx.fillRect(this.x - r, surface, r * 2, bottom - surface);
    ctx.restore();
  }
}
