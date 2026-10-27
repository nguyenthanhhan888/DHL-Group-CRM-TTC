import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { bindPagination, Pagination, updatePagination } from '../components/Pagination.js';
import { bindPayosCopyButtons, PayosResultCard, watchPayosPaymentStatus } from '../components/PayosResultCard.js';
import { StatCard } from '../components/StatCard.js';
import { DateRangeFields } from '../components/DateRangeFields.js';
import { Toast } from '../components/Toast.js';
import { FilterBar } from '../components/FilterBar.js';
import { openPaymentEditForm } from '../components/PaymentEditForm.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { PayosService } from '../services/PayosService.js';
import { renderIcon } from '../utils/icons.js';
import { PaymentService } from '../services/PaymentService.js';
import { bindCurrencyInput, formatCurrency, parseCurrencyInput } from '../utils/currency.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import { vietnamDateRangeYearToDate } from '../utils/date.js';
import {
  clearListNavigationState,
  readListNavigationState,
  restoreListScroll,
  writeListNavigationState,
} from '../utils/listNavigationState.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const PAYMENT_COLUMNS = [
  { label: 'STT', key: null },
  { label: 'Kiosk / Khách hàng', key: null },
  { label: 'Dịch vụ / Kỳ hạn', key: 'months' },
  { label: 'Thanh toán', key: 'total_amount' },
  { label: 'Trạng thái', key: 'payment_status' },
  { label: 'Người xác nhận', key: null },
  { label: 'Thời gian', key: 'business_at' },
  { label: 'Thao tác', key: null },
];

const PAYMENT_STATUSES = [
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'rejected', label: 'Bị từ chối' },
  { value: 'cancelled', label: 'Đã hủy' },
];

const initialRange = vietnamDateRangeYearToDate();
const PAYMENT_DEFAULTS = {
  searchTerm: '',
  status: '',
  businessTypeId: '',
  fromDate: initialRange.from, toDate: initialRange.to,
  page: 1,
  pageSize: 10,
  sort: { column: 'business_at', ascending: false },
};
const state = {
  ...PAYMENT_DEFAULTS,
  sort: { ...PAYMENT_DEFAULTS.sort },
  total: 0,
  requestId: 0,
  businessTypes: [],
  items: [],
  processingPaymentId: null,
};
let paymentMenuInteractionsBound = false;
let navigationProfile = null;

export function PaymentsPage({ profile } = {}) {
  hydratePaymentState(profile);
  return `
    ${PageHeader({
      title: 'Thanh toán',
      description: 'Theo dõi thanh toán Kiosk. Hệ thống tự hoàn tất khi ngân hàng xác nhận; xác nhận thủ công chỉ dùng cho ngoại lệ.',
    })}
    ${FilterBar({
      label: 'Bộ lọc thanh toán',
      className: 'payments-filter-bar',
      children: `
        <label class="filter-field filter-field-search">
          <span>Tìm kiếm</span>
          <input type="search" id="payment-search" class="form-control" placeholder="Khách hàng, Kiosk, loại hình, trạng thái…" aria-label="Tìm thanh toán" autocomplete="off" />
        </label>
        <label class="filter-field">
          <span>Trạng thái</span>
          <select id="payment-status-filter" class="filter-select" aria-label="Lọc trạng thái thanh toán">
            <option value="">Tất cả trạng thái</option>
            ${PAYMENT_STATUSES.map((status) => `<option value="${status.value}">${status.label}</option>`).join('')}
          </select>
        </label>
        <label class="filter-field">
          <span>Loại hình KD</span>
          <select id="payment-business-type-filter" class="filter-select" aria-label="Lọc loại hình kinh doanh">
            <option value="">Tất cả loại hình KD</option>
          </select>
        </label>
        ${DateRangeFields({ fromId: 'payment-from-date', toId: 'payment-to-date', fromLabel: 'Từ ngày', toLabel: 'Đến ngày' })}
        <button class="btn-secondary" id="payment-filter-reset" type="button">Đặt lại</button>
      `,
    })}
    <div class="payments-summary">
      ${StatCard({ tone: 'green', icon: renderIcon('money'), value: '<span id="payments-total-revenue">—</span>', label: 'Tổng thu' })}
      ${StatCard({ tone: 'blue', icon: renderIcon('calendar'), value: '<span id="payments-month-revenue">—</span>', label: 'Tháng này' })}
      ${StatCard({ tone: 'purple', icon: renderIcon('clock'), value: '<span id="payments-pending-count">—</span>', label: 'Chờ xác nhận' })}
    </div>
    <div id="payments-payos-hint"></div>
    <div class="table-card payments-table-card">
      <table class="data-table payments-table">
        <thead>
          <tr>${PAYMENT_COLUMNS.map(renderHeaderCell).join('')}</tr>
        </thead>
        <tbody id="payments-table-body">
          ${renderTableState('Đang tải thanh toán', 'Vui lòng chờ trong giây lát.')}
        </tbody>
      </table>
    </div>
    ${Pagination({ id: 'payments', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'thanh toán' })}
  `;
}

