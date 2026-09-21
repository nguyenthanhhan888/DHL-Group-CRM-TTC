import { EmptyState } from '../components/EmptyState.js';
import { openKioskEditForm } from '../components/KioskEditForm.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { CompactAction } from '../components/CompactAction.js';
import { bindPagination, Pagination, updatePagination } from '../components/Pagination.js';
import { openRenewKioskForm } from '../components/RenewKioskForm.js';
import { Toolbar } from '../components/Toolbar.js';
import { getExpiryWarningDays } from '../config/organization.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { KioskService } from '../services/KioskService.js';
import { formatCurrency } from '../utils/currency.js';
import { formatDate } from '../utils/date.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import { deriveKioskStatus } from '../utils/kioskStatus.js';

const PAGE_SIZE_OPTIONS = [12, 24, 48];
function kioskStatusOptions() {
  return [
    { value: 'active', label: 'Hoạt động' },
    { value: 'warning', label: `Sắp hết hạn (≤${getExpiryWarningDays()} ngày)` },
    { value: 'expired', label: 'Đã hết hạn' },
    { value: 'suspended', label: 'Tạm ngưng' },
  ];
}

const state = {
  searchTerm: '',
  status: 'active',
  businessTypeId: '',
  page: 1,
  pageSize: 12,
  total: 0,
  requestId: 0,
  businessTypes: [],
};

export function KiosksPage() {
  state.status = 'active';
  state.page = 1;
  return `
    ${PageHeader({
      title: 'Kiosk',
      description: 'Quản lý các tài khoản Facebook được phép đăng bài.',
      actions: '<button class="btn-primary" id="add-kiosk-button" type="button">+ Thêm Kiosk</button>',
    })}
    ${Toolbar({
      children: `
        <input
          type="search"
          id="kiosk-search"
          class="form-control"
          placeholder="Tìm theo Facebook ID, tên Facebook, loại hình KD, trạng thái"
          aria-label="Tìm Kiosk"
          autocomplete="off"
        />
        <select id="kiosk-business-type-filter" class="filter-select" aria-label="Lọc loại hình kinh doanh">
          <option value="">Tất cả loại hình KD</option>
        </select>
        <select id="kiosk-status-filter" class="filter-select" aria-label="Lọc trạng thái">
          <option value="">Tất cả trạng thái</option>
          ${kioskStatusOptions().map((status) => `<option value="${status.value}">${status.label}</option>`).join('')}
        </select>
      `,
    })}
    <div class="kiosk-grid" id="kiosk-grid">
      ${EmptyState({ title: 'Đang tải Kiosk', message: 'Vui lòng chờ trong giây lát.' })}
    </div>
    ${Pagination({ id: 'kiosks', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'Kiosk' })}
  `;
}

KiosksPage.afterRender = function afterRenderKiosks() {
  syncKioskControls();
  bindKioskEvents();
  bindPagination('kiosks', {
    onPage: (page) => { state.page = page; loadKiosks(); },
    onPageSize: (pageSize) => { state.pageSize = pageSize; state.page = 1; loadKiosks(); },
  });
  loadBusinessTypeOptions();
  loadKiosks();
};

function syncKioskControls() {
  const searchInput = document.getElementById('kiosk-search');
  const statusFilter = document.getElementById('kiosk-status-filter');
  const businessTypeFilter = document.getElementById('kiosk-business-type-filter');
  const pageSizeSelect = document.getElementById('kiosks-page-size');

  if (searchInput) searchInput.value = state.searchTerm;
  if (statusFilter) statusFilter.value = state.status;
  if (businessTypeFilter) businessTypeFilter.value = state.businessTypeId;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
}

function bindKioskEvents() {
  const searchInput = document.getElementById('kiosk-search');
  const statusFilter = document.getElementById('kiosk-status-filter');
  const businessTypeFilter = document.getElementById('kiosk-business-type-filter');
  const pageSizeSelect = document.getElementById('kiosks-page-size');
  const grid = document.getElementById('kiosk-grid');

  document.getElementById('add-kiosk-button')?.addEventListener('click', () => {
    openKioskEditForm({
      onSaved: async () => {
        state.status = 'active';
        state.page = 1;
        syncKioskControls();
        await loadKiosks();
      },
    });
  });

  searchInput?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    loadKiosks();
  }, 300));

  statusFilter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadKiosks();
  });

  businessTypeFilter?.addEventListener('change', (event) => {
    state.businessTypeId = event.target.value;
    state.page = 1;
    loadKiosks();
  });


  grid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-kiosk-renew]');
    if (!button) return;

    openRenewKioskForm({
      kioskId: button.dataset.kioskRenew,
      onSaved: loadKiosks,
    });
  });
}

