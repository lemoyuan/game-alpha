import { canvasW, xpForLevel, ITEM_BAR, HUD_TILE, PAUSE_BTN } from '../consts';
import { safeTop } from '../render';
import { MONSTER_TYPES, BOSS_CHESTS } from '../npc/monster/config';
import { UI, FS, R_BTN, sticker, bar, badge, chip, icon, itemGlyph, label, labelMid } from './theme';

const P = 12; // HUD 与屏幕边缘的安全间距

// 暂停按钮的位置：绘制在这里，命中判定在 ui/pause.js，摇杆让位在 ui/joystick.js。
// ★三处必须共用这一个函数，各自算一次迟早对不齐（对不齐的症状是按钮点不动、或摇杆把这一格吞掉）
export function pauseButtonRect() {
  return { x: canvasW - P - PAUSE_BTN, y: P + safeTop, w: PAUSE_BTN, h: PAUSE_BTN };
}

// 本局已持有的道具：金匣六种按 ITEM_BAR 的固定顺序，Boss 专属匣追在后面
// （循环 BOSS_CHESTS 全表，以后加匣这里和 HUD 都不用动），0 层的不占位。
// HUD 的道具栏和暂停详情页共用这一份，两处的顺序和层数才不会各算各的
export function ownedItems(databus) {
  const player = databus.player;
  const items = [];
  for (const it of ITEM_BAR) {
    const n = it.count(player);
    if (n > 0) items.push({ id: it.glyph, glyph: it.glyph, name: it.name, n, color: UI[it.color] });
  }
  for (const kinds of Object.values(BOSS_CHESTS)) {
    for (const k of kinds) {
      const n = databus.bossChests[k.id] || 0;
      if (n > 0) items.push({ id: k.id, glyph: k.icon, name: k.name, n, color: UI.bossChestBand });
    }
  }
  return items;
}

// 战斗 HUD：全部走 ui/theme.js 的贴纸图元，信息量与换皮前完全一致，只是收进面板
export default class Hud {
  constructor() {
    this.toastText = '';
    this.toastUntil = 0;
  }

  showToast(text, duration = 2000) {
    this.toastText = text;
    this.toastUntil = Date.now() + duration;
  }

  // 半透明底板：不画白边和硬投影，避免战斗中每帧多堆两层填充
  panel(ctx, x, y, w, h) {
    sticker(ctx, x, y, w, h, { fill: UI.hudPanel, r: R_BTN, border: false, shadow: false, line: 2, top: false });
  }

  draw(ctx, databus) {
    const player = databus.player;
    if (!player) return;

    const top = P + safeTop;

    // 生命：心形徽章 + 贴纸血条，数值压在条子正中
    const barX = P + 30;
    const barW = 148;
    badge(ctx, P + 13, top + 13, 13, 'heart', { color: UI.red, shadow: false });
    bar(ctx, barX, top + 4, barW, 18, player.hp / player.maxHp, UI.red);
    labelMid(ctx, `${Math.ceil(player.hp)}/${player.maxHp}`, barX + barW / 2, top + 14, {
      size: FS.tiny, bold: true, color: UI.textOnDark,
    });

    // 经验：等级药丸 + 细条，剩余空间放经验数值
    const xpNeeded = xpForLevel(player.level);
    chip(ctx, P, top + 26, 26, 16, `L${player.level}`, { color: UI.gold, size: FS.tiny });
    bar(ctx, barX, top + 28, barW, 8, player.xp / xpNeeded, UI.blue, { r: 4 });
    label(ctx, `${player.xp}/${xpNeeded}`, barX + barW + 8, top + 40, { size: FS.tiny, color: UI.muted });

    // 计时与击杀：右上角两枚药丸，整体往左让开暂停按钮
    const mins = Math.floor(databus.spawner.elapsed / 60);
    const secs = Math.floor(databus.spawner.elapsed % 60);
    const rw = 84;
    const rx = canvasW - P - PAUSE_BTN - 6 - rw;
    chip(ctx, rx, top, rw, 26, `${mins}:${secs < 10 ? '0' : ''}${secs}`, { color: UI.cream, size: FS.body });
    chip(ctx, rx, top + 32, rw, 22, `击杀 ${player.kills}`, { color: UI.panelDeep, textColor: UI.textOnDark, size: FS.tiny });

    // 暂停：刻意画成方贴而不是圆盘，圆盘这一栏全是道具格，形状是唯一能区分「可点」和「只是读数」的线索
    const pb = pauseButtonRect();
    sticker(ctx, pb.x, pb.y, pb.w, pb.h, { fill: UI.cream, r: 8, line: 2.5, top: false });
    icon(ctx, 'pause', pb.x + pb.w / 2, pb.y + pb.h / 2, 14, { color: UI.ink });

    // Boss 顶部血条（居中，压在两列属性之上）
    const boss = databus.enemys.find((e) => e.isBoss);
    if (boss) {
      const bw = Math.min(canvasW - 40, 300);
      const bx = (canvasW - bw) / 2;
      const by = top + 58;
      bar(ctx, bx, by, bw, 14, boss.hp / boss.maxHp, UI.red, { r: 7 });
      labelMid(ctx, `BOSS ${MONSTER_TYPES[boss.type] ? MONSTER_TYPES[boss.type].name : ''}`, bx + bw / 2, by + 8, {
        size: FS.tiny, bold: true, color: UI.textOnDark,
      });
      // 膜量子条（只有膜王带 filmMax）：膜最关键的时刻正是你扭头去看菌群的时候，
      // 本体上那层壳这时候在屏幕外，所以血条下面必须再有一条。
      // 高度不能再矮：bar() 两侧各 inset 2.5px，h<6 的时候平涂区会算成负数，只剩一圈描边
      if (boss.filmMax) {
        bar(ctx, bx, by + 16, bw, 8, Math.max(0, boss.film / boss.filmMax), UI.cream, { r: 4 });
      }
    }

    // 无 Boss 时面板从 top+58 起：右上「击杀」药丸底边在 top+54，再早就会压住它
    // 有 Boss 时从 top+86 起：Boss 血条占 top+58..72，膜王还多一条膜量子条到 top+82，
    // 而面板贴纸顶边画在 panelY-3，84 会让它啃掉膜条底边 1px
    const panelY = top + (boss ? 86 : 58);
    this.drawStats(ctx, player, panelY);
    this.drawItems(ctx, databus, panelY);

    // Toast
    const now = Date.now();
    if (now < this.toastUntil) {
      const remaining = (this.toastUntil - now) / 1000;
      ctx.globalAlpha = Math.min(1, remaining * 2);
      const tw = 210;
      const tx = canvasW / 2 - tw / 2;
      const ty = 90 + safeTop;
      sticker(ctx, tx, ty, tw, 34, { fill: UI.cream, r: R_BTN });
      labelMid(ctx, this.toastText, canvasW / 2, ty + 18, { size: FS.body, bold: true, color: UI.textOnLight });
      ctx.globalAlpha = 1;
    }
  }

