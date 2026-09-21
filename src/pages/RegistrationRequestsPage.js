import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { Toast } from '../components/Toast.js';
import { RegistrationRequestService } from '../services/RegistrationRequestService.js';
import { formatCurrency } from '../utils/currency.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';

const state = { status: '', busyId: null, searchTerm: '', rows: [] };

export function RegistrationRequestsPage() {
  return `
    ${PageHeader({ title: 'Hồ sơ Kiosk', description: 'Theo dõi toàn bộ lifecycle: thanh toán công khai, duyệt Legacy/Bổ sung, hoàn tất và hủy/từ chối.' })}
    <div class="request-state-note" role="note"><strong>Chờ thanh toán</strong> là hồ sơ PayOS chưa tạo doanh thu. <strong>Chờ duyệt</strong> là hồ sơ Legacy/Bổ sung cần xử lý thủ công.</div>
    <div class="toolbar request-toolbar">
      <input id="request-search" class="form-control" type="search" placeholder="Tìm tên, SĐT, Facebook ID, dịch vụ hoặc mã hồ sơ" aria-label="Tìm hồ sơ Kiosk" autocomplete="off">
      <select id="request-status-filter" class="filter-select" aria-label="Lọc trạng thái hồ sơ">
        <option value="">Tất cả</option><option value="awaiting_payment">Chờ thanh toán</option>
        <option value="pending">Chờ duyệt</option><option value="approved">Đã hoàn tất</option>
        <option value="terminal">Đã hủy</option>
      </select>
      <button id="request-reload" class="btn-secondary" type="button">${renderIcon('refresh')} Tải lại</button>
    </div>
    <div class="table-card request-table-card"><table class="data-table request-table">
      <thead><tr><th>#</th><th>Khách/Kiosk</th><th>Liên hệ</th><th>Ngành nghề</th><th>Thời hạn</th><th>Số tiền dự kiến</th><th>Ngày gửi</th><th>Hồ sơ</th><th>Thanh toán / PayOS</th><th>Thao tác</th></tr></thead>
      <tbody id="request-table-body">${loadingRow()}</tbody>
    </table></div>`;
}

RegistrationRequestsPage.afterRender = function afterRenderRequests() {
  const filter = document.getElementById('request-status-filter');
  const search = document.getElementById('request-search');
  const requestedStatus = new URLSearchParams(String(window.location.hash || '').split('?')[1] || '').get('status');
  state.status = ['awaiting_payment', 'pending', 'approved', 'terminal'].includes(requestedStatus) ? requestedStatus : '';
  if (filter) filter.value = state.status;
  if (search) search.value = state.searchTerm;
  search?.addEventListener('input', (event) => { state.searchTerm = event.currentTarget.value || ''; renderRows(state.rows); });
  filter?.addEventListener('change', (event) => { state.status = event.target.value; loadRequests(); });
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
    state.rows = Array.isArray(data) ? data : [];
    renderRows(state.rows);
  } catch (error) {
    body.innerHTML = stateRow('Không tải được hồ sơ Kiosk', error?.message || 'Vui lòng thử lại sau.');
  }
}

function renderRows(rows) {
  const body = document.getElementById('request-table-body');
  if (!body) return;
  const filteredRows = filterRequests(rows);
  if (!rows.length) { body.innerHTML = stateRow('Không có hồ sơ Kiosk', 'Không có hồ sơ nào ở trạng thái đã chọn.'); return; }
  if (!filteredRows.length) { body.innerHTML = stateRow('Không tìm thấy hồ sơ Kiosk', 'Hãy thử từ khóa khác.'); return; }
  body.innerHTML = filteredRows.map(rowMarkup).join('');
}

