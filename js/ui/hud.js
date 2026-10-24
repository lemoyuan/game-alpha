import {
  canvasW, canvasH, xpForLevel, ITEM_BAR, HUD_TILE, PAUSE_BTN,
  MEMBRANE_BTN, MEMBRANE_HOLD, MEMBRANE_CD,
  STAT_POP_STAGGER, STAT_POP_MS, STAT_POP_RISE, statBoostText,
} from '../consts';
import { safeTop, safeBottom, capsuleBottom } from '../render';
import { MONSTER_TYPES, BOSS_CHESTS, BOSS_DROPS } from '../npc/monster/config';
import { UI, FS, R_BTN, BORDER, sticker, bar, badge, chip, icon, itemGlyph, membraneGlyph, label, labelMid } from './theme';

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

// 右下主动键（Boss 掉落道具「薄膜核心」）的位置：绘制在这里，命中判定在 main.js，摇杆让位在 ui/joystick.js。
// ★和 pauseButtonRect 同一条规矩：三处共用这一个函数，各自算一次迟早对不齐
// 贴着底部安全区上沿而不是屏幕底边：全面屏手势条那 20 来像素上按下去会先被系统吃掉
// ★未获得道具时这一格整块不画（见 drawSkillButton 开头），所以这个矩形只是「有道具时」才有效，
//   命中侧必须先判 player.membrane —— 凭空多一个能按的地方会被读成摇杆的一部分
export function skillButtonRect() {
  return {
    x: canvasW - P - MEMBRANE_BTN,
    y: canvasH - safeBottom - P - MEMBRANE_BTN,
    w: MEMBRANE_BTN,
    h: MEMBRANE_BTN,
  };
}

// 本局已持有的道具：金匣十种按 ITEM_BAR 的固定顺序，Boss 专属匣与 Boss 掉落道具追在后面
// （循环那两张表，以后加匣这里和 HUD 都不用动），0 层的不占位。
// HUD 的道具栏和暂停详情页共用这一份，两处的顺序和层数才不会各算各的
export function ownedItems(databus) {
  const player = databus.player;
  const items = [];
  for (const it of ITEM_BAR) {
    const n = it.count(player);
    if (n > 0) items.push({ id: it.glyph, glyph: it.glyph, name: it.name, n, color: UI[it.color] });
  }
  // ★两张表共用 databus.bossChests 这一个 id→次数 的 map，所以这段循环对两边是同一段代码，
  //   暂停页详情那行也是白读 CHEST_KIND_BY_ID[id].brief（pause.js:33 的 default 分支），两处都不用为新道具加分支
  for (const table of [BOSS_CHESTS, BOSS_DROPS]) {
    for (const kinds of Object.values(table)) {
      for (const k of kinds) {
        const n = databus.bossChests[k.id] || 0;
        if (n > 0) items.push({ id: k.id, glyph: k.icon, name: k.name, n, color: UI.bossChestBand });
      }
    }
  }
  return items;
}

// 左栏属性面板的七行。★这张表提到模块级是为了让「拾取 Boss 掉落道具」的 +x 飘字知道每个 key 住在第几行：
//   飘字存的是行号而不是像素 y —— panelY 会跟着「有没有 Boss 血条 / 刘海高度」动（见下面 draw 里的 panelY），
//   存死 y 的话血条一出没，飘字就飘到别的行上去了
// ★value 必须是函数：表在模块加载时求值一次，写成字面量等于把开局那一帧的属性永久定死
// ★导出的唯一读者是 tools/headless_check.mjs 的注册面扫描：它拿这张表当「面板上有哪七行」的权威，
//   去校验 Boss 掉落道具的 boost key 全都落在行内 —— 拼错的 key 会悄悄涨属性却没有 +x 行可弹
export const STAT_ROWS = [
  { key: 'attack',      icon: 'gun',    label: '攻击', value: (p) => p.attack },
  // 0.1 连加会攒出 1.9000000000000001 这类浮点噪声，显示前收进两位小数
  { key: 'atkSpeed',    icon: 'bolt',   label: '攻速', value: (p) => `${Math.round(p.atkSpeed * 100) / 100}/秒` },
  { key: 'attackRange', icon: 'target', label: '射程', value: (p) => p.attackRange },
  { key: 'critRate',    icon: 'star',   label: '暴击', value: (p) => `${Math.round(p.critRate * 100)}%` },
  // 读实际生效值：踩进黏液时这个数字会自己掉下去，离开后再涨回来（升级加的是 player.speed，不受影响）
  { key: 'speed',       icon: 'boot',   label: '移速', value: (p) => Math.floor(p.effectiveSpeed()) },
  { key: 'luck',        icon: 'clover', label: '幸运', value: (p) => p.luck },
  { key: 'defence',     icon: 'shield', label: '防御', value: (p) => p.defence },
];

