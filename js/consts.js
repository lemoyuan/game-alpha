import { canvasWidth, canvasHeight } from './render';

export const ARENA_W = 2000;            // 地图宽（像素）
export const ARENA_H = 2000;            // 地图高（像素）
export const GAME_TITLE = 'game-alpha'; // 游戏标题（暂定名，首页/分享文案统一读这里）
export const TILE = 64;                 // 地面网格尺寸

// 地面「菌毯」：程序绘制到离屏画布后反复平铺，画法见 js/arena/ground.js
// 不用 AI 贴图：生成图带水印，且四边对不上，2000×2000 地图平铺会露接缝
export const GROUND = {
  repeat: 8,          // 一块贴图覆盖 8×8 个 TILE 网格（TILE=64 → 一块 512 逻辑像素，比屏幕还宽，看不出重复）
  scale: 2,           // 离屏贴图按 2 倍分辨率绘制，缩到真机 @2x 不糊；改 1 省内存会变糊
  seed: 20260914,     // 固定随机种子：每次运行地面一样，方便对比调参
  base: '#2A3A3A',    // 底色：深青绿菌毯；怪物识别色多是绿和青，底色往蓝偏一点能同时拉开明度和色相
  tones: ['#243434', '#314342', '#203030', '#374A46', '#29393A'], // 斑块色：彼此只差一档，做出起伏但不抢识别色
  outline: '#182728', // 斑块描边：比底色再暗一档的墨青，只负责分块，不能和怪物外描边抢线
  outlined: 0.55,     // 勾边斑块占比：1 = 每块都描边（像彩色玻璃），0 = 全靠色块明暗分界
  line: 2,            // 描边宽度（逻辑像素）；改粗地面显脏，改细会压不过斑块色
  patches: 46,        // 每块贴图内的斑块数量：越大越密，超过 60 会盖不住底色
  minR: 0.05,         // 斑块最小半径（× 贴图边长）
  maxR: 0.15,         // 斑块最大半径（× 贴图边长）：和 minR 差距越大，大小错落越自然
  speckles: 120,      // 每块贴图内的斑点数量：原来是 220，深底上太密会看成满地掉落物，减半
  speckle: '#42595C', // 斑点颜色：只比底色亮一档的暗青；旧的奶油白在深底上会看成经验宝石
};

// 海洋深渊边界：菌毯沿「不规则海岸线」沉入深水，海岸线同时是真实的运动边界
// 曲线 = 基线内缩 + 三段正弦叠加（海湾+岬角），画法见 js/arena/coast.js 与 js/arena/index.js
export const ABYSS = {
  far: '#05080F',           // 深渊底色（main.js 的全屏底色）
  deep: '#0E1A26',          // 贴岸深水色：分带从这里渐到 far
  line: '#04070D',          // 海岸描边线：给曲线一个明确的贴纸边缘，替代旧红框；必须比 deep 明显暗才看得出岸在哪
  foam: '#7FB4B0',          // 浪花线：压在描边内侧，亮度低、只点一条
  rim: 150,                 // 岸内侧沉水带宽度：菌毯沿曲线逐渐压暗，走位时明暗跟着岸形走
  outer: 130,               // 岸外侧海床带宽：deep → 深渊底色的分带
  steps: 5,                 // 内外分带档数：档越多渐变越顺，每档一次描边，5 档是性能甜点
  coast: {
    base: 120,              // 海岸线平均内缩距离（离矩形边的距离）
    waves: [
      [46, 0.0032, 0.0],    // [振幅, 频率, 相位] 大湾：波长 ~2π/0.0032 ≈ 2000px，一圈正好两三个大海湾
      [26, 0.0091, 1.3],    // 中岬：~700px 一个，走位借用的凸角主要来自这档
      [12, 0.0210, 2.9],    // 小弯：~300px，让线不显得"电动"
    ],                      // 三档振幅合计 84：内缩在 36~204 之间起伏；改大振幅更曲折，超过 100 会咬掉太多可玩区
  },
  motes: 40,                // 深渊气泡光点数量：沿海岸法线外漂，确定性布点，不存状态
  moteRange: 260,           // 气泡离岸漂多远，同时是淡出全程
  moteSpeed: 14,            // 气泡外漂速度（像素/秒）
  moteAlpha: 0.22,          // 气泡最大不透明度（离岸越远越淡）
  mote: '#4A6A7A',          // 气泡颜色：暗青灰，压得比怪物识别色低很多，不抢视线
};

