import { ctx } from './render';
import DataBus from './databus';
import Player from './player/index';
import Arena from './arena/index';
import Camera from './camera/index';
import Joystick from './ui/joystick';
import Hud from './ui/hud';
import UpgradeScreen from './ui/upgrade';
import HomeScreen from './ui/home';
import Spawner from './npc/monster/spawner';
import XpGem from './npc/xpgem';
import Chest from './npc/chest';
import { canvasW, canvasH } from './consts';
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
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (databus.player) {
      databus.camera.follow(databus.player);
    }

    databus.camera.begin(ctx);
    databus.arena.draw(ctx);
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

    databus.hud.draw(ctx, databus);
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
    const by = Math.round(canvasH * 0.56);
    return [
      { label: '再来一局', x: bx, y: by, w: bw, h: bh, action: () => { this.startRequested = true; } },
      { label: '返回首页', x: bx, y: by + bh + gap, w: bw, h: bh, action: () => { this.homeRequested = true; } },
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
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 32px monospace';
    ctx.fillText('GAME OVER', canvasW / 2, canvasH * 0.26);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(
      `生存 ${formatTime(databus.spawner.elapsed)} · Lv.${player.level} · 击杀 ${player.kills} · 宝箱 ${databus.chestsOpened}`,
      canvasW / 2, canvasH * 0.26 + 34
    );

    const marks = this.lastMarks || {};
    const bests = [
      { label: '最长生存', value: formatTime(records.bestTime), isNew: marks.time },
      { label: '最高等级', value: `Lv.${records.bestLevel}`, isNew: marks.level },
      { label: '最多击杀', value: `${records.bestKills}`, isNew: marks.kills },
    ];
    ctx.font = '12px monospace';
    bests.forEach((b, i) => {
      const y = canvasH * 0.26 + 62 + i * 18;
      ctx.fillStyle = '#888';
      ctx.fillText(`${b.label} ${b.value}`, canvasW / 2 - 20, y);
      if (b.isNew) {
        ctx.fillStyle = '#f1c40f';
        ctx.textAlign = 'left';
        ctx.fillText('新纪录', canvasW / 2 + 56, y);
        ctx.textAlign = 'center';
      }
    });

    for (const b of this.gameOverButtons()) {
      ctx.fillStyle = '#27ae60';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 6);
    }
  }
}
