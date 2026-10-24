import {
  canvasW, canvasH, HUD_TILE, PIERCE_DAMAGE_FALLOFF, PLAYER_INVINCIBLE,
  COMPANION_ATK_SPEED, COMPANION_DAMAGE_RATIO, BOMB_CD, BOMB_BLAST_R, bombDamage,
  TURRET_CD, TURRET_RANGE, turretDamage,
  BURN_TICK, BURN_HOLD, BURN_DMG, LEECH_CHANCE, VIAL_GAIN_CD, VIAL_OUT_CD, VIAL_OUT, XP_PICKUP_RANGE,
  LASER_CROSS_CD, laserCrossDamage,
  MEMBRANE_HOLD, MEMBRANE_REDUCE, MEMBRANE_CD,
  TWIN_CD, TWIN_SALVO, TWIN_RANGE, twinDamage,
} from '../consts';
import { safeTop } from '../render';
import { CHEST_KIND_BY_ID } from '../npc/monster/config';
import { UI, FS, R_CARD, sticker, badge, chip, itemGlyph, label, wrapLines, button } from './theme';
import { pauseButtonRect, ownedItems } from './hud';

const ROW_H = 50; // 一行放得下「名称 + 两行说明」：压到 44 以下第二行会啃进分隔线

// ===== 卡片内滚动（第 13 行起才生效，12 行以内这张卡和从前像素级一致）=====
// ★视口取 12.5 行不是「凑一个整数」：12 行是刘海机上还能整张放下的上限（卡片高 712、顶边 124、底边 836），
//   第 13 行一开始顶边就必须钉死在胶囊下方、卡高再涨只能往里收。收到 12.5 行是让最后半行被齐齐切断 ——
//   「下面还有东西」全靠那道切口表达；取整 12 行的话底部留白，玩家会读成列表到此为止
const VIEW_ROWS = 12.5;
const VIEW_H = Math.round(VIEW_ROWS * ROW_H); // 625：可见内容区的高度，卡片高度由它反推
const DRAG_SLOP = 8; // 手指先走满这么多像素才算拖动：之内仍算「点一下」，不让轻微手抖读成滚动
const BAR_W = 3;

const hit = (t, r) => t.clientX >= r.x && t.clientX <= r.x + r.w && t.clientY >= r.y && t.clientY <= r.y + r.h;

