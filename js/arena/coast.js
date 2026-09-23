import { ARENA_W, ARENA_H, ABYSS } from '../consts';

// 不规则海岸线：既是画出来的岸，也是真实的运动边界。
// 四条边各一条「内缩距离」曲线 = 基线 + 三段正弦叠加（参数见 js/consts.js 的 ABYSS.coast），
// 凹进去的是真海湾、凸出来的是真岬角，角色贴岸走位时能真的借地形卡位。

const PHASES = [0, 1.7, 3.4, 5.1]; // 上、右、下、左四边的相位，错开才不会看出四条边是同一个波

function inset(along, phase) {
  const waves = ABYSS.coast.waves;
  let v = ABYSS.coast.base;
  for (let i = 0; i < waves.length; i++) {
    v += waves[i][0] * Math.sin(along * waves[i][1] + phase + waves[i][2]);
  }
  return v;
}

export function insetTop(x) { return inset(x, PHASES[0]); }
export function insetRight(y) { return inset(y, PHASES[1]); }
export function insetBottom(x) { return inset(x, PHASES[2]); }
export function insetLeft(y) { return inset(y, PHASES[3]); }

// margin 传角色半径：四条约束同时满足才算站在岸内
function isFeasible(x, y, margin) {
  const e = 1e-6; // 边界采样点自身要能过判
  return x >= insetLeft(y) + margin - e
    && x <= ARENA_W - insetRight(y) - margin + e
    && y >= insetTop(x) + margin - e
    && y <= ARENA_H - insetBottom(x) - margin + e;
}

/**
 * 把实体夹回海岸线内（原地改 x/y，不分配对象）
 * x 受上下两条曲线约束、y 受左右两条约束，互相牵连，所以迭代两轮收敛
 * @param {{x: number, y: number}} entity
 * @param {number} radius 碰撞半径
 */
export function clampToCoast(entity, radius) {
  let x = entity.x;
  let y = entity.y;
  for (let i = 0; i < 2; i++) {
    const minX = insetLeft(y) + radius;
    const maxX = ARENA_W - insetRight(y) - radius;
    if (x < minX) x = minX; else if (x > maxX) x = maxX;
    const minY = insetTop(x) + radius;
    const maxY = ARENA_H - insetBottom(x) - radius;
    if (y < minY) y = minY; else if (y > maxY) y = maxY;
  }
  entity.x = x;
  entity.y = y;
}

const STEP = 16; // 采样步长：最短的 wave 波长 ~300px，16px 采一个点足够把曲线描平

let _points = null; // 闭合折线，形状只由 ABYSS.coast 决定，算一次缓存

/**
 * 海岸线采样点（世界坐标，顺时针一圈：上边 0→W、右边 0→H、下边 W→0、左边 H→0）
 * 每项含 outward 单位法线 nx/ny，供浪花、气泡沿岸摆放
 * @returns {Array<{x: number, y: number, nx: number, ny: number}>}
 */
export function coastPoints() {
  if (_points) return _points;
  const raw = [];
  for (let x = 0; x <= ARENA_W; x += STEP) raw.push([x, insetTop(x)]);
  for (let y = 0; y <= ARENA_H; y += STEP) raw.push([ARENA_W - insetRight(y), y]);
  for (let x = ARENA_W; x >= 0; x -= STEP) raw.push([x, ARENA_H - insetBottom(x)]);
  for (let y = ARENA_H; y >= 0; y -= STEP) raw.push([insetLeft(y), y]);
  // 只留「真的是岸」的点：拐角处两条曲线一相交，被另一条约束压到岸外的点直接丢掉。
  // 于是折线在拐角自己收口成海湾，不用直线封边，画出来的岸和 clampToCoast 也就完全一致
  const kept = raw.filter((p) => isFeasible(p[0], p[1], 0));
  const n = kept.length;
  _points = kept.map((p, i) => {
    const prev = kept[(i - 1 + n) % n];
    const next = kept[(i + 1) % n];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    return { x: p[0], y: p[1], nx: ty / len, ny: -tx / len }; // 顺时针走，切向右转 90° 即朝海外
  });
  return _points;
}

/**
 * 把海岸线建成一条闭合路径，调用方接着 stroke / clip
 * @param {object} ctx
 */
export function traceCoast(ctx) {
  const pts = coastPoints();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}
