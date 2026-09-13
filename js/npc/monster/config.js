// 怪物模块配置：所有怪物类型、刷新参数集中在这里，后续 boss 配置也加在这里
// 主题：病毒 · 微生物。玩家是穿蓝雨衣的防疫人员，每只怪的行为都对应真实的感染/耐药机制
// 命名规则：name 是「外号」——两个字、能喊出来、方便玩家之间交流（"一波刺头过来了"）；
//           真实学名放在 latin、分类阶元放在 group，作为图鉴详情页的知识回报，不要拿学名当显示名
// 字段说明：name/latin/group/intro/fact=图鉴展示用（外号 / 学名 / 分类阶元 / 一句话机制 / 一句真实冷知识）
//           hp=血量 speed=移速 radius=碰撞半径 color=颜色 sprite=贴图路径
//           xp=击杀掉落经验值 damage=接触玩家的伤害（碰到就结算，无攻击间隔）
//           weight=刷新权重（越大越常见，宝箱怪固定间隔刷新，不参与权重）
// 注意：color 是「识别色」，玩家靠颜色分辨怪类型，优先级高于真实配色；不符时在图鉴里说明
// 远程怪专属字段：attackRange=索敌距离 attackCd=射击间隔(毫秒)
//                bulletSpeed/bulletRadius/bulletColor=怪物子弹参数
// 攻速改为1.0次/秒后，整体血量/伤害已下调

// 贴图朝向约定：true = 按「头朝右（+x）」出图，运行时旋转到玩家方向
//               false = 按「正面朝上」出图，不旋转（当前这批 Q 版贴图）
// 换贴图批次时改这一个开关即可，见 js/base/sprite.js 的 drawSprite
export const SPRITE_ROTATES = false;

export const MONSTER_TYPES = {
  basic:  {
    name: '刺头', latin: 'Coronaviridae', group: '病毒 · 有包膜单链正链 RNA',
    intro: '直线追击，最常见的杂兵',
    fact: '表面那根刺突蛋白像钥匙插锁，拧开细胞门口的 ACE2 才能进去。普通感冒里约一到两成是它引起的，2003 年的 SARS 和 2019 年的新冠也只是这个家族里比较能打的两个。',
    hp: 15, speed: 60,  radius: 14, color: '#16a085', xp: 2,  damage: 8, weight: 1,
    sprite: 'images/entity/mob_basic.png',
  }, // 青色=最常见的杂兵识别色；真实冠状病毒电镜下是灰白颗粒，没有固定颜色
  fast:  {
    name: '窜子', latin: 'Influenzavirus A', group: '病毒 · 分节段 RNA · 甲型流感',
    intro: '血薄但跑得快，容易贴脸',
    fact: '基因组切成 8 个独立小段，两株同时感染一个细胞就能整段互换，叫「抗原转变」——流感疫苗每年得重打就是因为它。小段内部零星换几个碱基是「抗原漂移」，年年都在发生。',
    hp: 8,  speed: 130, radius: 10, color: '#e67e22', xp: 3,  damage: 4, weight: 1,
    sprite: 'images/entity/mob_fast.png',
  }, // 橙色为识别色，强调「窜得快」；真实流感病毒同样是无色颗粒
  tank:  {
    name: '铁坨', latin: 'Staphylococcus aureus', group: '细菌 · 厚壁菌门 · 葡萄球菌属',
    intro: '血厚伤害高，移动缓慢',
    fact: '显微镜下一串串像葡萄，故名。青霉素 1943 年上市，1950 年就有过半金葡菌能分泌 β-内酰胺酶把抗生素剪断；MRSA 更进一步改了靶位，几乎刀枪不入——厚壳不是白长的。',
    hp: 45, speed: 35,  radius: 22, color: '#8e44ad', xp: 5,  damage: 12, weight: 1,
    sprite: 'images/entity/mob_tank.png',
  }, // 紫色为识别色，用来强调「硬壳不好打」；真实金葡菌培养后是金黄色菌落
  chest:  {
    name: '金匣', latin: 'Plasmid', group: '细菌 · 染色体外环状 DNA',
    intro: '闪着金的匣子，击杀必掉宝箱（不掉经验）',
    fact: '质粒是细菌之间的 U 盘：靠一根性菌毛直接插进另一个细胞，甚至跨物种写入。耐药基因就是这么在菌群里传开的。你从宝箱里拿到的增益，本质是别人上传的一份基因。',
    hp: 25, speed: 55,  radius: 16, color: '#f39c12', xp: 0,  damage: 4,
    sprite: 'images/entity/mob_chest.png',
  }, // 金色=奖励语义，优先于真实配色（质粒本身没有颜色）
  ranged: {
    name: '喷子', latin: 'Filoviridae', group: '病毒 · 负链 RNA · 丝状病毒科',
    intro: '进入 250 索敌距离后站桩射击；子弹不会消失 —— 病毒血症一旦铺开就不自行停手',
    fact: '电镜下是一根打结盘绕的长线，「丝状病毒」因此得名。它进机体后第一件事是关掉细胞的干扰素信号，等于把警报器拔了，等免疫系统察觉已经满盘皆输；传播只靠体液直接接触，所以它不追人，站在原地往外喷。',
    hp: 12, speed: 45, radius: 13, color: '#e74c3c', xp: 4, damage: 6, weight: 0.3, // 权重0.3：解锁后约9%的刷怪概率
    sprite: 'images/entity/mob_ranged.png',
    attackRange: 250,   // 索敌距离：玩家进入后停下射击，超出才追击
    attackCd: 2000,     // 射击间隔（毫秒）
    bulletSpeed: 220,   // 子弹速度（比角色移速略快，可以走位躲开）
    bulletRadius: 4,
    bulletColor: '#e74c3c',
  }, // 红色=「危险 / 喷射」识别色；真实丝状病毒同样没有颜色
  boss1: {
    // 一号Boss：人巨细胞病毒，不参与常规刷怪池，由 spawner 定时召唤
    // 三技能全部对应真实感染行为：冲锋=细胞融合成多核巨细胞，环形弹幕=病毒血症爆发，召唤=潜伏基因组再激活
    name: '毒王',
    latin: 'Human betaherpesvirus 5', group: '病毒 · 疱疹病毒科 · β 属',
    intro: '首个 Boss：冲锋（融合扩散）→ 环形弹幕（病毒血症）→ 召唤小怪（潜伏再激活）循环释放',
    fact: '它会让被感染的细胞胀到正常的好几倍大，还能把一整圈细胞融成没有细胞壁的多核巨团，「巨细胞」就是这么来的。多数人一辈子毫无症状——免疫系统把它压成了潜伏态；一旦免疫下滑（移植、HIV、长期熬夜压力），藏在唾液腺和白细胞里的基因组立刻重新激活产毒。',
    hp: 300, speed: 55, radius: 34, color: '#c0392b', xp: 30, damage: 15,
    sprite: 'images/entity/boss1.png',
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
