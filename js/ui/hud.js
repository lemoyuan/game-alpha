import { canvasW, xpForLevel } from '../consts';
import { safeTop } from '../render';
import { MONSTER_TYPES } from '../npc/monster/config';
import { UI, FS, R_BTN, sticker, bar, badge, chip, icon, label, labelMid } from './theme';

const P = 12; // HUD 与屏幕边缘的安全间距

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

    // 计时与击杀：右上角两枚药丸
    const mins = Math.floor(databus.spawner.elapsed / 60);
    const secs = Math.floor(databus.spawner.elapsed % 60);
    const rw = 84;
    const rx = canvasW - P - rw;
    chip(ctx, rx, top, rw, 26, `${mins}:${secs < 10 ? '0' : ''}${secs}`, { color: UI.cream, size: FS.body });
    chip(ctx, rx, top + 32, rw, 22, `击杀 ${player.kills}`, { color: UI.panelDeep, textColor: UI.textOnDark, size: FS.tiny });

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
    }

    this.drawStats(ctx, player, top + (boss ? 84 : 52));

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

  // 左右两列属性：图标 + 数值，收进半透明底板，读法与换皮前一致
  drawStats(ctx, player, y) {
    const rows = [
      [
        { icon: 'gun', label: '攻击', value: player.attack },
        { icon: 'bolt', label: '攻速', value: `${player.atkSpeed}/秒` },
        { icon: 'target', label: '射程', value: player.attackRange },
        { icon: 'star', label: '暴击', value: `${Math.round(player.critRate * 100)}%` },
        { icon: 'boot', label: '移速', value: Math.floor(player.speed) },
        { icon: 'clover', label: '幸运', value: player.luck },
        { icon: 'shield', label: '防御', value: player.defence },
      ],
      [
        { icon: 'bullet', label: '子弹数', value: player.bulletCount, color: UI.gold },
        { icon: 'pierce', label: '穿透', value: player.pierce, color: UI.gold },
        { icon: 'bubble', label: '护盾', value: player.shield, color: UI.gold },
        { icon: 'buddy', label: '跟班', value: player.companions, color: UI.gold },
      ],
    ];
    const w = 100;
    const rh = 17;
    rows.forEach((col, ci) => {
      const x = ci === 0 ? P : canvasW - P - w;
      this.panel(ctx, x, y, w, col.length * rh + 8);
      col.forEach((row, i) => {
        const ry = y + 8 + i * rh;
        icon(ctx, row.icon, x + 14, ry + 6, 14, { color: row.color || UI.blue });
        label(ctx, row.label, x + 27, ry + 11, { size: FS.tiny, color: UI.muted });
        label(ctx, `${row.value}`, x + w - 8, ry + 11, { size: FS.tiny, bold: true, color: UI.textOnDark, align: 'right' });
      });
    });
  }
}
