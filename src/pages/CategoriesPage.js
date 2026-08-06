import { EmptyState } from '../components/EmptyState.js';
import { openCategoryForm } from '../components/CategoryForm.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { Toolbar } from '../components/Toolbar.js';
import { CategoryService } from '../services/CategoryService.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const CATEGORY_COLUMNS = [
  { label: '#', key: null },
  { label: 'Tên danh mục', key: 'name' },
  { label: 'Mô tả', key: 'description' },
  { label: 'Thứ tự', key: 'sort_order' },
  { label: 'Trạng thái', key: 'is_active' },
  { label: 'Hành động', key: null },
];

const state = {
  searchTerm: '',
  status: '',
  page: 1,
  pageSize: 10,
  sort: { column: 'sort_order', ascending: true },
  total: 0,
  requestId: 0,
  items: [],
};

export function CategoriesPage() {
  return `
    ${PageHeader({
      title: 'Danh mục',
      description: 'Danh mục dịch vụ đọc trực tiếp từ bảng categories.',
      actions: '<button class="btn-primary" id="add-category-button" type="button">+ Thêm danh mục</button>',
    })}
    ${Toolbar({
      children: `
        <input
          type="search"
          id="category-search"
          class="form-control"
          placeholder="Tìm theo tên hoặc mô tả"
          aria-label="Tìm danh mục"
          autocomplete="off"
        />
        <select id="category-status-filter" class="filter-select" aria-label="Lọc trạng thái danh mục">
          <option value="">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="inactive">Không hoạt động</option>
        </select>
      `,
    })}
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>${CATEGORY_COLUMNS.map(renderHeaderCell).join('')}</tr>
        </thead>
        <tbody id="categories-table-body">
          ${renderTableState('Đang tải danh mục', 'Đang đọc dữ liệu từ Supabase.')}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <div id="categories-page-summary" class="pagination-summary">—</div>
      <div class="pagination-controls">
        <select id="categories-page-size" class="filter-select compact" aria-label="Số dòng mỗi trang">
          ${PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}" ${size === state.pageSize ? 'selected' : ''}>${size} / trang</option>`).join('')}
        </select>
        <button id="categories-prev-page" class="btn-secondary" type="button">Trước</button>
        <button id="categories-next-page" class="btn-secondary" type="button">Sau</button>
      </div>
    </div>
  `;
}

CategoriesPage.afterRender = function afterRenderCategories() {
  syncCategoryControls();
  bindCategoryEvents();
  loadCategories();
};

function syncCategoryControls() {
  const searchInput = document.getElementById('category-search');
  const statusFilter = document.getElementById('category-status-filter');
  const pageSizeSelect = document.getElementById('categories-page-size');

  document.getElementById('add-category-button')?.addEventListener('click', () => {
    openCategoryForm({
      onSaved: async () => {
        state.page = 1;
        await loadCategories();
      },
    });
  });

  if (searchInput) searchInput.value = state.searchTerm;
  if (statusFilter) statusFilter.value = state.status;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
}

function bindCategoryEvents() {
  const searchInput = document.getElementById('category-search');
  const statusFilter = document.getElementById('category-status-filter');
  const pageSizeSelect = document.getElementById('categories-page-size');
  const tableBody = document.getElementById('categories-table-body');

  searchInput?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    loadCategories();
  }, 300));

  statusFilter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadCategories();
  });

  pageSizeSelect?.addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    loadCategories();
  });

  document.getElementById('categories-prev-page')?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadCategories();
  });

  document.getElementById('categories-next-page')?.addEventListener('click', () => {
    if (state.page >= totalPages()) return;
    state.page += 1;
    loadCategories();
  });

  document.querySelectorAll('[data-category-sort-column]').forEach((button) => {
    button.addEventListener('click', () => {
      const column = button.dataset.categorySortColumn;
      if (state.sort.column === column) {
        state.sort.ascending = !state.sort.ascending;
      } else {
        state.sort = { column, ascending: true };
      }
      state.page = 1;
      loadCategories();
    });
  });

  tableBody?.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-category-edit]');
    const deleteButton = event.target.closest('[data-category-delete]');

    if (editButton) {
      const category = findCategory(editButton.dataset.categoryEdit);
      if (!category) return;

      openCategoryForm({
        category,
        onSaved: loadCategories,
      });
      return;
    }

    if (deleteButton) {
      const category = findCategory(deleteButton.dataset.categoryDelete);
      if (category) openDeleteCategoryDialog(category);
    }
  });
}

async function loadCategories() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const { data, count } = await CategoryService.list({
      searchTerm: state.searchTerm,
      status: state.status,
      sort: state.sort,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count ?? data?.length ?? 0;
    state.items = data || [];
    renderCategories(state.items);
    renderPagination();
    renderSortState();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderCategories(categories) {
  const body = document.getElementById('categories-table-body');
  if (!body) return;

  if (!categories.length) {
    body.innerHTML = renderTableState(
      'Không tìm thấy danh mục',
      'Không có bản ghi nào khớp với bộ lọc hiện tại.',
    );
    return;
  }

  const startIndex = (state.page - 1) * state.pageSize;
  body.innerHTML = categories.map((category, index) => `
    <tr>
      <td>${startIndex + index + 1}</td>
      <td class="strong-cell">${escapeHtml(category.name || '—')}</td>
      <td>${escapeHtml(category.description || '—')}</td>
      <td>${formatSortOrder(category.sort_order)}</td>
      <td>${renderStatusBadge(category.is_active)}</td>
      <td>
        <div class="inline-actions">
          <button class="table-action-button" type="button" data-category-edit="${escapeHtml(category.id)}">Sửa</button>
          <button class="table-action-button danger-action" type="button" data-category-delete="${escapeHtml(category.id)}">Xóa</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openDeleteCategoryDialog(category) {
  Modal.open({
    title: 'Xóa danh mục',
    body: `
      <div class="delete-message">
        <p>Bạn đang xóa danh mục <strong>${escapeHtml(category.name || 'Không tên')}</strong>.</p>
        <p>Danh mục chỉ được xóa khi không có loại hình kinh doanh đang sử dụng.</p>
      </div>
      <div id="category-delete-error" class="form-error hidden"></div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-category-delete-cancel>Hủy</button>
        <button class="btn-danger" id="category-delete-confirm" type="button">Xóa</button>
      </div>
    `,
  });

  document.querySelector('[data-category-delete-cancel]')?.addEventListener('click', Modal.close);
  document.getElementById('category-delete-confirm')?.addEventListener('click', async () => {
    const deleteButton = document.getElementById('category-delete-confirm');
    clearDeleteError();
    setDeleting(deleteButton, true);

    try {
      await CategoryService.remove(category.id);
      Modal.close();
      Toast.show('Đã xóa danh mục.');
      if (state.items.length === 1 && state.page > 1) state.page -= 1;
      await loadCategories();
    } catch (error) {
      showDeleteError(error?.message || 'Không thể xóa danh mục trong Supabase.');
    } finally {
      setDeleting(deleteButton, false);
    }
  });
}

