import Sprite from '../base/sprite';
import {
  DAMAGE_TEXT_DURATION, DAMAGE_TEXT_RISE, DAMAGE_TEXT_JITTER,
  DAMAGE_TEXT_COLOR, DAMAGE_TEXT_CRIT_COLOR,
  DAMAGE_TEXT_FONT, DAMAGE_TEXT_CRIT_FONT,
} from '../consts';

// 伤害飘字：怪物掉血时在命中点上浮出的数字，暴击用黄色放大高亮
export default class DamageText extends Sprite {
  constructor() {
    super(null, 0, 0, 0, 0);
    this.text = '';
    this.color = DAMAGE_TEXT_COLOR;
    this.fontSize = DAMAGE_TEXT_FONT;
    this.startY = 0;
    this.offsetX = 0;
    this.life = 0;
    this.isDestroyed = false;
  }

  // 对象池复用：所有可变字段都必须在这里重置
  init(x, y, damage, isCrit) {
    this.x = x;
    this.y = y;
    this.startY = y;
    this.text = `${damage}`;
    this.color = isCrit ? DAMAGE_TEXT_CRIT_COLOR : DAMAGE_TEXT_COLOR;
    this.fontSize = isCrit ? DAMAGE_TEXT_CRIT_FONT : DAMAGE_TEXT_FONT;
    this.offsetX = (Math.random() - 0.5) * DAMAGE_TEXT_JITTER;
    this.life = 0;
    this.isDestroyed = false;
  }

  update(dt) {
    this.life += dt * 1000;
    const t = Math.min(1, this.life / DAMAGE_TEXT_DURATION);
    this.y = this.startY - DAMAGE_TEXT_RISE * t;
    if (this.life >= DAMAGE_TEXT_DURATION) {
      this.isDestroyed = true;
    }
  }

  draw(ctx) {
    const t = Math.min(1, this.life / DAMAGE_TEXT_DURATION);
    ctx.globalAlpha = Math.max(0, 1 - t * t);
    ctx.fillStyle = this.color;
    ctx.font = `bold ${this.fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x + this.offsetX, this.y);
    ctx.globalAlpha = 1;
  }
}