function rowMarkup(item) {
  return `<tr data-request-row="${item.id}">
    <td data-label="#">${item.id}</td>
    <td data-label="Khách/Kiosk"><strong>${escapeHtml(item.facebook_name || '—')}</strong><br><span class="muted-text">FB ID: ${escapeHtml(item.facebook_id || '—')}</span>${isLegacyRequest(item) ? '<br><span class="badge badge-pending">Bổ sung/Legacy</span>' : ''}</td>
    <td data-label="Liên hệ">${escapeHtml(item.phone || '—')}<br>${safeHref(item.facebook_link) ? `<a class="table-link" href="${escapeHtml(safeHref(item.facebook_link))}" target="_blank" rel="noreferrer">Mở Facebook</a>` : ''}</td>
    <td data-label="Ngành nghề">${escapeHtml(item.business_type_name || item.service_name || '—')}<br><span class="muted-text">${escapeHtml(item.category_name || '')}</span></td>
    <td data-label="Thời hạn">${requestPeriod(item)}</td>
    <td data-label="Số tiền dự kiến" class="strong-cell">${formatCurrency(item.total_amount || 0)}${Number(item.batch_item_count || 0) > 1 ? `<br><span class="muted-text">Lô ${Number(item.batch_item_count)} Kiosk: ${formatCurrency(item.batch_total_amount || 0)}</span>` : ''}</td>
    <td data-label="Ngày gửi">${formatDateTime(item.submitted_at)}</td>
    <td data-label="Hồ sơ">${requestStatus(item)}</td>
    <td data-label="Thanh toán / PayOS">${paymentState(item)}</td>
    <td data-label="Thao tác">${actionButtons(item)}</td>
  </tr>`;
}

function paymentState(item) {
  if (item.status !== 'awaiting_payment' && !item.payment_status) return '<span class="muted-text">Không áp dụng</span>';
  const paymentLabel = item.payment_status === 'completed' ? 'Đã thanh toán' : item.payment_status === 'cancelled' ? 'Đã hủy' : item.payment_status === 'pending' ? 'Thanh toán đang chờ' : 'Chưa tạo thanh toán';
  return `<span class="request-payment-primary">${escapeHtml(paymentLabel)}</span><small class="request-payment-secondary">${escapeHtml(paymentStateText(item))}</small>`;
}

function requestStatus(item) {
  const labels = { awaiting_payment: 'Chờ thanh toán', pending: 'Chờ duyệt', approved: 'Đã hoàn tất', rejected: 'Đã từ chối', cancelled: 'Đã hủy' };
  const badge = StatusBadge(item.status || 'pending', { labels });
  return item.rejection_reason ? `${badge}<br><span class="muted-text">${escapeHtml(item.rejection_reason)}</span>` : badge;
}

function actionButtons(item) {
  if (item.status === 'awaiting_payment') return `<div class="request-actions"><button class="table-approve-button" type="button" data-request-action="external-complete" data-request-id="${item.id}">Chấp nhận</button><button class="table-cancel-button" type="button" data-request-action="awaiting-cancel" data-request-id="${item.id}">Hủy</button></div>`;
  if (isLegacyRequest(item) && item.status === 'approved' && (!item.customer_id || !item.kiosk_id)) return `<div class="request-actions"><button class="table-approve-button" type="button" data-request-action="legacy-approve" data-request-id="${item.id}">Hoàn tất lưu</button></div>`;
  if (item.status !== 'pending') return '—';
  if (isLegacyRequest(item)) return `<div class="request-actions"><button class="table-approve-button" type="button" data-request-action="legacy-approve" data-request-id="${item.id}">Duyệt & lưu</button><button class="table-cancel-button" type="button" data-request-action="legacy-cancel" data-request-id="${item.id}">Hủy</button></div>`;
  return `<div class="request-actions"><button class="table-approve-button" type="button" data-request-action="approve" data-request-id="${item.id}">Duyệt hồ sơ</button><button class="table-cancel-button" type="button" data-request-action="reject" data-request-id="${item.id}">Từ chối</button></div>`;
}

