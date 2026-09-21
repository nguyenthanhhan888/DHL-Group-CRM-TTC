const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const kioskDetail = read('src/pages/KioskDetailPage.js');
const reports = read('src/pages/ReportsPage.js');
const css = read('src/styles/app.css');

test('Kiosk detail exposes one labelled action menu and keeps the existing handlers', () => {
  const header = kioskDetail.match(/header\.innerHTML = `[\s\S]*?`;\n\n  content\.innerHTML/)?.[0] || '';
  assert.match(header, /href="#\/kiosks"[\s\S]*Danh sách Kiosk/);
  const menu = kioskDetail.match(/function renderStatusActions[\s\S]*?function bindEventListeners/)?.[0] || '';
  assert.match(menu, /kiosk-detail-action-trigger[\s\S]*Thao tác/);
  assert.match(menu, /id="edit-kiosk-detail-button"[\s\S]*Sửa thông tin/);
  assert.match(menu, /id="renew-kiosk-detail-button"[\s\S]*Gia hạn/);
  assert.match(kioskDetail, /openKioskEditForm\(/);
  assert.match(kioskDetail, /openRenewKioskForm\(/);
});

test('Kiosk suspension is destructive, lives in overflow and requires modal confirmation', () => {
  const statusActions = kioskDetail.match(/function renderStatusActions[\s\S]*?function bindEventListeners/)?.[0] || '';
  assert.match(statusActions, /kiosk-detail-action-menu/);
  assert.match(statusActions, /kiosk-suspend-button[\s\S]*Tạm ngưng Kiosk/);
  assert.match(statusActions, /is-danger/);
  assert.match(kioskDetail, /function openSuspendConfirmation\(\)[\s\S]*data-kiosk-suspend-confirm/);
  assert.match(kioskDetail, /data-kiosk-suspend-confirm[\s\S]*updateKioskStatus\('suspended'/);
  assert.doesNotMatch(kioskDetail, /\bconfirm\(/);
  assert.match(kioskDetail, /KioskService\.update\(currentKiosk\.id, \{ status: newStatus \}, reason\)/);
});

test('Revenue summary includes expense-backed operational KPIs without changing its revenue source', () => {
  const revenue = reports.match(/function renderRevenue[\s\S]*?function renderKiosks/)?.[0] || '';
  const cards = revenue.match(/renderSummaryCards\(\[([\s\S]*?)\], 'report-revenue-stats'\)/)?.[1] || '';
  assert.equal((cards.match(/\bcard\(/g) || []).length, 4);
  assert.match(cards, /currentYearRevenue[\s\S]*Doanh thu năm/);
  assert.match(cards, /currentMonthRevenue[\s\S]*Doanh thu tháng/);
  assert.match(cards, /currentYearExpense[\s\S]*Chi tiêu năm/);
  assert.match(cards, /currentYearProfit[\s\S]*Lợi nhuận ước tính năm/);
  assert.doesNotMatch(cards, /averagePayment|highestPayment|lowestPayment/);
  assert.match(revenue, /Chi tiết thanh toán hoàn thành/);
});

test('Admin UX remains usable on narrow screens and money values do not wrap', () => {
  assert.match(css, /\.report-money\{[^}]*white-space:nowrap/);
  assert.match(css, /\.report-revenue-stats\{display:grid;grid-template-columns:repeat\(2/);
  assert.match(css, /@media\(max-width:640px\)[^{]*\{\.kiosk-detail-heading-row/);
  assert.match(css, /@media\(max-width:640px\)\{\.report-revenue-stats\{grid-template-columns:1fr/);
});