PaymentsPage.afterRender = function afterRenderPayments() {
  syncPaymentControls();
  bindPaymentEvents();
  bindPaymentMenuInteractions();
  bindPagination('payments', {
    onPage: (page) => { state.page = page; persistPaymentState(); loadPayments(); },
    onPageSize: (pageSize) => { state.pageSize = pageSize; state.page = 1; persistPaymentState(); loadPayments(); },
  });
  loadBusinessTypeOptions();
  loadPayments();
};

function syncPaymentControls() {
  for (const [id,key] of [['payment-from-date','fromDate'],['payment-to-date','toDate']]) { const input=document.getElementById(id); if(input) input.value=state[key]; }
  const searchInput = document.getElementById('payment-search');
  const statusFilter = document.getElementById('payment-status-filter');
  const businessTypeFilter = document.getElementById('payment-business-type-filter');
  const pageSizeSelect = document.getElementById('payments-page-size');

  if (searchInput) searchInput.value = state.searchTerm;
  if (statusFilter) statusFilter.value = state.status;
  if (businessTypeFilter) businessTypeFilter.value = state.businessTypeId;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
}

function bindPaymentEvents() {
  const searchInput = document.getElementById('payment-search');
  const statusFilter = document.getElementById('payment-status-filter');
  const businessTypeFilter = document.getElementById('payment-business-type-filter');
  const pageSizeSelect = document.getElementById('payments-page-size');
  const tableBody = document.getElementById('payments-table-body');

  document.getElementById('payment-filter-reset')?.addEventListener('click', resetPaymentFilters);

  for (const [id,key] of [['payment-from-date','fromDate'],['payment-to-date','toDate']]) document.getElementById(id)?.addEventListener('change', (event) => { state[key]=event.target.value; state.page=1; persistPaymentState(); loadPayments(); });

  searchInput?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    persistPaymentState();
    loadPayments();
  }, 300));

  statusFilter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    persistPaymentState();
    loadPayments();
  });

  businessTypeFilter?.addEventListener('change', (event) => {
    state.businessTypeId = event.target.value;
    state.page = 1;
    persistPaymentState();
    loadPayments();
  });


  document.querySelectorAll('[data-payment-sort-column]').forEach((button) => {
    button.addEventListener('click', () => {
      const column = button.dataset.paymentSortColumn;
      if (state.sort.column === column) {
        state.sort.ascending = !state.sort.ascending;
      } else {
        state.sort = { column, ascending: true };
      }
      state.page = 1;
      persistPaymentState();
      loadPayments();
    });
  });

  tableBody?.addEventListener('click', (event) => {
    const menuTrigger = event.target.closest('[data-payment-menu-trigger]');
    if (menuTrigger) {
      togglePaymentMenu(menuTrigger);
      return;
    }
    const button = event.target.closest('[data-payment-action]');
    if (!button || state.processingPaymentId) return;

    const action = button.dataset.paymentAction;
    const paymentId = button.dataset.paymentId;
    const payment = state.items.find((item) => String(item.id) === paymentId);
    if (!payment) return;
    closePaymentMenus();

    switch (action) {
      case 'approve':
        openPaymentApproval(payment);
        break;
      case 'cancel':
        openPaymentCancellation(payment);
        break;
      case 'edit':
        openPaymentEditForm({ payment, onSaved: loadPayments });
        break;
      case 'adjust':
        openPaymentAdjustment(payment);
        break;
      case 'payos':
        openPaymentPayos(payment);
        break;
    }
  });
}

async function loadBusinessTypeOptions() {
  const select = document.getElementById('payment-business-type-filter');
  if (!select) return;

  select.disabled = true;

  try {
    const { data } = await BusinessTypeService.listActive();
    state.businessTypes = data || [];
    renderBusinessTypeOptions();
  } catch (error) {
    state.businessTypes = [];
    select.innerHTML = '<option value="">Không tải được loại hình KD</option>';
  } finally {
    select.disabled = false;
  }
}

