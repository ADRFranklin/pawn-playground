import {test, expect} from '@playwright/test';
import {createServer, request as proxyRequest} from 'node:http';
import {readFile} from 'node:fs/promises';

async function waitForOfflineSupport(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test('installable metadata and locally served resources support a cold offline compile/run', async ({page, context}) => {
  const external = [];
  const errors = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:7073') external.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await waitForOfflineSupport(page);

  const manifest = await page.evaluate(async () => (await fetch('/manifest.json')).json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.icons.some(icon => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(async src => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.src);
    expect(dimensions).toBe(icon.sizes);
  }
  const client = await context.newCDPSession(page);
  const installation = await client.send('Page.getInstallabilityErrors');
  // Playwright uses an incognito context, where actual installation is disabled.
  expect(installation.installabilityErrors.filter(error => error.errorId !== 'in-incognito')).toEqual([]);
  await client.detach();

  const code = '#include <open.mp>\nmain() { printf("Offline works!\\n"); }';
  await page.evaluate(value => window.PPG.setCurrentCode(value), code);
  await page.waitForFunction(value => JSON.parse(localStorage.ppgDocuments)[0].state.doc === value, code);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(await page.evaluate(() => window.PPG.getCurrentCode())).toBe(code);
  await page.locator('#run').click();
  await expect(page.locator('#compile-status')).toHaveText('Done', {timeout: 20000});
  await expect(page.locator('.program-output')).toContainText('Offline works!');

  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('pawn-playground-'));
    const cache = await caches.open(names[0]);
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  expect(cached).toContain('/wasm/pawncc.data');
  expect(cached).toContain('/wasm/pawnrun.wasm');
  expect(cached.some(path => path.startsWith('/api/'))).toBe(false);
  expect(await page.evaluate(() => fetch('/api/share/missing').then(() => 'response', () => 'offline'))).toBe('offline');

  await page.goto('/s/offline-link');
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.share-toast')).toContainText('Shared links need an internet connection.');
  await context.setOffline(false);
  await expect(page.locator('#share-btn')).toBeEnabled();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('the install action appears only when a browser installation prompt is available', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', {cancelable: true});
    event.prompt = async () => { window.installPromptShown = true; };
    event.userChoice = Promise.resolve({outcome: 'accepted'});
    window.dispatchEvent(event);
  });
  await expect(page.locator('#install-app')).toBeVisible();
  await page.locator('#install-app').click();
  expect(await page.evaluate(() => window.installPromptShown)).toBe(true);
  await expect(page.locator('#install-app')).toBeHidden();
  // Test the browser's connectivity notifications separately from network
  // emulation, which may leave navigator.onLine true after a cached reload.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => false});
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.locator('#share-btn')).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => true});
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('#share-btn')).toBeEnabled();
});


test('an update waits for open editors to close and replaces only the old app cache', async ({page, context, baseURL}) => {
  const worker = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  let release = 1;
  // Simulate two deployments without editing the checkout or restarting Go.
  const server = createServer((req, res) => {
    if (req.url.startsWith('/sw.js')) {
      res.writeHead(200, {'Content-Type': 'text/javascript', 'Cache-Control': 'no-store'});
      res.end(worker.replace(/const CACHE_NAME = '[^']+'/,
        `const CACHE_NAME = 'pawn-playground-test-release-${release}'`));
      return;
    }
    const upstream = proxyRequest(new URL(req.url, baseURL), {method: req.method, headers: req.headers}, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => {res.writeHead(502); res.end();});
    req.pipe(upstream);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    let navigations = 0;
    page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations++;});
    await page.goto(origin);
    await waitForOfflineSupport(page);
    await page.evaluate(() => {
      window.controllerBeforeUpdate = navigator.serviceWorker.controller;
      window.PPG.setCurrentCode('main() { /* draft stays open */ }');
    });
    // Activation must leave caches belonging to other apps untouched.
    await page.evaluate(() => caches.open('another-app-cache'));
    release = 2;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state === 'installed');
    expect(await page.evaluate(() => navigator.serviceWorker.controller === window.controllerBeforeUpdate)).toBe(true);
    expect(await page.evaluate(() => window.PPG.getCurrentCode())).toContain('draft stays open');
    expect(navigations).toBe(1);
    expect(await page.evaluate(() => caches.keys())).toContain('pawn-playground-test-release-1');

    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(origin);
    await reopened.waitForFunction(async () => {
      const names = await caches.keys();
      return names.includes('pawn-playground-test-release-2') && !names.includes('pawn-playground-test-release-1');
    });
    await expect(reopened.locator('.cm-editor')).toBeVisible();
    expect(await reopened.evaluate(() => window.PPG.getCurrentCode())).toContain('draft stays open');
    expect(await reopened.evaluate(() => caches.keys())).toContain('another-app-cache');
    await reopened.close();
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
