import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { openRenewKioskForm } from '../components/RenewKioskForm.js';
import { openKioskEditForm } from '../components/KioskEditForm.js';
import { openHistoricalPaymentEditForm } from '../components/HistoricalPaymentEditForm.js';
import { Toast } from '../components/Toast.js';
import { FACEBOOK_GROUP_MEMBER_BASE_URL, FACEBOOK_PROFILE_BASE_URL } from '../constants/facebook.js';
import { KioskService } from '../services/KioskService.js';
import { CustomerService } from '../services/CustomerService.js';
import { PaymentService } from '../services/PaymentService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';
import { deriveKioskStatus } from '../utils/kioskStatus.js';

const PAYMENT_COLUMNS = ['Ngày', 'Kỳ hạn', 'Số tháng', 'Số tiền', 'Phương thức', 'Trạng thái', 'Loại giao dịch', 'Ghi chú'];
let currentKiosk = null;
const detailState = {
  payments: [],
  paymentSearchTerm: '',
  profile: null,
  canCorrectHistorical: false,
};

export function KioskDetailPage() {
  return `
    <div id="kiosk-detail-header"></div>
    <div id="kiosk-detail-content">
      <section class="dash-card">
        ${EmptyState({ title: 'Đang tải Kiosk', message: 'Vui lòng chờ trong giây lát.' })}
      </section>
    </div>
  `;
}

KioskDetailPage.afterRender = async function afterRenderKioskDetail({ params, profile } = {}) {
  if (profile) detailState.profile = profile;
  const id = params?.get('id');
  if (!id) {
    renderKioskDetailState('Thiếu ID Kiosk', 'Mở trang chi tiết từ danh sách kiosk để xem dữ liệu.');
    return;
  }

  renderKioskDetailState('Đang tải Kiosk', 'Vui lòng chờ trong giây lát.');

  try {
    const accessProfile = profile || detailState.profile;
    const [{ data: kiosk }, { data: payments }, { data: canCorrectHistorical }] = await Promise.all([
      KioskService.getById(id),
      PaymentService.listByKiosk(id),
      PaymentService.canCorrectHistorical().catch(() => ({
        data: accessProfile?.is_system_admin === true,
      })),
    ]);
    detailState.canCorrectHistorical = canCorrectHistorical === true;

    const { data: customerStatus } = kiosk?.customer_id
      ? await CustomerService.getStatusById(kiosk.customer_id)
      : { data: null };
    renderKioskDetail(kiosk, payments || [], customerStatus);
  } catch (error) {
    renderKioskDetailState(
      'Không thể tải Kiosk',
      error?.message || 'Không thể tải thông tin Kiosk. Vui lòng thử lại.',
    );
  }
};

