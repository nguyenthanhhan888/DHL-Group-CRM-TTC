import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toolbar } from '../components/Toolbar.js';
import { LOG_COLUMNS } from '../constants/tables.js';
import { AuditLogService } from '../services/AuditLogService.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const ACTION_FILTERS = [
  { value: 'create', label: 'Tạo mới' },
  { value: 'update', label: 'Cập nhật' },
  { value: 'delete', label: 'Xóa' },
  { value: 'confirm', label: 'Xác nhận' },
  { value: 'cancel', label: 'Hủy' },
  { value: 'reject', label: 'Từ chối' },
  { value: 'reset_password', label: 'Reset mật khẩu' },
  { value: 'set_active', label: 'Kích hoạt/Vô hiệu hóa' },
];
const MODULE_FILTERS = [
  { value: 'Customer', label: 'Khách hàng' },
  { value: 'Kiosk', label: 'Kiosk' },
  { value: 'Payment', label: 'Thanh toán' },
  { value: 'Registration', label: 'Đăng ký' },
  { value: 'Renewal', label: 'Gia hạn' },
  { value: 'Staff', label: 'Nhân viên' },
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
};

export function LogsPage() {
  return `
    <div class="logs-page">
    ${PageHeader({
      title: 'Lịch sử thay đổi',
      description: 'Theo dõi các hành động quan trọng trong hệ thống.',
    })}
    ${Toolbar({
      children: `
        <input
          type="search"
          id="log-search"
          class="form-control"
          placeholder="Tìm theo module, hành động, người thực hiện, lý do"
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
        <select id="log-module-filter" class="filter-select" aria-label="Lọc module">
          <option value="">Tất cả module</option>
          ${MODULE_FILTERS.map((table) => `<option value="${table.value}">${table.label}</option>`).join('')}
        </select>
        <label class="form-group compact">
          <span>Từ ngày</span>
          <input id="log-from-date" class="form-control" type="date" />
        </label>
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
          ${renderTableState('Đang tải lịch sử', 'Đang đọc dữ liệu từ Supabase.')}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <div id="logs-page-summary" class="pagination-summary">—</div>
      <div class="pagination-controls">
        <select id="logs-page-size" class="filter-select compact" aria-label="Số log mỗi trang">
          ${PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}" ${size === state.pageSize ? 'selected' : ''}>${size} / trang</option>`).join('')}
        </select>
        <button id="logs-prev-page" class="btn-secondary" type="button">Trước</button>
        <button id="logs-next-page" class="btn-secondary" type="button">Sau</button>
      </div>
    </div>
    </div>
  `;
}

LogsPage.afterRender = function afterRenderLogs() {
  syncLogControls();
  bindLogEvents();
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

  document.getElementById('logs-page-size')?.addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    loadLogs();
  });

  document.getElementById('logs-prev-page')?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadLogs();
  });

  document.getElementById('logs-next-page')?.addEventListener('click', () => {
    if (state.page >= totalPages()) return;
    state.page += 1;
    loadLogs();
  });

  document.getElementById('logs-table-body')?.addEventListener('click', (event) => {
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
    const { data, count } = await AuditLogService.list({
      searchTerm: state.searchTerm,
      actor: state.actor,
      action: state.action,
      module: state.module,
      fromTime: dateBoundary(state.fromDate),
      toTime: dateBoundary(state.toDate, true),
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count || 0;
    state.items = data || [];
    renderLogs(data || []);
    renderPagination();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderLogs(logs) {
  const body = document.getElementById('logs-table-body');
  if (!body) return;

  if (!logs.length) {
    body.innerHTML = renderTableState(
      'Chưa có lịch sử',
      'Không có bản ghi log nào khớp với bộ lọc hiện tại.',
    );
    return;
  }

  body.innerHTML = logs.map((log) => `
    <tr>
      <td>${formatDateTime(log.created_at)}</td>
      <td>${renderActionBadge(log.action)}</td>
      <td>${escapeHtml(log.module || '—')}</td>
      <td>${escapeHtml(log.actor_name || 'Hệ thống')}</td>
      <td>${escapeHtml(log.reason || '—')}</td>
      <td class="log-detail-cell">
        <button class="table-action-button" type="button" data-log-view="${escapeHtml(log.id)}">Xem chi tiết</button>
      </td>
    </tr>
  `).join('');
}

function renderActionBadge(action) {
  const normalized = String(action || 'unknown').toLowerCase();
  const safeClass = normalized.replace(/[^a-z0-9-]/g, '') || 'unknown';
  const labels = {
    create: 'Tạo mới',
    update: 'Cập nhật',
    delete: 'Xóa',
    confirm: 'Xác nhận',
    cancel: 'Hủy',
    reject: 'Từ chối',
    reset_password: 'Reset mật khẩu',
    set_active: 'Kích hoạt/Vô hiệu hóa',
  };

  return `<span class="badge badge-${safeClass}">${labels[normalized] || escapeHtml(action || 'Không rõ')}</span>`;
}

function openLogDetail(log) {
  Modal.open({
    title: 'Chi tiết lịch sử',
    body: renderLogModal(log),
    className: 'modal-wide',
  });
}

function renderLogModal(log) {
  return `
    <div class="log-meta-grid">
      ${metaRow('Thời gian', formatDateTime(log.created_at))}
      ${metaRow('Hành động', actionLabel(log.action))}
      ${metaRow('Module', log.module || '—')}
      ${metaRow('Người thực hiện', log.actor_name || 'Hệ thống')}
      ${metaRow('Loại actor', actorTypeLabel(log.actor_type))}
      ${metaRow('Vai trò', log.actor_role || '—')}
      ${metaRow('Entity', log.entity || log.module || '—')}
      ${metaRow('Record ID', log.record_id || '—')}
      ${metaRow('Lý do', log.reason || '—')}
    </div>
    ${renderLogModalBody(log.action, log.before, log.after)}
  `;
}

function renderLogModalBody(action, before, after) {
  action = normalizeAction(action);
  if (action === 'create') {
    return renderJsonBlock('Dữ liệu mới', after);
  }

  if (action === 'delete') {
    return renderJsonBlock('Dữ liệu đã xóa', before);
  }

  return renderDiffTable(before, after);
}

function renderDiffTable(before, after) {
  const fields = summarizeChangedFields(before, after);
  if (!fields.length) {
    return '<div class="empty-state compact"><div class="empty-state-title">Không có diff</div></div>';
  }

  return `
    <div class="log-json-section">
      <h4>Chi tiết thay đổi</h4>
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
            ${fields.map((field) => `
              <tr>
                <td class="strong-cell">${escapeHtml(field)}</td>
                <td class="old-value">${formatJsonValue(before?.[field])}</td>
                <td class="new-value">${formatJsonValue(after?.[field])}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderJsonBlock(title, value) {
  return `
    <div class="log-json-section">
      <h4>${escapeHtml(title)}</h4>
      <pre class="json-block">${escapeHtml(JSON.stringify(value || {}, null, 2))}</pre>
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

function summarizeChangedFields(before, after) {
  if (!before && after) return Object.keys(after);
  if (before && !after) return Object.keys(before);
  if (!before || !after) return [];

  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function normalizeAction(action) {
  return String(action || '').toLowerCase();
}

function actionLabel(action) {
  const labels = {
    create: 'Tạo mới',
    update: 'Cập nhật',
    delete: 'Xóa',
    confirm: 'Xác nhận',
    cancel: 'Hủy',
    reject: 'Từ chối',
    reset_password: 'Reset mật khẩu',
    set_active: 'Kích hoạt/Vô hiệu hóa',
  };
  return labels[normalizeAction(action)] || action || 'Không rõ';
}

function formatJsonValue(value) {
  if (value === undefined || value === null || value === '') {
    return '<em class="muted-text">(trống)</em>';
  }

  return escapeHtml(typeof value === 'object'
    ? JSON.stringify(value)
    : String(value));
}

function setLoadingState() {
  const body = document.getElementById('logs-table-body');
  if (body) {
    body.innerHTML = renderTableState('Đang tải lịch sử', 'Đang đọc dữ liệu từ Supabase.');
  }
}

function renderError(error) {
  const body = document.getElementById('logs-table-body');
  state.total = 0;
  state.items = [];

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải lịch sử',
      error?.message || 'Supabase trả về lỗi khi đọc bảng logs.',
    );
  }

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
  const summary = document.getElementById('logs-page-summary');
  const prev = document.getElementById('logs-prev-page');
  const next = document.getElementById('logs-next-page');
  const pages = totalPages();

  if (summary) {
    summary.textContent = state.total
      ? `Trang ${state.page} / ${pages} · ${state.total} log`
      : '0 log';
  }

  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.pageSize));
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

function actorTypeLabel(actorType) {
  const labels = {
    staff: 'Nhân viên',
    public: 'Người dùng công khai',
    system: 'Hệ thống',
    database_trigger: 'Database Trigger',
  };
  return labels[String(actorType || '').toLowerCase()] || actorType || 'Hệ thống';
}

function dateBoundary(value, exclusiveEnd = false) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
