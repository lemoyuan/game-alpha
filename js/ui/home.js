import { canvasW, canvasH, GAME_TITLE } from '../consts';
import { safeTop } from '../render';
import { MONSTER_TYPES, CODEX_ORDER } from '../npc/monster/config';
import { settings, saveSettings, records, formatTime } from '../storage';

const BTN_RADIUS = 14;

// 首页：标题 + 开始游戏 + 设置 / 怪物图鉴 / 游戏记录 四个页面（databus.screen === 'home' 时接管触摸）
export default class HomeScreen {
  constructor() {
    this.page = 'main'; // main | settings | codex | records
    this.tapAreas = []; // 每帧绘制时重建的可点击区域
    this._onStart = null;
  }

  init(databus, onStart) {
    this._onStart = onStart;
    wx.onTouchStart((e) => {
      if (!databus || databus.screen !== 'home') return;
      const t = e.touches[0];
      this.handleTap(t.clientX, t.clientY);
    });
  }

  handleTap(x, y) {
    for (let i = this.tapAreas.length - 1; i >= 0; i--) {
      const a = this.tapAreas[i];
      if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) {
        if (settings.vibrate) wx.vibrateShort({ type: 'light' });
        a.action();
        return;
      }
    }
  }

  goto(page) {
    this.page = page;
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 通用按钮：注册点击区 + 绘制
  button(ctx, x, y, w, h, label, action, style) {
    const s = style || 'primary';
    const fill = { primary: '#27ae60', ghost: '#2c3e50', plain: '#34495e' }[s];
    this.tapAreas.push({ x, y, w, h, action });
    this.roundRect(ctx, x, y, w, h, BTN_RADIUS);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(14, Math.round(h * 0.36))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  header(ctx, title) {
    const top = 16 + safeTop;
    this.button(ctx, 14, top, 64, 32, '返回', () => this.goto('main'), 'plain');
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, canvasW / 2, top + 24);
    return top + 52;
  }

  draw(ctx) {
    this.tapAreas = [];
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (this.page === 'settings') this.drawSettings(ctx);
    else if (this.page === 'codex') this.drawCodex(ctx);
    else if (this.page === 'records') this.drawRecords(ctx);
    else this.drawMain(ctx);
  }

  drawMain(ctx) {
    const top = 24 + safeTop;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f1c40f';
    ctx.font = `bold ${Math.max(34, Math.round(canvasW * 0.11))}px monospace`;
    ctx.fillText(GAME_TITLE, canvasW / 2, top + canvasH * 0.16);
    ctx.fillStyle = '#7fb3d5';
    ctx.font = '13px monospace';
    ctx.fillText('俯视角生存肉鸽 · 走位、自动反击、活得更久', canvasW / 2, top + canvasH * 0.16 + 26);

    const bw = Math.min(canvasW - 48, 320);
    const bx = (canvasW - bw) / 2;
    let y = top + canvasH * 0.32;
    this.button(ctx, bx, y, bw, 62, '开始游戏', () => {
      if (this._onStart) this._onStart();
    });

    y += 62 + 14;
    const gap = 10;
    const w = (bw - gap * 2) / 3;
    this.button(ctx, bx, y, w, 44, '设置', () => this.goto('settings'), 'ghost');
    this.button(ctx, bx + w + gap, y, w, 44, '怪物图鉴', () => this.goto('codex'), 'ghost');
    this.button(ctx, bx + (w + gap) * 2, y, w, 44, '游戏记录', () => this.goto('records'), 'ghost');

    y += 44 + 22;
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.fillText('最佳生存 ' + formatTime(records.bestTime) + ' · 最高 Lv.' + records.bestLevel + ' · 图鉴 ' + records.encountered.length + '/' + CODEX_ORDER.length, canvasW / 2, y);
    ctx.fillStyle = '#666';
    ctx.fillText('移动：按住屏幕任意位置拖动 · 攻击：自动索敌', canvasW / 2, canvasH - 20 - safeTop);
  }

  drawSettings(ctx) {
    const start = this.header(ctx, '设置');
    const w = Math.min(canvasW - 32, 340);
    const x = (canvasW - w) / 2;
    const rows = [
      { label: '伤害飘字', desc: '命中时显示伤害数字', key: 'damageText', enabled: true },
      { label: '受击振动', desc: '受伤与按钮反馈时短振动', key: 'vibrate', enabled: true },
      { label: '音效', desc: '待接入音频系统', key: 'sound', enabled: false },
      { label: '背景音乐', desc: '待接入音频系统', key: 'bgm', enabled: false },
    ];
    const rh = 56;
    rows.forEach((row, i) => {
      const y = start + i * (rh + 8);
      this.tapAreas.push({
        x, y, w, h: rh,
        action: () => {
          if (!row.enabled) return;
          settings[row.key] = !settings[row.key];
          saveSettings();
        },
      });
      this.roundRect(ctx, x, y, w, rh, BTN_RADIUS);
      ctx.fillStyle = '#2c3e50';
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = row.enabled ? '#fff' : '#8a95a5';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(row.label, x + 14, y + 24);
      ctx.fillStyle = '#95a5a6';
      ctx.font = '10px monospace';
      ctx.fillText(row.desc, x + 14, y + 42);

      // 开关
      const sw = 44;
      const sh = 22;
      const sx = x + w - sw - 14;
      const sy = y + (rh - sh) / 2;
      const on = row.enabled && settings[row.key];
      this.roundRect(ctx, sx, sy, sw, sh, 11);
      ctx.fillStyle = row.enabled ? (on ? '#27ae60' : '#7f8c8d') : '#3a4552';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(row.enabled ? (on ? sx + sw - 11 : 11 + sx) : sx + sw / 2, sy + sh / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      if (!row.enabled) {
        ctx.fillStyle = '#8a95a5';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('未接入', sx - 8, sy + sh / 2 + 3);
      }
    });
  }

  drawCodex(ctx) {
    const start = this.header(ctx, '怪物图鉴');
    const w = Math.min(canvasW - 24, 360);
    const x = (canvasW - w) / 2;
    const n = CODEX_ORDER.length;
    const rh = Math.min(60, Math.floor((canvasH - start - 24) / n) - 8);
    CODEX_ORDER.forEach((entry, i) => {
      const y = start + i * (rh + 8);
      const config = MONSTER_TYPES[entry.type];
      const unlocked = records.encountered.indexOf(entry.type) !== -1;
      this.roundRect(ctx, x, y, w, rh, BTN_RADIUS);
      ctx.fillStyle = unlocked ? '#2c3e50' : '#1f2a36';
      ctx.fill();

      // 外观：与游戏内同色的圆点
      const cx = x + 14 + 13;
      const cy = y + rh / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fillStyle = unlocked ? config.color : '#3a4552';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!unlocked) {
        ctx.fillStyle = '#8a95a5';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('?', cx, cy + 5);
      }

      const tx = cx + 24;
      ctx.textAlign = 'left';
      ctx.fillStyle = unlocked ? '#fff' : '#8a95a5';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(unlocked ? `${config.name}（${entry.type === 'boss1' ? 'Boss' : entry.appear}）` : '未知怪物', tx, y + 20);
      ctx.fillStyle = unlocked ? '#95a5a6' : '#5f6b78';
      ctx.font = '10px monospace';
      if (unlocked) {
        ctx.fillText(config.intro, tx, y + 35);
        ctx.fillText(`血量${config.hp} · 移速${config.speed} · 伤害${config.damage} · 经验${config.xp}`, tx, y + 49);
      } else {
        ctx.fillText('尚未遭遇，进游戏里碰碰看', tx, y + 35);
      }
    });
  }

  drawRecords(ctx) {
    const start = this.header(ctx, '游戏记录');
    const w = Math.min(canvasW - 32, 340);
    const x = (canvasW - w) / 2;
    const best = [
      { label: '最长生存', value: formatTime(records.bestTime) },
      { label: '最高等级', value: `Lv.${records.bestLevel}` },
      { label: '最多击杀', value: `${records.bestKills}` },
      { label: '累计开箱', value: `${records.totalChests}` },
    ];
    const cellW = (w - 10) / 2;
    best.forEach((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = x + col * (cellW + 10);
      const cy = start + row * 62;
      this.roundRect(ctx, cx, cy, cellW, 54, BTN_RADIUS);
      ctx.fillStyle = '#2c3e50';
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#95a5a6';
      ctx.font = '11px monospace';
      ctx.fillText(item.label, cx + 12, cy + 20);
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(item.value, cx + 12, cy + 42);
    });

    let y = start + 62 * 2 + 8;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7fb3d5';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('最近战绩', x, y + 14);
    y += 24;
    if (records.runs.length === 0) {
      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText('还没有战绩，先去玩一局', x, y + 16);
      return;
    }
    ctx.fillStyle = '#95a5a6';
    ctx.font = '11px monospace';
    records.runs.forEach((run, i) => {
      this.roundRect(ctx, x, y + i * 30, w, 26, 8);
      ctx.fillStyle = '#1f2a36';
      ctx.fill();
      ctx.fillStyle = '#ccc';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${i + 1}. 生存 ${formatTime(run.t)}`,
        x + 10, y + i * 30 + 17
      );
      ctx.textAlign = 'right';
      ctx.fillText(`Lv.${run.lv} · 击杀 ${run.k} · 宝箱 ${run.c}`, x + w - 10, y + i * 30 + 17);
    });
  }
}
