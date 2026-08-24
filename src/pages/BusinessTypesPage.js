import { EmptyState } from '../components/EmptyState.js';
import { openBusinessTypeForm } from '../components/BusinessTypeForm.js';
import { PageHeader } from '../components/PageHeader.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { CompactAction } from '../components/CompactAction.js';
import { bindPagination, Pagination, updatePagination } from '../components/Pagination.js';
import { Toast } from '../components/Toast.js';
import { Toolbar } from '../components/Toolbar.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { formatCurrency } from '../utils/currency.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const BUSINESS_TYPE_COLUMNS = [
  { label: '#', key: null },
  { label: 'Danh mục', key: 'category_name' },
  { label: 'Tên loại hình', key: 'name' },
  { label: 'Giá/tháng', key: 'price_per_month' },
  { label: 'Trạng thái', key: 'is_active' },
  { label: 'Mô tả', key: 'description' },
  { label: 'Hành động', key: null },
];

const state = {
  searchTerm: '',
  status: '',
  page: 1,
  pageSize: 10,
  sort: { column: 'category_name', ascending: true },
  total: 0,
  requestId: 0,
  items: [],
};

export function BusinessTypesPage() {
  return `
    ${PageHeader({
      title: 'Loại hình kinh doanh',
      description: 'Thiết lập mức giá theo tháng cho từng loại hình.',
      actions: '<button class="btn-primary" id="add-business-type-button" type="button">+ Thêm loại hình</button>',
    })}
    ${Toolbar({
      children: `
        <input
          type="search"
          id="business-type-search"
          class="form-control"
          placeholder="Tìm theo tên hoặc mô tả"
          aria-label="Tìm loại hình kinh doanh"
          autocomplete="off"
        />
        <select id="business-type-status-filter" class="filter-select" aria-label="Lọc trạng thái loại hình kinh doanh">
          <option value="">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="inactive">Không hoạt động</option>
        </select>
      `,
    })}
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>${BUSINESS_TYPE_COLUMNS.map(renderHeaderCell).join('')}</tr>
        </thead>
        <tbody id="business-types-table-body">
          ${renderTableState('Đang tải loại hình kinh doanh', 'Vui lòng chờ trong giây lát.')}
        </tbody>
      </table>
    </div>
    ${Pagination({ id: 'business-types', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'loại hình' })}
  `;
}

BusinessTypesPage.afterRender = function afterRenderBusinessTypes() {
  syncBusinessTypeControls();
  bindBusinessTypeEvents();
  bindPagination('business-types', {
    onPage: (page) => { state.page = page; loadBusinessTypes(); },
    onPageSize: (pageSize) => { state.pageSize = pageSize; state.page = 1; loadBusinessTypes(); },
  });
  loadBusinessTypes();
};

function syncBusinessTypeControls() {
  const searchInput = document.getElementById('business-type-search');
  const statusFilter = document.getElementById('business-type-status-filter');
  const pageSizeSelect = document.getElementById('business-types-page-size');

  document.getElementById('add-business-type-button')?.addEventListener('click', async () => {
    await openBusinessTypeForm({
      onSaved: async () => {
        state.page = 1;
        await loadBusinessTypes();
      },
    });
  });

  if (searchInput) searchInput.value = state.searchTerm;
  if (statusFilter) statusFilter.value = state.status;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
}

function bindBusinessTypeEvents() {
  const searchInput = document.getElementById('business-type-search');
  const statusFilter = document.getElementById('business-type-status-filter');
  const pageSizeSelect = document.getElementById('business-types-page-size');
  const tableBody = document.getElementById('business-types-table-body');

  searchInput?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    loadBusinessTypes();
  }, 300));

  statusFilter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadBusinessTypes();
  });


  document.querySelectorAll('[data-business-type-sort-column]').forEach((button) => {
    button.addEventListener('click', () => {
      const column = button.dataset.businessTypeSortColumn;
      if (state.sort.column === column) {
        state.sort.ascending = !state.sort.ascending;
      } else {
        state.sort = { column, ascending: true };
      }
      state.page = 1;
      loadBusinessTypes();
    });
  });

  tableBody?.addEventListener('click', async (event) => {
    const editButton = event.target.closest('[data-business-type-edit]');
    const toggleButton = event.target.closest('[data-business-type-toggle]');

    if (editButton) {
      await openBusinessTypeForm({
        businessTypeId: editButton.dataset.businessTypeEdit,
        onSaved: loadBusinessTypes,
      });
      return;
    }

    if (toggleButton) {
      const businessType = findBusinessType(toggleButton.dataset.businessTypeToggle);
      if (businessType) await toggleBusinessTypeStatus(businessType, toggleButton);
    }
  });
}

