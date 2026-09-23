import { canvasW, canvasH, UPGRADES } from '../consts';
import { UI, FS, R_CARD, sticker, badge, chip, label, labelMid, ribbon, stickerLabel } from './theme';

const SELECT_ANIM_MS = 450;  // 选中卡片的放大强调动画时长（毫秒）

export default class UpgradeScreen {
  constructor() {
    this.visible = false;
    this.options = [];
    this._databus = null;
    this.selectAnim = null; // { index, start } 选中动画进行中
  }

  init(databus) {
    this._databus = databus;
    wx.onTouchStart((e) => {
      if (!this.visible || this.selectAnim) return;
      const t = e.touches[0];
      const { cardW, cardH, gap, startY } = this.layout();
      const totalW = this.options.length * cardW + (this.options.length - 1) * gap;
      const startX = (canvasW - totalW) / 2;
      for (let i = 0; i < this.options.length; i++) {
        const x = startX + i * (cardW + gap);
        if (t.clientX >= x && t.clientX <= x + cardW &&
            t.clientY >= startY && t.clientY <= startY + cardH) {
          this.pick(i);
          break;
        }
      }
    });
  }

  layout() {
    const n = Math.max(1, this.options.length);
    const margin = 12;
    const gap = Math.max(8, Math.floor(canvasW * 0.025));
    const cardW = Math.floor((canvasW - margin * 2 - gap * (n - 1)) / n);
    const cardH = Math.round(cardW * 1.3);
    const startY = Math.round(canvasH * 0.22);
    return { cardW, cardH, gap, startY };
  }

  show(databus) {
    this.visible = true;
    this.selectAnim = null;
    const pool = [...UPGRADES];
    this.options = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      this.options.push(pool.splice(idx, 1)[0]);
    }
  }

  // 选中：加成立即生效，播放放大强调动画，动画结束才关闭并恢复游戏
  pick(index) {
    const opt = this.options[index];
    if (!opt) return;
    const player = this._databus.player;
    if (opt.mult) {
      player[opt.key] = Math.round(player[opt.key] * (1 + opt.value) * 100) / 100;
    } else {
      player[opt.key] += opt.value;
    }
    if (opt.key === 'maxHp') {
      player.hp = Math.min(player.hp + opt.value, player.maxHp);
    }
    this.selectAnim = { index, start: Date.now() };
  }

  draw(ctx) {
    if (!this.visible) return;
    const now = Date.now();

    // 动画结束：关闭面板并恢复游戏
    if (this.selectAnim && now - this.selectAnim.start >= SELECT_ANIM_MS) {
      this.selectAnim = null;
      this.visible = false;
      if (this._databus) {
        this._databus.isPaused = false;
        // 一颗 Boss 宝石（300~600 经验）够跨好几级，而 addXp 每次只结一级：
        // 面板关掉后把剩下的溢出经验接着结算成下一张卡，否则经验条会永远停在 "590/170" 这种填不满的样子
        this._databus.player.addXp(0, this._databus);
      }
      return;
    }

    const t = this.selectAnim ? Math.min(1, (now - this.selectAnim.start) / SELECT_ANIM_MS) : 0;
    const fade = this.selectAnim ? 1 - t : 1;

    // 背景遮罩：动画期间整体淡出
    ctx.globalAlpha = fade;
    ctx.fillStyle = UI.dim;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const hy = canvasH * 0.16; // 低于顶部 HUD，高于卡片（0.22）
    stickerLabel(ctx, 'LEVEL UP!', canvasW / 2, hy, { size: FS.title, color: UI.gold });
    label(ctx, '选择一项强化', canvasW / 2, hy + 26, { size: FS.body, color: UI.textOnDark, align: 'center' });
    ctx.globalAlpha = 1;

    const { cardW, cardH, gap, startY } = this.layout();
    const totalW = this.options.length * cardW + (this.options.length - 1) * gap;
    const startX = (canvasW - totalW) / 2;
    const sel = this.selectAnim ? this.selectAnim.index : -1;

    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const x = startX + i * (cardW + gap);

      if (this.selectAnim && i !== sel) {
        // 未选中的卡：快速淡出
        ctx.globalAlpha = Math.max(0, 1 - t * 2.5);
        this.drawCard(ctx, opt, x, startY, cardW, cardH, i, false);
        ctx.globalAlpha = 1;
        continue;
      }

      if (this.selectAnim && i === sel) {
        // 选中卡：围绕中心放大，收尾阶段淡出
        const ease = 1 - Math.pow(1 - t, 3);
        const scale = 1 + 0.35 * ease;
        const out = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        const cx = x + cardW / 2;
        const cy = startY + cardH / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha = out;
        this.drawCard(ctx, opt, x, startY, cardW, cardH, i, true);
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }

      this.drawCard(ctx, opt, x, startY, cardW, cardH, i, false);
    }
  }

  drawCard(ctx, opt, x, y, w, h, index, highlight) {
    const tint = UI[opt.tint] || UI.blue; // tint 是 consts.js 里写的 UI 色键
    const cx = x + w / 2;
    sticker(ctx, x, y, w, h, { fill: UI.cream, r: R_CARD });
    badge(ctx, cx, y + h * 0.25, w * 0.2, opt.icon, { color: tint });
    labelMid(ctx, opt.label, cx, y + h * 0.5, { size: FS.body, bold: true, color: UI.textOnLight });
    labelMid(ctx, opt.desc, cx, y + h * 0.7, { size: FS.h1, bold: true, color: tint });
    chip(ctx, cx - 13, y + h - 32, 26, 21, `${index + 1}`, {
      color: UI.panelDeep, textColor: UI.textOnDark, size: FS.tiny, shadow: false,
    });
    if (highlight) ribbon(ctx, x + w - 44, y + 2, 88, 40, '已选', { clipX: x, clipY: y, clipW: w, clipH: h });
  }
}
