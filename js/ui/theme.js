// 「厚描边卡通」UI 设计令牌 + 共用图元
// 全部界面统一从这里取色和画法：改风格只改本文件，不要回到各 ui/*.js 里手写色值
// 视觉语言：奶油/饱和色块 + 粗深色描边 + 白色贴纸外框 + 硬投影；无渐变、无发光（shadowBlur 在低端机掉帧）

export const UI = {
  bg: '#1A1F35',        // 界面底色（深海军蓝）
  panelDeep: '#24304F', // 深色面板：比底色亮一档，用于未解锁/次要块
  ink: '#1C2843',       // 所有描边与硬投影的颜色
  sticker: '#FFFFFF',   // 贴纸外框（画在描边外侧的一圈白）
  cream: '#F7F3E8',     // 主面板色（奶油）
  blue: '#3FA9F5',      // 主操作 / 攻击
  red: '#E74C3C',       // 危险 / 生命 / 伤害
  gold: '#F5B041',      // 强调 / 经验 / 新纪录
  mint: '#2ECC71',      // 开启态 / 增益
  violet: '#9B59B6',    // 稀有 / 特殊
  textOnLight: '#1C2843', // 奶油底上的正文
  textOnDark: '#F7F3E8',  // 深底上的正文
  muted: '#8A95A5',       // 次要说明文字
  dim: 'rgba(10,12,24,0.72)', // 全屏遮罩
  shadow: 'rgba(8,10,20,0.45)', // 硬投影
  highlight: 'rgba(255,255,255,0.18)', // 面板顶部高光带
  hudPanel: 'rgba(26,31,53,0.78)', // 战斗内半透明底板（UI.bg 的半透明版）
  bossChestBody: '#151013',  // Boss 专属匣箱体：近黑底，和普通金匣一眼分开
  bossChestBand: '#7B1E12',  // Boss 专属匣箍带 + HUD 计数色：暗红
  bossChestHalo: 'rgba(231,76,60,0.32)', // Boss 专属匣脉冲光晕（平涂 rgba，无渐变无 shadowBlur）
  toxic: '#C15BD8',        // 中毒状态：赤潮毒素的滴落描边与跳血提示。刻意避开海火自己的青 #22d3ee（毒圈要能在自家池子里被看见）、mint（那是增益）和 red（那是伤害/生命）
  burn: '#FF6B35',         // 燃烧子弹：怪物身上的火苗与跳血字。刻意避开 gold #F5B041（HUD 那一列宝箱道具全是这个金，13px 字号下橙金不分）、red #E74C3C（那是伤害/生命）、toxic #C15BD8（那是赤潮毒素，两套 DoT 必须一眼分开）
  blood: '#E8355C',        // 突变型刺头身上的红斑 + 掉落血块。刻意避开 red #E74C3C（那是伤害飘字，而且喷子的识别色就是它，同色会让突变体读成第二只喷子）、bossChestBand #7B1E12（那是 Boss 专属匣的暗砖红）、toxic #C15BD8（那是赤潮毒素）；往洋红偏一点才既像「血」又不和自家红撞
};

export const R_CARD = 16;   // 卡片圆角
export const R_BTN = 14;    // 按钮圆角
export const LINE = 3;      // 主描边宽度
export const BORDER = 2.5;  // 白色贴纸外框宽度
export const SHADOW_Y = 4;  // 硬投影向下偏移
export const FONT = 'monospace'; // 字体族（小游戏不便加载自定义字体，统一用等宽）

// 字号阶梯：全项目只用这几档，避免每个界面各写一个字号
export const FS = {
  title: 26,  // 首页大标题
  h1: 20,     // 页面标题
  h2: 16,     // 卡片标题 / 按钮
  body: 13,   // 正文
  small: 11,  // 说明
  tiny: 10,   // 极小说明 / 未解锁提示
};

export const font = (size, bold) => `${bold ? 'bold ' : ''}${size}px ${FONT}`;

// 圆角矩形路径（arcTo 实现，兼容性比原生 ctx.roundRect 好）
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * 贴纸块：所有面板/按钮/卡片的地基
 * 顺序 = 硬投影 → 白色外框 → 填充 → 深色描边 → 顶部高光
 * @param {Object} o fill 填充色 / r 圆角 / line 描边宽 / border 是否要白色外框 / shadow 是否要硬投影 / top 是否要顶部高光
 */
export function sticker(ctx, x, y, w, h, o = {}) {
  const r = o.r === undefined ? R_BTN : o.r;
  const line = o.line === undefined ? LINE : o.line;
  const fill = o.fill || UI.cream;
  if (o.shadow !== false) {
    roundRect(ctx, x, y + (o.shadowY === undefined ? SHADOW_Y : o.shadowY), w, h, r);
    ctx.fillStyle = o.shadowColor || UI.shadow;
    ctx.fill();
  }
  if (o.border !== false) {
    roundRect(ctx, x - BORDER, y - BORDER, w + BORDER * 2, h + BORDER * 2, r + BORDER);
    ctx.fillStyle = UI.sticker;
    ctx.fill();
  }
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line > 0) {
    ctx.strokeStyle = o.stroke || UI.ink;
    ctx.lineWidth = line;
    ctx.stroke();
  }
  if (o.top !== false && h > 18) {
    roundRect(ctx, x + line + 2, y + line + 2, w - (line + 2) * 2, h * 0.3, Math.max(2, r - 4));
    ctx.fillStyle = UI.highlight;
    ctx.fill();
  }
}

