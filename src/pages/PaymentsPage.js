import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { bindPayosCopyButtons, PayosResultCard, watchPayosPaymentStatus } from '../components/PayosResultCard.js';
import { StatCard } from '../components/StatCard.js';
import { Toast } from '../components/Toast.js';
import { Toolbar } from '../components/Toolbar.js';
import { openPaymentEditForm } from '../components/PaymentEditForm.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { PayosService } from '../services/PayosService.js';
import { PaymentService } from '../services/PaymentService.js';
import { bindCurrencyInput, formatCurrency, parseCurrencyInput } from '../utils/currency.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const PAYMENT_COLUMNS = [
  { label: '#', key: null },
  { label: 'Khách hàng', key: null },
  { label: 'Kiosk', key: null },
  { label: 'Loại hình KD', key: null },
  { label: 'Số tháng', key: 'months' },
  { label: 'Giảm giá', key: 'discount' },
  { label: 'Giá/tháng', key: 'price_per_month' },
  { label: 'Tổng tiền', key: 'total_amount' },
  { label: 'Trạng thái thanh toán', key: 'payment_status' },
  { label: 'Người xác nhận', key: null },
  { label: 'Ngày tạo', key: 'created_at' },
  { label: 'Hành động', key: null },
];

const PAYMENT_STATUSES = [
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'rejected', label: 'Bị từ chối' },
  { value: 'cancelled', label: 'Đã hủy' },
];

const state = {
  searchTerm: '',
  status: '',
  businessTypeId: '',
  page: 1,
  pageSize: 10,
  sort: { column: 'created_at', ascending: false },
  total: 0,
  requestId: 0,
  businessTypes: [],
  items: [],
  processingPaymentId: null,
};

