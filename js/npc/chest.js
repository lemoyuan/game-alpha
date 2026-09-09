import Sprite from '../base/sprite';
import { CHEST_RADIUS } from '../consts';

const BONUS_LABELS = {
  bulletCount: '子弹数 +1',
  pierce: '子弹穿透 +1',
  shield: '护盾 +1',
  companions: '跟班 +1',
};

// key 必须与 player 的属性名一致（companions 为复数）
const BONUS_KEYS = ['bulletCount', 'pierce', 'shield', 'companions'];

export default class Chest extends Sprite {
  constructor() {
    super(null, CHEST_RADIUS * 2, CHEST_RADIUS * 2, 0, 0);
    this.radius = CHEST_RADIUS;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2;
  }

  init(x, y) {
    this.x = x;
    this.y = y;
    this.collected = false;
    this.bobOffset = Math.random() * Math.PI * 2;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < player.radius + this.radius + 4) {
      this.collected = true;
      const key = BONUS_KEYS[Math.floor(Math.random() * BONUS_KEYS.length)];
      player[key]++;
      if (databus.hud) databus.hud.showToast(BONUS_LABELS[key]);
    }
  }

  draw(ctx) {
    const bob = Math.sin(Date.now() / 250 + this.bobOffset) * 2;
    const r = this.radius;
    const y = this.y + bob;

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
