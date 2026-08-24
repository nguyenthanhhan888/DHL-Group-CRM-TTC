import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { CustomerService } from '../services/CustomerService.js';
import { KioskService } from '../services/KioskService.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from './FacebookIdResolver.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const KIOSK_STATUSES = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'active', label: 'Hoạt động' },
  { value: 'suspended', label: 'Tạm ngưng' },
  { value: 'inactive', label: 'Không hoạt động' },
  { value: 'warning', label: 'Sắp hết hạn — tự động theo ngày', disabled: true },
  { value: 'expired', label: 'Hết hạn — tự động theo ngày', disabled: true },
];

let state = {
  kiosk: null,
  customers: [],
  categories: [],
  businessTypes: [],
  isEdit: false,
};

export function openKioskEditForm({ kiosk = null, onSaved } = {}) {
  state = {
    kiosk,
    customers: [],
    categories: [],
    businessTypes: [],
    isEdit: Boolean(kiosk?.id),
  };

  Modal.open({
    title: state.isEdit ? 'Sửa thông tin Kiosk' : 'Tạo Kiosk mới',
    body: renderForm(),
    className: 'modal-wide',
  });

  loadInitialData();
  bindFormEvents(onSaved);
}

function renderForm() {
  const editableStatus = state.kiosk?.stored_status || state.kiosk?.status || 'pending';
  return `
    <form id="kiosk-edit-form" class="modal-form" novalidate>
      <div id="kiosk-edit-error" class="form-error hidden"></div>

      <section class="kiosk-edit-section" aria-labelledby="kiosk-edit-facebook-title">
      <div class="form-section-title" id="kiosk-edit-facebook-title">Facebook</div>
      <p class="field-helper">Thông tin nhận diện của Kiosk trên Facebook.</p>
      <label class="form-group">
        <span>Tên Kiosk / Facebook *</span>
        <input class="form-control" id="kiosk-edit-name" value="${escapeHtml(state.kiosk?.facebook_name || '')}" required />
      </label>
      ${FacebookIdResolverFields({
        urlId: 'kiosk-edit-fb-link',
        idId: 'kiosk-edit-fb-id',
        urlAttributes: `value="${escapeHtml(state.kiosk?.facebook_link || '')}"`,
        idAttributes: `value="${escapeHtml(state.kiosk?.facebook_id || '')}" required`,
      })}
      <label class="form-group">
        <span>Link nhóm Facebook</span>
        <input class="form-control" id="kiosk-edit-group-link" type="url" value="${escapeHtml(state.kiosk?.facebook_group_link || '')}" />
      </label>
      </section>

      <section class="kiosk-edit-section" aria-labelledby="kiosk-edit-customer-title">
      <div class="form-section-title" id="kiosk-edit-customer-title">Khách hàng</div>
      <p class="field-helper">Đổi khách hàng sẽ chuyển quan hệ sở hữu Kiosk và cần xác nhận riêng.</p>
      <label class="form-group">
        <span>Tìm khách hàng</span>
        <input class="form-control" id="kiosk-edit-customer-search" type="search" placeholder="Tên Facebook, SĐT..." />
      </label>
      <label class="form-group">
        <span>Khách hàng *</span>
        <select class="form-control" id="kiosk-edit-customer" required disabled><option>Đang tải...</option></select>
      </label>
      </section>

      <section class="kiosk-edit-section" aria-labelledby="kiosk-edit-classification-title">
      <div class="form-section-title" id="kiosk-edit-classification-title">Phân loại</div>
      <p class="field-helper">Chọn Danh mục trước, sau đó chọn Loại hình kinh doanh thuộc danh mục đó.</p>
      <div class="form-row">
        <label class="form-group">
          <span>Danh mục *</span>
          <select class="form-control" id="kiosk-edit-category" required disabled><option>Đang tải...</option></select>
        </label>
        <label class="form-group">
          <span>Loại hình kinh doanh *</span>
          <select class="form-control" id="kiosk-edit-business-type" required disabled><option>Chọn danh mục trước</option></select>
        </label>
      </div>
      </section>

      <section class="kiosk-edit-section" aria-labelledby="kiosk-edit-dates-title">
      <div class="form-section-title" id="kiosk-edit-dates-title">Thời hạn</div>
      <p class="field-helper">Chỉnh trực tiếp thời hạn Kiosk. Thao tác này không tạo giao dịch hoặc gia hạn.</p>
      <div class="form-row">
        <label class="form-group">
          <span>Ngày bắt đầu</span>
          <input class="form-control" id="kiosk-edit-start-date" type="date" value="${escapeHtml(state.kiosk?.start_date || '')}" />
        </label>
        <label class="form-group">
          <span>Ngày hết hạn</span>
          <input class="form-control" id="kiosk-edit-end-date" type="date" value="${escapeHtml(state.kiosk?.end_date || '')}" />
        </label>
      </div>
      </section>

      <section class="kiosk-edit-section" aria-labelledby="kiosk-edit-approval-title">
      <div class="form-section-title" id="kiosk-edit-approval-title">Duyệt và trạng thái</div>
      <div class="form-row">
        <label class="form-group">
          <span>Trạng thái hành chính *</span>
          <select class="form-control" id="kiosk-edit-status">
            ${KIOSK_STATUSES.map((s) => `<option value="${s.value}" ${s.value === editableStatus ? 'selected' : ''} ${s.disabled ? 'disabled' : ''}>${s.label}</option>`).join('')}
          </select>
          <span class="field-helper">Dùng “Tạm ngưng” để khóa Kiosk mà không thay đổi lịch sử thanh toán.</span>
        </label>
        <label class="form-group">
          <span>Tự động duyệt bài</span>
          <select class="form-control" id="kiosk-edit-auto-approve">
            <option value="true" ${state.kiosk?.auto_approve ? 'selected' : ''}>Có</option>
            <option value="false" ${!state.kiosk?.auto_approve ? 'selected' : ''}>Không</option>
          </select>
        </label>
      </div>
      </section>

      <section class="kiosk-edit-section" aria-labelledby="kiosk-edit-notes-title">
      <div class="form-section-title" id="kiosk-edit-notes-title">Ghi chú</div>
      <label class="form-group">
        <span>Ghi chú nội bộ</span>
        <textarea class="form-control" id="kiosk-edit-note" rows="3">${escapeHtml(state.kiosk?.note || '')}</textarea>
      </label>
      
      ${state.isEdit ? `
      <label class="form-group">
        <span>Lý do thay đổi</span>
        <input class="form-control" id="kiosk-reason" type="text" autocomplete="off" />
      </label>
      ` : ''}
      </section>

      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-cancel>Hủy</button>
        <button class="btn-primary" id="kiosk-edit-save" type="submit">Lưu thay đổi</button>
      </div>
    </form>
  `;
}

