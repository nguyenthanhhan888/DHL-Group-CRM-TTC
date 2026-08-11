import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatCard } from '../components/StatCard.js';
import { Toast } from '../components/Toast.js';
import { Toolbar } from '../components/Toolbar.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { ReportService } from '../services/ReportService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDate, startOfToday, toDateOnly } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

const REPORT_TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'revenue', label: 'Doanh thu' },
  { id: 'kiosks', label: 'Kiosk' },
  { id: 'customers', label: 'Khách hàng' },
  { id: 'reconciliation', label: 'Đối soát' },
  { id: 'categories', label: 'Danh mục / Loại hình' },
];

const state = {
  activeTab: 'overview',
  filters: defaultFilters(),
  categories: [],
  businessTypes: [],
  report: null,
  requestId: 0,
  page: 1,
  pageSize: 50,
  sortBy: '',
  sortDirection: 'desc',
  searchTerm: '',
};

export function ReportsPage() {
  return `
    ${PageHeader({
      title: 'Báo cáo',
      description: 'Báo cáo tổng hợp và phân trang từ Supabase.',
      actions: '<button class="btn-secondary" id="report-export-button" type="button">Xuất CSV (trang hiện tại)</button>',
    })}
    ${Toolbar({
      className: 'filter-panel report-filter-panel',
      children: `
        <div class="filter-panel-head">
          <div>
            <span class="filter-eyebrow">Bộ lọc báo cáo</span>
            <strong>Thu hẹp dữ liệu theo thời gian, nhóm và trạng thái</strong>
          </div>
          <button class="btn-secondary" id="report-refresh-button" type="button">Làm mới</button>
        </div>
        <div class="filter-grid report-filter-grid">
          <label class="filter-field filter-field-date">
            <span>Từ ngày</span>
            <input id="report-start-date" class="form-control compact-date" type="date" aria-label="Ngày bắt đầu" />
          </label>
          <label class="filter-field filter-field-date">
            <span>Đến ngày</span>
            <input id="report-end-date" class="form-control compact-date" type="date" aria-label="Ngày kết thúc" />
          </label>
          <label class="filter-field">
            <span>ID khách hàng</span>
            <input id="report-customer-filter" class="form-control" type="number" min="1" placeholder="VD: 212" aria-label="Lọc ID khách hàng" />
          </label>
          <label class="filter-field">
            <span>ID Kiosk</span>
            <input id="report-kiosk-filter" class="form-control" type="number" min="1" placeholder="VD: 240" aria-label="Lọc ID Kiosk" />
          </label>
          <label class="filter-field filter-field-wide">
            <span>Tìm kiếm</span>
            <input id="report-search" class="form-control" type="search" placeholder="Tìm khách hàng, kiosk, trạng thái hoặc số tiền" aria-label="Tìm trong báo cáo" autocomplete="off" />
          </label>
          <label class="filter-field">
            <span>Danh mục</span>
            <select id="report-category-filter" class="filter-select" aria-label="Lọc danh mục">
              <option value="">Tất cả danh mục</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Loại hình KD</span>
            <select id="report-business-type-filter" class="filter-select" aria-label="Lọc loại hình kinh doanh">
              <option value="">Tất cả loại hình KD</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Thanh toán</span>
            <select id="report-payment-status-filter" class="filter-select" aria-label="Lọc trạng thái thanh toán">
              <option value="">Tất cả trạng thái</option>
              <option value="completed">Hoàn thành</option>
              <option value="pending">Chờ duyệt</option>
              <option value="rejected">Từ chối</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Trạng thái Kiosk</span>
            <select id="report-kiosk-status-filter" class="filter-select" aria-label="Lọc trạng thái Kiosk">
              <option value="">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="pending">Chờ duyệt</option>
              <option value="expired">Hết hạn</option>
              <option value="suspended">Tạm ngưng</option>
              <option value="expiring_soon">Sắp hết hạn</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Sắp xếp</span>
            <select id="report-sort-filter" class="filter-select" aria-label="Sắp xếp">
              <option value="">Mặc định</option>
              <option value="confirmed_at">Ngày xác nhận</option>
              <option value="amount">Số tiền</option>
              <option value="name">Tên</option>
              <option value="customer">Khách hàng</option>
              <option value="kiosk">Kiosk</option>
              <option value="status">Trạng thái</option>
              <option value="end_date">Ngày hết hạn</option>
              <option value="total_kiosks">Tổng Kiosk</option>
              <option value="total_paid">Tổng đã trả</option>
              <option value="issue">Vấn đề</option>
              <option value="event_at">Thời điểm</option>
              <option value="kiosks">Số Kiosk</option>
              <option value="revenue">Doanh thu</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Chiều</span>
            <select id="report-sort-direction" class="filter-select" aria-label="Chiều sắp xếp">
              <option value="desc">Giảm dần</option>
              <option value="asc">Tăng dần</option>
            </select>
          </label>
          <label class="filter-field">
            <span>Phân trang</span>
            <select id="report-page-size" class="filter-select" aria-label="Số dòng mỗi trang">
              <option value="25">25 dòng</option>
              <option value="50">50 dòng</option>
              <option value="100">100 dòng</option>
            </select>
          </label>
        </div>
      `,
    })}
    <div class="report-tabs" role="tablist" aria-label="Báo cáo">
      ${REPORT_TABS.map((tab) => `
        <button class="report-tab ${tab.id === state.activeTab ? 'active' : ''}" type="button" role="tab" data-report-tab="${tab.id}" aria-selected="${tab.id === state.activeTab}">
          ${tab.label}
        </button>
      `).join('')}
    </div>
    <div id="reports-content">${renderLoadingState()}</div>
  `;
}

