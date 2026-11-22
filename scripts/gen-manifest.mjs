// 从 plugins/*.js 的 meta 重新生成 manifest.json（meta 是唯一真相来源）。
// 用法：node scripts/gen-manifest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(process.argv[2] || '.');
const PLUGINS = path.join(REPO, 'plugins');
const TMP = path.join(REPO, '.tmp-meta');
fs.mkdirSync(TMP, { recursive: true });

const files = fs.readdirSync(PLUGINS).filter((f) => f.endsWith('.js')).sort();
const entries = [];
for (const f of files) {
  const id = f.replace(/\.js$/, '');
  const copy = path.join(TMP, id + '.mjs');
  fs.copyFileSync(path.join(PLUGINS, f), copy);
  const mod = await import(pathToFileURL(copy).href + '?v=' + Math.random());
  const meta = mod.meta;
  if (!meta || typeof mod.default !== 'function') throw new Error('插件无效（缺少 meta 或 default）: ' + f);
  if (meta.id !== id) throw new Error(`meta.id 与文件名不一致: ${f} -> ${meta.id}`);
  if (!/^\d+\.\d+\.\d+$/.test(meta.version)) throw new Error('版本号必须是三段十进制数字: ' + f);
  if (!meta.name) throw new Error('缺少 meta.name: ' + f);
  entries.push({
    id: meta.id,
    name: meta.name,
    version: meta.version,
    description: meta.description || '',
    url: 'plugins/' + f,
  });
}
fs.rmSync(TMP, { recursive: true, force: true });

const manifestPath = path.join(REPO, 'manifest.json');
const current = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) : {};
const manifest = {
  name: current.name || 'HGhub 插件集（lionlee0724 维护）',
  description: current.description || '由 3 个上游订阅合并维护的 HPP 1.0 单文件源集合，含本地修复。',
  plugins: entries,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json 已更新：${entries.length} 个插件`);
