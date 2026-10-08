import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { reportPeriod } from '../src/utils/reportPeriod.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pageSource = read('src/pages/ReportsPage.js');
const serviceSource = read('src/services/ReportService.js');
const now = new Date('2026-10-04T08:00:00Z');
const plain = value => JSON.parse(JSON.stringify(value));
const cases = [
  ['default', {}, ['2026-01-01', '2026-10-04'], 2026, '2026-10-04'],
  ['current-year month', { startDate: '2026-06-01', endDate: '2026-06-30' }, ['2026-06-01', '2026-06-30'], 2026, '2026-10-04'],
  ['historical month', { startDate: '2025-06-01', endDate: '2025-06-30' }, ['2025-06-01', '2025-06-30'], 2025, '2025-12-31'],
  ['cross-year', { startDate: '2025-11-15', endDate: '2026-02-20' }, ['2025-11-15', '2026-02-20'], 2026, '2026-10-04'],
  ['historical full year', { startDate: '2025-01-01', endDate: '2025-12-31' }, ['2025-01-01', '2025-12-31'], 2025, '2025-12-31'],
  ['explicit YTD', { startDate: '2026-01-01', endDate: '2026-10-04' }, ['2026-01-01', '2026-10-04'], 2026, '2026-10-04'],
];

function serviceHarness() {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args: plain(args || {}) });
    if (name === 'get_expense_report_summary') return { data: { totalExpense: 30 } };
    if (name !== 'get_reports_data_filtered') return { data: {} };
    const annual = args.p_start_date.endsWith('-01-01');
    const monthly = args.p_start_date === '2026-10-01';
    const totalRevenue = annual ? 1000 : monthly ? 150 : 200;
    return { data: { summary: { totalRevenue }, rows: [{ id: args.p_page, totalAmount: totalRevenue / 2 }],
      groups: { monthly: [{ totalAmount: totalRevenue }], businessTypes: [{ totalAmount: totalRevenue }] },
      pagination: { page: args.p_page, pageSize: args.p_page_size, totalRows: 2, totalPages: 2 } } };
  } };
  const box = vm.createContext({ requireSupabaseClient: () => client, runQuery: async query => query,
    reportPeriod: filters => reportPeriod(filters, now) });
  vm.runInContext(serviceSource.replace(/^import .*;\n/gm, '').replace('export const ReportService', 'const ReportService') + '\nglobalThis.service = ReportService;', box);
  return { service: box.service, calls };
}

for (const [name, filters, selected, year, annualEnd] of cases) {
  test(`Reports approved labels, periods and four-card values: ${name}`, async () => {
    const custom = name !== 'default';
    const period = reportPeriod(filters, now);
    assert.deepEqual(period.selected, { startDate: selected[0], endDate: selected[1] });
    assert.deepEqual(period.yearRange, { startDate: `${year}-01-01`, endDate: annualEnd });
    assert.deepEqual(period.labels, custom
      ? [`Doanh thu năm ${year}`, 'Doanh thu trong kỳ', 'Chi tiêu trong kỳ', 'Lợi nhuận ròng trong kỳ']
      : ['Doanh thu năm 2026', 'Doanh thu tháng 10', 'Chi tiêu năm 2026', 'Lợi nhuận ròng năm 2026']);
    const { service, calls } = serviceHarness();
    const { data } = await service.getReportData('revenue', filters);
    const selectedRevenue = selected[0].endsWith('-01-01') ? 1000 : 200;
    assert.deepEqual(plain(data.financial.values), [1000, custom ? selectedRevenue : 150, 30, selectedRevenue - 30]);
    const revenues = calls.filter(call => call.name === 'get_reports_data_filtered');
    assert.deepEqual(revenues.map(call => [call.args.p_start_date, call.args.p_end_date]), [selected,
      custom ? [`${year}-01-01`, annualEnd] : ['2026-10-01', '2026-10-04']]);
    const expense = calls.find(call => call.name === 'get_expense_report_summary');
    assert.deepEqual(expense.args, { p_start_date: selected[0], p_end_date: selected[1] });
  });
}

test('Vietnam year boundary rolls the default forward and respects explicit custom YTD', () => {
  const before = reportPeriod({}, new Date('2025-12-31T16:59:59Z'));
  const after = reportPeriod({ customDateRange: false, startDate: '2025-01-01', endDate: '2025-12-31' }, new Date('2025-12-31T17:00:00Z'));
  assert.equal(before.year, 2025); assert.equal(after.year, 2026);
  assert.deepEqual(after.selected, { startDate: '2026-01-01', endDate: '2026-01-01' });
  assert.deepEqual(after.monthRange, after.selected);
  assert.equal(reportPeriod({ customDateRange: true, ...after.selected }, new Date('2025-12-31T17:00:00Z')).labels[1], 'Doanh thu trong kỳ');
});

