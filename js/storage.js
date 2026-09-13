// 本地存储：设置项 + 游戏记录（wx.setStorageSync），读失败一律回退默认值
const SETTINGS_KEY = 'ga_settings_v1';
const RECORDS_KEY = 'ga_records_v1';

export const DEFAULT_SETTINGS = {
  damageText: true, // 伤害飘字
  vibrate: true,    // 受击振动
  sound: true,      // 音效开关（音频系统待接入，暂只保存偏好）
  bgm: true,        // 背景音乐开关（同上）
};

function readKey(key) {
  try {
    const value = wx.getStorageSync(key);
    return value && typeof value === 'object' ? value : null;
  } catch (e) {
    return null;
  }
}

function writeKey(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    // 存储不可用时静默降级为本局内存值
  }
}

// 实时设置对象：各模块 import 后直接读同一份，首页开关改写后立即生效
export const settings = Object.assign({}, DEFAULT_SETTINGS, readKey(SETTINGS_KEY));

export function saveSettings() {
  writeKey(SETTINGS_KEY, settings);
}

const emptyRecords = () => ({
  bestTime: 0,   // 最长生存秒数
  bestLevel: 0,  // 最高等级
  bestKills: 0,  // 最多击杀
  totalChests: 0, // 累计开箱数
  encountered: [], // 图鉴已遭遇的怪物 type
  runs: [],        // 最近战绩 [{ t, lv, k, c }]
});

export const records = Object.assign(emptyRecords(), readKey(RECORDS_KEY));
if (!Array.isArray(records.runs)) records.runs = [];
if (!Array.isArray(records.encountered)) records.encountered = [];

export function saveRecords() {
  writeKey(RECORDS_KEY, records);
}

// 怪物图鉴：首次遭遇即永久解锁，返回是否新解锁
export function markEncountered(type) {
  if (records.encountered.indexOf(type) === -1) {
    records.encountered.push(type);
    saveRecords();
    return true;
  }
  return false;
}

// 一局结束：刷新三项最佳 + 累计开箱 + 写入最近 5 局，返回本局破纪录标记
export function submitRun(run) {
  const time = Math.floor(run.time);
  const marks = {
    time: time > records.bestTime,
    level: run.level > records.bestLevel,
    kills: run.kills > records.bestKills,
  };
  records.bestTime = Math.max(records.bestTime, time);
  records.bestLevel = Math.max(records.bestLevel, run.level);
  records.bestKills = Math.max(records.bestKills, run.kills);
  records.totalChests += run.chests || 0;
  records.runs.unshift({ t: time, lv: run.level, k: run.kills, c: run.chests || 0 });
  if (records.runs.length > 5) records.runs.length = 5;
  saveRecords();
  return marks;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