async function loadBusinessTypes() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const { data, count } = await BusinessTypeService.listWithStats({
      searchTerm: state.searchTerm,
      status: state.status,
      sort: state.sort,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count ?? data?.length ?? 0;
    state.items = data || [];
    renderBusinessTypes(state.items);
    renderPagination();
    renderSortState();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderBusinessTypes(businessTypes) {
  const body = document.getElementById('business-types-table-body');
  if (!body) return;

  if (!businessTypes.length) {
    body.innerHTML = renderTableState(
      'Không tìm thấy loại hình kinh doanh',
      'Không có bản ghi nào khớp với bộ lọc hiện tại.',
    );
    return;
  }

  const startIndex = (state.page - 1) * state.pageSize;
  body.innerHTML = businessTypes.map((businessType, index) => `
    <tr>
      <td>${startIndex + index + 1}</td>
      <td>${escapeHtml(categoryName(businessType))}</td>
      <td class="strong-cell">${escapeHtml(businessType.name || '—')}</td>
      <td>${formatCurrency(businessType.price_per_month || 0)}</td>
      <td>${renderStatusBadge(businessType.is_active)}</td>
      <td>${escapeHtml(businessType.description || '—')}</td>
      <td>
        <div class="inline-actions">
          ${CompactAction({ label: 'Sửa', icon: 'edit', tone: 'secondary', attrs: `data-business-type-edit="${escapeHtml(businessType.id)}"` })}
          ${CompactAction({ label: businessType.is_active ? 'Ngừng' : 'Kích hoạt', icon: businessType.is_active ? 'pause' : 'check-circle', tone: businessType.is_active ? 'warning' : 'positive', attrs: `data-business-type-toggle="${escapeHtml(businessType.id)}"` })}
        </div>
      </td>
    </tr>
  `).join('');
}

async function toggleBusinessTypeStatus(businessType, button) {
  const nextActive = !businessType.is_active;
  setButtonBusy(button, true, nextActive ? 'Đang kích hoạt...' : 'Đang ngưng...');

  try {
    await BusinessTypeService.setActive(businessType.id, nextActive);
    Toast.show(nextActive ? 'Đã kích hoạt loại hình kinh doanh.' : 'Đã ngưng loại hình kinh doanh.');
    await loadBusinessTypes();
  } catch (error) {
    Toast.show(error?.message || 'Không thể cập nhật trạng thái loại hình kinh doanh.');
  } finally {
    setButtonBusy(button, false, nextActive ? 'Kích hoạt' : 'Ngưng');
  }
}

function findBusinessType(id) {
  return state.items.find((item) => String(item.id) === String(id));
}

function categoryName(businessType) {
  return businessType.category_name
    || businessType.categories?.name
    || '—';
}

function renderPagination() {
  updatePagination({ id: 'business-types', page: state.page, pageSize: state.pageSize, total: state.total, pageSizeOptions: PAGE_SIZE_OPTIONS, noun: 'loại hình' });
}

function renderSortState() {
  document.querySelectorAll('[data-business-type-sort-column]').forEach((button) => {
    const active = button.dataset.businessTypeSortColumn === state.sort.column;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? (state.sort.ascending ? 'asc' : 'desc') : '';
  });
}

function renderHeaderCell(column) {
  if (!column.key) return `<th>${column.label}</th>`;
  return `
    <th>
      <button class="sort-button" type="button" data-business-type-sort-column="${column.key}">
        ${column.label}<span class="sort-icon"></span>
      </button>
    </th>
  `;
}

function setLoadingState() {
  const body = document.getElementById('business-types-table-body');
  if (body) {
    body.innerHTML = renderTableState('Đang tải loại hình kinh doanh', 'Vui lòng chờ trong giây lát.');
  }
}

function renderError(error) {
  const body = document.getElementById('business-types-table-body');
  state.total = 0;

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải loại hình kinh doanh',
      error?.message || 'Không thể tải loại hình kinh doanh. Vui lòng thử lại.',
    );
  }

  renderPagination();
}

function renderTableState(title, message) {
  return `
    <tr>
      <td colspan="${BUSINESS_TYPE_COLUMNS.length}">
        ${EmptyState({ title, message: escapeHtml(message) })}
      </td>
    </tr>
  `;
}

function renderStatusBadge(isActive) {
  return StatusBadge(isActive ? 'active' : 'inactive');
}

function setButtonBusy(button, isBusy, label) {
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = label;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.pageSize));
}