ReportsPage.afterRender = function afterRenderReports() {
  syncControls();
  bindEvents();
  loadFilterOptions();
  loadReportData();
};

function bindEvents() {
  bindFilter('report-start-date', 'startDate');
  bindFilter('report-end-date', 'endDate');
  bindFilter('report-customer-filter', 'customerId');
  bindFilter('report-kiosk-filter', 'kioskId');
  bindFilter('report-payment-status-filter', 'paymentStatus');
  bindFilter('report-kiosk-status-filter', 'kioskStatus');

  document.getElementById('report-category-filter')?.addEventListener('change', (event) => {
    state.filters.categoryId = event.target.value;
    clearBusinessTypeIfOutsideCategory();
    renderBusinessTypeOptions();
    resetAndLoad();
  });
  document.getElementById('report-business-type-filter')?.addEventListener('change', (event) => {
    state.filters.businessTypeId = event.target.value;
    resetAndLoad();
  });
  document.getElementById('report-sort-filter')?.addEventListener('change', (event) => {
    state.sortBy = event.target.value;
    resetAndLoad();
  });
  document.getElementById('report-sort-direction')?.addEventListener('change', (event) => {
    state.sortDirection = event.target.value;
    resetAndLoad();
  });
  document.getElementById('report-page-size')?.addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    resetAndLoad();
  });
  document.getElementById('report-refresh-button')?.addEventListener('click', loadReportData);
  document.getElementById('report-export-button')?.addEventListener('click', exportCurrentPage);
  document.getElementById('report-search')?.addEventListener('input', (event) => {
    state.searchTerm = event.target.value || '';
    renderReportContent();
  });

  document.querySelectorAll('[data-report-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.reportTab;
      state.page = 1;
      state.sortBy = '';
      syncControls();
      renderTabs();
      loadReportData();
    });
  });
}

function bindFilter(id, key) {
  document.getElementById(id)?.addEventListener('change', (event) => {
    state.filters[key] = event.target.value;
    resetAndLoad();
  });
}

function resetAndLoad() {
  state.page = 1;
  loadReportData();
}

function syncControls() {
  setControlValue('report-start-date', state.filters.startDate);
  setControlValue('report-end-date', state.filters.endDate);
  setControlValue('report-customer-filter', state.filters.customerId);
  setControlValue('report-kiosk-filter', state.filters.kioskId);
  setControlValue('report-category-filter', state.filters.categoryId);
  setControlValue('report-business-type-filter', state.filters.businessTypeId);
  setControlValue('report-payment-status-filter', state.filters.paymentStatus);
  setControlValue('report-kiosk-status-filter', state.filters.kioskStatus);
  setControlValue('report-sort-filter', state.sortBy);
  setControlValue('report-sort-direction', state.sortDirection);
  setControlValue('report-page-size', state.pageSize);
  setControlValue('report-search', state.searchTerm);
}

function setControlValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? '';
}

