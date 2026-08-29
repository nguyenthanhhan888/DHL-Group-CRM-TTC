import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toolbar } from '../components/Toolbar.js';
import { LOG_COLUMNS } from '../constants/tables.js';
import { AuditLogService } from '../services/AuditLogService.js';
import { debounce } from '../utils/dom.js';
import { bindPagination, Pagination, updatePagination } from '../components/Pagination.js';
import { escapeHtml } from '../utils/html.js';
import {
  activityLogPresentation,
  actionLabel,
  categoryLabel,
  formatAuditLog,
} from '../utils/auditLogPresentation.js';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const ACTION_FILTERS = [
  { value: 'create', label: 'Tạo mới' },
  { value: 'update', label: 'Cập nhật' },
  { value: 'delete', label: 'Xóa' },
  { value: 'confirm', label: 'Xác nhận' },
  { value: 'cancel', label: 'Hủy' },
  { value: 'reject', label: 'Từ chối' },
  { value: 'reset_password', label: 'Reset mật khẩu' },
  { value: 'set_active', label: 'Kích hoạt/Vô hiệu hóa' },
  { value: 'admin_manual_renewal', label: 'Gia hạn Kiosk' },
  { value: 'confirm_payos', label: 'Xác nhận thanh toán PayOS' },
  { value: 'confirm_payos_batch', label: 'Xác nhận thanh toán PayOS theo đơn' },
  { value: 'admin_cancel', label: 'Hủy hồ sơ Kiosk' },
  { value: 'update_profile', label: 'Cập nhật người dùng' },
  { value: 'sync_permissions', label: 'Thay đổi quyền' },
  { value: 'lock_user', label: 'Khóa người dùng' },
  { value: 'unlock_user', label: 'Mở khóa người dùng' },
  { value: 'create_promotion', label: 'Tạo mã giảm giá' },
  { value: 'update_promotion', label: 'Sửa mã giảm giá' },
  { value: 'pause_promotion', label: 'Tạm ngưng mã giảm giá' },
  { value: 'reactivate_promotion', label: 'Kích hoạt mã giảm giá' },
];
const MODULE_FILTERS = [
  { value: 'Kiosk', label: 'Kiosk' },
  { value: 'Customer', label: 'Khách hàng' },
  { value: 'Payment', label: 'Thanh toán' },
  { value: 'Renewal', label: 'Gia hạn' },
  { value: 'UserManagement', label: 'Người dùng' },
  { value: 'Promotion', label: 'Mã giảm giá' },
  { value: 'System', label: 'Hệ thống' },
];

const state = {
  searchTerm: '',
  actor: '',
  action: '',
  module: '',
  fromDate: '',
  toDate: '',
  page: 1,
  pageSize: 10,
  total: 0,
  requestId: 0,
  items: [],
  showTechnical: false,
};

export function LogsPage() {
  return `
    <div class="logs-page">
    ${PageHeader({
      title: 'Lịch sử thay đổi',
      description: 'Theo dõi những thay đổi nghiệp vụ quan trọng trong CRM.',
    })}
    ${Toolbar({
      children: `
        <input
          type="search"
          id="log-search"
          class="form-control"
          placeholder="Tìm theo nội dung, hành động hoặc người thực hiện"
          aria-label="Tìm lịch sử"
          autocomplete="off"
        />
        <input
          type="search"
          id="log-actor-filter"
          class="form-control"
          placeholder="Lọc người thực hiện, vai trò"
          aria-label="Lọc người thực hiện"
          autocomplete="off"
        />
        <select id="log-action-filter" class="filter-select" aria-label="Lọc hành động">
          <option value="">Tất cả hành động</option>
          ${ACTION_FILTERS.map((action) => `<option value="${action.value}">${action.label}</option>`).join('')}
        </select>
        <select id="log-module-filter" class="filter-select" aria-label="Lọc nhóm dữ liệu">
          <option value="">Tất cả nhóm dữ liệu</option>
          ${MODULE_FILTERS.map((table) => `<option value="${table.value}">${table.label}</option>`).join('')}
        </select>
        <label class="form-group compact">
          <span>Từ ngày</span>
          <input id="log-from-date" class="form-control" type="date" />
        </label>
        <label class="checkbox-field log-technical-toggle"><input id="log-show-technical" type="checkbox" /><span>Hiện thay đổi kỹ thuật</span></label>
        <label class="form-group compact">
          <span>Đến ngày</span>
          <input id="log-to-date" class="form-control" type="date" />
        </label>
      `,
    })}
    <div class="table-card logs-table-card">
      <table class="data-table logs-table">
        <thead>
          <tr>${LOG_COLUMNS.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
        </thead>
        <tbody id="logs-table-body">
          ${renderTableState('Đang tải lịch sử', 'Đang tải các thay đổi gần đây.')}
        </tbody>
      </table>
    </div>
    <div id="logs-mobile-list" class="logs-mobile-list" aria-live="polite"></div>
    ${Pagination({ id: 'logs', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'hoạt động' })}
    </div>
  `;
}

