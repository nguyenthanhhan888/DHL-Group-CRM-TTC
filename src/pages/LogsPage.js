import { DetailFields } from '../components/DetailFields.js';
import { ReviewContextService } from '../services/ReviewContextService.js';
import { eventReviewReference } from '../utils/reviewPresentation.js';
import { EmptyState } from '../components/EmptyState.js';
import { DateRangeFields } from '../components/DateRangeFields.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { FilterBar } from '../components/FilterBar.js';
import { renderIcon } from '../utils/icons.js';
import { businessEventPresentation } from '../utils/businessEventPresentation.js';
import { LOG_COLUMNS } from '../constants/tables.js';
import { AuditLogService } from '../services/AuditLogService.js';
import { BusinessEventService } from '../services/BusinessEventService.js';
import { debounce } from '../utils/dom.js';
import { bindPagination, Pagination, updatePagination } from '../components/Pagination.js';
import { escapeHtml } from '../utils/html.js';
import { vietnamDateRangeYearToDate } from '../utils/date.js';
import {
  activityLogPresentation,
  actionLabel,
  categoryLabel,
  formatAuditLog,
} from '../utils/auditLogPresentation.js';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const ACTION_FILTERS = [
  { value: 'registration', label: 'Đăng ký' },
  { value: 'renewal', label: 'Gia hạn' },
  { value: 'legacy', label: 'Bổ sung / Legacy' },
  { value: 'update', label: 'Cập nhật' },
  { value: 'payment', label: 'Thanh toán' },
  { value: 'status', label: 'Trạng thái Kiosk' },
  { value: 'cancel', label: 'Hủy' },
  { value: 'expense', label: 'Chi phí' },
  { value: 'website', label: 'Nội dung Website' },
  { value: 'reconciliation', label: 'Cần kiểm tra' },
];
const SOURCE_FILTERS = [
  { value: 'Admin', label: 'Admin' },
  { value: 'CRM', label: 'CRM' },
  { value: 'PayOS', label: 'PayOS' },
];

const initialRange = vietnamDateRangeYearToDate();

