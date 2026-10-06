/* Run against a local frontend: node scripts/check-branding-browser.cjs.
   All API requests are mocked; no accounts or external emails are changed. */
const { chromium } = require('../apps/backend/node_modules/playwright');
const sharp = require('../apps/backend/node_modules/sharp');
const assert = require('node:assert/strict');
const base = process.env.BRANDING_TEST_URL || 'http://localhost:3000';
const screenshotDirectory = process.env.BRANDING_SCREENSHOT_DIR || '/tmp';

async function checkControlContrast(page, dark) {
  await page.waitForFunction((dark) => {
    const style = getComputedStyle(document.querySelector('#brand-color'));
    return style.backgroundColor === (dark ? 'rgb(27, 30, 37)' : 'rgb(255, 255, 255)') && style.color === (dark ? 'rgb(250, 250, 250)' : 'rgb(23, 23, 23)');
  }, dark).catch(async (error) => { console.error('Input colors', await page.locator('#brand-color').evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, dark: document.documentElement.className }))); throw error; });
  const ratios = await page.locator('#brand-color').evaluate((input) => {
    const style = getComputedStyle(input);
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    return { text: contrast(style.color, style.backgroundColor), border: contrast(style.borderTopColor, style.backgroundColor) };
  });
  assert.ok(ratios.text >= 4.5, `Rendered input text contrast ${ratios.text}`);
  assert.ok(ratios.border >= 3, `Rendered input border contrast ${ratios.border}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => console.error('Request failed', request.url(), request.failure()));
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g"><stop stop-color="#c8e600"/><stop offset="1" stop-color="#00da97"/></linearGradient></defs><circle cx="32" cy="32" r="25" fill="none" stroke="url(#g)" stroke-width="5"/></svg>')).png().toBuffer();
    let branding = { account_name: 'Acme Organization', primary_color: null, white_label: false, logo: null };
    const publicBrand = { account_name: 'Other Organization', primary_color: '#8b00ff', white_label: true, logo: null };
    const session = { access_token: 'test-token', user: { id: '7', role: 'admin', first_name: 'Ada', email: 'ada@example.test' }, account: { id: '17', name: branding.account_name, locale: 'en', timezone: 'UTC' } };
    await page.addInitScript((value) => {
      // Keep mock API traffic same-origin even when dev uses a separate backend.
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.origin);
        return fetch(url.pathname.startsWith('/api/') ? `${location.origin}${url.pathname}${url.search}` : input, init);
      };
      if (!sessionStorage.getItem('branding-fixture')) { localStorage.setItem('signa.auth', JSON.stringify(value)); sessionStorage.setItem('branding-fixture', 'true'); }
    }, session);
    let brandingReads = 0;
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (process.env.DEBUG_BRANDING) console.log(route.request().method(), pathname);
      const send = (json) => route.fulfill({ json });
      if (pathname === '/api/account/branding') {
        if (route.request().method() === 'PATCH') branding = { ...branding, ...route.request().postDataJSON() };
        else brandingReads++;
        return send(branding);
      }
      if (pathname === '/api/account/logo') {
        branding.logo = route.request().method() === 'DELETE' ? null : { url: `${base}/api/test-logo`, background: '#171717' };
        return send(branding.logo);
      }
      if (pathname === '/api/test-logo') return route.fulfill({ contentType: 'image/png', body: logo });
      if (pathname === '/api/account') {
        if (route.request().method() === 'PATCH') {
          Object.assign(session.account, route.request().postDataJSON());
          branding.account_name = session.account.name;
        }
        return send(session.account);
      }
      if (pathname === '/api/account_custom_fields') return send({ value: [] });
      if (pathname === '/api/templates/42') return send({ id: '42', name: 'Service agreement', slug: 'check', fields: [], schema: [], submitters: [], documents: [], preferences: {}, author: session.user });
      if (pathname === '/api/account/signing-certificates') return send({ data: [{ name: 'Signa Self-Host Autogenerated', subject: 'C=US, O=Signa, CN=Signa', valid_to: '2126-07-04', is_active: true }], timestamp_server_url: 'https://timestamp.example.test' });
      if (pathname === '/api/account/signing-trust-roots') return send({ data: [] });
      if (['/api/templates', '/api/templates/folders', '/api/submissions'].includes(pathname)) return send({ data: [], pagination: { count: 0, next: null, prev: null } });
      if (pathname === '/api/teams') return send([]);
      if (pathname === '/api/account/preferences') return send({ submitter_invitation_email: { subject: 'Sign', body: 'Sign here' }, submitter_completed_email: { subject: 'Done', body: 'Done' }, submitter_documents_copy_email: { subject: 'Copy', body: 'Copy' }, form_completed_message: {}, form_completed_button: {}, form_with_confetti: false });
      if (pathname.startsWith('/api/start-form/')) return send({ branding: publicBrand, account_name: publicBrand.account_name, template_name: 'Service agreement', shared_link: true, link_form_fields: ['email'], require_email_2fa: false });
      if (pathname.startsWith('/api/signing/')) return send({ branding: publicBrand, submission_id: '99', title: 'Service agreement', submitter: { id: '8', slug: 'brand-check', completed_at: '2026-10-05T00:00:00Z' }, documents: [], fields: [], values: {}, readonly_values: {}, attachments: [], configs: { completed_message: {}, completed_button: {}, with_confetti: false } });
      return send({});
    });
    await page.goto(`${base}/settings/personalization`);
    const color = page.getByLabel('Primary color', { exact: true });
    await color.waitFor().catch(async (error) => { console.error('Page:', page.url(), await page.locator('body').innerText(), errors); throw error; });
    await color.fill('#ffff00');
    await page.getByRole('switch', { name: 'White-label experience' }).click();
    await page.getByRole('button', { name: 'Save branding', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim() === '#ffff00');
    assert.equal(await page.title(), branding.account_name);
    await page.reload();
    await color.waitFor();
    assert.equal(await color.inputValue(), '#ffff00');
    await color.fill('invalid');
    assert.equal(await page.getByRole('button', { name: 'Save branding', exact: true }).isDisabled(), true);
    await color.fill('#ffff00');
    await page.getByLabel('Account logo file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
    await page.getByRole('button', { name: 'Replace logo' }).waitFor();
    assert.ok(await page.locator('[data-brand-logo] img').count() >= 3);
    assert.ok(await page.locator('[data-brand-name]').filter({ hasText: branding.account_name }).count() >= 3);
    const uploadedImage = page.locator('[data-brand-logo] img').first();
    await uploadedImage.evaluate((image) => image.decode());
    assert.equal(await uploadedImage.evaluate((image) => getComputedStyle(image).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.getByRole('switch', { name: 'Show business title' }).click();
    await page.getByRole('button', { name: 'Save branding', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-brand-name]'));
    await page.reload();
    await color.waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Show business title' }).getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('[data-brand-name]').count(), 0);
    await page.getByRole('switch', { name: 'Show business title' }).click();
    await page.getByRole('button', { name: 'Save branding', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-brand-name]').length >= 3);
    await checkControlContrast(page, false);
    await page.screenshot({ path: `${screenshotDirectory}/signa-branding-light.png`, fullPage: true, animations: 'disabled' });
    await page.evaluate(() => { localStorage.setItem('signa.theme', 'dark'); window.dispatchEvent(new Event('signa.theme.changed')); });
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await checkControlContrast(page, true);
    await color.focus();
    const outline = await color.evaluate((element) => getComputedStyle(element).outlineStyle);
    assert.equal(outline, 'solid');
    await page.screenshot({ path: `${screenshotDirectory}/signa-branding-dark.png`, fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${screenshotDirectory}/signa-branding-mobile.png`, fullPage: true, animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No mobile horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1100 });
    console.log('Checking account rename');
    await page.goto(`${base}/settings/account`);
    await page.waitForFunction(name => document.querySelector('#company-name')?.value === name, session.account.name);
    await page.locator('[data-brand-name]').first().waitFor();
    await page.locator('#company-name').fill('Updated Organization');
    await page.locator('form').filter({ has: page.locator('#company-name') }).getByRole('button', { name: /^update$/i }).click();
    await page.locator('[data-brand-name]').filter({ hasText: 'Updated Organization' }).waitFor();
    assert.equal(await page.title(), 'Updated Organization');
    console.log('Checking editor header');
    await page.goto(`${base}/templates/42/edit`);
    const back = page.getByRole('link', { name: 'Back to templates' });
    await back.waitFor().catch(async (error) => { console.error('Editor:', await page.locator('body').innerText(), errors); throw error; });
    await page.locator('[data-brand-name]').waitFor();
    const backBox = await back.boundingBox();
    const brandBox = await page.locator('[data-brand-logo]').boundingBox();
    assert.ok(backBox.x + backBox.width <= brandBox.x, 'Back button must not overlap branding');
    await back.hover();
    await page.screenshot({ path: `${screenshotDirectory}/signa-review-editor.png`, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBack = await back.boundingBox();
    assert.ok(mobileBack.width >= 40);
    assert.equal(await page.locator('header').evaluate(e => e.scrollWidth <= e.clientWidth), true, 'Editor toolbar must fit mobile');
    await page.screenshot({ path: `${screenshotDirectory}/signa-review-editor-mobile.png`, animations: 'disabled' });
    await back.click();
    await page.waitForURL('**/templates');
    // Review neighboring pages with the user's mint color, including a long org name.
    branding = { ...branding, primary_color: '#00da97', account_name: 'Acme Organization', white_label: false };
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const dark of [false, true]) {
      for (const [path, label] of [['/settings/personalization', 'personalization'], ['/settings/e-signature', 'e-signature'], ['/settings/account', 'account'], ['/templates', 'templates'], ['/templates?view=submissions', 'submissions']]) {
        console.log('Reviewing', path, dark ? 'dark' : 'light');
        await page.goto(`${base}${path}`);
        await page.locator('[data-brand-name]').first().waitFor();
        await page.evaluate((dark) => { localStorage.setItem('signa.theme', dark ? 'dark' : 'light'); window.dispatchEvent(new Event('signa.theme.changed')); }, dark);
        await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, dark);
        if (label === 'e-signature') await page.getByText('Signa Self-Host Autogenerated', { exact: true }).waitFor();
        if (label === 'personalization') await page.getByLabel('Primary color', { exact: true }).waitFor();
        await page.screenshot({ path: `${screenshotDirectory}/signa-review-${label}-${dark ? 'dark' : 'light'}.png`, fullPage: true, animations: 'disabled' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} desktop overflow`);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: `${screenshotDirectory}/signa-review-${label}-mobile-${dark ? 'dark' : 'light'}.png`, fullPage: true, animations: 'disabled' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} mobile overflow`);
        await page.setViewportSize({ width: 1440, height: 1100 });
      }
    }
    branding = { ...branding, account_name: 'An Extremely Long Organization Name For Mobile Layout Verification', white_label: true };
    await page.goto(`${base}/settings/personalization`);
    await color.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long organization name must not overflow');
    await page.getByRole('button', { name: 'Remove account logo' }).click();
    await page.getByRole('button', { name: 'Upload logo', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('button', { name: 'Save branding', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim() === '#27639d');
    assert.equal(branding.primary_color, null);
    branding = { account_name: 'Second Account', primary_color: '#00ffaa', white_label: true, logo: null };
    await page.evaluate((session) => {
      localStorage.setItem('signa.auth', JSON.stringify({ ...session, account: { ...session.account, id: '18', name: 'Second Account' } }));
      window.dispatchEvent(new Event('signa.auth.changed'));
    }, session);
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim() === '#00ffaa');
    assert.equal(await color.inputValue(), '#00ffaa');
    const previousReads = brandingReads;
    for (const path of ['/d/brand-check', '/s/brand-check', '/s/brand-check/completed']) {
      await page.goto(`${base}${path}`);
      await page.getByText(publicBrand.account_name, { exact: true }).waitFor();
      assert.equal(await page.locator('style[data-account-branding]').count(), 1);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-original').trim()), publicBrand.primary_color);
      assert.equal(await page.getByText(/Powered by/).count(), 0);
      assert.equal(await page.title(), publicBrand.account_name);
    }
    assert.equal(brandingReads, previousReads, 'Public routes do not fetch visitor account branding');
    await page.evaluate(() => { localStorage.removeItem('signa.auth'); window.dispatchEvent(new Event('signa.auth.changed')); });
    await page.goto(`${base}/auth/login`);
    assert.equal(await page.locator('style[data-account-branding]').count(), 0);
    assert.equal(await page.title(), 'Signa');
    assert.deepEqual(errors, []);
    console.log('Branding browser checks passed: save, reload, invalid input, upload/remove, light/dark, mobile, reset, account switching, public tenant isolation, white-label title/footer, logout.');
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
