import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const read = (relPath) => readFile(path.join(root, relPath), 'utf8');

describe('Phase UI-1 — Global Theme & Design System Foundation', () => {
  it('defines the required semantic tokens in dark and light themes', async () => {
    const css = await read('src/styles/app.css');

    const requiredTokens = [
      // Background / Surface
      '--bg-page', '--bg-surface', '--bg-elevated', '--bg-soft', '--bg-muted',
      '--bg-card', '--bg-control', '--bg-hover', '--bg-active', '--bg-header',
      '--bg-sidebar', '--bg-overlay',

      // Text
      '--text-primary', '--text-secondary', '--text-muted', '--text-disabled',
      '--text-on-accent', '--text-inverse', '--text-link',

      // Border
      '--border-default', '--border-soft', '--border-strong', '--border-interactive', '--border-focus',

      // Brand
      '--primary', '--primary-hover', '--primary-active', '--primary-soft', '--primary-text',

      // Status
      '--success', '--success-bg', '--success-border', '--success-text',
      '--warning', '--warning-bg', '--warning-border', '--warning-text',
      '--danger', '--danger-bg', '--danger-border', '--danger-text',
      '--info', '--info-bg', '--info-border', '--info-text',
      '--neutral', '--neutral-bg', '--neutral-border', '--neutral-text',

      // Table & Form
      '--table-header-bg', '--table-row-hover', '--table-row-selected', '--table-border',
      '--input-bg', '--input-border', '--input-border-hover', '--input-border-focus',
      '--input-placeholder', '--input-disabled-bg',
      '--form-control-height', '--form-control-radius', '--form-section-gap',

      // Elevation & Shadows
      '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-surface', '--shadow-card', '--shadow-focus',

      // Semantic Tones
      '--tone-blue-bg', '--tone-purple-bg', '--tone-orange-bg',
      '--tone-red-bg', '--tone-green-bg', '--tone-teal-bg',
      '--tone-blue-text', '--tone-purple-text', '--tone-orange-text',
      '--tone-red-text', '--tone-green-text', '--tone-teal-text',
    ];

    for (const token of requiredTokens) {
      assert.ok(css.includes(token), `Missing token declaration: ${token}`);
    }
  });

  it('maintains strict token parity between Dark and Light theme blocks', async () => {
    const css = await read('src/styles/app.css');

    // Extract dark block
    const darkMatch = css.match(/(?::root,\s*html\[data-theme="dark"\]|html\[data-theme="dark"\])\s*\{([^}]+)\}/s);
    assert.ok(darkMatch, 'Dark theme block not found');
    const darkTokens = new Set([...darkMatch[1].matchAll(/--[a-z0-9-]+(?=:)/g)].map(m => m[0]));

    // Extract light block
    const lightMatch = css.match(/html\[data-theme="light"\]\s*\{([^}]+)\}/s);
    assert.ok(lightMatch, 'Light theme block not found');
    const lightTokens = new Set([...lightMatch[1].matchAll(/--[a-z0-9-]+(?=:)/g)].map(m => m[0]));

    // Verify key parity
    const missingInLight = [...darkTokens].filter(t => !lightTokens.has(t));
    const missingInDark = [...lightTokens].filter(t => !darkTokens.has(t));

    assert.deepEqual(missingInLight, [], `Tokens defined in Dark but missing in Light: ${missingInLight.join(', ')}`);
    assert.deepEqual(missingInDark, [], `Tokens defined in Light but missing in Dark: ${missingInDark.join(', ')}`);
  });

  it('keeps exactly one html[data-theme="light"] token block and avoids stacked override passes', async () => {
    const css = await read('src/styles/app.css');
    const lightMatches = (css.match(/html\[data-theme="light"\]/g) || []);
    assert.equal(lightMatches.length, 1, 'html[data-theme="light"] should appear exactly once in app.css');
    assert.doesNotMatch(css, /Final light-theme pass|late component blocks from falling back/i);
  });

  it('provides complete button variants consuming semantic tokens', async () => {
    const css = await read('src/styles/app.css');
    assert.match(css, /\.btn-primary\s*\{[^}]*background:\s*var\(--primary\)/);
    assert.match(css, /\.btn-secondary[^}]*background:\s*var\(--primary-soft\)/);
    assert.match(css, /\.btn-outline\s*\{[^}]*border:\s*1px solid var\(--border-default\)/);
    assert.match(css, /\.btn-ghost\s*\{[^}]*background:\s*transparent/);
    assert.match(css, /\.btn-danger\s*\{[^}]*background:\s*var\(--danger\)/);
    assert.match(css, /\.btn-secondary:hover/);
    assert.match(css, /\.btn-secondary:active/);
  });

  it('provides complete status badge and chip variants with WCAG tokens', async () => {
    const css = await read('src/styles/app.css');
    for (const status of ['success', 'warning', 'danger', 'info', 'neutral']) {
      assert.match(css, new RegExp(`\\.status-pill\\.${status}[^}]*color:\\s*var\\(--${status}-text\\)`));
      assert.match(css, new RegExp(`\\.status-pill\\.${status}[^}]*background:\\s*var\\(--${status}-bg\\)`));
      assert.match(css, new RegExp(`\\.status-pill\\.${status}[^}]*border-color:\\s*var\\(--${status}-border\\)`));
    }
    assert.match(css, /\.status-dot/);
  });

  it('provides table hover and selected states consuming semantic tokens', async () => {
    const css = await read('src/styles/app.css');
    assert.match(css, /\.data-table tbody tr:hover\s*\{\s*background:\s*var\(--table-row-hover\);?\s*\}/);
    assert.match(css, /\.data-table tbody tr\.is-selected\s*\{\s*background:\s*var\(--table-row-selected\);?\s*\}/);
  });

  it('provides main content icon foundation with semantic families', async () => {
    const css = await read('src/styles/app.css');
    assert.match(css, /\.icon-badge,\s*\.semantic-icon-box/);
    assert.match(css, /\.icon-badge--sm/);
    assert.match(css, /\.icon-badge--lg/);
    assert.match(css, /\.icon-badge--customer/);
    assert.match(css, /\.icon-badge--kiosk/);
    assert.match(css, /\.icon-badge--revenue/);
    assert.match(css, /\.icon-badge--payment/);
    assert.match(css, /\.icon-badge--warning/);
    assert.match(css, /\.icon-badge--danger/);
  });

  it('maintains low !important usage in stylesheet', async () => {
    const css = await read('src/styles/app.css');
    const importantCount = (css.match(/!important/g) || []).length;
    assert.ok(importantCount <= 1, `Expected at most 1 !important declaration, found ${importantCount}`);
  });

  it('dispatches dhl:themechange on PublicLayout theme toggle', async () => {
    const publicLayout = await read('src/components/PublicLayout.js');
    assert.match(publicLayout, /dispatchEvent\(new CustomEvent\('dhl:themechange'/);
  });
});
