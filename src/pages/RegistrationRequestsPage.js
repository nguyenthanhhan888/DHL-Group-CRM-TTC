import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { RegistrationRequestService } from '../services/RegistrationRequestService.js';
import { Toast } from '../components/Toast.js';
import { formatCurrency } from '../utils/currency.js';
import { escapeHtml } from '../utils/html.js';

const state = {
  status: 'pending',
  busyId: null,
  searchTerm: '',
  rows: [],
};

export function RegistrationRequestsPage() {
  return `
    ${PageHeader({
      title: 'Duyệt đơn đăng ký',
      description: 'Kiểm tra hồ sơ đăng ký Kiosk. Thanh toán sẽ tự hoàn tất khi ngân hàng xác nhận.',
    })}
    <div class="toolbar">
      <input
        id="request-search"
        class="form-control"
        type="search"
        placeholder="Tìm theo tên, SĐT, Facebook ID, dịch vụ hoặc mã đơn"
        aria-label="Tìm đơn đăng ký"
        autocomplete="off"
      >
      <select id="request-status-filter" class="filter-select" aria-label="Lọc trạng thái đơn">
        <option value="pending">Chờ duyệt</option>
        <option value="approved">Đã duyệt</option>
        <option value="rejected">Đã từ chối</option>
        <option value="">Tất cả</option>
      </select>
      <button id="request-reload" class="btn-secondary" type="button">Tải lại</button>
    </div>
    <div class="table-card">
      <table class="data-table request-table">
        <thead><tr>
          <th>#</th><th>Khách/Kiosk</th><th>Liên hệ</th><th>Dịch vụ</th>
          <th>Thời hạn</th><th>Số tiền</th><th>Ngày gửi</th><th>Trạng thái</th><th>Thao tác</th>
        </tr></thead>
        <tbody id="request-table-body">
          ${loadingRow()}
        </tbody>
      </table>
    </div>
  `;
}

RegistrationRequestsPage.afterRender = function afterRenderRequests() {
  const filter = document.getElementById('request-status-filter');
  const search = document.getElementById('request-search');
  if (filter) filter.value = state.status;
  if (search) search.value = state.searchTerm;
  search?.addEventListener('input', (event) => {
    state.searchTerm = event.currentTarget.value || '';
    renderRows(state.rows);
  });
  filter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    loadRequests();
  });
  document.getElementById('request-reload')?.addEventListener('click', loadRequests);
  document.getElementById('request-table-body')?.addEventListener('click', handleAction);
  loadRequests();
};

async function loadRequests() {
  const body = document.getElementById('request-table-body');
  if (!body) return;
  body.innerHTML = loadingRow();
  try {
    const { data } = await RegistrationRequestService.list(state.status);
    state.rows = data || [];
    renderRows(state.rows);
  } catch (error) {
    body.innerHTML = stateRow('Không tải được đơn đăng ký', error?.message || 'Supabase trả về lỗi.');
  }
}

function renderRows(rows) {
  const body = document.getElementById('request-table-body');
  if (!body) return;
  const filteredRows = filterRequests(rows);
  if (!rows.length) {
    body.innerHTML = stateRow('Không có đơn đăng ký', 'Không có đơn nào ở trạng thái đã chọn.');
    return;
  }
  if (!filteredRows.length) {
    body.innerHTML = stateRow('Không tìm thấy đơn đăng ký', 'Thử tìm bằng tên, SĐT, Facebook ID, dịch vụ hoặc mã đơn khác.');
    return;
  }

  body.innerHTML = filteredRows.map((item) => `
    <tr>
      <td>${item.id}</td>
      <td><strong>${escapeHtml(item.facebook_name || '—')}</strong><br><span class="muted-text">FB ID: ${escapeHtml(item.facebook_id || '—')}</span>${isLegacyRequest(item) ? '<br><span class="badge badge-pending">Bổ sung cũ</span>' : ''}</td>
      <td>${escapeHtml(item.phone || '—')}<br>${safeHref(item.facebook_link) ? `<a class="table-link" href="${escapeHtml(safeHref(item.facebook_link))}" target="_blank" rel="noreferrer">Mở Facebook</a>` : ''}</td>
      <td>${escapeHtml(item.business_types?.name || item.service_name || '—')}<br><span class="muted-text">${escapeHtml(item.categories?.name || '')}</span></td>
      <td>${requestPeriod(item)}</td>
      <td class="strong-cell">${formatCurrency(item.total_amount || 0)}</td>
      <td>${formatDateTime(item.submitted_at)}</td>
      <td>${statusBadge(item.status, item.rejection_reason)}</td>
      <td>${actionButtons(item)}</td>
    </tr>
  `).join('');
}

