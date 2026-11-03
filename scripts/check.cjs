'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
assert(scripts.length > 0, '页面没有内联脚本');
for (const [i, script] of scripts.entries()) {
  assert(!/\bsrc\s*=/i.test(script[1]), '离线版不能依赖外部脚本');
  new vm.Script(script[2], { filename: `index.inline-${i + 1}.js` });
}
const assetScript = scripts.find(script => /\bconst ASSETS\s*=/.test(script[2]));
assert(assetScript, '未找到内嵌资源表');
const assetsMatch = assetScript[2].match(/\bconst ASSETS\s*=\s*(\{[\s\S]*\})\s*;/);
assert(assetsMatch, '资源表格式有误');
const assets = JSON.parse(assetsMatch[1]);
for (const [name, uri] of Object.entries(assets)) {
  assert.equal(typeof uri, 'string', `资源格式错误：${name}`);
  const match = uri.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  assert(match, `资源不是有效内嵌 data URI：${name}`);
  assert(match[2].length > 0 && match[2].length % 4 === 0, `资源 base64 不完整：${name}`);
  const bytes = Buffer.from(match[2], 'base64');
  assert(bytes.length > 0 && bytes.toString('base64') === match[2], `资源解码失败：${name}`);
  if (name.endsWith('.png')) assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `PNG 文件损坏：${name}`);
}
for (const match of html.matchAll(/\bdata-asset\s*=\s*["']([^"']+)["']/g)) assert(assets[match[1]], `页面引用缺失资源：${match[1]}`);
assert(!/<(?:img|audio|video|source|iframe|script)\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(html), '页面存在远程运行依赖');
assert(!/<link\b[^>]*\bhref\s*=\s*["'](?:https?:)?\/\//i.test(html), '页面存在远程样式依赖');
assert(!/url\(\s*["']?(?:https?:)?\/\//i.test(html), '页面存在远程 CSS 资源');
console.log(`检查通过：${scripts.length} 段脚本，${Object.keys(assets).length} 个内嵌资源；无需网络运行。`);
