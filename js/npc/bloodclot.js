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
    // ★满血时既不磁吸也不吞：开局就是满血（PLAYER_MAX_HP），要是在这儿也收掉，
    //   第一颗血块几乎必然白送——而两秒后玩家可能就残血了。留在原地当备用的血包
    if (player.hp >= player.maxHp) return;
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
      const healed = player.heal(this.value);
      // 回复量为 0 就不收：宁可让它继续躺在场上，也不要吃掉一颗而什么都不给
      if (healed > 0) {
        this.collected = true;
        databus.addDamageText(this.x, this.y, `+${healed}`, false, UI.blood);
      }
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