// 说明一律报「现在给多少」而不是「+1」：道具层数在 HUD 已经缩成一枚图标，
// 玩家点开暂停页要确认的是这层数换算成实际数字是多少，所以文案全部现读 player 属性
function describe(item, player) {
  switch (item.glyph) {
    case 'bulletCount': return `每次射击射出 ${player.bulletCount} 颗子弹`;
    case 'pierce': return `可穿透 ${player.pierce} 个目标，每穿一个伤害变为上一次的 ${Math.round(PIERCE_DAMAGE_FALLOFF * 100)}%`;
    case 'shield': return `每层挡一次伤害，破盾后有 ${PLAYER_INVINCIBLE / 1000} 秒无敌；当前 ${player.shield}/${item.n} 层`;
    // ★报的是「一口回几血」而不是「几 × 0.5%」：层数买的就是回血量，概率恒为 LEECH_CHANCE
    // ★后半句按 player.vial 分支：10-11 加了血瓶，「满血浪费」从此只在该道具没拾取时才成立
    case 'leech': return `每次击杀有 ${Math.round(LEECH_CHANCE * 1000) / 10}% 几率回 ${player.leech} 点血；${player.vial > 0 ? '满血时这一口存进血瓶' : '满血时这一下会白白浪费'}`;
    case 'vial': return `每 ${VIAL_GAIN_CD / 1000} 秒存 ${player.vial} 滴，满血时溢出的回血也进瓶；现有 ${player.vialDrops} 滴，残血时每 ${VIAL_OUT_CD / 1000} 秒送 ${VIAL_OUT} 滴`;
    case 'companions': return `1 个跟班一轮射出 ${player.companions} 发，${COMPANION_ATK_SPEED} 次/秒，伤害为角色的 ${COMPANION_DAMAGE_RATIO * 100}%，不会被攻击`;
    case 'bomber': return `1 个跟班每 ${BOMB_CD / 1000} 秒往最密的一团扔 ${player.bomber} 枚，单枚 ${bombDamage(player.attack)} 点，爆风半径 ${BOMB_BLAST_R} 像素`;
    // ★座数直接报 player.turrets：这一种层数买的就是「场上几座」，不像两条跟班那样要换算成「一轮几发」
    case 'turrets': return `脚下留着 ${player.turrets} 座固定炮台，每 ${TURRET_CD / 1000} 秒向 ${TURRET_RANGE} 像素内最近的一怪开一炮，单发 ${turretDamage(player.attack)} 点，不跟着你走也不会被打掉`;
    case 'burnBullets': return `命中点燃 ${BURN_HOLD / 1000} 秒，每 ${BURN_TICK / 1000} 秒跳一次血，每跳 ${item.n * BURN_DMG} 点，再命中只刷新时长`;
    case 'pickupRange': return `经验宝石在 ${player.pickupRange} 像素内自动飞向你（初始 ${XP_PICKUP_RANGE}）`;
    // 海火核心（Boss 掉落道具）：ownedItems 把它那行的 glyph 设成 config 里的 icon 'laserCross'，所以分支挂在这。
    // ★只报三个数：两件 Boss 掉落里巨细胞核没有分支、走下面 default 读 brief，因为它涨的是左栏那七行、
    //   逐项数字面板上正在显示，重复一遍反而对不上；这一件的层数不在任何面板上，只能在这里报
    case 'laserCross': return `每次真正掉血放出一道旋转十字，共 ${item.n} 层，每次结算 ${laserCrossDamage(item.n, player.attack)} 点，${LASER_CROSS_CD / 1000} 秒内最多一根`;
    // 薄膜核心（Boss 掉落道具）：★这一行必须把「按右下角的键」说出口 —— 全游戏第一个主动键，
    //   另外两件读到的句式都是「拾取即生效」，玩家不看这里就根本不知道右下那枚盘是干什么的
    // ★三个数一律现读常量：减半比例是这件道具的名字（MEMBRANE_REDUCE），可调的是两个时长，
    //   写死一份副本的话以后调 HOLD/CD 就只改得动实场、改不动详情页（同 laserCross 那条口径）
    case 'membrane': return `按右下角的键，${MEMBRANE_HOLD / 1000} 秒内受到的伤害减半（${Math.round(MEMBRANE_REDUCE * 100)}%，接触、爆发和中毒都算），${MEMBRANE_CD / 1000} 秒内只能按一次；当前${player.membraneT > 0 ? '生效中' : '待按'}`;
    // 双子核心（Boss 掉落道具）：这一件和上面两条都不一样 —— 计时器不住在角色身上，落在地上那座实体里，
    //   所以这里没有「当前状态」可报，报的是【此刻开一炮是多少血】（跟班/炸弹/炮台三行同一口径：吃当前攻击力）
    // ★射程 130 必须说出口：这是它与金匣炮台（220，直径盖过屏宽 = 等于没范围）唯一的行为差别，
    //   也是「一局只落一座的重炮」买的那件东西 —— 玩家要靠这个数判断「这块地值不值得站」
    case 'twinBore': return `脚下落下一座双联炮座，每 ${TWIN_CD / 1000} 秒向 ${TWIN_RANGE} 像素内最近的两怪齐射一轮，单发 ${twinDamage(player.attack)} 点、一轮 ${twinDamage(player.attack) * TWIN_SALVO} 点，不跟着你走`;
    default: return (CHEST_KIND_BY_ID[item.id] || {}).brief || '';
  }
}