function handleAction(event) {
  const button = event.target.closest('[data-request-action]');
  if (!button || state.busyId) return;
  const item = state.rows.find((row) => Number(row.id) === Number(button.dataset.requestId));
  if (!item) return;
  const action = button.dataset.requestAction;
  if (action === 'external-complete') { openExternalComplete(item); return; }
  if (action === 'awaiting-cancel') { openAwaitingCancel(item); return; }
  runLegacyReviewAction(item, action);
}

function openExternalComplete(item) {
  Modal.open({ title: 'Xác nhận thanh toán ngoài PayOS', className: 'registration-operation-modal', body: `
    <div class="operation-warning">${renderIcon('warning')}<p>Chỉ tiếp tục khi tiền đã được kiểm tra bên ngoài PayOS. Hệ thống sẽ ghi thanh toán <strong>external</strong>, hoàn tất toàn bộ lô và kích hoạt Kiosk đúng một lần.</p></div>
    <dl class="operation-summary"><div><dt>Hồ sơ</dt><dd>#${item.id} · ${escapeHtml(item.facebook_name || '—')}</dd></div><div><dt>Phạm vi</dt><dd>${Number(item.batch_item_count || 0) > 1 ? `Toàn bộ lô ${Number(item.batch_item_count)} Kiosk` : '1 Kiosk'}</dd></div><div><dt>Số tiền</dt><dd>${formatCurrency(item.batch_total_amount || item.total_amount || 0)}</dd></div><div><dt>PayOS</dt><dd>${escapeHtml(paymentStateText(item))}</dd></div></dl>
    <label class="form-group"><span>Ghi chú đối soát</span><textarea id="external-payment-note" class="form-control" rows="3" placeholder="Ví dụ: Đã nhận chuyển khoản ngoài PayOS"></textarea></label>
    <div id="registration-operation-error" class="form-error hidden" role="alert"></div>
    <div class="modal-actions"><button class="btn-secondary" type="button" data-operation-close>Đóng</button><button class="btn-primary" type="button" data-operation-confirm>${renderIcon('check')} Xác nhận & kích hoạt</button></div>` });
  bindModalAction(item.id, 'external-complete');
}

function openAwaitingCancel(item) {
  Modal.open({ title: 'Hủy hồ sơ chờ thanh toán', className: 'registration-operation-modal', body: `
    <p>Hồ sơ và lịch sử tài chính sẽ được giữ lại. Hệ thống từ chối hủy nếu đã có thanh toán hoàn tất hoặc Kiosk đang hoạt động.</p>
    <label class="form-group"><span>Lý do hủy *</span><textarea id="awaiting-cancel-reason" class="form-control" rows="3" required></textarea></label>
    <div id="registration-operation-error" class="form-error hidden" role="alert"></div>
    <div class="modal-actions"><button class="btn-secondary" type="button" data-operation-close>Đóng</button><button class="btn-danger" type="button" data-operation-confirm>${renderIcon('x-circle')} Hủy hồ sơ</button></div>` });
  bindModalAction(item.id, 'awaiting-cancel');
}

function bindModalAction(id, action) {
  document.querySelector('[data-operation-close]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-operation-confirm]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const errorTarget = document.getElementById('registration-operation-error');
    const value = action === 'external-complete' ? document.getElementById('external-payment-note')?.value.trim() || '' : document.getElementById('awaiting-cancel-reason')?.value.trim() || '';
    if (action === 'awaiting-cancel' && !value) { errorTarget.textContent = 'Vui lòng nhập lý do hủy.'; errorTarget.classList.remove('hidden'); Toast.show('Vui lòng nhập lý do hủy hồ sơ.', 'warning'); document.getElementById('awaiting-cancel-reason')?.focus(); return; }
    state.busyId = id; setButtonBusy(button, true, { busyLabel: 'Đang xử lý...' });
    try {
      if (action === 'external-complete') await RegistrationRequestService.completeExternal(id, value);
      else await RegistrationRequestService.cancelAwaiting(id, value);
      Modal.close(); Toast.show(action === 'external-complete' ? 'Đã ghi nhận thanh toán ngoài PayOS và kích hoạt Kiosk.' : 'Đã hủy hồ sơ, lịch sử vẫn được lưu.', 'success');
      window.dispatchEvent(new CustomEvent('dhl:actionable-registration-changed'));
      await loadRequests();
    } catch (error) { errorTarget.textContent = error?.message || 'Không thể xử lý hồ sơ.'; errorTarget.classList.remove('hidden'); Toast.show(errorTarget.textContent, 'error'); }
    finally { state.busyId = null; setButtonBusy(button, false); }
  });
}