// 战斗 HUD：全部走 ui/theme.js 的贴纸图元，信息量与换皮前完全一致，只是收进面板
export default class Hud {
  constructor() {
    this.toastText = '';
    this.toastUntil = 0;
    // 待播 / 在播的 +x 飘字：{ row, key, v, text, t0 }。★Hud 是单例、活过 DataBus.reset()，
    //   所以每局开局要由 main.js 显式清空，否则上一局最后那几条会飘进新一局
    this.statPops = [];
  }

  showToast(text, duration = 2000) {
    this.toastText = text;
    this.toastUntil = Date.now() + duration;
  }

  // 左栏七行从上到下逐行弹 +x。来源有三个，全部汇到 Player.applyBoost 那一个漏斗：
  //   升级自动成长、三选一选卡、Boss 掉落道具（chestGrant.js 的 core_cmv）
  // ★文本按加成包直接格式化，不存「加前的属性值」去求差：移速那行面板读的是 effectiveSpeed()，
  //   踩在黏液里求差会算出 0 甚至负数，而玩家要看到的是「这笔加成给了我多少」
  // ★t0 带上行序偏移就是「错开」的全部实现：绘制端只判 age < 0 跳过，不需要额外状态机
  popStats(boost, held) {
    const now = Date.now();
    STAT_ROWS.forEach((row, i) => {
      const v = boost[row.key];
      if (v === undefined) return; // 加成包没覆盖这一行就不弹，表与包不必永远等长
      // held = 三选一面板正开着：先挂起（t0 留 null，绘制端跳过），等面板关闭调 releaseStatPops 统一盖章。
      // ★不挂起的话，升级成长与选卡这两笔加成发生在面板打开期间，700ms 的飘字会整段死在黑遮罩后面，
      //   玩家关掉面板时字早就没了——等于这两笔永远没有动画
      this.statPops.push({ row: i, key: row.key, v, text: statBoostText(row.key, v), t0: held ? null : now + i * STAT_POP_STAGGER });
    });
  }

