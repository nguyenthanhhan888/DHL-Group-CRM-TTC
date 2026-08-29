const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const reports = read('src/pages/ReportsPage.js');
const css = read('src/styles/app.css');

const primaryIds = ['report-start-date', 'report-end-date', 'report-search'];
const advancedIds = [
  'report-customer-filter',
  'report-kiosk-filter',
  'report-category-filter',
  'report-business-type-filter',
  'report-payment-status-filter',
  'report-kiosk-status-filter',
  'report-sort-filter',
  'report-sort-direction',
  'report-page-size',
];

test('Reports renders three primary filters and nine advanced filters without losing fields', async () => {
  const { ReportsPage } = await import(pathToFileURL(path.join(root, 'src/pages/ReportsPage.js')).href);
  const markup = ReportsPage();
  const primary = markup.match(/class="report-filter-primary">([\s\S]*?)<\/div>\s*<details/)?.[1] || '';
  const advanced = markup.match(/class="report-filter-advanced-grid">([\s\S]*?)<\/div>\s*<\/details>/)?.[1] || '';

  for (const id of primaryIds) assert.match(primary, new RegExp(`id="${id}"`));
  for (const id of advancedIds) assert.match(advanced, new RegExp(`id="${id}"`));
  for (const id of [...primaryIds, ...advancedIds]) {
    assert.equal((markup.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  assert.match(markup, /<details class="report-advanced-filters"/);
  assert.match(markup, /Bộ lọc nâng cao/);
  assert.match(markup, /Tìm khách hàng, Kiosk, trạng thái hoặc số tiền/);
});

test('existing filter state, refresh, export, and tab behavior remain bound', () => {
  for (const [id, key] of [
    ['report-start-date', 'startDate'],
    ['report-end-date', 'endDate'],
    ['report-customer-filter', 'customerId'],
    ['report-kiosk-filter', 'kioskId'],
    ['report-payment-status-filter', 'paymentStatus'],
    ['report-kiosk-status-filter', 'kioskStatus'],
  ]) assert.match(reports, new RegExp(`bindFilter\\('${id}', '${key}'\\)`));

  assert.match(reports, /report-refresh-button'[\s\S]*addEventListener\('click', loadReportData\)/);
  assert.match(reports, /report-export-button'[\s\S]*addEventListener\('click', exportCurrentPage\)/);
  assert.match(reports, /report-search'[\s\S]*state\.searchTerm = event\.target\.value/);
  assert.match(reports, /ReportService\.getReportData\(state\.activeTab, state\.filters/);
  assert.match(reports, /querySelectorAll\('\[data-report-tab\]'\)/);
  assert.doesNotMatch(reports, /report-(?:apply|reset)-button/);
});

test('advanced filters auto-open from existing frontend state only', () => {
  assert.match(reports, /hasActiveAdvancedFilters\(\) \? 'open' : ''/);
  for (const key of ['customerId', 'kioskId', 'categoryId', 'businessTypeId', 'paymentStatus', 'kioskStatus']) {
    assert.match(reports, new RegExp(`state\\.filters\\.${key}`));
  }
  assert.match(reports, /state\.sortBy/);
  assert.match(reports, /state\.sortDirection !== 'desc'/);
  assert.match(reports, /state\.pageSize !== 50/);
});

test('all report tabs and current-page CSV export remain present', () => {
  for (const label of ['Tổng quan', 'Doanh thu', 'Kiosk', 'Khách hàng', 'Đối soát', 'Danh mục / Loại hình']) {
    assert.match(reports, new RegExp(label.replace('/', '\\/')));
  }
  assert.match(reports, /Xuất CSV \(trang hiện tại\)/);
  assert.match(reports, /data-report-tab=/);
});

test('Reports filters use responsive non-overflowing grids and compact controls', () => {
  assert.match(css, /\.report-filter-primary\{display:grid;grid-template-columns:/);
  assert.match(css, /\.report-filter-advanced-grid\{[\s\S]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
  assert.match(css, /\.report-filter-panel \.filter-field\{[\s\S]*min-width:0/);
  assert.match(css, /height:42px/);
  assert.match(css, /@media\(max-width:1100px\)[\s\S]*report-filter-primary[\s\S]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*report-filter-primary,[\s\S]*grid-template-columns:1fr/);
});