async function loadPayments() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const filters = {
      searchTerm: state.searchTerm,
      status: state.status,
      businessTypeId: state.businessTypeId,
      fromDate: state.fromDate, toDate: state.toDate,
    };
    const { data, count, summary } = await PaymentService.listWithSummary({
      ...filters,
      sort: state.sort,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count || 0;
    const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page > lastPage) {
      state.page = lastPage;
      persistPaymentState();
      return loadPayments();
    }
    state.items = data || [];
    renderSummary(summary);
    renderPayments(data || []);
    renderPagination();
    renderSortState();
    restoreListScroll('payments', navigationProfile);
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderBusinessTypeOptions() {
  const select = document.getElementById('payment-business-type-filter');
  if (!select) return;

  select.innerHTML = `
    <option value="">Tất cả loại hình KD</option>
    ${state.businessTypes.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.name || 'Không tên')}</option>
    `).join('')}
  `;
  select.value = state.businessTypeId;
}

function renderPayments(payments) {
  const body = document.getElementById('payments-table-body');
  if (!body) return;

  if (!payments.length) {
    body.innerHTML = renderTableState(
      'Không tìm thấy thanh toán',
      'Không có bản ghi nào khớp với bộ lọc hiện tại.',
    );
    return;
  }

  closePaymentMenus();
  const startIndex = (state.page - 1) * state.pageSize;
  body.innerHTML = payments.map((payment, index) => {
    const rowNumber = startIndex + index + 1;
    return `
    <tr>
      <td class="payment-desktop-cell payment-card-index" data-label="STT"><a class="payment-row-number" href="#/payment-detail?id=${encodeURIComponent(payment.id)}">${rowNumber}</a></td>
      <td class="payment-desktop-cell payment-card-party" data-label="Kiosk / Khách hàng">${renderPaymentParty(payment)}</td>
      <td class="payment-desktop-cell payment-card-service" data-label="Dịch vụ / Kỳ hạn">${renderPaymentService(payment)}</td>
      <td class="payment-desktop-cell payment-card-amount" data-label="Thanh toán">${renderPaymentAmount(payment)}</td>
      <td class="payment-desktop-cell payment-card-status" data-label="Trạng thái">${renderPaymentStatusBadge(payment.payment_status)}</td>
      <td class="payment-desktop-cell payment-card-confirmer" data-label="Người xác nhận">${renderConfirmer(payment)}</td>
      <td class="payment-desktop-cell payment-card-time" data-label="Thời gian">${renderPaymentTime(payment.payment_status === 'completed' ? payment.confirmed_at : payment.created_at)}</td>
      <td class="payment-desktop-cell payment-card-actions" data-label="Thao tác">${renderApprovalAction(payment)}</td>
      ${renderMobilePaymentCard(payment, rowNumber)}
    </tr>
  `;
  }).join('');
}

function renderMobilePaymentCard(payment, rowNumber) {
  const detailHref = `#/payment-detail?id=${encodeURIComponent(payment.id)}`;
  const timeValue = payment.payment_status === 'completed' ? payment.confirmed_at : payment.created_at;
  return `
    <td class="payment-mobile-card" colspan="${PAYMENT_COLUMNS.length}">
      <div class="payment-mobile-content">
        <div class="payment-mobile-header">
          <a class="payment-mobile-index" href="${detailHref}" aria-label="Mở thanh toán số ${rowNumber}"><span>STT</span><strong>${rowNumber}</strong></a>
          <div class="payment-mobile-status">${renderPaymentStatusBadge(payment.payment_status)}</div>
          <div class="payment-mobile-actions">${renderApprovalAction(payment)}</div>
        </div>
        <div class="payment-mobile-party">${renderPaymentParty(payment)}</div>
        <div class="payment-mobile-section payment-mobile-amount">
          <span class="payment-mobile-label">Tổng tiền</span>
          ${renderPaymentAmount(payment)}
        </div>
        <div class="payment-mobile-section">
          <span class="payment-mobile-label">Dịch vụ · Kỳ hạn</span>
          ${renderPaymentService(payment)}
        </div>
        <div class="payment-mobile-section">
          <span class="payment-mobile-label">Người xác nhận</span>
          ${renderConfirmer(payment)}
        </div>
        <div class="payment-mobile-section payment-mobile-time">
          <span class="payment-mobile-label">Thời gian</span>
          ${renderPaymentTime(timeValue)}
        </div>
      </div>
    </td>
  `;
}

function renderSummary(summary = {}) {
  setText('payments-total-revenue', formatCurrency(summary.totalRevenue || 0));
  setText('payments-month-revenue', formatCurrency(summary.monthRevenue || 0));
  setText('payments-pending-count', String(summary.pendingCount || 0));
  renderPayosHint(summary);
}

