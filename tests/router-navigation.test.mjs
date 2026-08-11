import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('hash router renders every hash change and stops cleanly', async () => {
  const originalWindow = globalThis.window;
  const browser = new EventTarget();
  browser.location = { hash: '#/dashboard' };
  globalThis.window = browser;

  try {
    const { createRouter } = await import(`../src/router/index.js?test=${Date.now()}`);
    const outlet = { innerHTML: '' };
    const rendered = [];
    const page = (name) => Object.assign(() => `<main>${name}</main>`, {
      afterRender: () => rendered.push(name),
    });
    const router = createRouter({
      outlet,
      routes: {
        dashboard: page('dashboard'),
        customers: page('customers'),
        ttc: page('ttc'),
      },
      defaultRoute: 'dashboard',
      canAccess: () => true,
    });

    router.start();
    assert.match(outlet.innerHTML, /dashboard/);

    browser.location.hash = '#/customers';
    browser.dispatchEvent(new Event('hashchange'));
    assert.match(outlet.innerHTML, /customers/);

    browser.location.hash = '#/ttc';
    browser.dispatchEvent(new Event('hashchange'));
    assert.match(outlet.innerHTML, /ttc/);

    // Simulated browser Back and Forward each emit hashchange.
    browser.location.hash = '#/customers';
    browser.dispatchEvent(new Event('hashchange'));
    assert.match(outlet.innerHTML, /customers/);
    browser.location.hash = '#/ttc';
    browser.dispatchEvent(new Event('hashchange'));
    assert.match(outlet.innerHTML, /ttc/);

    router.stop();
    browser.location.hash = '#/dashboard';
    browser.dispatchEvent(new Event('hashchange'));
    assert.match(outlet.innerHTML, /ttc/);
    assert.deepEqual(rendered, ['dashboard', 'customers', 'ttc', 'customers', 'ttc']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('application owns one root hash lifecycle and does not force reload navigation', async () => {
  const source = await fs.readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.equal((source.match(/window\.addEventListener\('hashchange'/g) || []).length, 1);
  assert.doesNotMatch(source, /window\.location\.reload\(\)/);
  assert.match(source, /activeRouter\?\.stop/);
  assert.match(source, /PUBLIC_REGISTRATION_ROUTES\.has\(route\)/);
  for (const route of ['dashboard', 'customers', 'ttc', 'register', 'legacy-registration']) {
    assert.match(source, new RegExp(`['\"]${route}['\"]|\\b${route}:`));
  }
});
