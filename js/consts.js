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
export const PLAYER_INVINCIBLE = 500;   // 受击后无敌时间（毫秒）
export const PLAYER_CRIT_RATE = 0;   // 初始暴击率（升级项：暴击率 +10%）
export const PLAYER_CRIT_MULT = 2;      // 暴击伤害倍数
export const PLAYER_LUCK = 0;           // 初始幸运值（升级项：幸运值 +1）
export const LUCK_XP_BONUS = 0.02;      // 每点幸运增加的经验获取比例

export const BULLET_SPEED = 600;        // 子弹飞行速度
export const BULLET_RADIUS = 5;         // 主角子弹半径（跟班子弹见 COMPANION_BULLET_RADIUS）
export const BULLET_COLOR = '#F5B041';  // 主角子弹颜色：与 HUD 子弹图标同色（theme.js 的 UI.gold），白点在深地面上读不出方向
export const BULLET_DAMAGE = 10;        // （未直接使用，实际伤害取 player.attack）
export const BULLET_RANGE_BUFFER = 50;  // 子弹飞行距离在索敌距离基础上的缓冲

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

export const COMPANION_RADIUS = 8;           // 跟班碰撞半径
export const COMPANION_FOLLOW_DIST = 45;     // 跟班环绕距离
export const COMPANION_ATK_SPEED = 1.5;      // 跟班攻速（次/秒），固定值，不随角色攻速升级变化
export const COMPANION_BULLET_RADIUS = 3;    // 跟班子弹半径（小于主角）
export const COMPANION_BULLET_COLOR = '#5dade2'; // 跟班子弹颜色（蓝色，区别于主角子弹）
export const COMPANION_DAMAGE_RATIO = 0.5;   // 跟班伤害 = 角色攻击力 × 此系数

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