  // 左栏角色属性：图标 + 数值，收进半透明底板（右栏已换成道具格，见 drawItems）
  drawStats(ctx, player, y) {
    const rows = [
      { icon: 'gun', label: '攻击', value: player.attack },
      // 0.3 连加会攒出 1.9000000000000001 这类浮点噪声，显示前收进两位小数
      { icon: 'bolt', label: '攻速', value: `${Math.round(player.atkSpeed * 100) / 100}/秒` },
      { icon: 'target', label: '射程', value: player.attackRange },
      { icon: 'star', label: '暴击', value: `${Math.round(player.critRate * 100)}%` },
      // 读实际生效值：踩进黏液时这个数字会自己掉下去，离开后再涨回来（升级加的是 player.speed，不受影响）
      { icon: 'boot', label: '移速', value: Math.floor(player.effectiveSpeed()) },
      { icon: 'clover', label: '幸运', value: player.luck },
      { icon: 'shield', label: '防御', value: player.defence },
    ];
    const w = 100;
    const rh = 17;
    this.panel(ctx, P, y, w, rows.length * rh + 8);
    rows.forEach((row, i) => {
      const ry = y + 8 + i * rh;
      icon(ctx, row.icon, P + 14, ry + 6, 14, { color: UI.blue });
      label(ctx, row.label, P + 27, ry + 11, { size: FS.tiny, color: UI.muted });
      label(ctx, `${row.value}`, P + w - 8, ry + 11, { size: FS.tiny, bold: true, color: UI.textOnDark, align: 'right' });
    });
  }

  // 右栏道具栏：只画已持有，一排最多 HUD_TILE.perRow 格，超出向下续排，整块右对齐。
  // 层数 ≥2 才挂右下角数字（1 层不挂，否则满排都是小 1，数字反而读不出来）
  drawItems(ctx, databus, y) {
    const items = ownedItems(databus);
    const { r, pitch, rowH, perRow } = HUD_TILE;
    const rightEdge = canvasW - P - r;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      const cy = y + r + (i / perRow) * rowH;
      this.panel(ctx, rightEdge - (row.length - 1) * pitch - r - 3, cy - r - 3, (row.length - 1) * pitch + r * 2 + 6, r * 2 + 6);
      row.forEach((it, ci) => {
        const cx = rightEdge - (row.length - 1 - ci) * pitch;
        badge(ctx, cx, cy, r, null, { color: it.color, shadow: false });
        itemGlyph(ctx, it.glyph, cx, cy, r * 1.3);
        if (it.n < 2) return;
        const bx = cx + r * 0.78;
        const by = cy + r * 0.78;
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fillStyle = UI.sticker; // 白贴纸外圈：深色数字压在菌毯上要先垫一层才读得出
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, Math.PI * 2);
        ctx.fillStyle = UI.ink;
        ctx.fill();
        labelMid(ctx, `${it.n}`, bx, by + 0.5, { size: 9, bold: true, color: UI.textOnDark });
      });
    }
  }
}
