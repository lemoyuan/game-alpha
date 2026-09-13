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
      const t = e.touches[0];
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

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.baseX, this.baseY, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(this.knobX, this.knobY, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  }
}