LogsPage.afterRender = function afterRenderLogs() {
  syncLogControls();
  bindLogEvents();
  bindPagination('logs', {
    onPage: (page) => { state.page = page; loadLogs(); },
    onPageSize: (pageSize) => { state.pageSize = pageSize; state.page = 1; loadLogs(); },
  });
  loadLogs();
};

function syncLogControls() {
  const searchInput = document.getElementById('log-search');
  const actionFilter = document.getElementById('log-action-filter');
  const moduleFilter = document.getElementById('log-module-filter');
  const actorFilter = document.getElementById('log-actor-filter');
  const fromDate = document.getElementById('log-from-date');
  const toDate = document.getElementById('log-to-date');
  const pageSizeSelect = document.getElementById('logs-page-size');

  if (searchInput) searchInput.value = state.searchTerm;
  if (actionFilter) actionFilter.value = state.action;
  if (moduleFilter) moduleFilter.value = state.module;
  if (actorFilter) actorFilter.value = state.actor;
  if (fromDate) fromDate.value = state.fromDate;
  if (toDate) toDate.value = state.toDate;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
  const technicalToggle = document.getElementById('log-show-technical');
  if (technicalToggle) technicalToggle.checked = state.showTechnical;
}

function bindLogEvents() {
  document.getElementById('log-search')?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    loadLogs();
  }, 300));

  document.getElementById('log-actor-filter')?.addEventListener('input', debounce((event) => {
    state.actor = event.target.value.trim();
    state.page = 1;
    loadLogs();
  }, 300));

  document.getElementById('log-action-filter')?.addEventListener('change', (event) => {
    state.action = event.target.value;
    state.page = 1;
    loadLogs();
  });

  document.getElementById('log-module-filter')?.addEventListener('change', (event) => {
    state.module = event.target.value;
    state.page = 1;
    loadLogs();
  });

  document.getElementById('log-from-date')?.addEventListener('change', (event) => {
    state.fromDate = event.target.value;
    state.page = 1;
    loadLogs();
  });

  document.getElementById('log-to-date')?.addEventListener('change', (event) => {
    state.toDate = event.target.value;
    state.page = 1;
    loadLogs();
  });
  document.getElementById('log-show-technical')?.addEventListener('change', (event) => {
    state.showTechnical = event.target.checked;
    state.page = 1;
    loadLogs();
  });


  document.querySelector('.logs-page')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-log-view]');
    if (!button) return;

    const log = state.items.find((item) => String(item.id) === String(button.dataset.logView));
    if (log) openLogDetail(log);
  });
}

