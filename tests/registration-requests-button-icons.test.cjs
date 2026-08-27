const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src/styles/app.css'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/RegistrationRequestsPage.js'), 'utf8');

test('shared button SVG normalization keeps rendered icons compact and unfilled', () => {
  assert.match(css, /:where\([^{}]*\.btn-secondary[^{}]*\.btn-danger[^{}]*\)>svg\s*\{[^}]*width:18px;[^}]*height:18px;[^}]*fill:none;[^}]*stroke:currentColor;/);
  assert.match(page, /id="request-reload"[^>]*btn-secondary[^>]*>[\s\S]*renderIcon\('refresh'\)/);
  assert.match(page, /class="btn-danger"[^>]*data-operation-confirm>[\s\S]*renderIcon\('x-circle'\)/);
});

test('Registration Requests toolbar and destructive modal actions align icon and label', () => {
  assert.match(css, /\.request-toolbar \.btn-secondary\{[^}]*display:inline-flex;[^}]*align-items:center;[^}]*justify-content:center;[^}]*gap:8px;[^}]*height:var\(--form-control-height\);/);
  assert.match(css, /\.registration-operation-modal \.modal-actions \.btn-danger\{[^}]*display:inline-flex;[^}]*align-items:center;[^}]*justify-content:center;[^}]*gap:8px;?/);
  assert.match(css, /@media\(max-width:720px\)\{\.request-toolbar\{display:grid;grid-template-columns:1fr\}\.request-toolbar>\*\{width:100%\}/);
});
