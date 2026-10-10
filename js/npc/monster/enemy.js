import Sprite from '../../base/sprite';
import EnemyBullet from './enemyBullet';
import { clampToCoast } from '../../arena/coast';
import { SPRITE_ROTATES } from './config';
import { BURN_TICK, BURN_HOLD } from '../../consts';
// 玩法层取 UI 色是本仓库既有做法（bullet.js 就引 UI.ink），火苗和跳字必须与 theme 同源才不会各画各的
import { UI } from '../../ui/theme';

// 怪物基类：普通怪/宝箱怪共用，boss 可继承此类扩展
export default class Enemy extends Sprite {
  constructor(type, config) {
    // 贴图画布边长默认等于碰撞直径；需要「图比碰撞盒大一圈」（如 Boss 的伪足）时由 config.spriteSize 覆盖
    const size = config.spriteSize || config.radius * 2;
    super(config.sprite, size, size, 0, 0);
    this.type = type;
    this.radius = config.radius;   // 碰撞半径
    this.hp = config.hp;           // 当前血量
    this.maxHp = config.hp;        // 最大血量
    this.speed = config.speed;     // 移速
    this.color = config.color;     // 显示颜色
    this.xpValue = config.xp;      // 击杀掉落经验（0 = 不掉经验）
    this.damage = config.damage;   // 接触玩家的伤害（远程怪同时是子弹伤害）
    this.isBoss = !!config.boss;   // Boss 标记：HUD 血条、刷怪降速、图鉴文案都读它，来源和图鉴同源所以不会不一致
    // 贴图水平镜像（双子 Boss 一左一右共用一张成对图）：只影响 drawSprite，不参与碰撞、朝向或任何判定
    this.mirror = false;
    this.isDead = false;
    // 突变型刺头（概率见 config.js 的 MUTANT_CHANCE）：只表示「这只 basic 会额外掉一颗血块」，
    // type 仍然是 'basic'——图鉴解锁、HUD 计数、首页那张表都读 type，单列一个 type 等于凭空多出个喊不出的外号
    this.mutant = false;
    // 远程怪专属字段（近战怪为 0，走默认追击逻辑）
    this.attackRange = config.attackRange || 0;  // 索敌距离，玩家进入后停下射击
    this.attackCd = config.attackCd || 0;        // 射击间隔（毫秒）
    this.bulletSpeed = config.bulletSpeed || 0;
    this.bulletRadius = config.bulletRadius || 4;
    this.bulletColor = config.bulletColor || '#fff';
    this.lastAttack = 0;           // 上次射击时间戳（内部用）
    this.angle = 0;                // 朝向弧度（指向玩家）；仅当 SPRITE_ROTATES 为 true 时用于旋转贴图
    // 燃烧（子弹道具「燃烧子弹」挂上的状态）：一只怪身上最多一个实例，再命中只刷新时长
    // ★推进必须由 databus.js 的敌人循环调 updateBurn，不要搬进下面的 update：
    //   毒王 Boss 从不调 super.update，海火只在 chase、膜王只在 idle、菌群只在 lost 才调，
    //   挂进 update 等于燃烧在四只 Boss 里三只失效，而冒烟测试全是普通怪、看不出来
    this.burnLeft = 0;             // 燃烧剩余毫秒数（0 = 未燃烧）
    this.burnTickLeft = BURN_TICK; // 距下一次跳血的毫秒数（内部用）
    this.burnDamage = 0;           // 每跳跳多少血 = 玩家当时的燃烧子弹层数 × BURN_DMG
  }

  init(x, y) {
    this.x = x;
    this.y = y;
    this.isDead = false;
    // ★复位：和下面 burnLeft 那几条同一条对象池约定。spawner 因此必须在 init 之后才掷突变骰，
    //   放前面等于刚刷出来就被自己擦掉
    this.mutant = false;
    this.mirror = false; // 同上：不复位就是「池里复用的第二只继承上一只的朝向」，双子以外的人也会跟着翻面
    this.hp = this.maxHp;
    this.lastAttack = 0;
    // 对象池复用约定：漏掉这三行的话，一旦接上回收就是「刚刷出来的怪自带燃烧」
    // （现在 Pool.recover() 还没有调用点、敌人实际每次新建，所以这是保险不是救火）
    this.burnLeft = 0;
    this.burnTickLeft = BURN_TICK;
    this.burnDamage = 0;
  }

