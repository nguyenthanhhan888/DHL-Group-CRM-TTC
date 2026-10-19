import { EmptyState } from '../components/EmptyState.js';
import { DateRangeFields } from '../components/DateRangeFields.js';
import { FilterBar } from '../components/FilterBar.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { createDateValue, formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';

const WORK_TYPES = Object.freeze({
  pr_post: 'Bài PR',
  banner: 'Banner / Treo ảnh bìa',
  customer_followup: 'Chăm sóc khách hàng',
  admin_task: 'Việc hành chính',
  note: 'Ghi chú',
  other: 'Khác',
});
const STATUSES = Object.freeze({
  pending: 'Chờ xử lý',
  in_progress: 'Đang thực hiện',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
});
const STATUS_FILTERS = Object.freeze({
  open: 'Đang mở',
  pending: 'Chờ xử lý',
  in_progress: 'Đang thực hiện',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  all: 'Tất cả',
});
const state = {
  rows: [], customers: [], kiosks: [], employees: [], requestId: 0,
  filters: { search: '', status: 'open', workType: '', assigneeEmployeeId: '', fromDate: '', toDate: '' },
};

export function WorkItemsPage() {
  return `<div class="work-items-page">
    ${PageHeader({
      title: 'Job',
      description: 'Phân công nhân viên, lên lịch hoạt động khách hàng và lưu ghi chú nội bộ.',
      actions: `<button class="btn-primary work-item-create-button" id="work-item-add" type="button">${renderIcon('plus')}<span>Tạo Job</span></button>`,
    })}
    ${FilterBar({ label: 'Bộ lọc Job', className: 'work-item-filter-bar', children: `
      <label class="filter-field filter-field-search"><span>Tìm Job / Khách hàng / Kiosk</span><input class="form-control" id="work-item-search" type="search" placeholder="Tiêu đề, nội dung, Khách hàng, Kiosk…" value="${escapeHtml(state.filters.search)}"></label>
      <label class="filter-field"><span>Trạng thái</span><select class="filter-select" id="work-item-status">${options(STATUS_FILTERS, state.filters.status)}</select></label>
      <label class="filter-field"><span>Loại Job</span><select class="filter-select" id="work-item-type"><option value="">Tất cả loại</option>${options(WORK_TYPES, state.filters.workType)}</select></label>
      <label class="filter-field"><span>Nhân viên phụ trách</span><select class="filter-select" id="work-item-assignee"><option value="">Tất cả nhân viên</option></select></label>
      ${DateRangeFields({ fromId: 'work-item-from-date', toId: 'work-item-to-date' })}
      <button class="btn-secondary work-item-reset" id="work-item-reset" type="button">Đặt lại</button>
    ` })}
    <p class="work-item-result-count" id="work-item-result-count" role="status" aria-live="polite"></p>
    <section class="table-card work-items-table-card"><div class="report-table-wrap"><table class="data-table work-items-table">
      <thead><tr><th>Job</th><th>Khách hàng / Kiosk</th><th>Nhân viên</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
      <tbody id="work-items-body"><tr><td colspan="6">Đang tải Job...</td></tr></tbody>
    </table></div></section>
  </div>`;
}

WorkItemsPage.afterRender = () => {
  document.getElementById('work-item-add')?.addEventListener('click', () => openForm());
  document.getElementById('work-items-body')?.addEventListener('click', handleRowAction);
  document.getElementById('work-item-reset')?.addEventListener('click', resetFilters);
  let searchTimer;
  document.getElementById('work-item-search')?.addEventListener('input', event => {
    state.filters.search = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });
  for (const [id, key] of [
    ['work-item-status','status'], ['work-item-type','workType'], ['work-item-assignee','assigneeEmployeeId'],
    ['work-item-from-date','fromDate'], ['work-item-to-date','toDate'],
  ]) {
    document.getElementById(id)?.addEventListener('change', event => {
      state.filters[key] = event.target.value;
      load();
    });
  }
  const fromDate = document.getElementById('work-item-from-date');
  const toDate = document.getElementById('work-item-to-date');
  if (fromDate) fromDate.value = state.filters.fromDate;
  if (toDate) toDate.value = state.filters.toDate;
  load();
};

