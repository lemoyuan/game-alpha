import Sprite from '../base/sprite';
import { CHEST_RADIUS, XP_PICKUP_STEP } from '../consts';
import { UI, icon } from '../ui/theme';
import { CHEST_KIND_BY_ID } from './monster/config';
import { CHEST_GRANTS } from './chestGrant';

// key 必须与 player 的属性名一致（companions 为复数）。step = 每次开匣涨多少：计数型都是 1，
// 拾取范围涨的是像素（+1 等于没加），所以加成值一律写在 consts.js 里由这里引用
// ★每加一种就是把六种摊平：出货率从原来的 20% 掉到 16.7%，这是「进普通金匣池」这条路要付的代价
const BONUSES = [
  { key: 'bulletCount', step: 1, label: '子弹数 +1' },
  { key: 'pierce', step: 1, label: '子弹穿透 +1' },
  { key: 'shield', step: 1, label: '护盾 +1' },
  { key: 'companions', step: 1, label: '跟班 +1' },
  { key: 'burnBullets', step: 1, label: '燃烧子弹 +1' },
  { key: 'pickupRange', step: XP_PICKUP_STEP, label: `经验拾取范围 +${XP_PICKUP_STEP}` },
];

export default class Chest extends Sprite {
  constructor() {
    super(null, CHEST_RADIUS * 2, CHEST_RADIUS * 2, 0, 0);
    this.radius = CHEST_RADIUS;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.kind = null;
    this.kindDef = null;
  }

  // kind 为 BOSS_CHESTS 里的 id；对象池复用必须把它重置回 null，否则金匣会继承上一轮的 Boss 匣皮肤
  init(x, y, kind = null) {
    this.x = x;
    this.y = y;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.kind = kind;
    this.kindDef = kind ? CHEST_KIND_BY_ID[kind] : null;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < player.radius + this.radius + 4) {
      this.collected = true;
      databus.chestsOpened++;
      if (this.kindDef) {
        // Boss 专属匣：效果走注册表，以后加新匣只填 config 表 + 注册一行，不动这个文件
        CHEST_GRANTS[this.kind](databus);
        if (databus.hud) databus.hud.showToast(`开启「${this.kindDef.name}」`);
      } else {
        const b = BONUSES[Math.floor(Math.random() * BONUSES.length)];
        player[b.key] += b.step;
        if (databus.hud) databus.hud.showToast(b.label);
      }
    }
  }

  draw(ctx) {
    const bob = Math.sin(Date.now() / 250 + this.bobOffset) * 2;
    const r = this.radius;
    const y = this.y + bob;

    if (this.kindDef) {
      // Boss 专属匣：黑红配色 + 匣面专属图标，光晕是平涂脉冲（无渐变无 shadowBlur）
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(Date.now() / 200);
      ctx.fillStyle = UI.bossChestHalo;
      ctx.beginPath();
      ctx.arc(this.x, y, r + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = UI.bossChestBody;
      ctx.fillRect(this.x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = UI.bossChestBand;
      ctx.fillRect(this.x - r, y - 2, r * 2, 4);
      ctx.strokeStyle = UI.red;
      ctx.lineWidth = 1;
      ctx.strokeRect(this.x - r, y - r, r * 2, r * 2);
      icon(ctx, this.kindDef.icon, this.x, y, r * 1.2, { color: UI.red });
      return;
    }

    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(Date.now() / 200);
    ctx.fillStyle = '#f39c12';
    ctx.beginPath();
    ctx.arc(this.x, y, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#f39c12';
    ctx.fillRect(this.x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#8b5a00';
    ctx.fillRect(this.x - r, y - 2, r * 2, 4);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x - r, y - r, r * 2, r * 2);
  }
}