export const PLAYER_SPRITE = 'images/entity/player_idle.png'; // 角色贴图：俯视持枪，按「枪口朝右（+x）」出图，运行时旋转到索敌方向
export const PLAYER_RADIUS = 16;        // 角色碰撞半径
export const PLAYER_SPRITE_SIZE = 42;   // 角色贴图显示边长（逻辑像素），与碰撞半径解耦；持枪横向剪影按宽缩放后身体偏小，靠这个值调大小
export const PLAYER_MUZZLE_LEN = 19;    // 枪口到身体中心的距离：子弹与枪口火光都从这里出发
export const PLAYER_MUZZLE_FLASH = 90;  // 枪口火光持续毫秒数（代码绘制，不出图）
export const PLAYER_SPEED = 170;        // 初始移速（升级项：移动速度 +15%）
export const PLAYER_MAX_HP = 40;       // 初始生命上限（升级项：生命上限 +20）
export const PLAYER_ATK = 10;           // 初始攻击力，=子弹伤害（升级项：攻击力 +3）
export const PLAYER_DEF = 0;            // 初始防御，接触伤害减免（升级项：防御力 +2）
export const PLAYER_ATTACK_RANGE = 200; // 索敌距离；子弹飞行距离 = 此值 + BULLET_RANGE_BUFFER
export const PLAYER_ATTACK_CD = 1000;   // 基础攻击间隔（毫秒）：攻速 1.0 = 每 1 秒 1 发，实际间隔 = 此值 ÷ 攻速
export const PLAYER_INVINCIBLE = 1500;   // 受击后无敌时间（毫秒）
export const POISON_TICK = 500;         // 中毒每跳一次伤害的间隔（毫秒）。★故意不复用上面那条无敌帧：无敌帧是「一次撞击」的限流器，毒素是挂在身上的状态，走那条路就会被别的伤害源白吃掉结算（赤潮池原来正是这么变成摆设的）
export const PLAYER_CRIT_RATE = 0;   // 初始暴击率（升级项：暴击率 +10%）
export const PLAYER_CRIT_MULT = 1.5;      // 暴击伤害倍数
export const PLAYER_LUCK = 0;           // 初始幸运值（升级项：幸运值 +1）：每点提高金匣刷新概率，曲线见 js/npc/monster/config.js 的 chestChance

export const BULLET_SPEED = 600;        // 子弹飞行速度
export const BULLET_RADIUS = 5;         // 主角子弹半径（跟班子弹见 COMPANION_BULLET_RADIUS）
export const BULLET_COLOR = '#F5B041';  // 主角子弹颜色：与 HUD 子弹图标同色（theme.js 的 UI.gold），白点在深地面上读不出方向
export const BULLET_DAMAGE = 10;        // （未直接使用，实际伤害取 player.attack）
export const BULLET_RANGE_BUFFER = 50;  // 子弹飞行距离在索敌距离基础上的缓冲
export const PIERCE_DAMAGE_FALLOFF = 0.6; // 穿透衰减：子弹每穿过一个目标，后续伤害变为上一次的 60%（改成 1 即不衰减）
export const SHOT_SPREAD = 0.18;        // 多发弹的相邻张角（弧度），主角 bulletCount 与跟班齐射共用
// ★两处共用一个数是故意的：主角三发和跟班三发同帧飞出时，两张扇面必须看起来是同一套机械，
//   差 0.02 弧度在 200px 末端就是 4px 的错位，玩家说不出来但会看出"跟班的弹歪得不一样的"

// 燃烧子弹（宝箱道具）：命中挂 5 秒，每 0.5 秒跳一次血，每跳伤害 = 道具层数
export const BURN_TICK = 500;   // 每跳跳血的间隔（毫秒）。★故意不与上面玩家的 POISON_TICK 共用一个常量：两条节拍各自可调，玩家中毒和怪被烧本来就不该同拍
export const BURN_HOLD = 5000;  // 燃烧持续毫秒数：再命中只刷新时长、绝不叠加；一次完整燃烧 = BURN_HOLD / BURN_TICK = 10 跳
export const BURN_DMG = 1;      // 每层燃烧子弹每跳跳的血（1 层 = 2 DPS，3 层 = 6 DPS）。★体感嫌弱只改这一个数，不要改 BURN_TICK：节拍一动「每 0.5 秒掉 1 血」的口头承诺就变了，而玩家读得出节拍变化、读不出总伤变化

