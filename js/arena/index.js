import { ARENA_W, ARENA_H, TILE } from '../consts';

export default class Arena {
  draw(ctx) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= ARENA_W; x += TILE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ARENA_H);
      ctx.stroke();
    }
    for (let y = 0; y <= ARENA_H; y += TILE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA_W, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, ARENA_W - 4, ARENA_H - 4);
  }
}