  // 面板关闭那一刻把挂起的 +x 按行序重新盖章开弹。一次暂存里可能混着好几笔
  // （一级成长四行 + 刚选的那张卡一行，连升几级还会更多），在这里合成一条从上到下的完整瀑布
  // ★同一行攒了多条就合并求和再格式化：连升三级各 +1 攻击，释放时读作一条 +3，
  //   比三条 +1 叠在两像素的垂直差里清楚——行与 key 一一对应，所以同行求和不会串量纲
  releaseStatPops() {
    const held = this.statPops.filter((p) => p.t0 === null);
    if (!held.length) return;
    const byRow = new Map();
    for (const p of held) {
      const m = byRow.get(p.row);
      if (m) m.v = Math.round((m.v + p.v) * 100) / 100;
      else byRow.set(p.row, p);
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    const keep = new Set(rows.map((r) => byRow.get(r)));
    const now = Date.now();
    rows.forEach((row, i) => {
      const p = byRow.get(row);
      p.text = statBoostText(p.key, p.v);
      p.t0 = now + i * STAT_POP_STAGGER;
    });
    this.statPops = this.statPops.filter((p) => p.t0 !== null || keep.has(p));
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
    // ★filter 不是 find：双子同时在场有两只，find 只会拿到先出场的那一只，
    //   第二根血条就永远画不出来——而"还剩几只"这件事只有这里说得出
    const bosses = databus.enemys.filter((e) => e.isBoss);
    if (bosses.length) {
      const totalW = Math.min(canvasW - 40, 300);
      // +8 而不是 +4：药丸和血条各带 2.5px 白色外框，只让 4px 时两条白框只差 1px，
      // 血条横贯整排药丸，视觉上会连成一条粗白线
      const by = rowB + 8;
      const gap = bosses.length > 1 ? 8 : 0;
      const bw = (totalW - gap * (bosses.length - 1)) / bosses.length;
      for (let i = 0; i < bosses.length; i++) {
        const boss = bosses[i];
        const bx = (canvasW - totalW) / 2 + i * (bw + gap);
        bar(ctx, bx, by, bw, 14, boss.hp / boss.maxHp, UI.red, { r: 7 });
        // 成对出场时两根长得一样，不加这一字就分不清哪根在掉血。判据用 twin 字段在不在，
        // 不用 type === 'boss4'：twinIndex 只有真双子有，别的 Boss 默认 0，靠 type 硬编会把三号也标成"兄"
        const tag = bosses.length > 1 && 'twin' in boss ? (boss.twinIndex === 1 ? ' 弟' : ' 兄') : '';
        const kind = MONSTER_TYPES[boss.type];
        labelMid(ctx, `BOSS ${kind ? kind.name : ''}${tag}`, bx + bw / 2, by + 8, {
          size: FS.tiny, bold: true, color: UI.textOnDark,
        });
        // 膜量子条（只有膜王带 filmMax）：膜最关键的时刻正是你扭头去看菌群的时候，
        // 本体上那层壳这时候在屏幕外，所以血条下面必须再有一条。
        // 高度不能再矮：bar() 两侧各 inset 2.5px，h<6 的时候平涂区会算成负数，只剩一圈描边
        if (boss.filmMax) {
          bar(ctx, bx, by + 16, bw, 8, Math.max(0, boss.film / boss.filmMax), UI.cream, { r: 4 });
        }
      }
    }

    // 面板起点跟着簇底走，不再写死在 top 上（刘海机 rowY=91、rowB=117）：
    // 有 Boss 时血条占 rowB+8..+22（125..139），膜王还多一条膜量子条到 rowB+32（149），
    // 面板贴纸顶边画在 panelY-3，所以取 rowB+36 = 153 才啃不到膜条底边
    // 无 Boss 时没有血条也没有膜条，面板直接落在血条原本那一格 rowB+8 = 125
    const panelY = rowB + (bosses.length ? 36 : 8);
    this.drawStats(ctx, player, panelY);
    this.drawItems(ctx, databus, panelY);
    this.drawSkillButton(ctx, player);

    // Toast
    const now = Date.now();
    if (now < this.toastUntil) {
      const remaining = (this.toastUntil - now) / 1000;
      ctx.globalAlpha = Math.min(1, remaining * 2);
      const tw = 210;
      const tx = canvasW / 2 - tw / 2;
      // ty 不能再写死成 90 + safeTop：那是照着「簇在 top」量的，簇一跟着胶囊下移就会啃掉血条底边。
      // 有 Boss 时横条区到 rowB+32（膜条底边）再让 10，无 Boss 时到 rowB+8 再让 10
      const ty = rowB + (bosses.length ? 42 : 18);
      sticker(ctx, tx, ty, tw, 34, { fill: UI.cream, r: R_BTN });
      labelMid(ctx, this.toastText, canvasW / 2, ty + 18, { size: FS.body, bold: true, color: UI.textOnLight });
      ctx.globalAlpha = 1;
    }
  }

  // 左栏角色属性：图标 + 数值，收进半透明底板（右栏已换成道具格，见 drawItems）
  drawStats(ctx, player, y) {
    const w = 100;
    const rh = 17;
    this.panel(ctx, P, y, w, STAT_ROWS.length * rh + 8);
    STAT_ROWS.forEach((row, i) => {
      const ry = y + 8 + i * rh;
      icon(ctx, row.icon, P + 14, ry + 6, 14, { color: UI.blue });
      label(ctx, row.label, P + 27, ry + 11, { size: FS.tiny, color: UI.muted });
      label(ctx, `${row.value(player)}`, P + w - 8, ry + 11, { size: FS.tiny, bold: true, color: UI.textOnDark, align: 'right' });
    });
    this.drawStatPops(ctx, y, w, rh);
  }

  // 拾取 Boss 掉落道具后那七条 +x：贴在面板右沿外（x = P + w + 4 = 116，面板右边界 112）左对齐往画面里长。
  // ★不叠在数值上：数值此刻已经变了，两层字挤在 100px 宽的面板里会糊成一片，而「变了多少」正是要读清的那个
  // ★不会撞上右栏道具格：那批格子右对齐，10 格时最左格圆心在 233，而这里最宽的「+0.1/秒」从 116 起约到 150
  // 倒序遍历：过期条目要 splice，正序遍历会跳过紧邻的下一条
  drawStatPops(ctx, y, w, rh) {
    if (!this.statPops.length) return;
    const now = Date.now();
    for (let i = this.statPops.length - 1; i >= 0; i--) {
      const pop = this.statPops[i];
      if (pop.t0 === null) continue; // 还挂起着（三选一面板没关）：不画、也不过期，等 releaseStatPops 盖章
      const age = now - pop.t0;
      if (age < 0) continue; // 还没轮到这一行（逐行错开 STAT_POP_STAGGER）
      if (age > STAT_POP_MS) { this.statPops.splice(i, 1); continue; }
      const t = age / STAT_POP_MS;
      ctx.globalAlpha = 1 - t * t; // 同 damageText 的淡出曲线：前段留得住字，末段才快速收干净
      label(ctx, pop.text, P + w + 4, y + 8 + pop.row * rh + 11 - STAT_POP_RISE * t,
        { size: FS.tiny, bold: true, color: UI.gold });
      ctx.globalAlpha = 1;
    }
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

  // 右下主动键（「薄膜核心」）：拿到道具才存在，三态各画各的
  // ★生效态是整块盘翻成墨色，不是加一圈高光：这一键的承诺是「这 3 秒我不容易死」，
  //   「现在生效了没有」必须余光扫一眼就有答案（概念页 .preview/membrane-concept.html B2 组定的这块）
  // ★生效期间不叠冷却扇形：两根钟压进同一个盘就都读不出哪根在走，而此刻只有「膜还剩多久」值得读
  // ★不画冷却秒数：56px 盘上再压一层 10px 字会把图标啃掉，而能不能按这件事盘色已经说完了
  drawSkillButton(ctx, player) {
    if (player.membrane <= 0) return;

    const b = skillButtonRect();
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const r = b.w / 2;
    const disc = r - 2; // 盘面半径：让出外圈那一圈白贴纸
    const on = player.membraneOn();
    const cdLeft = on ? 0 : player.membraneCdT / MEMBRANE_CD;
    const restP = on ? player.membraneT / MEMBRANE_HOLD : 1;

    // 白色贴纸外框 → 硬投影 → 盘面平涂 → 墨描边，照 badge 的口径：键也是 HUD 控件，得和道具格一个家族
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = UI.sticker;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + 2, disc, 0, Math.PI * 2);
    ctx.fillStyle = UI.shadow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, disc, 0, Math.PI * 2);
    ctx.fillStyle = on ? UI.ink : UI.membrane;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = UI.ink;
    ctx.stroke();

    // 键上那颗膜：形状只在 theme.membraneGlyph 里定义一次，这里只给底色对应的一套 body/mark
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = on ? UI.cream : UI.ink;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = cdLeft > 0 ? 0.35 : 1; // 冷却里压暗一层，和扇形叠出「还不能按」
    membraneGlyph(
      ctx,
      r * 0.61,
      (path) => { path(); ctx.fillStyle = on ? UI.cream : UI.ink; ctx.fill(); ctx.stroke(); },
      (path) => { path(); ctx.fillStyle = on ? UI.ink : UI.cream; ctx.fill(); }
    );
    ctx.globalAlpha = 1;
    ctx.restore();

    if (cdLeft > 0) {
      // 冷却：暗扇形从 12 点顺时针盖住「还没好的那段」，随冷却走完自己收窄到没有
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, disc, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cdLeft);
      ctx.closePath();
      ctx.fillStyle = 'rgba(10,12,24,0.55)';
      ctx.fill();
      return;
    }

    if (on) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(234,236,238,0.75)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // ★剩余时长短弧的口径照 js/player/bomber.js:137-151：只在后半程出现、90°、越接近结束越长。
      //   刚按下去那 1.5 秒不需要读条，「快没了」才需要
      if (restP < 0.5) {
        ctx.beginPath();
        ctx.strokeStyle = UI.cream;
        ctx.lineWidth = 3;
        ctx.arc(cx, cy, r + 4.5, Math.PI / 2, Math.PI / 2 + (Math.PI / 2) * ((0.5 - restP) * 2));
        ctx.stroke();
      }
      return;
    }

    // 就绪：一圈虚线 = 「这个位置现在能按」。虚线不是实心环：环要留给生效那一态
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4.5, 0, Math.PI * 2);
    ctx.strokeStyle = UI.cream;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