const state = {
  searchTerm: '',
  actor: '',
  action: '',
  module: '',
  fromDate: initialRange.from,
  toDate: initialRange.to,
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
    ${FilterBar({
      label: 'Bộ lọc lịch sử',
      children: `
        <label class="filter-field filter-field-search"><span>Tìm kiếm</span>
        <input
          type="search"
          id="log-search"
          class="form-control"
          placeholder="Nội dung, người thực hiện…"
          aria-label="Tìm lịch sử"
          autocomplete="off"
        /></label>
        <label class="filter-field"><span>Hoạt động</span>
        <select id="log-action-filter" class="filter-select" aria-label="Loại hoạt động">
          <option value="">Tất cả hoạt động</option>
          ${ACTION_FILTERS.map((action) => `<option value="${action.value}">${action.label}</option>`).join('')}
        </select></label>
        ${DateRangeFields({ fromId: 'log-from-date', toId: 'log-to-date' })}
        <button class="btn-secondary filter-disclosure" id="log-advanced-toggle" type="button" aria-expanded="false" aria-controls="log-advanced-filters">Nâng cao ${renderIcon('chevron')}</button>
      `,
      advanced: `<div class="admin-filter-advanced" id="log-advanced-filters" hidden><div class="admin-filter-row">
        <label class="filter-field filter-field-search"><span>Người thực hiện</span>
        <input
          type="search"
          id="log-actor-filter"
          class="form-control"
          placeholder="Lọc người thực hiện, vai trò"
          aria-label="Lọc người thực hiện"
          autocomplete="off"
        /></label>
        <label class="filter-field"><span>Nguồn</span>
        <select id="log-module-filter" class="filter-select" aria-label="Lọc nguồn sự kiện">
          <option value="">Tất cả nguồn</option>
          ${SOURCE_FILTERS.map((item) => `<option value="${item.value}">${item.label}</option>`).join('')}
        </select></label>
        <label class="checkbox-field log-technical-toggle"><input id="log-show-technical" type="checkbox" /><span>Hiện thay đổi kỹ thuật</span></label>
        </div></div>
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
  document.getElementById('log-advanced-toggle')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    document.getElementById('log-advanced-filters').hidden = !expanded;
  });
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

    const log = state.items.find((item) => String(item.event_key || item.id) === String(button.dataset.logView));
    if (log) openLogDetail(log);
  });
}

async function loadLogs() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const { data, count, page: responsePage } = state.showTechnical
      ? await AuditLogService.list({
        searchTerm: state.searchTerm, actor: state.actor, action: '', module: '',
        fromTime: dateBoundary(state.fromDate), toTime: dateBoundary(state.toDate, true),
        showTechnical: true, pagination: { page: state.page, pageSize: state.pageSize },
      })
      : await BusinessEventService.list({
        context: 'logs', searchTerm: state.searchTerm, actor: state.actor,
        activity: state.action, source: state.module,
        fromTime: dateBoundary(state.fromDate), toTime: dateBoundary(state.toDate, true),
        page: state.page, pageSize: state.pageSize,
      });

    if (requestId !== state.requestId) return;

    const items = state.showTechnical ? data || [] : await presentBusinessEvents(data || []);
    if (requestId !== state.requestId) return;
    state.total = count || 0;
    state.items = items;
    state.page = responsePage || 1;
    const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page > lastPage) {
      state.page = lastPage;
      loadLogs();
      return;
    }
    renderLogs(items);
    renderPagination();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

async function presentBusinessEvents(events) {
  const items = events.map((event) => ({ ...event, presentation: businessEventPresentation(event) }));
  // Reuse the existing authorized detail read; limit concurrent historical lookups.
  const pending = items.filter((event) => /^audit:\d+$/.test(event.event_key) && event.event_type !== 'payment');
  for (let offset = 0; offset < pending.length; offset += 4) {
    await Promise.all(pending.slice(offset, offset + 4).map(async (event) => {
      try {
        const { data } = await AuditLogService.getById(event.event_key.slice(6));
        event.presentation = businessEventPresentation(event, data);
      } catch {
        // Missing or inaccessible historical metadata must not hide the journal entry.
      }
    }));
  }
  const reviews = items.filter(event => event.event_type === 'reconciliation');
  if (reviews.length) {
    const contexts = await ReviewContextService.resolve(reviews.map(eventReviewReference));
    reviews.forEach((event, index) => { event.presentation = businessEventPresentation(event, contexts[index]); });
  }
  return items;
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
  if (log.event_key) return renderBusinessEventRow(log);
  const item = formatAuditLog(log);
  return `
    <tr>
      <td>${renderBusinessActivity(log, item)}</td>
      <td><div class="log-actor"><strong>${escapeHtml(item.actorName)}</strong><span>${escapeHtml(item.source)}</span></div></td>
      <td>${renderDateTime(log.created_at)}</td>
      <td class="log-detail-cell"><button class="table-action-button" type="button" data-log-view="${escapeHtml(log.id)}">Xem chi tiết</button></td>
    </tr>`;
}

function renderBusinessEventRow(event) {
  const item = event.presentation || businessEventPresentation(event);
  return `<tr><td>${renderEventSummary(event, item)}</td><td><div class="log-actor"><strong>${escapeHtml(item.actorName)}</strong><span>${escapeHtml(item.source)}</span></div></td><td>${renderDateTime(event.occurred_at)}</td><td class="log-detail-cell"><button class="table-action-button" type="button" data-log-view="${escapeHtml(event.event_key)}">Xem chi tiết</button></td></tr>`;
}

function renderEventBadge(event, item) {
  const tone = event.event_type === 'cancel' || event.event_type === 'reconciliation' ? 'danger' : 'info';
  return `<span class="status-badge status-badge--${tone}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(item.activityLabel)}</span>`;
}

function renderEventSummary(event, item) {
  return `<div class="log-business-activity">${renderEventBadge(event, item)}<strong>${escapeHtml(item.title)}</strong>${item.secondary ? `<span>${escapeHtml(item.secondary)}</span>` : ''}</div>`;
}

function renderLogCard(log) {
  if (log.event_key) {
    const item = log.presentation || businessEventPresentation(log);
    return `<article class="log-mobile-card"><div class="log-mobile-card-head">${renderEventBadge(log, item)}${renderCompactDateTime(log.occurred_at)}</div><strong class="log-mobile-target">${escapeHtml(item.title)}</strong>${item.secondary ? `<span class="log-mobile-change">${escapeHtml(item.secondary)}</span>` : ''}<div class="log-mobile-footer"><span>${escapeHtml(item.actorName)}</span><button class="table-action-button" type="button" data-log-view="${escapeHtml(log.event_key)}">Xem chi tiết</button></div></article>`;
  }
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
  if (log.event_key) {
    const item = log.presentation || businessEventPresentation(log);
    Modal.open({
      title: 'Chi tiết hoạt động', className: 'log-detail-modal',
      body: `<section class="log-detail-summary">${renderEventBadge(log, item)}<h3>${escapeHtml(item.title)}</h3>${item.secondary ? `<p>${escapeHtml(item.secondary)}</p>` : ''}</section>
        <dl class="log-event-meta">
          ${eventMetaRow('Người thực hiện', item.actorName)}
          ${eventMetaRow('Nguồn', item.source)}
          ${eventMetaRow('Thời gian', formatDateTime(log.occurred_at))}
          ${eventMetaRow('Kết quả', item.result)}
        </dl>${item.reviewFields ? DetailFields(item.reviewFields, 'review-event-fields') : ''}`,
    });
    return;
  }
  Modal.open({
    title: 'Chi tiết lịch sử',
    body: renderLogModal(log),
    className: 'modal-wide log-detail-modal log-detail-modal--technical',
  });
}

function eventMetaRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
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
  const parts = dateTimeParts(value);
  return parts.time ? `${parts.date} · ${parts.time}` : parts.date;
}

function dateTimeParts(value) {
  if (!value) return { date: '—', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
  return {
    date: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(date),
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
  const date = new Date(Date.UTC(year, month - 1, day, -7));
  if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export { activityLogPresentation };
