import Enemy from './enemy';
import Vesicle from './vesicle';
import { loadImage } from '../../base/sprite';
import { clampToCoast } from '../../arena/coast';
import { UI } from '../../ui/theme';

/**
 * 四号 Boss：双子弟兄（肺炎链球菌的双球菌态）。一次出场两只，行为各自独立，
 * 只有「一只死了 → 另一只激怒」这条边把它们连在一起。
 *
 * 三个行为都对应真实机制，不是三个随机技能：
 *   抛囊泡 = 它把溶血素（pneumolysin）打包进自己鼓出来的膜泡里往外投递；
 *   自溶爆 = LytA Amidase 把细胞壁从自己内部剪开、瞬间倾空全部溶血素；
 *   丧兄激怒 = fratricide（同胞相食）：死掉的兄弟把游离 DNA 交给活着的它，
 *              让它直接进感受态（competence）改表达——「兄弟死了它变强」在显微镜下是真的。
 *
 * ★两只都是普通 Enemy 子类，走 main.js 现成的接触伤害、掉落、图鉴解锁，没有一条专属结算路径。
 *   成对出场、跨实体引用和镜像都在 spawner.spawnBoss 里做（那里才同时看得见两只）。
 */

// 出场到第一个技能的间隔（毫秒）：和毒王那条同理，先给玩家一段"看清这是两只"的时间
const FIRST_SKILL_DELAY = 2500;

// —— 贴图锚点：120×120 画布实测（.preview/grid_dump.ps1 出的 6× 带格图），换算成 width/height 的分数 ——
// 囊口（那根斜伸到左上的炮管口）圆心 (12,13)、外圈半径 13；平时态与激怒态这两处逐像素同位，所以两个状态共用一套锚点
const MOUTH = { x: -0.40, y: -0.39, r: 0.108 };
// 弟弟的识别贴钉在囊口右上那颗囊泡上：实测球心 (17,9)、半径 4.5。刻意比实测大 22%，
// 刚好盖住那颗球又不出炮口（炮口外圈到 0.108w，这里 0.055w + 偏心 0.06w 仍在圈内）
const MARK = { x: -0.358, y: -0.425, r: 0.055 };

export default class BossTwins extends Enemy {
  constructor(type, config) {
    super(type, config);
    this.isBoss = true;
    // 激怒态换图用的两条路径：Sprite 只留了 this.img，对象池复用时要靠这两个原始值复位
    this.spriteNormal = config.sprite;
    this.spriteRage = config.spriteRage || '';

    // —— 抛囊泡 ——
    // ★三条 *0 是原始值：激怒会就地除冷却、乘移速，对象池复用时必须连这三条一起复位，
    //   否则「刚刷出来的第二只自带激怒态」不会报错，只会让血量曲线和攻速曲线各说各话
    this.throwCd0 = config.throwCd;
    this.burstCd0 = config.burstCd;
    this.speed0 = config.speed;
    this.throwCd = this.throwCd0;
    this.throwT = 0;
    this.throwMinDist = config.throwMinDist; // 玩家离到这么远才抛：贴脸时抛弹等于给自己让位
    this.vesicleDamage = config.vesicleDamage;
    this.vesicleBlastR = config.vesicleBlastR;
    this.vesicleFlyMult = config.vesicleFlyMult; // 滞空倍率，作用在父类算好的 flyMs 上（理由见 config 的注释）
    this.stainTint = config.stainTint;
    // 毒渍四参打包一份：Vesicle 落地时原样转给 Zone
    this.stain = {
      radius: config.stainRadius,
      life: config.stainLife,
      damage: config.stainDamage,
      hold: config.stainHold,
    };

    // —— 自溶爆 ——
    this.burstCd = this.burstCd0;
    this.burstT = 0;
    this.burstWarn = config.burstWarn;
    this.burstRadius = config.burstRadius;
    this.burstDamage = config.burstDamage;
    this.burstFade = config.burstFade;
    this.bursting = false;
    this.burstLeft = 0; // 读条剩余毫秒
    this.flashLeft = 0; // 爆盘淡出剩余毫秒（只影响画法）

    // —— 成对 ——
    this.pairSpan = config.pairSpan; // 两只在场上维持的中心距下限（同一个数也用于出场摆位，见 spawner.spawnBoss）

    // —— 丧兄激怒 ——
    this.enrageRate = config.enrageRate;
    this.enrageSpeedMult = config.enrageSpeedMult;
    this.enraged = false;
    this.twin = null;      // 另一只的活引用：全项目没有事件钩子，"兄弟死了"只能轮询 isDead
    this.twinIndex = 0;    // 0 = 兄、1 = 弟（识别贴只画在弟弟身上），由 spawner 在 init 之后写

    // 呼吸发光的相位：构造期定一次。★draw 里不许 Math.random，否则每帧换一个相位、截图不可复现
    this.seed = Math.random() * Math.PI * 2;
  }

