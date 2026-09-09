import { canvasW, canvasH, UPGRADES } from '../consts';

export default class UpgradeScreen {
  constructor() {
    this.visible = false;
    this.options = [];
    this._databus = null;
  }

  init(databus) {
    this._databus = databus;
    wx.onTouchStart((e) => {
      if (!this.visible) return;
      const t = e.touches[0];
      const { cardW, cardH, gap, startY } = this.layout();
      const totalW = this.options.length * cardW + (this.options.length - 1) * gap;
      const startX = (canvasW - totalW) / 2;
      for (let i = 0; i < this.options.length; i++) {
        const x = startX + i * (cardW + gap);
        if (t.clientX >= x && t.clientX <= x + cardW &&
            t.clientY >= startY && t.clientY <= startY + cardH) {
          this.select(i, databus.player);
          databus.isPaused = false;
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
    const pool = [...UPGRADES];
    this.options = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      this.options.push(pool.splice(idx, 1)[0]);
    }
  }

  select(index, player) {
    const opt = this.options[index];
    if (!opt) return;
    if (opt.mult) {
      player[opt.key] = Math.round(player[opt.key] * (1 + opt.value) * 100) / 100;
    } else {
      player[opt.key] += opt.value;
    }
    if (opt.key === 'maxHp') {
      player.hp = Math.min(player.hp + opt.value, player.maxHp);
    }
    this.visible = false;
  }

  draw(ctx) {
    if (!this.visible) return;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL UP!', canvasW / 2, canvasH * 0.12);

    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.fillText('Choose an upgrade', canvasW / 2, canvasH * 0.12 + 35);

    const { cardW, cardH, gap, startY } = this.layout();
    const totalW = this.options.length * cardW + (this.options.length - 1) * gap;
    const startX = (canvasW - totalW) / 2;

    const titleFont = Math.max(12, Math.round(cardW * 0.12));
    const descFont = Math.max(14, Math.round(cardW * 0.15));

    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const x = startX + i * (cardW + gap);
      const cx = x + cardW / 2;

      ctx.fillStyle = '#2c3e50';
      ctx.fillRect(x, startY, cardW, cardH);
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, startY, cardW, cardH);

      ctx.fillStyle = '#ecf0f1';
      ctx.font = `bold ${titleFont}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(opt.label, cx, startY + cardH * 0.4);

      ctx.fillStyle = '#2ecc71';
      ctx.font = `bold ${descFont}px monospace`;
      ctx.fillText(opt.desc, cx, startY + cardH * 0.62);

      ctx.fillStyle = '#95a5a6';
      ctx.font = '12px monospace';
      ctx.fillText(`[${i + 1}]`, cx, startY + cardH - 20);
    }
  }
}
