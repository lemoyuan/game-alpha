import { ctx } from './render';
import DataBus from './databus';
import Player from './player/index';
import Arena from './arena/index';
import Camera from './camera/index';
import Joystick from './ui/joystick';
import Hud from './ui/hud';
import UpgradeScreen from './ui/upgrade';
import HomeScreen from './ui/home';
import { UI, FS, R_CARD, sticker, chip, label, labelMid, stickerLabel, button } from './ui/theme';
import Spawner from './npc/monster/spawner';
import XpGem from './npc/xpgem';
import Chest from './npc/chest';
import { canvasW, canvasH, ABYSS } from './consts';
import { records, formatTime, submitRun } from './storage';

const databus = new DataBus();

export default class Main {
  constructor() {
    this.raf = null;
    this.lastTime = 0;
    this.startRequested = false; // 首页/结算按钮触发的下一局，延后到帧首执行
    this.homeRequested = false;
    this.runSubmitted = false;
    this.lastMarks = null; // 上一局结算的破纪录标记

    // 框架对象只创建一次，跨局复用（触摸回调也只注册一次）
    databus.camera = new Camera();
    databus.arena = new Arena();
    databus.joystick = new Joystick();
    databus.joystick.init(databus);
    databus.hud = new Hud();
    databus.upgradeScreen = new UpgradeScreen();
    databus.upgradeScreen.init(databus);
    databus.spawner = new Spawner();
    databus.homeScreen = new HomeScreen();
    databus.homeScreen.init(databus, () => { this.startRequested = true; });

    wx.onTouchStart((e) => this.handleGameOverTap(e));

    this.lastTime = Date.now();
    this.loop();
  }

  start() {
    databus.reset();
    databus.screen = 'game';
    databus.player = new Player();
    databus.spawner.reset();
    databus.hud.toastUntil = 0; // 丢掉上一局残留的提示
    databus.upgradeScreen.visible = false;
    this.clearJoystick();
    this.runSubmitted = false;
    this.lastTime = Date.now();
  }

  backToHome() {
    databus.reset(); // reset 后 screen === 'home'
    databus.hud.toastUntil = 0;
    databus.upgradeScreen.visible = false;
    this.clearJoystick();
    databus.homeScreen.goto('main');
  }

  // 结算/首页按钮的那一次按下会顺带激活摇杆，开局前统一复位
  clearJoystick() {
    const j = databus.joystick;
    j.active = false;
    j.touchId = null;
    j.dirX = 0;
    j.dirY = 0;
  }

