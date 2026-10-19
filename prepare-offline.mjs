import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('./', import.meta.url);
async function walk(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const lists = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(dir + entry.name + '/') : [dir + entry.name]));
  return lists.flat();
}
const assets = ['./', './index.html', './style.css', './app.js', './text.js', './manifest.webmanifest', './icon.svg', ...(await walk('vendor/package/')).map(x => './' + x)].sort();
const hash = createHash('sha256');
for (const asset of assets) hash.update(asset).update(await readFile(new URL(asset === './' ? './index.html' : asset, root)));
hash.update(await readFile(new URL('./sw.js', root)));
await writeFile(new URL('./offline-assets.js', root), `self.LEAF_VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 16))};\nself.LEAF_ASSETS = ${JSON.stringify(assets, null, 2)};\n`);
console.log(`Offline manifest prepared: ${assets.length} local files.`);