// 嗜血（宝箱道具）：每次击杀有 LEECH_CHANCE 概率回血，回多少 = 道具层数
export const LEECH_CHANCE = 0.005;  // 触发概率，唯一的调节旋钮。★层数买的是「一次回几血」，不是概率（10-05 定的口径），
                                    //   所以概率只有这一个数、不随层数变，详情页那句「有 0.5% 几率回 N 点血」才始终成立。
                                    //   一局期望回血 ≈ kills × 本行 × 层数（实测 480 秒满 build 约 786 击杀 → 1 层约 4 口、3 层约 12 血）。
                                    //   调大它 = 回血从「偶尔一口」变成常态，玩家会开始主动挨一下再去杀一只换回来，那是另一种玩法

// 血瓶（宝箱道具）：满血时溢出的回血存进瓶里；瓶子每 VIAL_GAIN_CD 自己再攒几滴；残血时每秒送 1 滴到身上
export const VIAL_GAIN_CD = 30000;  // 自增节拍（毫秒）：每 30 秒 +层数 滴。★节拍恒定，层数买的是「每跳几滴」，同 BURN_DMG/嗜血 的口径
                                    //   1 层 = 2 滴/分钟、3 层 = 6 滴/分钟；一局 15 分钟约 30/90 滴，而 maxHp 只有 40 ——
                                    //   它真正的价值不是这条白送的水流，是把「满血时本该扔掉的那几口」变成有形状的储备
export const VIAL_OUT_CD = 1000;    // 输送节拍：残血时每 1 秒送一次。★不随层数变，也不随 maxHp 变：玩家能预判「一秒一口」，
                                    //   这个读得出的节拍就是这件道具的承诺本身，动它等于把储备变成第二条嗜血
export const VIAL_OUT = 1;          // 每跳送几滴。单独成一个数：pumpVial 的夹取式同时读「节拍 / 每跳几滴 / 余额 / 缺口」四样，
                                    //   留一个字面 1 会让「改输送速率」变成改逻辑
export const VIAL_SPRITE = 'images/entity/vial.png'; // 血瓶跟随体贴图：奶沙色瓶身 + 深蓝描边 + 细颈圆肚，和 companion.png / bomber.png 同一批语言。★瓶里那一截血面不在这张图上，是代码按存量裁剪叠上去的（见 bloodVial.js）——它是读数，不是外观
export const VIAL_SIZE = 22;        // 显示边长（逻辑像素）。★2026-10-11 出图后从 20 抬到 22：原本「小一圈」是给代码画的瓶形定的（它是容器、不是第三只会动作的跟班），换贴图后那条理由不成立了——实测这张图描边外沿横向只占画框 0.80、内腔只占 0.70，20 格下血面容器才 14px，而射击跟班的膜体 16.5、炸弹跟班的弹体 16，它会读成一件掉落物而不是跟班。22 格下内腔 15.5px，三只才视觉等大（同 BOMBER_SPRITE_SIZE 那条「显示边长相同≠视觉等大」的反向用法：这里要用的是外框相同、内腔更小，所以得抬一格）

// ===== 炮台（金匣第 10 种加成）=====
// 拾取那一刻在脚下落一座不动的重炮，之后只守自己那一小块地。它和另外九种的根本差别是「位置本身就是内容」：
// 其余加成都是全局属性，而一座炮台值不值取决于当初站在哪。所以★不封顶、层数买的是「场上几座」，
// 不是「一轮几发」——companion/bomber 那条口径的前提是实体只有一个位置，这里每个位置各自就是一座
export const TURRET_CD = 1200;            // 单座开火间隔（毫秒）。★节拍恒定、每座各自计时，不随攻速升级走（同跟班 COMPANION_ATK_SPEED 的口径）
export const TURRET_DAMAGE_RATIO = 0.9;   // 单发 = 角色攻击 × 此系数：夹在射击跟班 0.5 与炸弹跟班 2.0 之间，单体不溅射。
                                          //   中位 build 攻 26 → 23 发/1.2 秒 = 19.2 DPS ≈ 正好一层射击跟班：同一档输出，这份要拿位置换。
                                          //   ★实测若几座叠起来把 Boss 秒了，第一颗要动的螺丝是这个数，不是给炮台加一条共享电池——
                                          //   电池会把「一座 = 一份输出」这个玩家读得出的承诺改成一团耦合