function bindFormEvents(onSaved) {
  bindFacebookIdResolvers(document.getElementById('kiosk-edit-form'));
  document.querySelector('#kiosk-edit-form [data-cancel]')?.addEventListener('click', Modal.close);
  document.getElementById('kiosk-edit-customer-search')?.addEventListener('input', debounce((event) => {
    loadCustomerOptions(event.target.value);
  }, 300));
  document.getElementById('kiosk-edit-category')?.addEventListener('change', () => {
    renderBusinessTypeOptions();
  });

  document.getElementById('kiosk-edit-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveButton = document.getElementById('kiosk-edit-save');
    setSaving(saveButton, true);
    clearError();

    try {
      const payload = readPayload();
      const reason = state.isEdit ? document.getElementById('kiosk-reason')?.value.trim() : 'Tạo kiosk mới';
      const validation = await validateForm(payload);
      if (!validation.valid) {
        return showError(validation.message);
      }

      if (state.isEdit && String(payload.customer_id) !== String(state.kiosk.customer_id)) {
        if (!confirm('Bạn có chắc chắn muốn đổi chủ sở hữu của Kiosk này?')) {
          return;
        }
        if (!reason) {
          return showError('Lý do thay đổi là bắt buộc khi đổi khách hàng của Kiosk.');
        }
      }

      const { data: nameWarnings } = await KioskService.findNameWarnings(
        payload.facebook_name,
        state.kiosk?.id,
      );
      if (nameWarnings.length && !confirm(
        `Cảnh báo: Có ${nameWarnings.length} Kiosk trùng tên Facebook. Bạn vẫn muốn tiếp tục?`,
      )) return;

      const result = state.isEdit
        ? await KioskService.update(state.kiosk.id, payload, reason, {
          confirmReassignment: String(payload.customer_id) !== String(state.kiosk.customer_id),
        })
        : await KioskService.create(payload, reason);

      Modal.close();
      Toast.show(state.isEdit ? 'Đã cập nhật Kiosk.' : 'Đã tạo Kiosk mới.');
      if (onSaved) await onSaved(result.data);

    } catch (error) {
      showError(error?.message || 'Lỗi không xác định.');
    } finally {
      setSaving(saveButton, false);
    }
  });
}

