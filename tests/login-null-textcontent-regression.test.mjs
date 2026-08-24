import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('route initialization does not write textContent to the removed page-title element', async () => {
  const [app, layout] = await Promise.all([
    read('src/app.js'),
    read('src/layouts/AppLayout.js'),
  ]);

  assert.doesNotMatch(layout, /data-page-title/);
  assert.match(layout, /class="top-bar-context">DHL Group</);
  assert.doesNotMatch(app, /(?:const|let)\s+pageTitle\s*=|pageTitle\.textContent/);
  assert.match(app, /document\.title\s*=\s*`\$\{PAGE_TITLES\[route\]/);
});

test('login initialization helpers guard optional DOM targets before text updates', async () => {
  const [login, publicLayout] = await Promise.all([
    read('src/pages/LoginPage.js'),
    read('src/components/PublicLayout.js'),
  ]);

  assert.match(login, /function setLoading\(button,[\s\S]*?if \(!button\) return;[\s\S]*?button\.textContent/);
  assert.match(login, /function showError\(element,[\s\S]*?if \(!element\) return;[\s\S]*?element\.textContent/);
  assert.match(publicLayout, /function updateThemeButton\(button\)[\s\S]*?if \(!button\) return;/);
  assert.match(publicLayout, /data-public-theme-toggle><span aria-hidden="true">/);
});