async function loadFilterOptions() {
  try {
    const [categories, businessTypes] = await Promise.all([
      CategoryService.listActive(),
      BusinessTypeService.listActive(),
    ]);
    state.categories = categories.data || [];
    state.businessTypes = businessTypes.data || [];
    renderCategoryOptions();
    renderBusinessTypeOptions();
  } catch {
    state.categories = [];
    state.businessTypes = [];
    renderCategoryOptions('Không tải được danh mục');
    renderBusinessTypeOptions('Không tải được loại hình KD');
  }
}

async function loadReportData() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  state.report = null;
  setReportLoading();

  try {
    const { data } = await ReportService.getReportData(state.activeTab, state.filters, {
      page: state.page,
      pageSize: state.pageSize,
      sortBy: state.sortBy,
      sortDirection: state.sortDirection,
    });
    if (requestId !== state.requestId) return;
    state.report = data;
    renderReportContent();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderReportError(error);
  }
}

function renderCategoryOptions(errorText = '') {
  const select = document.getElementById('report-category-filter');
  if (!select) return;
  select.innerHTML = errorText
    ? `<option value="">${escapeHtml(errorText)}</option>`
    : `<option value="">Tất cả danh mục</option>${state.categories.map((item) => (
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || 'Không tên')}</option>`
    )).join('')}`;
  select.value = state.filters.categoryId;
}

function renderBusinessTypeOptions(errorText = '') {
  const select = document.getElementById('report-business-type-filter');
  if (!select) return;
  const options = state.filters.categoryId
    ? state.businessTypes.filter((item) => String(item.category_id) === String(state.filters.categoryId))
    : state.businessTypes;
  select.innerHTML = errorText
    ? `<option value="">${escapeHtml(errorText)}</option>`
    : `<option value="">Tất cả loại hình KD</option>${options.map((item) => (
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || 'Không tên')}</option>`
    )).join('')}`;
  select.value = state.filters.businessTypeId;
}

function clearBusinessTypeIfOutsideCategory() {
  if (!state.filters.businessTypeId || !state.filters.categoryId) return;
  const item = state.businessTypes.find((entry) => String(entry.id) === String(state.filters.businessTypeId));
  if (item && String(item.category_id) !== String(state.filters.categoryId)) {
    state.filters.businessTypeId = '';
  }
}