export const TURRET_RANGE = 220;          // 索敌半径（像素）。★故意不读 player.attackRange：射击跟班可以借主角射程因为它就站在主角旁边，
                                          //   而炮台要回答的是「这一块地守不守得住」，一个跟着升级悄悄变大的数会让详情页写不出稳定读数
export const TURRET_BULLET_RADIUS = 7;    // 炮弹半径：走 bullet.js 那条 r≥4 的粗剪影（弹头分界 + 底缘），一眼和主角 5、跟班 3 的细弹分开
export const TURRET_BULLET_COLOR = '#F7F3E8'; // = UI.cream。★不能沿用主角的 gold #F5B041，也不能是跟班的 #5dade2：同屏三种弹得一眼分得出谁发的。
                                          //   奶白实心 + 深蓝描边本来就是这套贴图的家庭语言，炮弹读起来像「和炮台同一窑烧出来的」
export const TURRET_MUZZLE_LEN = 12.5;      // 炮口（炮孔质心）到枢轴的像素距离，也是炮弹的出发点。★实场第一版读成「一截掉在地上的奶白药片」：
                                          //   那版图整个身子是实心深蓝，中位亮度 57 而地面是 61，等于没有对比，只剩炮口那一圈奶白 rim 看得见。
                                          //   重出的奶沙主体版（同 H 构图、只换配色）实测：炮孔质心在贴图 (29.5, 9.9)、枢轴在 (30, 35)，
                                          //   差 25.1 个贴图像素 = 12.5 逻辑像素（贴图 @2x）。★这数是量的不是眼估的
export const TURRET_PIVOT_Y = 2.5;          // 枢轴（颈部那圈金环的环心）相对贴图中心的纵向偏移，向下为正。★炮头绕的是环心，而这座炮台的坐标原点是贴图中心，
                                          //   两者不重合，漏了这一转炮头就绕着身子画弧。实测环带占贴图行 33~37、环心行 35 → (35-30)/2 = 2.5。
                                          //   留着这个数不是因为它是 2.5，是因为换一张图它会跑（上一版是 0.6，同一件事）
export const TURRET_SOCKET_RX = 4.8;        // 代码补画的那只「插座孔」的横向半径。★底座顶上的平头切口 + 炮头屁股上的平头切口，两条毛边全靠它盖住；
                                          //   实测切线处半宽 3.25、切线上方 3 贴图像素处 3.75，加一圈描边 → 4.8。上一版是 6.8，
                                          //   因为那张图的炮管粗得多；★这个数跟着贴图走，不许照抄
                                          //   纵向按 3/4 视角压扁（见 turret.js 那个 0.42）：孔是椭圆，跟角度无关，所以转多少度都不会露
export const TURRET_SPRITE = 'images/entity/turret.png'; // 炮台贴图：根足底座 + 颈部一圈金环 + 环上一截大口径炮头，和 companion/bomber/vial 同一批语言。
                                          //   ★底座和炮头不是两张图。同一张图在绘制时按实测切线裁成两半（下半钉住不转、上半绕金环转），
                                          //   于是两者天生不可能对不上大小——双子 Boss 那次「两张独立出图必跳大小」的教训在这里从源头绕开
export const TURRET_SIZE = 30;              // 显示边长（逻辑像素）。★这是竖构图：alpha 包围盒按 fit=min 保比例后实际画出来 16 宽 × 30 高。
                                          //   三只跟班是 22 见方，炮台按「高度」略大一格；横向只有 16 是这张图的构图决定的，不是尺寸给小了

// 单发伤害的唯一口径：开火方 turret.js 与详情页 pause.js 都从这里取（同 bombDamage 的做法）。
// ★一个公式写两处迟早算成两个数，而详情页那句「单发 N 点」一旦被拿来对实测，对不上就算界面的锅
export const turretDamage = (attack) => Math.max(1, Math.floor(attack * TURRET_DAMAGE_RATIO));

