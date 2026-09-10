import { ctx, canvasWidth, canvasHeight } from './render';
import DataBus from './databus';
import Player from './player/index';
import Arena from './arena/index';
import Camera from './camera/index';
import Joystick from './ui/joystick';
import Hud from './ui/hud';
import UpgradeScreen from './ui/upgrade';
import Spawner from './npc/monster/spawner';
import XpGem from './npc/xpgem';
import Chest from './npc/chest';
import { canvasW, canvasH, ARENA_W, ARENA_H } from './consts';

const databus = new DataBus();

export default class Main {
  constructor() {
    this.raf = null;
    this.lastTime = 0;
    this.start();
  }

  start() {
    databus.reset();
    databus.player = new Player();
    databus.camera = new Camera();
    databus.arena = new Arena();
    databus.joystick = new Joystick();
    databus.joystick.init();
    databus.hud = new Hud();
    databus.upgradeScreen = new UpgradeScreen();
    databus.upgradeScreen.init(databus);
    databus.spawner = new Spawner();
    databus.isGameOver = false;
    databus.isPaused = false;
    this.lastTime = Date.now();
    this.loop();
  }

  loop() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (!databus.isGameOver && !databus.isPaused) {
      databus.frame++;
      databus.spawner.update(dt, databus);
      databus.update(dt);
      this.checkCollisions();
    }

    this.render();
    this.raf = requestAnimationFrame(() => this.loop());
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

  drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvasW / 2, canvasH / 2 - 60);

    const p = databus.player;
    ctx.fillStyle = '#fff';
    ctx.font = '18px monospace';
    ctx.fillText(`Level: ${p.level}`, canvasW / 2, canvasH / 2 - 10);
    ctx.fillText(`Kills: ${p.kills}`, canvasW / 2, canvasH / 2 + 20);

    const mins = Math.floor(databus.spawner.elapsed / 60);
    const secs = Math.floor(databus.spawner.elapsed % 60);
    ctx.fillText(`Time: ${mins}:${secs < 10 ? '0' : ''}${secs}`, canvasW / 2, canvasH / 2 + 50);

    ctx.fillStyle = '#3498db';
    ctx.fillRect(canvasW / 2 - 60, canvasH / 2 + 80, 120, 40);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('RESTART', canvasW / 2, canvasH / 2 + 105);

    if (!this._restartBound) {
      this._onRestart = (e) => {
        if (!databus.isGameOver) return;
        const t = e.touches[0];
        const x = t.clientX;
        const y = t.clientY;
        if (x > canvasW / 2 - 60 && x < canvasW / 2 + 60 &&
            y > canvasH / 2 + 80 && y < canvasH / 2 + 120) {
          this.start();
        }
      };
      wx.onTouchStart(this._onRestart);
      this._restartBound = true;
    }
  }
}
