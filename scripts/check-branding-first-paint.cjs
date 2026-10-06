/* Browser integration checks: APIs are mocked; no real accounts are changed. */
const { chromium } = require('../apps/frontend/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.BRANDING_TEST_URL || 'http://localhost:3000';
const key = 'signa.branding.17';
const account = { id: '17', name: 'First Paint Organization', locale: 'en', timezone: 'UTC' };
const session = { access_token: 'test-token', user: { id: '7', role: 'admin', email: 'test@example.test' }, account };
const brand = { account_name: account.name, primary_color: '#00da97', white_label: true, show_business_name: true, logo: { url: `${base}/api/logo-fixture`, background: 'transparent' } };
const preferences = { submitter_invitation_email: { subject: 'Sign', body: 'Sign' }, submitter_completed_email: { subject: 'Done', body: 'Done' }, submitter_documents_copy_email: { subject: 'Copy', body: 'Copy' }, form_completed_message: {}, form_completed_button: {}, form_with_confetti: false };
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/hydration|didn't match/i.test(message.text())) errors.push(message.text()); });
  let apiGate = null;
  let currentBrand = brand;
  let apiReads = 0;
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/account/branding') {
      apiReads++;
      if (apiGate) await apiGate.promise;
      return route.fulfill({ json: currentBrand });
    }
    if (path.startsWith('/api/start-form/')) return route.fulfill({ status: 404, json: { message: 'Not found' } });
    if (path === '/api/account/preferences') return route.fulfill({ json: preferences });
    if (path === '/api/logo-fixture') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="25" fill="none" stroke="#00da97" stroke-width="5"/></svg>' });
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(session => {
    if (!sessionStorage.getItem('fixture-initialized')) {
      localStorage.setItem('signa.auth', JSON.stringify(session));
      sessionStorage.setItem('fixture-initialized', 'true');
    }
  }, session);
  try {
    await page.goto(`${base}/settings/personalization`);
    await page.waitForFunction(key => Boolean(localStorage.getItem(key)), key);
    const snapshot = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.equal(snapshot.branding.account_name, brand.account_name);
    assert.equal(snapshot.accountId, account.id);

    for (const mode of ['light', 'dark']) {
      console.log('Checking first paint before React and API:', mode);
      await page.evaluate(mode => localStorage.setItem('signa.theme', mode), mode);
      const scripts = gate();
      apiGate = gate();
      const routeHandler = async route => { if (route.request().resourceType() === 'script') await scripts.promise; await route.continue(); };
      await page.route('**/_next/static/chunks/**', routeHandler);
      try {
        await page.reload({ waitUntil: 'commit' });
        await page.locator('[data-brand-placeholder]').first().waitFor();
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim()), brand.primary_color);
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), mode === 'dark');
        const fallback = page.locator('[data-brand-placeholder]').first();
        assert.ok((await fallback.evaluate(e => getComputedStyle(e).backgroundImage)).includes('/api/logo-fixture'));
        assert.equal(await page.locator('[data-brand-logo] img').count(), 0, 'No default app logo before hydration');
        await page.screenshot({ path: `/tmp/signa-first-paint-${mode}.png`, fullPage: true });
        scripts.release();
        await page.locator('[data-brand-name]').filter({ hasText: brand.account_name }).first().waitFor();
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim()), brand.primary_color, 'Cached branding survives hydration with API pending');
      } finally {
        scripts.release(); apiGate.release(); apiGate = null;
        await page.unroute('**/_next/static/chunks/**', routeHandler);
      }
      await page.getByLabel('Primary color', { exact: true }).waitFor();
    }

    console.log('Checking DB revalidation and cross-tab synchronization');
    const previousReads = apiReads;
    currentBrand = { ...brand, account_name: 'Renamed on another device', primary_color: '#8844cc' };
    await page.reload();
    await page.locator('[data-brand-name]').filter({ hasText: currentBrand.account_name }).first().waitFor();
    assert.ok(apiReads > previousReads);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).branding.primary_color === '#8844cc', key);
    const secondTab = await context.newPage();
    await secondTab.goto(`${base}/settings/personalization`);
    await secondTab.getByLabel('Primary color', { exact: true }).waitFor();
    await secondTab.evaluate(key => {
      const snapshot = JSON.parse(localStorage.getItem(key));
      snapshot.branding.account_name = 'Cross-tab title';
      snapshot.updatedAt = Date.now();
      localStorage.setItem(key, JSON.stringify(snapshot));
    }, key);
    await page.locator('[data-brand-name]').filter({ hasText: 'Cross-tab title' }).first().waitFor();
    await secondTab.close();

    console.log('Checking wrong-account, expired, and corrupt cache fallbacks');
    for (const invalid of [{ ...snapshot, accountId: '18' }, { ...snapshot, updatedAt: 1 }, { ...snapshot, branding: { ...snapshot.branding, logo: { url: 'javascript:alert(1)' } } }, { ...snapshot, light: { ...snapshot.light, '--primary': 'red; background:url(https://example.test)' } }]) {
      await page.evaluate(({ key, invalid }) => localStorage.setItem(key, JSON.stringify(invalid)), { key, invalid });
      apiGate = gate();
      try {
        await page.reload();
        await page.locator('[data-brand-placeholder]').first().waitFor();
        assert.equal(await page.locator('[data-brand-logo] img').count(), 0);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim()), '#737373');
      } finally { apiGate.release(); apiGate = null; }
      await page.locator('[data-brand-name]').first().waitFor();
    }

    console.log('Checking unavailable browser cache');
    const blocked = await context.newPage();
    await blocked.addInitScript(() => {
      for (const method of ['getItem', 'setItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...rest) {
          if (key.startsWith('signa.branding.')) throw new DOMException('Blocked', 'SecurityError');
          return original.call(this, key, ...rest);
        };
      }
    });
    await blocked.goto(`${base}/settings/personalization`);
    await blocked.locator('[data-brand-name]').filter({ hasText: currentBrand.account_name }).first().waitFor();
    assert.equal(await blocked.getByLabel('Primary color', { exact: true }).inputValue(), currentBrand.primary_color);
    await blocked.close();

    console.log('Checking public-route isolation and logout');
    const reads = apiReads;
    await page.goto(`${base}/d/nonexistent-fixture`);
    assert.equal(await page.locator('#signa-branding-bootstrap').count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim()), '');
    assert.equal(apiReads, reads);
    await page.goto(`${base}/settings/personalization`);
    await page.locator('[data-brand-name]').first().waitFor();
    await page.getByRole('button', { name: 'Open user menu' }).click();
    await page.getByRole('menuitem', { name: /sign out|log out/i }).click();
    await page.waitForURL('**/auth/login');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
    assert.deepEqual(errors, []);
    console.log('First-paint branding checks passed.');
  } finally { apiGate?.release(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
