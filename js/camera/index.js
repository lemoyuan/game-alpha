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
    // 取整平移：小数平移会让平铺贴图边缘被重采样钳位出一条亮线，角色贴图也跟着发糊
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }

  end(ctx) {
    ctx.restore();
  }
}
