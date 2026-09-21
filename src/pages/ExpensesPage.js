import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { DateRangeFields } from '../components/DateRangeFields.js';
import { FilterBar } from '../components/FilterBar.js';
import { StatCard } from '../components/StatCard.js';
import { Toast } from '../components/Toast.js';
import { ExpenseService, EXPENSE_CATEGORIES } from '../services/ExpenseService.js';
import { bindCurrencyInput, formatCurrency, parseCurrencyInput } from '../utils/currency.js';
import { formatDate, startOfVietnamToday, toDateOnly, vietnamDateRangeYearToDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';

const initialRange = vietnamDateRangeYearToDate();
const state = {
  rows: [],
  employees: [],
  categories: EXPENSE_CATEGORIES.map((item, index) => ({ id: index + 1, code: item.value, name: item.label, isActive: true, isSalary: item.value === 'salary' })),
  filters: { startDate: initialRange.from, endDate: initialRange.to, category: '', employeeUserId: '' },
  totalAmount: 0,
  totalRevenue: 0,
  netProfit: 0,
  requestId: 0,
};

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Chuyển khoản ngân hàng' },
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'other', label: 'Khác' },
];

export function ExpensesPage() {
  return `
    <div class="expenses-page">
      ${PageHeader({
        title: 'Chi phí',
        description: 'Theo dõi các khoản chi vận hành; dữ liệu được tách riêng khỏi doanh thu Kiosk.',
        actions: `<div class="page-header-actions"><button class="btn-secondary" id="expense-category-button" type="button">Quản lý danh mục</button><button class="btn-primary" id="expense-add-button" type="button">${renderIcon('plus')}<span>Thêm chi phí</span></button></div>`,
      })}
      ${FilterBar({ label: 'Bộ lọc chi phí', className: 'expense-filter-panel', children: `
        ${DateRangeFields({ fromId: 'expense-start-date', toId: 'expense-end-date' })}
        <label class="filter-field"><span>Danh mục</span><select class="filter-select" id="expense-category-filter">${categoryOptions('', 'Tất cả danh mục')}</select></label>
        <label class="filter-field"><span>Nhân viên</span><select class="filter-select" id="expense-employee-filter"><option value="">Tất cả nhân viên</option></select></label>
        <button class="btn-secondary expense-filter-reset" id="expense-filter-reset" type="button">Đặt lại</button>
      ` })}
      <div id="expense-summary">${summaryCards(0, 0, 0)}</div>
      <section class="table-card expense-table-card">
        <div class="report-table-wrap">
          <table class="data-table expense-table">
            <thead><tr><th>Ngày chi</th><th>Danh mục</th><th>Nhân viên / kỳ lương</th><th>Phương thức</th><th>Số tiền</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
            <tbody id="expense-table-body"><tr><td colspan="7">Đang tải chi phí...</td></tr></tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

ExpensesPage.afterRender = function afterRenderExpenses() {
  document.getElementById('expense-add-button')?.addEventListener('click', () => openExpenseForm());
  document.getElementById('expense-category-button')?.addEventListener('click', openCategoryManager);
  document.getElementById('expense-filter-reset')?.addEventListener('click', resetFilters);
  for (const [id, key] of [
    ['expense-start-date', 'startDate'], ['expense-end-date', 'endDate'],
    ['expense-category-filter', 'category'], ['expense-employee-filter', 'employeeUserId'],
  ]) {
    document.getElementById(id)?.addEventListener('change', (event) => {
      state.filters[key] = event.currentTarget.value || '';
      loadExpenses();
    });
  }
  document.getElementById('expense-table-body')?.addEventListener('click', handleRowAction);
  syncFilterControls();
  loadExpenses();
};

async function loadExpenses() {
  const requestId = ++state.requestId;
  const body = document.getElementById('expense-table-body');
  if (body) body.innerHTML = '<tr><td colspan="7">Đang tải chi phí...</td></tr>';
  try {
    const { data } = await ExpenseService.list(state.filters);
    if (requestId !== state.requestId) return;
    state.rows = Array.isArray(data?.rows) ? data.rows : [];
    state.employees = Array.isArray(data?.employees) ? data.employees : [];
    state.categories = Array.isArray(data?.categories) && data.categories.length ? data.categories : state.categories;
    state.totalAmount = Number(data?.totalAmount || 0);
    state.totalRevenue = Number(data?.totalRevenue || 0);
    state.netProfit = Number(data?.netProfit || 0);
    renderCategoryFilter();
    renderEmployeeFilter();
    renderExpenses();
  } catch (error) {
    if (requestId !== state.requestId || !body) return;
    body.innerHTML = `<tr><td colspan="7">${EmptyState({ title: 'Không thể tải chi phí', message: error?.message || 'Vui lòng thử lại.' })}</td></tr>`;
    Toast.show(error?.message || 'Không thể tải chi phí.', 'error');
  }
}

function renderExpenses() {
  const body = document.getElementById('expense-table-body');
  const summary = document.getElementById('expense-summary');
  if (summary) summary.innerHTML = summaryCards(state.totalAmount, state.totalRevenue, state.netProfit);
  if (!body) return;
  if (!state.rows.length) {
    body.innerHTML = `<tr><td colspan="7">${EmptyState({ title: 'Chưa có chi phí', message: 'Không có khoản chi phù hợp với bộ lọc hiện tại.' })}</td></tr>`;
    return;
  }
  body.innerHTML = state.rows.map((item) => `
    <tr>
      <td data-label="Ngày chi">${escapeHtml(formatDate(item.expense_date))}</td>
      <td data-label="Danh mục"><strong>${escapeHtml(item.category_name || categoryLabel(item.category))}</strong></td>
      <td data-label="Nhân viên / kỳ lương"><div>${employeePeriod(item)}</div></td>
      <td data-label="Phương thức">${escapeHtml(paymentMethodLabel(item.payment_method))}</td>
      <td data-label="Số tiền"><strong class="expense-amount">${escapeHtml(formatCurrency(item.amount))}</strong></td>
      <td data-label="Ghi chú">${escapeHtml(item.note || '—')}</td>
      <td data-label="Thao tác"><div class="expense-row-actions"><button class="table-action-button" type="button" data-expense-action="edit" data-expense-id="${item.id}">Sửa</button><button class="table-action-button is-danger" type="button" data-expense-action="archive" data-expense-id="${item.id}">Hủy</button></div></td>
    </tr>`).join('');
}

function summaryCards(expense, revenue, netProfit) {
  return `<div class="stats-grid expense-summary">
    ${StatCard({ tone: 'red', icon: renderIcon('receipt'), value: formatCurrency(expense), label: 'Tổng chi phí', className: 'stat-card-fluid' })}
    ${StatCard({ tone: 'green', icon: renderIcon('money'), value: formatCurrency(revenue), label: 'Tổng doanh thu', className: 'stat-card-fluid' })}
    ${StatCard({ tone: netProfit >= 0 ? 'blue' : 'red', icon: renderIcon('report'), value: formatCurrency(netProfit), label: 'Lợi nhuận ròng', className: 'stat-card-fluid' })}
  </div>`;
}

function handleRowAction(event) {
  const button = event.target.closest('[data-expense-action]');
  if (!button) return;
  const item = state.rows.find((row) => String(row.id) === button.dataset.expenseId);
  if (!item) return;
  if (button.dataset.expenseAction === 'edit') openExpenseForm(item);
  else openArchiveConfirmation(item);
}

function openExpenseForm(item = null) {
  const selectedCategory = item?.category || 'other';
  Modal.open({
    title: item ? 'Sửa chi phí' : 'Thêm chi phí',
    className: 'expense-form-modal',
    body: `
      <form id="expense-form" class="modal-form expense-form">
        <div class="expense-form-grid">
          <label class="form-group"><span>Danh mục</span><select class="form-control" name="category" required>${categoryOptions(selectedCategory)}</select></label>
          <label class="form-group"><span>Số tiền</span><input class="form-control" name="amount" inputmode="numeric" required value="${escapeHtml(item?.amount || '')}"></label>
          <label class="form-group"><span>Ngày chi</span><input class="form-control" name="expenseDate" type="date" required value="${escapeHtml(item?.expense_date || toDateOnly(startOfVietnamToday()))}"></label>
          <label class="form-group"><span>Phương thức</span><select class="form-control" name="paymentMethod" required>${paymentMethodOptions(item?.payment_method || 'bank_transfer')}</select></label>
          <label class="form-group expense-employee-field"><span>Nhân viên</span><select class="form-control" name="employeeUserId">${employeeOptions(item?.employee_user_id)}</select></label>
          <label class="form-group expense-salary-period-field"><span>Kỳ lương</span><input class="form-control" name="salaryPeriod" type="month" value="${escapeHtml(String(item?.salary_period || '').slice(0, 7))}"></label>
          <label class="form-group expense-form-note"><span>Ghi chú</span><textarea class="form-control" name="note" rows="3" maxlength="1000">${escapeHtml(item?.note || '')}</textarea></label>
        </div>
        <div id="expense-duplicate-warning" class="notice warning hidden" role="status">Đã có khoản lương cho nhân viên và kỳ này. Bạn vẫn có thể lưu nếu đây là khoản bổ sung.</div>
        <div id="expense-form-error" class="form-error hidden" role="alert"></div>
        <div class="modal-actions"><button class="btn-secondary" type="button" data-expense-cancel>Hủy</button><button class="btn-primary" type="submit">${item ? 'Lưu thay đổi' : 'Thêm chi phí'}</button></div>
      </form>`,
  });
  const form = document.getElementById('expense-form');
  bindCurrencyInput(form?.elements.amount);
  const updateSalaryFields = () => {
    const salary = categoryIsSalary(form.elements.category.value);
    form.querySelector('.expense-salary-period-field')?.classList.toggle('hidden', !salary);
    form.elements.employeeUserId.required = salary;
    form.elements.salaryPeriod.required = salary;
    if (!salary) form.elements.salaryPeriod.value = '';
    checkDuplicateSalary(form, item?.id);
  };
  form?.elements.category.addEventListener('change', updateSalaryFields);
  form?.elements.employeeUserId.addEventListener('change', () => checkDuplicateSalary(form, item?.id));
  form?.elements.salaryPeriod.addEventListener('change', () => checkDuplicateSalary(form, item?.id));
  form?.querySelector('[data-expense-cancel]')?.addEventListener('click', Modal.close);
  form?.addEventListener('submit', (event) => saveExpense(event, item?.id));
  updateSalaryFields();
}

async function checkDuplicateSalary(form, excludeId) {
  const warning = document.getElementById('expense-duplicate-warning');
  if (!warning) return;
  if (!categoryIsSalary(form.elements.category.value) || !form.elements.employeeUserId.value || !form.elements.salaryPeriod.value) {
    warning.classList.add('hidden');
    return;
  }
  try {
    const { data } = await ExpenseService.checkSalaryDuplicate(form.elements.employeeUserId.value, form.elements.salaryPeriod.value, excludeId);
    warning.classList.toggle('hidden', data !== true);
  } catch {
    warning.classList.add('hidden');
  }
}

async function saveExpense(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const errorBox = document.getElementById('expense-form-error');
  const amount = parseCurrencyInput(form.elements.amount.value);
  if (amount <= 0) {
    errorBox.textContent = 'Số tiền phải lớn hơn 0.';
    errorBox.classList.remove('hidden');
    form.elements.amount.focus();
    return;
  }
  setButtonBusy(button, true, { busyLabel: 'Đang lưu...' });
  try {
    const values = Object.fromEntries(new FormData(form));
    values.amount = amount;
    const { data } = await ExpenseService.save(values, id);
    Modal.close();
    Toast.show(data?.duplicateSalary ? 'Đã lưu khoản bổ sung; kỳ lương này đã có khoản chi trước đó.' : 'Đã lưu chi phí.');
    await loadExpenses();
  } catch (error) {
    errorBox.textContent = error?.message || 'Không thể lưu chi phí.';
    errorBox.classList.remove('hidden');
    Toast.show(errorBox.textContent, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

function openArchiveConfirmation(item) {
  Modal.open({
    title: 'Hủy khoản chi?',
    className: 'expense-archive-modal',
    body: `<div class="expense-archive-confirmation"><span aria-hidden="true">${renderIcon('warning')}</span><div><p>Khoản <strong>${escapeHtml(categoryLabel(item.category))}</strong> trị giá <strong>${escapeHtml(formatCurrency(item.amount))}</strong> sẽ không còn được tính vào báo cáo.</p><p class="muted-text">Lịch sử thao tác vẫn được giữ lại để đối soát.</p></div></div><label class="form-group"><span>Lý do</span><input id="expense-archive-reason" class="form-control" maxlength="500" placeholder="VD: Nhập nhầm khoản chi"></label><div class="modal-actions"><button class="btn-secondary" type="button" data-expense-archive-cancel>Đóng</button><button class="btn-danger" type="button" data-expense-archive-confirm>${renderIcon('trash')}<span>Hủy khoản chi</span></button></div>`,
  });
  document.querySelector('[data-expense-archive-cancel]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-expense-archive-confirm]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, { busyLabel: 'Đang hủy...' });
    try {
      await ExpenseService.archive(item.id, document.getElementById('expense-archive-reason')?.value || '');
      Modal.close();
      Toast.show('Đã hủy khoản chi.');
      await loadExpenses();
    } catch (error) {
      Toast.show(error?.message || 'Không thể hủy khoản chi.', 'error');
      setButtonBusy(button, false);
    }
  });
}

function resetFilters() {
  const range = vietnamDateRangeYearToDate();
  state.filters = { startDate: range.from, endDate: range.to, category: '', employeeUserId: '' };
  syncFilterControls();
  loadExpenses();
}

function syncFilterControls() {
  for (const [id, key] of [['expense-start-date','startDate'],['expense-end-date','endDate'],['expense-category-filter','category'],['expense-employee-filter','employeeUserId']]) {
    const control = document.getElementById(id);
    if (control) control.value = state.filters[key];
  }
}

function renderEmployeeFilter() {
  const select = document.getElementById('expense-employee-filter');
  if (!select) return;
  select.innerHTML = `<option value="">Tất cả nhân viên</option>${employeeOptions(state.filters.employeeUserId, false)}`;
  select.value = state.filters.employeeUserId;
}

function renderCategoryFilter() {
  const select = document.getElementById('expense-category-filter');
  if (!select) return;
  select.innerHTML = categoryOptions(state.filters.category, 'Tất cả danh mục', true);
  select.value = state.filters.category;
}

function categoryOptions(selected, firstLabel = '', includeArchived = false) {
  const categories = state.categories.filter((item) => includeArchived || item.isActive !== false || item.code === selected);
  return `${firstLabel ? `<option value="">${firstLabel}</option>` : ''}${categories.map((item) => `<option value="${escapeHtml(item.code)}" ${item.code === selected ? 'selected' : ''}>${escapeHtml(item.name)}${item.isActive === false ? ' (đã lưu trữ)' : ''}</option>`).join('')}`;
}

function employeeOptions(selected, includeEmpty = true) {
  return `${includeEmpty ? '<option value="">Không áp dụng</option>' : ''}${state.employees.map((employee) => `<option value="${escapeHtml(employee.user_id)}" ${String(employee.user_id) === String(selected || '') ? 'selected' : ''}>${escapeHtml(employee.display_name || employee.username || 'Chưa có tên')}</option>`).join('')}`;
}

function paymentMethodOptions(selected) {
  return PAYMENT_METHODS.map((item) => `<option value="${item.value}" ${item.value === selected ? 'selected' : ''}>${item.label}</option>`).join('');
}

function categoryLabel(value) {
  return state.categories.find((item) => item.code === value)?.name || 'Chi khác';
}

function categoryIsSalary(value) {
  return state.categories.find((item) => item.code === value)?.isSalary === true;
}

function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find((item) => item.value === value)?.label || value || '—';
}

function employeePeriod(item) {
  const employee = escapeHtml(item.employee_name || '—');
  if (!item.category_is_salary && !categoryIsSalary(item.category) || !item.salary_period) return employee;
  const [year, month] = String(item.salary_period).slice(0, 7).split('-');
  return `<span>${employee}</span><small class="expense-salary-period">Lương tháng ${escapeHtml(month)}/${escapeHtml(year)}</small>`;
}

function openCategoryManager() {
  Modal.open({
    title: 'Quản lý danh mục chi phí',
    className: 'expense-category-modal',
    body: `<form id="expense-category-create" class="expense-category-create"><label class="form-group"><span>Tên danh mục mới</span><input class="form-control" name="name" maxlength="120" required></label><button class="btn-primary" type="submit">${renderIcon('plus')}<span>Thêm</span></button></form><div class="expense-category-list">${state.categories.map((item) => `<div class="expense-category-row" data-category-id="${item.id}"><input class="form-control" value="${escapeHtml(item.name)}" maxlength="120" ${item.isActive === false ? 'disabled' : ''}><span>${item.isSalary ? 'Danh mục lương' : item.isActive === false ? 'Đã lưu trữ' : 'Đang dùng'}</span>${item.isActive === false ? '' : `<button class="table-action-button" type="button" data-category-save="${item.id}">Đổi tên</button><button class="table-action-button is-danger" type="button" data-category-archive="${item.id}">Lưu trữ</button>`}</div>`).join('')}</div>`,
  });
  const createForm = document.getElementById('expense-category-create');
  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = createForm.querySelector('button'); setButtonBusy(button, true, { busyLabel: 'Đang thêm...' });
    try { await ExpenseService.saveCategory(createForm.elements.name.value); Modal.close(); await loadExpenses(); Toast.show('Đã thêm danh mục chi phí.'); }
    catch (error) { Toast.show(error?.message || 'Không thể thêm danh mục.', 'error'); setButtonBusy(button, false); }
  });
  document.querySelector('.expense-category-list')?.addEventListener('click', async (event) => {
    const save = event.target.closest('[data-category-save]'); const archive = event.target.closest('[data-category-archive]');
    if (!save && !archive) return;
    const id = Number((save || archive).dataset.categorySave || (save || archive).dataset.categoryArchive);
    const row = event.target.closest('[data-category-id]');
    try {
      if (save) await ExpenseService.saveCategory(row.querySelector('input').value, id);
      else await ExpenseService.archiveCategory(id);
      Modal.close(); await loadExpenses(); Toast.show(save ? 'Đã đổi tên danh mục.' : 'Đã lưu trữ danh mục.');
    } catch (error) { Toast.show(error?.message || 'Không thể cập nhật danh mục.', 'error'); }
  });
}
