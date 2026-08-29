import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const kioskPage = fs.readFileSync(new URL('../src/pages/KiosksPage.js', import.meta.url), 'utf8');
const logPage = fs.readFileSync(new URL('../src/pages/LogsPage.js', import.meta.url), 'utf8');
const logService = fs.readFileSync(new URL('../src/services/AuditLogService.js', import.meta.url), 'utf8');
const logFormatter = fs.readFileSync(new URL('../src/utils/auditLogPresentation.js', import.meta.url), 'utf8');

test('Kiosk cards use the shared badge with a compact card-specific visual rule', () => {
  assert.match(kioskPage, /StatusBadge\(status\)/);
  assert.match(css, /\.kiosk-card > \.kiosk-card-header > \.status-badge\s*\{[^}]*padding:3px 7px[^}]*font-size:11px[^}]*font-weight:600[^}]*line-height:1\.15/s);
  assert.match(css, /\.kiosk-card > \.kiosk-card-header > \.status-badge \.status-dot\s*\{[^}]*width:5px[^}]*height:5px/s);
  assert.doesNotMatch(css, /(?<!public-kiosk-card )\.kiosk-card-header span\s*\{[^}]*font-size:19px/);
});

test('log names are batch-resolved and raw technical data remains expandable', () => {
  assert.match(logService, /Promise\.all\(\[/);
  assert.match(logService, /\.in\(idColumn, ids\)/);
  assert.doesNotMatch(logService, /for\s*\([^)]*\)\s*\{[^}]*await\s+runQuery/s);
  assert.match(logFormatter, /resolved_entity/);
  assert.match(logFormatter, /fallbackEntity\(resolved\.kind/);
  assert.match(logPage, /<details class="log-technical-details">/);
  assert.match(logPage, /renderRawJson\(log\.before, log\.after\)/);
});