function renderApprovalAction(payment) {
  const status = String(payment.payment_status || '').toLowerCase();
  const isProcessing = String(state.processingPaymentId) === String(payment.id);
  const actions = status === 'pending' ? `
      ${paymentActionButton('payos', payment.id, 'Tạo/Mở PayOS', 'money', { disabled: isProcessing })}
      ${paymentActionButton('approve', payment.id, 'Xác nhận thủ công', 'check-circle', { disabled: isProcessing })}
      ${paymentActionButton('edit', payment.id, 'Sửa thanh toán', 'edit', { disabled: isProcessing })}
      ${paymentActionButton('cancel', payment.id, 'Hủy thanh toán', 'x-circle', { danger: true, disabled: isProcessing })}
    ` : status === 'completed' ? `
      ${paymentActionButton('edit', payment.id, 'Sửa ghi chú', 'edit')}
      ${payment.transaction_type === 'adjustment' ? '' : paymentActionButton('adjust', payment.id, 'Tạo điều chỉnh', 'money')}
    ` : '<span class="payment-action-empty" role="menuitem" aria-disabled="true">Không có thao tác</span>';

  return `<div class="payment-action-menu" data-payment-menu>
    <button class="payment-action-trigger" type="button" data-payment-menu-trigger aria-haspopup="menu" aria-expanded="false" aria-label="Mở thao tác thanh toán" title="Thao tác"><span aria-hidden="true">…</span></button>
    <div class="payment-action-dropdown hidden" role="menu" aria-label="Thao tác thanh toán ${escapeHtml(payment.id)}">${actions}</div>
  </div>`;
}

function paymentActionButton(action, paymentId, label, icon, { danger = false, disabled = false } = {}) {
  return `<button class="${danger ? 'is-danger' : ''}" type="button" role="menuitem" data-payment-action="${action}" data-payment-id="${escapeHtml(paymentId)}" ${disabled ? 'disabled' : ''}>${renderIcon(icon)}<span>${label}</span></button>`;
}

function togglePaymentMenu(trigger) {
  const menu = trigger.closest('[data-payment-menu]');
  const dropdown = menu?.querySelector('.payment-action-dropdown');
  if (!dropdown) return;
  const shouldOpen = dropdown.classList.contains('hidden');
  closePaymentMenus();
  if (!shouldOpen) return;
  dropdown.classList.remove('hidden');
  trigger.setAttribute('aria-expanded', 'true');
  positionPaymentMenu(trigger, dropdown);
  dropdown.querySelector('button[role="menuitem"]:not([disabled])')?.focus();
}

function closePaymentMenus() {
  document.querySelectorAll('[data-payment-menu]').forEach((menu) => {
    menu.querySelector('.payment-action-dropdown')?.classList.add('hidden');
    menu.querySelector('[data-payment-menu-trigger]')?.setAttribute('aria-expanded', 'false');
  });
}

function positionPaymentMenu(trigger, dropdown) {
  const rect = trigger.getBoundingClientRect();
  const width = 210;
  const left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.right - width));
  const roomBelow = window.innerHeight - rect.bottom;
  const menuHeight = dropdown.offsetHeight;
  dropdown.style.left = `${left}px`;
  dropdown.style.top = roomBelow < menuHeight + 12
    ? `${Math.max(10, rect.top - menuHeight - 6)}px`
    : `${rect.bottom + 6}px`;
}

function bindPaymentMenuInteractions() {
  if (paymentMenuInteractionsBound) return;
  paymentMenuInteractionsBound = true;
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-payment-menu]')) closePaymentMenus();
  });
  document.addEventListener('keydown', (event) => {
    const openMenu = document.querySelector('[data-payment-menu] .payment-action-dropdown:not(.hidden)');
    if (!openMenu) return;
    if (event.key === 'Escape') {
      const trigger = openMenu.closest('[data-payment-menu]')?.querySelector('[data-payment-menu-trigger]');
      closePaymentMenus();
      trigger?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const items = [...openMenu.querySelectorAll('button[role="menuitem"]:not([disabled])')];
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement));
    items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  window.addEventListener('resize', closePaymentMenus);
  window.addEventListener('scroll', closePaymentMenus, true);
}

function openPaymentPayos(payment) {
  Modal.open({
    title: `Tạo/Mở PayOS #${escapeHtml(payment.id)}`,
    body: `
      <div class="approval-message">
        <p>Tạo link thanh toán cho khoản đang chờ của Kiosk <strong>${escapeHtml(payment.kiosks?.facebook_name || '—')}</strong>.</p>
        <div class="registration-summary">
          <div class="setting-item"><span class="setting-name">Khách hàng</span><span class="setting-value">${escapeHtml(payment.customers?.facebook_name || '—')}</span></div>
          <div class="setting-item"><span class="setting-name">Số tiền</span><span class="setting-value">${formatCurrency(payment.total_amount || 0)}</span></div>
        </div>
        <p class="muted-text">Sau khi ngân hàng xác nhận thành công, hệ thống sẽ tự xác nhận thanh toán và kích hoạt Kiosk. Màn hình này chỉ tạo QR/link để khách thanh toán.</p>
        <div id="payment-payos-result"></div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-payos-close>Đóng</button>
        <button class="btn-primary" type="button" data-payos-create>Tạo/Mở PayOS</button>
      </div>
    `,
  });

  document.querySelector('[data-payos-close]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-payos-create]')?.addEventListener('click', (event) => {
    createPaymentPayos(payment, event.currentTarget);
  });
}