function filterRequests(rows) {
  const query = normalizeSearch(state.searchTerm);
  if (!query) return rows;
  return rows.filter((item) => [
    item.id,
    item.facebook_name,
    item.facebook_id,
    item.facebook_link,
    item.phone,
    item.business_types?.name,
    item.service_name,
    item.categories?.name,
    item.status,
    item.total_amount,
    item.submitted_at,
  ].map(normalizeSearch).join(' ').includes(query));
}

async function handleAction(event) {
  const button = event.target.closest('[data-request-action]');
  if (!button || state.busyId) return;
  const id = Number(button.dataset.requestId);
  const action = button.dataset.requestAction;
  if (!id) return;

  let reason = '';
  if (action === 'reject' || action === 'legacy-cancel') {
    reason = window.prompt(isLegacyAction(action) ? 'Nhập lý do hủy yêu cầu bổ sung:' : 'Nhập lý do từ chối đơn:')?.trim() || '';
    if (!reason) return;
  } else if (!window.confirm(
    isLegacyAction(action)
      ? 'Duyệt hồ sơ và lưu thông tin vào Khách hàng/Kiosk?'
      : 'Duyệt hồ sơ đăng ký này? Bước này không xác nhận tiền; hệ thống sẽ tự hoàn tất khi ngân hàng xác nhận.',
  )) {
    return;
  }

  state.busyId = id;
  setRowButtonsDisabled(id, true);
  try {
    if (action === 'approve') {
      const { data } = await RegistrationRequestService.approve(id);
      Toast.show(`Đã duyệt hồ sơ. Thanh toán #${data?.payment?.id || data?.request?.payment_id || 'mới'} sẽ tự hoàn tất khi ngân hàng xác nhận.`, 'success');
    }
    if (action === 'reject') await RegistrationRequestService.reject(id, reason);
    if (action === 'legacy-approve') {
      const { data } = await RegistrationRequestService.reviewLegacy(id, 'approve');
      Toast.show(`Đã lưu khách hàng #${data.customer_id} và kiosk #${data.kiosk_id}.`, 'success');
    }
    if (action === 'legacy-cancel') {
      await RegistrationRequestService.reviewLegacy(id, 'cancel', reason);
    }
    await loadRequests();
  } catch (error) {
    window.alert(error?.message || 'Không thể xử lý đơn đăng ký.');
  } finally {
    state.busyId = null;
    setRowButtonsDisabled(id, false);
  }
}

function actionButtons(item) {
  if (isLegacyRequest(item) && item.status === 'approved' && (!item.customer_id || !item.kiosk_id)) {
    return `<div class="request-actions">
      <button class="table-approve-button" type="button" data-request-action="legacy-approve" data-request-id="${item.id}">Hoàn tất lưu</button>
    </div>`;
  }
  if (item.status !== 'pending') return '—';
  if (isLegacyRequest(item)) {
    return `<div class="request-actions">
      <button class="table-approve-button" type="button" data-request-action="legacy-approve" data-request-id="${item.id}">Duyệt & lưu</button>
      <button class="table-cancel-button" type="button" data-request-action="legacy-cancel" data-request-id="${item.id}">Hủy</button>
    </div>`;
  }
  return `<div class="request-actions">
    <button class="table-approve-button" type="button" data-request-action="approve" data-request-id="${item.id}">Duyệt hồ sơ</button>
    <button class="table-cancel-button" type="button" data-request-action="reject" data-request-id="${item.id}">Từ chối</button>
  </div>`;
}

function isLegacyRequest(item) {
  return item?.metadata?.request_type === 'legacy';
}

function isLegacyAction(action) {
  return action === 'legacy-approve' || action === 'legacy-cancel';
}

function requestPeriod(item) {
  if (!isLegacyRequest(item)) return `${Number(item.months || 0)} tháng`;
  return `${formatDateOnly(item.requested_start_date)}<br><span class="muted-text">đến ${formatDateOnly(item.requested_end_date)}</span>`;
}

function formatDateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(`${value}T00:00:00`));
}

function statusBadge(status, reason) {
  const labels = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
  const badge = `<span class="badge badge-${escapeHtml(status || 'pending')}">${labels[status] || 'Không rõ'}</span>`;
  return reason ? `${badge}<br><span class="muted-text">${escapeHtml(reason)}</span>` : badge;
}

function setRowButtonsDisabled(id, disabled) {
  document.querySelectorAll(`[data-request-id="${id}"]`).forEach((button) => {
    button.disabled = disabled;
  });
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function safeHref(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

function loadingRow() {
  return stateRow('Đang tải đơn đăng ký', 'Đang đọc dữ liệu từ Supabase.');
}

function stateRow(title, message) {
  return `<tr><td colspan="9">${EmptyState({ title, message: escapeHtml(message) })}</td></tr>`;
}
