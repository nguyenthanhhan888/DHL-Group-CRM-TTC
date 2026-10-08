import { createDateValue } from '../utils/date.js';
import { EmployeeService } from '../services/EmployeeService.js';
import { PageHeader } from '../components/PageHeader.js';
import { FilterBar } from '../components/FilterBar.js';
import { Modal } from '../components/Modal.js';
import { DetailFields } from '../components/DetailFields.js';
import { EmptyState } from '../components/EmptyState.js';
import { ExpenseNavigation } from '../components/ExpenseNavigation.js';
import { Toast } from '../components/Toast.js';
import { escapeHtml } from '../utils/html.js';
import { formatDate } from '../utils/date.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';
import { employeeStatus } from '../utils/employeePresentation.js';

const state = { rows: [], search: '', status: '', includeArchived: false, requestId: 0 };
export function EmployeesPage() {
  return `<div class="employees-page">
    ${PageHeader({ title: 'Nhân viên', description: 'Quản lý người làm việc và liên kết khoản chi. Không cần tài khoản website.', actions: `<button type="button" class="btn-primary" id="employee-add">${renderIcon('plus')}<span>Thêm nhân viên</span></button>` })}
    ${ExpenseNavigation('employees')}
    ${FilterBar({ label: 'Bộ lọc nhân viên', children: `
      <label class="filter-field filter-field-search"><span>Tìm nhân viên</span><input class="form-control" id="employee-search" type="search" placeholder="Họ tên, số điện thoại, công việc" value="${escapeHtml(state.search)}"></label>
      <label class="filter-field"><span>Trạng thái làm việc</span><select class="filter-select" id="employee-status-filter"><option value="">Tất cả trạng thái</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>Đang làm</option><option value="left" ${state.status === 'left' ? 'selected' : ''}>Đã nghỉ</option></select></label>
      <label class="employee-archive-filter"><input type="checkbox" id="employee-include-archived" ${state.includeArchived ? 'checked' : ''}> Hiện cả đã lưu trữ</label>` })}
    <p class="employee-result-count" id="employee-result-count" role="status"></p>
    <section class="table-card employee-table-card"><table class="data-table employee-table"><thead><tr><th>Họ tên</th><th>Số điện thoại</th><th>Vai trò / Công việc</th><th>Ngày bắt đầu</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody id="employee-table-body"></tbody></table></section>
  </div>`;
}
EmployeesPage.afterRender = () => {
  document.getElementById('employee-add')?.addEventListener('click', () => openEmployeeForm());
  let timer;
  document.getElementById('employee-search')?.addEventListener('input', event => {
    state.search = event.target.value; clearTimeout(timer); timer = setTimeout(loadEmployees, 180);
  });
  document.getElementById('employee-status-filter')?.addEventListener('change', event => { state.status = event.target.value; loadEmployees(); });
  document.getElementById('employee-include-archived')?.addEventListener('change', event => { state.includeArchived = event.target.checked; loadEmployees(); });
  document.getElementById('employee-table-body')?.addEventListener('click', event => {
    const button = event.target.closest('[data-employee-action]');
    if (!button) return;
    const item = state.rows.find(row => String(row.id) === button.dataset.employeeId);
    if (!item) return;
    if (button.dataset.employeeAction === 'detail') openDetail(item);
    else if (button.dataset.employeeAction === 'edit') openEmployeeForm(item);
    else confirmLifecycle(item, button.dataset.employeeAction);
  });
  loadEmployees();
};
async function loadEmployees() {
  const body = document.getElementById('employee-table-body');
  if (!body) return;
  const requestId = ++state.requestId;
  body.innerHTML = '<tr><td colspan="6">Đang tải nhân viên...</td></tr>';
  try {
    const { data } = await EmployeeService.list(state);
    if (requestId !== state.requestId || !body.isConnected) return;
    state.rows = data?.rows || [];
    document.getElementById('employee-result-count').textContent = `${state.rows.length} nhân viên`;
    body.innerHTML = state.rows.length ? state.rows.map(row => `<tr>
      <td data-label="Họ tên"><strong>${escapeHtml(row.full_name)}</strong></td>
      <td data-label="Số điện thoại">${escapeHtml(row.phone || '—')}</td>
      <td data-label="Vai trò / Công việc">${escapeHtml(row.job_title || '—')}</td>
      <td data-label="Ngày bắt đầu">${escapeHtml(row.start_date ? formatDate(row.start_date) : '—')}</td>
      <td data-label="Trạng thái">${statusBadge(row)}</td>
      <td data-label="Thao tác"><div class="employee-actions">${action(row, 'detail', 'Chi tiết')}${row.archived_at ? action(row, 'restore', 'Khôi phục') : action(row, 'edit', 'Sửa') + action(row, 'archive', 'Lưu trữ')}</div></td>
    </tr>`).join('') : `<tr><td colspan="6">${EmptyState({ title: 'Chưa có nhân viên phù hợp', message: 'Thêm nhân viên hoặc thay đổi bộ lọc.' })}</td></tr>`;
  } catch (error) {
    if (requestId !== state.requestId || !body.isConnected) return;
    body.innerHTML = `<tr><td colspan="6">${EmptyState({ title: 'Không tải được nhân viên', message: error.message })}</td></tr>`;
  }
}
function action(item, name, label) {
  return `<button type="button" class="table-action-button" data-employee-id="${item.id}" data-employee-action="${name}">${label}</button>`;
}
function statusBadge(item) {
  return `<span class="status-badge status-badge--${item.archived_at || item.employment_status === 'left' ? 'neutral' : 'success'}">${employeeStatus(item)}</span>`;
}
function openDetail(item) {
  Modal.open({ title: 'Chi tiết nhân viên', className: 'employee-detail-modal', body: `
    <div class="detail-summary"><h3>${escapeHtml(item.full_name)}</h3><p>${statusBadge(item)}</p></div>
    ${DetailFields([['Số điện thoại', item.phone || '—'], ['Vai trò / Công việc', item.job_title || '—'], ['Ngày bắt đầu', item.start_date ? formatDate(item.start_date) : '—'], ['Trạng thái làm việc', item.employment_status === 'left' ? 'Đã nghỉ' : 'Đang làm'], ['Ghi chú', item.notes || '—']])}
    <p class="employee-history-note">Nghỉ việc hoặc lưu trữ không làm mất nhân viên và tên đã ghi trên các khoản chi trước đây.</p>
    <div class="modal-actions">${item.archived_at ? action(item, 'restore', 'Khôi phục') : action(item, item.employment_status === 'left' ? 'reactivate' : 'left', item.employment_status === 'left' ? 'Làm việc trở lại' : 'Đánh dấu đã nghỉ') + action(item, 'edit', 'Chỉnh sửa')}</div>` });
  document.querySelectorAll('[data-modal-body] [data-employee-action]').forEach(button => button.addEventListener('click', () => button.dataset.employeeAction === 'edit' ? openEmployeeForm(item) : confirmLifecycle(item, button.dataset.employeeAction)));
}
function openEmployeeForm(item = null) {
  Modal.open({ title: item ? 'Sửa nhân viên' : 'Thêm nhân viên', className: 'employee-form-modal', body: `
    <form id="employee-form" class="modal-form"><div class="employee-form-grid">
      <label class="form-group employee-form-wide"><span>Họ tên *</span><input class="form-control" name="fullName" required maxlength="160" autocomplete="name" value="${escapeHtml(item?.full_name || '')}"></label>
      <label class="form-group"><span>Số điện thoại</span><input class="form-control" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${escapeHtml(item?.phone || '')}"></label>
      <label class="form-group"><span>Vai trò / Công việc</span><input class="form-control" name="jobTitle" maxlength="120" value="${escapeHtml(item?.job_title || '')}"></label>
      <label class="form-group"><span>Ngày bắt đầu</span><input class="form-control" name="startDate" type="date" value="${escapeHtml(createDateValue(item, item?.start_date))}"></label>
      <label class="form-group"><span>Trạng thái làm việc</span><select class="form-control" name="employmentStatus"><option value="active">Đang làm</option><option value="left" ${item?.employment_status === 'left' ? 'selected' : ''}>Đã nghỉ</option></select></label>
      <label class="form-group employee-form-wide"><span>Ghi chú</span><textarea class="form-control" name="notes" rows="3" maxlength="2000">${escapeHtml(item?.notes || '')}</textarea></label>
    </div><div class="form-error hidden" id="employee-form-error" role="alert"></div>
    <div class="modal-actions"><button class="btn-secondary" type="button" data-employee-cancel>Hủy</button><button class="btn-primary" type="submit">${item ? 'Lưu thay đổi' : 'Thêm nhân viên'}</button></div></form>` });
  document.querySelector('[data-employee-cancel]').addEventListener('click', Modal.close);
  document.getElementById('employee-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); const errorBox = form.querySelector('[role="alert"]');
    setButtonBusy(button, true, { busyLabel: 'Đang lưu...' });
    try {
      await EmployeeService.save(Object.fromEntries(new FormData(form)), item?.id || null);
      Modal.close(); Toast.show('Đã lưu nhân viên.'); await loadEmployees();
    } catch (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
    finally { setButtonBusy(button, false); }
  });
}
function confirmLifecycle(item, mode) {
  const labels = { archive: 'Lưu trữ nhân viên', restore: 'Khôi phục nhân viên', left: 'Đánh dấu đã nghỉ', reactivate: 'Làm việc trở lại' };
  Modal.open({ title: labels[mode], className: 'employee-detail-modal', body: `<p><strong>${escapeHtml(item.full_name)}</strong></p><p class="employee-history-note">${mode === 'archive' || mode === 'left' ? 'Nhân viên sẽ không còn trong lựa chọn cho khoản chi mới. Các khoản chi cũ vẫn giữ nguyên liên kết và tên lịch sử.' : 'Trạng thái được cập nhật; lịch sử khoản chi vẫn được giữ nguyên.'}</p><div class="form-error hidden" id="employee-lifecycle-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn-secondary" data-employee-cancel>Đóng</button><button type="button" class="btn-primary" data-employee-confirm>${labels[mode]}</button></div>` });
  document.querySelector('[data-employee-cancel]').addEventListener('click', Modal.close);
  document.querySelector('[data-employee-confirm]').addEventListener('click', async event => {
    const button = event.currentTarget; setButtonBusy(button, true, { busyLabel: 'Đang lưu...' });
    try { await EmployeeService.lifecycle(item.id, mode); Modal.close(); Toast.show('Đã cập nhật nhân viên.'); await loadEmployees(); }
    catch (error) { const box = document.getElementById('employee-lifecycle-error'); if (box) { box.textContent = error.message; box.classList.remove('hidden'); } }
    finally { setButtonBusy(button, false); }
  });
}
