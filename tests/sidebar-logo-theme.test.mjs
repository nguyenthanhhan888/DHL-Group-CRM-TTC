import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AppLayout } from '../src/layouts/AppLayout.js';
import { PublicLogo } from '../src/components/PublicLogo.js';
import { getThemeLogoPath, syncThemeLogos } from '../src/utils/themeLogo.js';

const LIGHT_LOGO = '/images/logo-sidebar/logo-sidebar-light.png';
const DARK_LOGO = '/images/logo-sidebar/logo-sidebar-dark.png';

test('sidebar and shared header logo use root-relative light and dark assets', () => {
  assert.equal(getThemeLogoPath('light'), LIGHT_LOGO);
  assert.equal(getThemeLogoPath('dark'), DARK_LOGO);

  const markup = AppLayout({ navSections: [], user: {} });
  assert.match(markup, new RegExp(`src="${LIGHT_LOGO}"`));
  assert.match(markup, new RegExp(`data-logo-light="${LIGHT_LOGO}"`));
  assert.match(markup, new RegExp(`data-logo-dark="${DARK_LOGO}"`));
  assert.equal((markup.match(/data-theme-logo/g) || []).length, 2);
  assert.match(markup, /width="2172" height="724"/);

  const publicLogo = PublicLogo();
  assert.match(publicLogo, new RegExp(`data-logo-light="${LIGHT_LOGO}"`));
  assert.match(publicLogo, new RegExp(`data-logo-dark="${DARK_LOGO}"`));
  assert.match(publicLogo, /width="2172" height="724"/);
});

test('public, sidebar and mobile header logos have separate responsive sizing without distortion', async () => {
  const css = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../src/layouts/AppLayout.js', import.meta.url), 'utf8');
  const publicLayout = await readFile(new URL('../src/components/PublicLayout.js', import.meta.url), 'utf8');

  assert.match(publicLayout, /PublicLogo\(\{ className: 'public-header-logo' \}\)/);
  assert.match(css, /\.portal-brand \.public-header-logo\{[^}]*width:auto[^}]*height:44px[^}]*object-fit:contain/);
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.portal-brand \.public-header-logo\{height:40px/);
  assert.match(css, /@media\(max-width:640px\)\{[\s\S]*?\.portal-brand \.public-header-logo\{height:36px/);
  assert.match(css, /\.sidebar-brand-image\{[^}]*width:auto[^}]*height:44px[^}]*object-fit:contain/);
  assert.match(css, /\.sidebar-brand-image-wrap\{width:134px;height:46px;flex:0 0 134px\}/);
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.sidebar-brand-image-wrap\{width:122px;height:42px;flex-basis:122px\}/);
  assert.match(css, /@media\(max-width:640px\)\{[\s\S]*?\.sidebar-brand-image-wrap\{width:110px;height:40px;flex-basis:110px\}/);
  assert.match(css, /\.top-brand-mark\{width:auto;height:36px;max-width:none;flex:none/);
  assert.match(css, /\.top-bar-user-actions>\.connection-badge,\.top-bar-user-actions>\.current-date\{display:none\}/);
  assert.match(css, /\.top-wallet-pill\{width:34px;min-width:34px;max-width:34px;padding:0\}/);
  assert.doesNotMatch(css, /\.portal-brand img/);
  assert.doesNotMatch(css.slice(css.lastIndexOf('Context-specific responsive brand sizing')), /object-fit:cover/);
  assert.match(layout, /class="sidebar-brand-image"/);
  assert.match(layout, /class="top-brand-mark"/);
});

test('stylesheet cache key changes with the corrected logo layout', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /app\.css\?v=20260830-logo-layout/);
});

test('theme switching updates mounted logos immediately without re-render or reload', () => {
  const image = fakeImage(LIGHT_LOGO);
  const root = { querySelectorAll: () => [image] };

  syncThemeLogos('dark', root);
  assert.equal(image.getAttribute('src'), DARK_LOGO);
  syncThemeLogos('light', root);
  assert.equal(image.getAttribute('src'), LIGHT_LOGO);
});

test('active source contains no deleted or route-relative sidebar logo reference', async () => {
  const files = [
    'src/config/organization.js',
    'src/layouts/AppLayout.js',
    'src/components/PublicLogo.js',
    'src/components/PublicLayout.js',
    'src/app.js',
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');

  assert.doesNotMatch(source, /logo\/dhl-group-(?:logo|transparent)/);
  assert.doesNotMatch(source, /images\/avatars\/logo-sidebar/);
  assert.doesNotMatch(source, /(?:\.\.\/|\.\/)images\/logo-sidebar/);
});

function fakeImage(src) {
  const attributes = new Map([['src', src]]);
  return {
    dataset: { logoLight: LIGHT_LOGO, logoDark: DARK_LOGO },
    getAttribute(name) { return attributes.get(name) || null; },
    setAttribute(name, value) { attributes.set(name, value); },
  };
}