// 文本：统一设置字体与对齐，baseline 默认 alphabetic，画完还原避免影响别处
export function label(ctx, text, x, y, o = {}) {
  ctx.font = font(o.size || FS.body, o.bold);
  ctx.fillStyle = o.color || UI.textOnDark;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';
  ctx.fillText(text, x, y);
  ctx.textBaseline = 'alphabetic';
}

// 居中文本：按基线居中，按钮/药丸里最好用
export function labelMid(ctx, text, cx, cy, o = {}) {
  label(ctx, text, cx, cy, { ...o, align: 'center', baseline: 'middle' });
}

// 贴纸字：先粗描深色再平涂，标题专用（小游戏加载不了自定义字体，靠描边做出厚度）
export function stickerLabel(ctx, text, x, y, o = {}) {
  const size = o.size || FS.h1;
  ctx.font = font(size, o.bold === undefined ? true : o.bold);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.baseline || 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = o.width === undefined ? Math.max(3, size * 0.24) : o.width;
  ctx.strokeStyle = o.stroke || UI.ink;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = o.color || UI.cream;
  ctx.fillText(text, x, y);
}

/**
 * 按钮：注册点击区 + 绘制，命中判定与外观永远一致
 * @param {Array} areas 每帧重建的点击区数组（{ x, y, w, h, action }）
 */
export function button(ctx, areas, o) {
  if (o.action && !o.disabled) areas.push({ x: o.x, y: o.y, w: o.w, h: o.h, action: o.action });
  const dark = o.color === UI.cream || o.color === UI.gold || o.color === UI.mint || o.color === UI.blue;
  const fill = o.disabled ? UI.panelDeep : (o.color || UI.blue);
  const textColor = o.textColor || (o.disabled ? UI.muted : (dark ? UI.textOnLight : UI.textOnDark));
  const iconColor = o.iconColor || textColor; // 图标单独上色，避免书/齿轮这类实心图形糊成一团
  sticker(ctx, o.x, o.y, o.w, o.h, { fill, r: o.r === undefined ? R_BTN : o.r });
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  if (o.stack) {
    // 图标在上、文字在下：窄按钮（首页三宫格、升级卡）用这种排布才不会挤
    if (o.icon) icon(ctx, o.icon, cx, cy - o.h * 0.19, Math.min(o.w * 0.34, o.h * 0.42), { color: iconColor });
    if (o.text) labelMid(ctx, o.text, cx, cy + o.h * 0.24, { size: o.size || FS.tiny, bold: true, color: textColor });
    return;
  }
  if (o.icon) {
    const s = Math.min(o.h * 0.5, 22);
    const size = o.size || Math.max(FS.small, Math.round(o.h * 0.34));
    if (!o.text) {
      icon(ctx, o.icon, cx, cy, s, { color: iconColor });
      return;
    }
    ctx.font = font(size, true);
    const tw = ctx.measureText(o.text).width;
    const left = cx - (s + 6 + tw) / 2; // 图标与文字作为一个整体居中，避免中文标签压到图标
    icon(ctx, o.icon, left + s / 2, cy, s, { color: iconColor });
    labelMid(ctx, o.text, left + s + 6 + tw / 2, cy + 1, { size, bold: true, color: textColor });
    return;
  }
  if (o.text) labelMid(ctx, o.text, cx, cy + 1, { size: o.size || Math.max(FS.small, Math.round(o.h * 0.34)), bold: true, color: textColor });
}

// 图标按钮（正方形，只画图标）
export function iconButton(ctx, areas, x, y, size, name, action, o = {}) {
  button(ctx, areas, { x, y, w: size, h: size, icon: name, action, color: o.color || UI.cream, textColor: o.color || UI.textOnLight, disabled: o.disabled });
}

/**
 * 进度条：贴纸底 + 填充 + 描边
 * @param {number} ratio 0~1
 */
export function bar(ctx, x, y, w, h, ratio, color, o = {}) {
  const r = o.r === undefined ? h / 2 : o.r;
  sticker(ctx, x, y, w, h, { fill: o.bg || UI.panelDeep, r, line: o.line === undefined ? 2 : o.line, top: false, border: o.border });
  const v = Math.max(0, Math.min(1, ratio));
  if (v > 0.001) {
    const inset = 2.5;
    roundRect(ctx, x + inset, y + inset, Math.max(v * 6, (w - inset * 2) * v), h - inset * 2, Math.max(1, r - inset));
    ctx.fillStyle = color || UI.mint;
    ctx.fill();
  }
}