  init(x, y) {
    super.init(x, y);
    // ★三条都得复位，漏一条就是「池里复用的第二只自带激怒态」：贴图是红的、冷却是除过的
    this.enraged = false;
    this.twin = null;
    this.twinIndex = 0;
    this.throwCd = this.throwCd0;
    this.burstCd = this.burstCd0;
    this.speed = this.speed0;
    if (this.spriteRage) this.img = loadImage(this.spriteNormal);
    this.bursting = false;
    this.burstLeft = 0;
    this.flashLeft = 0;
    // 倒着算比再加一个"是否首招"的标记省一个状态（同 boss.js 那条）
    this.throwT = this.throwCd - FIRST_SKILL_DELAY;
    this.burstT = this.burstCd - FIRST_SKILL_DELAY;
  }

  update(dt, databus) {
    // ★残尸不做事：databus 对 isDead 的敌人这一帧照样调 update，两只同一帧被打死时，
    //   先死的那只如果继续跑，会立刻把自己也"激怒"一遍并把自溶爆放出去
    if (this.isDead) return;
    const ms = dt * 1000;

    if (this.twin && this.twin.isDead) this.enrage();

    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    if (this.flashLeft > 0) this.flashLeft = Math.max(0, this.flashLeft - ms);

    if (this.bursting) {
      // 读条期间整个身子钉住：自溶是"把自己撑到极限再裂开"，一边跑一边胀会被读成蓄力位移。
      // 两条冷却也跟着停表（增量写在下面这段之外），所以自爆的 7 秒是从"炸完"起算，不是从"起念"起算
      this.burstLeft -= ms;
      if (this.burstLeft <= 0) this.detonateSelf(databus);
      return;
    }

    this.throwT += ms;
    this.burstT += ms;

    // 两条独立冷却就近择机（写法照 bossFilm.tryCast）：贴脸先自溶，够远才抛，都没到点就走上身
    if (this.burstT >= this.burstCd && dist <= this.burstRadius * 1.15) {
      this.bursting = true;
      this.burstLeft = this.burstWarn;
      return;
    }
    if (this.throwT >= this.throwCd && dist >= this.throwMinDist) {
      this.throwVesicle(databus);
      return;
    }

    this.x += (dx / dist) * this.speed * dt;
    this.y += (dy / dist) * this.speed * dt;
    clampToCoast(this, this.radius);
    this.separateFromTwin();
  }

  /**
   * 成对不重叠：两只都朝同一个目标走，光靠出场摆位撑不过两三秒（2026-10-10 实测：出场 119 →
   *   追上玩家之后挤到 65，半径 26 的两条命几乎重叠，"间距大一点"等于没生效）。
   *   所以 pairSpan 必须是【每帧维持的下限】而不是只用于出生那一帧。
   * ★各让一半而不是固定让某一方：只让 i=0 那只让步的话，两只会在"一只追一只退"里绕圈，
   *   而且弟弟永远站在哥哥和玩家中间，读成"哥哥是跟班"
   */
  separateFromTwin() {
    const twin = this.twin;
    if (!twin) return; // 兄弟已死：enrage() 会把引用断开（一次性边），这里天然不再撑距
    const ox = this.x - twin.x;
    const oy = this.y - twin.y;
    const od = Math.sqrt(ox * ox + oy * oy) || 1;
    if (od >= this.pairSpan) return;
    const push = (this.pairSpan - od) / 2;
    this.x += (ox / od) * push;
    this.y += (oy / od) * push;
    clampToCoast(this, this.radius);
  }