export function PaymentsPage() {
  return `
    ${PageHeader({
      title: 'Thanh toán',
      description: 'Theo dõi thanh toán Kiosk. Hệ thống tự hoàn tất khi ngân hàng xác nhận; xác nhận thủ công chỉ dùng cho ngoại lệ.',
    })}
    ${Toolbar({
      children: `
        <input
          type="search"
          id="payment-search"
          class="form-control"
          placeholder="Tìm theo khách hàng, kiosk, loại hình KD, trạng thái"
          aria-label="Tìm thanh toán"
          autocomplete="off"
        />
        <select id="payment-status-filter" class="filter-select" aria-label="Lọc trạng thái thanh toán">
          <option value="">Tất cả trạng thái</option>
          ${PAYMENT_STATUSES.map((status) => `<option value="${status.value}">${status.label}</option>`).join('')}
        </select>
        <select id="payment-business-type-filter" class="filter-select" aria-label="Lọc loại hình kinh doanh">
          <option value="">Tất cả loại hình KD</option>
        </select>
      `,
    })}
    <div class="payments-summary">
      ${StatCard({ tone: 'green', icon: '💰', value: '<span id="payments-total-revenue">—</span>', label: 'Tổng thu' })}
      ${StatCard({ tone: 'blue', icon: '📅', value: '<span id="payments-month-revenue">—</span>', label: 'Tháng này' })}
      ${StatCard({ tone: 'purple', icon: '⏳', value: '<span id="payments-pending-count">—</span>', label: 'Chờ xác nhận' })}
    </div>
    <div id="payments-payos-hint"></div>
    <div class="table-card payments-table-card">
      <table class="data-table payments-table">
        <thead>
          <tr>${PAYMENT_COLUMNS.map(renderHeaderCell).join('')}</tr>
        </thead>
        <tbody id="payments-table-body">
          ${renderTableState('Đang tải thanh toán', 'Đang đọc dữ liệu từ Supabase.')}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <div id="payments-page-summary" class="pagination-summary">—</div>
      <div class="pagination-controls">
        <select id="payments-page-size" class="filter-select compact" aria-label="Số dòng mỗi trang">
          ${PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}" ${size === state.pageSize ? 'selected' : ''}>${size} / trang</option>`).join('')}
        </select>
        <button id="payments-prev-page" class="btn-secondary" type="button">Trước</button>
        <button id="payments-next-page" class="btn-secondary" type="button">Sau</button>
      </div>
    </div>
  `;
}

PaymentsPage.afterRender = function afterRenderPayments() {
  syncPaymentControls();
  bindPaymentEvents();
  loadBusinessTypeOptions();
  loadPayments();
};

function syncPaymentControls() {
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

  searchInput?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    loadPayments();
  }, 300));

  statusFilter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadPayments();
  });

  businessTypeFilter?.addEventListener('change', (event) => {
    state.businessTypeId = event.target.value;
    state.page = 1;
    loadPayments();
  });

  pageSizeSelect?.addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    loadPayments();
  });

  document.getElementById('payments-prev-page')?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadPayments();
  });

  document.getElementById('payments-next-page')?.addEventListener('click', () => {
    if (state.page >= totalPages()) return;
    state.page += 1;
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
      loadPayments();
    });
  });

  tableBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-payment-action]');
    if (!button || state.processingPaymentId) return;

    const action = button.dataset.paymentAction;
    const paymentId = button.dataset.paymentId;
    const payment = state.items.find((item) => String(item.id) === paymentId);
    if (!payment) return;

    switch (action) {
      case 'approve':
        openPaymentApproval(payment);
        break;
      case 'cancel':
        openPaymentCancellation(payment);
        break;
      case 'reject':
        openPaymentRejection(payment);
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
    };
    const { data, count, summary } = await PaymentService.listWithSummary({
      ...filters,
      sort: state.sort,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count || 0;
    state.items = data || [];
    renderSummary(summary);
    renderPayments(data || []);
    renderPagination();
    renderSortState();
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

  const startIndex = (state.page - 1) * state.pageSize;
  body.innerHTML = payments.map((payment, index) => `
    <tr>
      <td><a class="table-link" href="#/payment-detail?id=${payment.id}">${startIndex + index + 1}</a></td>
      <td>${renderCustomer(payment)}</td>
      <td>${renderKiosk(payment)}</td>
      <td>${escapeHtml(payment.kiosks?.business_types?.name || '—')}</td>
      <td>${Number(payment.months || 0)}</td>
      <td>${formatCurrency(payment.discount || 0)}</td>
      <td>${formatCurrency(payment.price_per_month || 0)}</td>
      <td class="strong-cell">${formatCurrency(payment.total_amount || 0)}</td>
      <td>${renderPaymentStatusBadge(payment.payment_status)}</td>
      <td>${escapeHtml(confirmedBy(payment))}</td>
      <td>${formatDateTime(payment.created_at)}</td>
      <td>${renderApprovalAction(payment)}</td>
    </tr>
  `).join('');
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

  if (status === 'completed') {
    return `
      <div class="payment-approval-actions">
        <span class="approval-state approved">Đã hoàn tất</span>
        <details class="row-action-menu">
          <summary>Khác</summary>
          <div class="row-action-menu-panel">
            <button class="table-action-button" type="button" data-payment-action="edit" data-payment-id="${escapeHtml(payment.id)}">Sửa ghi chú</button>
            ${payment.transaction_type === 'adjustment' ? '' : `<button class="table-action-button" type="button" data-payment-action="adjust" data-payment-id="${escapeHtml(payment.id)}">Điều chỉnh</button>`}
          </div>
        </details>
      </div>
    `;
  }
  if (status === 'rejected') {
    return '<span class="approval-state rejected">Đã từ chối</span>';
  }
  if (status === 'cancelled') {
    return '<span class="approval-state cancelled">Đã hủy</span>';
  }
  if (status !== 'pending') return '—';

  return `
    <div class="payment-approval-actions">
      <button class="table-approve-button" type="button" data-payment-action="payos" data-payment-id="${escapeHtml(payment.id)}" ${isProcessing ? 'disabled' : ''}>Tạo link</button>
      <details class="row-action-menu">
        <summary>Khác</summary>
        <div class="row-action-menu-panel">
          <button class="table-action-button" type="button" data-payment-action="approve" data-payment-id="${escapeHtml(payment.id)}" ${isProcessing ? 'disabled' : ''}>Xác nhận thủ công</button>
          <button class="table-action-button" type="button" data-payment-action="edit" data-payment-id="${escapeHtml(payment.id)}" ${isProcessing ? 'disabled' : ''}>Sửa</button>
          <button class="table-reject-button" type="button" data-payment-action="reject" data-payment-id="${escapeHtml(payment.id)}" ${isProcessing ? 'disabled' : ''}>Từ chối</button>
          <button class="table-cancel-button" type="button" data-payment-action="cancel" data-payment-id="${escapeHtml(payment.id)}" ${isProcessing ? 'disabled' : ''}>Hủy</button>
        </div>
      </details>
    </div>
  `;
}

function openPaymentPayos(payment) {
  Modal.open({
    title: `Tạo link thanh toán #${escapeHtml(payment.id)}`,
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
        <button class="btn-primary" type="button" data-payos-create>Tạo link thanh toán</button>
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
    button.textContent = 'Tạo link thanh toán';
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
        <p>Thanh toán Completed gốc sẽ được giữ nguyên. Database sẽ tạo một giao dịch điều chỉnh mới.</p>
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

