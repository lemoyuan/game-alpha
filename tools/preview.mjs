// 浏览器 UI 预览台：把 js/ + images/ + tools/preview.html 装配到 .preview/ 并起本地静态服务
// 用法：node tools/preview.mjs [端口]   然后浏览器打开 http://127.0.0.1:8123/
// 改完 js/ 或 preview.html 不用重启，刷新页面即可（请求时按 mtime 重建）
// 只为看界面，不参与打包（.preview 已加入 .gitignore 与 packOptions.ignore）
import fs from 'fs';
import http from 'http';
import path from 'path';
import { prepareCopy } from './prepare_copy.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '.preview');
const JSSRC = path.join(ROOT, 'js');
const JSDST = path.join(OUT, 'js');
const HTMLSRC = path.join(ROOT, 'tools', 'preview.html');
const HTMLDST = path.join(OUT, 'index.html');
const PORT = Number(process.argv[2] || 8123);

// 目录取最新 mtime，用来判断源码是否比构建产物新
const mtime = (p) => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let t = st.mtimeMs;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) t = Math.max(t, mtime(path.join(p, e.name)));
  return t;
};

function syncSources() {
  if (!fs.existsSync(JSDST) || mtime(JSSRC) > mtime(JSDST)) prepareCopy(JSSRC, JSDST);
  if (!fs.existsSync(HTMLDST) || mtime(HTMLSRC) > mtime(HTMLDST)) fs.copyFileSync(HTMLSRC, HTMLDST);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'images'), path.join(OUT, 'images'), { recursive: true });
syncSources();

http.createServer((req, res) => {
  const raw = decodeURIComponent(req.url);
  const url = raw.split('?')[0];

  // 页面把 canvas.toDataURL() POST 回来存盘：浏览器窗口不可见时也能拿到真实渲染图
  if (req.method === 'POST' && url === '/save') {
    const name = (raw.match(/name=([\w-]+)/) || [])[1] || 'shot';
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const dir = path.join(OUT, 'shots');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name + '.png');
      fs.writeFileSync(file, Buffer.from(body.split(',')[1] || '', 'base64'));
      console.log('shot:', file);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(file);
    });
    return;
  }

  syncSources();
  const file = path.join(OUT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`预览台已启动：http://127.0.0.1:${PORT}/`);
});
