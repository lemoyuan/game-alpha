import BossPet from '../player/bossPet';
import { CHEST_KIND_BY_ID } from './monster/config';

function spawnPet(databus, id) {
  const def = CHEST_KIND_BY_ID[id];
  const pet = new BossPet(def.pet, databus.bossPets.length);
  pet.x = databus.player.x; // 脚下出生，同跟班约定，避免从地图角落飞过来
  pet.y = databus.player.y;
  databus.bossPets.push(pet);
  databus.bossChests[id] = (databus.bossChests[id] || 0) + 1;
}

// 宝箱种类 id → 授予函数注册表：以后加新匣在这里注册一行，chest.js 不用动
export const CHEST_GRANTS = {
  pet_cmv: (databus) => spawnPet(databus, 'pet_cmv'),
  // Boss 掉落道具「巨细胞核」：全属性抬一档 + 左栏逐行弹 +x。
  // ★顺序是「先落属性再弹字」：飘字文本由加成包直接格式化（不读属性差），所以两步谁先谁后都不影响读数，
  //   但反过来写会让「属性没动、动画照弹」这种断链更难查——落属性在前，出了问题是动画的锅而不是加成的锅
  // ★层数无上限：boss1 死后 120 秒会再来（config.js 的 BOSS_RESPAWN_GAP），叠几层就是几层，
  //   HUD 右栏那枚徽章读的正是这个计数，「×3」诚实表达了「你吃过三截核心」
  core_cmv: (databus) => {
    const kind = CHEST_KIND_BY_ID.core_cmv;
    // 飘字由 applyBoost 内部触发（它是左栏 +x 的唯一触发口），这里不再单独 popStats，
    // 否则同一次拾取会弹两遍瀑布
    databus.player.applyBoost(kind.boost, databus, false);
    databus.bossChests.core_cmv = (databus.bossChests.core_cmv || 0) + 1;
  },
  // Boss 掉落道具「海火核心」：拾取这一刻只涨一个计数，一道光都不放。
  // ★和上面那条的分工差别在于「有没有属性可报」：巨细胞核动的是左栏那七行，所以由 applyBoost 顺带弹 +x；
  //   这一件动的是 player.laserCross —— 一个不在面板里的数，弹 +x 就等于在无中生有，
  //   所以拾取那一刻的反馈走 toast（config 那行因此不设 quiet），光束留到以后每次真正掉血时由 Player.fireLaserCross 现放
  core_seafire: (databus) => {
    databus.player.laserCross += 1;
    databus.bossChests.core_seafire = (databus.bossChests.core_seafire || 0) + 1;
  },
  // Boss 掉落道具「薄膜核心」：右下那枚主动键从这一刻起才存在。
  // ★写 = 1 而不是 += 1：膜王一局只死一只，这件不叠层——player.membrane 只取 0/1，
  //   没有任何常量乘它（减伤比例 MEMBRANE_REDUCE 是定值）。写成 += 会让以后来读的人以为存在「两层膜更硬」这档强度
  // ★和前两件的分工各不相同：巨细胞核涨属性（所以由 applyBoost 弹 +x 瀑布）、海火核心被动挨打触发（只多一层计数），
  //   这一件既不涨属性也不自动放——它给的是一个要你伸手按的键，拾取那一刻的反馈因此只有 toast
  core_biofilm: (databus) => {
    databus.player.membrane = 1;
    databus.bossChests.core_biofilm = (databus.bossChests.core_biofilm || 0) + 1;
  },
};
