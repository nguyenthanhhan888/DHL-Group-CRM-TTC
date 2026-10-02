import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { PromotionService } from '../services/PromotionService.js';
import { CategoryService } from '../services/CategoryService.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { setButtonBusy } from '../utils/buttonState.js';
import { promotionDraft, promotionDateDefaults, switchPromotionTimeMode, promotionPayload, promotionInstant, promotionErrors, promotionReward, promotionApplicability, promotionPeriod, promotionSaveError } from '../utils/promotionForm.js';

let opening = false;
export async function openPromotionForm(item = {}, onSaved = () => {}) {
  if (opening) return;
  opening = true;
  const outlet = document.getElementById('promotions-body');
  let categories, businessTypes;
  try {
    [categories, businessTypes] = await Promise.all([
      CategoryService.list({ pagination: { page: 1, pageSize: 1000 } }),
      BusinessTypeService.list({ pagination: { page: 1, pageSize: 1000 } }),
    ]);
  } catch (error) { Toast.show('Không thể tải phạm vi áp dụng. Vui lòng thử lại.', 'error'); return; }
  finally { opening = false; }
  if (outlet !== document.getElementById('promotions-body')) return;
  const draft = promotionDraft(item);
  const selectedCategories = new Set((item.promotion_categories || []).map(row => String(row.category_id)));
  const selectedTypes = new Set((item.promotion_business_types || []).map(row => String(row.business_type_id)));
  const categoryOptions = mergeSavedOptions(categories.data || [], item.promotion_categories, 'category_id', 'categories');
  const typeOptions = mergeSavedOptions(businessTypes.data || [], item.promotion_business_types, 'business_type_id', 'business_types');
  Modal.open({ title: item.id ? 'Sửa chương trình' : 'Tạo chương trình', className: 'promotion-form-modal', body: `
    <form id="promotion-form" class="promotion-form" novalidate>
      <div class="promotion-form-content">
        ${section('1','Thông tin chương trình',`<div class="promotion-form-grid promotion-form-grid--2">
          <label class="form-group"><span>Mã chương trình *</span><div class="promotion-code-control">${item.id ? `<span aria-hidden="true">${renderIcon('lock')}</span>` : ''}<input class="form-control" name="code" required maxlength="64" placeholder="Ví dụ: TRIAN2026" value="${escapeHtml(item.code || '')}" ${item.id ? 'readonly' : ''}></div>${item.id ? '<small>Mã chương trình không thể thay đổi sau khi tạo.</small>' : ''}</label>
          <label class="form-group"><span>Tên chương trình *</span><input class="form-control" name="name" required placeholder="Ví dụ: Tri ân khách hàng 2026" value="${escapeHtml(item.name || '')}"></label>
          <label class="form-group promotion-grid-full"><span>Mô tả</span><textarea class="form-control" name="description" rows="2" placeholder="Mô tả ngắn về chương trình ưu đãi">${escapeHtml(item.description || '')}</textarea></label>
        </div>`)}
        ${section('2','Ưu đãi',`<div class="promotion-form-grid promotion-form-grid--2">
          <label class="form-group"><span>Loại ưu đãi</span><select class="form-control" name="discount_type"><option value="percentage">Giảm theo %</option><option value="fixed_amount">Giảm số tiền</option><option value="bonus_months">Tặng thêm tháng</option></select></label>
          <label class="form-group"><span data-discount-value-label>Mức giảm (%) *</span><div class="promotion-input-with-suffix"><input class="form-control" name="discount_value" type="number" min="1" step="1" inputmode="numeric" required value="${escapeHtml(item.discount_value ?? '')}"><span data-discount-value-suffix>%</span></div></label>
          <label class="form-group" data-max-discount><span>Giảm tối đa (VNĐ)</span><input class="form-control" name="max_discount_amount" type="number" min="1" step="1" inputmode="numeric" placeholder="Không giới hạn" value="${escapeHtml(item.max_discount_amount ?? '')}"></label>
        </div><p class="promotion-section-note" data-discount-value-helper></p>`)}
        ${section('3','Áp dụng cho',`<p class="promotion-section-note">Đăng ký mới và gia hạn, khi đáp ứng các điều kiện bên dưới.</p>
          <label class="form-group"><span>Ngành nghề</span><select class="form-control" name="scope_type"><option value="all">Tất cả ngành nghề</option><option value="category">Danh mục cụ thể</option><option value="business_type">Loại hình kinh doanh cụ thể</option></select></label>
          <div class="scope-picker hidden" data-scope-picker="category">${scopePicker('Tìm danh mục','category_ids',categoryOptions,selectedCategories)}</div>
          <div class="scope-picker hidden" data-scope-picker="business_type">${scopePicker('Tìm loại hình kinh doanh','business_type_ids',typeOptions,selectedTypes)}</div>
          <div class="promotion-form-grid promotion-form-grid--2">
            ${numberField('Giá trị đơn tối thiểu (VNĐ)','minimum_order_amount',item,'0 — Không yêu cầu',0)}
            ${numberField('Số Kiosk tối thiểu trong đơn','minimum_kiosk_count',item,'Không yêu cầu')}
            ${numberField('Số tháng tối thiểu mỗi Kiosk','minimum_months',item,'Không yêu cầu')}
          </div>`)}
        ${section('4','Thời gian áp dụng',`<fieldset class="promotion-time-modes"><legend class="sr-only">Giới hạn thời gian</legend>
          <label><input type="radio" name="time_mode" value="timed" ${draft.time_mode === 'timed' ? 'checked' : ''}><span>Có thời hạn</span></label>
          <label><input type="radio" name="time_mode" value="unlimited" ${draft.time_mode === 'unlimited' ? 'checked' : ''}><span>Không giới hạn thời gian</span></label>
          </fieldset><p class="promotion-section-note">Giờ Việt Nam (UTC+7).</p>
          <div class="promotion-form-grid promotion-form-grid--2">
            <label class="form-group"><span>Bắt đầu</span><select class="form-control" name="start_mode"><option value="scheduled">Từ thời điểm chọn</option><option value="immediate">Bắt đầu ngay</option></select></label>
            <label class="form-group" data-start-date><span>Thời điểm bắt đầu *</span><input class="form-control" name="starts_at" type="datetime-local" step="any" value="${draft.starts_at}"></label>
            <label class="form-group" data-end-date><span>Kết thúc *</span><input class="form-control" name="ends_at" type="datetime-local" step="any" value="${draft.ends_at}"></label>
          </div><p class="promotion-section-note hidden" data-unlimited-note>Không có ngày kết thúc; vẫn giữ thời điểm bắt đầu đã chọn.</p>`)}
        ${section('5','Giới hạn sử dụng & trạng thái',`<div class="promotion-form-grid promotion-form-grid--2">
          ${numberField('Tổng lượt sử dụng','usage_limit_total',item,'Không giới hạn')}
          ${numberField('Lượt dùng mỗi khách','usage_limit_per_customer',item,'Không giới hạn')}
          ${item.id ? `<div class="form-group promotion-grid-full"><span>Trạng thái chương trình</span><strong>${item.is_active ? 'Đã bật' : 'Tạm dừng'}</strong><small>Bật hoặc tạm dừng tại danh sách chương trình.</small></div>` : '<label class="form-group"><span>Trạng thái chương trình</span><select class="form-control" name="is_active"><option value="true">Đã bật</option><option value="false">Tạm dừng</option></select></label>'}
        </div><p class="promotion-section-note">Chương trình đã bật chỉ áp dụng trong thời gian hiệu lực.</p>`)}
        <section class="promotion-preview" aria-label="Tóm tắt chương trình"><h3>Tóm tắt</h3><div data-promotion-preview aria-live="polite" aria-atomic="true"></div></section>
      </div>
      <div class="promotion-form-footer"><p id="promotion-form-error" class="form-error hidden" role="alert" tabindex="-1"></p><div class="modal-actions promotion-form-actions"><button class="btn-secondary" type="button" data-cancel>Hủy</button><button class="btn-primary" type="submit">Lưu chương trình</button></div></div>
    </form>` });
  const form = document.getElementById('promotion-form');
  for (const key of ['discount_type','scope_type','start_mode']) form.elements[key].value = draft[key];
  const selected = name => [...form.querySelectorAll(`[name="${name}"]:checked`)].map(input => input.value);
  const values = () => ({ ...Object.fromEntries(new FormData(form)), is_active: item.id ? item.is_active : form.elements.is_active.value });
  const sync = () => {
    const value = values();
    syncReward(form, value.discount_type);
    for (const node of form.querySelectorAll('[data-scope-picker]')) node.classList.toggle('hidden', node.dataset.scopePicker !== value.scope_type);
    const unlimited = value.time_mode === 'unlimited', immediate = value.start_mode === 'immediate';
    form.querySelector('[data-end-date]').classList.toggle('hidden', unlimited);
    form.querySelector('[data-start-date]').classList.toggle('hidden', immediate);
    form.querySelector('[data-unlimited-note]').classList.toggle('hidden', !unlimited);
    form.elements.ends_at.disabled = unlimited; form.elements.starts_at.disabled = immediate;
    const scope = value.scope_type === 'category' ? 'category_ids' : 'business_type_ids';
    const names = [...form.querySelectorAll(`[name="${scope}"]:checked`)].map(input => input.dataset.scopeName);
    const payload = promotionPayload(values(), item);
    let period = 'Chọn thời gian áp dụng';
    try { if (value.time_mode === 'timed' && !payload.ends_at) throw Error(); period = promotionPeriod({ starts_at: promotionInstant(payload.starts_at), ends_at: promotionInstant(payload.ends_at) }); } catch { /* Partial date while typing. */ }
    const limits = [value.usage_limit_total ? `Tối đa ${value.usage_limit_total} lượt` : 'Không giới hạn tổng lượt', value.usage_limit_per_customer ? `${value.usage_limit_per_customer} lượt/khách` : 'Không giới hạn lượt/khách'];
    form.querySelector('[data-promotion-preview]').innerHTML = [promotionReward(value), promotionApplicability(value,names), period, `${limits.join(' · ')} · ${payload.is_active ? 'Đã bật' : 'Tạm dừng'}`].map(text => `<p>${escapeHtml(text)}</p>`).join('');
  };
  form.addEventListener('input', () => { clearErrors(form); sync(); });
  form.addEventListener('change', event => {
    if (event.target.name === 'time_mode') {
      const next = switchPromotionTimeMode(values(), form.elements.time_mode.value);
      form.elements.starts_at.value = next.starts_at || ''; form.elements.ends_at.value = next.ends_at || '';
    }
    if (event.target.name === 'start_mode') form.elements.starts_at.value = event.target.value === 'immediate' ? '' : form.elements.starts_at.value || promotionDateDefaults().starts_at;
    clearErrors(form); sync();
  });
  form.querySelectorAll('[data-scope-search]').forEach(input => input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase('vi');
    input.closest('.scope-picker').querySelectorAll('[data-scope-label]').forEach(node => node.classList.toggle('hidden',!node.dataset.scopeLabel.includes(query)));
  }));
  form.querySelectorAll('.scope-picker').forEach(picker => {
    picker.addEventListener('change', () => renderChips(picker));
    picker.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-scope]'); if (!remove) return;
      const input = [...picker.querySelectorAll('input[type="checkbox"]')].find(node => node.value === remove.dataset.removeScope);
      if (input) input.checked = false; renderChips(picker); sync();
    }); renderChips(picker);
  });
  form.querySelector('[data-cancel]').addEventListener('click', Modal.close);
  let saving = false;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    clearErrors(form);
    const draft = values(), categoryIds = selected('category_ids'), typeIds = selected('business_type_ids');
    const errors = promotionErrors(draft,categoryIds,typeIds), first = Object.keys(errors)[0];
    const error = form.querySelector('#promotion-form-error');
    if (first) {
      error.textContent = errors[first]; error.classList.remove('hidden');
      for (const key of Object.keys(errors)) { const control = form.elements[key]; control?.setAttribute('aria-invalid','true'); control?.setAttribute('aria-describedby','promotion-form-error'); }
      form.elements[first]?.focus(); return;
    }
    saving = true;
    const button = form.querySelector('[type="submit"]'); setButtonBusy(button,true,{busyLabel:'Đang lưu...'});
    try {
      await PromotionService.save(promotionPayload(draft,item),categoryIds,typeIds,item.id || null);
      if (document.getElementById('promotion-form') === form) Modal.close();
      Toast.show('Đã lưu chương trình khuyến mãi.'); await onSaved();
    } catch (saveError) { error.textContent = promotionSaveError(saveError); error.classList.remove('hidden'); }
    finally { saving = false; setButtonBusy(button,false); }
  });
  sync(); form.elements.code.focus();
}

