import { EmptyState } from '../components/EmptyState.js';
import { FilterBar } from '../components/FilterBar.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { WorkItemService } from '../services/WorkItemService.js';
import { formatDate } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';

const WORK_TYPES = Object.freeze({
  pr_post: 'Bài PR',
  banner: 'Banner',
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
const state = {
  rows: [], customers: [], kiosks: [], assignees: [], requestId: 0,
  filters: { search: '', status: '', workType: '', assigneeUserId: '', fromDate: '', toDate: '', includeClosed: false },
};

export function WorkItemsPage() {
  return `<div class="work-items-page">
    ${PageHeader({
      title: 'Công việc & Ghi chú',
      description: 'Theo dõi công việc vận hành theo Khách hàng, Kiosk và người phụ trách.',
      actions: `<button class="btn-primary" id="work-item-add" type="button">${renderIcon('plus')}<span>Tạo công việc</span></button>`,
    })}
    ${FilterBar({ label: 'Bộ lọc công việc', children: `
      <label class="filter-field filter-field-search"><span>Tìm công việc</span><input class="form-control" id="work-item-search" type="search" placeholder="Tiêu đề, ghi chú, Khách hàng, Kiosk…" value="${escapeHtml(state.filters.search)}"></label>
      <label class="filter-field"><span>Trạng thái</span><select class="filter-select" id="work-item-status"><option value="">Ưu tiên việc đang mở</option>${options(STATUSES, state.filters.status)}</select></label>
      <label class="filter-field"><span>Loại công việc</span><select class="filter-select" id="work-item-type"><option value="">Tất cả loại</option>${options(WORK_TYPES, state.filters.workType)}</select></label>
      <label class="filter-field"><span>Người phụ trách</span><select class="filter-select" id="work-item-assignee"><option value="">Tất cả người phụ trách</option></select></label>
      <label class="filter-field"><span>Từ ngày</span><input class="form-control" id="work-item-from-date" type="date" value="${escapeHtml(state.filters.fromDate)}"></label>
      <label class="filter-field"><span>Đến ngày</span><input class="form-control" id="work-item-to-date" type="date" value="${escapeHtml(state.filters.toDate)}"></label>
      <label class="work-item-closed-filter"><input id="work-item-include-closed" type="checkbox" ${state.filters.includeClosed ? 'checked' : ''}> Hiện việc đã kết thúc</label>
      <button class="btn-secondary" id="work-item-reset" type="button">Đặt lại</button>
    ` })}
    <p class="work-item-result-count" id="work-item-result-count" role="status" aria-live="polite"></p>
    <section class="table-card work-items-table-card"><div class="report-table-wrap"><table class="data-table work-items-table">
      <thead><tr><th>Công việc</th><th>Loại</th><th>Khách hàng / Kiosk</th><th>Phụ trách</th><th>Ngày liên quan</th><th>Trạng thái</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
      <tbody id="work-items-body"><tr><td colspan="8">Đang tải công việc...</td></tr></tbody>
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
  for (const [id, key] of [['work-item-status','status'],['work-item-type','workType'],['work-item-assignee','assigneeUserId'],['work-item-from-date','fromDate'],['work-item-to-date','toDate']]) {
    document.getElementById(id)?.addEventListener('change', event => { state.filters[key] = event.target.value; load(); });
  }
  document.getElementById('work-item-include-closed')?.addEventListener('change', event => { state.filters.includeClosed = event.target.checked; load(); });
  load();
};

async function load() {
  const body = document.getElementById('work-items-body');
  if (!body) return;
  const requestId = ++state.requestId;
  body.innerHTML = '<tr><td colspan="8">Đang tải công việc...</td></tr>';
  try {
    const { data } = await WorkItemService.list(state.filters);
    if (requestId !== state.requestId || !body.isConnected) return;
    state.rows = Array.isArray(data?.rows) ? data.rows : [];
    state.customers = Array.isArray(data?.customers) ? data.customers : [];
    state.kiosks = Array.isArray(data?.kiosks) ? data.kiosks : [];
    state.assignees = Array.isArray(data?.assignees) ? data.assignees : [];
    renderAssigneeFilter();
    renderRows();
  } catch (error) {
    if (requestId !== state.requestId || !body.isConnected) return;
    body.innerHTML = `<tr><td colspan="8">${EmptyState({ title: 'Không tải được công việc', message: escapeHtml(error?.message || 'Vui lòng thử lại.') })}</td></tr>`;
  }
}

function renderRows() {
  const body = document.getElementById('work-items-body');
  if (!body) return;
  document.getElementById('work-item-result-count').textContent = `${state.rows.length} công việc`;
  body.innerHTML = state.rows.length ? state.rows.map(item => `<tr>
    <td data-label="Công việc"><strong>${escapeHtml(item.title)}</strong><small class="work-item-created">Tạo bởi ${escapeHtml(item.creator_name || 'Tài khoản đã xóa')}</small></td>
    <td data-label="Loại">${escapeHtml(WORK_TYPES[item.work_type] || 'Khác')}</td>
    <td data-label="Khách hàng / Kiosk">${relationship(item)}</td>
    <td data-label="Phụ trách">${escapeHtml(item.assignee_name || 'Chưa phân công')}</td>
    <td data-label="Ngày liên quan">${dateSummary(item)}</td>
    <td data-label="Trạng thái">${statusBadge(item.status)}</td>
    <td data-label="Ghi chú"><span class="work-item-note-preview">${escapeHtml(notePreview(item.note))}</span></td>
    <td data-label="Thao tác">${actionMenu(item)}</td>
  </tr>`).join('') : `<tr><td colspan="8">${EmptyState({ title: 'Chưa có công việc phù hợp', message: state.filters.status || state.filters.includeClosed ? 'Thử thay đổi bộ lọc.' : 'Tạo công việc đầu tiên hoặc bật hiển thị việc đã kết thúc.' })}</td></tr>`;
}

function renderAssigneeFilter() {
  const select = document.getElementById('work-item-assignee');
  if (!select) return;
  select.innerHTML = `<option value="">Tất cả người phụ trách</option>${state.assignees.map(user => `<option value="${escapeHtml(user.user_id)}" ${String(user.user_id) === state.filters.assigneeUserId ? 'selected' : ''}>${escapeHtml(user.name || user.username || 'Chưa có tên')}</option>`).join('')}`;
}

function handleRowAction(event) {
  const button = event.target.closest('[data-work-item-action]');
  if (!button) return;
  const item = state.rows.find(row => String(row.id) === button.dataset.workItemId);
  if (!item) return;
  const action = button.dataset.workItemAction;
  if (action === 'edit') openForm(item);
  else if (action === 'complete') confirmStatus(item, 'completed');
  else if (action === 'cancel') confirmStatus(item, 'cancelled');
}

function openForm(item = null) {
  const closed = ['completed','cancelled'].includes(item?.status);
  Modal.open({ title: item ? 'Xem / Sửa công việc' : 'Tạo công việc', className: 'modal-wide work-item-modal', body: `
    <form id="work-item-form" class="modal-form">
      <div class="work-item-form-grid">
        <label class="form-group"><span>Loại công việc *</span><select class="form-control" name="workType" required>${options(WORK_TYPES,item?.work_type || 'admin_task')}</select></label>
        <label class="form-group work-item-form-title"><span>Tiêu đề *</span><input class="form-control" name="title" maxlength="200" required value="${escapeHtml(item?.title || '')}"></label>
        <label class="form-group"><span>Khách hàng</span><select class="form-control" name="customerId"><option value="">Công việc nội bộ chung</option>${entityOptions(state.customers,item?.customer_id)}</select></label>
        <label class="form-group"><span>Kiosk</span><select class="form-control" name="kioskId"></select></label>
        <label class="form-group"><span>Người phụ trách</span><select class="form-control" name="assigneeUserId"><option value="">Chưa phân công</option>${state.assignees.map(user => `<option value="${escapeHtml(user.user_id)}" ${String(user.user_id) === String(item?.assignee_user_id || '') ? 'selected' : ''}>${escapeHtml(user.name || user.username || 'Chưa có tên')}</option>`).join('')}</select></label>
        <label class="form-group"><span>Trạng thái</span><select class="form-control" name="status" ${closed ? 'disabled' : ''}>${options(STATUSES,item?.status || 'pending')}</select></label>
        <label class="form-group"><span>Ngày bắt đầu</span><input class="form-control" name="startDate" type="date" value="${escapeHtml(item?.start_date || '')}"></label>
        <label class="form-group"><span>Ngày thực hiện / hạn</span><input class="form-control" name="dueDate" type="date" value="${escapeHtml(item?.due_date || '')}"></label>
        <label class="form-group work-item-form-note"><span>Nội dung / Ghi chú</span><textarea class="form-control" name="note" rows="5" maxlength="10000">${escapeHtml(item?.note || '')}</textarea></label>
      </div>
      ${closed ? `<p class="modal-note">Công việc đã ${item.status === 'completed' ? 'hoàn thành' : 'hủy'}; có thể cập nhật nội dung nhưng không mở lại trong phiên bản này.</p>` : ''}
      <div class="form-error hidden" role="alert"></div>
      <div class="modal-actions"><button class="btn-secondary" type="button" data-work-item-close>Đóng</button><button class="btn-primary" type="submit">${item ? 'Lưu thay đổi' : 'Tạo công việc'}</button></div>
    </form>` });
  const form = document.getElementById('work-item-form');
  const customerSelect = form.elements.customerId;
  const kioskSelect = form.elements.kioskId;
  const renderKiosks = () => {
    const customerId = customerSelect.value;
    const kiosks = state.kiosks.filter(kiosk => String(kiosk.customer_id) === String(customerId));
    kioskSelect.disabled = !customerId;
    kioskSelect.innerHTML = `<option value="">${customerId ? 'Không gắn Kiosk' : 'Chọn Khách hàng trước'}</option>${entityOptions(kiosks,item?.kiosk_id)}`;
    if (!kiosks.some(kiosk => String(kiosk.id) === String(kioskSelect.value))) kioskSelect.value = '';
  };
  customerSelect.addEventListener('change', () => { renderKiosks(); kioskSelect.value = ''; });
  renderKiosks();
  if (item?.kiosk_id) kioskSelect.value = String(item.kiosk_id);
  form.querySelector('[data-work-item-close]').addEventListener('click', Modal.close);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('[role="alert"]');
    setButtonBusy(button,true,{busyLabel:'Đang lưu...'});
    try {
      await WorkItemService.save({
        workType: form.elements.workType.value,title: form.elements.title.value,
        customerId: customerSelect.value,kioskId: kioskSelect.value,
        assigneeUserId: form.elements.assigneeUserId.value,
        startDate: form.elements.startDate.value,dueDate: form.elements.dueDate.value,
        status: form.elements.status.value,note: form.elements.note.value,
      },item?.id || null);
      Modal.close(); Toast.show(item ? 'Đã cập nhật công việc.' : 'Đã tạo công việc.'); await load();
    } catch (error) {
      errorBox.textContent = error?.message || 'Không thể lưu công việc.'; errorBox.classList.remove('hidden');
    } finally { setButtonBusy(button,false); }
  });
}

function confirmStatus(item,status) {
  const completed = status === 'completed';
  Modal.open({ title: completed ? 'Hoàn thành công việc' : 'Hủy công việc', className: 'work-item-status-modal', body: `
    <p><strong>${escapeHtml(item.title)}</strong></p><p class="modal-note">${completed ? 'Thời điểm hoàn thành sẽ được ghi nhận ngay.' : 'Công việc vẫn được giữ lại để tra cứu lịch sử.'}</p>
    <div class="form-error hidden" role="alert"></div><div class="modal-actions"><button class="btn-secondary" type="button" data-work-item-close>Đóng</button><button class="${completed ? 'btn-primary' : 'btn-danger'}" type="button" data-work-item-confirm>${completed ? 'Hoàn thành' : 'Hủy công việc'}</button></div>` });
  document.querySelector('[data-work-item-close]').addEventListener('click',Modal.close);
  document.querySelector('[data-work-item-confirm]').addEventListener('click',async event => {
    const button=event.currentTarget;setButtonBusy(button,true,{busyLabel:'Đang cập nhật...'});
    try { await WorkItemService.setStatus(item.id,status);Modal.close();Toast.show(completed?'Đã hoàn thành công việc.':'Đã hủy công việc.');await load(); }
    catch(error){const box=document.querySelector('[data-modal-body] [role="alert"]');if(box){box.textContent=error?.message||'Không thể cập nhật trạng thái.';box.classList.remove('hidden');}}
    finally{setButtonBusy(button,false);}
  });
}

function resetFilters() {
  Object.assign(state.filters,{search:'',status:'',workType:'',assigneeUserId:'',fromDate:'',toDate:'',includeClosed:false});
  const ids=['work-item-search','work-item-status','work-item-type','work-item-assignee','work-item-from-date','work-item-to-date'];
  ids.forEach(id=>{const field=document.getElementById(id);if(field)field.value='';});
  const checkbox=document.getElementById('work-item-include-closed');if(checkbox)checkbox.checked=false;
  load();
}

function options(map,selected) { return Object.entries(map).map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join(''); }
function entityOptions(items,selected) { return items.map(item=>`<option value="${escapeHtml(item.id)}" ${String(item.id)===String(selected||'')?'selected':''}>${escapeHtml(item.name||'—')}</option>`).join(''); }
function relationship(item) { return item.customer_name ? `<div class="work-item-relationship"><strong>${escapeHtml(item.customer_name)}</strong><span>${escapeHtml(item.kiosk_name||'Toàn bộ Khách hàng')}</span></div>` : '<span class="text-muted">Nội bộ chung</span>'; }
function dateSummary(item) { if(!item.start_date&&!item.due_date)return '<span class="text-muted">Chưa đặt ngày</span>';return `<div class="work-item-dates">${item.start_date?`<span>Bắt đầu: ${escapeHtml(formatDate(item.start_date))}</span>`:''}${item.due_date?`<strong>Thực hiện: ${escapeHtml(formatDate(item.due_date))}</strong>`:''}</div>`; }
function statusBadge(status) { const tone={pending:'neutral',in_progress:'warning',completed:'success',cancelled:'danger'}[status]||'neutral';return `<span class="status-badge status-badge--${tone}">${escapeHtml(STATUSES[status]||status)}</span>`; }
function notePreview(note) { const value=String(note||'').replace(/\s+/g,' ').trim();return value?`${value.slice(0,90)}${value.length>90?'…':''}`:'—'; }
function actionMenu(item) { const closed=['completed','cancelled'].includes(item.status);return `<details class="work-item-action-menu"><summary class="table-action-button">Thao tác</summary><div class="work-item-action-dropdown"><button type="button" data-work-item-action="edit" data-work-item-id="${item.id}">${renderIcon('edit')}<span>Xem / Sửa</span></button>${closed?'':`<button type="button" data-work-item-action="complete" data-work-item-id="${item.id}">${renderIcon('check-circle')}<span>Hoàn thành</span></button><button class="is-danger" type="button" data-work-item-action="cancel" data-work-item-id="${item.id}">${renderIcon('x-circle')}<span>Hủy</span></button>`}</div></details>`; }
