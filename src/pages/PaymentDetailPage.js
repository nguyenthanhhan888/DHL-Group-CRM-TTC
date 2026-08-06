import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { PaymentService } from '../services/PaymentService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDateTime } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

export function PaymentDetailPage() {
  return `
    <div id="payment-detail-header"></div>
    <div id="payment-detail-content">
        <section class="dash-card">
            ${EmptyState({ title: 'Đang tải thanh toán', message: 'Đang đọc dữ liệu từ Supabase.' })}
        </section>
    </div>
  `;
}

PaymentDetailPage.afterRender = async function ({ params }) {
  const id = params?.get('id');
  if (!id) {
    return renderState('Thiếu ID thanh toán', 'Vui lòng quay lại trang danh sách và thử lại.');
  }

  try {
    const { data: payment } = await PaymentService.getById(id);
    if (!payment) {
      throw new Error('Thanh toán không tồn tại hoặc đã bị xóa.');
    }
    renderDetails(payment);
  } catch (error) {
    renderState('Không thể tải thanh toán', error.message);
  }
};

function renderDetails(payment) {
  const header = document.getElementById('payment-detail-header');
  const content = document.getElementById('payment-detail-content');
  if (!header || !content) return;

  const customer = payment.customers || {};
  const kiosk = payment.kiosks || {};

  header.innerHTML = PageHeader({
    title: `Chi tiết thanh toán #${payment.id}`,
    description: 'Thông tin chi tiết về một giao dịch trong hệ thống.',
    actions: '<a class="btn-secondary link-button" href="#/payments">Quay lại danh sách</a>',
  });

  content.innerHTML = `
    <div class="admin-grid">
        <section class="admin-card">
            <h3>Thông tin giao dịch</h3>
            <div class="settings-list">
                ${detailRow('ID Giao dịch', payment.id)}
                ${detailRow('Trạng thái', renderPaymentStatusBadge(payment.payment_status), true)}
                ${detailRow('Ngày tạo', formatDateTime(payment.created_at))}
                ${detailRow('Ngày xác nhận', formatDateTime(payment.confirmed_at))}
                ${detailRow('Xác nhận bởi', payment.confirmed_by || '—')}
                ${detailRow('Loại giao dịch', payment.transaction_type === 'adjustment' ? 'Điều chỉnh' : 'Tiêu chuẩn')}
                ${detailRow('Điều chỉnh cho ID', payment.adjusts_payment_id)}
            </div>
        </section>
        <section class="admin-card">
            <h3>Chi tiết số tiền</h3>
            <div class="settings-list">
                ${detailRow('Giá / tháng', formatCurrency(payment.price_per_month))}
                ${detailRow('Số tháng', payment.months)}
                ${detailRow('Giảm giá', formatCurrency(payment.discount))}
                ${detailRow('Lý do giảm giá', payment.discount_reason)}
                ${detailRow('Thành tiền', formatCurrency(payment.total_amount), false, true)}
            </div>
        </section>
    </div>
    <div class="admin-grid">
        <section class="admin-card detail-section">
            <h3>Khách hàng</h3>
            <div class="settings-list">
                ${detailRow('Tên', customerLink(customer), true)}
                ${detailRow('SĐT', customer.phone)}
            </div>
        </section>
        <section class="admin-card detail-section">
            <h3>Kiosk</h3>
            <div class="settings-list">
                ${detailRow('Tên Kiosk', kioskLink(kiosk), true)}
                ${detailRow('Facebook ID', kiosk.facebook_id)}
            </div>
        </section>
    </div>
     <section class="admin-card detail-section">
      <h3>Ghi chú</h3>
      <div class="detail-note">${escapeHtml(payment.note || '—')}</div>
      ${payment.adjustment_reason ? `<div class="detail-note"><strong>Lý do điều chỉnh:</strong> ${escapeHtml(payment.adjustment_reason)}</div>` : ''}
    </section>
  `;
}

function renderState(title, message) {
  const header = document.getElementById('payment-detail-header');
  const content = document.getElementById('payment-detail-content');
  if (header) {
    header.innerHTML = PageHeader({
      title: 'Chi tiết thanh toán',
      actions: '<a class="btn-secondary link-button" href="#/payments">Quay lại danh sách</a>',
    });
  }
  if (content) {
    content.innerHTML = `<section class="dash-card">${EmptyState({ title, message })}</section>`;
  }
}

function detailRow(label, value, isHtml = false, isStrong = false) {
  const displayValue = value !== null && value !== undefined && value !== '' ? value : '—';
  return `
    <div class="setting-item detail-row">
      <span class="setting-name">${label}</span>
      <span class="setting-value detail-value ${isStrong ? 'strong-cell' : ''}">${isHtml ? displayValue : escapeHtml(displayValue)}</span>
    </div>
  `;
}

function customerLink(customer) {
  if (!customer?.id) return '—';
  return `<a class="table-link" href="#/customer-detail?id=${customer.id}">${escapeHtml(customer.facebook_name)}</a>`;
}

function kioskLink(kiosk) {
  if (!kiosk?.id) return '—';
  return `<a class="table-link" href="#/kiosk-detail?id=${kiosk.id}">${escapeHtml(kiosk.facebook_name)}</a>`;
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
