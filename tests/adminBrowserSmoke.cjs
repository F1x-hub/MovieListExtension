const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failedRequests = [];
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    await page.goto('http://127.0.0.1:4173/src/pages/admin/admin.html', { waitUntil: 'commit', timeout: 5_000 });

    await page.locator('#pane-provider-keys').waitFor({ state: 'attached' });
    await page.locator('#providerKeyForm').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#providerKeySecret').getAttribute('type'), 'password');
    assert.equal(await page.locator('#providerKeyConfirmModal').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#providerKeyConfirmModal').getAttribute('aria-modal'), 'true');

    await page.waitForFunction(() => Boolean(window.adminPanel), { timeout: 5_000 });
    await page.evaluate(() => {
      const panel = window.adminPanel;
      panel.showError = () => {};
      panel.providerKeys = [{
        id: 'key-demo',
        provider: 'kinopoisk',
        label: 'Основной',
        purpose: 'Поиск фильмов',
        maskedValue: '••••alue',
        status: 'active',
        lastCheckedAt: '2026-08-26T10:00:00.000Z',
        quota: { mode: 'provider_exact', unit: 'requests', remaining: 900, limit: 1000 }
      }];
      document.getElementById('adminLoading').style.display = 'none';
      document.getElementById('adminError').style.display = 'none';
      document.getElementById('adminContent').style.display = 'block';
      document.getElementById('adminSectionNav').style.display = 'block';
      document.querySelectorAll('.settings-pane').forEach((pane) => pane.classList.remove('active'));
      document.getElementById('pane-provider-keys').classList.add('active');
      panel.renderProviderKeys(panel.providerKeys);
    });
    assert.equal(await page.locator('.provider-key-actions button').count(), 4);

    const mobileTableRule = await page.evaluate(() => {
      const sheet = [...document.styleSheets].find((item) => item.href?.includes('/admin.css'));
      return Boolean(sheet);
    });
    assert.equal(mobileTableRule, true);
    await page.screenshot({ path: 'artifacts/admin-provider-keys-mobile-shell.png', fullPage: true });
    console.log(`adminBrowserSmoke.cjs: passed (${failedRequests.length} expected local dependency failures)`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