function renderCustomer(payment) {
  const name = payment.customers?.facebook_name || '—';
  if (!payment.customer_id) return escapeHtml(name);
  return `<a class="table-link" href="#/customer-detail?id=${encodeURIComponent(payment.customer_id)}">${escapeHtml(name)}</a>`;
}

function renderKiosk(payment) {
  const name = payment.kiosks?.facebook_name || '—';
  if (!payment.kiosk_id) return escapeHtml(name);
  return `<a class="table-link" href="#/kiosk-detail?id=${encodeURIComponent(payment.kiosk_id)}">${escapeHtml(name)}</a>`;
}

function confirmedBy(payment) {
  return payment.confirmed_by_name
    || payment.confirmed_by_email
    || payment.confirmed_by_user
    || payment.confirmed_by
    || '—';
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
    body.innerHTML = renderTableState('Đang tải thanh toán', 'Đang đọc dữ liệu từ Supabase.');
  }
}

function renderError(error) {
  const body = document.getElementById('payments-table-body');
  state.total = 0;
  renderSummary();

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải thanh toán',
      error?.message || 'Supabase trả về lỗi khi đọc bảng payments.',
    );
  }

  renderPagination();
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
  const summary = document.getElementById('payments-page-summary');
  const prev = document.getElementById('payments-prev-page');
  const next = document.getElementById('payments-next-page');
  const pages = totalPages();

  if (summary) {
    summary.textContent = state.total
      ? `Trang ${state.page} / ${pages} · ${state.total} thanh toán`
      : '0 thanh toán';
  }

  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
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
  const normalized = String(status || 'pending').toLowerCase();
  const safeClass = normalized.replace(/[^a-z0-9-]/g, '') || 'pending';
  const labels = {
    pending: 'Chờ xác nhận',
    completed: 'Hoàn thành',
    rejected: 'Bị từ chối',
    cancelled: 'Đã hủy',
  };

  return `<span class="badge badge-${safeClass}">${labels[normalized] || escapeHtml(status || 'Không rõ')}</span>`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
    amountLabel: data.amount ? formatCurrency(data.amount) : '',
    accountName: data.accountName,
    accountNumber: data.accountNumber,
    bankName: data.bankName,
    bin: data.bin,
    checkoutUrl: data.checkoutUrl,
    description: data.description,
    orderCode: data.orderCode,
    paymentLinkId: data.paymentLinkId,
    qrCode: data.qrCode,
    note: 'Hệ thống sẽ tự xác nhận thanh toán khi ngân hàng báo thành công.',
  });
}
