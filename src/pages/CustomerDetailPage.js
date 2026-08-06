import { EmptyState } from '../components/EmptyState.js';
import { openCustomerForm } from '../components/CustomerForm.js';
import { openKioskForm } from '../components/KioskForm.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { FACEBOOK_PROFILE_BASE_URL } from '../constants/facebook.js';
import { CustomerService } from '../services/CustomerService.js';
import { KioskService } from '../services/KioskService.js';
import { PaymentService } from '../services/PaymentService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

const RELATED_KIOSK_COLUMNS = ['Kiosk', 'Trạng thái', 'Ngày hết hạn'];
const PAYMENT_HISTORY_COLUMNS = ['Kiosk', 'Số tiền', 'Trạng thái', 'Ngày xác nhận'];
let currentCustomer = null;
const detailState = {
  kiosks: [],
  payments: [],
  kioskSearchTerm: '',
  paymentSearchTerm: '',
};

export function CustomerDetailPage() {
  // Page header is rendered dynamically after data is fetched
  return `
    <div id="customer-detail-header"></div>
    <div id="customer-detail-content">
      <section class="dash-card">
        ${EmptyState({ title: 'Đang tải khách hàng', message: 'Đang đọc dữ liệu từ Supabase.' })}
      </section>
    </div>
  `;
}

CustomerDetailPage.afterRender = async function afterRenderCustomerDetail({ params }) {
  const id = params?.get('id');
  if (!id) {
    renderCustomerDetailState('Thiếu ID khách hàng', 'Mở trang chi tiết từ danh sách khách hàng để xem dữ liệu.');
    return;
  }

  renderCustomerDetailState('Đang tải khách hàng', 'Đang đọc dữ liệu từ Supabase.');

  try {
    const [{ data: customer }, { data: kiosks }, { data: payments }] = await Promise.all([
      CustomerService.getById(id),
      KioskService.listByCustomer(id),
      PaymentService.listByCustomer(id),
    ]);

    if (!customer) {
      throw new Error('Khách hàng không tồn tại hoặc đã bị xóa.');
    }

    renderCustomerDetail(customer, kiosks || [], payments || []);
  } catch (error) {
    renderCustomerDetailState(
      'Không thể tải khách hàng',
      error?.message || 'Supabase trả về lỗi khi đọc thông tin khách hàng.',
    );
  }
};

function renderCustomerDetail(customer, kiosks, payments) {
  currentCustomer = customer;
  detailState.kiosks = kiosks || [];
  detailState.payments = payments || [];
  detailState.kioskSearchTerm = '';
  detailState.paymentSearchTerm = '';
  const content = document.getElementById('customer-detail-content');
  const header = document.getElementById('customer-detail-header');
  if (!content || !header) return;

  const latestKioskEndDate = getLatestDate(kiosks.map((k) => k.end_date));
  const latestPaymentDate = getLatestDate(payments.filter((p) => p.payment_status === 'completed').map((p) => p.confirmed_at));

  header.innerHTML = PageHeader({
    title: customer.facebook_name,
    description: 'Thông tin chi tiết khách hàng và các kiosk/thanh toán liên quan.',
    actions: `
      <button class="btn-primary" id="customer-add-kiosk" type="button">+ Thêm Kiosk</button>
      ${customer.status === 'active'
        ? '<button class="btn-danger" id="customer-deactivate-button" type="button">Vô hiệu hóa</button>'
        : '<button class="btn-secondary" id="customer-activate-button" type="button">Kích hoạt lại</button>'
      }
      <a class="btn-secondary link-button" href="#/customers">Quay lại</a>
    `,
  });

  content.innerHTML = `
    <div class="admin-grid">
      <section class="admin-card">
        <h3>Thông tin liên hệ</h3>
        <div class="settings-list">
          ${detailRow('Tên Facebook', customer.facebook_name)}
          ${detailRow('Link Facebook', customerFacebookLink(customer), true)}
          ${detailRow('Số điện thoại', customer.phone)}
          ${detailRow('Địa chỉ', customer.address)}
          ${detailRow('Trạng thái', renderStatusBadge(customer.status), false, true)}
        </div>
      </section>
      <section class="admin-card">
        <h3>Thông tin tổng hợp</h3>
        <div class="settings-list">
          ${detailRow('Tổng đã thanh toán', formatCurrency(customer.total_paid || 0))}
          ${detailRow('Tổng số Kiosk', customer.total_kiosks ?? kiosks.length)}
          ${detailRow('Thanh toán cuối', formatDate(latestPaymentDate))}
          ${detailRow('Kiosk hết hạn cuối', formatDate(latestKioskEndDate))}
        </div>
      </section>
    </div>

    <section class="admin-card detail-section">
      <div class="dash-card-header">
        <h3>Ghi chú</h3>
        <button class="btn-secondary" type="button" data-customer-detail-edit>Sửa</button>
      </div>
      <div class="detail-note">${escapeHtml(customer.note || '—')}</div>
    </section>

    <div class="admin-grid">
      <section class="admin-card detail-section">
        <h3>Kiosk liên quan (${kiosks.length})</h3>
        <div class="list-search-bar">
          <input id="customer-detail-kiosk-search" class="form-control" type="search" placeholder="Tìm theo Kiosk, Facebook ID, trạng thái hoặc ngày hết hạn" aria-label="Tìm Kiosk liên quan" autocomplete="off">
        </div>
        <div id="customer-detail-kiosk-list">${renderRelatedKiosks(kiosks)}</div>
      </section>
      <section class="admin-card detail-section">
        <h3>Lịch sử thanh toán (${payments.length})</h3>
        <div class="list-search-bar">
          <input id="customer-detail-payment-search" class="form-control" type="search" placeholder="Tìm theo Kiosk, số tiền, trạng thái hoặc ngày xác nhận" aria-label="Tìm lịch sử thanh toán" autocomplete="off">
        </div>
        <div id="customer-detail-payment-list">${renderPaymentHistory(payments)}</div>
      </section>
    </div>
  `;

  bindEventListeners();
}

