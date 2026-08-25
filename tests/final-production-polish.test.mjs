import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/styles/app.css');
const page = read('src/pages/LogsPage.js');
const service = read('src/services/AuditLogService.js');
const migration = read('supabase/migrations/20260825120000_business_visible_audit_pagination.sql');

test('Kiosk status is a compact fixed top-right grid item independent of title wrapping', () => {
  assert.match(css, /\.kiosk-card-header\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto[^}]*align-items:start/s);
  assert.match(css, /\.kiosk-card-header>div\s*\{[^}]*min-width:0/s);
  assert.match(css, /\.kiosk-card > \.kiosk-card-header > \.status-badge\s*\{[^}]*align-self:start[^}]*flex-shrink:0[^}]*font-size:11px/s);
});

test('business visibility is applied before count, bounds, offset and limit', () => {
  assert.match(migration, /filtered as materialized[\s\S]*show_technical or r\.action = any/);
  assert.match(migration, /stats as \([\s\S]*count\(\*\)[\s\S]*from filtered/);
  assert.match(migration, /least\(normalized_page,[\s\S]*effective_page/);
  assert.match(migration, /from filtered f cross join bounds b[\s\S]*limit normalized_size[\s\S]*offset/);
});

test('technical mode and every filter are RPC inputs and page changes are clamped safely', () => {
  assert.match(service, /show_technical: Boolean\(showTechnical\)/);
  assert.match(page, /state\.showTechnical = event\.target\.checked;\s*state\.page = 1;\s*loadLogs\(\)/s);
  assert.match(page, /const lastPage = Math\.max\(1, Math\.ceil\(state\.total \/ state\.pageSize\)\)/);
  assert.deepEqual([...service.matchAll(/new Set\(\[([^\]]+)\]\)/g)][0][1].match(/\d+/g).map(Number), [10, 20, 50]);
});

test('entity enrichment stays batched and technical details remain available', () => {
  assert.match(service, /Promise\.all\(\[/);
  assert.match(service, /\.in\('id', ids\)/);
  assert.doesNotMatch(service, /for\s*\([^)]*\)\s*\{[^}]*await\s+runQuery/s);
  assert.match(page, /<details class="log-technical-details">/);
  assert.match(page, /resolved_entity\?\.missing/);
});

test('desktop hierarchy and mobile activity cards avoid technical IDs in primary markup', () => {
  assert.match(css, /\.logs-table th:nth-child\(2\) \{ width:29%; \}/);
  assert.match(css, /\.logs-table th,.logs-table td \{ vertical-align:top; \}/);
  assert.match(page, /class="log-mobile-card"/);
  assert.match(page, /class="log-mobile-card-head"/);
  assert.doesNotMatch(page.match(/mobileList\.innerHTML[\s\S]*?\.join\(''\);/)[0], /record_id|resolved_entity\.id/);
});
