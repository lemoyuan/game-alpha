import { canvasW, xpForLevel, ITEM_BAR, HUD_TILE, PAUSE_BTN } from '../consts';
import { safeTop, capsuleBottom } from '../render';
import { MONSTER_TYPES, BOSS_CHESTS } from '../npc/monster/config';
import { UI, FS, R_BTN, sticker, bar, badge, chip, icon, itemGlyph, label, labelMid } from './theme';

const P = 12; // HUD 与屏幕边缘的安全间距
const CHIP_W = 64; // 实测字宽：「击杀 1234」10px 粗体 46px、「12:34」13px 粗体 40px，64 宽左右各留 9~12px
const CHIP_H = 26; // 与 PAUSE_BTN 同高，一排三枚的底边才齐
const GAP = 8; // 药丸自带 2.5px 白色贴纸外框，间距低于 5 两条白框会合成一条线
const ROW_CLEAR = 8; // 簇顶离胶囊底边的空隙，同理只让 4px 会剩 1.5px 缝

// 右上簇的顶边：整簇（击杀 / 计时 / 暂停）以及挂在它下面的 Boss 血条和两栏面板，
// 全部由这一个函数往下推。★不要再写死 P + safeTop —— 那个值在刘海机上是 55，
// 而胶囊占的是 51..83，压在它底下的暂停按钮在真机上的症状是点不动，不是看不见
export function hudRowTop() {
  return Math.max(P + safeTop, capsuleBottom + ROW_CLEAR);
}

// 暂停按钮的位置：绘制在这里，命中判定在 ui/pause.js，摇杆让位在 ui/joystick.js。
// ★三处必须共用这一个函数，各自算一次迟早对不齐（对不齐的症状是按钮点不动、或摇杆把这一格吞掉）
export function pauseButtonRect() {
  return { x: canvasW - P - PAUSE_BTN, y: hudRowTop(), w: PAUSE_BTN, h: PAUSE_BTN };
}

// 本局已持有的道具：金匣七种按 ITEM_BAR 的固定顺序，Boss 专属匣追在后面
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

    // 经验：等级药丸 + 细条，数值压在条子正下方。
    // ★不能画回条子右侧（老位置 x=198）：右上簇横排之后左边缘到 208，
    //   而药丸的白色贴纸外框还要再往外 2.5px，原位必撞
    const xpNeeded = xpForLevel(player.level);
    chip(ctx, P, top + 26, 26, 16, `L${player.level}`, { color: UI.gold, size: FS.tiny });
    bar(ctx, barX, top + 28, barW, 8, player.xp / xpNeeded, UI.blue, { r: 4 });
    label(ctx, `${player.xp}/${xpNeeded}`, barX, top + 48, { size: FS.tiny, color: UI.muted });

    // 右上簇：击杀 | 计时 | 暂停 一排三枚，从屏幕右边距往左排，整簇顶边让开微信胶囊
    const mins = Math.floor(databus.spawner.elapsed / 60);
    const secs = Math.floor(databus.spawner.elapsed % 60);
    const rowY = hudRowTop();
    const rowB = rowY + CHIP_H;
    const timerX = canvasW - P - PAUSE_BTN - GAP - CHIP_W;
    chip(ctx, timerX - GAP - CHIP_W, rowY, CHIP_W, CHIP_H, `击杀 ${player.kills}`, {
      color: UI.panelDeep, textColor: UI.textOnDark, size: FS.tiny,
    });
    chip(ctx, timerX, rowY, CHIP_W, CHIP_H, `${mins}:${secs < 10 ? '0' : ''}${secs}`, {
      color: UI.cream, size: FS.body,
    });

    // 暂停：刻意画成方贴而不是圆盘，圆盘这一栏全是道具格，形状是唯一能区分「可点」和「只是读数」的线索
    const pb = pauseButtonRect();
    sticker(ctx, pb.x, pb.y, pb.w, pb.h, { fill: UI.cream, r: 8, line: 2.5, top: false });
    icon(ctx, 'pause', pb.x + pb.w / 2, pb.y + pb.h / 2, 14, { color: UI.ink });

    // Boss 顶部血条（居中，压在两列属性之上）
    const boss = databus.enemys.find((e) => e.isBoss);
    if (boss) {
      const bw = Math.min(canvasW - 40, 300);
      const bx = (canvasW - bw) / 2;
      // +8 而不是 +4：药丸和血条各带 2.5px 白色外框，只让 4px 时两条白框只差 1px，
      // 血条横贯整排药丸，视觉上会连成一条粗白线
      const by = rowB + 8;
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

    // 面板起点跟着簇底走，不再写死在 top 上（刘海机 rowY=91、rowB=117）：
    // 有 Boss 时血条占 rowB+8..+22（125..139），膜王还多一条膜量子条到 rowB+32（149），
    // 面板贴纸顶边画在 panelY-3，所以取 rowB+36 = 153 才啃不到膜条底边
    // 无 Boss 时没有血条也没有膜条，面板直接落在血条原本那一格 rowB+8 = 125
    const panelY = rowB + (boss ? 36 : 8);
    this.drawStats(ctx, player, panelY);
    this.drawItems(ctx, databus, panelY);

    // Toast
    const now = Date.now();
    if (now < this.toastUntil) {
      const remaining = (this.toastUntil - now) / 1000;
      ctx.globalAlpha = Math.min(1, remaining * 2);
      const tw = 210;
      const tx = canvasW / 2 - tw / 2;
      // ty 不能再写死成 90 + safeTop：那是照着「簇在 top」量的，簇一跟着胶囊下移就会啃掉血条底边。
      // 有 Boss 时横条区到 rowB+32（膜条底边）再让 10，无 Boss 时到 rowB+8 再让 10
      const ty = rowB + (boss ? 42 : 18);
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