  loop() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.startRequested) {
      this.startRequested = false;
      this.start();
    } else if (this.homeRequested) {
      this.homeRequested = false;
      this.backToHome();
    }

    if (databus.screen === 'game') {
      if (!databus.isGameOver && !databus.isPaused) {
        databus.frame++;
        databus.spawner.update(dt, databus);
        databus.update(dt);
        this.checkCollisions();
      }
      if (databus.isGameOver && !this.runSubmitted) {
        this.runSubmitted = true;
        this.submitCurrentRun();
      }
      this.render();
    } else {
      databus.homeScreen.draw(ctx);
    }

    this.raf = requestAnimationFrame(() => this.loop());
  }

  // 结算写入本地记录：破纪录标记供 GAME OVER 面板显示
  submitCurrentRun() {
    const player = databus.player;
    if (!player) return;
    this.lastMarks = submitRun({
      time: databus.spawner.elapsed,
      level: player.level,
      kills: player.kills,
      chests: databus.chestsOpened,
    });
  }

  checkCollisions() {
    const { player, enemys, bullets } = databus;
    if (!player) return;
    const now = Date.now();

    for (let i = enemys.length - 1; i >= 0; i--) {
      const e = enemys[i];
      if (e.isDead) {
        // 被膜王吃回孔口的菌群：不是击杀，不掉经验也不涨击杀数。
        // 掉了经验就等于奖励玩家"让它回去"，回嵌这个机制会被自己的掉落表拆掉
        if (e.absorbed) {
          databus.removeEnemy(i);
          continue;
        }
        if (e.type === 'chest') {
          const chest = databus.pool.getItemByClass('chest', Chest);
          chest.init(e.x, e.y);
          databus.chests.push(chest);
        } else {
          const gem = databus.pool.getItemByClass('xpgem', XpGem);
          gem.init(e.x, e.y, e.xpValue);
          databus.xpGems.push(gem);
        }
        player.kills++;
        databus.removeEnemy(i);
        continue;
      }
      if (player.isCollideWith(e)) {
        player.takeDamage(e.damage, now);
        if (player.hp <= 0) {
          databus.isGameOver = true;
        }
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      if (bullets[i].isDestroyed) {
        databus.removeBullet(i);
      }
    }

    // 怪物子弹：命中结算在 bullet.update 内完成，这里回收被销毁的子弹
    for (let i = databus.enemyBullets.length - 1; i >= 0; i--) {
      if (databus.enemyBullets[i].isDestroyed) {
        databus.removeEnemyBullet(i);
      }
    }

    // 激光与赤潮：伤害都在各自 update 内结算完，这里只做寿命回收
    for (let i = databus.lasers.length - 1; i >= 0; i--) {
      if (databus.lasers[i].isDestroyed) {
        databus.removeLaser(i);
      }
    }

    for (let i = databus.zones.length - 1; i >= 0; i--) {
      if (databus.zones[i].isDestroyed) {
        databus.removeZone(i);
      }
    }

    // 伤害飘字：到期回收
    for (let i = databus.damageTexts.length - 1; i >= 0; i--) {
      if (databus.damageTexts[i].isDestroyed) {
        databus.removeDamageText(i);
      }
    }

    // 覆盖所有伤害来源（接触/子弹）的死亡判定
    if (player.hp <= 0) {
      databus.isGameOver = true;
    }

    for (let i = databus.xpGems.length - 1; i >= 0; i--) {
      if (databus.xpGems[i].collected) {
        databus.removeXpGem(i);
      }
    }

    for (let i = databus.chests.length - 1; i >= 0; i--) {
      if (databus.chests[i].collected) {
        databus.removeChest(i);
      }
    }
  }

  render() {
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = ABYSS.far; // 地图外 = 深渊底色，边缘沉水过渡见 js/arena/index.js
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (databus.player) {
      databus.camera.follow(databus.player);
    }

    databus.camera.begin(ctx);
    databus.arena.draw(ctx, databus.camera);
    for (const z of databus.zones) z.draw(ctx); // 赤潮和黏液都是地贴，压在所有实体下面；画在 arena 的裁切之外，黑水上照样亮
    for (const l of databus.lasers) l.draw(ctx); // 同属地面层：满 5 道光束时五个光根会叠成一团奶白，压在实体之下才不会把 Boss 本体埋掉（玩家本来就画在光之上）
    for (const g of databus.xpGems) g.draw(ctx);
    for (const c of databus.chests) c.draw(ctx);
    for (const e of databus.enemys) e.draw(ctx);
    for (const b of databus.bullets) b.draw(ctx);
    for (const b of databus.enemyBullets) b.draw(ctx);
    if (databus.player) {
      for (const comp of databus.companions) comp.draw(ctx);
      databus.player.draw(ctx);
    }
    for (const t of databus.damageTexts) t.draw(ctx);
    databus.camera.end(ctx);

    if (!databus.isGameOver) databus.hud.draw(ctx, databus); // 结算面板接管屏幕上半部，血条属性条不再叠在上面
    databus.joystick.draw(ctx);

    if (databus.upgradeScreen.visible) {
      databus.upgradeScreen.draw(ctx);
    }

    if (databus.isGameOver) {
      this.drawGameOver();
    }
  }

  // 结算按钮：绘制与命中判定共用同一份布局，避免两处坐标不同步
  gameOverButtons() {
    const bw = Math.min(canvasW - 64, 240);
    const bh = 44;
    const gap = 12;
    const bx = (canvasW - bw) / 2;
    const by = Math.round(canvasH * 0.6);
    return [
      { label: '再来一局', icon: 'replay', color: UI.mint, x: bx, y: by, w: bw, h: bh, action: () => { this.startRequested = true; } },
      { label: '返回首页', icon: 'home', color: UI.cream, x: bx, y: by + bh + gap, w: bw, h: bh, action: () => { this.homeRequested = true; } },
    ];
  }

  handleGameOverTap(e) {
    if (databus.screen !== 'game' || !databus.isGameOver || databus.isPaused) return;
    const t = e.touches[0];
    for (const b of this.gameOverButtons()) {
      if (t.clientX >= b.x && t.clientX <= b.x + b.w &&
          t.clientY >= b.y && t.clientY <= b.y + b.h) {
        b.action();
        return;
      }
    }
  }

  drawGameOver() {
    const player = databus.player;
    ctx.fillStyle = UI.dim;
    ctx.fillRect(0, 0, canvasW, canvasH);

    stickerLabel(ctx, 'GAME OVER', canvasW / 2, canvasH * 0.22, { size: 30, color: UI.red });

    const w = Math.min(canvasW - 48, 320);
    const x = (canvasW - w) / 2;
    const y = Math.round(canvasH * 0.26);
    const h = 196;
    sticker(ctx, x, y, w, h, { fill: UI.cream, r: R_CARD });

    // 本局：生存时长做主数字，等级/击杀/宝箱压成三枚药丸
    labelMid(ctx, formatTime(databus.spawner.elapsed), x + w / 2, y + 44, {
      size: FS.title, bold: true, color: UI.textOnLight,
    });
    const chips = [`Lv.${player.level}`, `击杀 ${player.kills}`, `宝箱 ${databus.chestsOpened}`];
    const cw = (w - 32 - 16) / 3;
    chips.forEach((text, i) => {
      chip(ctx, x + 16 + (cw + 8) * i, y + 62, cw, 24, text, { color: UI.panelDeep, textColor: UI.textOnDark, size: FS.tiny });
    });

    label(ctx, '历史最佳', x + 16, y + 112, { size: FS.small, bold: true, color: UI.textOnLight });
    const marks = this.lastMarks || {};
    const bests = [
      { label: '最长生存', value: formatTime(records.bestTime), isNew: marks.time },
      { label: '最高等级', value: `Lv.${records.bestLevel}`, isNew: marks.level },
      { label: '最多击杀', value: `${records.bestKills}`, isNew: marks.kills },
    ];
    bests.forEach((b, i) => {
      const ry = y + 134 + i * 22;
      label(ctx, b.label, x + 16, ry, { size: FS.small, color: UI.muted });
      label(ctx, b.value, x + w - (b.isNew ? 62 : 16), ry, { size: FS.small, bold: true, color: UI.textOnLight, align: 'right' });
      if (b.isNew) {
        chip(ctx, x + w - 56, ry - 15, 40, 19, '新纪录', { color: UI.gold, size: FS.tiny });
      }
    });

    for (const b of this.gameOverButtons()) button(ctx, [], { ...b, text: b.label });
  }
}
