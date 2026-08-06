import { EmptyState } from '../components/EmptyState.js';
import { openCustomerForm } from '../components/CustomerForm.js';
import { PageHeader } from '../components/PageHeader.js';
import { CustomerService } from '../services/CustomerService.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const CUSTOMER_COLUMNS = [
  { label: '#', key: null },
  { label: 'Tên Facebook', key: 'facebook_name' },
  { label: 'Facebook ID', key: 'facebook_id' },
  { label: 'SĐT', key: 'phone' },
  { label: 'Số Kiosk', key: 'total_kiosks' },
  { label: 'Trạng thái', key: 'status' },
  { label: 'Hành động', key: null },
];

const state = {
  searchTerm: '',
  status: '',
  kioskState: '',
  page: 1,
  pageSize: 10,
  sort: { column: 'created_at', ascending: false },
  total: 0,
  requestId: 0,
  items: [],
};

export function CustomersPage() {
  return `
    ${PageHeader({
      title: 'Khách hàng',
      description: 'Danh sách khách hàng đọc trực tiếp từ bảng customers.',
      actions: '<button class="btn-primary" id="add-customer-button" type="button">+ Thêm khách hàng</button>',
    })}
    <div class="toolbar">
      <input
        type="search"
        id="customer-search"
        class="form-control"
        placeholder="Tìm theo SĐT, Facebook ID, Facebook name"
        aria-label="Tìm khách hàng"
        autocomplete="off"
      />
      <select id="customer-status-filter" class="filter-select" aria-label="Lọc trạng thái">
        <option value="">Tất cả trạng thái</option>
        <option value="active">Hoạt động</option>
        <option value="pending">Chờ duyệt</option>
        <option value="inactive">Không hoạt động</option>
      </select>
      <select id="customer-kiosk-state-filter" class="filter-select" aria-label="Lọc tình trạng kiosk">
        <option value="">Tất cả tình trạng Kiosk</option>
        <option value="warning">Có Kiosk sắp hết hạn</option>
        <option value="expired">Có Kiosk hết hạn</option>
      </select>
    </div>
    <div class="table-card">
      <table class="data-table">
        <thead>
          <tr>${CUSTOMER_COLUMNS.map(renderHeaderCell).join('')}</tr>
        </thead>
        <tbody id="customers-table-body">
          ${renderTableState('Đang tải khách hàng', 'Đang đọc dữ liệu từ Supabase.')}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <div id="customers-page-summary" class="pagination-summary">—</div>
      <div class="pagination-controls">
        <select id="customers-page-size" class="filter-select compact" aria-label="Số dòng mỗi trang">
          ${PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}" ${size === state.pageSize ? 'selected' : ''}>${size} / trang</option>`).join('')}
        </select>
        <button id="customers-prev-page" class="btn-secondary" type="button">Trước</button>
        <button id="customers-next-page" class="btn-secondary" type="button">Sau</button>
      </div>
    </div>
  `;
}

CustomersPage.afterRender = function afterRenderCustomers() {
  syncCustomerControls();
  bindCustomerEvents();
  loadCustomers();
};

function syncCustomerControls() {
  const searchInput = document.getElementById('customer-search');
  const statusFilter = document.getElementById('customer-status-filter');
  const kioskStateFilter = document.getElementById('customer-kiosk-state-filter');
  const pageSizeSelect = document.getElementById('customers-page-size');

  document.getElementById('add-customer-button')?.addEventListener('click', () => {
    openCustomerForm({
      onSaved: async () => {
        state.page = 1;
        await loadCustomers();
      },
    });
  });

  if (searchInput) searchInput.value = state.searchTerm;
  if (statusFilter) statusFilter.value = state.status;
  if (kioskStateFilter) kioskStateFilter.value = state.kioskState;
  if (pageSizeSelect) pageSizeSelect.value = String(state.pageSize);
}

function bindCustomerEvents() {
  const searchInput = document.getElementById('customer-search');
  const statusFilter = document.getElementById('customer-status-filter');
  const kioskStateFilter = document.getElementById('customer-kiosk-state-filter');
  const pageSizeSelect = document.getElementById('customers-page-size');
  const tableBody = document.getElementById('customers-table-body');

  searchInput?.addEventListener('input', debounce((event) => {
    state.searchTerm = event.target.value.trim();
    state.page = 1;
    loadCustomers();
  }, 300));

  statusFilter?.addEventListener('change', (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadCustomers();
  });

  kioskStateFilter?.addEventListener('change', (event) => {
    state.kioskState = event.target.value;
    state.page = 1;
    loadCustomers();
  });

  pageSizeSelect?.addEventListener('change', (event) => {
    state.pageSize = Number(event.target.value);
    state.page = 1;
    loadCustomers();
  });

  document.getElementById('customers-prev-page')?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadCustomers();
  });

  document.getElementById('customers-next-page')?.addEventListener('click', () => {
    if (state.page >= totalPages()) return;
    state.page += 1;
    loadCustomers();
  });

  document.querySelectorAll('[data-sort-column]').forEach((button) => {
    button.addEventListener('click', () => {
      const column = button.dataset.sortColumn;
      if (state.sort.column === column) {
        state.sort.ascending = !state.sort.ascending;
      } else {
        state.sort = { column, ascending: true };
      }
      state.page = 1;
      loadCustomers();
    });
  });

  tableBody?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-customer-edit]');
    if (!button) return;

    const customer = state.items.find((item) => String(item.id) === button.dataset.customerEdit);
    if (!customer) return;

    openCustomerForm({
      customer,
      onSaved: loadCustomers,
    });
  });
}

async function loadCustomers() {
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setLoadingState();

  try {
    const { data, count } = await CustomerService.list({
      searchTerm: state.searchTerm,
      status: state.status,
      kioskState: state.kioskState,
      sort: state.sort,
      pagination: { page: state.page, pageSize: state.pageSize },
    });

    if (requestId !== state.requestId) return;

    state.total = count || 0;
    state.items = data || [];
    renderCustomers(data || []);
    renderPagination();
    renderSortState();
  } catch (error) {
    if (requestId !== state.requestId) return;
    renderError(error);
  }
}

function renderCustomers(customers) {
  const body = document.getElementById('customers-table-body');
  if (!body) return;

  if (!customers.length) {
    body.innerHTML = renderTableState(
      'Không tìm thấy khách hàng',
      'Không có bản ghi nào khớp với bộ lọc hiện tại.',
    );
    return;
  }

  const startIndex = (state.page - 1) * state.pageSize;
  body.innerHTML = customers.map((customer, index) => `
    <tr>
      <td>${startIndex + index + 1}</td>
      <td class="strong-cell">${escapeHtml(customer.facebook_name || '—')}</td>
      <td>${escapeHtml(customer.facebook_id || '—')}</td>
      <td>${escapeHtml(customer.phone || '—')}</td>
      <td>${Number(customer.total_kiosks || 0)}</td>
      <td>${renderStatusBadge(customer.status)}</td>
      <td>
        <div class="inline-actions">
          <a class="table-link" href="#/customer-detail?id=${encodeURIComponent(customer.id)}">Xem</a>
          <button class="table-action-button" type="button" data-customer-edit="${escapeHtml(customer.id)}">Sửa</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPagination() {
  const summary = document.getElementById('customers-page-summary');
  const prev = document.getElementById('customers-prev-page');
  const next = document.getElementById('customers-next-page');
  const pages = totalPages();

  if (summary) {
    summary.textContent = state.total
      ? `Trang ${state.page} / ${pages} · ${state.total} khách hàng`
      : '0 khách hàng';
  }

  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
}

