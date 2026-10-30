import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { APP_VERSION } from '../../shared/constants.js';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('player updates use the lobby board: dismiss, reload, reopen and leave for a match', {
  skip: !(process.env.SP_E2E === '1' && existsSync(CHROME)), timeout: 90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${srv.port}`;
    const response = await page.goto(`${base}/data/announcements.json`);
    assert.equal(response.headers()['cache-control'], 'no-cache');
    assert.equal((await response.json())[0].title, `${APP_VERSION} 更新说明`);
    await page.goto(base);
    await page.waitForSelector('.title-foot');
    assert.equal(await page.$('.release-notes'), null);
    assert.equal(await page.$('.release-notes-entry'), null);
    await page.evaluate(() => {
      localStorage.setItem('sp.name', '公告测试');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.reload();
    await page.waitForSelector('.announcement-board');
    const text = await page.$eval('.announcement-list', e => e.textContent);
    assert.ok(text.includes(`${APP_VERSION} 更新说明`));
    assert.doesNotMatch(text, /CHANGELOG\.md|node --test|systemctl|维护者/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.announcement-board', { hidden: true });
    await page.reload();
    await page.waitForSelector('.lobby-screen .hub-entries');
    await page.waitForFunction(() => !!localStorage.getItem('sp.pref.announcements.dismissed'));
    assert.equal(await page.$('.announcement-board'), null);
    await page.click('.hub-notice');
    await page.waitForSelector('.announcement-board');
    await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      store.set({ session: { entered: true }, room: { inMatch: true } });
    });
    await page.waitForSelector('.announcement-board', { hidden: true });
    assert.equal(await page.$('.release-notes'), null);
  } finally { await browser.close(); await srv.close(); }
});
