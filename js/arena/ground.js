import { TILE, GROUND } from '../consts';

// 一块地面贴图覆盖的逻辑边长（256 = 4×4 个网格）
export const GROUND_TILE = TILE * GROUND.repeat;

// 固定种子随机：地面每次运行长得一样，改参数时才能对比出差异
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 一圈抖动半径的采样点，连成圆滑的有机轮廓（中点二次贝塞尔）
function makeBlob(rnd, r, wob) {
  const n = 9 + Math.floor(rnd() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - wob + rnd() * wob * 2);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

function traceBlob(ctx, pts) {
  const last = pts.length - 1;
  const mx = (pts[last][0] + pts[0][0]) / 2;
  const my = (pts[last][1] + pts[0][1]) / 2;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  for (let i = 0; i <= last; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
}

/**
 * 生成一块可无缝平铺的地面贴图：每个图形都额外画 8 个「偏移一整块」的副本，
 * 于是跨过边界的半个斑块会在对侧补出来，平铺后看不出接缝。
 * @returns {object} 离屏 canvas，可直接喂给 ctx.drawImage
 */
export function buildGroundTile() {
  const px = Math.round(GROUND_TILE * GROUND.scale);
  const c = wx.createCanvas();
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(GROUND.seed);
  const offs = [-px, 0, px];
  const S = GROUND.scale; // 逻辑像素 → 离屏像素
  const lw = GROUND.line * S;

  ctx.fillStyle = GROUND.base;
  ctx.fillRect(0, 0, px, px);
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;

  const blobs = [];
  for (let i = 0; i < GROUND.patches; i++) {
    blobs.push({
      x: rnd() * px,
      y: rnd() * px,
      pts: makeBlob(rnd, px * (GROUND.minR + rnd() * (GROUND.maxR - GROUND.minR)), 0.22),
      fill: GROUND.tones[Math.floor(rnd() * GROUND.tones.length)],
      edge: rnd() < GROUND.outlined,
    });
  }
  for (const b of blobs) {
    for (const dx of offs) {
      for (const dy of offs) {
        ctx.save();
        ctx.translate(b.x + dx, b.y + dy);
        ctx.fillStyle = b.fill;
        traceBlob(ctx, b.pts);
        ctx.fill();
        // 只给一部分斑块勾边：全勾会变成彩色玻璃，把怪物的外描边一起淹没
        if (b.edge) {
          ctx.strokeStyle = GROUND.outline;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  ctx.fillStyle = GROUND.speckle;
  for (let i = 0; i < GROUND.speckles; i++) {
    const x = rnd() * px;
    const y = rnd() * px;
    const r = (1 + rnd() * 1.6) * S;
    for (const dx of offs) {
      for (const dy of offs) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return c;
}

let tile = null;

// 贴图只生成一次：每帧重建会直接卡死
export function getGroundTile() {
  if (!tile) tile = buildGroundTile();
  return tile;
}