async function loadBusinessTypeOptions() {
  const select = document.getElementById('kiosk-business-type-filter');
  if (!select) return;

  select.disabled = true;

  try {
    const { data } = await BusinessTypeService.listActive();
    state.businessTypes = data || [];
    renderBusinessTypeOptions();
  } catch (error) {
    state.businessTypes = [];
    select.innerHTML = `
      <option value="">Không tải được loại hình KD</option>
    `;
  } finally {
    select.disabled = false;
  }
}

async function loadKiosks() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const { data, count } = await KioskService.list({
      searchTerm: state.searchTerm,
      status: state.status,
      businessTypeId: state.businessTypeId,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count || 0;
    renderKiosks(data || []);
    renderPagination();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderBusinessTypeOptions() {
  const select = document.getElementById('kiosk-business-type-filter');
  if (!select) return;

  select.innerHTML = `
    <option value="">Tất cả loại hình KD</option>
    ${state.businessTypes.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.name || 'Không tên')}</option>
    `).join('')}
  `;
  select.value = state.businessTypeId;
}

function renderKiosks(kiosks) {
  const grid = document.getElementById('kiosk-grid');
  if (!grid) return;

  if (!kiosks.length) {
    grid.innerHTML = EmptyState({
      title: 'Không tìm thấy Kiosk',
      message: 'Không có bản ghi nào khớp với bộ lọc hiện tại.',
    });
    return;
  }

  grid.innerHTML = kiosks.map(renderKioskCard).join('');
}

function renderKioskCard(kiosk) {
  const businessType = kiosk.business_types?.name || '—';
  const category = kiosk.categories?.name || '—';

  return `
    <article class="kiosk-card">
      <div class="kiosk-card-header">
        <div>
          <div class="kiosk-name">${escapeHtml(kiosk.facebook_name || '—')}</div>
          <div class="kiosk-category">${escapeHtml(category)}</div>
        </div>
        ${renderStatusBadge(deriveKioskStatus(kiosk))}
      </div>
      <div class="kiosk-details">
        ${kioskDetail('Facebook ID', kiosk.facebook_id)}
        ${kioskDetail('Loại hình KD', businessType)}
        ${kioskDetail('Danh mục', category)}
        ${kioskDetail('Ngày bắt đầu', formatDate(kiosk.start_date))}
        ${kioskDetail('Ngày hết hạn', formatDate(kiosk.end_date))}
        ${kioskDetail('Tổng đã thanh toán', formatCurrency(kiosk.total_paid || 0))}
        ${kioskDetail('Tự duyệt', kiosk.auto_approve ? 'Có' : 'Không')}
      </div>
      <div class="kiosk-card-footer">
        <div class="inline-actions">
          ${CompactAction({ label: 'Xem', icon: 'view', href: `#/kiosk-detail?id=${encodeURIComponent(kiosk.id)}` })}
          ${CompactAction({ label: 'Gia hạn', icon: 'refresh', tone: 'positive', attrs: `data-kiosk-renew="${escapeHtml(kiosk.id)}"` })}
        </div>
        <span class="kiosk-id">ID: ${escapeHtml(kiosk.id || '—')}</span>
      </div>
    </article>
  `;
}

function kioskDetail(label, value) {
  const display = value !== null && value !== undefined && value !== '' ? value : '—';
  return `
    <div class="kiosk-detail">
      <span class="kiosk-detail-label">${label}</span>
      <span class="kiosk-detail-value">${escapeHtml(display)}</span>
    </div>
  `;
}

function setLoadingState() {
  const grid = document.getElementById('kiosk-grid');
  if (grid) {
    grid.innerHTML = EmptyState({
      title: 'Đang tải Kiosk',
      message: 'Vui lòng chờ trong giây lát.',
    });
  }
}

function renderError(error) {
  const grid = document.getElementById('kiosk-grid');
  state.total = 0;
  if (grid) {
    grid.innerHTML = EmptyState({
      title: 'Không thể tải Kiosk',
      message: escapeHtml(error?.message || 'Không thể tải danh sách Kiosk. Vui lòng thử lại.'),
    });
  }
  renderPagination();
}

function renderPagination() {
  updatePagination({ id: 'kiosks', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'Kiosk' });
}

function renderStatusBadge(status) {
  return StatusBadge(status);
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.pageSize));
}
