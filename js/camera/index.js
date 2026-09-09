import { canvasW, canvasH, ARENA_W, ARENA_H } from '../consts';

export default class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
  }

  follow(target) {
    this.x = target.x - canvasW / 2;
    this.y = target.y - canvasH / 2;
  }

  begin(ctx) {
    ctx.save();
    ctx.translate(-this.x, -this.y);
  }

  end(ctx) {
    ctx.restore();
  }
}
