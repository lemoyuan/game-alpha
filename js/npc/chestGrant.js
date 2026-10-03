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
};