function section(number,title,content) { return `<section class="promotion-form-section"><header><span>${number}</span><h3>${title}</h3></header>${content}</section>`; }
function numberField(label,name,item,placeholder,minimum=1) { return `<label class="form-group"><span>${label}</span><input class="form-control" name="${name}" type="number" min="${minimum}" step="1" inputmode="numeric" placeholder="${placeholder}" value="${escapeHtml(item[name] ?? '')}"></label>`; }
function clearErrors(form) { form.querySelector('#promotion-form-error').classList.add('hidden'); form.querySelectorAll('[aria-invalid]').forEach(node => { node.removeAttribute('aria-invalid'); node.removeAttribute('aria-describedby'); }); }
function mergeSavedOptions(options, saved = [], idKey, relation) { const rows = [...options]; for (const row of saved || []) if (!rows.some(option => String(option.id) === String(row[idKey]))) rows.push({ id: row[idKey], name: row[relation]?.name || 'Mục đã chọn', is_active: row[relation]?.is_active ?? false }); return rows; }
function scopePicker(placeholder,name,items,selected) { return `<div class="scope-selected" data-scope-selected aria-live="polite"></div><label class="form-group"><span class="sr-only">${placeholder}</span><input class="form-control" type="search" data-scope-search placeholder="${placeholder}"></label><div class="scope-options">${items.map(option => `<label class="scope-option" data-scope-label="${escapeHtml(option.name.toLocaleLowerCase('vi'))}"><input type="checkbox" name="${name}" value="${option.id}" data-scope-name="${escapeHtml(option.name)}" ${selected.has(String(option.id)) ? 'checked' : ''}><span><strong>${escapeHtml(option.name)}</strong>${option.is_active === false ? '<small>Đang tạm ngưng</small>' : ''}</span></label>`).join('')}</div>`; }
function renderChips(picker) { const selected = [...picker.querySelectorAll('input:checked')]; picker.querySelector('[data-scope-selected]').innerHTML = selected.length ? selected.map(input => `<button class="scope-chip" type="button" data-remove-scope="${input.value}"><span>${escapeHtml(input.dataset.scopeName)}</span><b aria-hidden="true">×</b><span class="sr-only">Bỏ chọn</span></button>`).join('') : '<small>Chọn ít nhất một mục.</small>'; }
function syncReward(form,type) {
  const config = {
    percentage: ['Mức giảm (%)','Ví dụ: 20','%','Mức giảm được tính trên phần đơn đủ điều kiện.'],
    fixed_amount: ['Số tiền giảm (VNĐ)','Ví dụ: 100000','VNĐ','Số tiền giảm không vượt quá phần đơn đủ điều kiện.'],
    bonus_months: ['Số tháng tặng thêm','Ví dụ: 2','tháng','Khách trả tiền theo số tháng đăng ký; tháng tặng cộng thêm cho mỗi Kiosk đủ điều kiện.'],
  }[type];
  form.querySelector('[data-discount-value-label]').textContent = `${config[0]} *`;
  form.elements.discount_value.placeholder = config[1];
  if (type === 'percentage') form.elements.discount_value.max = '100'; else form.elements.discount_value.removeAttribute('max');
  form.querySelector('[data-discount-value-suffix]').textContent = config[2];
  form.querySelector('[data-discount-value-helper]').textContent = config[3];
  form.querySelector('[data-max-discount]').classList.toggle('hidden',type !== 'percentage');
  form.elements.max_discount_amount.disabled = type !== 'percentage';
}
