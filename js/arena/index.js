import { canvasW, canvasH, ARENA_W, ARENA_H } from '../consts';
import { getGroundTile, GROUND_TILE } from './ground';

export default class Arena {
  /**
   * 画地面：只平铺镜头看得到的那几块贴图，2000×2000 全画一遍会白干几十倍功
   * @param {object} ctx 已应用镜头平移
   * @param {object} camera 镜头，取左上角世界坐标算可见范围
   */
  draw(ctx, camera) {
    const tile = getGroundTile();
    const camX = camera ? camera.x : 0;
    const camY = camera ? camera.y : 0;
    const x0 = Math.floor(camX / GROUND_TILE) * GROUND_TILE;
    const y0 = Math.floor(camY / GROUND_TILE) * GROUND_TILE;
    const x1 = Math.min(ARENA_W, camX + canvasW + GROUND_TILE);
    const y1 = Math.min(ARENA_H, camY + canvasH + GROUND_TILE);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA_W, ARENA_H);
    ctx.clip();
    for (let y = Math.max(0, y0); y < y1; y += GROUND_TILE) {
      for (let x = Math.max(0, x0); x < x1; x += GROUND_TILE) {
        ctx.drawImage(tile, x, y, GROUND_TILE, GROUND_TILE);
      }
    }
    ctx.restore();

    // 边界仍是代码画的红色描边，border_wall.png 到位后替换
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, ARENA_W - 4, ARENA_H - 4);
  }
}
