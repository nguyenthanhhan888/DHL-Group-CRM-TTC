import { openPromotionForm } from '../components/PromotionForm.js';
import { promotionReward, promotionApplicability, promotionPeriod } from '../utils/promotionForm.js';
export { promotionDateDefaults } from '../utils/promotionForm.js';
import { DetailFields } from '../components/DetailFields.js';
import { FilterBar } from '../components/FilterBar.js';
import { PageHeader } from '../components/PageHeader.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { PromotionService } from '../services/PromotionService.js';
import { formatDate } from '../utils/date.js';
import { formatCurrency } from '../utils/currency.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';

let promotions=[];
let menuInteractionsBound=false;
const promotionFilters = { search: '', status: '' };
const PROMOTION_STATUSES = ['Hoạt động', 'Sắp diễn ra', 'Hết hạn', 'Tạm ngưng'];

export function PromotionsPage() {
  return `<div class="promotions-page">${PageHeader({title:'Mã giảm giá',description:'Quản lý ưu đãi cho lô đăng ký Kiosk.',actions:'<button class="btn-primary" id="add-promotion" type="button">+ Tạo chương trình</button>'})}
    ${FilterBar({ label: 'Bộ lọc mã giảm giá', children: `
      <label class="filter-field filter-field-search"><span>Tìm kiếm</span><input class="form-control" type="search" id="promotion-search" placeholder="Mã, tên hoặc mô tả chương trình…" autocomplete="off"></label>
      <label class="filter-field"><span>Trạng thái</span><select class="filter-select" id="promotion-status-filter"><option value="">Tất cả trạng thái</option>${PROMOTION_STATUSES.map(label => `<option value="${label}">${label}</option>`).join('')}</select></label>
      <button class="btn-secondary" type="button" id="promotion-filter-reset">Đặt lại</button>
    ` })}
    <p class="promotion-filter-count" id="promotion-filter-count" role="status" aria-live="polite"></p>
    <div class="table-card promotions-table-card"><table class="data-table promotions-table"><thead><tr><th>Mã</th><th>Tên chương trình</th><th>Loại</th><th>Giá trị</th><th>Thời gian</th><th>Đã dùng / Giới hạn</th><th>Trạng thái</th><th>Hành động</th></tr></thead><tbody id="promotions-body"><tr><td colspan="8">Đang tải...</td></tr></tbody></table></div>
  </div>`;
}
PromotionsPage.afterRender = () => {
  document.getElementById('add-promotion')?.addEventListener('click', () => openForm());
  document.getElementById('promotions-body')?.addEventListener('click', handleAction);
  const search = document.getElementById('promotion-search');
  const statusFilter = document.getElementById('promotion-status-filter');
  search.value = promotionFilters.search;
  statusFilter.value = promotionFilters.status;
  search.addEventListener('input', () => { promotionFilters.search = search.value; renderPromotions(); });
  statusFilter.addEventListener('change', () => { promotionFilters.status = statusFilter.value; renderPromotions(); });
  document.getElementById('promotion-filter-reset')?.addEventListener('click', () => {
    promotionFilters.search = ''; promotionFilters.status = '';
    search.value = ''; statusFilter.value = ''; renderPromotions();
  });
  bindPromotionMenuInteractions();
  load();
};
async function load() {
  const body = document.getElementById('promotions-body');
  try {
    promotions = (await PromotionService.list()).data || [];
    if (body !== document.getElementById('promotions-body')) return;
    renderPromotions();
  } catch (error) {
    promotions = [];
    if (body) body.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message || 'Không thể tải dữ liệu.')}</td></tr>`;
    const count = document.getElementById('promotion-filter-count');
    if (count) count.textContent = '';
  }
}
function renderPromotions() {
  const body = document.getElementById('promotions-body');
  if (!body) return;
  const filtered = filterPromotions(promotions, promotionFilters);
  closePromotionMenus();
  body.innerHTML = filtered.length ? filtered.map(row).join('') : `<tr><td colspan="8"><div class="empty-state compact"><strong>${promotions.length ? 'Không tìm thấy mã giảm giá' : 'Chưa có chương trình khuyến mãi'}</strong><p>${promotions.length ? 'Thử từ khóa khác hoặc đặt lại bộ lọc.' : 'Tạo chương trình đầu tiên để bắt đầu.'}</p></div></td></tr>`;
  document.getElementById('promotion-filter-count').textContent = `${filtered.length} / ${promotions.length} chương trình`;
}
export function filterPromotions(items, { search = '', status: selectedStatus = '' } = {}, now = Date.now()) {
  const query = normalizeSearch(search);
  return items.filter(item => (!selectedStatus || status(item, now) === selectedStatus)
    && (!query || [item.code, item.name, item.description].some(value => normalizeSearch(value).includes(query))));
}
function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim();
}

function row(item){const uses=item.promotion_usages||[];return `<tr><td class="strong-cell" data-label="Mã">${escapeHtml(item.code)}</td><td data-label="Tên chương trình">${escapeHtml(item.name)}</td><td data-label="Loại">${typeLabel(item.discount_type)}</td><td data-label="Giá trị">${valueLabel(item)}</td><td data-label="Thời gian">${period(item)}</td><td data-label="Đã dùng / Giới hạn">${uses.length} / ${item.usage_limit_total??'Không giới hạn'}</td><td data-label="Trạng thái">${StatusBadge(statusTone(item),{label:status(item)})}</td><td data-label="Hành động"><div class="promotion-action-menu" data-promotion-menu><button class="promotion-action-trigger" type="button" data-promotion-menu-trigger aria-haspopup="menu" aria-expanded="false">Thao tác<span aria-hidden="true">${renderIcon('chevron')}</span></button><div class="promotion-action-dropdown hidden" role="menu" aria-label="Thao tác cho ${escapeHtml(item.code)}"><button type="button" role="menuitem" data-promotion-action="edit" data-promotion-id="${item.id}">${renderIcon('edit')}<span>Sửa</span></button><button type="button" role="menuitem" data-promotion-action="details" data-promotion-id="${item.id}">${renderIcon('view')}<span>Chi tiết</span></button><button class="is-warning" type="button" role="menuitem" data-promotion-action="toggle" data-promotion-id="${item.id}">${renderIcon(item.is_active?'pause':'check-circle')}<span>${item.is_active?'Tạm ngưng':'Kích hoạt lại'}</span></button><button class="is-danger" type="button" role="menuitem" data-promotion-action="delete" data-promotion-id="${item.id}">${renderIcon('trash')}<span>Xóa</span></button></div></div></td></tr>`;}
function handleAction(event){const trigger=event.target.closest('[data-promotion-menu-trigger]');if(trigger){togglePromotionMenu(trigger);return;}const action=event.target.closest('[data-promotion-action]');if(!action||action.dataset.busy==='true')return;const item=promotions.find(x=>String(x.id)===String(action.dataset.promotionId));if(!item)return;const type=action.dataset.promotionAction;if(type!=='toggle')closePromotionMenus();if(type==='edit')openForm(item);else if(type==='details')openDetails(item);else if(type==='delete')openDeleteConfirmation(item);else{setButtonBusy(action,true,{busyLabel:'Đang xử lý...'});PromotionService.setActive(item.id,!item.is_active).then(()=>{Toast.show(item.is_active?'Đã tạm ngưng chương trình.':'Đã kích hoạt chương trình.');return load();}).catch(error=>Toast.show(error?.message||'Không thể cập nhật chương trình.','error')).finally(()=>setButtonBusy(action,false));}}

function togglePromotionMenu(trigger){const menu=trigger.closest('[data-promotion-menu]');const dropdown=menu?.querySelector('.promotion-action-dropdown');if(!dropdown)return;const shouldOpen=dropdown.classList.contains('hidden');closePromotionMenus();if(!shouldOpen)return;dropdown.classList.remove('hidden');trigger.setAttribute('aria-expanded','true');positionPromotionMenu(trigger,dropdown);dropdown.querySelector('[role="menuitem"]')?.focus();}
function closePromotionMenus(){document.querySelectorAll('[data-promotion-menu]').forEach(menu=>{menu.querySelector('.promotion-action-dropdown')?.classList.add('hidden');menu.querySelector('[data-promotion-menu-trigger]')?.setAttribute('aria-expanded','false');});}
function positionPromotionMenu(trigger,dropdown){const rect=trigger.getBoundingClientRect();const width=190;const left=Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width));const roomBelow=window.innerHeight-rect.bottom;dropdown.style.left=`${left}px`;dropdown.style.top=roomBelow<210?`${Math.max(10,rect.top-dropdown.offsetHeight-6)}px`:`${rect.bottom+6}px`;}
function bindPromotionMenuInteractions(){if(menuInteractionsBound)return;menuInteractionsBound=true;document.addEventListener('click',event=>{if(!event.target.closest('[data-promotion-menu]'))closePromotionMenus();});document.addEventListener('keydown',event=>{const openMenu=document.querySelector('[data-promotion-menu] .promotion-action-dropdown:not(.hidden)');if(!openMenu)return;if(event.key==='Escape'){const trigger=openMenu.closest('[data-promotion-menu]')?.querySelector('[data-promotion-menu-trigger]');closePromotionMenus();trigger?.focus();return;}if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const items=[...openMenu.querySelectorAll('[role="menuitem"]')];const current=Math.max(0,items.indexOf(document.activeElement));items[(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();});window.addEventListener('resize',closePromotionMenus);window.addEventListener('scroll',closePromotionMenus,true);}

function openDeleteConfirmation(item){Modal.open({title:'Xóa chương trình?',className:'promotion-delete-modal',body:`<div class="promotion-delete-dialog"><div class="promotion-delete-icon" aria-hidden="true">${renderIcon('trash')}</div><div><p>Chương trình chưa từng được sử dụng và có thể xóa vĩnh viễn.</p><strong>${escapeHtml(item.code)} · ${escapeHtml(item.name)}</strong></div></div><div id="promotion-delete-error" class="form-error hidden" role="alert"></div><div class="modal-actions"><button class="btn-secondary" type="button" data-delete-cancel>Hủy</button><button class="btn-danger" type="button" data-delete-confirm>${renderIcon('trash')}<span>Xóa chương trình</span></button></div>`});document.querySelector('[data-delete-cancel]')?.addEventListener('click',Modal.close);document.querySelector('[data-delete-confirm]')?.addEventListener('click',async event=>{const button=event.currentTarget;const error=document.getElementById('promotion-delete-error');setButtonBusy(button,true,{busyLabel:'Đang xóa...'});try{await PromotionService.deleteUnused(item.id);Modal.close();Toast.show('Đã xóa chương trình khuyến mãi.');load();}catch(deleteError){error.textContent=deleteError.code==='P0001'?'Không thể xóa chương trình đã phát sinh giao dịch.\nBạn có thể tạm ngưng chương trình này để ngừng sử dụng.':'Không thể xóa chương trình. Vui lòng tải lại dữ liệu và thử lại.';error.classList.remove('hidden');Toast.show(error.textContent,'error');setButtonBusy(button,false);}});}

function openForm(item = {}) { return openPromotionForm(item, load); }
function openDetails(item) {
  const uses = item.promotion_usages || [];
  const sum = key => uses.reduce((total, row) => total + Number(row[key] || 0), 0);
  const customers = new Set(uses.map(x => x.customer_id)).size;
  Modal.open({
    title: `Chi tiết ${item.code}`, className: 'promotion-detail-modal',
    body: `<section class="detail-summary"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || 'Thông tin chương trình ưu đãi')}</p></section>${DetailFields([
      ['Ưu đãi', promotionReward(item)], ['Áp dụng cho', promotionApplicability(item, scopeNames(item))],
      ['Thời gian (giờ Việt Nam)', promotionPeriod(item)], ['Trạng thái chương trình', item.is_active ? 'Đã bật' : 'Tạm dừng'], ['Hiệu lực hiện tại', status(item)],
      ['Giới hạn sử dụng', `${item.usage_limit_total ?? 'Không giới hạn'} lượt tổng · ${item.usage_limit_per_customer ?? 'Không giới hạn'} lượt/khách`],
      ['Lượt thành công', uses.length], ['Khách hàng', customers],
      ['Doanh thu trước giảm', formatCurrency(sum('subtotal_before_discount'))],
      ['Tổng giảm giá', formatCurrency(sum('discount_amount'))],
      ['Doanh thu sau giảm', formatCurrency(sum('final_amount'))],
      ['Tháng tặng', sum('total_bonus_months')],
    ])}`,
  });
}
function scopeNames(item) { return (item.scope_type === 'category' ? item.promotion_categories || [] : item.promotion_business_types || []).map(row => row.categories?.name || row.business_types?.name).filter(Boolean); }
function typeLabel(v){return{percentage:'Giảm theo %',fixed_amount:'Giảm số tiền',bonus_months:'Tặng tháng'}[v]||v;}function valueLabel(i){return i.discount_type==='percentage'?`${i.discount_value}%`:i.discount_type==='fixed_amount'?formatCurrency(i.discount_value):`+${i.discount_value} tháng`;}function period(i){return`${i.starts_at?formatDate(i.starts_at):'Ngay'} – ${i.ends_at?formatDate(i.ends_at):'Không giới hạn'}`;}function status(i,now=Date.now()){if(!i.is_active)return'Tạm ngưng';if(i.starts_at&&Date.parse(i.starts_at)>now)return'Sắp diễn ra';if(i.ends_at&&Date.parse(i.ends_at)<now)return'Hết hạn';return'Hoạt động';}function statusTone(i){return status(i)==='Hoạt động'?'active':status(i)==='Sắp diễn ra'?'warning':'inactive';}
