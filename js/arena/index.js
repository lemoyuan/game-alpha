import { canvasW, canvasH, ARENA_W, ARENA_H, ABYSS } from '../consts';
import { getGroundTile, GROUND_TILE } from './ground';
import { coastPoints, traceCoast } from './coast';

export default class Arena {
  /**
   * 画地面 + 海洋深渊边界：岸形是 js/arena/coast.js 的不规则闭合曲线，
   * 菌毯按曲线裁切，深浅水分带沿曲线铺，所以边缘不是一条直线而是一圈能借来走位的海湾岬角
   * @param {object} ctx 已应用镜头平移
   * @param {object} camera 镜头，取左上角世界坐标算可见范围
   */
  draw(ctx, camera) {
    const camX = camera ? camera.x : 0;
    const camY = camera ? camera.y : 0;
    const x0 = Math.floor(camX / GROUND_TILE) * GROUND_TILE;
    const y0 = Math.floor(camY / GROUND_TILE) * GROUND_TILE;
    const x1 = Math.min(ARENA_W, camX + canvasW + GROUND_TILE);
    const y1 = Math.min(ARENA_H, camY + canvasH + GROUND_TILE);

    traceCoast(ctx); // 建一次路径，后面描边、裁切、分带全复用同一条

    // 1) 岸外海床：贴着 main.js 铺的深渊底色，从海岸线向外逐档淡出
    this.drawRamp(ctx, ABYSS.outer, ABYSS.deep, 1);

    // 2) 岸内：贴菌毯贴图，贴图被裁出来的硬边正是海岸线本身
    ctx.save();
    ctx.clip();
    const tile = getGroundTile();
    for (let y = Math.max(0, y0); y < y1; y += GROUND_TILE) {
      for (let x = Math.max(0, x0); x < x1; x += GROUND_TILE) {
        ctx.drawImage(tile, x, y, GROUND_TILE, GROUND_TILE);
      }
    }
    // 3) 岸内侧沉水带：菌毯沿曲线压向深水，走位时明暗跟着岸形走
    this.drawRamp(ctx, ABYSS.rim, ABYSS.deep, 0.92);
    ctx.restore();

    // 4) 海岸描边 + 浪花：描边给曲线一个明确的贴纸边缘，断断续续的浪花压在内侧
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ABYSS.line;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = ABYSS.foam;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.setLineDash([16, 26]); // 一段一段的浪头，比整条实线更像水而不像贴图边框
    ctx.lineDashOffset = -((Date.now() / 30) % 42); // 缓慢沿岸流动
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    this.drawMotes(ctx, camX, camY);
  }

  /**
   * 沿海岸线画一条从贴岸处渐到透明的阶梯带。
   * 描边是居中的，所以 lineWidth = 2*width 刚好向外盖住 width；由宽到窄套着画，
   * 每档的不透明度按累加公式取，叠完正好是一条线性斜坡（直给 alpha 会在拐角处越叠越深）
   * @param {object} ctx
   * @param {number} width 单侧宽度
   * @param {string} color 贴岸色
   * @param {number} alphaMax 贴岸处的最终不透明度
   */
  drawRamp(ctx, width, color, alphaMax) {
    const steps = ABYSS.steps;
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    let covered = 0; // 已经叠到多大的不透明度
    for (let i = 0; i < steps; i++) {
      const target = (alphaMax * (i + 0.5)) / steps; // i=0 最宽，铺到离岸最远处，要最淡
      ctx.globalAlpha = (target - covered) / (1 - covered);
      ctx.lineWidth = (2 * width * (steps - i)) / steps;
      ctx.stroke();
      covered = target;
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 深渊气泡光点：从海岸线上的定点出发、沿外法线往深海漂并淡出，纯装饰。
   * 位置全由序号算死 + 时间取模，不存状态不分配对象；只画镜头可见的那部分
   */
  drawMotes(ctx, camX, camY) {
    const pts = coastPoints();
    const t = Date.now() / 1000;
    const vx0 = camX - 20;
    const vy0 = camY - 20;
    ctx.fillStyle = ABYSS.mote;
    for (let i = 0; i < ABYSS.motes; i++) {
      const p = pts[(i * 137) % pts.length];
      const speed = ABYSS.moteSpeed * (0.5 + (i % 3) * 0.5);
      const d = ((i * 211) + t * speed) % ABYSS.moteRange;
      const off = ((i % 5) - 2) * 9; // 沿岸错开一点，别整整齐齐排在一条法线上
      const x = p.x + p.nx * d - p.ny * off;
      const y = p.y + p.ny * d + p.nx * off;
      if (x < vx0 || x > vx0 + canvasW + 40 || y < vy0 || y > vy0 + canvasH + 40) continue;
      ctx.globalAlpha = ABYSS.moteAlpha * (1 - d / ABYSS.moteRange);
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
