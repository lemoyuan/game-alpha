import {
  canvasW, canvasH, HUD_TILE, PIERCE_DAMAGE_FALLOFF, PLAYER_INVINCIBLE,
  COMPANION_ATK_SPEED, COMPANION_DAMAGE_RATIO, BOMB_CD, BOMB_BLAST_R, bombDamage, BURN_TICK, BURN_HOLD, BURN_DMG, LEECH_CHANCE, XP_PICKUP_RANGE,
} from '../consts';
import { safeTop } from '../render';
import { CHEST_KIND_BY_ID } from '../npc/monster/config';
import { UI, FS, R_CARD, sticker, badge, chip, itemGlyph, label, wrapLines, button } from './theme';
import { pauseButtonRect, ownedItems } from './hud';

const ROW_H = 50; // 一行放得下「名称 + 两行说明」：压到 44 以下第二行会啃进分隔线

const hit = (t, r) => t.clientX >= r.x && t.clientX <= r.x + r.w && t.clientY >= r.y && t.clientY <= r.y + r.h;

// 说明一律报「现在给多少」而不是「+1」：道具层数在 HUD 已经缩成一枚图标，
// 玩家点开暂停页要确认的是这层数换算成实际数字是多少，所以文案全部现读 player 属性
function describe(item, player) {
  switch (item.glyph) {
    case 'bulletCount': return `每次射击射出 ${player.bulletCount} 颗子弹`;
    case 'pierce': return `可穿透 ${player.pierce} 个目标，每穿一个伤害变为上一次的 ${Math.round(PIERCE_DAMAGE_FALLOFF * 100)}%`;
    case 'shield': return `每层挡一次伤害，破盾后有 ${PLAYER_INVINCIBLE / 1000} 秒无敌；当前 ${player.shield}/${item.n} 层`;
    // ★报的是「一口回几血」而不是「几 × 0.5%」：层数买的就是回血量，概率恒为 LEECH_CHANCE
    case 'leech': return `每次击杀有 ${Math.round(LEECH_CHANCE * 1000) / 10}% 几率回 ${player.leech} 点血；满血时这一下会白白浪费`;
    case 'companions': return `1 个跟班一轮射出 ${player.companions} 发，${COMPANION_ATK_SPEED} 次/秒，伤害为角色的 ${COMPANION_DAMAGE_RATIO * 100}%，不会被攻击`;
    case 'bomber': return `1 个跟班每 ${BOMB_CD / 1000} 秒往最密的一团扔 ${player.bomber} 枚，单枚 ${bombDamage(player.attack)} 点，爆风半径 ${BOMB_BLAST_R} 像素`;
    case 'burnBullets': return `命中点燃 ${BURN_HOLD / 1000} 秒，每 ${BURN_TICK / 1000} 秒跳一次血，每跳 ${item.n * BURN_DMG} 点，再命中只刷新时长`;
    case 'pickupRange': return `经验宝石在 ${player.pickupRange} 像素内自动飞向你（初始 ${XP_PICKUP_RANGE}）`;
    default: return (CHEST_KIND_BY_ID[item.id] || {}).brief || '';
  }
}

// 暂停页：右上角按钮 → 整局冻住（databus.isPaused，走 main.js 现成的那道门），在这里看道具详情
export default class PauseScreen {
  constructor() {
    this.visible = false;
    this._databus = null;
  }

  init(databus) {
    this._databus = databus;
    wx.onTouchStart((e) => {
      const t = e.touches[0];
      if (!this.visible) {
        // 三选一面板开着时不接管：那时 isPaused 已经是 true，再叠一层暂停页会把两张卡叠着画
        if (databus.screen !== 'game' || databus.isGameOver || databus.upgradeScreen.visible) return;
        if (hit(t, pauseButtonRect())) this.show();
        return;
      }
      const L = this.layout(ownedItems(databus));
      // 继续按钮和卡片外的空白处都能回到战斗；点在卡片身上（正读某条说明）不算误触
      if (hit(t, L.btn) || !hit(t, { x: L.x, y: L.y, w: L.w, h: L.h })) this.hide();
    });
  }

  show() {
    const databus = this._databus;
    this.visible = true;
    databus.isPaused = true;
    // 用第二根手指按暂停时，第一根还压在摇杆上：不清就会带着一个方向回到战斗，角色自己飘出去
    const j = databus.joystick;
    j.active = false;
    j.touchId = null;
    j.dirX = 0;
    j.dirY = 0;
  }

  hide() {
    this.visible = false;
    this._databus.isPaused = false;
  }

  // 布局只有一份：draw 与命中判定都从这里取，两处的数字永远对得上
  layout(items) {
    const w = Math.min(canvasW - 32, 340);
    const x = Math.round((canvasW - w) / 2);
    const body = items.length ? items.length * ROW_H : 40; // 空列表只留一行提示
    const h = 56 + body + 56;
    const y = Math.max(safeTop + 96, Math.round((canvasH - h) / 2));
    return { x, y, w, h, btn: { x: x + w / 2 - 60, y: y + h - 46, w: 120, h: 34 } };
  }

  draw(ctx) {
    if (!this.visible) return;
    const databus = this._databus;
    const items = ownedItems(databus);
    const L = this.layout(items);

    ctx.fillStyle = UI.dim;
    ctx.fillRect(0, 0, canvasW, canvasH);
    sticker(ctx, L.x, L.y, L.w, L.h, { fill: UI.cream, r: R_CARD, line: 3 });

    label(ctx, '道具详情', L.x + 18, L.y + 30, { size: FS.h1, bold: true, color: UI.textOnLight });
    label(ctx, items.length ? `已持有 ${items.length} 种 · 点空白处或继续按钮回到战斗` : '点空白处或继续按钮回到战斗',
      L.x + 18, L.y + 46, { size: FS.tiny, color: UI.muted });

    if (!items.length) {
      label(ctx, '还没拾取到道具，开金匣会掉在这里列的这些', L.x + 18, L.y + 74, { size: FS.small, color: UI.muted });
    }

    const maxW = L.w - 68;
    items.forEach((it, i) => {
      const ry = L.y + 56 + i * ROW_H;
      if (i) {
        ctx.fillStyle = 'rgba(28,40,67,0.12)';
        ctx.fillRect(L.x + 16, ry - 4, L.w - 32, 1);
      }
      badge(ctx, L.x + 30, ry + 18, HUD_TILE.r, null, { color: it.color, shadow: false });
      itemGlyph(ctx, it.glyph, L.x + 30, ry + 18, HUD_TILE.r * 1.3);
      label(ctx, it.name, L.x + 52, ry + 15, { size: FS.body, bold: true, color: UI.textOnLight });
      chip(ctx, L.x + L.w - 44, ry + 4, 32, 17, `×${it.n}`, {
        color: it.color, textColor: it.color === UI.bossChestBand ? UI.textOnDark : undefined, size: FS.tiny,
      });
      // 两行封顶：第三行会啃进下一行的分隔线，说明写不下就是文案太长而不是行高不够
      wrapLines(ctx, describe(it, databus.player), maxW, FS.tiny).slice(0, 2).forEach((line, li) => {
        label(ctx, line, L.x + 52, ry + 31 + li * 12, { size: FS.tiny, color: UI.muted });
      });
    });

    button(ctx, [], { ...L.btn, text: '继续战斗', color: UI.mint });
  }
}