async function createPaymentPayos(payment, button) {
  if (state.processingPaymentId) return;

  state.processingPaymentId = payment.id;
  button.disabled = true;
  button.textContent = 'Đang tạo...';
  setPayosResult('Đang tạo link thanh toán...', true);

  try {
    const { data } = await PayosService.createCrmPayment({
      paymentId: payment.id,
      amount: Number(payment.total_amount || 0),
      description: `DHL${payment.id}`,
      returnUrl: buildPayosRouteUrl('#/payments'),
      cancelUrl: buildPayosRouteUrl('#/payments'),
    });
    setPayosResult(renderPayosResult(data), false, true);
    bindPayosCopyButtons(document);
    watchPayosPaymentStatus(document, {
      onPaid: () => {
        Toast.show('PayOS đã xác nhận thanh toán.');
        loadPayments();
      },
    });
    button.textContent = 'Đã tạo link';
    Toast.show('Đã tạo link thanh toán. Chờ ngân hàng xác nhận khi khách thanh toán.');
  } catch (error) {
    setPayosResult(escapeHtml(error?.message || 'Không tạo được link thanh toán.'), false);
    button.disabled = false;
    button.textContent = 'Tạo/Mở PayOS';
  } finally {
    state.processingPaymentId = null;
  }
}

function openPaymentApproval(payment) {
  Modal.open({
    title: 'Xác nhận thủ công',
    body: `
      <div class="approval-message">
        <p>Chỉ dùng khi khách đã chuyển khoản nhưng hệ thống chưa tự xử lý. Xác nhận đã nhận tiền cho Kiosk <strong>${escapeHtml(payment.kiosks?.facebook_name || '—')}</strong>?</p>
        <div class="registration-summary">
          <div class="setting-item"><span class="setting-name">Khách hàng</span><span class="setting-value">${escapeHtml(payment.customers?.facebook_name || '—')}</span></div>
          <div class="setting-item"><span class="setting-name">Số tiền</span><span class="setting-value">${formatCurrency(payment.total_amount || 0)}</span></div>
        </div>
        <p class="muted-text">Luồng tự động sẽ hoàn tất khi ngân hàng xác nhận; thao tác thủ công là fallback có trách nhiệm đối soát.</p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-approval-cancel>Đóng</button>
        <button class="btn-primary" type="button" data-approval-confirm>Xác nhận thủ công</button>
      </div>
    `,
  });

  document.querySelector('[data-approval-cancel]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-approval-confirm]')?.addEventListener('click', (event) => {
    confirmPayment(payment.id, event.currentTarget);
  });
}

function openPaymentCancellation(payment) {
  Modal.open({
    title: 'Hủy thanh toán',
    body: `
      <div class="approval-message">
        <p>Hủy thanh toán Pending cho Kiosk <strong>${escapeHtml(payment.kiosks?.facebook_name || '—')}</strong>?</p>
        <div class="registration-summary">
          <div class="setting-item"><span class="setting-name">Khách hàng</span><span class="setting-value">${escapeHtml(payment.customers?.facebook_name || '—')}</span></div>
          <div class="setting-item"><span class="setting-name">Số tiền</span><span class="setting-value">${formatCurrency(payment.total_amount || 0)}</span></div>
        </div>
        <label class="form-group">
          <span>Lý do hủy *</span>
          <textarea class="form-control" id="payment-cancel-reason" rows="2" required></textarea>
        </label>
        <p class="muted-text">Hủy thanh toán không tự động thay đổi hồ sơ Khách hàng hoặc Kiosk.</p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-cancellation-close>Đóng</button>
        <button class="btn-danger" type="button" data-cancellation-confirm>Hủy thanh toán</button>
      </div>
    `,
  });

  document.querySelector('[data-cancellation-close]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-cancellation-confirm]')?.addEventListener('click', (event) => {
    cancelPayment(payment.id, event.currentTarget);
  });
}

async function confirmPayment(paymentId, button) {
  if (state.processingPaymentId) return;

  state.processingPaymentId = paymentId;
  button.disabled = true;
  button.textContent = 'Đang xác nhận...';

  try {
    await PaymentService.confirm(paymentId);
    Modal.close();
    Toast.show('Đã xác nhận thủ công và kích hoạt hồ sơ đăng ký.');
    await loadPayments();
  } catch (error) {
    Toast.show(error?.message || 'Không thể xác nhận thanh toán.');
    button.disabled = false;
    button.textContent = 'Xác nhận thủ công';
  } finally {
    state.processingPaymentId = null;
  }
}

