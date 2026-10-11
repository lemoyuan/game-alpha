import Sprite from '../base/sprite';
import { UI } from '../ui/theme';

// 血块：突变型刺头（见 npc/monster/config.js 的 MUTANT_CHANCE）的专属掉落，拾取回血。
// 骨架逐行照 xpgem.js：同样是「落地不动、进磁吸半径才追人、碰到就 collected 由 main.js 回收」
export default class BloodClot extends Sprite {
  constructor() {
    super(null, 0, 0, 14, 14);
    // ★比经验宝石（radius 6）大一圈：两种地上拾取物要是同尺寸，绿菱形和红圆点在怪堆里会读成同一类东西
    this.radius = 7;
    this.value = 2;      // 回多少血，由掉落方从 BLOOD_CLOT_HEAL 传进来
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
    // ★满血也照吃、也照吸（10-11 改的口径）：原来这里整块 return 是为了不把开局第一颗血块白送，
    //   但血瓶进来之后「身上放不下的血」本身就有了去处，留一颗在原地当备用血包反而把那条通道堵死了。
    //   没捡到血瓶的玩家仍然纯浪费——那是没道具的应有代价，不该由这颗血块来兜
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 磁吸半径同样是角色属性（和 XP_PICKUP_RANGE、金匣「经验拾取范围」加成共用一个数）
    if (dist < player.pickupRange) {
      const speed = 300;
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }
    if (dist < player.radius + this.radius) {
      this.collected = true;
      const healed = player.heal(this.value);
      // 飘字只在身上真回了血时才画：溢出去的那一截进了瓶子，在脚下冒一个「+2」的红字是假反馈
      if (healed > 0) databus.addDamageText(this.x, this.y, `+${healed}`, false, UI.blood);
    }
  }

  draw(ctx) {
    const bob = Math.sin(Date.now() / 300 + this.bobOffset) * 2;
    const cy = this.y + bob;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = UI.ink;
    ctx.fillStyle = UI.blood;
    ctx.beginPath();
    ctx.arc(this.x, cy, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 左上角一颗白高光：厚描边卡通的那点体积感都靠它，没有的话就是一个纯色圆片
    ctx.fillStyle = UI.sticker;
    ctx.beginPath();
    ctx.arc(this.x - this.radius * 0.34, cy - this.radius * 0.38, this.radius * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
