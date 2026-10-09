import {createHash} from 'node:crypto';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../web/', import.meta.url));
async function files(directory) {
  const entries = await readdir(join(root, directory), {withFileTypes: true});
  const lists = await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(`${directory}/${entry.name}`) : [`/${directory}/${entry.name}`]));
  return lists.flat();
}
const html = await readFile(join(root, 'index.html'), 'utf8');
const linked = [...html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)]
  .map(match => match[1].split('?')[0]);
const assets = [...new Set([
  '/', '/manifest.json', ...linked,
  '/js/pawn-compiler-worker.js', '/js/pawn-runner-worker.js',
  ...await files('vendor'), ...await files('icons'),
  ...(await files('wasm')).filter(name => /\.(?:wasm|data|js)$/.test(name))
])].sort();
const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
const hash = createHash('sha256').update(template);
for (const asset of assets) {
  hash.update(asset);
  hash.update(await readFile(join(root, asset === '/' ? 'index.html' : asset.slice(1))));
}
const version = hash.digest('hex').slice(0, 20);
await writeFile(join(root, 'sw.js'), template
  .replace('__CACHE_NAME__', `pawn-playground-${version}`)
  .replace('/*__PRECACHE__*/[]', JSON.stringify(assets, null, 2)));
console.log(`PWA: ${assets.length} assets, version ${version}`);