async function cancelPayment(paymentId, button) {
  if (state.processingPaymentId) return;

  state.processingPaymentId = paymentId;
  button.disabled = true;
  button.textContent = 'Đang hủy...';

  try {
    const reason = document.getElementById('payment-cancel-reason')?.value.trim();
    await PaymentService.cancel(paymentId, reason);
    Modal.close();
    Toast.show('Đã hủy thanh toán.');
    await loadPayments();
  } catch (error) {
    Toast.show(error?.message || 'Không thể hủy đăng ký.');
    button.disabled = false;
    button.textContent = 'Hủy thanh toán';
  } finally {
    state.processingPaymentId = null;
  }
}

function openPaymentRejection(payment) {
  Modal.open({
    title: 'Từ chối thanh toán',
    body: `
      <div class="approval-message">
        <p>Từ chối thanh toán cho Kiosk <strong>${escapeHtml(payment.kiosks?.facebook_name || '—')}</strong>?</p>
        <label class="form-group">
          <span>Lý do từ chối *</span>
          <textarea class="form-control" id="payment-reject-reason" rows="2" required></textarea>
        </label>
        <p class="muted-text">Thao tác này sẽ đánh dấu thanh toán là "Bị từ chối" và không thể hoàn tác.</p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-rejection-close>Đóng</button>
        <button class="btn-danger" type="button" data-rejection-confirm>Từ chối</button>
      </div>
    `,
  });

  document.querySelector('[data-rejection-close]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-rejection-confirm]')?.addEventListener('click', (event) => {
    rejectPayment(payment.id, event.currentTarget);
  });
}

async function rejectPayment(paymentId, button) {
  if (state.processingPaymentId) return;

  state.processingPaymentId = paymentId;
  button.disabled = true;
  button.textContent = 'Đang từ chối...';

  try {
    const reason = document.getElementById('payment-reject-reason')?.value.trim();
    await PaymentService.reject(paymentId, reason);
    Modal.close();
    Toast.show('Đã từ chối thanh toán.');
    await loadPayments();
  } catch (error) {
    Toast.show(error?.message || 'Không thể từ chối thanh toán.');
    button.disabled = false;
    button.textContent = 'Từ chối';
  } finally {
    state.processingPaymentId = null;
  }
}

function openPaymentAdjustment(payment) {
  Modal.open({
    title: `Điều chỉnh thanh toán #${escapeHtml(payment.id)}`,
    body: `
      <div class="approval-message">
        <p>Thanh toán đã hoàn tất ban đầu sẽ được giữ nguyên. Hệ thống sẽ tạo một giao dịch điều chỉnh mới.</p>
        <div class="form-row">
          <label class="form-group">
            <span>Chênh lệch số tiền *</span>
            <input class="form-control" id="payment-adjustment-amount" type="text" inputmode="numeric" placeholder="0 VNĐ" required />
          </label>
          <label class="form-group">
            <span>Chênh lệch số tháng</span>
            <input class="form-control" id="payment-adjustment-months" type="number" step="1" value="0" />
          </label>
        </div>
        <label class="form-group">
          <span>Lý do điều chỉnh *</span>
          <textarea class="form-control" id="payment-adjustment-reason" rows="3" required></textarea>
        </label>
        <p class="muted-text">Dùng số âm để giảm/đảo ngược, số dương để bổ sung. Điều chỉnh kỳ hạn chỉ áp dụng cho thanh toán dịch vụ mới nhất.</p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-adjustment-close>Đóng</button>
        <button class="btn-primary" type="button" data-adjustment-confirm>Tạo điều chỉnh</button>
      </div>
    `,
  });

  bindCurrencyInput(document.getElementById('payment-adjustment-amount'), { allowNegative: true });

  document.querySelector('[data-adjustment-close]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-adjustment-confirm]')?.addEventListener('click', (event) => {
    createAdjustment(payment.id, event.currentTarget);
  });
}

async function createAdjustment(paymentId, button) {
  if (state.processingPaymentId) return;
  state.processingPaymentId = paymentId;
  button.disabled = true;
  button.textContent = 'Đang tạo...';

  try {
    await PaymentService.createAdjustment(paymentId, {
      amountDelta: parseCurrencyInput(document.getElementById('payment-adjustment-amount')?.value, { allowNegative: true }),
      serviceMonthDelta: document.getElementById('payment-adjustment-months')?.value,
      reason: document.getElementById('payment-adjustment-reason')?.value,
    });
    Modal.close();
    Toast.show('Đã tạo giao dịch điều chỉnh.');
    await loadPayments();
  } catch (error) {
    Toast.show(error?.message || 'Không thể tạo giao dịch điều chỉnh.');
    button.disabled = false;
    button.textContent = 'Tạo điều chỉnh';
  } finally {
    state.processingPaymentId = null;
  }
}

