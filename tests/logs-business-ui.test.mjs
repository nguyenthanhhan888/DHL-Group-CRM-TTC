import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../src/pages/LogsPage.js', import.meta.url), 'utf8');
const columns = fs.readFileSync(new URL('../src/constants/tables.js', import.meta.url), 'utf8');

test('business log mode is off by default and technical hints only render when explicitly enabled', () => {
  assert.match(page, /showTechnical:\s*false/);
  assert.match(page, /id="log-show-technical"[^>]*type="checkbox"/);
  assert.match(page, /state\.showTechnical\s*\?\s*await AuditLogService\.list/);
  assert.match(page, /BusinessEventService\.list/);
  assert.match(page, /showTechnical:\s*true/);
});

test('four-column activity UI keeps business summary before collapsed raw technical data', () => {
  for (const label of ['Nội dung hoạt động', 'Người thực hiện', 'Thời gian', 'Chi tiết']) assert.match(columns, new RegExp(label));
  assert.doesNotMatch(columns, /Đối tượng|Thay đổi chính/);
  const modal = page.match(/function renderLogModal[\s\S]*?function renderBusinessChanges/)?.[0] || '';
  assert.ok(modal.indexOf('log-detail-summary') < modal.indexOf('log-technical-details'));
  assert.ok(modal.indexOf('Nội dung thay đổi') < modal.indexOf('Thông tin kỹ thuật'));
  assert.match(modal, /<details class="log-technical-details"><summary>Thông tin kỹ thuật<\/summary>/);
  assert.match(modal, /renderRawJson\(log\.before, log\.after\)/);
});