  // 丧兄：只翻一次的 latch，翻完立刻断开引用
  enrage() {
    if (this.enraged) return;
    this.enraged = true;
    // ★断引用而不是留着：接上对象池之后，兄弟那只会被复用成一条 isDead=false 的新怪，
    //   留着引用等于"复活即再激怒一次"，而这条边本来就该是一次性的
    this.twin = null;
    if (this.spriteRage) this.img = loadImage(this.spriteRage); // imageCache 按 src 复用，别 new Image
    this.throwCd /= this.enrageRate;
    this.burstCd /= this.enrageRate;
    // 两条计数按同一倍率缩回去：只除冷却的话 throwT/burstT 会当场越过新 cd，
    // 丧兄那一瞬间就是"齐射 + 自爆"双响，玩家那点该喘的气一口气全扣光
    this.throwT /= this.enrageRate;
    this.burstT /= this.enrageRate;
    this.speed *= this.enrageSpeedMult;
  }

  // 出手点在囊口（斜伸到左上那根管子的口），不是身子中心：抛出去的弧线得看得出从哪儿来的
  mouthPos() {
    const s = this.mouthSign();
    return {
      x: this.x + MOUTH.x * this.width * s,
      y: this.y + MOUTH.y * this.height,
    };
  }

  // 镜像的那只囊口在另一侧：+1 / -1
  mouthSign() {
    return this.mirror ? -1 : 1;
  }

  throwVesicle(databus) {
    this.throwT = 0;
    const player = databus.player;
    if (!player) return;
    const from = this.mouthPos();
    // 落点就是玩家此刻站的地方，不提前量：滞空 0.9~1.9 秒，走位躲得开，而躲开之后那片毒渍
    // 正好落在"你刚才逃出去的那条路"上——这才是要不要继续站着的决策，不是必中的橡皮筋
    const target = { x: player.x, y: player.y };
    // ★只夹落点，飞行那条弦不夹（同 bomber.js）：夹弦线会让囊泡贴着海岸急转弯
    clampToCoast(target, 6);
    const vesicle = databus.pool.getItemByClass('vesicle', Vesicle);
    vesicle.init(
      from.x, from.y, target.x, target.y,
      this.vesicleDamage, this.stainTint, this.vesicleBlastR, this.stain
    );
    // ★在投掷方缩放而不是给 init 续第 9 个 positional（那条旧账见 vesicle.js 的 init 注释）：
    //   父类已经按距离算好并夹好了 flyMs，这里只整体拉长，"远弹飞得久"那条映射一点没动
    vesicle.flyMs *= this.vesicleFlyMult;
    databus.vesicles.push(vesicle);
  }

  // 自溶爆：以自身圆心的一次性结算
  // ★为什么不生成实体（海火的激光、膜王的黏液都生成了）：那两条一个是飞行物、一个是持续区，
  //   都得活过这一帧才有意义。自溶是瞬时、圆心就在自己身上、放完就散——做成实体等于
  //   为一次加法多开一条列表，而淡出那 380ms 挂在放它的人身上更省
  detonateSelf(databus) {
    this.bursting = false;
    this.burstT = 0;
    this.flashLeft = this.burstFade;
    const player = databus.player;
    if (!player) return;
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const r = this.burstRadius + player.radius;
    if (dx * dx + dy * dy < r * r) {
      // ★applyBlast 不是 takeDamage：读条结束那一帧玩家多半还挂着贴身接触的无敌帧，
      //   走 takeDamage 这一下（burstDamage）会整发被吞掉（赤潮池当年的旧账，见 config.js 的 poolDamage）
      player.applyBlast(this.burstDamage);
    }
    // ★无自代价是定过的口径：真实的 LytA 自溶确实会杀死这一个细胞，但这局的"代价"已经由
    //   丧兄激怒那条边付掉了——死掉的那只就是代价。这里再扣一次血等于同一件事收两遍费，
    //   而且会让"两只一起贴上来"变成玩家乐见的送死，方向正好反了
  }

