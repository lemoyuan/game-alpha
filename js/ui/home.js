import { canvasW, canvasH, GAME_TITLE } from '../consts';
import { safeTop } from '../render';
import { MONSTER_TYPES, CODEX_ORDER } from '../npc/monster/config';
import { loadImage } from '../base/sprite';
import { settings, saveSettings, records, formatTime } from '../storage';

const BTN_RADIUS = 14;

// 首页：标题 + 开始游戏 + 设置 / 怪物图鉴 / 游戏记录 四个页面（databus.screen === 'home' 时接管触摸）
export default class HomeScreen {
  constructor() {
    this.page = 'main'; // main | settings | codex | codexDetail | records
    this.codexType = null; // codexDetail 当前查看的怪物 type
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

  header(ctx, title, backTo) {
    const top = 16 + safeTop;
    this.button(ctx, 14, top, 64, 32, '返回', () => this.goto(backTo || 'main'), 'plain');
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, canvasW / 2, top + 24);
    return top + 52;
  }

  // 中文按字断行：canvas 没有自动换行，图鉴的冷知识是整句
  wrap(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  draw(ctx) {
    this.tapAreas = [];
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (this.page === 'settings') this.drawSettings(ctx);
    else if (this.page === 'codex') this.drawCodex(ctx);
    else if (this.page === 'codexDetail') this.drawCodexDetail(ctx);
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

  // 图鉴头像：解锁后直接用游戏内贴图（圆形裁切），贴图未加载完回退成识别色圆点
  avatar(ctx, config, cx, cy, r, unlocked) {
    const img = unlocked && config.sprite ? loadImage(config.sprite) : null;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = img && img.width && img.height ? '#1f2a36' : (unlocked ? config.color : '#3a4552');
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (img && img.width && img.height) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
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

      // 外观：游戏内贴图（未加载完回退成同色圆点）
      const r = 16;
      const cx = x + 14 + r;
      const cy = y + rh / 2;
      this.avatar(ctx, config, cx, cy, r, unlocked);
      if (!unlocked) {
        ctx.fillStyle = '#8a95a5';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('?', cx, cy + 5);
      }

      const tx = cx + r + 8;
      ctx.textAlign = 'left';
      ctx.fillStyle = unlocked ? '#fff' : '#8a95a5';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(unlocked ? `${config.name}（${entry.type === 'boss1' ? 'Boss' : entry.appear}）` : '未知怪物', tx, y + 19);
      ctx.font = '10px monospace';
      if (unlocked) {
        ctx.fillStyle = '#7fb3d5';
        ctx.fillText(config.group, tx, y + 33);
        ctx.fillStyle = '#95a5a6';
        ctx.fillText(`血量${config.hp} · 移速${config.speed} · 伤害${config.damage} · 经验${config.xp}`, tx, y + 47);
        // 整行可点：学名与冷知识放在详情卡里
        ctx.fillStyle = '#7f8c8d';
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('›', x + w - 12, cy + 5);
        this.tapAreas.push({ x, y, w, h: rh, action: () => this.openCodex(entry.type) });
      } else {
        ctx.fillStyle = '#5f6b78';
        ctx.fillText('尚未遭遇，进游戏里碰碰看', tx, y + 33);
      }
    });
  }

  openCodex(type) {
    this.codexType = type;
    this.goto('codexDetail');
  }

  stepCodex(delta) {
    const n = CODEX_ORDER.length;
    const idx = CODEX_ORDER.findIndex((e) => e.type === this.codexType);
    this.codexType = CODEX_ORDER[(idx + delta + n) % n].type;
  }

  drawCodexDetail(ctx) {
    const entry = CODEX_ORDER.find((e) => e.type === this.codexType);
    if (!entry) {
      this.goto('codex');
      return;
    }
    const config = MONSTER_TYPES[entry.type];
    const unlocked = records.encountered.indexOf(entry.type) !== -1;
    const start = this.header(ctx, unlocked ? '图鉴详情' : '未解锁', 'codex');
    const w = Math.min(canvasW - 24, 360);
    const x = (canvasW - w) / 2;

    // 头部卡：游戏内贴图 + 中文名 + 学名 + 分类阶元
    const headH = 108;
    const r = 38;
    this.roundRect(ctx, x, start, w, headH, BTN_RADIUS);
    ctx.fillStyle = '#2c3e50';
    ctx.fill();
    this.avatar(ctx, config, x + 14 + r, start + headH / 2, r, unlocked);
    if (!unlocked) {
      ctx.fillStyle = '#8a95a5';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', x + 14 + r, start + headH / 2 + 9);
    }
    const tx = x + 28 + r * 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px monospace';
    ctx.fillText(unlocked ? config.name : '未知怪物', tx, start + 30);
    ctx.fillStyle = '#7fb3d5';
    ctx.font = '11px monospace';
    ctx.fillText(unlocked ? config.latin : '???', tx, start + 48);
    ctx.fillStyle = '#95a5a6';
    ctx.fillText(unlocked ? config.group : '尚未遭遇', tx, start + 64);
    ctx.fillText(`出现：${entry.type === 'boss1' ? 'Boss 定时出场' : entry.appear}`, tx, start + 80);

    const sections = unlocked
      ? [
        { label: '游戏机制', text: config.intro },
        { label: '冷知识', text: config.fact },
        {
          label: '数值',
          text: `血量 ${config.hp} · 移速 ${config.speed} · 接触伤害 ${config.damage} · 经验 ${config.xp} · 碰撞半径 ${config.radius}`,
        },
      ]
      : [{ label: '说明', text: '进游戏里遭遇一次，这张卡就会自动解锁，不需要额外操作。' }];

    let y = start + headH + 10;
    const maxW = w - 32;
    for (const sec of sections) {
      ctx.font = '12px monospace';
      const lines = this.wrap(ctx, sec.text, maxW);
      const h = 26 + lines.length * 17 + 6;
      this.roundRect(ctx, x, y, w, h, BTN_RADIUS);
      ctx.fillStyle = '#1f2a36';
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f1c40f';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(sec.label, x + 16, y + 18);
      ctx.fillStyle = '#dfe6e9';
      ctx.font = '12px monospace';
      lines.forEach((ln, i) => ctx.fillText(ln, x + 16, y + 38 + i * 17));
      y += h + 8;
    }

    const bw = (w - 10) / 2;
    const by = canvasH - 16 - 40;
    this.button(ctx, x, by, bw, 40, '上一只', () => this.stepCodex(-1), 'plain');
    this.button(ctx, x + bw + 10, by, bw, 40, '下一只', () => this.stepCodex(1), 'plain');
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