async function load() {
  const body = document.getElementById('work-items-body');
  if (!body) return;
  const requestId = ++state.requestId;
  body.innerHTML = '<tr><td colspan="6">Đang tải Job...</td></tr>';
  try {
    const { data } = await WorkItemService.list(state.filters);
    if (requestId !== state.requestId || !body.isConnected) return;
    state.rows = Array.isArray(data?.rows) ? data.rows : [];
    state.customers = Array.isArray(data?.customers) ? data.customers : [];
    state.kiosks = Array.isArray(data?.kiosks) ? data.kiosks : [];
    state.employees = Array.isArray(data?.employees) ? data.employees : [];
    renderEmployeeFilter();
    renderRows();
  } catch (error) {
    if (requestId !== state.requestId || !body.isConnected) return;
    body.innerHTML = `<tr><td colspan="6">${EmptyState({ title: 'Không tải được Job', message: escapeHtml(error?.message || 'Vui lòng thử lại.') })}<button class="btn-secondary work-item-retry" type="button" data-work-item-action="retry">Thử lại</button></td></tr>`;
    document.getElementById('work-item-result-count').textContent = '';
  }
}

function renderRows() {
  const body = document.getElementById('work-items-body');
  if (!body) return;
  document.getElementById('work-item-result-count').textContent = `${state.rows.length} Job`;
  body.innerHTML = state.rows.length ? state.rows.map(item => `<tr>
    <td data-label="Job"><div class="work-item-title-cell"><span class="work-item-type-label">${escapeHtml(WORK_TYPES[item.work_type] || 'Khác')}</span><strong>${escapeHtml(item.title)}</strong>${item.note ? `<span class="work-item-note-preview">${escapeHtml(notePreview(item.note))}</span>` : ''}<small class="work-item-created">Tạo bởi ${escapeHtml(item.creator_name || 'Tài khoản đã xóa')}</small></div></td>
    <td data-label="Khách hàng / Kiosk">${relationship(item)}</td>
    <td data-label="Nhân viên">${assignee(item)}</td>
    <td data-label="Thời gian">${dateSummary(item)}</td>
    <td data-label="Trạng thái">${statusBadge(item.status)}</td>
    <td data-label="Thao tác">${actionMenu(item)}</td>
  </tr>`).join('') : `<tr><td colspan="6">${EmptyState({ title: 'Chưa có Job phù hợp', message: hasActiveFilters() ? 'Thử thay đổi hoặc đặt lại bộ lọc.' : 'Tạo Job đầu tiên để bắt đầu phân công.' })}</td></tr>`;
}

function renderEmployeeFilter() {
  const select = document.getElementById('work-item-assignee');
  if (!select) return;
  select.innerHTML = `<option value="">Tất cả nhân viên</option>${state.employees.map(employee => `<option value="${escapeHtml(employee.id)}" ${String(employee.id) === state.filters.assigneeEmployeeId ? 'selected' : ''}>${escapeHtml(employee.name)}${employee.is_eligible === false ? ' · Đã nghỉ/lưu trữ' : ''}</option>`).join('')}`;
}

function handleRowAction(event) {
  const button = event.target.closest('[data-work-item-action]');
  if (!button) return;
  const action = button.dataset.workItemAction;
  if (action === 'retry') return load();
  const item = state.rows.find(row => String(row.id) === button.dataset.workItemId);
  if (!item) return;
  if (action === 'edit') openForm(item);
  else if (action === 'complete') confirmStatus(item, 'completed');
  else if (action === 'cancel') confirmStatus(item, 'cancelled');
}