  // 读条期间身子胀到 1.18 倍：胀这个动作本身就是倒计时，比再画一根进度条更读得出来
  swellScale() {
    if (this.bursting && this.burstWarn > 0) {
      return 1 + 0.18 * (1 - this.burstLeft / this.burstWarn);
    }
    return 1;
  }

  draw(ctx) {
    const s = this.swellScale();
    // 只胀贴图：基类那条小血条读的是 this.radius，所以血条不会跟着变粗、也不会往下挪
    const w0 = this.width;
    const h0 = this.height;
    if (s !== 1) {
      this.width = w0 * s;
      this.height = h0 * s;
    }
    super.draw(ctx);
    this.width = w0;
    this.height = h0;

    if (this.bursting) this.drawWarn(ctx);
    if (this.flashLeft > 0) this.drawFlash(ctx);

    // —— 下面两段都钉在囊口这个解剖位置上，所以必须走和 drawSprite 同一个镜像 ——
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.mouthSign(), 1);
    const mx = MOUTH.x * w0 * s;
    const my = MOUTH.y * h0 * s;
    if (this.twinIndex === 1) this.drawMark(ctx, mx, my, w0 * s);
    if (this.enraged) this.drawPulse(ctx, mx, my, w0 * s);
    ctx.restore();
  }

  // 读条圈：流动虚线圈 = "这里马上要疼"。★这一圈用 UI.red 不用 stainTint：
  //   仓库的视觉语法是「红 = 本体马上要炸/要冲」（毒王冲锋预警同色），「酸黄虚线 = 这块地要落毒」
  //   （囊泡落点环与它将要留下的毒渍同色）。两道圈同色的时候，"它身上要炸"和"它要落一摊"读成一件事
  drawWarn(ctx) {
    const t = 1 - this.burstLeft / this.burstWarn;
    ctx.save();
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -((this.burstWarn - this.burstLeft) / 26 % 21);
    ctx.strokeStyle = UI.red;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = Math.min(1, 0.25 + 0.55 * t);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.burstRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = UI.red;
    ctx.globalAlpha = 0.1 * t;
    ctx.fill();
    ctx.restore();
  }

  // 爆盘：三层平涂盘从中心摊开、边淡出边长大（同 Bomb.drawBlast，无渐变无 shadowBlur）
  drawFlash(ctx) {
    const k = 1 - this.flashLeft / this.burstFade;
    const a = 1 - k;
    const rr = Math.max(0.5, this.burstRadius * (0.34 + 0.66 * k)); // arc 传负半径会抛 IndexSizeError
    ctx.save();
    ctx.fillStyle = this.stainTint;
    ctx.globalAlpha = 0.34 * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI.cream;
    ctx.globalAlpha = 0.6 * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rr * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.55 * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 弟弟识别贴：囊口右上那颗囊泡染成金。两只贴图只差一个镜像，玩家很容易读成"同一只的残影"，
  // 这一颗的作用就是说清"这是两只，各有一条命"
  drawMark(ctx, mx, my, size) {
    ctx.save();
    ctx.fillStyle = UI.gold;
    ctx.beginPath();
    ctx.arc(mx, my, MARK.r * size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.restore();
  }

  // 激怒期囊口呼吸发光：抛弹冷却已经被除以 1.8，这一圈就是它的可视化——亮到发白就是又要抛了
  // ★用 cream 不用 gold：激怒态整张身子本身就是金黄，同色发光等于没有（和「同色读不出来」那几条旧账同一类）
  drawPulse(ctx, mx, my, size) {
    const phase = 0.5 + 0.5 * Math.sin(this.seed + Date.now() / 260);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.4 * phase;
    ctx.strokeStyle = UI.cream;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, my, MOUTH.r * size * (0.9 + 0.18 * phase), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = UI.cream;
    ctx.globalAlpha = 0.1 + 0.16 * phase;
    ctx.fill();
    ctx.restore();
  }
}
