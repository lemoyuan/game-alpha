// 怪物模块配置：所有怪物类型、刷新参数集中在这里，后续 boss 配置也加在这里
// 字段说明：hp=血量 speed=移速 radius=碰撞半径 color=颜色
//           xp=击杀掉落经验值 damage=接触玩家的伤害（碰到就结算，无攻击间隔）
// 攻速改为1.0次/秒后，整体血量/伤害已下调
export const MONSTER_TYPES = {
  basic:  { hp: 15, speed: 60,  radius: 14, color: '#e74c3c', xp: 2,  damage: 8 },  // 红色普通怪
  fast:   { hp: 8,  speed: 130, radius: 10, color: '#e67e22', xp: 3,  damage: 4 },  // 橙色快速怪
  tank:   { hp: 45, speed: 35,  radius: 22, color: '#8e44ad', xp: 5,  damage: 12 }, // 紫色坦克怪
  chest:  { hp: 25, speed: 55,  radius: 16, color: '#f39c12', xp: 0,  damage: 4 },  // 金色宝箱怪，掉宝箱不掉经验
};

// 刷怪节奏（前期偏慢，随时间逐渐加快）
export const SPAWN_INTERVAL_START = 2500; // 开局刷怪间隔（毫秒）
export const SPAWN_INTERVAL_RAMP = 16;    // 每经过1秒，刷新间隔缩短的毫秒数
export const SPAWN_INTERVAL_MIN = 450;    // 刷新间隔下限（毫秒）

// 怪物解锁时间（秒）
export const FAST_UNLOCK_TIME = 25;   // 快速怪出现时间
export const TANK_UNLOCK_TIME = 45;   // 坦克怪出现时间

// 难度成长
export const HP_SCALE_TIME = 90;      // 该秒数后所有怪物血量提升
export const HP_SCALE_MULT = 1.5;     // 血量提升倍数

// 宝箱怪刷新
export const CHEST_SPAWN_INTERVAL = 25000; // 宝箱怪刷新间隔（毫秒）
export const CHEST_FIRST_SPAWN = 15;       // 首个宝箱怪出现时间（秒）
