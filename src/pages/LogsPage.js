import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toolbar } from '../components/Toolbar.js';
import { LOG_COLUMNS } from '../constants/tables.js';
import { AuditLogService } from '../services/AuditLogService.js';
import { debounce } from '../utils/dom.js';
import { formatCurrency } from '../utils/currency.js';
import { bindPagination, Pagination, updatePagination } from '../components/Pagination.js';
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
  { value: 'admin_manual_renewal', label: 'Gia hạn Kiosk' },
  { value: 'confirm_payos', label: 'Xác nhận thanh toán PayOS' },
  { value: 'confirm_payos_batch', label: 'Xác nhận thanh toán PayOS theo đơn' },
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
  showTechnical: false,
};

export function LogsPage() {
  return `
    <div class="logs-page">
    ${PageHeader({
      title: 'Lịch sử thay đổi',
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
        <select id="log-module-filter" class="filter-select" aria-label="Lọc module">
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
  const technicalToggle=document.getElementById('log-show-technical');if(technicalToggle)technicalToggle.checked=state.showTechnical;
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
  document.getElementById('log-show-technical')?.addEventListener('change',(event)=>{state.showTechnical=event.target.checked;renderLogs(state.items);});


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

  const visibleLogs=state.showTechnical?logs:logs.filter(isBusinessActivity);
  if (!visibleLogs.length) {
    body.innerHTML = renderTableState(
      'Chưa có lịch sử',
      state.showTechnical?'Không có bản ghi log nào khớp với bộ lọc hiện tại.':'Không có hoạt động nghiệp vụ trong trang này. Bật “Hiện thay đổi kỹ thuật” để xem audit gốc.',
    );
    return;
  }

  body.innerHTML = visibleLogs.map((log) => `
    <tr>
      <td>${escapeHtml(log.actor_name || 'Hệ thống')}</td>
      <td><div class="log-primary-action">${renderActionBadge(log.action)}<strong>${escapeHtml(humanLogSummary(log))}</strong></div></td>
      <td>${escapeHtml(entityDisplayName(log))}</td>
      <td>${formatDateTime(log.created_at)}</td>
      <td>${escapeHtml(importantChange(log))}</td>
      <td class="log-detail-cell">
        <button class="table-action-button" type="button" data-log-view="${escapeHtml(log.id)}">Xem chi tiết</button>
      </td>
    </tr>
  `).join('');
}

function isBusinessActivity(log){const action=normalizeAction(log.action);return ['create','delete','confirm','cancel','reject','approve','approved','reset_password','set_active','admin_manual_renewal','confirm_payos','confirm_payos_batch','review_legacy_approve','review_legacy_cancel','create_promotion','update_promotion','pause_promotion','reactivate_promotion','delete_promotion'].includes(action);}

function renderActionBadge(action) {
  const normalized = String(action || 'unknown').toLowerCase();
  const tone = /delete|reject|cancel/.test(normalized) ? 'danger' : /confirm|approve|renewal/.test(normalized) ? 'success' : /update|set_active/.test(normalized) ? 'info' : 'neutral';
  return `<span class="status-badge status-badge--${tone}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(actionLabel(action))}</span>`;
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
      ${metaRow('Nhóm dữ liệu', moduleLabel(log.module))}
      ${metaRow('Người thực hiện', log.actor_name || 'Hệ thống')}
      ${metaRow('Nguồn thao tác', actorTypeLabel(log.actor_type))}
      ${metaRow('Vai trò', log.actor_role || '—')}
      ${metaRow('Tóm tắt', humanLogSummary(log))}
      ${metaRow('Thay đổi chính', importantChange(log))}
      ${metaRow('Lý do ghi nhận', friendlyReason(log.reason))}
    </div>
    <div class="log-change-section">${renderLogModalBody(log.action, log.before, log.after)}</div>
    <details class="log-technical-details"><summary>Chi tiết kỹ thuật</summary>${metaRow('Nhóm nội bộ', log.entity || log.module || '—')}${metaRow('Mã bản ghi', log.record_id || '—')}${renderRawJson(log.before, log.after)}</details>
  `;
}

function renderLogModalBody(action, before, after) {
  action = normalizeAction(action);
  if (action === 'create') {
    return renderDiffTable(null, after);
  }

  if (action === 'delete') {
    return renderDiffTable(before, null);
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
                <td class="strong-cell">${escapeHtml(fieldLabel(field))}</td>
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
    reset_password: 'Đặt lại mật khẩu',
    set_active: 'Kích hoạt/Vô hiệu hóa',
    admin_manual_renewal: 'Gia hạn Kiosk',
    confirm_payos: 'Xác nhận thanh toán PayOS',
    confirm_payos_batch: 'Xác nhận thanh toán PayOS',
    approve: 'Phê duyệt',
    approved: 'Phê duyệt',
    review_legacy_approve: 'Duyệt hồ sơ bổ sung',
    review_legacy_cancel: 'Hủy hồ sơ bổ sung',
    create_promotion: 'Tạo mã giảm giá',
    update_promotion: 'Cập nhật chương trình',
    pause_promotion: 'Tạm ngưng mã giảm giá',
    reactivate_promotion: 'Kích hoạt lại mã giảm giá',
    delete_promotion: 'Xóa mã giảm giá',
  };
  return labels[normalizeAction(action)] || 'Hoạt động hệ thống';
}

function formatJsonValue(value) {
  if (value === undefined || value === null || value === '') {
    return '<em class="muted-text">(trống)</em>';
  }

  if (typeof value === 'object') return `<span class="muted-text">${escapeHtml(complexValueSummary(value))}</span>`;
  return escapeHtml(formatDisplayValue(value));
}

function setLoadingState() {
  const body = document.getElementById('logs-table-body');
  if (body) {
    body.innerHTML = renderTableState('Đang tải lịch sử', 'Đang tải các thay đổi gần đây.');
  }
}

function renderError(error) {
  const body = document.getElementById('logs-table-body');
  state.total = 0;
  state.items = [];

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải lịch sử',
      error?.message || 'Không thể tải lịch sử thay đổi. Vui lòng thử lại.',
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
  updatePagination({ id: 'logs', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'hoạt động' });
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
    database_trigger: 'Tự động',
  };
  return labels[String(actorType || '').toLowerCase()] || 'Nguồn khác';
}

function dateBoundary(value, exclusiveEnd = false) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function moduleLabel(module) {
  const labels = {
    ...Object.fromEntries(MODULE_FILTERS.map((item) => [item.value.toLowerCase(), item.label])),
    customers: 'Khách hàng',
    kiosks: 'Kiosk',
    payments: 'Thanh toán',
    registration_batches: 'Đăng ký Kiosk',
    registration_requests: 'Đăng ký Kiosk',
    promotion: 'Mã giảm giá',
    promotions: 'Mã giảm giá',
  };
  return labels[String(module || '').toLowerCase()] || 'Nhóm khác';
}

function humanLogSummary(log) {
  const actor = log.actor_name || 'Hệ thống';
  const entity = entityDisplayName(log);
  const action = normalizeAction(log.action);
  const amount = extractValue(log, ['actual_amount', 'total_amount', 'amount']);
  const months = extractValue(log, ['months', 'service_month_delta']);

  if (action === 'admin_manual_renewal') {
    return `${actor} đã gia hạn ${entity}${months ? ` thêm ${months} tháng` : ''}.`;
  }
  if (action === 'confirm_payos' || action === 'confirm_payos_batch') {
    return `Thanh toán PayOS${amount !== null ? ` ${formatCurrency(amount)}` : ''} của ${entity} đã được xác nhận.`;
  }
  if (action === 'create' && entityKind(log) === 'Kiosk') {
    return `${actor} đã đăng ký ${entity}.`;
  }
  if (action === 'create_promotion') return `${actor} đã tạo mã giảm giá ${promotionCode(log)}.`;
  if (action === 'update_promotion') return `${actor} đã cập nhật chương trình ${promotionName(log)}.`;
  if (action === 'pause_promotion') return `${actor} đã tạm ngưng mã ${promotionCode(log)}.`;
  if (action === 'reactivate_promotion') return `${actor} đã kích hoạt lại mã ${promotionCode(log)}.`;
  if (action === 'delete_promotion') return `${actor} đã xóa mã giảm giá ${promotionCode(log)}.`;
  return `${actor} đã ${actionLabel(log.action).toLocaleLowerCase('vi')} ${entity}.`;
}

function promotionCode(log) { return log.resolved_entity?.name || firstNestedValue([log.after,log.before].filter(Boolean),['code']) || `#${log.record_id || '—'}`; }
function promotionName(log) { return firstNestedValue([log.after,log.before].filter(Boolean),['name']) || log.resolved_entity?.name || promotionCode(log); }

function entityKind(log) {
  return moduleLabel(log.entity || log.module);
}

function entityDisplayName(log) {
  if (log.resolved_entity?.name) return entityWithKind(log.resolved_entity.kind, log.resolved_entity.name);
  const kind = entityKind(log);
  const source = [log.after, log.before].filter(Boolean);
  const name = firstNestedValue(source, ['facebook_name', 'name', 'kiosk_name']);
  if (name) return entityWithKind(kind, name);

  const kioskName = firstNestedValue(source, ['kiosk.facebook_name', 'kiosk.name']);
  if (kioskName) return entityWithKind('Kiosk', kioskName);

  const kioskId = firstNestedValue(source, ['kiosk_id', 'payment.kiosk_id']);
  if (log.resolved_entity?.missing) return `${log.resolved_entity.kind} đã xóa`;
  if (kioskId) return `Kiosk #${kioskId}`;
  return log.record_id ? `${kind} #${log.record_id}` : kind;
}

function entityWithKind(kind, name) {
  const text = String(name).trim();
  return text.toLocaleLowerCase('vi').startsWith(String(kind).toLocaleLowerCase('vi')) ? text : `${kind} ${text}`;
}

function importantChange(log) {
  const action = normalizeAction(log.action);
  const months = extractValue(log, ['months', 'service_month_delta']);
  const amount = extractValue(log, ['actual_amount', 'total_amount', 'amount']);
  if (action === 'admin_manual_renewal') {
    return [months ? `${months} tháng` : '', amount !== null ? formatCurrency(amount) : ''].filter(Boolean).join(' · ') || 'Đã cập nhật thời hạn';
  }
  if (action === 'confirm_payos' || action === 'confirm_payos_batch') {
    const count = extractValue(log, ['kiosk_count']);
    return [amount !== null ? formatCurrency(amount) : '', count ? `${count} Kiosk` : ''].filter(Boolean).join(' · ') || 'Thanh toán đã xác nhận';
  }
  const businessResults = {
    create: 'Đã tạo mới', update: 'Đã cập nhật thông tin', delete: 'Đã xóa',
    approve: 'Đã duyệt', approved: 'Đã duyệt', review_legacy_approve: 'Đã duyệt hồ sơ',
    review_legacy_cancel: 'Đã hủy hồ sơ', create_promotion: 'Đã tạo mã',
    update_promotion: 'Đã cập nhật chương trình', pause_promotion: 'Đã tạm ngưng',
    reactivate_promotion: 'Đã kích hoạt', delete_promotion: 'Đã xóa mã',
  };
  return businessResults[action] || friendlyReason(log.reason);
}

function extractValue(log, keys) {
  const sources = [log.after, log.before].filter(Boolean);
  for (const key of keys) {
    const value = firstNestedValue(sources, [key, `payment.${key}`]);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function firstNestedValue(sources, paths) {
  for (const source of sources) {
    for (const path of paths) {
      const value = path.split('.').reduce((current, key) => current?.[key], source);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return null;
}

function fieldLabel(field) {
  const labels = {
    id: 'Mã',
    facebook_name: 'Tên Facebook',
    facebook_id: 'Facebook ID',
    facebook_link: 'Liên kết Facebook',
    customer_id: 'Khách hàng',
    kiosk_id: 'Kiosk',
    category_id: 'Danh mục',
    business_type_id: 'Loại hình kinh doanh',
    start_date: 'Ngày bắt đầu',
    end_date: 'Ngày hết hạn',
    status: 'Trạng thái',
    phone: 'Số điện thoại',
    note: 'Ghi chú',
    months: 'Số tháng',
    total_amount: 'Tổng thanh toán',
    actual_amount: 'Số tiền thực nhận',
    discount: 'Giảm giá',
    payment_status: 'Trạng thái thanh toán',
    payment_method: 'Phương thức thanh toán',
    auto_approve: 'Tự động duyệt',
    created_at: 'Thời gian tạo',
    updated_at: 'Thời gian cập nhật',
    confirmed_at: 'Thời gian xác nhận',
    kiosk_count: 'Số Kiosk',
  };
  return labels[field] || humanizeKey(field);
}

function humanizeKey(value) {
  return String(value || '').replace(/_/g, ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('vi'));
}

function formatDisplayValue(value) {
  const normalized = String(value);
  const statuses = { active: 'Hoạt động', warning: 'Sắp hết hạn', expired: 'Hết hạn', pending: 'Chờ duyệt', suspended: 'Tạm ngưng', completed: 'Hoàn thành', rejected: 'Từ chối', cancelled: 'Đã hủy' };
  if (statuses[normalized.toLowerCase()]) return statuses[normalized.toLowerCase()];
  if (value === true) return 'Có';
  if (value === false) return 'Không';
  return normalized;
}

function complexValueSummary(value) {
  if (Array.isArray(value)) return `${value.length} mục (xem dữ liệu gốc)`;
  const name = value?.facebook_name || value?.name;
  return name ? String(name) : `${Object.keys(value || {}).length} trường (xem dữ liệu gốc)`;
}

function friendlyReason(reason) {
  if (!reason || /mirrored from legacy logs/i.test(reason)) return 'Không có ghi chú';
  return reason;
}

export const activityLogPresentation = {
  actionLabel,
  moduleLabel,
  humanLogSummary,
  entityDisplayName,
  importantChange,
  fieldLabel,
};
