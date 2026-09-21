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
  const primary = markup.split('id="report-advanced-filters"')[0];
  const advanced = markup.split('id="report-advanced-filters"')[1];

  for (const id of primaryIds) assert.match(primary, new RegExp(`id="${id}"`));
  for (const id of advancedIds) assert.match(advanced, new RegExp(`id="${id}"`));
  for (const id of [...primaryIds, ...advancedIds]) {
    assert.equal((markup.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  assert.match(markup, /id="report-advanced-filters" hidden/);
  assert.match(markup, /Nâng cao/);
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

test('advanced filters open only on explicit disclosure without dropping stored filter values', () => {
  assert.match(reports, /id="report-advanced-filters" hidden/);
  assert.match(reports, /panel.hidden = !panel.hidden/);
  assert.match(reports, /setAttribute\('aria-expanded', String\(!panel.hidden\)\)/);
  for (const key of ['customerId', 'kioskId', 'categoryId', 'businessTypeId', 'paymentStatus', 'kioskStatus']) {
    assert.ok(reports.includes(`state.filters.${key}`));
  }
});

test('all report tabs and full-filter CSV export remain present', () => {
  for (const label of ['Tổng quan', 'Doanh thu', 'Kiosk', 'Khách hàng', 'Cần kiểm tra', 'Danh mục / Loại hình']) {
    assert.match(reports, new RegExp(label.replace('/', '\\/')));
  }
  assert.match(reports, /Xuất CSV \(toàn bộ bộ lọc\)/);
  assert.match(reports, /ReportService\.exportReportData/);
  assert.match(reports, /data-report-tab=/);
});

test('Reports uses the shared responsive FilterBar, with compact dates and a wider search', () => {
  assert.match(reports, /FilterBar\(\{/);
  assert.match(reports, /filter-field filter-field-search/);
  assert.match(css, /\.admin-filter-row/);
  assert.match(css, /\.admin-filter-row > \.filter-field-date/);
  assert.match(css, /\.reports-filter-bar \.admin-filter-advanced \.filter-field/);
});
