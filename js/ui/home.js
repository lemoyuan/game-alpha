import { canvasW, canvasH, GAME_TITLE } from '../consts';
import { safeTop } from '../render';
import { MONSTER_TYPES, CODEX_ORDER } from '../npc/monster/config';
import { loadImage } from '../base/sprite';
import { settings, saveSettings, records, formatTime } from '../storage';
import {
  UI, FS, R_CARD, R_BTN,
  sticker, button, iconButton, icon, label, stickerLabel, chip, badge, toggle, dish, wrapLines, roundRect,
} from './theme';

const PAD = 14; // 页面左右安全边距，所有面板宽度都从这里推算

// 首页：标题 + 开始游戏 + 设置 / 怪物图鉴 / 游戏记录 四个页面（databus.screen === 'home' 时接管触摸）
// 视觉一律走 ui/theme.js 的「厚描边卡通」图元，本文件不出现裸色值
export default class HomeScreen {
  constructor() {
    this.page = 'main'; // main | settings | codex | codexDetail | records
    this.codexType = null; // codexDetail 当前查看的怪物 type
    this.tapAreas = []; // 每帧绘制时重建的可点击区域
    this.tapFx = null; // 最近一次点中的按钮矩形 + 时间戳，画按压/回弹反馈用
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
        // 动作延 80ms 再跑：立即执行的话页面马上切走，手指看不到按压反馈
        this.tapFx = { x: a.x, y: a.y, w: a.w, h: a.h, t: Date.now() };
        const action = a.action;
        setTimeout(() => action(), 80);
        return;
      }
    }
  }

  goto(page) {
    this.page = page;
    this.tapFx = null; // 回弹环锚在旧页按钮矩形上，切页后留着会飘在空白处
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

  // 子页统一页头：左侧返回图标钮 + 居中标题，返回内容起始 y
  header(ctx, title, backTo) {
    const top = 16 + safeTop;
    iconButton(ctx, this.tapAreas, PAD, top, 38, 'arrowLeft', () => this.goto(backTo || 'main'));
    stickerLabel(ctx, title, canvasW / 2, top + 26, { size: FS.h1 });
    return top + 54;
  }

  draw(ctx) {
    this.tapAreas = [];
    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);
    if (this.page === 'settings') this.drawSettings(ctx);
    else if (this.page === 'codex') this.drawCodex(ctx);
    else if (this.page === 'codexDetail') this.drawCodexDetail(ctx);
    else if (this.page === 'records') this.drawRecords(ctx);
    else this.drawMain(ctx);
    this.drawTapFx(ctx);
  }

  // 点击反馈：0~90ms 按压（按钮内压一层半透明墨色），90~260ms 回弹（白色贴纸环外扩淡出）
  drawTapFx(ctx) {
    const fx = this.tapFx;
    if (!fx) return;
    const dt = Date.now() - fx.t;
    if (dt > 260) {
      this.tapFx = null;
      return;
    }
    ctx.save();
    if (dt < 90) {
      ctx.globalAlpha = 0.2;
      roundRect(ctx, fx.x + 3, fx.y + 3, fx.w - 6, fx.h - 6, R_BTN - 3);
      ctx.fillStyle = UI.ink;
      ctx.fill();
    } else {
      const k = (dt - 90) / 170;
      const g = 3 + k * 9;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.strokeStyle = UI.sticker;
      roundRect(ctx, fx.x - g, fx.y - g, fx.w + g * 2, fx.h + g * 2, R_BTN + g);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMain(ctx) {
    const top = 24 + safeTop;
    const cx = canvasW / 2;
    const titleY = top + canvasH * 0.17;

    badge(ctx, cx, titleY - 58, 25, 'virus', { color: UI.violet });
    stickerLabel(ctx, GAME_TITLE, cx, titleY, { size: Math.max(FS.title, Math.round(canvasW * 0.095)) });
    label(ctx, '俯视角生存肉鸽 · 走位、自动反击、活得更久', cx, titleY + 24, {
      size: FS.small, color: UI.blue, align: 'center',
    });

    const bw = Math.min(canvasW - PAD * 2 - 16, 320);
    const bx = (canvasW - bw) / 2;
    let y = top + canvasH * 0.33;
    button(ctx, this.tapAreas, {
      x: bx, y, w: bw, h: 64, text: '开始游戏', color: UI.mint, size: FS.h1,
      action: () => { if (this._onStart) this._onStart(); },
    });

    y += 64 + 18;
    const gap = 10;
    const w = (bw - gap * 2) / 3;
    const navs = [
      { text: '设置', icon: 'gear', page: 'settings' },
      { text: '怪物图鉴', icon: 'book', page: 'codex' },
      { text: '游戏记录', icon: 'chart', page: 'records' },
    ];
    navs.forEach((nav, i) => {
      button(ctx, this.tapAreas, {
        x: bx + (w + gap) * i, y, w, h: 58, text: nav.text, icon: nav.icon, stack: true,
        color: UI.cream, iconColor: UI.blue, size: FS.tiny, action: () => this.goto(nav.page),
      });
    });

    y += 58 + 20;
    const stats = [
      `最佳 ${formatTime(records.bestTime)}`,
      `最高 Lv.${records.bestLevel}`,
      `图鉴 ${records.encountered.length}/${CODEX_ORDER.length}`,
    ];
    const cw = (bw - gap * 2) / 3;
    stats.forEach((text, i) => {
      chip(ctx, bx + (cw + gap) * i, y, cw, 26, text, { color: UI.panelDeep, textColor: UI.textOnDark, size: FS.tiny });
    });

    label(ctx, '移动：按住屏幕任意位置拖动 · 攻击：自动索敌', cx, canvasH - 20 - safeTop, {
      size: FS.tiny, color: UI.muted, align: 'center',
    });
  }

  drawSettings(ctx) {
    const start = this.header(ctx, '设置');
    const w = Math.min(canvasW - PAD * 2, 340);
    const x = (canvasW - w) / 2;
    const rows = [
      { label: '伤害飘字', desc: '命中时显示伤害数字', key: 'damageText', enabled: true, icon: 'bullet' },
      { label: '受击振动', desc: '受伤与按钮反馈时短振动', key: 'vibrate', enabled: true, icon: 'phone' },
      { label: '音效', desc: '待接入音频系统', key: 'sound', enabled: false, icon: 'note' },
      { label: '背景音乐', desc: '待接入音频系统', key: 'bgm', enabled: false, icon: 'headphones' },
    ];
    const rh = 62;
    rows.forEach((row, i) => {
      const y = start + i * (rh + 10);
      const on = row.enabled && settings[row.key];
      this.tapAreas.push({
        x, y, w, h: rh,
        action: () => {
          if (!row.enabled) return;
          settings[row.key] = !settings[row.key];
          saveSettings();
        },
      });
      sticker(ctx, x, y, w, rh, { fill: row.enabled ? UI.cream : UI.panelDeep, r: R_CARD, line: 2.5, top: row.enabled });
      badge(ctx, x + 16 + 15, y + rh / 2, 15, row.icon, { color: row.enabled ? UI.blue : UI.muted, shadow: false });
      const tx = x + 16 + 15 + 15 + 14;
      label(ctx, row.label, tx, y + 26, {
        size: FS.h2, bold: true, color: row.enabled ? UI.textOnLight : UI.muted,
      });
      label(ctx, row.desc, tx, y + 44, { size: FS.tiny, color: row.enabled ? UI.textOnLight : UI.muted });
      toggle(ctx, x + w - 46 - 16, y + (rh - 26) / 2, 46, 26, on, { disabled: !row.enabled });
    });
  }

  // 图鉴头像：培养皿底盘 + 游戏内贴图（圆形裁切），贴图未加载完回退成识别色底
  avatar(ctx, config, cx, cy, r, unlocked) {
    const img = unlocked && config.sprite ? loadImage(config.sprite) : null;
    const ready = !!(img && img.width && img.height);
    dish(ctx, cx, cy, r, { fill: unlocked ? (ready ? UI.bg : (config.color || UI.blue)) : UI.panelDeep });
    if (ready) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    } else if (!unlocked) {
      icon(ctx, 'lock', cx, cy, r * 1.1, { color: UI.muted });
    }
  }

  drawCodex(ctx) {
    const start = this.header(ctx, '怪物图鉴');
    const w = Math.min(canvasW - PAD * 2, 360);
    const x = (canvasW - w) / 2;
    const n = CODEX_ORDER.length;
    const rh = Math.min(66, Math.floor((canvasH - start - 24) / n) - 8);
    CODEX_ORDER.forEach((entry, i) => {
      const y = start + i * (rh + 10);
      const config = MONSTER_TYPES[entry.type];
      const unlocked = records.encountered.indexOf(entry.type) !== -1;
      const r = 17;
      const cy = y + rh / 2;
      sticker(ctx, x, y, w, rh, { fill: unlocked ? UI.cream : UI.panelDeep, r: R_CARD, line: 2.5 });
      this.avatar(ctx, config, x + 14 + r, cy, r, unlocked);

      const tx = x + 14 + r * 2 + 12;
      if (!unlocked) {
        label(ctx, '未知怪物', tx, cy - 4, { size: FS.body, bold: true, color: UI.muted });
        label(ctx, '尚未遭遇，进游戏里碰碰看', tx, cy + 14, { size: FS.tiny, color: UI.muted });
        return;
      }
      const role = config.boss ? 'Boss' : entry.appear;
      label(ctx, `${config.name}（${role}）`, tx, y + 22, { size: FS.body, bold: true, color: UI.textOnLight });
      label(ctx, config.group, tx, y + 38, { size: FS.tiny, color: UI.blue });
      label(ctx, `血量${config.hp} · 移速${config.speed} · 伤害${config.damage} · 经验${config.xp}`, tx, y + 54, {
        size: FS.tiny, color: UI.muted,
      });
      icon(ctx, 'arrowRight', x + w - 20, cy, 14, { color: UI.textOnLight });
      this.tapAreas.push({ x, y, w, h: rh, action: () => this.openCodex(entry.type) });
    });
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
    const w = Math.min(canvasW - PAD * 2, 360);
    const x = (canvasW - w) / 2;

    // 头部卡：培养皿贴图 + 昵称 + 学名 + 分类阶元
    const headH = 112;
    const r = 38;
    sticker(ctx, x, start, w, headH, { fill: UI.cream, r: R_CARD });
    this.avatar(ctx, config, x + 16 + r, start + headH / 2, r, unlocked);
    const tx = x + 16 + r * 2 + 14;
    label(ctx, unlocked ? config.name : '未知怪物', tx, start + 32, { size: FS.h2, bold: true, color: UI.textOnLight });
    label(ctx, unlocked ? config.latin : '???', tx, start + 50, { size: FS.small, color: UI.blue });
    label(ctx, unlocked ? config.group : '尚未遭遇', tx, start + 68, { size: FS.tiny, color: UI.muted });
    chip(ctx, tx, start + 78, 118, 22, `出现：${config.boss ? 'Boss 定时' : entry.appear}`, {
      color: unlocked ? UI.gold : UI.panelDeep, size: FS.tiny,
    });

    const sections = unlocked
      ? [
        { label: '游戏机制', color: UI.blue, text: config.intro },
        { label: '冷知识', color: UI.gold, text: config.fact },
        {
          label: '数值',
          color: UI.mint,
          text: `血量 ${config.hp} · 移速 ${config.speed} · 接触伤害 ${config.damage} · 经验 ${config.xp} · 碰撞半径 ${config.radius}`,
        },
      ]
      : [{ label: '说明', color: UI.muted, text: '进游戏里遭遇一次，这张卡就会自动解锁，不需要额外操作。' }];

    let y = start + headH + 12;
    const maxW = w - 32;
    for (const sec of sections) {
      const lines = wrapLines(ctx, sec.text, maxW, FS.body);
      const h = 40 + lines.length * 18 + 6;
      sticker(ctx, x, y, w, h, { fill: UI.cream, r: R_CARD, line: 2.5 });
      chip(ctx, x + 16, y + 12, 16 + sec.label.length * FS.small, 20, sec.label, { color: sec.color, size: FS.tiny });
      label(ctx, lines[0], x + 16, y + 50, { size: FS.body, color: UI.textOnLight });
      for (let i = 1; i < lines.length; i++) {
        label(ctx, lines[i], x + 16, y + 50 + i * 18, { size: FS.body, color: UI.textOnLight });
      }
      y += h + 10;
    }

    const bw = (w - 12) / 2;
    const by = canvasH - 16 - 44;
    button(ctx, this.tapAreas, { x, y: by, w: bw, h: 44, text: '上一只', icon: 'arrowLeft', color: UI.cream, size: FS.small, action: () => this.stepCodex(-1) });
    button(ctx, this.tapAreas, { x: x + bw + 12, y: by, w: bw, h: 44, text: '下一只', icon: 'arrowRight', color: UI.cream, size: FS.small, action: () => this.stepCodex(1) });
  }

  drawRecords(ctx) {
    const start = this.header(ctx, '游戏记录');
    const w = Math.min(canvasW - PAD * 2, 340);
    const x = (canvasW - w) / 2;
    const best = [
      { label: '最长生存', value: formatTime(records.bestTime), icon: 'hourglass', color: UI.blue },
      { label: '最高等级', value: `Lv.${records.bestLevel}`, icon: 'medal', color: UI.gold },
      { label: '最多击杀', value: `${records.bestKills}`, icon: 'skull', color: UI.red },
      { label: '累计开箱', value: `${records.totalChests}`, icon: 'chest', color: UI.mint },
    ];
    const cellW = (w - 12) / 2;
    best.forEach((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = x + col * (cellW + 12);
      const cy = start + row * (66 + 12);
      sticker(ctx, cx, cy, cellW, 66, { fill: UI.cream, r: R_CARD, line: 2.5 });
      badge(ctx, cx + 14 + 14, cy + 66 / 2, 14, item.icon, { color: item.color, shadow: false });
      const tx = cx + 14 + 14 + 14 + 12;
      label(ctx, item.label, tx, cy + 27, { size: FS.tiny, color: UI.muted });
      label(ctx, item.value, tx, cy + 50, { size: FS.h1, bold: true, color: UI.textOnLight });
    });

    let y = start + 66 * 2 + 12 + 30;
    label(ctx, '最近战绩', x + 4, y, { size: FS.body, bold: true, color: UI.textOnDark });
    y += 14;
    if (records.runs.length === 0) {
      label(ctx, '还没有战绩，先去玩一局', x + 4, y + 22, { size: FS.small, color: UI.muted });
      return;
    }
    records.runs.forEach((run, i) => {
      const ry = y + i * 34;
      sticker(ctx, x, ry, w, 30, { fill: UI.panelDeep, r: R_BTN, line: 2, top: false, shadowY: 2 });
      const text = { size: FS.tiny, baseline: 'middle' };
      label(ctx, `${i + 1}. 生存 ${formatTime(run.t)}`, x + 12, ry + 15, { ...text, color: UI.textOnDark });
      label(ctx, `Lv.${run.lv} · 击杀 ${run.k} · 宝箱 ${run.c}`, x + w - 12, ry + 15, { ...text, color: UI.muted, align: 'right' });
    });
  }
}