function openForm(item = null) {
  const closed = ['completed','cancelled'].includes(item?.status);
  const isCustomerJob = Boolean(item?.customer_id);
  const today = createDateValue(null, null);
  Modal.open({ title: item ? 'Xem / Sửa Job' : 'Tạo Job', className: 'modal-wide work-item-modal', body: `
    <form id="work-item-form" class="modal-form work-item-form">
      <div class="work-item-form-content">
        <div class="work-item-form-grid">
          <label class="form-group work-item-form-wide"><span>Tiêu đề Job *</span><input class="form-control" name="title" maxlength="200" required autofocus value="${escapeHtml(item?.title || '')}"></label>
          <label class="form-group work-item-form-wide"><span>Loại Job *</span><select class="form-control" name="workType" required>${options(WORK_TYPES,item?.work_type || 'admin_task')}</select></label>
          <fieldset class="work-item-scope-field work-item-form-wide">
            <legend>Đối tượng</legend>
            <div class="work-item-scope" role="radiogroup" aria-label="Đối tượng Job">
              <label><input type="radio" name="scope" value="internal" ${isCustomerJob ? '' : 'checked'}><span>Nội bộ</span></label>
              <label><input type="radio" name="scope" value="customer" ${isCustomerJob ? 'checked' : ''}><span>Khách hàng / Kiosk</span></label>
            </div>
          </fieldset>
          <div class="work-item-subgrid work-item-form-wide ${isCustomerJob ? '' : 'hidden'}" data-customer-fields>
            <label class="form-group"><span>Khách hàng *</span><select class="form-control" name="customerId"><option value="">Chọn Khách hàng</option>${entityOptions(state.customers,item?.customer_id)}</select></label>
            <label class="form-group"><span>Kiosk</span><select class="form-control" name="kioskId"></select></label>
          </div>
          <label class="form-group work-item-form-wide"><span>Người phụ trách</span><select class="form-control" name="assigneeEmployeeId"><option value="">Chưa phân công</option>${employeeOptions(item)}</select></label>
          ${item?.assignee_source === 'legacy_user' ? `<p class="work-item-legacy-assignee work-item-form-wide">Job cũ đang giao cho tài khoản CRM: <strong>${escapeHtml(item.assignee_name || item.assignee_username || 'Tài khoản đã xóa')}</strong>. Assignment này được giữ nguyên nếu bạn chưa chọn Nhân viên.</p>` : ''}
          <div class="work-item-subgrid work-item-form-wide work-item-date-grid">
            <label class="form-group" data-date-field="start"><span>Ngày bắt đầu *</span><input class="form-control" name="startDate" type="date" value="${escapeHtml(item ? item.start_date ?? '' : today)}"></label>
            <label class="form-group" data-date-field="due"><span data-due-label>Ngày thực hiện / hạn *</span><input class="form-control" name="dueDate" type="date" value="${escapeHtml(item ? item.due_date ?? '' : today)}"></label>
          </div>
          ${item ? `<label class="form-group work-item-form-status"><span>Trạng thái</span><select class="form-control" name="status" ${closed ? 'disabled' : ''}>${options(STATUSES,item.status || 'pending')}</select></label>` : ''}
          <label class="form-group work-item-form-wide work-item-form-note"><span>Nội dung / Ghi chú</span><textarea class="form-control" name="note" rows="4" maxlength="10000" placeholder="Mô tả ngắn gọn kết quả cần đạt…">${escapeHtml(item?.note || '')}</textarea></label>
          ${closed ? `<p class="modal-note work-item-form-wide">Job đã ${item.status === 'completed' ? 'hoàn thành' : 'hủy'}; có thể cập nhật nội dung nhưng không mở lại trong phiên bản này.</p>` : ''}
          <div class="form-error hidden work-item-form-wide" role="alert"></div>
        </div>
      </div>
      <div class="modal-actions work-item-form-actions"><button class="btn-secondary" type="button" data-work-item-close>Đóng</button><button class="btn-primary" type="submit">${item ? 'Lưu thay đổi' : 'Tạo Job'}</button></div>
    </form>` });
  const form = document.getElementById('work-item-form');
  const customerFields = form.querySelector('[data-customer-fields]');
  const customerSelect = form.elements.customerId;
  const kioskSelect = form.elements.kioskId;
  const renderKiosks = () => {
    const customerId = customerSelect.value;
    const kiosks = state.kiosks.filter(kiosk => String(kiosk.customer_id) === String(customerId));
    kioskSelect.disabled = !customerId;
    kioskSelect.innerHTML = `<option value="">${customerId ? 'Không gắn Kiosk' : 'Chọn Khách hàng trước'}</option>${entityOptions(kiosks,item?.kiosk_id)}`;
    if (!kiosks.some(kiosk => String(kiosk.id) === String(kioskSelect.value))) kioskSelect.value = '';
  };
  const syncScope = () => {
    const customerScope = form.elements.scope.value === 'customer';
    customerFields.classList.toggle('hidden', !customerScope);
    customerSelect.required = customerScope;
    if (!customerScope) {
      customerSelect.value = '';
      kioskSelect.value = '';
      kioskSelect.disabled = true;
    } else {
      renderKiosks();
    }
  };
  const validateDates = () => {
    const invalid = form.elements.startDate.value && form.elements.dueDate.value
      && form.elements.startDate.value > form.elements.dueDate.value;
    form.elements.dueDate.setCustomValidity(invalid ? 'Ngày kết thúc không được trước ngày bắt đầu.' : '');
    return !invalid;
  };
  const syncTypeFields = () => {
    const type = form.elements.workType.value;
    const banner = type === 'banner';
    const note = type === 'note';
    const scheduled = ['pr_post','customer_followup','admin_task'].includes(type);
    const changedType = Boolean(item && type !== item.work_type);
    const enforceNewSchedule = !item || changedType;
    const startField = form.querySelector('[data-date-field="start"]');
    const dueField = form.querySelector('[data-date-field="due"]');
    startField.classList.toggle('hidden', !banner);
    dueField.classList.toggle('hidden', note);
    form.elements.startDate.required = banner && (enforceNewSchedule || Boolean(item?.start_date));
    form.elements.dueDate.required = (banner || scheduled) && (enforceNewSchedule || Boolean(item?.due_date));
    form.querySelector('[data-due-label]').textContent = banner ? 'Ngày kết thúc *' : scheduled ? 'Ngày thực hiện *' : 'Ngày thực hiện';
    if (!item && !note && !form.elements.dueDate.value) form.elements.dueDate.value = today;
    if (!item && banner && !form.elements.startDate.value) form.elements.startDate.value = today;
    if (!banner && enforceNewSchedule) form.elements.startDate.value = '';
    if (note && enforceNewSchedule) form.elements.dueDate.value = '';
    validateDates();
  };
  form.elements.scope.forEach(input => input.addEventListener('change', syncScope));
  form.elements.workType.addEventListener('change', syncTypeFields);
  customerSelect.addEventListener('change', () => { renderKiosks(); kioskSelect.value = ''; });
  form.elements.startDate.addEventListener('change', validateDates);
  form.elements.dueDate.addEventListener('change', validateDates);
  renderKiosks();
  if (item?.kiosk_id) kioskSelect.value = String(item.kiosk_id);
  syncScope();
  syncTypeFields();
  form.querySelector('[data-work-item-close]').addEventListener('click', Modal.close);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!validateDates()) { form.elements.dueDate.reportValidity(); return; }
    const button = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('[role="alert"]');
    const customerScope = form.elements.scope.value === 'customer';
    setButtonBusy(button,true,{busyLabel:'Đang lưu...'});
    try {
      await WorkItemService.save({
        workType: form.elements.workType.value,
        title: form.elements.title.value,
        customerId: customerScope ? customerSelect.value : '',
        kioskId: customerScope ? kioskSelect.value : '',
        assigneeEmployeeId: form.elements.assigneeEmployeeId.value,
        startDate: form.elements.startDate.value,
        dueDate: form.elements.dueDate.value,
        status: item ? (form.elements.status?.value || item.status) : 'pending',
        note: form.elements.note.value,
      },item?.id || null);
      Modal.close();
      Toast.show(item ? 'Đã cập nhật Job.' : 'Đã tạo Job.');
      await load();
    } catch (error) {
      errorBox.textContent = error?.message || 'Không thể lưu Job.';
      errorBox.classList.remove('hidden');
    } finally { setButtonBusy(button,false); }
  });
}

