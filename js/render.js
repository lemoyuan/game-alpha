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

// 微信胶囊按钮（··· + 关闭）盖在画布之上：游戏代码既画不到它、也收不到它下面的点击，只能绕开。
// 症状不是「看不见」而是「点不动」，比遮挡更难查，所以顶部 UI 一律按这条底边让位。
// 小游戏可直接读，返回 px、无版本要求；但文档写明部分机型返回值异常，
// 于是只认「bottom 大于 safeTop」这一条，读不到就退回刘海机的比例（safeTop 47 → 底边 83）
let capsuleBottom = safeTop + 36;
try {
  const r = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
  if (r && r.bottom > safeTop) capsuleBottom = r.bottom;
} catch (e) {}

export { canvas, ctx, canvasWidth, canvasHeight, safeTop, capsuleBottom };