// 药丸徽章：圆角小片，放数字或短标签
export function chip(ctx, x, y, w, h, text, o = {}) {
  sticker(ctx, x, y, w, h, { fill: o.color || UI.cream, r: h / 2, line: o.line === undefined ? 2 : o.line, top: false, shadow: o.shadow });
  const dark = o.color !== UI.panelDeep && o.color !== UI.ink;
  labelMid(ctx, text, x + w / 2, y + h / 2 + 1, { size: o.size || FS.small, bold: o.bold !== false, color: o.textColor || (dark ? UI.textOnLight : UI.textOnDark) });
}

// 圆形图标徽章：HUD 与卡片里复用最多次的元素
export function badge(ctx, cx, cy, r, name, o = {}) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + BORDER, 0, Math.PI * 2);
  ctx.fillStyle = UI.sticker;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + (o.shadow === false ? 0 : 2), r, 0, Math.PI * 2);
  ctx.fillStyle = o.shadow === false ? (o.color || UI.blue) : UI.shadow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = o.color || UI.blue;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.ink;
  ctx.stroke();
  if (name) icon(ctx, name, cx, cy, r * 1.15, { color: o.iconColor || UI.textOnDark });
}

// 开关：贴纸轨道 + 白色圆钮
export function toggle(ctx, x, y, w, h, on, o = {}) {
  const disabled = !!o.disabled;
  sticker(ctx, x, y, w, h, { fill: disabled ? UI.panelDeep : (on ? UI.mint : '#5A6478'), r: h / 2, line: 2, top: false });
  const r = h / 2 - 3;
  const cx = disabled ? x + w / 2 : (on ? x + w - r - 3 : x + r + 3);
  ctx.beginPath();
  ctx.arc(cx, y + h / 2, r + BORDER, 0, Math.PI * 2);
  ctx.fillStyle = UI.sticker;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, y + h / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = disabled ? '#8A95A5' : UI.cream;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.ink;
  ctx.stroke();
}

// 培养皿底盘：图鉴头像/展示位
export function dish(ctx, cx, cy, r, o = {}) {
  ctx.beginPath();
  ctx.arc(cx, cy + 3, r + BORDER, 0, Math.PI * 2);
  ctx.fillStyle = UI.shadow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r + BORDER, 0, Math.PI * 2);
  ctx.fillStyle = UI.sticker;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = o.fill || UI.cream;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = UI.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(28,40,67,0.25)';
  ctx.stroke();
}

// 绶带角标：贴在卡片右下角的「已选中 / 新纪录」
export function ribbon(ctx, x, y, w, h, text, o = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(o.clipX === undefined ? x : o.clipX, o.clipY === undefined ? y : o.clipY, o.clipW || w, o.clipH || h);
  ctx.clip();
  ctx.translate(x + w * 0.5, y + h * 0.5);
  ctx.rotate(o.angle === undefined ? -0.22 : o.angle);
  const bw = o.bandW || w * 0.9;
  roundRect(ctx, -bw / 2, -h * 0.28, bw, h * 0.56, 4);
  ctx.fillStyle = o.color || UI.gold;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = UI.ink;
  ctx.stroke();
  labelMid(ctx, text, 0, 1, { size: o.size || FS.tiny, bold: true, color: o.textColor || UI.textOnLight });
  ctx.restore();
}