async function loadInitialData() {
  const customerId = state.kiosk?.customer_id;
  await Promise.all([
    loadCustomerOptions('', customerId),
    loadCategories(),
    loadBusinessTypes(),
  ]);
  renderBusinessTypeOptions(state.kiosk?.business_type_id);
}

async function loadCustomerOptions(searchTerm = '', initialId = null) {
  const select = document.getElementById('kiosk-edit-customer');
  if (!select) return;
  select.disabled = true;

  try {
    const { data } = await CustomerService.list({ searchTerm, pagination: { page: 1, pageSize: 50 } });
    state.customers = data || [];

    if (initialId && !state.customers.some((c) => String(c.id) === String(initialId))) {
      const { data: initialCustomer } = await CustomerService.getById(initialId);
      if (initialCustomer) state.customers.unshift(initialCustomer);
    }

    select.innerHTML = `<option value="">Chọn khách hàng</option>${state.customers.map((c) => `<option value="${c.id}">${escapeHtml(c.facebook_name)} · ${escapeHtml(c.phone)}</option>`).join('')}`;
    if (initialId) select.value = initialId;

  } catch (error) {
    showError('Không thể tải danh sách khách hàng.');
  } finally {
    select.disabled = false;
  }
}

async function loadBusinessTypes() {
  try {
    const { data } = await BusinessTypeService.listActive();
    state.businessTypes = data || [];
    if (state.kiosk?.business_type_id && !state.businessTypes.some((item) => String(item.id) === String(state.kiosk.business_type_id))) {
      const { data: current } = await BusinessTypeService.getById(state.kiosk.business_type_id);
      if (current) state.businessTypes.push(current);
    }
    renderBusinessTypeOptions(state.kiosk?.business_type_id);
  } catch (error) {
    showError('Không thể tải danh sách dịch vụ.');
  }
}

async function loadCategories() {
  const select = document.getElementById('kiosk-edit-category');
  if (!select) return;
  try {
    const { data } = await CategoryService.listActive();
    state.categories = data || [];
    if (state.kiosk?.category_id && !state.categories.some((item) => String(item.id) === String(state.kiosk.category_id))) {
      const { data: current } = await CategoryService.getById(state.kiosk.category_id);
      if (current) state.categories.push(current);
    }
    select.innerHTML = `<option value="">Chọn danh mục</option>${state.categories.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}`;
    select.value = state.kiosk?.category_id || '';
    select.disabled = false;
  } catch {
    showError('Không thể tải danh sách danh mục.');
  }
}

