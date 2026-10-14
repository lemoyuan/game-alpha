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
};
