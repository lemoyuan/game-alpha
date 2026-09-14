// 把 js/ 复制成浏览器/Node 可直接 import 的版本（补全相对导入的 .js 后缀）
// 小游戏运行时允许省略后缀，标准 ESM 不允许 —— 无头检查和浏览器预览台都需要这一步
import fs from 'fs';
import path from 'path';

// 第三方老包是 CommonJS/UMD（小游戏运行时支持 require，Node 也能按语法自动识别）
// 浏览器把 .js 当纯 ESM 加载，没有 default 导出会直接报错，所以副本里统一包一层
const wrapUmd = (body) => `const module = { exports: {} }; const exports = module.exports;\n${body}\nexport default module.exports;\n`;

export function prepareCopy(srcRoot, dstRoot) {
  fs.rmSync(dstRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dstRoot), { recursive: true });
  fs.cpSync(srcRoot, dstRoot, { recursive: true });
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        let code = fs.readFileSync(p, 'utf8').replace(
          /(from\s+')(\.[^']+?)(')/g,
          (m, a, spec, c) => (spec.endsWith('.js') ? m : `${a}${spec}.js${c}`)
        );
        const isLib = path.relative(dstRoot, p).split(path.sep)[0] === 'libs';
        if (isLib && !/^\s*(export|import)\b/m.test(code)) code = wrapUmd(code);
        fs.writeFileSync(p, code);
      }
    }
  };
  walk(dstRoot);
  return dstRoot;
}

export const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
