import { canvasW, canvasH, UPGRADES } from '../consts';

const SELECT_ANIM_MS = 450;  // 选中卡片的放大强调动画时长（毫秒）
const CARD_RADIUS = 16;      // 卡片圆角半径（像素）

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

  // 圆角矩形路径（arcTo 实现，兼容性比 ctx.roundRect 好）
  roundRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  draw(ctx) {
    if (!this.visible) return;
    const now = Date.now();

    // 动画结束：关闭面板并恢复游戏
    if (this.selectAnim && now - this.selectAnim.start >= SELECT_ANIM_MS) {
      this.selectAnim = null;
      this.visible = false;
      if (this._databus) this._databus.isPaused = false;
      return;
    }

    const t = this.selectAnim ? Math.min(1, (now - this.selectAnim.start) / SELECT_ANIM_MS) : 0;
    const fade = this.selectAnim ? 1 - t : 1;

    // 背景遮罩：动画期间整体淡出
    ctx.fillStyle = `rgba(0,0,0,${0.75 * fade})`;
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.globalAlpha = fade;
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL UP!', canvasW / 2, canvasH * 0.12);

    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText('Choose an upgrade', canvasW / 2, canvasH * 0.12 + 35);
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
    ctx.beginPath();
    this.roundRectPath(ctx, x, y, w, h, CARD_RADIUS);
    ctx.fillStyle = highlight ? '#34495e' : '#2c3e50';
    ctx.fill();
    ctx.strokeStyle = highlight ? '#f1c40f' : '#3498db';
    ctx.lineWidth = highlight ? 3 : 2;
    ctx.stroke();

    const titleFont = Math.max(12, Math.round(w * 0.12));
    const descFont = Math.max(14, Math.round(w * 0.15));
    const cx = x + w / 2;

    ctx.fillStyle = '#ecf0f1';
    ctx.font = `bold ${titleFont}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(opt.label, cx, y + h * 0.4);

    ctx.fillStyle = '#2ecc71';
    ctx.font = `bold ${descFont}px monospace`;
    ctx.fillText(opt.desc, cx, y + h * 0.62);

    ctx.fillStyle = '#95a5a6';
    ctx.font = '12px monospace';
    ctx.fillText(`[${index + 1}]`, cx, y + h - 20);
  }
}