function renderKioskDetail(kiosk, payments, customerStatus = null) {
  currentKiosk = kiosk;
  detailState.payments = payments || [];
  detailState.paymentSearchTerm = '';
  const content = document.getElementById('kiosk-detail-content');
  const header = document.getElementById('kiosk-detail-header');
  if (!content || !header) return;

  const customer = { ...(kiosk.customers || {}), ...(customerStatus || {}) };
  header.innerHTML = PageHeader({
    title: `Kiosk: ${kiosk.facebook_name}`,
    actions: `
      <button class="btn-secondary" id="edit-kiosk-detail-button" type="button">Sửa kiosk</button>
      <button class="btn-primary" id="renew-kiosk-detail-button" type="button">Gia hạn</button>
      ${renderStatusActions(kiosk)}
      <a class="btn-secondary link-button" href="#/kiosks">Quay lại</a>
    `,
  });

  content.innerHTML = `
    <div class="admin-grid">
      <section class="admin-card">
        <h3>Facebook</h3>
        <div class="settings-list">
          ${detailRow('Tên Facebook', kiosk.facebook_name)}
          ${detailRow('Facebook ID', kiosk.facebook_id)}
          ${detailRow('Link Facebook', kioskFacebookLink(kiosk), true)}
          ${detailRow('Link nhóm Facebook', kioskGroupLink(kiosk), true)}
          ${detailRow('Trạng thái hiện tại', renderKioskStatusBadge(deriveKioskStatus(kiosk)), false, true)}
        </div>
      </section>

      <section class="admin-card">
        <h3>Thông tin Kiosk</h3>
        <div class="settings-list">
          ${detailRow('Danh mục', kiosk.categories?.name)}
          ${detailRow('Loại hình kinh doanh', kiosk.business_types?.name)}
          ${detailRow('Ngày bắt đầu', formatDate(kiosk.start_date))}
          ${detailRow('Ngày hết hạn', formatDate(kiosk.end_date))}
          ${detailRow('Tự duyệt', kiosk.auto_approve ? 'Có' : 'Không')}
          ${detailRow('Tổng đã thanh toán', formatCurrency(kiosk.total_paid || 0))}
        </div>
      </section>
    </div>

    <section class="admin-card detail-section">
      <h3>Khách hàng</h3>
      <div class="settings-list">
        ${detailRow('Khách hàng', customerLink(customer), false, true)}
        ${detailRow('Facebook ID', customer.facebook_id)}
        ${detailRow('Số điện thoại', customer.phone)}
        ${detailRow('Địa chỉ', customer.address)}
        ${detailRow('Trạng thái', renderCustomerStatusBadge(customer.status), false, true)}
        ${detailRow('Tổng đã thanh toán', formatCurrency(customer.total_paid || 0))}
        ${detailRow('Tổng số Kiosk', customer.total_kiosks)}
      </div>
    </section>

    <section class="admin-card detail-section">
      <h3>Ghi chú</h3>
      <div class="detail-note">${escapeHtml(kiosk.note || '—')}</div>
    </section>

    <section class="admin-card detail-section">
      <h3>Lịch sử thanh toán</h3>
      ${isSystemAdmin() ? '<p class="kiosk-payment-admin-hint">System Admin có thể sửa bản ghi completed bằng nút “Sửa dữ liệu thanh toán” trên từng dòng.</p>' : ''}
      <div class="list-search-bar">
        <input id="kiosk-detail-payment-search" class="form-control" type="search" placeholder="Tìm theo kỳ hạn, số tiền, phương thức, trạng thái hoặc ghi chú" aria-label="Tìm lịch sử thanh toán Kiosk" autocomplete="off">
      </div>
      <div id="kiosk-detail-payment-list">${renderPaymentHistory(payments)}</div>
    </section>
  `;

  bindEventListeners();
}

function renderStatusActions(kiosk) {
  const status = kiosk.status;
  if (status === 'active' || status === 'warning') {
    return '<button class="btn-danger" id="kiosk-suspend-button" type="button">Tạm ngưng</button>';
  }
  if (status === 'suspended') {
    return '<button class="btn-secondary" id="kiosk-activate-button" type="button">Kích hoạt</button>';
  }
  return '';
}

function bindEventListeners() {
  bindHistoricalPaymentActions();
  document.getElementById('renew-kiosk-detail-button')?.addEventListener('click', () => {
    openRenewKioskForm({
      kioskId: currentKiosk.id,
      onSaved: () => KioskDetailPage.afterRender({ params: new URLSearchParams({ id: currentKiosk.id }) }),
    });
  });

  document.getElementById('edit-kiosk-detail-button')?.addEventListener('click', () => {
    openKioskEditForm({
      kiosk: currentKiosk,
      onSaved: () => KioskDetailPage.afterRender({ params: new URLSearchParams({ id: currentKiosk.id }) }),
    });
  });

  document.getElementById('kiosk-detail-payment-search')?.addEventListener('input', (event) => {
    detailState.paymentSearchTerm = event.currentTarget.value || '';
    const list = document.getElementById('kiosk-detail-payment-list');
    if (list) {
      list.innerHTML = renderPaymentHistory(detailState.payments);
      bindHistoricalPaymentActions();
    }
  });

  document.getElementById('kiosk-suspend-button')?.addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn tạm ngưng Kiosk này?')) {
      updateKioskStatus('suspended', 'Đã tạm ngưng Kiosk.');
    }
  });

  document.getElementById('kiosk-activate-button')?.addEventListener('click', () => {
    updateKioskStatus('active', 'Đã kích hoạt lại Kiosk.');
  });
}