function bindEventListeners() {
  document.querySelector('[data-customer-detail-edit]')?.addEventListener('click', () => {
    openCustomerForm({
      customer: currentCustomer,
      onSaved: () => CustomerDetailPage.afterRender({ params: new URLSearchParams({ id: currentCustomer.id }) }),
    });
  });

  document.getElementById('customer-add-kiosk')?.addEventListener('click', () => {
    openKioskForm({
      customer: currentCustomer,
      onSaved: () => CustomerDetailPage.afterRender({ params: new URLSearchParams({ id: currentCustomer.id }) }),
    });
  });

  document.getElementById('customer-detail-kiosk-search')?.addEventListener('input', (event) => {
    detailState.kioskSearchTerm = event.currentTarget.value || '';
    const list = document.getElementById('customer-detail-kiosk-list');
    if (list) list.innerHTML = renderRelatedKiosks(detailState.kiosks);
  });

  document.getElementById('customer-detail-payment-search')?.addEventListener('input', (event) => {
    detailState.paymentSearchTerm = event.currentTarget.value || '';
    const list = document.getElementById('customer-detail-payment-list');
    if (list) list.innerHTML = renderPaymentHistory(detailState.payments);
  });

  document.getElementById('customer-deactivate-button')?.addEventListener('click', () => {
    if (confirm('Bạn có chắc chắn muốn vô hiệu hóa khách hàng này?')) {
      updateCustomerStatus('inactive', 'Đã vô hiệu hóa khách hàng.');
    }
  });

  document.getElementById('customer-activate-button')?.addEventListener('click', () => {
    updateCustomerStatus('active', 'Đã kích hoạt lại khách hàng.');
  });
}

async function updateCustomerStatus(newStatus, successMessage) {
  try {
    const reason = newStatus === 'active' ? 'Kích hoạt lại khách hàng' : 'Vô hiệu hóa khách hàng';
    await CustomerService.update(currentCustomer.id, { status: newStatus }, reason);
    Toast.show(successMessage);
    await CustomerDetailPage.afterRender({ params: new URLSearchParams({ id: currentCustomer.id }) });
  } catch (error) {
    Toast.show(`Lỗi: ${error.message}`, 'error');
  }
}

