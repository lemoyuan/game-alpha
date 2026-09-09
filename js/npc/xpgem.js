import Sprite from '../base/sprite';

export default class XpGem extends Sprite {
  constructor() {
    super(null, 0, 0, 12, 12);
    this.radius = 6;
    this.value = 1;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2;
  }

  init(x, y, value) {
    this.x = x;
    this.y = y;
    this.value = value;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 80) {
      const speed = 300;
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }
    if (dist < player.radius + this.radius) {
      this.collected = true;
      player.addXp(this.value, databus);
    }
  }

  draw(ctx) {
    const bob = Math.sin(Date.now() / 300 + this.bobOffset) * 2;
    ctx.fillStyle = '#2ecc71';
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - this.radius + bob);
    ctx.lineTo(this.x + this.radius, this.y + bob);
    ctx.lineTo(this.x, this.y + this.radius + bob);
    ctx.lineTo(this.x - this.radius, this.y + bob);
    ctx.closePath();
    ctx.fill();
  }
}