  update(dt, databus) {
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    this.angle = Math.atan2(dy, dx);

    // 远程怪：玩家在索敌距离内停下射击，超出距离才靠近
    if (this.attackRange > 0 && dist <= this.attackRange) {
      const now = Date.now();
      if (now - this.lastAttack > this.attackCd) {
        this.lastAttack = now;
        this.shoot(databus, dx / dist, dy / dist);
      }
    } else if (dist > 0) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }

    clampToCoast(this, this.radius);
  }

  shoot(databus, nx, ny) {
    const bullet = databus.pool.getItemByClass('enemyBullet', EnemyBullet);
    bullet.init(this.x, this.y, nx, ny, this.bulletSpeed, this.damage, this.bulletColor, this.bulletRadius);
    databus.enemyBullets.push(bullet);
  }

  // 受击结算的唯一入口：扣血 / 飘字 / 死亡标记。
  // 减伤类机制（膜王的 EPS 膜）覆写这个方法，不要再去 bullet.js 里加特判
  // color 只服务飘字着色（燃烧跳血传 UI.burn）；子类覆写时必须把它透传给 super.takeDamage，
  // 否则漏的那一只怪身上燃烧跳字会退回白色，其余全是橙色——局部错、默认对，冒烟测试查不出来
  takeDamage(dmg, isCrit, databus, color) {
    this.hp -= dmg;
    databus.addDamageText(this.x, this.y - this.radius, dmg, isCrit, color);
    if (this.hp <= 0) this.isDead = true;
  }

  // 燃烧上身的唯一入口：和 player.applyPoison 是同一套规矩——伤害取最强的那一下、时长只刷新，绝不相乘。
  // dmg 来自子弹开火时的快照（层数 × BURN_DMG），所以飞在路上的子弹不会中途变强
  applyBurn(dmg, hold) {
    if (this.burnLeft <= 0) {
      this.burnDamage = dmg;
      // 新起一次燃烧要把节拍归到 BURN_TICK（但不对齐 0）：不归的话上一轮残留的时钟会让
      // 第一跳提前到来，一次燃烧的总跳数就从 10 变成 11，「每 0.5 秒掉 1 血」这条承诺守不住
      this.burnTickLeft = BURN_TICK;
    } else {
      // ★这里故意不把 burnTickLeft 对齐到 0（player.applyPoison 是对齐的：赤潮池自身不造成瞬时伤害，
      //   需要立刻给反馈）。燃烧子弹的直击那一下就是反馈，再补一个同时跳出的数字只会读成「我子弹怎么只打 1 血」
      this.burnDamage = Math.max(this.burnDamage, dmg);
    }
    this.burnLeft = hold;
  }

  // 由 databus.js 每帧驱动（原因见构造函数那条 ★）。走 dt 不走 Date.now()：升级三选一开着时自然冻结
  updateBurn(dt, databus) {
    if (this.burnLeft <= 0 || this.isDead) return;
    this.burnLeft -= dt * 1000;
    this.burnTickLeft -= dt * 1000;
    if (this.burnTickLeft <= 0) {
      this.burnTickLeft += BURN_TICK; // 加不是清零：掉帧时这一跳不会被吞掉
      this.takeDamage(this.burnDamage, false, databus, UI.burn);
    }
    if (this.burnLeft <= 0) {
      this.burnLeft = 0;
      this.burnDamage = 0;
    }
  }

  // 火苗画在 main.js 的敌人绘制循环末尾（e.draw 之后），不画进本类的 draw：
  // 四个 Boss 子类都覆写了 draw 且 super.draw 前后还有自绘，基类里的 overlay 会被它们压掉
  drawBurn(ctx) {
    if (this.burnLeft <= 0 || this.isDead) return;
    const rest = this.burnLeft / BURN_HOLD;      // 余量：最后 1/3 段开始收小、变淡
    const r = 4 + this.radius * 0.22;            // 跟着体型走：Boss 上一朵固定 5px 的火等于没画
    const f = 0.85 + 0.15 * (this.burnTickLeft / BURN_TICK); // 节拍闪动来自状态，draw() 里不许调 Math.random
    // ★火苗画在血条右端外侧，不画在怪物正上方：飘字从 (x, y-radius) 这一列升起 26px，
    //   而燃烧跳字本身就是 UI.burn 橙色，压在橙色火苗上等于把这套机制唯一的数字反馈抹掉
    const cx = this.x + this.radius + r * 0.9;
    const base = this.y - this.radius - 12;      // 血条占 y-radius-8 到 y-radius-4，火苗必须浮在它上面
    const h = r * 1.9 * (0.55 + 0.45 * rest) * f;
    ctx.save();
    ctx.globalAlpha = Math.min(1, rest * 3);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, r * 0.24);
    ctx.strokeStyle = UI.ink;
    ctx.beginPath();
    ctx.moveTo(cx, base - h);
    ctx.bezierCurveTo(cx + r * 0.92, base - h * 0.5, cx + r * 0.7, base, cx, base);
    ctx.bezierCurveTo(cx - r * 0.7, base, cx - r * 0.92, base - h * 0.5, cx, base - h);
    ctx.closePath();
    ctx.fillStyle = UI.burn;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, base - h * 0.62);
    ctx.bezierCurveTo(cx + r * 0.4, base - h * 0.3, cx + r * 0.3, base, cx, base);
    ctx.bezierCurveTo(cx - r * 0.3, base, cx - r * 0.4, base - h * 0.3, cx, base - h * 0.62);
    ctx.closePath();
    ctx.fillStyle = UI.gold; // 内焰比外焰亮一档；HUD 那颗 14px 的 flame 用 cream，这里画在怪身上有十几像素，gold 才不至于糊成一团
    ctx.fill();
    ctx.restore();
  }

  // 贴图画布旋转角：子类可覆写（海火按身体自转角旋转贴图，而不是朝玩家）
  spriteAngle() {
    return SPRITE_ROTATES ? this.angle : 0;
  }

  draw(ctx) {
    // 宝箱怪整体闪烁，提示「击杀必掉宝箱」
    const alpha = this.type === 'chest'
      ? 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 200))
      : 1;
    if (!this.drawSprite(ctx, this.spriteAngle(), alpha, this.mirror)) {
      if (this.type === 'chest') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
        ctx.fillStyle = '#8b5a00';
        ctx.fillRect(this.x - this.radius, this.y - 3, this.radius * 2, 6);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 突变型：身上叠一块血斑。画在贴图之后、血条之前，两种画法（真贴图 / 兜底形状）都盖到
    if (this.mutant) {
      // 尺寸和偏移一律取 radius 的分数（刺头 radius=14，贴图边长正好也是 28，分数就是「占身子几分之几」）。
      // ★不在这几行里调 Math.random()：见上面 drawBurn 的同类注释，draw 里每帧随机会让斑块每帧变形
      const r = this.radius;
      ctx.save();
      // ★裁剪圆半径 0.80r 是实测出来的：mob_basic.png 的身子圆盘到 0.80 × 半边长才开始变透明。
      //   取小了（0.76/0.78）血斑外沿会留一圈 teal 缝，读成「盖了个贴纸」；取大了（0.82）血会渗进刺里。
      //   正好 0.80 时血斑外沿和身子描边齐平，看着才像这块身子本身在泛红
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 0.8, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = UI.blood;
      // 主斑压在左上肩，且刻意让它溢出裁剪圆（中心到圆心 0.55r + 半径 0.50r > 0.80r）——
      // 溢出去的那部分被身子圆切掉，血斑就有一条边是身子的弧线，这是「泛在身上的」和「贴上去的圆」的分界
      ctx.beginPath();
      ctx.arc(this.x - r * 0.46, this.y - r * 0.3, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // 卫星斑：不描边（两层圆各描一条会割出穿模的弧线），从主斑顶边「渗」出去一点，
      // 把整块血斑的轮廓从「一个正圆」扭成不规则形——正圆再像血也不像血
      ctx.beginPath();
      ctx.arc(this.x - r * 0.06, this.y - r * 0.58, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 血条
    if (this.hp < this.maxHp) {
      const bw = this.radius * 2;
      const bh = 4;
      const bx = this.x - this.radius;
      const by = this.y - this.radius - 8;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}
