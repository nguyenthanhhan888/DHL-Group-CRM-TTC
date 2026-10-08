import { requireSupabaseClient, runQuery } from './BaseService.js';
import { reportPeriod } from '../utils/reportPeriod.js';

const ALLOWED_TABS = new Set([
  'overview',
  'revenue',
  'kiosks',
  'customers',
  'reconciliation',
  'categories',
]);
const ALLOWED_PAGE_SIZES = new Set([25, 50, 100]);

export const ReportService = {
  async exportReportData(tab, filters = {}, options = {}) {
    const snapshot = { ...filters };
    const { data: first } = await this.getReportData(tab, snapshot, { ...options, page: 1, pageSize: 100 });
    if (tab === 'overview') return { data: first };
    const rows = [...first.rows];
    const signature = (report) => JSON.stringify([report.pagination.totalRows, report.summary, report.groups, report.financial]);
    for (let page = 2; page <= first.pagination.totalPages; page += 1) {
      const { data } = await this.getReportData(tab, snapshot, { ...options, page, pageSize: 100 });
      if (signature(data) !== signature(first)) throw new Error('Dữ liệu đã thay đổi trong lúc xuất. Vui lòng tải lại báo cáo và thử lại.');
      rows.push(...data.rows);
    }
    if (rows.length !== first.pagination.totalRows) throw new Error('Chưa đọc đủ dữ liệu báo cáo. Vui lòng thử lại.');
    return { data: { ...first, rows } };
  },
  async getReportData(tab = 'overview', filters = {}, options = {}) {
    const normalizedTab = ALLOWED_TABS.has(tab) ? tab : 'overview';
    const page = positiveInteger(options.page, 1);
    const requestedPageSize = positiveInteger(options.pageSize, 50);
    const pageSize = ALLOWED_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 50;
    const supabase = requireSupabaseClient();
    const period = reportPeriod(filters);
    const reportArgs = {
        p_report_type: normalizedTab,
        p_start_date: period.selected.startDate,
        p_end_date: period.selected.endDate,
        p_customer_id: optionalInteger(filters.customerId),
        p_kiosk_id: optionalInteger(filters.kioskId),
        p_category_id: optionalInteger(filters.categoryId),
        p_business_type_id: optionalInteger(filters.businessTypeId),
        p_payment_status: optionalText(filters.paymentStatus),
        p_kiosk_status: optionalText(filters.kioskStatus),
        p_sort_by: optionalText(options.sortBy),
        p_sort_direction: options.sortDirection === 'asc' ? 'asc' : 'desc',
        p_page: page,
        p_page_size: pageSize,
        p_search: optionalText(filters.search),
    };
    const revenue = (range) => runQuery(supabase.rpc('get_reports_data_filtered', {
      ...reportArgs, p_report_type: 'revenue', p_start_date: range.startDate, p_end_date: range.endDate, p_page: 1,
    }));
    const [{ data }, { data: operations }, { data: expenseSummary }, yearData, monthData] = await Promise.all([
      runQuery(supabase.rpc('get_reports_data_filtered', reportArgs)),
      runQuery(supabase.rpc('get_registration_operations_summary')),
      runQuery(supabase.rpc('get_expense_report_summary', {
        p_start_date: period.selected.startDate,
        p_end_date: period.selected.endDate,
      })),
      normalizedTab === 'revenue' && period.custom ? revenue(period.yearRange) : null,
      normalizedTab === 'revenue' && period.mode === 'ytd' ? revenue(period.monthRange) : null,
    ]);
    const result = normalizeResponse(data, normalizedTab, page, pageSize, operations, expenseSummary);
    const selectedRevenue = Number(result.summary.totalRevenue || 0);
    const yearRevenue = Number(yearData?.data?.summary?.totalRevenue ?? selectedRevenue);
    result.financial = {
      period,
      values: [period.custom ? yearRevenue : selectedRevenue,
        period.custom ? selectedRevenue : Number(monthData?.data?.summary?.totalRevenue || 0),
        result.summary.totalExpense,
        selectedRevenue - result.summary.totalExpense],
    };
    return { data: result };
  },
};

function normalizeResponse(data, tab, page, pageSize, operations = {}, expenseSummary = {}) {
  const report = data && typeof data === 'object' ? data : {};
  const pagination = report.pagination || {};
  const summary = {};

  Object.entries(report.summary || {}).forEach(([key, value]) => {
    summary[key] = numericOrValue(value);
  });
  summary.pendingPayments = nonNegativeNumber(operations?.pendingPayments ?? summary.pendingCount);
  summary.awaitingPaymentRequests = nonNegativeNumber(operations?.awaitingPaymentRequests);
  summary.pendingKiosks = nonNegativeNumber(operations?.pendingKiosks ?? summary.pendingKiosks);
  summary.pendingReviewRequests = nonNegativeNumber(operations?.pendingReviewRequests);
  summary.totalExpense = nonNegativeNumber(expenseSummary?.totalExpense);
  summary.netProfit = Number(summary.totalRevenue || 0) - summary.totalExpense;

  return {
    tab: report.tab || tab,
    generatedAt: report.generatedAt || '',
    warningDays: nonNegativeNumber(report.warningDays),
    reportDate: report.reportDate || '',
    summary,
    rows: Array.isArray(report.rows) ? report.rows : [],
    groups: {
      monthly: normalizeArray(report.groups?.monthly),
      businessTypes: normalizeArray(report.groups?.businessTypes),
      paymentMethods: normalizeArray(report.groups?.paymentMethods),
      kioskStatuses: normalizeArray(report.groups?.kioskStatuses),
    },
    topCustomers: normalizeArray(report.topCustomers),
    priorityKiosks: normalizeArray(report.priorityKiosks),
    pagination: {
      page: positiveInteger(pagination.page, page),
      pageSize: ALLOWED_PAGE_SIZES.has(Number(pagination.pageSize))
        ? Number(pagination.pageSize)
        : pageSize,
      totalRows: nonNegativeNumber(pagination.totalRows),
      totalPages: nonNegativeNumber(pagination.totalPages),
    },
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function numericOrValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'string' || value.trim() === '') return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function optionalInteger(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}