// 暂停页：右上角按钮 → 整局冻住（databus.isPaused，走 main.js 现成的那道门），在这里看道具详情
export default class PauseScreen {
  constructor() {
    this.visible = false;
    this._databus = null;
    this.scroll = 0; // 内容区当前滚过多少像素（只在这张卡开着有意义，show() 里归零）
    this.drag = null; // 正在拖卡片的那根手指：{ touchId, y0, scroll0, moved }
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
      if (hit(t, L.btn) || !hit(t, { x: L.x, y: L.y, w: L.w, h: L.h })) {
        this.hide();
        return;
      }
      // 按在卡片上只剩两件事要做：拖这一列，或者就是按着看。两条关闭路径已经留在上面 touchstart 里判完，
      // 所以这里只登记一个「可能要拖」的候选，松手时没走满 DRAG_SLOP 就什么都没发生过 —— 轻点不吞、不跳
      this.drag = { touchId: t.identifier, y0: t.clientY, scroll0: this.scroll, moved: false };
    });

    wx.onTouchMove((e) => {
      const d = this.drag;
      if (!this.visible || !d) return;
      for (const t of e.touches) {
        if (t.identifier !== d.touchId) continue;
        const dy = t.clientY - d.y0;
        if (!d.moved && Math.abs(dy) < DRAG_SLOP) return;
        d.moved = true;
        // 绝对定位而不是累加增量：手指往上走 100 像素就是滚过 100 像素，
        // 逐帧累加会把夹取变成「粘在两端不动」，到中点后回不出来的手感就是这么来的
        this.scroll = this.clampScroll(d.scroll0 - dy, this.layout(ownedItems(databus)));
        return;
      }
      this.drag = null; // 这根手指已经从 touches 里消失：这次拖动作废，下次按下重新登记
    });

    const end = (e) => {
      if (!this.drag) return;
      const touches = e.touches || [];
      for (const t of touches) {
        if (t.identifier === this.drag.touchId) return; // 这根还按着，抬起来的是另一根手指
      }
      this.drag = null;
    };
    wx.onTouchEnd(end);
    wx.onTouchCancel(end);
  }

  show() {
    const databus = this._databus;
    this.visible = true;
    databus.isPaused = true;
    // 每次打开都从第一条开始：留着上次的滚动位置，玩家会以为上面从来没有过东西
    this.scroll = 0;
    this.drag = null;
    // 用第二根手指按暂停时，第一根还压在摇杆上：不清就会带着一个方向回到战斗，角色自己飘出去
    const j = databus.joystick;
    j.active = false;
    j.touchId = null;
    j.dirX = 0;
    j.dirY = 0;
  }

  hide() {
    this.visible = false;
    this.drag = null;
    this._databus.isPaused = false;
  }

  // 滚动位置唯一的夹取口：draw 与 onTouchMove 都从这里过，两处的读数才对得上。
  // 内容不超过视口时上下界同为 0，也就是「这一张卡根本滚不动」
  clampScroll(v, L) {
    return Math.max(0, Math.min(v, L.contentH - L.bodyH));
  }

  // 布局只有一份：draw 与命中判定都从这里取，两处的数字永远对得上
  layout(items) {
    const w = Math.min(canvasW - 32, 340);
    const x = Math.round((canvasW - w) / 2);
    const contentH = items.length ? items.length * ROW_H : 40; // 空列表只留一行提示
    const bodyH = Math.min(contentH, VIEW_H); // ★死的是视口、活的是内容：超过 12.5 行才开始滚
    const h = 56 + bodyH + 56;
    // ★上界要夹住：Math.max 那一头的 safeTop + 96 是「卡片再高也不许顶进微信胶囊」，但它在高卡片上会把整块往下推。
    //   滚动上线后内容再涨也只涨 contentH、不涨 h，所以这道 min 从今天起是兜「视口 + 两条边距」这一个死数：
    //   最坏情况 h = 56 + 625 + 56 = 737，刘海机上 y 被压到 99（胶囊底边 83、留 16 像素），底边 836 ≤ canvasH 844
    const y = Math.min(Math.max(safeTop + 96, Math.round((canvasH - h) / 2)), canvasH - h - 8);
    return {
      x, y, w, h,
      bodyY: y + 56, bodyH, contentH,
      btn: { x: x + w / 2 - 60, y: y + h - 46, w: 120, h: 34 },
    };
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
    this.scroll = this.clampScroll(this.scroll, L); // 夹在这里：行数和屏幕尺寸都会变（旋转/以后加行），不能只信 touchmove 那次夹取

    // 内容区裁剪：滚动靠的就是这一道，被切在半行上的那半行必须在卡纸里断掉而不是盖到「继续战斗」按钮上。
    // 全项目唯一先例是 home.js:199-202 图鉴头像的圆形裁剪，同样是「一处 clip 换掉一堆手工算边界」
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.bodyY, L.w, L.bodyH);
    ctx.clip();

    // 只画与视口有交集的那几行：行高是死的，首尾下标能直接算出来。
    // 逐行遍历再加「看不见就跳过」也画得对，但每次开面板都在为屏幕外的行跑一遍 wrapLines/measureText
    const first = Math.max(0, Math.floor(this.scroll / ROW_H));
    const last = Math.min(items.length - 1, Math.ceil((this.scroll + L.bodyH) / ROW_H));
    for (let i = first; i <= last; i++) {
      const it = items[i];
      const ry = L.bodyY + i * ROW_H - this.scroll;
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
    }
    ctx.restore();

    // 滚动条只在内容真的超出视口时出现：12 行以内这一列本来就滚不动，那根 3 像素的灰条是纯噪音。
    // ★画在 clip 之外（上面 restore 之后），否则会被自己那道裁剪按进内容区里
    if (L.contentH > L.bodyH) {
      const barX = L.x + L.w - 10;
      const barY = L.bodyY + 3;
      const barH = L.bodyH - 6;
      ctx.fillStyle = 'rgba(28,40,67,0.13)';
      ctx.fillRect(barX, barY, BAR_W, barH);
      const thumbH = Math.max(30, barH * L.bodyH / L.contentH);
      const thumbY = barY + (barH - thumbH) * (this.scroll / (L.contentH - L.bodyH));
      ctx.fillStyle = 'rgba(28,40,67,0.52)';
      ctx.fillRect(barX, thumbY, BAR_W, thumbH);
    }

    button(ctx, [], { ...L.btn, text: '继续战斗', color: UI.mint });
  }
}