export const DAMAGE_TEXT_MAX = 160; // 伤害飘字并发上限。★这个数不是拍的：实测 480 秒满 build（bot 每帧抽卡、786 击杀）的并发峰值是零燃烧 120 条、三层燃烧 112 条。曾经按 60 定，结果常态吃掉约 4% 的伤害数字，热闹时段普攻会「不掉字」；按 120 定又刚好压在零燃烧那条尾巴上，最热的几帧照样丢字。它只该兜失控，不该参与常态调度

export const XP_BASE = 10;              // 经验曲线基数

// 伤害飘字（怪物掉血显示）
export const DAMAGE_TEXT_DURATION = 650;      // 飘字存活时间（毫秒）
export const DAMAGE_TEXT_RISE = 26;           // 上浮距离（像素）
export const DAMAGE_TEXT_JITTER = 12;         // 横向随机抖动，避免同帧多发重叠
export const DAMAGE_TEXT_COLOR = '#ffffff';   // 普通伤害：白色
export const DAMAGE_TEXT_CRIT_COLOR = '#f1c40f'; // 暴击：黄色高亮
export const DAMAGE_TEXT_FONT = 13;           // 普通伤害字号
export const DAMAGE_TEXT_CRIT_FONT = 18;      // 暴击字号（放大更醒目）

// 升级所需经验随等级递增（指数1.3，后期升级压力比1.5小）
export const xpForLevel = (level) => Math.floor(XP_BASE * Math.pow(level, 1.3));

export const CHEST_RADIUS = 12; // 宝箱拾取半径（宝箱怪刷新参数见 js/npc/monster/config.js）

export const XP_PICKUP_RANGE = 80; // 经验磁吸半径初始值：宝石在这个距离内开始往角色飞（原来写死在 xpgem.js 里，挪出来才能手调）
export const XP_PICKUP_STEP = 30;  // 宝箱「经验拾取范围」每开一个涨的像素：80 → 110 → 140…（涨的是距离，不是等级计数）

export const COMPANION_RADIUS = 8;           // 跟班碰撞半径
export const COMPANION_SPRITE = 'images/entity/companion.png'; // 跟班贴图：中性粒细胞「小卫士」，正面朝上出图、运行时不旋转（和六只怪同一批语言；一张有脸的图转起来脸就朝天朝地了）
export const COMPANION_SPRITE_SIZE = 22;     // 跟班贴图显示边长（逻辑像素），比碰撞半径 8 大一圈：伪足伸出去、判定仍收在体内，同海火/膜王的约定
export const COMPANION_FOLLOW_DIST = 45;     // 跟班环绕距离
export const COMPANION_ATK_SPEED = 1.5;      // 跟班攻速（次/秒），固定值，不随角色攻速升级变化
export const COMPANION_BULLET_RADIUS = 3;    // 跟班子弹半径（小于主角）
export const COMPANION_BULLET_COLOR = '#5dade2'; // 跟班子弹颜色（蓝色，区别于主角子弹）
export const COMPANION_DAMAGE_RATIO = 0.5;   // 跟班伤害 = 角色攻击力 × 此系数

// ===== 炸弹跟班（金匣第 7 种加成）=====
// 0.7 是老射击跟班在身后弧形展开的格距（当时 N 层 = N 只）。现在跟班只留一只、站正后方，
// 这个数只剩一个用途：给炸弹跟班定它那一格。两只因此相距 45×2×sin(0.35) ≈ 31px，
// 而显示边长都是 22 —— 一眼分得出是两只不同的跟班，又不会贴成重影
export const COMPANION_SLOT_ANGLE = 0.7;

export const BOMBER_SPRITE = 'images/entity/bomber.png'; // 炸弹跟班贴图：奶沙色弹体 + 深蓝描边 + 深色核 + 怒目 + 引信火星，和 companion.png 同一批语言。★刻意用暖色而不是跟班蓝：两只并排站在角色身后，同色同形就分不清谁在投弹
export const BOMBER_SPRITE_SIZE = 22;  // 显示边长，和 COMPANION_SPRITE_SIZE 同格。实测弹体只占图内 32/44 = 0.73，缩到 22 格里弹体 16px、和射击跟班的膜体 18px 差 2px（视觉等大够用，刻意不再往上抬：再大就要压过角色本体）；引信和火星伸到 44 高，等同对方的伪足外伸。另一侧的核对齐口径是深色权重 0.51 对 0.53