function renderSortState() {
  document.querySelectorAll('[data-sort-column]').forEach((button) => {
    const active = button.dataset.sortColumn === state.sort.column;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? (state.sort.ascending ? 'asc' : 'desc') : '';
  });
}

function renderHeaderCell(column) {
  if (!column.key) return `<th>${column.label}</th>`;
  return `
    <th>
      <button class="sort-button" type="button" data-sort-column="${column.key}">
        ${column.label}<span class="sort-icon"></span>
      </button>
    </th>
  `;
}

function setLoadingState() {
  const body = document.getElementById('customers-table-body');
  if (body) {
    body.innerHTML = renderTableState('Đang tải khách hàng', 'Đang đọc dữ liệu từ Supabase.');
  }
}

function renderError(error) {
  const body = document.getElementById('customers-table-body');
  state.total = 0;
  if (body) {
    body.innerHTML = renderTableState(
      'Không thể tải khách hàng',
      error?.message || 'Supabase trả về lỗi khi đọc bảng customers.',
    );
  }
  renderPagination();
}

function renderTableState(title, message) {
  return `
    <tr>
      <td colspan="${CUSTOMER_COLUMNS.length}">
        ${EmptyState({ title, message: escapeHtml(message) })}
      </td>
    </tr>
  `;
}

function renderStatusBadge(status) {
  const normalized = String(status || 'inactive').toLowerCase();
  const safeClass = normalized.replace(/[^a-z0-9-]/g, '') || 'inactive';
  const labels = {
    active: 'Hoạt động',
    pending: 'Chờ duyệt',
    inactive: 'Không hoạt động',
  };
  return `<span class="badge badge-${safeClass}">${labels[normalized] || escapeHtml(status || 'Không rõ')}</span>`;
}

function totalPages() {
  return Math.max(1, Math.ceil(state.total / state.pageSize));
}