test('invalid or inverted report dates are rejected before any query', async () => {
  const { service, calls } = serviceHarness();
  for (const filters of [{ startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-06-30', endDate: '2026-06-01' }]) {
    await assert.rejects(() => service.getReportData('revenue', filters), /Khoảng ngày/);
  }
  assert.equal(calls.length, 0);
});

test('search and entity filters survive annual context and every CSV page; selected totals agree', async () => {
  const { service, calls } = serviceHarness();
  const filters = { startDate: '2025-11-15', endDate: '2026-02-20', customerId: 1, kioskId: 2, categoryId: 3,
    businessTypeId: 4, paymentStatus: 'completed', kioskStatus: 'active', search: 'Alpha' };
  const { data } = await service.exportReportData('revenue', filters);
  assert.equal(data.rows.length, 2);
  assert.equal(data.rows.reduce((sum, row) => sum + row.totalAmount, 0), data.financial.values[1]);
  assert.equal(data.groups.monthly[0].totalAmount, data.financial.values[1]);
  assert.equal(data.groups.businessTypes[0].totalAmount, data.financial.values[1]);
  const queries = calls.filter(call => call.name === 'get_reports_data_filtered');
  assert.equal(queries.length, 4);
  for (const { args } of queries) {
    assert.equal(args.p_search, 'Alpha'); assert.equal(args.p_customer_id, 1); assert.equal(args.p_kiosk_id, 2);
    assert.equal(args.p_category_id, 3); assert.equal(args.p_business_type_id, 4);
    assert.equal(args.p_payment_status, 'completed'); assert.equal(args.p_kiosk_status, 'active');
  }
  assert.deepEqual(queries.filter(call => call.args.p_start_date === filters.startDate).map(call => call.args.p_page), [1, 2]);
});

function pageHarness() {
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, { value: '', handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; } });
    return controls.get(id);
  };
  const tabs = ['overview', 'revenue'].map(reportTab => Object.assign(control(reportTab), { dataset: { reportTab } }));
  const calls = [];
  const box = vm.createContext({ vietnamDateRangeYearToDate: () => ({ from: '2026-01-01', to: '2026-10-04' }),
    PageHeader: () => '', FilterBar: () => '', DateRangeFields: () => '', EmptyState: () => '', escapeHtml: String,
    renderIcon: () => '', formatCurrency: String, formatDate: String,
    setTimeout: handler => { handler(); return 1; }, clearTimeout() {},
    capture: tab => calls.push(tab), document: { getElementById: control, querySelectorAll: () => tabs } });
  vm.runInContext(pageSource.replace(/^import .*;\n/gm, '').replace('export function ReportsPage', 'function ReportsPage'), box);
  vm.runInContext('loadReportData = () => capture(state.activeTab); syncControls = () => {}; renderTabs = () => {};', box);
  return { box, control, tabs, calls };
}

test('Reports opens, reloads and reopens on Tổng quan; data refresh and filters preserve Doanh thu', () => {
  const { box, control, tabs, calls } = pageHarness();
  const overview = /report-tab active[^>]*data-report-tab="overview"/;
  assert.match(box.ReportsPage(), overview);
  box.bindEvents(); tabs[1].handlers.click(); assert.equal(calls.at(-1), 'revenue');
  control('report-refresh-button').handlers.click(); assert.equal(calls.at(-1), 'revenue');
  control('report-end-date').handlers.change({ target: { value: '2025-06-30' } });
  assert.equal(calls.at(-1), 'revenue'); assert.equal(vm.runInContext('state.filters.customDateRange', box), true);
  control('report-search').handlers.input({ target: { value: 'Alpha' } }); assert.equal(calls.at(-1), 'revenue');
  control('report-customer-filter').handlers.change({ target: { value: '2' } }); assert.equal(calls.at(-1), 'revenue');
  assert.match(box.ReportsPage(), overview);
  assert.match(pageHarness().box.ReportsPage(), overview);
});

test('Doanh thu renders exactly four approved cards in default and custom contexts', () => {
  const { box } = pageHarness();
  vm.runInContext('card = (tone, icon, value, label) => ({value,label}); renderSummaryCards = cards => JSON.stringify(cards); renderReportCard = () => ""; renderTable = () => ""; renderPagination = () => "";', box);
  for (const filters of [{}, { startDate: '2025-11-15', endDate: '2026-02-20' }]) {
    const period = reportPeriod(filters, now);
    const rendered = box.renderRevenue({ financial: { period, values: [1000, 200, 30, 170] }, groups: {}, rows: [], pagination: {} });
    const cards = JSON.parse(rendered.trim().split('\n')[0]);
    assert.equal(cards.length, 4); assert.deepEqual(cards.map(card => card.label), period.labels);
  }
  for (const source of [pageSource, serviceSource, read('src/utils/reportPeriod.js')]) assert.doesNotMatch(source, /bình quân|average/i);
});