async function runLegacyReviewAction(item, action) {
  let reason = '';
  if (action === 'reject' || action === 'legacy-cancel') { reason = window.prompt(action === 'legacy-cancel' ? 'Nhập lý do hủy yêu cầu bổ sung:' : 'Nhập lý do từ chối đơn:')?.trim() || ''; if (!reason) return; }
  else if (!window.confirm(action === 'legacy-approve' ? 'Duyệt hồ sơ và lưu thông tin vào Khách hàng/Kiosk?' : 'Duyệt hồ sơ đăng ký này?')) return;
  state.busyId = item.id; setRowButtonsDisabled(item.id, true);
  try {
    if (action === 'approve') await RegistrationRequestService.approve(item.id);
    if (action === 'reject') await RegistrationRequestService.reject(item.id, reason);
    if (action === 'legacy-approve') await RegistrationRequestService.reviewLegacy(item.id, 'approve');
    if (action === 'legacy-cancel') await RegistrationRequestService.reviewLegacy(item.id, 'cancel', reason);
    Toast.show('Đã cập nhật hồ sơ.', 'success');
    window.dispatchEvent(new CustomEvent('dhl:actionable-registration-changed'));
    await loadRequests();
  } catch (error) { window.alert(error?.message || 'Không thể xử lý đơn đăng ký.'); }
  finally { state.busyId = null; setRowButtonsDisabled(item.id, false); }
}

function filterRequests(rows) { const query = normalizeSearch(state.searchTerm); if (!query) return rows; return rows.filter((item) => [item.id, item.facebook_name, item.facebook_id, item.phone, item.business_type_name, item.category_name, item.status, item.total_amount].map(normalizeSearch).join(' ').includes(query)); }
function isLegacyRequest(item) { const source = String(item?.metadata?.request_type || item?.metadata?.source || '').toLowerCase(); return source.includes('legacy') || source.includes('additional'); }
function requestPeriod(item) { return item.months ? `${Number(item.months)} tháng` : `${formatDateOnly(item.requested_start_date)} – ${formatDateOnly(item.requested_end_date)}`; }
function paymentStateText(item) { const labels = { not_created: 'Chưa tạo liên kết thanh toán', preparing: 'Đang tạo PayOS', awaiting_customer: 'Đang chờ khách thanh toán', expired: 'Link thanh toán hết hạn', create_failed: 'Tạo PayOS thất bại', cancelled: 'PayOS đã hủy', completed: 'PayOS đã hoàn tất' }; return labels[item.payos_state] || 'Chưa có trạng thái PayOS'; }
function setRowButtonsDisabled(id, disabled) { document.querySelectorAll(`[data-request-id="${id}"]`).forEach((button) => { button.disabled = disabled; }); }
function formatDateOnly(value) { if (!value) return '—'; return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(`${value}T00:00:00`)); }
function formatDateTime(value) { if (!value) return '—'; return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function safeHref(value) { if (!value) return ''; try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function normalizeSearch(value) { return String(value || '').trim().toLocaleLowerCase('vi'); }
function loadingRow() { return stateRow('Đang tải hồ sơ Kiosk', 'Vui lòng chờ trong giây lát.'); }
function stateRow(title, message) { return `<tr><td colspan="10">${EmptyState({ title, message: escapeHtml(message) })}</td></tr>`; }