function confirmStatus(item,status) {
  const completed = status === 'completed';
  Modal.open({ title: completed ? 'Hoàn thành Job' : 'Hủy Job', className: 'work-item-status-modal', body: `
    <p><strong>${escapeHtml(item.title)}</strong></p><p class="modal-note">${completed ? 'Thời điểm hoàn thành sẽ được ghi nhận ngay.' : 'Job vẫn được giữ lại để tra cứu lịch sử.'}</p>
    <div class="form-error hidden" role="alert"></div><div class="modal-actions"><button class="btn-secondary" type="button" data-work-item-close>Đóng</button><button class="${completed ? 'btn-primary' : 'btn-danger'}" type="button" data-work-item-confirm>${completed ? 'Hoàn thành' : 'Hủy Job'}</button></div>` });
  document.querySelector('[data-work-item-close]').addEventListener('click',Modal.close);
  document.querySelector('[data-work-item-confirm]').addEventListener('click',async event => {
    const button=event.currentTarget;setButtonBusy(button,true,{busyLabel:'Đang cập nhật...'});
    try { await WorkItemService.setStatus(item.id,status);Modal.close();Toast.show(completed?'Đã hoàn thành Job.':'Đã hủy Job.');await load(); }
    catch(error){const box=document.querySelector('[data-modal-body] [role="alert"]');if(box){box.textContent=error?.message||'Không thể cập nhật trạng thái.';box.classList.remove('hidden');}}
    finally{setButtonBusy(button,false);}
  });
}