async function updateKioskStatus(newStatus, successMessage) {
  try {
    const reason = newStatus === 'active' ? 'Kích hoạt lại kiosk' : 'Tạm ngưng kiosk';
    await KioskService.update(currentKiosk.id, { status: newStatus }, reason);
    Toast.show(successMessage);
    await KioskDetailPage.afterRender({ params: new URLSearchParams({ id: currentKiosk.id }) });
  } catch (error) {
    Toast.show(`Lỗi: ${error.message}`, 'error');
  }
}

function renderPaymentHistory(payments) {
  if (!payments.length) {
    return EmptyState({
      title: 'Chưa có thanh toán',
      message: 'Kiosk này chưa có thanh toán nào trong hệ thống.',
    });
  }
  const filteredPayments = filterPaymentHistory(payments);
  if (!filteredPayments.length) {
    return EmptyState({
      title: 'Không tìm thấy thanh toán',
      message: 'Thử tìm bằng kỳ hạn, số tiền, phương thức, trạng thái hoặc ghi chú khác.',
    });
  }

  return `
    <div class="table-card">
      <table class="data-table kiosk-payment-history-table ${isSystemAdmin() ? 'has-admin-actions' : ''}">
        <thead>
          <tr>${PAYMENT_COLUMNS.map((column) => `<th>${column}</th>`).join('')}${isSystemAdmin() ? '<th>Thao tác</th>' : ''}</tr>
        </thead>
        <tbody>
          ${filteredPayments.map((payment) => `
            <tr>
              <td data-label="Ngày">${formatDate(payment.created_at)}</td>
              <td data-label="Kỳ hạn">${escapeHtml(paymentPeriod(payment))}</td>
              <td data-label="Số tháng">${escapeHtml(paymentMonths(payment))}</td>
              <td data-label="Số tiền">${formatCurrency(payment.total_amount || 0)}</td>
              <td data-label="Phương thức">${escapeHtml(payment.payment_method || '—')}</td>
              <td data-label="Trạng thái">${renderPaymentStatusBadge(payment.payment_status)}</td>
              <td data-label="Loại giao dịch">${escapeHtml(transactionTypeLabel(payment.transaction_type))}</td>
              <td data-label="Ghi chú">${escapeHtml(payment.note || '—')}</td>
              ${isSystemAdmin() ? `<td data-label="Thao tác">${renderHistoricalPaymentAction(payment)}</td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistoricalPaymentAction(payment) {
  if (!isHistoricalPaymentEditable(payment)) {
    return '<span class="muted-text">Không áp dụng</span>';
  }
  return `<button class="table-action-button kiosk-payment-edit-action" type="button" data-edit-historical-payment="${escapeHtml(payment.id)}" aria-label="Sửa dữ liệu thanh toán #${escapeHtml(payment.id)}">Sửa dữ liệu thanh toán</button>`;
}

function bindHistoricalPaymentActions() {
  document.querySelectorAll('[data-edit-historical-payment]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!isSystemAdmin()) return;
      const payment = detailState.payments.find((item) => String(item.id) === button.dataset.editHistoricalPayment);
      if (!isHistoricalPaymentEditable(payment)) return;
      openHistoricalPaymentEditForm({
        payment,
        kioskName: currentKiosk?.facebook_name,
        onSaved: () => KioskDetailPage.afterRender({
          params: new URLSearchParams({ id: currentKiosk.id }),
        }),
      });
    });
  });
}

function isHistoricalPaymentEditable(payment) {
  return payment
    && String(payment.payment_status || '').toLowerCase() === 'completed'
    && String(payment.transaction_type || 'standard').toLowerCase() !== 'adjustment'
    && !payment.registration_batch_id;
}

function isSystemAdmin() {
  return detailState.canCorrectHistorical === true;
}

function transactionTypeLabel(value) {
  const normalized = String(value || 'standard').toLowerCase();
  return ({ standard: 'Tiêu chuẩn', renewal: 'Gia hạn', adjustment: 'Điều chỉnh' })[normalized]
    || value
    || 'Tiêu chuẩn';
}

function filterPaymentHistory(payments) {
  const term = normalizeSearch(detailState.paymentSearchTerm);
  if (!term) return payments;
  return payments.filter((payment) => [
    formatDate(payment.created_at),
    paymentPeriod(payment),
    paymentMonths(payment),
    formatCurrency(payment.total_amount || 0),
    payment.payment_method,
    payment.payment_status,
    payment.note,
  ].some((value) => normalizeSearch(value).includes(term)));
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

function detailRow(label, value, isLink = false, isHtml = false) {
  const hasValue = value !== null && value !== undefined && value !== '';
  const display = hasValue ? value : '—';
  const renderedValue = isHtml
    ? display
    : isLink && hasValue
      ? `<a class="table-link" href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`
      : escapeHtml(display);

  return `
    <div class="setting-item detail-row">
      <span class="setting-name">${label}</span>
      <span class="setting-value detail-value">${renderedValue}</span>
    </div>
  `;
}

function customerLink(customer) {
  if (!customer?.id) return '—';
  return `<a class="table-link" href="#/customer-detail?id=${encodeURIComponent(customer.id)}">${escapeHtml(customer.facebook_name || 'Xem khách hàng')}</a>`;
}

function kioskFacebookLink(kiosk) {
  if (kiosk.facebook_link) return kiosk.facebook_link;
  if (kiosk.facebook_url) return kiosk.facebook_url;
  if (kiosk.facebook_id) return `${FACEBOOK_PROFILE_BASE_URL}/${kiosk.facebook_id}`;
  return '';
}

function kioskGroupLink(kiosk) {
  if (kiosk.facebook_group_link) return kiosk.facebook_group_link;
  if (!kiosk.facebook_id) return '';
  return `${FACEBOOK_GROUP_MEMBER_BASE_URL}/${kiosk.facebook_id}`;
}

function paymentPeriod(payment) {
  if (!payment.start_date && !payment.end_date) return '—';
  return `${formatDate(payment.start_date)} - ${formatDate(payment.end_date)}`;
}

function paymentMonths(payment) {
  if (Number(payment.months) > 0) return String(payment.months);
  if (!payment.start_date || !payment.end_date) return '—';

  const start = parseDateOnly(payment.start_date);
  const end = parseDateOnly(payment.end_date);
  const months = (end.getFullYear() - start.getFullYear()) * 12
    + end.getMonth() - start.getMonth();
  return months > 0 ? String(months) : '—';
}

function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function renderKioskStatusBadge(status) {
  return renderStatusBadge(status, {
    active: 'Hoạt động',
    inactive: 'Không hoạt động',
    expired: 'Hết hạn',
    warning: 'Sắp hết hạn',
    pending: 'Chờ duyệt',
    suspended: 'Tạm ngưng',
  });
}

function renderCustomerStatusBadge(status) {
  return renderStatusBadge(status, {
    active: 'Hoạt động',
    warning: 'Sắp hết hạn',
    expired: 'Hết hạn',
    pending: 'Chờ duyệt',
    suspended: 'Tạm ngưng',
    inactive: 'Không hoạt động',
    potential: 'Tiềm năng',
  });
}

function renderPaymentStatusBadge(status) {
  return renderStatusBadge(status, {
    pending: 'Chờ xác nhận',
    completed: 'Hoàn thành',
    rejected: 'Từ chối',
    cancelled: 'Đã hủy',
  });
}

function renderStatusBadge(status, labels) {
  return StatusBadge(status, { labels });
}

function renderKioskDetailState(title, message) {
  const header = document.getElementById('kiosk-detail-header');
  if (header) {
    header.innerHTML = PageHeader({
      title: 'Chi tiết Kiosk',
      actions: '<a class="btn-secondary link-button" href="#/kiosks">Quay lại</a>',
    });
  }

  const content = document.getElementById('kiosk-detail-content');
  if (!content) return;
  content.innerHTML = `
    <section class="dash-card">
      ${EmptyState({ title, message: escapeHtml(message) })}
    </section>
  `;
}