function renderPaymentParty(payment) {
  const kioskName = escapeHtml(payment.kiosks?.facebook_name || 'Kiosk không còn liên kết');
  const customerName = escapeHtml(payment.customers?.facebook_name || 'Khách hàng không còn liên kết');
  const kiosk = payment.kiosk_id
    ? `<a class="payment-primary-link" href="#/kiosk-detail?id=${encodeURIComponent(payment.kiosk_id)}">${kioskName}</a>`
    : `<strong>${kioskName}</strong>`;
  const customer = payment.customer_id
    ? `<a href="#/customer-detail?id=${encodeURIComponent(payment.customer_id)}">${customerName}</a>`
    : customerName;
  return `<div class="payment-cell-stack payment-party">${kiosk}<small>${customer}</small></div>`;
}

function renderPaymentService(payment) {
  const businessType = escapeHtml(payment.kiosks?.business_types?.name || 'Chưa có dịch vụ');
  const months = Number(payment.months || 0);
  return `<div class="payment-cell-stack"><strong class="payment-service-name">${businessType}</strong><small>${months} tháng</small></div>`;
}

function renderPaymentAmount(payment) {
  const discount = Number(payment.discount || 0);
  return `<div class="payment-cell-stack payment-money">
    <strong>${formatCurrency(payment.total_amount || 0)}</strong>
    <small>${formatCurrency(payment.price_per_month || 0)} / tháng</small>
    ${discount > 0 ? `<small class="payment-discount">Giảm ${formatCurrency(discount)}</small>` : ''}
  </div>`;
}

export function paymentConfirmerLabel(payment = {}) {
  const status = String(payment.payment_status || '').toLowerCase();
  if (status !== 'completed') return { primary: 'Chưa xác nhận', secondary: '', kind: 'pending' };

  const profile = payment.confirmer_profile;
  const profileName = profile?.display_name || profile?.username || profile?.email;
  if (profileName) return { primary: profileName, secondary: 'Xác nhận thủ công', kind: 'person' };

  const storedName = payment.confirmed_by_name || payment.confirmed_by_user || payment.confirmed_by_email;
  if (storedName) return { primary: storedName, secondary: 'Xác nhận thủ công', kind: 'person' };

  const confirmerId = String(payment.confirmed_by || '').trim();
  if (confirmerId && isUuid(confirmerId)) {
    return { primary: 'Tài khoản CRM cũ', secondary: 'Hồ sơ người dùng không còn khả dụng', kind: 'legacy' };
  }

  if (hasPayosEvidence(payment)) {
    return { primary: 'PayOS tự động', secondary: 'Ngân hàng đã xác nhận', kind: 'payos' };
  }

  if (String(payment.payment_method || '').toLowerCase() === 'legacy') {
    return { primary: 'Quy trình Legacy', secondary: 'Dữ liệu chuyển đổi', kind: 'legacy' };
  }

  if (confirmerId) {
    return { primary: 'Quy trình cũ', secondary: 'Định danh cũ không có hồ sơ CRM', kind: 'legacy' };
  }
  return { primary: 'Dữ liệu cũ', secondary: 'Không lưu người xác nhận', kind: 'legacy' };
}

function hasPayosEvidence(payment) {
  return Boolean(payment.payos_order_code
    || payment.payos_checkout_state
    || String(payment.payment_method || '').toLowerCase() === 'payos'
    || /^payos\b/i.test(String(payment.note || '').trim()));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function renderConfirmer(payment) {
  const label = paymentConfirmerLabel(payment);
  return `<div class="payment-cell-stack payment-confirmer is-${label.kind}"><strong>${escapeHtml(label.primary)}</strong>${label.secondary ? `<small>${escapeHtml(label.secondary)}</small>` : ''}</div>`;
}

function renderHeaderCell(column) {
  if (!column.key) return `<th>${column.label}</th>`;
  return `
    <th>
      <button class="sort-button" type="button" data-payment-sort-column="${column.key}">
        ${column.label}<span class="sort-icon"></span>
      </button>
    </th>
  `;
}

function setLoadingState() {
  const body = document.getElementById('payments-table-body');
  if (body) {
    body.innerHTML = renderTableState('Đang tải thanh toán', 'Vui lòng chờ trong giây lát.');
  }
}

function renderError(error) {
  const body = document.getElementById('payments-table-body');
  state.total = 0;
  renderSummary();

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải thanh toán',
      error?.message || 'Không thể tải danh sách thanh toán. Vui lòng thử lại.',
    );
  }

  renderPagination();
  restoreListScroll('payments', navigationProfile);
}