function resetFilters() {
  Object.assign(state.filters,{search:'',status:'open',workType:'',assigneeEmployeeId:'',fromDate:'',toDate:''});
  for (const [id,value] of [['work-item-search',''],['work-item-status','open'],['work-item-type',''],['work-item-assignee',''],['work-item-from-date',''],['work-item-to-date','']]) {
    const field=document.getElementById(id);if(field)field.value=value;
  }
  load();
}

function options(map,selected) { return Object.entries(map).map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join(''); }
function entityOptions(items,selected) { return items.map(item=>`<option value="${escapeHtml(item.id)}" ${String(item.id)===String(selected||'')?'selected':''}>${escapeHtml(item.name||'—')}</option>`).join(''); }
function employeeOptions(item) {
  const currentId = item?.assignee_employee_id;
  const eligible = state.employees.filter(employee => employee.is_eligible !== false);
  const current = currentId && !eligible.some(employee => String(employee.id) === String(currentId))
    ? state.employees.find(employee => String(employee.id) === String(currentId)) || { id: currentId, name: item.assignee_name || 'Nhân viên không còn hoạt động', is_eligible: false }
    : null;
  return [...(current ? [current] : []), ...eligible].map(employee => `<option value="${escapeHtml(employee.id)}" ${String(employee.id)===String(currentId||'')?'selected':''}>${escapeHtml(employee.name)}${employee.is_eligible === false ? ' · Đã nghỉ/lưu trữ' : ''}</option>`).join('');
}
function relationship(item) { return item.customer_name ? `<div class="work-item-relationship"><strong>${escapeHtml(item.customer_name)}</strong><span>${escapeHtml(item.kiosk_name||'Toàn bộ Khách hàng')}</span></div>` : '<span class="work-item-internal">Nội bộ</span>'; }
function assignee(item) {
  if (!item.assignee_name) return '<span class="text-muted">Chưa phân công</span>';
  const legacy = item.assignee_source === 'legacy_user';
  return `<div class="work-item-assignee"><strong>${escapeHtml(item.assignee_name)}</strong>${legacy ? '<span>Assignment tài khoản cũ</span>' : item.assignee_employee_status === 'left' || item.assignee_employee_archived_at ? '<span>Đã nghỉ / lưu trữ</span>' : '<span>Nhân viên</span>'}</div>`;
}
function dateSummary(item) {
  if (!item.start_date&&!item.due_date) return '<span class="text-muted">Không đặt lịch</span>';
  if (item.work_type === 'banner') return `<div class="work-item-dates"><span>${escapeHtml(formatDate(item.start_date))}</span><strong>→ ${escapeHtml(formatDate(item.due_date))}</strong></div>`;
  return `<div class="work-item-dates"><strong>${escapeHtml(formatDate(item.due_date || item.start_date))}</strong></div>`;
}
function statusBadge(status) { const tone={pending:'neutral',in_progress:'warning',completed:'success',cancelled:'danger'}[status]||'neutral';return `<span class="status-badge status-badge--${tone}">${escapeHtml(STATUSES[status]||status)}</span>`; }
function notePreview(note) { const value=String(note||'').replace(/\s+/g,' ').trim();return value?`${value.slice(0,100)}${value.length>100?'…':''}`:''; }
function actionMenu(item) { const closed=['completed','cancelled'].includes(item.status);return `<details class="work-item-action-menu"><summary class="table-action-button">Thao tác</summary><div class="work-item-action-dropdown"><button type="button" data-work-item-action="edit" data-work-item-id="${item.id}">${renderIcon('edit')}<span>Xem / Sửa</span></button>${closed?'':`<button type="button" data-work-item-action="complete" data-work-item-id="${item.id}">${renderIcon('check-circle')}<span>Hoàn thành</span></button><button class="is-danger" type="button" data-work-item-action="cancel" data-work-item-id="${item.id}">${renderIcon('x-circle')}<span>Hủy</span></button>`}</div></details>`; }
function hasActiveFilters() { return state.filters.search || state.filters.status !== 'open' || state.filters.workType || state.filters.assigneeEmployeeId || state.filters.fromDate || state.filters.toDate; }