function renderBusinessTypeOptions(selectedId = '') {
  const select = document.getElementById('kiosk-edit-business-type');
  const categoryId = document.getElementById('kiosk-edit-category')?.value || '';
  if (!select) return;
  const options = state.businessTypes.filter((item) => String(item.category_id) === String(categoryId));
  select.innerHTML = `<option value="">${categoryId ? 'Chọn loại hình kinh doanh' : 'Chọn danh mục trước'}</option>${options.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}`;
  select.disabled = !categoryId;
  if (selectedId && options.some((item) => String(item.id) === String(selectedId))) select.value = selectedId;
}

function readPayload() {
  const businessTypeId = document.getElementById('kiosk-edit-business-type')?.value;
  return {
    facebook_name: document.getElementById('kiosk-edit-name')?.value.trim(),
    facebook_id: document.getElementById('kiosk-edit-fb-id')?.value.trim() || null,
    facebook_link: document.getElementById('kiosk-edit-fb-link')?.value.trim() || null,
    facebook_group_link: document.getElementById('kiosk-edit-group-link')?.value.trim() || null,
    customer_id: document.getElementById('kiosk-edit-customer')?.value || null,
    business_type_id: businessTypeId || null,
    category_id: document.getElementById('kiosk-edit-category')?.value || null,
    status: document.getElementById('kiosk-edit-status')?.value,
    start_date: document.getElementById('kiosk-edit-start-date')?.value || null,
    end_date: document.getElementById('kiosk-edit-end-date')?.value || null,
    auto_approve: document.getElementById('kiosk-edit-auto-approve')?.value === 'true',
    note: document.getElementById('kiosk-edit-note')?.value.trim() || null,
  };
}

async function validateForm(payload) {
  if (!payload.facebook_name) return { valid: false, message: 'Tên Facebook là bắt buộc.' };
  if (!payload.facebook_id) return { valid: false, message: 'Facebook ID là bắt buộc.' };
  if (!/^\d+$/.test(payload.facebook_id)) return { valid: false, message: 'Facebook ID phải là dạng số.' };
  if (!payload.customer_id) return { valid: false, message: 'Khách hàng là bắt buộc.' };
  if (!payload.category_id) return { valid: false, message: 'Danh mục là bắt buộc.' };
  if (!payload.business_type_id) return { valid: false, message: 'Dịch vụ là bắt buộc.' };
  const selectedBusinessType = state.businessTypes.find((item) => String(item.id) === String(payload.business_type_id));
  if (!selectedBusinessType || String(selectedBusinessType.category_id) !== String(payload.category_id)) {
    return { valid: false, message: 'Loại hình kinh doanh không thuộc danh mục đã chọn.' };
  }
  if (payload.facebook_link && !isValidUrl(payload.facebook_link)) {
    return { valid: false, message: 'Link Facebook không hợp lệ.' };
  }
  if (payload.facebook_group_link && !isValidUrl(payload.facebook_group_link)) {
    return { valid: false, message: 'Link nhóm Facebook không hợp lệ.' };
  }

  if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
    return { valid: false, message: 'Ngày hết hạn phải sau ngày bắt đầu.' };
  }

  const isFbIdInUse = await KioskService.isFacebookIdInUse(payload.facebook_id, state.kiosk?.id);
  if (isFbIdInUse) {
    return { valid: false, message: 'Facebook ID này đã tồn tại trong hệ thống (Kiosk hoặc Yêu cầu đăng ký).' };
  }

  return { valid: true };
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function showError(message) {
  const element = document.getElementById('kiosk-edit-error');
  if (element) { element.textContent = message; element.classList.remove('hidden'); }
}

function clearError() {
  const element = document.getElementById('kiosk-edit-error');
  if (element) { element.textContent = ''; element.classList.add('hidden'); }
}

function setSaving(button, isSaving) {
  if (!button) return;
  button.disabled = isSaving;
  button.textContent = isSaving ? 'Đang lưu...' : 'Lưu thay đổi';
}