function hydratePaymentState(profile) {
  navigationProfile = profile || null;
  const saved = readListNavigationState('payments', PAYMENT_DEFAULTS, navigationProfile);
  state.searchTerm = typeof saved.searchTerm === 'string' ? saved.searchTerm : '';
  state.status = typeof saved.status === 'string' ? saved.status : '';
  state.businessTypeId = typeof saved.businessTypeId === 'string' ? saved.businessTypeId : '';
  state.fromDate = validDateFilter(saved.fromDate, PAYMENT_DEFAULTS.fromDate);
  state.toDate = validDateFilter(saved.toDate, PAYMENT_DEFAULTS.toDate);
  state.page = positiveInteger(saved.page, PAYMENT_DEFAULTS.page);
  state.pageSize = PAGE_SIZE_OPTIONS.includes(Number(saved.pageSize)) ? Number(saved.pageSize) : PAYMENT_DEFAULTS.pageSize;
  state.sort = normalizePaymentSort(saved.sort);
}

function persistPaymentState() {
  writeListNavigationState('payments', {
    searchTerm: state.searchTerm,
    status: state.status,
    businessTypeId: state.businessTypeId,
    fromDate: state.fromDate,
    toDate: state.toDate,
    page: state.page,
    pageSize: state.pageSize,
    sort: state.sort,
  }, navigationProfile);
}

function resetPaymentFilters() {
  clearListNavigationState('payments', navigationProfile);
  Object.assign(state, PAYMENT_DEFAULTS, { sort: { ...PAYMENT_DEFAULTS.sort } });
  syncPaymentControls();
  persistPaymentState();
  loadPayments();
}

function normalizePaymentSort(sort) {
  const columns = PAYMENT_COLUMNS.map((column) => column.key).filter(Boolean);
  return {
    column: columns.includes(sort?.column) ? sort.column : PAYMENT_DEFAULTS.sort.column,
    ascending: typeof sort?.ascending === 'boolean' ? sort.ascending : PAYMENT_DEFAULTS.sort.ascending,
  };
}

function validDateFilter(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function renderTableState(title, message) {
  return `
    <tr>
      <td colspan="${PAYMENT_COLUMNS.length}">
        ${EmptyState({ title, message: escapeHtml(message) })}
      </td>
    </tr>
  `;
}

function renderPagination() {
  updatePagination({ id: 'payments', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'thanh toán' });
}

function renderPayosHint(summary = {}) {
  const hint = document.getElementById('payments-payos-hint');
  if (!hint) return;
  const pendingCount = Number(summary.pendingCount || 0);
  if (pendingCount > 0 || state.status === 'pending') {
    hint.innerHTML = '';
    return;
  }
  hint.innerHTML = `
    <div class="notice warning payments-payos-hint">
      <strong>Thanh toán</strong>
      <span>Nút tạo link chỉ hiện với thanh toán Chờ xác nhận. Hiện chưa có thanh toán chờ xử lý trong bộ lọc này.</span>
    </div>
  `;
}

function renderSortState() {
  document.querySelectorAll('[data-payment-sort-column]').forEach((button) => {
    const active = button.dataset.paymentSortColumn === state.sort.column;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? (state.sort.ascending ? 'asc' : 'desc') : '';
  });
}

function renderPaymentStatusBadge(status) {
  return StatusBadge(status, { labels: { pending: 'Chờ xác nhận', rejected: 'Bị từ chối' } });
}

function renderPaymentTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  const dateText = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  const timeText = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `<time class="payment-cell-stack payment-time" datetime="${escapeHtml(value)}"><strong>${escapeHtml(dateText)}</strong><small>${escapeHtml(timeText)}</small></time>`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.pageSize));
}

function buildPayosRouteUrl(route) {
  return `${window.location.origin}${window.location.pathname}${route}`;
}

function setPayosResult(content, isMuted = false, isHtml = false) {
  const container = document.getElementById('payment-payos-result');
  if (!container) return;
  container.innerHTML = isHtml
    ? content
    : `<p class="${isMuted ? 'muted-text' : 'error-text'}">${content}</p>`;
}

function renderPayosResult(data = {}) {
  return PayosResultCard({
    checkoutUrl: data.checkoutUrl,
    orderCode: data.orderCode,
    paymentLinkId: data.paymentLinkId,
    note: 'Mở hoặc gửi link PayOS. Webhook sẽ tự xác nhận thanh toán.',
  });
}