function renderRelatedKiosks(kiosks) {
  if (!kiosks.length) {
    return EmptyState({
      title: 'Chưa có kiosk',
      message: 'Khách hàng này chưa có kiosk nào.',
    });
  }
  const filteredKiosks = filterRelatedKiosks(kiosks);
  if (!filteredKiosks.length) {
    return EmptyState({
      title: 'Không tìm thấy kiosk',
      message: 'Thử tìm bằng tên Kiosk, Facebook ID, trạng thái hoặc ngày hết hạn khác.',
    });
  }

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>${RELATED_KIOSK_COLUMNS.map((column) => `<th>${column}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${filteredKiosks.map((kiosk) => `
            <tr>
              <td><a class="table-link" href="#/kiosk-detail?id=${kiosk.id}">${escapeHtml(kiosk.facebook_name || '—')}</a></td>
              <td>${renderStatusBadge(kiosk.status)}</td>
              <td>${formatDate(kiosk.end_date)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPaymentHistory(payments) {
  if (!payments.length) {
    return EmptyState({
      title: 'Chưa có thanh toán',
      message: 'Khách hàng này chưa có thanh toán nào.',
    });
  }
  const filteredPayments = filterPaymentHistory(payments);
  if (!filteredPayments.length) {
    return EmptyState({
      title: 'Không tìm thấy thanh toán',
      message: 'Thử tìm bằng Kiosk, số tiền, trạng thái hoặc ngày xác nhận khác.',
    });
  }

  return `
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>${PAYMENT_HISTORY_COLUMNS.map((column) => `<th>${column}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${filteredPayments.map((payment) => `
            <tr>
              <td>${escapeHtml(payment.kiosks?.facebook_name || '—')}</td>
              <td>${formatCurrency(payment.total_amount || 0)}</td>
              <td>${renderStatusBadge(payment.payment_status)}</td>
              <td>${formatDate(payment.confirmed_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function filterRelatedKiosks(kiosks) {
  const term = normalizeSearch(detailState.kioskSearchTerm);
  if (!term) return kiosks;
  return kiosks.filter((kiosk) => [
    kiosk.facebook_name,
    kiosk.facebook_id,
    kiosk.status,
    formatDate(kiosk.end_date),
  ].some((value) => normalizeSearch(value).includes(term)));
}

function filterPaymentHistory(payments) {
  const term = normalizeSearch(detailState.paymentSearchTerm);
  if (!term) return payments;
  return payments.filter((payment) => [
    payment.kiosks?.facebook_name,
    formatCurrency(payment.total_amount || 0),
    payment.payment_status,
    formatDate(payment.confirmed_at),
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

function customerFacebookLink(customer) {
  if (customer.facebook_link) return customer.facebook_link;
  if (customer.facebook_url) return customer.facebook_url;
  if (customer.facebook_id) return `${FACEBOOK_PROFILE_BASE_URL}/${customer.facebook_id}`;
  return '';
}

function getLatestDate(dates = []) {
  const validDates = dates.filter(Boolean).map((d) => new Date(d));
  if (!validDates.length) return null;
  return new Date(Math.max.apply(null, validDates));
}

function renderStatusBadge(status) {
  const normalized = String(status || 'inactive').toLowerCase();
  const safeClass = normalized.replace(/[^a-z0-9-]/g, '') || 'inactive';
  const labels = {
    active: 'Hoạt động',
    pending: 'Chờ duyệt',
    inactive: 'Không hoạt động',
    completed: 'Hoàn thành',
    rejected: 'Từ chối',
    cancelled: 'Đã hủy',
    expired: 'Hết hạn',
    warning: 'Sắp hết hạn',
  };
  return `<span class="badge badge-${safeClass}">${labels[normalized] || escapeHtml(status || 'Không rõ')}</span>`;
}

function renderCustomerDetailState(title, message) {
  const content = document.getElementById('customer-detail-content');
  if (!content) return;

  const header = document.getElementById('customer-detail-header');
  if (header) {
    header.innerHTML = PageHeader({
      title: 'Chi tiết khách hàng',
      description: 'Thông tin chi tiết khách hàng và các kiosk liên quan.',
      actions: '<a class="btn-secondary link-button" href="#/customers">Quay lại</a>',
    });
  }

  content.innerHTML = `
    <section class="dash-card">
      ${EmptyState({ title, message: escapeHtml(message) })}
    </section>
  `;
}
