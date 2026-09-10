import { canvasW, xpForLevel } from '../consts';
import { safeTop } from '../render';

export default class Hud {
  constructor() {
    this.toastText = '';
    this.toastUntil = 0;
  }

  showToast(text, duration = 2000) {
    this.toastText = text;
    this.toastUntil = Date.now() + duration;
  }

  draw(ctx, databus) {
    const player = databus.player;
    if (!player) return;

    const p = 12;
    const top = p + safeTop; // 避开刘海/状态栏

    // HP bar
    ctx.fillStyle = '#333';
    ctx.fillRect(p, top, 180, 18);
    ctx.fillStyle = player.hp > player.maxHp * 0.3 ? '#e74c3c' : '#c0392b';
    ctx.fillRect(p, top, 180 * Math.max(0, player.hp / player.maxHp), 18);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(p, top, 180, 18);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(player.hp)}/${player.maxHp}`, p + 90, top + 14);

    // XP bar
    const xpNeeded = xpForLevel(player.level);
    ctx.fillStyle = '#333';
    ctx.fillRect(p, top + 24, 180, 10);
    ctx.fillStyle = '#3498db';
    ctx.fillRect(p, top + 24, 180 * Math.min(1, player.xp / xpNeeded), 10);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(p, top + 24, 180, 10);

    // EXP numbers
    ctx.fillStyle = '#7fb3d5';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`EXP:${player.xp}/${xpNeeded}`, p, top + 46);

    // Level
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Lv.${player.level}`, p, top + 64);

    // Stats: one attribute per line (left)
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    const stats = [
      `攻击:${player.attack}`,
      `攻速:${player.atkSpeed}次/秒`,
      `射程:${player.attackRange}`,
      `暴击:${Math.round(player.critRate * 100)}%`,
      `移速:${Math.floor(player.speed)}`,
      `幸运:${player.luck}`,
      `防御:${player.defence}`,
    ];
    stats.forEach((s, i) => {
      ctx.fillText(s, p, top + 82 + i * 16);
    });

    // Boss 顶部血条（居中）
    const boss = databus.enemys.find((e) => e.isBoss);
    if (boss) {
      const bw = Math.min(canvasW - 40, 300);
      const bx = (canvasW - bw) / 2;
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, top, bw, 10);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(bx, top, bw * Math.max(0, boss.hp / boss.maxHp), 10);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, top, bw, 10);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS', canvasW / 2, top + 22);
    }

    // Chest bonus stats (right)
    ctx.fillStyle = '#f39c12';
    ctx.textAlign = 'right';
    const bonusStats = [
      `子弹数:${player.bulletCount}`,
      `穿透:${player.pierce}`,
      `护盾:${player.shield}`,
      `跟班:${player.companions}`,
    ];
    bonusStats.forEach((s, i) => {
      ctx.fillText(s, canvasW - p, top + 82 + i * 16);
    });

    // Timer
    const mins = Math.floor(databus.spawner.elapsed / 60);
    const secs = Math.floor(databus.spawner.elapsed % 60);
    ctx.fillStyle = '#fff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${mins}:${secs < 10 ? '0' : ''}${secs}`, canvasW - p, top + 14);

    // Kills
    ctx.fillText(`Kills: ${player.kills}`, canvasW - p, top + 34);

    // Toast
    const now = Date.now();
    if (now < this.toastUntil) {
      const remaining = (this.toastUntil - now) / 1000;
      ctx.globalAlpha = Math.min(1, remaining * 2);
      const tw = 200;
      const tx = canvasW / 2 - tw / 2;
      const ty = 90 + safeTop;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(tx, ty, tw, 36);
      ctx.strokeStyle = '#f39c12';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, ty, tw, 36);
      ctx.fillStyle = '#f39c12';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.toastText, canvasW / 2, ty + 23);
      ctx.globalAlpha = 1;
    }
  }
}