function findCategory(id) {
  return state.items.find((item) => String(item.id) === String(id));
}

function renderPagination() {
  const summary = document.getElementById('categories-page-summary');
  const prev = document.getElementById('categories-prev-page');
  const next = document.getElementById('categories-next-page');
  const pages = totalPages();

  if (summary) {
    summary.textContent = state.total
      ? `Trang ${state.page} / ${pages} · ${state.total} danh mục`
      : '0 danh mục';
  }

  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
}

function renderSortState() {
  document.querySelectorAll('[data-category-sort-column]').forEach((button) => {
    const active = button.dataset.categorySortColumn === state.sort.column;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? (state.sort.ascending ? 'asc' : 'desc') : '';
  });
}

function renderHeaderCell(column) {
  if (!column.key) return `<th>${column.label}</th>`;
  return `
    <th>
      <button class="sort-button" type="button" data-category-sort-column="${column.key}">
        ${column.label}<span class="sort-icon"></span>
      </button>
    </th>
  `;
}

function setLoadingState() {
  const body = document.getElementById('categories-table-body');
  if (body) {
    body.innerHTML = renderTableState('Đang tải danh mục', 'Đang đọc dữ liệu từ Supabase.');
  }
}

function renderError(error) {
  const body = document.getElementById('categories-table-body');
  state.total = 0;

  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải danh mục',
      error?.message || 'Supabase trả về lỗi khi đọc bảng categories.',
    );
  }

  renderPagination();
}

function renderTableState(title, message) {
  return `
    <tr>
      <td colspan="${CATEGORY_COLUMNS.length}">
        ${EmptyState({ title, message: escapeHtml(message) })}
      </td>
    </tr>
  `;
}

function renderStatusBadge(isActive) {
  return isActive
    ? '<span class="badge badge-active">Hoạt động</span>'
    : '<span class="badge badge-inactive">Không hoạt động</span>';
}

function formatSortOrder(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function showDeleteError(message) {
  const element = document.getElementById('category-delete-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearDeleteError() {
  const element = document.getElementById('category-delete-error');
  if (!element) return;
  element.textContent = '';
  element.classList.add('hidden');
}

function setDeleting(button, isDeleting) {
  if (!button) return;
  button.disabled = isDeleting;
  button.textContent = isDeleting ? 'Đang xóa...' : 'Xóa';
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.pageSize));
}
