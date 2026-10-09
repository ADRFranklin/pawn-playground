import {test, expect} from '@playwright/test';

const simpleProgram = '#include <open.mp>\nmain()\n{\n\tprintf("CM6 works!\\n");\n\treturn 0;\n}\n';

test('CM6 editing, diagnostics, folding, keymaps, compilation, and output panels', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.cm-editor .cm-def')).toContainText('main');
  expect(await page.evaluate(() => typeof window.CodeMirror)).toBe('undefined');
  await expect(page.locator('.cm-editor .cm-number').first()).toHaveCSS('color', 'rgb(232, 186, 136)');
  await page.locator('#run').click();
  await expect(page.locator('#compile-status')).toHaveText('Done', {timeout: 20000});
  await expect(page.locator('.program-output')).toContainText('items[4] = 16');

  await page.locator('#compile-macros').click();
  await expect(page.locator('.macro-stepper')).toBeVisible({timeout: 20000});
  await expect(page.locator('.compiler-output-lst .repl-line').first()).toBeVisible();

  await page.evaluate(code => window.PPG.setCurrentCode(code), simpleProgram);
  for (const [button, output, token] of [['#compile-lst', '.compiler-output-lst', '.cm-keyword'], ['#compile-asm', '.compiler-output-asm', '.cm-atom']]) {
    await page.locator(button).click();
    await expect(page.locator(output)).toBeVisible({timeout: 20000});
    await expect(page.locator(output + ' ' + token).first()).toBeVisible();
  }

  await page.evaluate(() => window.PPG.setEditorErrors([{startLine: 3, endLine: 3, type: 'error', message: 'Test diagnostic'}]));
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0);

  await page.locator('.cm-foldGutter .cm-gutterElement').filter({hasText: '−'}).first().click();
  await expect(page.locator('.cm-foldPlaceholder')).toBeVisible();
  await page.locator('.cm-foldPlaceholder').click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);

  for (const keymap of ['vscode', 'sublime', 'emacs', 'vim', 'default']) {
    await page.locator('.toolbar-right .dropdown-toggle').click();
    await page.locator(`[data-keymap="${keymap}"]`).click();
    await expect(page.locator('.keymap-current')).toHaveText(keymap);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Alt+Shift+C');
    await expect(page.locator('#compile-status')).toHaveText('OK', {timeout: 20000});
  }
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('CM5 saves import; document edits, selections, and undo survive switching and reload', async ({page}) => {
  const legacy = [{name: 'legacy', uid: 123, value: 'main() {}', cursor: {line: 0, ch: 4}, selection: {ranges: [{anchor: {line: 0, ch: 4}, head: {line: 0, ch: 4}}], primIndex: 0}}];
  await page.addInitScript(saved => {
    if (!localStorage.ppgDocuments) {
      localStorage.ppgDocuments = JSON.stringify(saved);
      localStorage.ppgActiveDoc = '123';
    }
  }, legacy);
  await page.goto('/');
  expect(await page.evaluate(() => window.PPG.getCurrentCode())).toBe('main() {}');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' // saved');
  await page.waitForFunction(() => JSON.parse(localStorage.ppgDocuments)[0].state.doc === window.PPG.getCurrentCode());
  await page.locator('.document-list .new-doc').click();
  await page.locator('#new-doc-name').fill('second');
  await page.locator('#new-doc-confirm').click();
  await expect(page.locator('.document-list .active .doc-item-name')).toHaveText('second');
  await page.evaluate(code => window.PPG.setCurrentCode(code), simpleProgram);
  await page.locator('.doc-item-name').filter({hasText: /^legacy$/}).click();
  expect(await page.evaluate(() => window.PPG.getCurrentCode())).toBe('main() {} // saved');
  await page.reload();
  await expect(page.locator('.cm-editor')).toBeVisible();
  expect(await page.evaluate(() => window.PPG.getCurrentCode())).toBe('main() {} // saved');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.PPG.getCurrentCode())).toBe('main() {}');
  expect(await page.evaluate(() => JSON.parse(localStorage.ppgDocumentsLegacyBackup))).toEqual(legacy);
  expect(await page.evaluate(() => JSON.parse(localStorage.ppgDocuments)[0].state.doc)).toBeDefined();
});

test('document changes synchronise across tabs using the application save keys', async ({page}) => {
  await page.goto('/');
  await page.evaluate(code => window.PPG.setCurrentCode(code), simpleProgram);
  await page.waitForFunction(() => JSON.parse(localStorage.ppgDocuments)[0].state.doc === window.PPG.getCurrentCode());
  const revision = await page.evaluate(() => localStorage.ppgSaveRevision);
  const other = await page.context().newPage();
  await other.goto('/');
  await expect(other.locator('.cm-editor')).toBeVisible();
  expect(await other.evaluate(() => localStorage.ppgSaveRevision)).toBe(revision);
  await other.evaluate(() => window.PPG.setCurrentCode(window.PPG.getCurrentCode() + '// synced\n'));
  await page.waitForFunction(() => window.PPG.getCurrentCode().endsWith('// synced\n'));
  await other.close();
});