function renderTabs() {
  document.querySelectorAll('[data-report-tab]').forEach((button) => {
    const active = button.dataset.reportTab === state.activeTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function renderReportContent() {
  const content = document.getElementById('reports-content');
  if (!content || !state.report) return;
  const renderers = {
    overview: renderOverview,
    revenue: renderRevenue,
    kiosks: renderKiosks,
    customers: renderCustomers,
    reconciliation: renderReconciliation,
    categories: renderCategories,
  };
  content.innerHTML = (renderers[state.activeTab] || renderOverview)(state.report);
  bindPagination();
}

function renderOverview(report) {
  return `
    ${renderSummaryCards([
      card('blue', '✅', report.summary.completedCount, 'Thanh toán hoàn thành'),
      card('purple', '⏳', report.summary.pendingCount, 'Thanh toán chờ duyệt'),
      card('orange', '⏰', report.summary.expiringSoon, 'Kiosk sắp hết hạn'),
      card('red', '❌', report.summary.expiredKiosks, 'Kiosk hết hạn'),
      card('green', '💰', formatCurrency(report.summary.totalRevenue), 'Doanh thu trong kỳ', true),
    ])}
    <div class="report-grid">
      ${renderReportCard('Top 10 khách hàng doanh thu cao', renderTable(topCustomerColumns(), report.topCustomers, 'Không có khách hàng phát sinh doanh thu trong kỳ.'))}
      ${renderReportCard('Kiosk cần xử lý', renderTable(kioskColumns(true), report.priorityKiosks, 'Không có Kiosk cần xử lý.'))}
    </div>
  `;
}

function renderRevenue(report) {
  return `
    ${renderSummaryCards([
      card('green', '💰', formatCurrency(report.summary.totalRevenue), 'Tổng doanh thu', true),
      card('blue', '🧾', report.summary.completedCount, 'Thanh toán hoàn thành'),
      card('purple', '📊', formatCurrency(report.summary.averagePayment), 'Trung bình'),
      card('teal', '⬆️', formatCurrency(report.summary.highestPayment), 'Cao nhất'),
      card('orange', '⬇️', formatCurrency(report.summary.lowestPayment), 'Thấp nhất'),
    ])}
    <div class="report-grid">
      ${renderReportCard('Doanh thu theo tháng', renderTable(monthColumns(), report.groups.monthly, 'Không có doanh thu theo tháng.'))}
      ${renderReportCard('Doanh thu theo loại hình', renderTable(businessRevenueColumns(), report.groups.businessTypes, 'Không có doanh thu theo loại hình.'))}
      ${renderReportCard('Doanh thu theo phương thức', renderTable(methodColumns(), report.groups.paymentMethods, 'Không có dữ liệu phương thức.'))}
    </div>
    ${renderReportCard('Chi tiết thanh toán hoàn thành', renderTable(revenueDetailColumns(), report.rows, 'Không có thanh toán phù hợp.'))}
    ${renderPagination(report.pagination)}
  `;
}

function renderKiosks(report) {
  return `
    ${renderSummaryCards([
      card('blue', '🏪', report.summary.totalKiosks, 'Tổng Kiosk'),
      card('green', '✅', report.summary.activeKiosks, 'Hoạt động'),
      card('purple', '⏳', report.summary.pendingKiosks, 'Chờ duyệt'),
      card('red', '❌', report.summary.expiredKiosks, 'Hết hạn'),
      card('teal', '⏸️', report.summary.suspendedKiosks, 'Tạm ngưng'),
      card('orange', '⏰', report.summary.expiringSoon, 'Sắp hết hạn'),
    ])}
    ${renderReportCard('Trạng thái Kiosk', renderTable(kioskStatusColumns(), report.groups.kioskStatuses, 'Không có Kiosk.'))}
    ${renderReportCard('Chi tiết Kiosk', renderTable(kioskColumns(), report.rows, 'Không có Kiosk phù hợp.'))}
    ${renderPagination(report.pagination)}
  `;
}

function renderCustomers(report) {
  return `
    ${renderSummaryCards([
      card('blue', '👥', report.summary.totalCustomers, 'Tổng khách hàng'),
      card('purple', '🏪', report.summary.totalKiosks, 'Tổng Kiosk'),
      card('green', '✅', report.summary.activeKiosks, 'Kiosk hoạt động'),
      card('red', '❌', report.summary.expiredKiosks, 'Kiosk hết hạn'),
      card('teal', '💰', formatCurrency(report.summary.totalPaid), 'Tổng đã trả', true),
    ])}
    ${renderReportCard('Chi tiết khách hàng', renderTable(customerColumns(), report.rows, 'Không có khách hàng phù hợp.'))}
    ${renderPagination(report.pagination)}
  `;
}

function renderReconciliation(report) {
  return `
    ${renderSummaryCards([
      card('orange', '⚠️', report.summary.issueCount, 'Mục cần kiểm tra'),
    ])}
    <div class="notice warning reconciliation-note">
      <strong>Đối soát là danh sách gợi ý kiểm tra</strong>
      <span>Hệ thống đang so dữ liệu tổng hợp với các trường lưu nhanh như total_paid, Facebook ID và ngày hết hạn. Một số dòng có thể là dữ liệu chờ bổ sung, không nhất thiết là lỗi vận hành.</span>
    </div>
    ${renderReportCard('Đối soát chỉ đọc', renderTable(reconciliationColumns(), report.rows, 'Không phát hiện mục cần kiểm tra.'))}
    ${renderPagination(report.pagination)}
  `;
}

function renderCategories(report) {
  return `
    ${renderSummaryCards([
      card('blue', '🗂️', report.summary.totalCategories, 'Danh mục'),
      card('purple', '🏷️', report.summary.totalBusinessTypes, 'Loại hình KD'),
      card('orange', '🏪', report.summary.totalKiosks, 'Tổng Kiosk'),
      card('green', '💰', formatCurrency(report.summary.totalRevenue), 'Doanh thu', true),
    ])}
    ${renderReportCard('Danh mục và loại hình kinh doanh', renderTable(categoryColumns(), report.rows, 'Không có dữ liệu danh mục.'))}
    ${renderPagination(report.pagination)}
  `;
}

function card(tone, icon, value, label, fluid = false) {
  return StatCard({ tone, icon, value: value ?? 0, label, className: fluid ? 'stat-card-fluid' : '' });
}

function renderSummaryCards(cards) {
  return `<div class="stats-grid report-stats">${cards.join('')}</div>`;
}

function renderReportCard(title, content) {
  return `<section class="report-card"><div class="dash-card-header"><h3>${escapeHtml(title)}</h3></div>${content}</section>`;
}

function renderTable(columns, rows, emptyMessage) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const filteredRows = filterReportRows(safeRows, columns);
  const noResultMessage = state.searchTerm
    ? 'Thử tìm bằng tên, trạng thái, số tiền, ngày hoặc nội dung khác.'
    : emptyMessage;
  return `
    <div class="report-table-wrap">
      <table class="data-table report-table">
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${filteredRows.length
            ? filteredRows.map((row) => `<tr>${columns.map((column) => `<td>${column.render(row)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${columns.length}">${EmptyState({ title: state.searchTerm ? 'Không tìm thấy dữ liệu' : 'Không có dữ liệu', message: noResultMessage })}</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function filterReportRows(rows, columns) {
  const term = normalizeSearch(state.searchTerm);
  if (!term) return rows;
  return rows.filter((row) => columns.some((column) => normalizeSearch(stripHtml(column.render(row))).includes(term)));
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

function topCustomerColumns() {
  return [
    { label: 'Khách hàng', render: (row) => customerLink(row.customerId, row.customerName) },
    { label: 'SĐT', render: (row) => escapeHtml(row.phone || '—') },
    { label: 'Thanh toán', render: (row) => number(row.paymentCount) },
    { label: 'Tổng tiền', render: (row) => formatCurrency(row.totalAmount) },
  ];
}

function monthColumns() {
  return [
    { label: 'Tháng', render: (row) => escapeHtml(row.label || '—') },
    { label: 'Thanh toán', render: (row) => number(row.paymentCount) },
    { label: 'Doanh thu', render: (row) => formatCurrency(row.totalAmount) },
  ];
}

function businessRevenueColumns() {
  return [
    { label: 'Loại hình KD', render: (row) => escapeHtml(row.businessTypeName || '—') },
    { label: 'Danh mục', render: (row) => escapeHtml(row.categoryName || '—') },
    { label: 'Thanh toán', render: (row) => number(row.paymentCount) },
    { label: 'Doanh thu', render: (row) => formatCurrency(row.totalAmount) },
  ];
}

function methodColumns() {
  return [
    { label: 'Phương thức', render: (row) => escapeHtml(paymentMethodLabel(row.paymentMethod)) },
    { label: 'Thanh toán', render: (row) => number(row.paymentCount) },
    { label: 'Doanh thu', render: (row) => formatCurrency(row.totalAmount) },
  ];
}

function revenueDetailColumns() {
  return [
    { label: 'Xác nhận', render: (row) => formatDateTime(row.confirmedAt) },
    { label: 'Khách hàng', render: (row) => customerLink(row.customerId, row.customerName) },
    { label: 'Kiosk', render: (row) => kioskLink(row.kioskId, row.kioskName) },
    { label: 'Loại hình KD', render: (row) => escapeHtml(row.businessTypeName || '—') },
    { label: 'Phương thức', render: (row) => escapeHtml(paymentMethodLabel(row.paymentMethod)) },
    { label: 'Số tiền', render: (row) => formatCurrency(row.totalAmount) },
  ];
}

function kioskStatusColumns() {
  return [
    { label: 'Trạng thái', render: (row) => statusBadge(row.status) },
    { label: 'Số Kiosk', render: (row) => number(row.kioskCount) },
    { label: 'Đã thu', render: (row) => formatCurrency(row.totalPaid) },
  ];
}

function kioskColumns(priority = false) {
  const columns = [
    { label: 'Kiosk', render: (row) => kioskLink(row.id, row.facebookName) },
    { label: 'Khách hàng', render: (row) => escapeHtml(row.customerName || '—') },
    { label: 'Trạng thái', render: (row) => statusBadge(row.derivedStatus || row.status) },
    { label: 'Ngày hết hạn', render: (row) => formatDate(row.endDate) },
  ];
  if (!priority) {
    columns.splice(2, 0, { label: 'Loại hình KD', render: (row) => escapeHtml(row.businessTypeName || '—') });
    columns.push({ label: 'Còn lại', render: (row) => daysLabel(row.daysLeft) });
    columns.push({ label: 'Đã thu', render: (row) => formatCurrency(row.totalPaid) });
  }
  return columns;
}

function customerColumns() {
  return [
    { label: 'Khách hàng', render: (row) => customerLink(row.id, row.customerName) },
    { label: 'SĐT', render: (row) => escapeHtml(row.phone || '—') },
    { label: 'Tổng Kiosk', render: (row) => number(row.totalKiosks) },
    { label: 'Hoạt động', render: (row) => number(row.activeKiosks) },
    { label: 'Hết hạn', render: (row) => number(row.expiredKiosks) },
    { label: 'Tổng đã trả', render: (row) => formatCurrency(row.totalPaid) },
    { label: 'Thanh toán gần nhất', render: (row) => formatDateTime(row.latestCompletedPayment) },
    { label: 'Hạn Kiosk xa nhất', render: (row) => formatDate(row.latestKioskEndDate) },
  ];
}

function reconciliationColumns() {
  return [
    { label: 'Mục cần kiểm tra', render: (row) => `<span class="old-value">${escapeHtml(friendlyIssue(row.issue))}</span>` },
    { label: 'Giải thích', render: (row) => `<span class="muted-text">${escapeHtml(issueExplanation(row))}</span>` },
    { label: 'Loại', render: (row) => escapeHtml(row.entityType || '—') },
    { label: 'Bản ghi', render: (row) => escapeHtml(row.recordId || '—') },
    { label: 'Khách hàng', render: (row) => customerLink(row.customerId, row.customerName) },
    { label: 'Kiosk', render: (row) => kioskLink(row.kioskId, row.kioskName) },
    { label: 'Trạng thái', render: (row) => statusBadge(row.status) },
    { label: 'Số tiền', render: (row) => formatCurrency(row.totalAmount) },
    { label: 'Thời điểm', render: (row) => formatDateTime(row.eventAt) },
  ];
}

function friendlyIssue(issue) {
  return {
    'customers.total_paid không khớp': 'Tổng đã trả cần đối chiếu',
    'Kiosk thiếu Facebook ID': 'Kiosk cần bổ sung Facebook ID',
    'Kiosk thiếu end_date': 'Kiosk cần bổ sung ngày hết hạn',
  }[issue] || issue || '—';
}

function issueExplanation(row) {
  const issue = row.issue || '';
  if (issue === 'customers.total_paid không khớp') {
    return 'Đang so customers.total_paid với tổng thanh toán hoàn thành trong kỳ. Nếu total_paid không còn là nguồn chính, có thể cần chạy đồng bộ lại.';
  }
  if (issue === 'Kiosk thiếu Facebook ID') {
    return 'Kiosk đang hoạt động/chờ xác nhận nhưng trường facebook_id trống. Nếu đây là đơn mới chờ bổ sung thì có thể xử lý sau.';
  }
  if (issue === 'Kiosk thiếu end_date') {
    return 'Kiosk chưa có ngày hết hạn để tính trạng thái hết hạn/sắp hết hạn.';
  }
  return row.detail || 'Mở bản ghi để kiểm tra trường dữ liệu liên quan.';
}

function categoryColumns() {
  return [
    { label: 'Danh mục', render: (row) => escapeHtml(row.categoryName || '—') },
    { label: 'Loại hình KD', render: (row) => escapeHtml(row.businessTypeName || '—') },
    { label: 'Giá/tháng', render: (row) => formatCurrency(row.pricePerMonth) },
    { label: 'Kiosk', render: (row) => number(row.kioskCount) },
    { label: 'Hoạt động', render: (row) => number(row.activeKiosks) },
    { label: 'Chờ duyệt', render: (row) => number(row.pendingKiosks) },
    { label: 'Hết hạn', render: (row) => number(row.expiredKiosks) },
    { label: 'Thanh toán', render: (row) => number(row.completedPayments) },
    { label: 'Doanh thu', render: (row) => formatCurrency(row.totalRevenue) },
  ];
}

function renderPagination(pagination) {
  if (!pagination) return '';
  const page = number(pagination.page) || 1;
  const totalPages = number(pagination.totalPages);
  return `
    <div class="toolbar">
      <button class="btn-secondary" type="button" data-report-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Trang trước</button>
      <span class="muted-text">Trang ${page}/${Math.max(totalPages, 1)} · ${number(pagination.totalRows)} kết quả</span>
      <button class="btn-secondary" type="button" data-report-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Trang sau</button>
    </div>
  `;
}

function bindPagination() {
  document.querySelectorAll('[data-report-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = Number(button.dataset.reportPage);
      if (!Number.isInteger(page) || page < 1) return;
      state.page = page;
      loadReportData();
    });
  });
}

function customerLink(id, name) {
  const safeName = escapeHtml(name || 'Không tên');
  return id ? `<a class="table-link" href="#/customer-detail?id=${encodeURIComponent(id)}">${safeName}</a>` : safeName;
}

function kioskLink(id, name) {
  const safeName = escapeHtml(name || 'Không tên');
  return id ? `<a class="table-link" href="#/kiosk-detail?id=${encodeURIComponent(id)}">${safeName}</a>` : safeName;
}

function statusBadge(status) {
  const normalized = String(status || 'unknown').toLowerCase();
  const safeClass = normalized.replace(/[^a-z0-9-]/g, '') || 'unknown';
  const labels = {
    active: 'Hoạt động',
    warning: 'Sắp hết hạn',
    expired: 'Hết hạn',
    pending: 'Chờ xác nhận',
    completed: 'Hoàn thành',
    rejected: 'Bị từ chối',
    cancelled: 'Đã hủy',
    inactive: 'Không hoạt động',
    suspended: 'Tạm ngưng',
    unknown: 'Không rõ',
  };
  return `<span class="badge badge-${safeClass}">${escapeHtml(labels[normalized] || status || 'Không rõ')}</span>`;
}

function paymentMethodLabel(value) {
  const labels = {
    transfer: 'Chuyển khoản',
    bank_transfer: 'Chuyển khoản NH',
    cash: 'Tiền mặt',
    other: 'Khác',
    momo: 'Momo',
    import_excel: 'Dữ liệu nhập từ Excel',
    unknown: 'Không rõ',
  };
  return labels[String(value || 'unknown').toLowerCase()] || value || 'Không rõ';
}

function daysLabel(value) {
  if (value === null || value === undefined) return '—';
  const days = Number(value);
  if (!Number.isFinite(days)) return '—';
  if (days < 0) return `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return 'Hết hạn hôm nay';
  return `${days} ngày`;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function setReportLoading() {
  const content = document.getElementById('reports-content');
  if (content) content.innerHTML = renderLoadingState();
}

function renderLoadingState() {
  return `<section class="report-card">${EmptyState({ title: 'Đang tải báo cáo', message: 'Database đang tổng hợp dữ liệu.' })}</section>`;
}

function renderReportError(error) {
  const content = document.getElementById('reports-content');
  if (!content) return;
  content.innerHTML = `<section class="report-card">${EmptyState({
    title: 'Không thể tải báo cáo',
    message: escapeHtml(error?.message || 'Supabase trả về lỗi khi tổng hợp báo cáo.'),
  })}</section>`;
}

function exportCurrentPage() {
  if (!state.report) {
    Toast.show('Chưa có dữ liệu báo cáo để xuất.');
    return;
  }
  const rows = exportRowsForCurrentTab(state.report);
  if (!rows.length) {
    Toast.show('Trang báo cáo hiện tại không có dữ liệu để xuất.');
    return;
  }
  downloadCsv(rows, `bao-cao-${state.activeTab}-trang-${state.page}.csv`);
  Toast.show(`Đã xuất ${rows.length} dòng của trang hiện tại.`);
}

function exportRowsForCurrentTab(report) {
  if (state.activeTab === 'overview') {
    return [
      ...report.topCustomers.map((row) => ({
        Nhóm: 'Top khách hàng',
        'Khách hàng': row.customerName,
        'Số thanh toán': row.paymentCount,
        'Tổng tiền': row.totalAmount,
      })),
      ...report.priorityKiosks.map((row) => ({
        Nhóm: 'Kiosk cần xử lý',
        Kiosk: row.facebookName,
        'Khách hàng': row.customerName,
        'Trạng thái': row.derivedStatus,
        'Ngày hết hạn': row.endDate,
      })),
    ];
  }

  return report.rows.map((row) => ({ ...row }));
}

function downloadCsv(rows, filename) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function defaultFilters() {
  const today = startOfToday();
  return {
    startDate: toDateOnly(new Date(today.getFullYear(), 0, 1)),
    endDate: toDateOnly(today),
    customerId: '',
    kioskId: '',
    categoryId: '',
    businessTypeId: '',
    paymentStatus: '',
    kioskStatus: '',
  };
}