export const BOMB_DAMAGE_RATIO = 2;   // 单枚伤害 = 角色攻击力 × 此系数。★不是 3：3 的时候它在任何层数都严格压制射击跟班，第 6 种会被挤成废项；2 才是「炸一群划算、追单怪亏」的那个岔路口
export const BOMB_CD = 5000;          // 扔一轮的间隔（毫秒），一轮 = player.bomber 枚。★2026-10-04 从 4000 放慢：用户体感太密。这是"节奏"那一端的天平，嫌单发不够痛该改 BOMB_DAMAGE_RATIO 而不是这里。牵动两处：读条那根弧的起点跟着挪到 2.5 秒（它只画后半程），以及 headless 每 120 秒的投掷次数按比例掉
export const BOMB_BLAST_R = 70;       // 爆风半径：比海火赤潮最小的池（58）大一圈，砸进菌群正好覆盖一团
export const BOMB_H_SPEED = 360;      // 水平速度（像素/秒），只用来把投掷距离换算成飞行时长。★2026-10-04 从 480 放慢：用户体感飞太快。300px 那一档 = 833ms（原来是 625ms）
export const BOMB_FLY_MIN = 500;      // 飞行时长下限：贴脸扔也得让它有足够的抛物线高度才看得出"扔"而不是"贴"。★跟着 H_SPEED 一起抬过，否则 180px 以内的近弹全被这条下限兜住，上面那个放慢等于没做
export const BOMB_FLY_MAX = 1050;     // 上限：超出索敌距离也按这个时长飞。★不能压得太狠——一轮里外摊的几枚全靠"落点距离不同 → flyMs 不同"自然错开落地（见 bomber.js 的太阳花排布），上限一撞就等于几枚同时炸。放慢之后最远那枚要 1000ms，所以这里得留到 1050
export const BOMB_GRAVITY_K = 0.3;    // 抛物线顶点高度系数：zMax = 18 + 距离 × 此值，远弹飞得更高，一轮几枚的远近一眼可辨
export const BOMB_RADIUS = 6;         // 弹体判定/显示半径：比跟班子弹 3 大一倍、比角色 16 小一半，掉在人群里读得出是"一颗东西"
export const BOMB_BLAST_MS = 260;     // 爆风可见时长（毫秒）。★纯表现，伤害在引爆那一帧一次结清；压到 150 以下会像没炸，超过 350 满屏都是盘子看不清怪
export const BOMB_CLUSTER_N = 12;     // 密集度索敌的候选数上限：先 O(n) 挑最近 12 只，再在这 12 只里两两数邻居。★为什么压在 12：满场怪能上百只，整场两两比就是万次级；而能一锅炸到的那一群本来就挤在最近这一批里，12 只够覆盖任意一片

// 单枚炸弹的伤害：投掷方 js/player/bomber.js 与详情页 js/ui/pause.js 都从这里取。
// ★一个公式写两处迟早算成两个数，而详情页那句「单枚 N 点」一旦被拿来对实测，对不上就算界面的锅
export const bombDamage = (attack) => Math.max(1, Math.floor(attack * BOMB_DAMAGE_RATIO));

// icon 取 js/ui/theme.js 的图标名，tint 取 UI 的色键（在 upgrade.js 里查表，consts 不依赖 UI 层）
export const UPGRADES = [
  { key: 'maxHp',    label: '生命上限', desc: '+10',  value: 10, icon: 'heart', tint: 'red' },
  { key: 'speed',    label: '移动速度', desc: '+15%', value: 0.15, mult: true, icon: 'boot', tint: 'blue' },
  { key: 'attack',   label: '攻击力',   desc: '+3',   value: 3, icon: 'gun', tint: 'red' },
  { key: 'defence',  label: '防御力',   desc: '+2',   value: 2, icon: 'shield', tint: 'blue' },
  { key: 'atkSpeed', label: '攻击速度', desc: '+0.3次', value: 0.3, icon: 'bolt', tint: 'gold' }, // 加法叠加：1.0 → 1.3 → 1.6 次/秒
  { key: 'attackRange', label: '攻击距离', desc: '+30',  value: 30, icon: 'target', tint: 'violet' },
  { key: 'critRate', label: '暴击率',   desc: '+10%',  value: 0.1, icon: 'star', tint: 'gold' },
  { key: 'luck',     label: '幸运值',   desc: '+1',   value: 1, icon: 'clover', tint: 'mint' },
];

