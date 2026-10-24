import { UI } from './theme';
import { pauseButtonRect, skillButtonRect } from './hud';

const PAD = 8; // HUD 触点向外扩这么多：手指不必精确落在那几枚 26~56 像素的贴面上

export default class Joystick {
  constructor() {
    this.active = false;
    this.baseX = 0;
    this.baseY = 0;
    this.knobX = 0;
    this.knobY = 0;
    this.dirX = 0;
    this.dirY = 0;
    this.radius = 55;
    this.touchId = null;
  }

  init(databus) {
    wx.onTouchStart((e) => {
      if (databus.screen !== 'game') return; // 首页点击不参与摇杆
      if (this.active || this.touchId !== null) return;
      if (databus.isPaused) return; // 暂停页与三选一开着时，屏幕底下不该有东西被拖动
      const t = e.touches[0];
      // 摇杆要让位的 HUD 触点。★两枚矩形都由 hud.js 算（pauseButtonRect / skillButtonRect），
      //   这里只列名单：以后加第三枚键只要补一项，各自量一遍迟早对不齐
      // ★主动键只在画出来的时候才让位：道具没拿到时那一格是空的，凭空吞掉一块起手位比键点不动更难查
      const blocks = [pauseButtonRect()];
      if (databus.player.membrane > 0) blocks.push(skillButtonRect());
      for (const rc of blocks) {
        if (t.clientX >= rc.x - PAD && t.clientX <= rc.x + rc.w + PAD
          && t.clientY >= rc.y - PAD && t.clientY <= rc.y + rc.h + PAD) return;
      }
      this.active = true;
      this.touchId = t.identifier;
      this.baseX = t.clientX;
      this.baseY = t.clientY;
      this.knobX = t.clientX;
      this.knobY = t.clientY;
      this.dirX = 0;
      this.dirY = 0;
    });

    wx.onTouchMove((e) => {
      if (!this.active) return;
      for (const t of e.touches) {
        if (t.identifier === this.touchId) {
          const dx = t.clientX - this.baseX;
          const dy = t.clientY - this.baseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clamped = Math.min(dist, this.radius);
          if (dist > 0) {
            this.knobX = this.baseX + (dx / dist) * clamped;
            this.knobY = this.baseY + (dy / dist) * clamped;
            this.dirX = dx / dist;
            this.dirY = dy / dist;
          }
          break;
        }
      }
    });

    const end = (e) => {
      let found = false;
      if (e.touches) {
        for (const t of e.touches) {
          if (t.identifier === this.touchId) { found = true; break; }
        }
      }
      if (!found) {
        this.active = false;
        this.touchId = null;
        this.dirX = 0;
        this.dirY = 0;
      }
    };
    wx.onTouchEnd(end);
    wx.onTouchCancel(end);
  }

  getDirection() {
    return { x: this.dirX, y: this.dirY };
  }

  draw(ctx) {
    if (!this.active) return;
    ctx.save();
    // 底盘：半透明深色 + 粗描边 + 外圈白贴纸，战斗中不能挡住怪
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(this.baseX, this.baseY, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = UI.bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = UI.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.baseX, this.baseY, this.radius + 3, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = UI.sticker;
    ctx.stroke();

    // 摇杆头：蓝色帽 + 白外圈 + 深色描边
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(this.knobX, this.knobY, 24.5, 0, Math.PI * 2);
    ctx.fillStyle = UI.sticker;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.knobX, this.knobY, 22, 0, Math.PI * 2);
    ctx.fillStyle = UI.blue;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = UI.ink;
    ctx.stroke();
    ctx.restore();
  }
}
