// 怪物模块配置：所有怪物类型、刷新参数集中在这里，后续 boss 配置也加在这里
// 字段说明：name/intro=图鉴展示用名称与一句话特性
//           hp=血量 speed=移速 radius=碰撞半径 color=颜色
//           xp=击杀掉落经验值 damage=接触玩家的伤害（碰到就结算，无攻击间隔）
//           weight=刷新权重（越大越常见，宝箱怪固定间隔刷新，不参与权重）
// 远程怪专属字段：attackRange=索敌距离 attackCd=射击间隔(毫秒)
//                bulletSpeed/bulletRadius/bulletColor=怪物子弹参数
// 攻速改为1.0次/秒后，整体血量/伤害已下调
export const MONSTER_TYPES = {
  basic:  { name: '普通怪', intro: '直线追击，最常见的杂兵', hp: 15, speed: 60,  radius: 14, color: '#16a085', xp: 2,  damage: 8, weight: 1 },  // 青色普通怪
  fast:   { name: '快速怪', intro: '血薄但跑得快，容易贴脸', hp: 8,  speed: 130, radius: 10, color: '#e67e22', xp: 3,  damage: 4, weight: 1 },  // 橙色快速怪
  tank:   { name: '坦克怪', intro: '血厚伤害高，移动缓慢', hp: 45, speed: 35,  radius: 22, color: '#8e44ad', xp: 5,  damage: 12, weight: 1 }, // 紫色坦克怪
  chest:  { name: '宝箱怪', intro: '闪烁的金色方块，击杀必掉宝箱（不掉经验）', hp: 25, speed: 55,  radius: 16, color: '#f39c12', xp: 0,  damage: 4 },  // 金色宝箱怪，掉宝箱不掉经验
  ranged: {
    name: '远程怪',
    intro: '进入 250 索敌距离后站桩射击，怪物子弹不会消失',
    hp: 12, speed: 45, radius: 13, color: '#e74c3c', xp: 4, damage: 6, weight: 0.3, // 权重0.3：解锁后约9%的刷怪概率
    attackRange: 250,   // 索敌距离：玩家进入后停下射击，超出才追击
    attackCd: 2000,     // 射击间隔（毫秒）
    bulletSpeed: 220,   // 子弹速度（比角色移速略快，可以走位躲开）
    bulletRadius: 4,
    bulletColor: '#e74c3c',
  }, // 红色远程怪
  boss1: {
    // 一号Boss：暗红大圆，不参与常规刷怪池，由 spawner 定时召唤
    name: '暗红巨怪',
    intro: '首个 Boss：冲锋 → 环形弹幕 → 召唤小怪 循环释放',
    hp: 300, speed: 55, radius: 34, color: '#c0392b', xp: 30, damage: 15,
    skillCd: 4000,      // 技能循环间隔（毫秒）：冲锋→环形弹幕→召唤 轮流放
    chargeSpeed: 520,   // 冲锋冲刺速度（角色移速170，需侧移躲避）
    chargeTime: 700,    // 冲锋持续时间（毫秒）
    ringCount: 12,      // 环形弹幕发数
    bulletSpeed: 240,   // 弹幕速度
    bulletDamage: 8,    // 弹幕伤害（低于接触伤害15）
    bulletRadius: 6,
    bulletColor: '#e74c3c',
    summonCount: 3,     // 每次召唤普通小怪数
  },
};

// 刷怪节奏（前期偏慢，随时间逐渐加快）
export const SPAWN_INTERVAL_START = 2500; // 开局刷怪间隔（毫秒）
export const SPAWN_INTERVAL_RAMP = 16;    // 每经过1秒，刷新间隔缩短的毫秒数
export const SPAWN_INTERVAL_MIN = 450;    // 刷新间隔下限（毫秒）

// 怪物解锁时间（秒）
export const FAST_UNLOCK_TIME = 25;   // 快速怪出现时间
export const TANK_UNLOCK_TIME = 45;   // 坦克怪出现时间
export const RANGED_UNLOCK_TIME = 60; // 远程怪出现时间

// Boss 出场（秒）：存活期间停止普通刷小怪，击杀后恢复
export const BOSS_FIRST_SPAWN_TIME = 120; // 首个 Boss 出现时间

// 难度成长
export const HP_SCALE_TIME = 90;      // 该秒数后所有怪物血量提升
export const HP_SCALE_MULT = 1.5;     // 血量提升倍数

// 宝箱怪刷新
export const CHEST_SPAWN_INTERVAL = 25000; // 宝箱怪刷新间隔（毫秒）
export const CHEST_FIRST_SPAWN = 15;       // 首个宝箱怪出现时间（秒）

// 图鉴展示顺序 + 出现条件文案（首页怪物图鉴读取这里）
export const CODEX_ORDER = [
  { type: 'basic', appear: '开局' },
  { type: 'fast', appear: `${FAST_UNLOCK_TIME} 秒后` },
  { type: 'tank', appear: `${TANK_UNLOCK_TIME} 秒后` },
  { type: 'ranged', appear: `${RANGED_UNLOCK_TIME} 秒后（低权重）` },
  { type: 'chest', appear: `${CHEST_FIRST_SPAWN} 秒后，每 ${CHEST_SPAWN_INTERVAL / 1000} 秒` },
  { type: 'boss1', appear: `${BOSS_FIRST_SPAWN_TIME} 秒定时出场` },
];
