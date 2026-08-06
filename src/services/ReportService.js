import { requireSupabaseClient, runQuery } from './BaseService.js';

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
  async getReportData(tab = 'overview', filters = {}, options = {}) {
    const normalizedTab = ALLOWED_TABS.has(tab) ? tab : 'overview';
    const page = positiveInteger(options.page, 1);
    const requestedPageSize = positiveInteger(options.pageSize, 50);
    const pageSize = ALLOWED_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 50;
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('get_reports_data', {
        p_report_type: normalizedTab,
        p_start_date: normalizeDate(filters.startDate),
        p_end_date: normalizeDate(filters.endDate),
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
      }),
    );

    return { data: normalizeResponse(data, normalizedTab, page, pageSize) };
  },
};

function normalizeResponse(data, tab, page, pageSize) {
  const report = data && typeof data === 'object' ? data : {};
  const pagination = report.pagination || {};
  const summary = {};

  Object.entries(report.summary || {}).forEach(([key, value]) => {
    summary[key] = numericOrValue(value);
  });

  return {
    tab: report.tab || tab,
    generatedAt: report.generatedAt || '',
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

function normalizeDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
