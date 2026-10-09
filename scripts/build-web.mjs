import {build, context} from 'esbuild';
import sharp from 'sharp';
import {mkdir, copyFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
await mkdir('web/vendor/fonts', {recursive: true});
await mkdir('web/icons', {recursive: true});
const vendors = {
  'bootstrap/dist/css/bootstrap.min.css': 'bootstrap.min.css',
  'bootstrap/dist/js/bootstrap.bundle.min.js': 'bootstrap.bundle.min.js',
  'bootstrap-icons/font/bootstrap-icons.css': 'bootstrap-icons.css',
  'bootstrap-icons/font/fonts/bootstrap-icons.woff': 'fonts/bootstrap-icons.woff',
  'bootstrap-icons/font/fonts/bootstrap-icons.woff2': 'fonts/bootstrap-icons.woff2',
  'jquery/dist/jquery.min.js': 'jquery.min.js',
  '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2': 'fonts/jetbrains-mono.woff2'
};
await Promise.all(Object.entries(vendors).map(([source, target]) =>
  copyFile(`node_modules/${source}`, `web/vendor/${target}`)));

const favicon = await readFile('web/favicon.svg');
await Promise.all([192, 512, 180].map(size => sharp(favicon)
  .resize(size, size).flatten({background: '#14171C'}).png().toFile(`web/icons/pawn-${size}.png`)));
const inset = await sharp(favicon).resize(320, 320).png().toBuffer();
await sharp({create: {width: 512, height: 512, channels: 4, background: '#14171C'}})
  .composite([{input: inset, left: 96, top: 96}]).png().toFile('web/icons/pawn-maskable-512.png');

const options = {
  entryPoints: ['web/js/ppg-editor.js'], bundle: true, format: 'iife',
  target: 'es2020', minify: true, legalComments: 'eof', outfile: 'web/js/ppg-editor.bundle.js'
};
await build(options);
await import('./build-pwa.mjs');
if (process.argv.includes('--watch')) {
  // Go embeds built files, so restart the server after a watched rebuild.
  const compiler = await context({...options, plugins: [{
    name: 'pwa-version', setup(pluginBuild) {
      pluginBuild.onEnd(async result => {
        if (!result.errors.length) await import(`./build-pwa.mjs?rebuild=${Date.now()}`);
      });
    }
  }]});
  await compiler.watch();
  console.log('Watching editor sources. Restart the Go server to use rebuilt assets.');
}