// 中文按字断行：canvas 没有自动换行，图鉴冷知识是整句
export function wrapLines(ctx, text, maxW, size) {
  ctx.font = font(size);
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

/**
 * 代码绘制的卡通图标：统一「居中于 cx/cy，占 s×s，粗描边 + 平涂」
 * color 是主体填充色，描边恒为 UI.ink
 */
export function icon(ctx, name, cx, cy, s, o = {}) {
  const color = o.color || UI.cream;
  const h = s / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = Math.max(1.5, s * 0.1);
  ctx.strokeStyle = UI.ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const solid = (path) => { path(); ctx.fillStyle = color; ctx.fill(); ctx.stroke(); };
  const dot = (dx, dy, r, c) => { ctx.beginPath(); ctx.arc(dx, dy, r, 0, Math.PI * 2); ctx.fillStyle = c || UI.ink; ctx.fill(); };
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

  switch (name) {
    case 'heart':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(0, h * 0.85);
        ctx.bezierCurveTo(-h * 1.25, -h * 0.1, -h * 0.5, -h, 0, -h * 0.35);
        ctx.bezierCurveTo(h * 0.5, -h, h * 1.25, -h * 0.1, 0, h * 0.85);
        ctx.closePath();
      });
      break;
    case 'boot':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.5, -h * 0.9);
        ctx.lineTo(h * 0.15, -h * 0.9);
        ctx.lineTo(h * 0.15, h * 0.15);
        ctx.lineTo(h * 0.85, h * 0.5);
        ctx.lineTo(h * 0.85, h * 0.9);
        ctx.lineTo(-h * 0.5, h * 0.9);
        ctx.closePath();
      });
      break;
    case 'gun':
      solid(() => {
        ctx.beginPath();
        ctx.rect(-h * 0.9, -h * 0.35, h * 1.5, h * 0.5);
      });
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.35, h * 0.1);
        ctx.lineTo(h * 0.05, h * 0.1);
        ctx.lineTo(-h * 0.25, h * 0.9);
        ctx.lineTo(-h * 0.65, h * 0.9);
        ctx.closePath();
      });
      break;
    case 'shield':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.95);
        ctx.lineTo(h * 0.8, -h * 0.55);
        ctx.lineTo(h * 0.8, h * 0.2);
        ctx.lineTo(0, h * 0.95);
        ctx.lineTo(-h * 0.8, h * 0.2);
        ctx.lineTo(-h * 0.8, -h * 0.55);
        ctx.closePath();
      });
      break;
    case 'bolt':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.15, -h * 0.95);
        ctx.lineTo(-h * 0.75, h * 0.15);
        ctx.lineTo(-h * 0.1, h * 0.15);
        ctx.lineTo(-h * 0.25, h * 0.95);
        ctx.lineTo(h * 0.75, -h * 0.2);
        ctx.lineTo(h * 0.05, -h * 0.2);
        ctx.closePath();
      });
      break;
    case 'target':
      solid(() => { ctx.beginPath(); ctx.arc(0, 0, h * 0.85, 0, Math.PI * 2); });
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = UI.ink;
      ctx.fill();
      line(0, -h, 0, -h * 0.55);
      line(0, h * 0.55, 0, h);
      line(-h, 0, -h * 0.55, 0);
      line(h * 0.55, 0, h, 0);
      break;
    case 'star':
      solid(() => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? h * 0.42 : h * 0.95;
          const a = -Math.PI / 2 + (Math.PI / 5) * i;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      });
      break;
    case 'clover':
      solid(() => { ctx.beginPath(); ctx.arc(-h * 0.35, -h * 0.35, h * 0.4, 0, Math.PI * 2); });
      solid(() => { ctx.beginPath(); ctx.arc(h * 0.35, -h * 0.35, h * 0.4, 0, Math.PI * 2); });
      solid(() => { ctx.beginPath(); ctx.arc(-h * 0.35, h * 0.3, h * 0.4, 0, Math.PI * 2); });
      solid(() => { ctx.beginPath(); ctx.arc(h * 0.35, h * 0.3, h * 0.4, 0, Math.PI * 2); });
      line(0, h * 0.5, 0, h);
      break;
    case 'bullet':
      // 竖立整弹：圆弧弹头 + 弹壳 + 外扩底缘。旧的横躺画法在 14px 行高里只有 4px 高，
      // 读成一条短横线，还和 pierce 的横向箭头撞方向；竖构图才吃得住行高
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.42, -h * 0.05);
        ctx.quadraticCurveTo(-h * 0.42, -h * 0.55, 0, -h * 0.95);
        ctx.quadraticCurveTo(h * 0.42, -h * 0.55, h * 0.42, -h * 0.05);
        ctx.lineTo(h * 0.42, h * 0.62);
        ctx.lineTo(h * 0.56, h * 0.62);
        ctx.lineTo(h * 0.56, h * 0.95);
        ctx.lineTo(-h * 0.56, h * 0.95);
        ctx.lineTo(-h * 0.56, h * 0.62);
        ctx.lineTo(-h * 0.42, h * 0.62);
        ctx.closePath();
      });
      line(-h * 0.42, -h * 0.05, h * 0.42, -h * 0.05); // 弹头与弹壳分界
      line(-h * 0.42, h * 0.62, h * 0.42, h * 0.62);   // 弹壳与底缘分界
      break;
    case 'pierce':
      line(-h * 0.95, 0, h * 0.95, 0);
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.95, 0);
        ctx.lineTo(h * 0.4, -h * 0.4);
        ctx.lineTo(h * 0.4, h * 0.4);
        ctx.closePath();
      });
      ctx.beginPath();
      ctx.arc(-h * 0.15, 0, h * 0.5, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.strokeStyle = UI.ink;
      ctx.stroke();
      break;
    case 'buddy':
      solid(() => {
        ctx.beginPath();
        ctx.arc(0, -h * 0.2, h * 0.55, Math.PI, 0);
        ctx.lineTo(h * 0.55, h * 0.7);
        ctx.lineTo(-h * 0.55, h * 0.7);
        ctx.closePath();
      });
      dot(-h * 0.2, -h * 0.15, h * 0.1);
      dot(h * 0.2, -h * 0.15, h * 0.1);
      break;
    case 'hourglass':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.7, -h * 0.85);
        ctx.lineTo(h * 0.7, -h * 0.85);
        ctx.lineTo(-h * 0.7, h * 0.85);
        ctx.lineTo(h * 0.7, h * 0.85);
        ctx.closePath();
      });
      line(-h * 0.85, -h * 0.95, h * 0.85, -h * 0.95);
      line(-h * 0.85, h * 0.95, h * 0.85, h * 0.95);
      break;
    case 'skull':
      solid(() => { ctx.beginPath(); ctx.arc(0, -h * 0.15, h * 0.72, 0, Math.PI * 2); });
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.4, h * 0.35, h * 0.8, h * 0.5); });
      dot(-h * 0.28, -h * 0.2, h * 0.17);
      dot(h * 0.28, -h * 0.2, h * 0.17);
      break;
    case 'chest':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.85, -h * 0.1);
        ctx.quadraticCurveTo(0, -h * 1.05, h * 0.85, -h * 0.1);
        ctx.closePath();
      });
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.85, -h * 0.1, h * 1.7, h * 0.85); });
      line(0, -h * 0.55, 0, h * 0.75);
      break;
    case 'cellfuse':
      // 多核巨细胞：一个大胞体里散着三颗核，对应 HCMV 把一圈细胞融成一团（融合匣图标）
      solid(() => { ctx.beginPath(); ctx.arc(0, 0, h * 0.9, 0, Math.PI * 2); });
      dot(-h * 0.32, -h * 0.25, h * 0.2);
      dot(h * 0.34, -h * 0.1, h * 0.17);
      dot(-h * 0.05, h * 0.38, h * 0.15);
      break;
    case 'flame':
      // 燃烧子弹：外焰是上尖下圆的火舌（跟随调用方 color 平涂），芯一颗奶白内焰负责读出层次
      // ★内焰不要改成 ink 描边：HUD 这一行图标只有 14px，描边会和外焰轮廓糊成一片
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.95);
        ctx.bezierCurveTo(h * 0.58, -h * 0.45, h * 0.92, h * 0.05, h * 0.5, h * 0.6);
        ctx.bezierCurveTo(h * 0.26, h * 0.92, -h * 0.26, h * 0.92, -h * 0.5, h * 0.6);
        ctx.bezierCurveTo(-h * 0.92, h * 0.05, -h * 0.58, -h * 0.45, 0, -h * 0.95);
        ctx.closePath();
      });
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.1);
      ctx.bezierCurveTo(h * 0.3, h * 0.18, h * 0.3, h * 0.5, 0, h * 0.62);
      ctx.bezierCurveTo(-h * 0.3, h * 0.5, -h * 0.3, h * 0.18, 0, -h * 0.1);
      ctx.closePath();
      ctx.fillStyle = UI.cream;
      ctx.fill();
      break;
    case 'magnet':
      // 经验拾取范围：中间一颗经验宝石（同 xpgem 的菱形），两侧箭头朝内 = 远处的宝石被吸过来
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.5);
        ctx.lineTo(h * 0.42, 0);
        ctx.lineTo(0, h * 0.5);
        ctx.lineTo(-h * 0.42, 0);
        ctx.closePath();
      });
      line(-h, -h * 0.42, -h * 0.62, 0);
      line(-h, h * 0.42, -h * 0.62, 0);
      line(h, -h * 0.42, h * 0.62, 0);
      line(h, h * 0.42, h * 0.62, 0);
      break;
    case 'gear': {
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((Math.PI / 4) * i);
        solid(() => { ctx.beginPath(); ctx.rect(-h * 0.16, -h, h * 0.32, h * 0.34); });
        ctx.restore();
      }
      // 本体画成挖孔圆环：实心圆 + 中心点在小尺寸下会糊成一个刺球
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.75, 0, Math.PI * 2);
      ctx.arc(0, 0, h * 0.3, 0, Math.PI * 2, true);
      ctx.fillStyle = color;
      ctx.fill('evenodd');
      ctx.stroke();
      break;
    }
    case 'book':
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.8, -h * 0.8, h * 1.6, h * 1.6); });
      line(-h * 0.35, -h * 0.8, -h * 0.35, h * 0.8);
      dot(h * 0.2, -h * 0.15, h * 0.16);
      line(h * 0.05, h * 0.4, h * 0.5, h * 0.4);
      break;
    case 'trophy':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.6, -h * 0.8);
        ctx.lineTo(h * 0.6, -h * 0.8);
        ctx.lineTo(h * 0.35, h * 0.25);
        ctx.lineTo(-h * 0.35, h * 0.25);
        ctx.closePath();
      });
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.45, h * 0.5, h * 0.9, h * 0.35); });
      line(-h * 0.6, -h * 0.5, -h * 0.9, -h * 0.5);
      line(h * 0.6, -h * 0.5, h * 0.9, -h * 0.5);
      break;
    case 'lock':
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.7, -h * 0.1, h * 1.4, h * 0.95); });
      ctx.beginPath();
      ctx.arc(0, -h * 0.25, h * 0.45, Math.PI, 0);
      ctx.lineWidth = Math.max(2, s * 0.12);
      ctx.stroke();
      dot(0, h * 0.35, h * 0.14);
      break;
    case 'arrowLeft':
    case 'arrowRight': {
      const d = name === 'arrowLeft' ? -1 : 1;
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-d * h * 0.85, -h * 0.75);
        ctx.lineTo(-d * h * 0.85, h * 0.75);
        ctx.lineTo(d * h * 0.85, 0);
        ctx.closePath();
      });
      break;
    }
    case 'replay':
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.7, -Math.PI * 0.35, Math.PI * 1.4);
      ctx.lineWidth = Math.max(2, s * 0.14);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.strokeStyle = UI.ink;
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.75, -h * 0.75);
        ctx.lineTo(h * 0.95, -h * 0.1);
        ctx.lineTo(h * 0.25, -h * 0.3);
        ctx.closePath();
      });
      break;
    case 'home':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.85);
        ctx.lineTo(h * 0.85, h * 0.05);
        ctx.lineTo(-h * 0.85, h * 0.05);
        ctx.closePath();
      });
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.55, h * 0.05, h * 1.1, h * 0.75); });
      break;
    case 'virus':
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        line(Math.cos(a) * h * 0.6, Math.sin(a) * h * 0.6, Math.cos(a) * h, Math.sin(a) * h);
        dot(Math.cos(a) * h, Math.sin(a) * h, h * 0.12, color);
      }
      solid(() => { ctx.beginPath(); ctx.arc(0, 0, h * 0.65, 0, Math.PI * 2); });
      dot(-h * 0.22, -h * 0.05, h * 0.1);
      dot(h * 0.22, -h * 0.05, h * 0.1);
      break;
    case 'drop':
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.95);
        ctx.quadraticCurveTo(h * 0.8, h * 0.05, 0, h * 0.85);
        ctx.quadraticCurveTo(-h * 0.8, h * 0.05, 0, -h * 0.95);
        ctx.closePath();
      });
      break;
    case 'bubble':
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.85, -h * 0.8, h * 1.7, h * 1.2); });
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.3, h * 0.4);
        ctx.lineTo(h * 0.1, h * 0.4);
        ctx.lineTo(-h * 0.3, h * 0.9);
        ctx.closePath();
      });
      break;
    case 'phone':
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.45, -h * 0.9, h * 0.9, h * 1.8); });
      line(-h * 0.15, h * 0.6, h * 0.15, h * 0.6);
      ctx.beginPath();
      ctx.arc(h * 0.75, 0, h * 0.4, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      break;
    case 'note':
      solid(() => { ctx.beginPath(); ctx.arc(-h * 0.45, h * 0.55, h * 0.35, 0, Math.PI * 2); });
      line(-h * 0.1, h * 0.55, -h * 0.1, -h * 0.75);
      line(-h * 0.1, -h * 0.75, h * 0.7, -h * 0.45);
      break;
    case 'headphones':
      ctx.beginPath();
      ctx.arc(0, h * 0.1, h * 0.75, Math.PI, 0);
      ctx.lineWidth = Math.max(2, s * 0.12);
      ctx.stroke();
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.95, h * 0.05, h * 0.45, h * 0.75); });
      solid(() => { ctx.beginPath(); ctx.rect(h * 0.5, h * 0.05, h * 0.45, h * 0.75); });
      break;
    case 'globe':
      solid(() => { ctx.beginPath(); ctx.arc(0, 0, h * 0.8, 0, Math.PI * 2); });
      ctx.beginPath();
      ctx.ellipse(0, 0, h * 0.35, h * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      line(-h * 0.8, 0, h * 0.8, 0);
      break;
    case 'chart':
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.8, h * 0.1, h * 0.4, h * 0.7); });
      solid(() => { ctx.beginPath(); ctx.rect(-h * 0.2, -h * 0.35, h * 0.4, h * 1.15); });
      solid(() => { ctx.beginPath(); ctx.rect(h * 0.4, -h * 0.8, h * 0.4, h * 1.6); });
      break;
    case 'medal':
      solid(() => { ctx.beginPath(); ctx.arc(0, h * 0.2, h * 0.6, 0, Math.PI * 2); });
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.5, -h * 0.9);
        ctx.lineTo(-h * 0.1, -h * 0.2);
        ctx.lineTo(-h * 0.55, -h * 0.05);
        ctx.closePath();
      });
      solid(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.5, -h * 0.9);
        ctx.lineTo(h * 0.1, -h * 0.2);
        ctx.lineTo(h * 0.55, -h * 0.05);
        ctx.closePath();
      });
      break;
    case 'pause':
      // 暂停：两条圆头竖杠。HUD 右上角那颗按钮专用，方贴 + 圆角条才不会和圆形道具格看混
      solid(() => { roundRect(ctx, -h * 0.62, -h * 0.82, h * 0.44, h * 1.64, h * 0.2); });
      solid(() => { roundRect(ctx, h * 0.18, -h * 0.82, h * 0.44, h * 1.64, h * 0.2); });
      break;
    default:
      solid(() => { ctx.beginPath(); ctx.arc(0, 0, h * 0.7, 0, Math.PI * 2); });
      break;
  }
  ctx.restore();
}