// 战斗 HUD 右侧道具栏与暂停详情页共用的花名册：只列金匣那几种加成（与 npc/chest.js 的 BONUSES 一一对应，
// headless 的注册面扫描会硬比两边条数），Boss 专属匣由 hud.js 现从 BOSS_CHESTS 算（以后加匣只动 config 表，这里不用跟）。
// glyph 见 js/ui/theme.js 的 itemGlyph
// ★count 返回的是「拾取了几层」而不是属性值本身：子弹数从 1 起算、拾取范围存的是像素，
//   直接拿属性值当角标会让 0 层的道具也显示一个数字，而且 1 层和 2 层看起来一样
// ★只有护盾要把破掉的层数加回来：它是全部加成里唯一会被消耗「层数」的一种，读裸值会让这一格在你挨第一下时
//   整块消失、右边几格跟着集体左移，而这正是 HUD 上最不该跳版的一栏（血瓶消耗的是瓶里存量、不是层数，所以不在这儿）
export const ITEM_BAR = [
  { glyph: 'bulletCount', name: '子弹数', color: 'gold', count: (p) => p.bulletCount - 1 },
  { glyph: 'pierce', name: '穿透', color: 'gold', count: (p) => p.pierce },
  { glyph: 'shield', name: '护盾', color: 'gold', count: (p) => p.shield + p.shieldBroken },
  // 紧跟护盾：这三格都是「活下来」的道具，挨在一起才看得出分工 —— 一个挡掉那一下，一个把血补回来，一个把补不完的血存着
  { glyph: 'leech', name: '嗜血', color: 'gold', count: (p) => p.leech },
  { glyph: 'vial', name: '血瓶', color: 'gold', count: (p) => p.vial },
  { glyph: 'companions', name: '跟班', color: 'gold', count: (p) => p.companions },
  // 紧跟在跟班后面：两种跟班挨在一起，HUD 上才看得出「一个打枪的、一个扔弹的」是两件事
  { glyph: 'bomber', name: '炸弹跟班', color: 'gold', count: (p) => p.bomber },
  // 紧跟在两种跟班后面：它和它们同属「场上会开火的实体」，挨在一起才读得出是一家人。
  // ★唯一的不同就写在角标上：另外两格涨的是「一轮几发」，这一格涨的是「场上几座」
  { glyph: 'turrets', name: '炮台', color: 'gold', count: (p) => p.turrets },
  { glyph: 'burnBullets', name: '燃烧子弹', color: 'gold', count: (p) => p.burnBullets },
  { glyph: 'pickupRange', name: '经验拾取范围', color: 'gold', count: (p) => (p.pickupRange - XP_PICKUP_RANGE) / XP_PICKUP_STEP },
];

// 道具格几何：一排最多 5 格，超出向下续排，整块右对齐（2026-10-04 定的口径）
// ★pitch 33 = 盘径 26 + 角标留白。压到 30 时右下角那枚数字会蹭上邻格的白色贴纸圈，一排看起来连成一条
export const HUD_TILE = { r: 13, pitch: 33, rowH: 33, perRow: 5 };
export const PAUSE_BTN = 26; // 右上角暂停按钮边长；计时/击杀两枚药丸整体往左让开它，方贴才不会和圆形道具格看混

// 每升 1 级自动获得的全属性成长（在三选一升级卡之外额外叠加）
// key 必须与 Player 的属性名完全一致，否则写入会静默无效
export const LEVEL_UP_BONUS = {
  attack: 1,        // 攻击力 +1
  critRate: 0.02,   // 暴击率 +2%（0~1 小数）
  attackRange: 5,   // 攻击距离（=索敌距离）+5
  speed: 5,         // 移速 +5
};

export const canvasW = canvasWidth;
export const canvasH = canvasHeight;