async function loadLogs() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const { data, count, page: responsePage } = await AuditLogService.list({
      searchTerm: state.searchTerm,
      actor: state.actor,
      action: state.action,
      module: state.module,
      fromTime: dateBoundary(state.fromDate),
      toTime: dateBoundary(state.toDate, true),
      showTechnical: state.showTechnical,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count || 0;
    state.items = data || [];
    state.page = responsePage || 1;
    const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page > lastPage) {
      state.page = lastPage;
      loadLogs();
      return;
    }
    renderLogs(data || []);
    renderPagination();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderLogs(logs) {
  const body = document.getElementById('logs-table-body');
  const mobileList = document.getElementById('logs-mobile-list');
  if (!body || !mobileList) return;

  if (!logs.length) {
    body.innerHTML = renderTableState(
      'Chưa có lịch sử',
      state.showTechnical ? 'Không có bản ghi log nào khớp với bộ lọc hiện tại.' : 'Không có hoạt động nghiệp vụ khớp với bộ lọc hiện tại.',
    );
    mobileList.innerHTML = EmptyState({ title: 'Chưa có lịch sử', message: 'Không có hoạt động khớp với bộ lọc hiện tại.' });
    return;
  }

  body.innerHTML = logs.map((log) => renderLogRow(log)).join('');
  mobileList.innerHTML = logs.map((log) => renderLogCard(log)).join('');
}

function renderLogRow(log) {
  const item = formatAuditLog(log);
  return `
    <tr>
      <td>${renderBusinessActivity(log, item)}</td>
      <td><div class="log-actor"><strong>${escapeHtml(item.actorName)}</strong><span>${escapeHtml(item.source)}</span></div></td>
      <td>${renderDateTime(log.created_at)}</td>
      <td class="log-detail-cell"><button class="table-action-button" type="button" data-log-view="${escapeHtml(log.id)}">Xem chi tiết</button></td>
    </tr>`;
}

function renderLogCard(log) {
  const item = formatAuditLog(log);
  return `
    <article class="log-mobile-card">
      <div class="log-mobile-card-head">${renderActionBadge(log.action, item.actionLabel, item.category)}${renderCompactDateTime(log.created_at)}</div>
      <strong class="log-mobile-target">${escapeHtml(item.title)}</strong>
      ${item.secondary ? `<span class="log-mobile-change">${escapeHtml(item.secondary)}</span>` : ''}
      <div class="log-mobile-footer"><span>${escapeHtml(item.actorName)}</span><button class="table-action-button" type="button" data-log-view="${escapeHtml(log.id)}">Xem chi tiết</button></div>
    </article>`;
}

function renderBusinessActivity(log, item) {
  const technicalHint = state.showTechnical
    ? `<small class="log-technical-inline">${escapeHtml(log.action || 'unknown')} · ${escapeHtml(log.entity || log.module || 'system')}</small>`
    : '';
  return `<div class="log-business-activity">${renderActionBadge(log.action, item.actionLabel, item.category)}<strong>${escapeHtml(item.title)}</strong>${item.secondary ? `<span>${escapeHtml(item.secondary)}</span>` : ''}${technicalHint}</div>`;
}

function renderActionBadge(action, label = actionLabel(action), category = '') {
  const normalized = String(action || 'unknown').toLowerCase();
  const tone = /delete|reject|cancel/.test(normalized) ? 'danger' : /confirm|approve|renewal/.test(normalized) ? 'success' : /update|set_active/.test(normalized) ? 'info' : 'neutral';
  return `<span class="status-badge status-badge--${tone}" title="${escapeHtml(categoryLabel(category))}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function openLogDetail(log) {
  Modal.open({
    title: 'Chi tiết lịch sử',
    body: renderLogModal(log),
    className: 'modal-wide',
  });
}

function renderLogModal(log) {
  const item = formatAuditLog(log);
  return `
    <section class="log-detail-summary">
      ${renderActionBadge(log.action, item.actionLabel, item.category)}
      <h3>${escapeHtml(item.title)}</h3>
      ${item.secondary ? `<p>${escapeHtml(item.secondary)}</p>` : ''}
    </section>
    <div class="log-meta-grid log-business-meta">
      ${metaRow('Hành động', item.actionLabel)}
      ${metaRow('Người thực hiện', item.actorName)}
      ${metaRow('Đối tượng', item.objectName)}
      ${metaRow('Thời gian', formatDateTime(log.created_at))}
      ${metaRow('Nguồn thay đổi', item.source)}
      ${metaRow('Nhóm dữ liệu', item.categoryLabel)}
      ${log.reason && !/legacy logs|không cung cấp lý do/i.test(log.reason) ? metaRow('Lý do', log.reason) : ''}
    </div>
    <div class="log-change-section">${renderBusinessChanges(item.changes)}</div>
    <details class="log-technical-details"><summary>Thông tin kỹ thuật</summary>${metaRow('Tên event', log.action || '—')}${metaRow('Bảng / module', log.entity || log.module || '—')}${metaRow('ID liên quan', log.record_id || '—')}${metaRow('Loại actor', log.actor_type || '—')}${renderRawJson(log.before, log.after)}</details>
  `;
}

function renderBusinessChanges(changes) {
  if (!changes.length) {
    return '<div class="empty-state compact"><div class="empty-state-title">Không có thay đổi giá trị cần hiển thị</div></div>';
  }

  return `
    <div class="log-json-section">
      <h4>Nội dung thay đổi</h4>
      <div class="table-card log-diff-card">
        <table class="data-table log-diff-table">
          <thead>
            <tr>
              <th>Trường</th>
              <th>Giá trị cũ</th>
              <th>Giá trị mới</th>
            </tr>
          </thead>
          <tbody>
            ${changes.map((change) => `
              <tr>
                <td class="strong-cell">${escapeHtml(change.label)}</td>
                <td class="old-value">${escapeHtml(change.before)}</td>
                <td class="new-value">${escapeHtml(change.after)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRawJson(before, after) {
  return `
    <div class="log-json-section">
      <h4>Dữ liệu gốc</h4>
      <pre class="json-block">${escapeHtml(JSON.stringify({ before: before || null, after: after || null }, null, 2))}</pre>
    </div>
  `;
}

function metaRow(label, value) {
  return `
    <div class="setting-item">
      <span class="setting-name">${escapeHtml(label)}</span>
      <span class="setting-value detail-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function setLoadingState() {
  const body = document.getElementById('logs-table-body');
  const mobileList = document.getElementById('logs-mobile-list');
  if (body) {
    body.innerHTML = renderTableState('Đang tải lịch sử', 'Đang tải các thay đổi gần đây.');
  }
  if (mobileList) mobileList.innerHTML = EmptyState({ title: 'Đang tải lịch sử', message: 'Đang tải các thay đổi gần đây.' });
}

function renderError(error) {
  const body = document.getElementById('logs-table-body');
  const mobileList = document.getElementById('logs-mobile-list');
  state.total = 0;
  state.items = [];

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải lịch sử',
      error?.message || 'Không thể tải lịch sử thay đổi. Vui lòng thử lại.',
    );
  }
  if (mobileList) mobileList.innerHTML = EmptyState({ title: 'Không thể tải lịch sử', message: escapeHtml(error?.message || 'Vui lòng thử lại.') });

  renderPagination();
}

function renderTableState(title, message) {
  return `
    <tr>
      <td colspan="${LOG_COLUMNS.length}">
        ${EmptyState({ title, message: escapeHtml(message) })}
      </td>
    </tr>
  `;
}

function renderPagination() {
  updatePagination({ id: 'logs', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'hoạt động' });
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

function dateTimeParts(value) {
  if (!value) return { date: '—', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
  return {
    date: new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date),
  };
}

function renderDateTime(value) {
  const parts = dateTimeParts(value);
  return `<time class="log-time" datetime="${escapeHtml(value || '')}"><span>${parts.date}</span><span>${parts.time}</span></time>`;
}

function renderCompactDateTime(value) {
  const parts = dateTimeParts(value);
  return `<time class="log-mobile-time" datetime="${escapeHtml(value || '')}">${escapeHtml(parts.date.replace(/\/\d{4}$/, ''))} · ${escapeHtml(parts.time)}</time>`;
}

function dateBoundary(value, exclusiveEnd = false) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export { activityLogPresentation };
