const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
const canvasWidth = canvas.width;
const canvasHeight = canvas.height;

// 刘海屏安全区：UI 顶部需向下偏移 safeTop，避免被刘海/状态栏遮挡
let safeTop = 0;
try {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  if (info.safeArea) safeTop = info.safeArea.top;
} catch (e) {
  safeTop = 0;
}

export { canvas, ctx, canvasWidth, canvasHeight, safeTop };
