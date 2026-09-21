import { DetailFields } from '../components/DetailFields.js';
import { FilterBar } from '../components/FilterBar.js';
import { PageHeader } from '../components/PageHeader.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { PromotionService } from '../services/PromotionService.js';
import { CategoryService } from '../services/CategoryService.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
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

export function promotionDateDefaults(item = {}, now = new Date()) {
  if (item.id) return { starts_at: vietnamLocalDate(item.starts_at), ends_at: vietnamLocalDate(item.ends_at) };
  const current = vietnamLocalDate(now);
  return { starts_at: current, ends_at: current };
}
async function openForm(item={}){
  const dates = promotionDateDefaults(item);
  let categories=[];let businessTypes=[];try{[categories,businessTypes]=await Promise.all([CategoryService.list({pagination:{page:1,pageSize:1000}}).then(x=>x.data||[]),BusinessTypeService.list({pagination:{page:1,pageSize:1000}}).then(x=>x.data||[])]);}catch(error){return Toast.show(error.message||'Không thể tải phạm vi áp dụng.');}
  const selectedCategories=new Set((item.promotion_categories||[]).map(x=>String(x.category_id)));const selectedTypes=new Set((item.promotion_business_types||[]).map(x=>String(x.business_type_id)));
  Modal.open({title:item.id?'Sửa chương trình':'Tạo chương trình',className:'promotion-form-modal',body:`<form id="promotion-form" class="promotion-form"><p class="promotion-form-intro">Thiết lập ưu đãi, điều kiện và phạm vi áp dụng cho khách hàng.</p>
  ${formSection('1','Thông tin chương trình','Thông tin nhận diện hiển thị trong trang quản trị.',`<div class="promotion-form-grid promotion-form-grid--2"><label class="form-group"><span>Mã chương trình *</span><div class="promotion-code-control">${item.id?`<span aria-hidden="true">${renderIcon('lock')}</span>`:''}<input class="form-control" name="code" required maxlength="64" placeholder="Ví dụ: TRIAN2026" value="${escapeHtml(item.code||'')}" ${item.id?'readonly':''}></div>${item.id?'<small>Mã chương trình không thể thay đổi sau khi tạo.</small>':''}</label><label class="form-group"><span>Tên chương trình *</span><input class="form-control" name="name" required placeholder="Ví dụ: Tri ân khách hàng 2026" value="${escapeHtml(item.name||'')}"></label><label class="form-group promotion-grid-full"><span>Mô tả</span><textarea class="form-control" name="description" placeholder="Mô tả ngắn về chương trình ưu đãi">${escapeHtml(item.description||'')}</textarea></label></div>`)}
  ${formSection('2','Loại ưu đãi','Chọn cách tính và giá trị khách hàng nhận được.',`<div class="promotion-form-grid promotion-form-grid--2"><label class="form-group"><span>Loại ưu đãi</span><select class="form-control" name="discount_type"><option value="percentage">Giảm theo %</option><option value="fixed_amount">Giảm số tiền</option><option value="bonus_months">Tặng thêm tháng</option></select></label><label class="form-group promotion-value-field"><span data-discount-value-label>Phần trăm giảm (%) *</span><div class="promotion-input-with-suffix"><input class="form-control" name="discount_value" type="number" min="1" step="1" inputmode="numeric" required placeholder="Ví dụ: 20" value="${item.discount_value||''}"><span data-discount-value-suffix>%</span></div><small data-discount-value-helper>Ví dụ 20 = giảm 20%.</small></label><label class="form-group" data-max-discount><span>Giảm tối đa (VNĐ)</span><div class="promotion-input-with-suffix"><input class="form-control" name="max_discount_amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Ví dụ: 300000" value="${item.max_discount_amount||''}"><span>VNĐ</span></div></label></div>`)}
  ${formSection('3','Điều kiện áp dụng','Các điều kiện đều không bắt buộc; để trống nếu không giới hạn.',`<div class="promotion-form-grid promotion-form-grid--2">${numberField('Đơn tối thiểu (VNĐ)','minimum_order_amount',item,{placeholder:'Ví dụ: 500000',suffix:'VNĐ'})}${numberField('Số Kiosk tối thiểu','minimum_kiosk_count',item,{placeholder:'Ví dụ: 3',suffix:'Kiosk'})}${numberField('Số tháng đăng ký tối thiểu','minimum_months',item,{placeholder:'Ví dụ: 6',suffix:'tháng'})}</div>`)}
  ${formSection('4','Phạm vi áp dụng','Giới hạn theo danh mục hoặc loại hình kinh doanh khi cần.',`<label class="form-group"><span>Phạm vi</span><select class="form-control" name="scope_type"><option value="all">Tất cả ngành nghề</option><option value="category">Danh mục cụ thể</option><option value="business_type">Loại hình kinh doanh cụ thể</option></select></label><div class="scope-picker hidden" data-scope-picker="category">${scopePicker('Tìm danh mục','category_ids',categories,selectedCategories)}</div><div class="scope-picker hidden" data-scope-picker="business_type">${scopePicker('Tìm loại hình kinh doanh','business_type_ids',businessTypes,selectedTypes)}</div>`)}
  ${formSection('5','Giới hạn & thời gian','Theo giờ Việt Nam (UTC+7). Xóa thời gian để không giới hạn mốc tương ứng.',`<div class="promotion-form-grid promotion-form-grid--2">${numberField('Tổng số lượt','usage_limit_total',item,{placeholder:'Ví dụ: 100',helper:'Để trống = không giới hạn'})}${numberField('Số lượt / khách hàng','usage_limit_per_customer',item,{placeholder:'Ví dụ: 1',helper:'Để trống = không giới hạn'})}<label class="form-group"><span>Bắt đầu</span><input class="form-control" name="starts_at" type="datetime-local" value="${dates.starts_at}"></label><label class="form-group"><span>Kết thúc</span><input class="form-control" name="ends_at" type="datetime-local" value="${dates.ends_at}"></label></div>`)}
  <div id="promotion-form-error" class="form-error hidden" role="alert"></div><div class="modal-actions promotion-form-actions"><button class="btn-secondary" type="button" data-cancel>Hủy</button><button class="btn-primary" type="submit">Lưu chương trình</button></div></form>`});
  const form=document.getElementById('promotion-form');form.discount_type.value=item.discount_type||'percentage';form.scope_type.value=item.scope_type||'all';const syncDynamic=()=>{syncDiscountValueField(form);form.querySelector('[data-max-discount]').classList.toggle('hidden',form.discount_type.value!=='percentage');form.querySelectorAll('[data-scope-picker]').forEach(node=>node.classList.toggle('hidden',node.dataset.scopePicker!==form.scope_type.value));};form.discount_type.addEventListener('change',syncDynamic);form.scope_type.addEventListener('change',syncDynamic);form.querySelectorAll('[data-scope-search]').forEach(input=>input.addEventListener('input',()=>filterScope(input)));form.querySelectorAll('.scope-picker').forEach(picker=>{picker.addEventListener('change',()=>renderSelectedScopeChips(picker));picker.addEventListener('click',event=>{const remove=event.target.closest('[data-remove-scope]');if(!remove)return;const checkbox=[...picker.querySelectorAll('input[type="checkbox"]')].find(input=>input.value===remove.dataset.removeScope);if(checkbox)checkbox.checked=false;renderSelectedScopeChips(picker);});renderSelectedScopeChips(picker);});syncDynamic();
  form.discount_value.addEventListener('input',()=>form.discount_value.setCustomValidity(''));form.discount_value.addEventListener('invalid',()=>form.discount_value.setCustomValidity(discountValueValidationMessage(form.discount_type.value,form.discount_value.value)));form.querySelector('[data-cancel]')?.addEventListener('click',Modal.close);form.addEventListener('submit',async event=>{event.preventDefault();const validationMessage=discountValueValidationMessage(form.discount_type.value,form.discount_value.value);if(validationMessage){form.discount_value.setCustomValidity(validationMessage);form.discount_value.reportValidity();Toast.show(validationMessage,'warning');return;}const payload=Object.fromEntries(new FormData(form));const categoryIds=[...form.querySelectorAll('[name="category_ids"]:checked')].map(x=>x.value);const typeIds=[...form.querySelectorAll('[name="business_type_ids"]:checked')].map(x=>x.value);const error=document.getElementById('promotion-form-error');const submitButton=form.querySelector('[type="submit"]');setButtonBusy(submitButton,true,{busyLabel:'Đang lưu...'});try{await PromotionService.save(payload,categoryIds,typeIds,item.id||null);Modal.close();Toast.show('Đã lưu chương trình khuyến mãi.');load();}catch{error.textContent='Không thể lưu chương trình. Vui lòng kiểm tra thông tin và thử lại.';error.classList.remove('hidden');Toast.show(error.textContent,'error');}finally{setButtonBusy(submitButton,false);}});
}
function formSection(number,title,helper,content){return `<section class="promotion-form-section"><header><span>${number}</span><div><h3>${title}</h3><p>${helper}</p></div></header>${content}</section>`;}
function scopePicker(placeholder,name,items,selected){return `<div class="scope-selected" data-scope-selected aria-live="polite"></div><label class="form-group"><span class="sr-only">${placeholder}</span><input class="form-control" type="search" data-scope-search placeholder="${placeholder}" autocomplete="off"></label><div class="scope-options">${items.map(option=>`<label class="scope-option" data-scope-label="${escapeHtml(String(option.name||'').toLocaleLowerCase('vi'))}"><input type="checkbox" name="${name}" value="${option.id}" data-scope-name="${escapeHtml(option.name)}" ${selected.has(String(option.id))?'checked':''}><span><strong>${escapeHtml(option.name)}</strong>${option.is_active===false?'<small>Không hoạt động · giữ lại cấu hình hiện tại</small>':''}</span></label>`).join('')}</div>`;}
function renderSelectedScopeChips(picker){const selected=[...picker.querySelectorAll('input[type="checkbox"]:checked')];picker.querySelector('[data-scope-selected]').innerHTML=selected.length?selected.map(input=>`<button class="scope-chip" type="button" data-remove-scope="${escapeHtml(input.value)}"><span>${escapeHtml(input.dataset.scopeName)}</span><b aria-hidden="true">×</b><span class="sr-only">Bỏ chọn</span></button>`).join(''):'<small>Chưa chọn mục cụ thể.</small>';}
function filterScope(input){const query=input.value.trim().toLocaleLowerCase('vi');input.closest('.scope-picker').querySelectorAll('[data-scope-label]').forEach(item=>item.classList.toggle('hidden',!item.dataset.scopeLabel.includes(query)));}
function openDetails(item) {
  const uses = item.promotion_usages || [];
  const sum = key => uses.reduce((total, row) => total + Number(row[key] || 0), 0);
  const customers = new Set(uses.map(x => x.customer_id)).size;
  Modal.open({
    title: `Chi tiết ${item.code}`, className: 'promotion-detail-modal',
    body: `<section class="detail-summary"><h3>${escapeHtml(item.name)}</h3><p>Phạm vi: ${scopeSummary(item)}</p></section>${DetailFields([
      ['Lượt thành công', uses.length], ['Khách hàng', customers],
      ['Doanh thu trước giảm', formatCurrency(sum('subtotal_before_discount'))],
      ['Tổng giảm giá', formatCurrency(sum('discount_amount'))],
      ['Doanh thu sau giảm', formatCurrency(sum('final_amount'))],
      ['Tháng tặng', sum('total_bonus_months')],
    ])}`,
  });
}
function scopeSummary(item){if(item.scope_type==='all')return'Tất cả ngành nghề';const rows=item.scope_type==='category'?(item.promotion_categories||[]).map(x=>x.categories?.name):(item.promotion_business_types||[]).map(x=>x.business_types?.name);return rows.filter(Boolean).map(escapeHtml).join(', ')||'Chưa chọn';}
function syncDiscountValueField(form){const config={percentage:{label:'Phần trăm giảm (%)',placeholder:'Ví dụ: 20',suffix:'%',helper:'Ví dụ 20 = giảm 20%.'},fixed_amount:{label:'Số tiền giảm (VNĐ)',placeholder:'Ví dụ: 100000',suffix:'VNĐ',helper:'Số tiền được trừ trực tiếp trên tổng đơn hàng.'},bonus_months:{label:'Số tháng tặng thêm',placeholder:'Ví dụ: 2',suffix:'tháng',helper:'Ví dụ 2 = tặng thêm 2 tháng sử dụng. Khách vẫn thanh toán theo số tháng đăng ký và được cộng thêm số tháng ưu đãi.'}}[form.discount_type.value];form.querySelector('[data-discount-value-label]').textContent=`${config.label} *`;form.discount_value.placeholder=config.placeholder;form.querySelector('[data-discount-value-suffix]').textContent=config.suffix;form.querySelector('[data-discount-value-helper]').textContent=config.helper;form.discount_value.setCustomValidity('');}
function discountValueValidationMessage(type,value){if(Number(value)>0&&Number.isInteger(Number(value)))return'';return{percentage:'Phần trăm giảm phải lớn hơn 0.',fixed_amount:'Số tiền giảm phải lớn hơn 0.',bonus_months:'Vui lòng nhập số tháng tặng thêm.'}[type]||'Vui lòng nhập giá trị ưu đãi hợp lệ.';}
function numberField(label,name,item,{placeholder='',suffix='',helper=''}={}){const input=`<input class="form-control" name="${name}" type="number" min="1" step="1" inputmode="numeric" placeholder="${placeholder}" value="${item[name]??''}">`;return `<label class="form-group"><span>${label}</span>${suffix?`<div class="promotion-input-with-suffix">${input}<span>${suffix}</span></div>`:input}${helper?`<small>${helper}</small>`:''}</label>`;}
function typeLabel(v){return{percentage:'Giảm theo %',fixed_amount:'Giảm số tiền',bonus_months:'Tặng tháng'}[v]||v;}function valueLabel(i){return i.discount_type==='percentage'?`${i.discount_value}%`:i.discount_type==='fixed_amount'?formatCurrency(i.discount_value):`+${i.discount_value} tháng`;}function period(i){return`${i.starts_at?new Date(i.starts_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Ngay'} – ${i.ends_at?new Date(i.ends_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Không hạn'}`;}function status(i,now=Date.now()){if(!i.is_active)return'Tạm ngưng';if(i.starts_at&&Date.parse(i.starts_at)>now)return'Sắp diễn ra';if(i.ends_at&&Date.parse(i.ends_at)<now)return'Hết hạn';return'Hoạt động';}function statusTone(i){return status(i)==='Hoạt động'?'active':status(i)==='Sắp diễn ra'?'warning':'inactive';}function vietnamLocalDate(value){if(!value)return'';const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));const get=type=>parts.find(x=>x.type===type)?.value;return`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;}
