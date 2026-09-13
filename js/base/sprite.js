import Emitter from '../libs/tinyemitter';

// 同一张图会被大量实体反复使用（刷怪每次都 new Enemy），按 src 缓存，避免重复创建和解码
const imageCache = {};
export function loadImage(src) {
  if (!imageCache[src]) {
    const img = wx.createImage();
    img.src = src;
    imageCache[src] = img;
  }
  return imageCache[src];
}

/**
 * 游戏基础的精灵类
 * 约定：所有子类（Player/Enemy/XpGem/Chest…）的 x/y 都是「中心坐标」，width/height 是显示尺寸
 */
export default class Sprite extends Emitter {
  visible = true; // 是否可见
  isActive = true; // 是否可碰撞

  constructor(imgSrc = '', width = 0, height = 0, x = 0, y = 0) {
    super();

    this.img = imgSrc ? loadImage(imgSrc) : null;

    this.width = width;
    this.height = height;

    this.x = x;
    this.y = y;

    this.visible = true;
  }

  /**
   * 以中心为锚点绘制贴图，可选朝向旋转
   * @param {number} angle 朝向弧度；「头朝 +x（向右）」画的批次传 Math.atan2(vy, vx)，正面朝上画的批次传 0（由 SPRITE_ROTATES 决定）
   * @param {number} alpha 透明度，省略为 1
   * @returns {boolean} 贴图未加载完成时返回 false，调用方回退到程序绘制的占位形状
   */
  drawSprite(ctx, angle = 0, alpha = 1) {
    const img = this.img;
    if (!img || !img.width || !img.height) return false;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(img, -this.width / 2, -this.height / 2, this.width, this.height);
    ctx.restore();
    return true;
  }

  /**
   * 圆形碰撞：双方碰撞半径相交即算命中（x/y 是中心坐标，radius 是碰撞半径）
   * @param{Sprite} sp: Sptite的实例
   */
  isCollideWith(sp) {
    // 不可见则不检测
    if (!this.visible || !sp.visible) return false;
    // 不可碰撞则不检测
    if (!this.isActive || !sp.isActive) return false;

    const dx = sp.x - this.x;
    const dy = sp.y - this.y;
    const r = this.radius + sp.radius;
    return dx * dx + dy * dy < r * r;
  }
}
