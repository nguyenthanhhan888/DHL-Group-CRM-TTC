import { createDateValue } from '../utils/date.js';
import { EmployeeService } from '../services/EmployeeService.js';
import { AuthService } from '../services/AuthService.js';
import { StaffService } from '../services/StaffService.js';
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

const state = { rows: [], actor: null, search: '', status: '', includeArchived: false, requestId: 0 };
export function EmployeesPage() {
  return `<div class="employees-page">
    ${PageHeader({ title: 'Nhân viên', description: 'Quản lý người làm việc và liên kết khoản chi. Không cần tài khoản website.', actions: `<button type="button" class="btn-primary" id="employee-add">${renderIcon('plus')}<span>Thêm nhân viên</span></button>` })}
    ${ExpenseNavigation('employees')}
    ${FilterBar({ label: 'Bộ lọc nhân viên', children: `
      <label class="filter-field filter-field-search"><span>Tìm nhân viên</span><input class="form-control" id="employee-search" type="search" placeholder="Họ tên, số điện thoại, công việc" value="${escapeHtml(state.search)}"></label>
      <label class="filter-field"><span>Trạng thái làm việc</span><select class="filter-select" id="employee-status-filter"><option value="">Tất cả trạng thái</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>Đang làm</option><option value="left" ${state.status === 'left' ? 'selected' : ''}>Đã nghỉ</option></select></label>
      <label class="employee-archive-filter"><input type="checkbox" id="employee-include-archived" ${state.includeArchived ? 'checked' : ''}> Hiện cả đã lưu trữ</label>` })}
    <p class="employee-result-count" id="employee-result-count" role="status"></p>
    <section class="table-card employee-table-card"><table class="data-table employee-table"><thead><tr><th>Họ tên</th><th>Số điện thoại</th><th>Vai trò / Công việc</th><th>Ngày bắt đầu</th><th>Trạng thái</th><th>Truy cập CRM</th><th>Thao tác</th></tr></thead><tbody id="employee-table-body"></tbody></table></section>
  </div>`;
}
EmployeesPage.afterRender = async () => {
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
    handleEmployeeAction(item, button.dataset.employeeAction);
  });
  try {
    const session = await AuthService.initialize();
    state.actor = session ? await AuthService.getCurrentProfile(session.user.id) : null;
  } catch {
    state.actor = null;
  }
  loadEmployees();
};
async function loadEmployees() {
  const body = document.getElementById('employee-table-body');
  if (!body) return;
  const requestId = ++state.requestId;
  body.innerHTML = '<tr><td colspan="7">Đang tải nhân viên...</td></tr>';
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
      <td data-label="Truy cập CRM">${crmAccessBadge(row)}</td>
      <td data-label="Thao tác"><div class="employee-actions">${action(row, 'detail', 'Chi tiết')}${row.archived_at ? action(row, 'restore', 'Khôi phục') : action(row, 'edit', 'Sửa') + action(row, 'archive', 'Lưu trữ')}</div></td>
    </tr>`).join('') : `<tr><td colspan="7">${EmptyState({ title: 'Chưa có nhân viên phù hợp', message: 'Thêm nhân viên hoặc thay đổi bộ lọc.' })}</td></tr>`;
  } catch (error) {
    if (requestId !== state.requestId || !body.isConnected) return;
    body.innerHTML = `<tr><td colspan="7">${EmptyState({ title: 'Không tải được nhân viên', message: error.message })}</td></tr>`;
  }
}
function action(item, name, label) {
  return `<button type="button" class="table-action-button" data-employee-id="${item.id}" data-employee-action="${name}">${label}</button>`;
}
function statusBadge(item) {
  return `<span class="status-badge status-badge--${item.archived_at || item.employment_status === 'left' ? 'neutral' : 'success'}">${employeeStatus(item)}</span>`;
}
function crmAccessBadge(item) {
  const user = item.website_user;
  if (!user) return '<span class="status-badge status-badge--neutral">Chưa cấp quyền</span>';
  const enabled = user.status === 'active' && user.web_access_enabled === true;
  return `<div class="unified-user-identity"><strong class="${enabled ? 'is-enabled' : 'is-disabled'}">${enabled ? 'Đang hoạt động' : 'Đã tắt'}</strong><span>@${escapeHtml(user.username || '—')}</span></div>`;
}
function openDetail(item) {
  const user = item.website_user;
  const canManageAccess = state.actor?.is_system_admin === true;
  const accessActions = !canManageAccess
    ? '<p class="modal-note">Chỉ System Admin được cấp, tắt hoặc thay đổi quyền CRM.</p>'
    : user
      ? `<div class="modal-actions">${action(item, 'manage-access', 'Quản lý quyền')}${!user.is_system_admin && user.status === 'active' && user.web_access_enabled ? action(item, 'disable-access', 'Tắt truy cập') : ''}</div>`
      : `<div class="modal-actions">${action(item, 'grant-access', 'Cấp quyền truy cập CRM')}</div>`;
  Modal.open({ title: 'Chi tiết nhân viên', className: 'employee-detail-modal', body: `
    <div class="detail-summary"><h3>${escapeHtml(item.full_name)}</h3><p>${statusBadge(item)}</p></div>
    ${DetailFields([['Số điện thoại', item.phone || '—'], ['Vai trò / Công việc', item.job_title || '—'], ['Ngày bắt đầu', item.start_date ? formatDate(item.start_date) : '—'], ['Trạng thái làm việc', item.employment_status === 'left' ? 'Đã nghỉ' : 'Đang làm'], ['Ghi chú', item.notes || '—']])}
    <section class="user-detail-card"><div class="user-detail-card-head"><div><span>Tài khoản nội bộ</span><h3>Truy cập CRM</h3></div>${crmAccessBadge(item)}</div>
      ${user ? DetailFields([['Website User', user.display_name || item.full_name], ['Username', user.username ? `@${user.username}` : '—'], ['Trạng thái tài khoản', user.status === 'locked' ? 'Đã khóa' : user.status === 'active' ? 'Hoạt động' : 'Chờ hồ sơ']]) : '<p class="modal-note">Chưa liên kết Website User. Nhân viên vẫn là hồ sơ nhân sự hợp lệ và không thể đăng nhập CRM.</p>'}
      ${accessActions}</section>
    <p class="employee-history-note">Nghỉ việc hoặc lưu trữ không làm mất nhân viên và tên đã ghi trên các khoản chi trước đây.</p>
    <div class="modal-actions">${item.archived_at ? action(item, 'restore', 'Khôi phục') : action(item, item.employment_status === 'left' ? 'reactivate' : 'left', item.employment_status === 'left' ? 'Làm việc trở lại' : 'Đánh dấu đã nghỉ') + action(item, 'edit', 'Chỉnh sửa')}</div>` });
  document.querySelectorAll('[data-modal-body] [data-employee-action]').forEach(button => button.addEventListener('click', () => handleEmployeeAction(item, button.dataset.employeeAction)));
}
function handleEmployeeAction(item, name) {
  if (name === 'detail') return openDetail(item);
  if (name === 'edit') return openEmployeeForm(item);
  if (name === 'grant-access') return openGrantAccess(item);
  if (name === 'manage-access') return openUserManagement(item.website_user?.user_id);
  if (name === 'disable-access') return confirmDisableAccess(item);
  return confirmLifecycle(item, name);
}
function openUserManagement(userId) {
  if (!userId) return;
  Modal.close();
  window.location.hash = `#/user-management?user=${encodeURIComponent(userId)}&tab=access`;
}
async function openGrantAccess(item) {
  Modal.open({ title: 'Cấp quyền truy cập CRM', className: 'employee-form-modal', body: `
    <form id="employee-access-form" class="modal-form">
      <p class="modal-note">Tạo Website User mới hoặc liên kết một tài khoản chưa gắn Nhân viên. Hồ sơ nhân sự không bị sao chép.</p>
      <label class="form-group"><span>Cách cấp quyền</span><select class="form-control" name="mode"><option value="create">Tạo Website User mới</option><option value="link">Liên kết Website User hiện có</option></select></label>
      <div data-access-create>
        <label class="form-group"><span>Username</span><input class="form-control" name="username" minlength="3" maxlength="40" pattern="[a-z0-9._-]{3,40}" autocomplete="off" required></label>
        <label class="form-group"><span>Mật khẩu khởi tạo</span><input class="form-control" name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      </div>
      <div class="hidden" data-access-link>
        <label class="form-group"><span>Website User</span><select class="form-control" name="userId" disabled required><option value="">Đang tải tài khoản chưa liên kết...</option></select></label>
      </div>
      <label class="form-group"><span>Lý do</span><textarea class="form-control" name="reason" maxlength="500" rows="3" required></textarea></label>
      <label class="form-group admin-password-confirm"><span>Xác nhận mật khẩu quản trị</span><input class="form-control" name="adminPassword" type="password" autocomplete="current-password" required></label>
      <div class="form-error hidden" role="alert"></div>
      <div class="modal-actions"><button class="btn-secondary" type="button" data-employee-cancel>Hủy</button><button class="btn-primary" type="submit">Tiếp tục sang Quản lý người dùng</button></div>
    </form>` });
  const form = document.getElementById('employee-access-form');
  const mode = form.elements.mode;
  const create = form.querySelector('[data-access-create]');
  const link = form.querySelector('[data-access-link]');
  const setMode = () => {
    const linking = mode.value === 'link';
    create.classList.toggle('hidden', linking);
    link.classList.toggle('hidden', !linking);
    [...create.querySelectorAll('input')].forEach(input => { input.disabled = linking; });
    link.querySelector('select').disabled = !linking;
  };
  mode.addEventListener('change', setMode);
  setMode();
  form.querySelector('[data-employee-cancel]').addEventListener('click', Modal.close);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('[role="alert"]');
    setButtonBusy(button, true, { busyLabel: 'Đang cấp quyền...' });
    try {
      const result = mode.value === 'link'
        ? await StaffService.linkEmployeeUser(item.id, form.elements.userId.value, form.elements.adminPassword.value, form.elements.reason.value)
        : await StaffService.grantEmployeeAccess(item.id, form.elements.username.value, form.elements.password.value, form.elements.adminPassword.value, form.elements.reason.value);
      Toast.show('Tài khoản đã được liên kết. Hãy xác nhận quyền truy cập.');
      openUserManagement(result.userId);
    } catch (error) {
      errorBox.textContent = error?.message || 'Không thể cấp quyền CRM.';
      errorBox.classList.remove('hidden');
    } finally {
      setButtonBusy(button, false);
    }
  });
  try {
    const result = await StaffService.list({ page: 1, pageSize: 100 });
    const available = (result.users || []).filter(user => !user.employee);
    const select = form.elements.userId;
    if (!select?.isConnected) return;
    select.innerHTML = `<option value="">${available.length ? 'Chọn Website User' : 'Không có tài khoản chưa liên kết'}</option>${available.map(user => `<option value="${escapeHtml(user.user_id)}">@${escapeHtml(user.username || '—')} · ${escapeHtml(user.display_name || 'Chưa có tên')}</option>`).join('')}`;
  } catch (error) {
    const select = form.elements.userId;
    if (select?.isConnected) select.innerHTML = `<option value="">${escapeHtml(error?.message || 'Không tải được Website User')}</option>`;
  }
}
function confirmDisableAccess(item) {
  const user = item.website_user;
  if (!user) return;
  Modal.open({ title: 'Tắt truy cập CRM', className: 'employee-detail-modal', body: `
    <form id="employee-disable-access-form" class="modal-form">
      <p class="modal-note">Website User <strong>@${escapeHtml(user.username || '—')}</strong> sẽ bị khóa. Hồ sơ Nhân viên và lịch sử chi phí vẫn được giữ nguyên.</p>
      <label class="form-group"><span>Lý do</span><textarea class="form-control" name="reason" maxlength="500" rows="3" required></textarea></label>
      <label class="form-group admin-password-confirm"><span>Xác nhận mật khẩu quản trị</span><input class="form-control" name="adminPassword" type="password" autocomplete="current-password" required></label>
      <div class="form-error hidden" role="alert"></div>
      <div class="modal-actions"><button class="btn-secondary" type="button" data-employee-cancel>Hủy</button><button class="btn-danger" type="submit">Tắt truy cập</button></div>
    </form>` });
  const form = document.getElementById('employee-disable-access-form');
  form.querySelector('[data-employee-cancel]').addEventListener('click', Modal.close);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('[role="alert"]');
    setButtonBusy(button, true, { busyLabel: 'Đang tắt...' });
    try {
      await StaffService.setLocked(user.user_id, true, form.elements.adminPassword.value, form.elements.reason.value);
      Modal.close();
      Toast.show('Đã tắt truy cập CRM; hồ sơ nhân viên được giữ nguyên.');
      await loadEmployees();
    } catch (error) {
      errorBox.textContent = error?.message || 'Không thể tắt truy cập.';
      errorBox.classList.remove('hidden');
    } finally {
      setButtonBusy(button, false);
    }
  });
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