/**
 * 道具栏剪影：一律「奶白实心主体 + 墨色描边」，内部层次只用 ink，不跟随调用方颜色。
 * ★为什么不复用 icon()：道具格底盘本身就是 UI.gold，而 icon() 的主体色由调用方给、
 *   细节靠细线（穿透的弹道、磁吸的四支箭头）和内焰奶白（flame）——同明度的线落在金盘上直接消失。
 *   这两个图标层口径不同，各自演化，不要合并回去
 * 未知 key 退回 icon()：以后往 BOSS_CHESTS 加新匣，只要它配过 icon 名就能先出图，不会画成空盘
 */
export function itemGlyph(ctx, key, cx, cy, s) {
  const h = s / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = Math.max(1.5, s * 0.1);
  ctx.strokeStyle = UI.ink;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const body = (path) => { path(); ctx.fillStyle = UI.cream; ctx.fill(); ctx.stroke(); };
  const mark = (path) => { path(); ctx.fillStyle = UI.ink; ctx.fill(); };

  switch (key) {
    case 'bulletCount':
      // 一颗主弹 + 左右各半颗副弹 = 读出「一次发多颗」
      body(() => { ctx.beginPath(); ctx.ellipse(-h * 0.62, h * 0.1, h * 0.24, h * 0.42, 0, 0, Math.PI * 2); });
      body(() => { ctx.beginPath(); ctx.ellipse(h * 0.62, h * 0.1, h * 0.24, h * 0.42, 0, 0, Math.PI * 2); });
      body(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.5, -h * 0.05);
        ctx.quadraticCurveTo(-h * 0.5, -h * 0.62, 0, -h * 1.02);
        ctx.quadraticCurveTo(h * 0.5, -h * 0.62, h * 0.5, -h * 0.05);
        ctx.lineTo(h * 0.5, h * 0.95);
        ctx.lineTo(-h * 0.5, h * 0.95);
        ctx.closePath();
      });
      mark(() => { ctx.beginPath(); ctx.rect(-h * 0.5, h * 0.42, h, h * 0.2); });
      break;
    case 'pierce':
      // 目标圆 + 一条加粗弹道横穿它：弹道是「条」不是「线」，金盘上才看得见
      body(() => { ctx.beginPath(); ctx.arc(-h * 0.34, 0, h * 0.52, 0, Math.PI * 2); });
      body(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 0.95, -h * 0.2);
        ctx.lineTo(h * 0.4, -h * 0.2);
        ctx.lineTo(h * 0.4, -h * 0.52);
        ctx.lineTo(h * 1.02, 0);
        ctx.lineTo(h * 0.4, h * 0.52);
        ctx.lineTo(h * 0.4, h * 0.2);
        ctx.lineTo(-h * 0.95, h * 0.2);
        ctx.closePath();
      });
      break;
    case 'shield':
      // 气泡盾：一圈挖空的厚壳，读作「套在外面的一层」，和左栏防御那颗实心盾分开
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.95, 0, Math.PI * 2);
      ctx.arc(0, 0, h * 0.5, 0, Math.PI * 2, true);
      ctx.fillStyle = UI.cream;
      ctx.fill('evenodd');
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      mark(() => { ctx.beginPath(); ctx.arc(-h * 0.62, -h * 0.62, h * 0.13, 0, Math.PI * 2); });
      break;
    case 'companions':
      body(() => {
        ctx.beginPath();
        ctx.arc(0, -h * 0.2, h * 0.6, Math.PI, 0);
        ctx.lineTo(h * 0.6, h * 0.72);
        ctx.lineTo(h * 0.28, h * 0.48);
        ctx.lineTo(0, h * 0.72);
        ctx.lineTo(-h * 0.28, h * 0.48);
        ctx.lineTo(-h * 0.6, h * 0.72);
        ctx.closePath();
      });
      mark(() => { ctx.beginPath(); ctx.arc(-h * 0.22, -h * 0.18, h * 0.13, 0, Math.PI * 2); });
      mark(() => { ctx.beginPath(); ctx.arc(h * 0.22, -h * 0.18, h * 0.13, 0, Math.PI * 2); });
      break;
    case 'bomber':
      // 弹体 + 引信座 + 四角火花，一律奶白实心加墨色描边。
      // ★引信原来画的是一根裸墨线，金盘上跟另外六格不是一套东西；改成斜出去的方块才读得出是同一套剪影
      // ★整颗收在 ±1h 内：原来火花顶到 -1.32h，是七格里最高的，和左邻那颗 1.71h 的射击跟班摆一起会大一号
      body(() => { ctx.beginPath(); ctx.arc(-h * 0.06, h * 0.26, h * 0.58, 0, Math.PI * 2); });
      body(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.18, h * 0.02);
        ctx.lineTo(h * 0.42, -h * 0.3);
        ctx.lineTo(h * 0.7, -h * 0.08);
        ctx.lineTo(h * 0.46, h * 0.24);
        ctx.closePath();
      });
      body(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.56, -h * 0.86);
        ctx.lineTo(h * 0.68, -h * 0.64);
        ctx.lineTo(h * 0.9, -h * 0.52);
        ctx.lineTo(h * 0.68, -h * 0.4);
        ctx.lineTo(h * 0.56, -h * 0.18);
        ctx.lineTo(h * 0.44, -h * 0.4);
        ctx.lineTo(h * 0.22, -h * 0.52);
        ctx.lineTo(h * 0.44, -h * 0.64);
        ctx.closePath();
      });
      break;
    case 'burnBullets':
      // 内焰必须用 ink：icon('flame') 那颗奶白内焰画在金盘上等于没有
      body(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 1.0);
        ctx.bezierCurveTo(h * 0.62, -h * 0.42, h * 0.95, h * 0.08, h * 0.52, h * 0.62);
        ctx.bezierCurveTo(h * 0.28, h * 0.95, -h * 0.28, h * 0.95, -h * 0.52, h * 0.62);
        ctx.bezierCurveTo(-h * 0.95, h * 0.08, -h * 0.62, -h * 0.42, 0, -h * 1.0);
        ctx.closePath();
      });
      mark(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.12);
        ctx.bezierCurveTo(h * 0.32, h * 0.2, h * 0.3, h * 0.52, 0, h * 0.66);
        ctx.bezierCurveTo(-h * 0.3, h * 0.52, -h * 0.32, h * 0.2, 0, -h * 0.12);
        ctx.closePath();
      });
      break;
    case 'pickupRange':
      // 中心一颗宝石 + 左右两条粗箭头条：四条细线箭头在 26px 盘上会整条消失
      body(() => {
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.62);
        ctx.lineTo(h * 0.5, 0);
        ctx.lineTo(0, h * 0.62);
        ctx.lineTo(-h * 0.5, 0);
        ctx.closePath();
      });
      body(() => {
        ctx.beginPath();
        ctx.moveTo(-h * 1.05, -h * 0.24);
        ctx.lineTo(-h * 0.72, -h * 0.24);
        ctx.lineTo(-h * 0.72, -h * 0.44);
        ctx.lineTo(-h * 0.62, 0);
        ctx.lineTo(-h * 0.72, h * 0.44);
        ctx.lineTo(-h * 0.72, h * 0.24);
        ctx.lineTo(-h * 1.05, h * 0.24);
        ctx.closePath();
      });
      body(() => {
        ctx.beginPath();
        ctx.moveTo(h * 1.05, -h * 0.24);
        ctx.lineTo(h * 0.72, -h * 0.24);
        ctx.lineTo(h * 0.72, -h * 0.44);
        ctx.lineTo(h * 0.62, 0);
        ctx.lineTo(h * 0.72, h * 0.44);
        ctx.lineTo(h * 0.72, h * 0.24);
        ctx.lineTo(h * 1.05, h * 0.24);
        ctx.closePath();
      });
      break;
    case 'leech':
      // 嗜血：奶白粗十字（回血的通用符号）+ 右上空角一颗尖朝上的血滴。
      // ★不能画成「水滴里嵌个加号」—— 上面 burnBullets 那颗火焰的外轮廓本来就是水滴，
      //   两格在同一条金盘上会长成一家，所以这里让十字当主体、血滴只做配角。
      // ★十字的臂必须是「条」不是「线」：细线在 26px 金盘上会整条消失（同 pickupRange 那条箭头线的教训）
      body(() => {
        const a = h * 0.26; // 臂半宽
        const e = h * 0.74; // 臂端到中心
        ctx.beginPath();
        ctx.moveTo(-a, -e);
        ctx.lineTo(a, -e);
        ctx.lineTo(a, -a);
        ctx.lineTo(e, -a);
        ctx.lineTo(e, a);
        ctx.lineTo(a, a);
        ctx.lineTo(a, e);
        ctx.lineTo(-a, e);
        ctx.lineTo(-a, a);
        ctx.lineTo(-e, a);
        ctx.lineTo(-e, -a);
        ctx.lineTo(-a, -a);
        ctx.closePath();
      });
      // 血滴一颗路径成形（尖端 + 一段大弧圆底），不拆成「三角 + 圆」两块：
      // 两块各自描边会在交界处割出一条穿模的墨线（同炸弹跟班那颗卫星斑的规矩）
      body(() => {
        ctx.beginPath();
        ctx.moveTo(h * 0.6, -h * 0.9);
        ctx.lineTo(h * 0.771, -h * 0.688);
        ctx.arc(h * 0.6, -h * 0.55, h * 0.22, -0.68, Math.PI + 0.68);
        ctx.closePath();
      });
      break;
    default:
      icon(ctx, key, 0, 0, s, { color: UI.cream });
      break;
  }
  ctx.restore();
}
