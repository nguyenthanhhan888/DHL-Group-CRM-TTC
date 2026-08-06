import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CustomerService } from '../services/CustomerService.js';
import { KioskService } from '../services/KioskService.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from './FacebookIdResolver.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const KIOSK_STATUSES = [
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'active', label: 'Hoạt động' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'suspended', label: 'Tạm ngưng' },
];

let state = {
  kiosk: null,
  customers: [],
  businessTypes: [],
  isEdit: false,
};

export function openKioskEditForm({ kiosk = null, onSaved } = {}) {
  state = {
    kiosk,
    customers: [],
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
  return `
    <form id="kiosk-edit-form" class="modal-form" novalidate>
      <div id="kiosk-edit-error" class="form-error hidden"></div>

      <div class="form-section-title">Thông tin Kiosk</div>
      <label class="form-group">
        <span>Tên Facebook *</span>
        <input class="form-control" id="kiosk-edit-name" value="${escapeHtml(state.kiosk?.facebook_name || '')}" required />
      </label>
      ${FacebookIdResolverFields({
        urlId: 'kiosk-edit-fb-link',
        idId: 'kiosk-edit-fb-id',
        urlAttributes: `value="${escapeHtml(state.kiosk?.facebook_link || '')}"`,
        idAttributes: `value="${escapeHtml(state.kiosk?.facebook_id || '')}" required`,
      })}
      <div class="form-row">
        <label class="form-group">
          <span>Trạng thái *</span>
          <select class="form-control" id="kiosk-edit-status">
            ${KIOSK_STATUSES.map((s) => `<option value="${s.value}" ${s.value === state.kiosk?.status ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="form-group">
        <span>Link nhóm Facebook</span>
        <input class="form-control" id="kiosk-edit-group-link" type="url" value="${escapeHtml(state.kiosk?.facebook_group_link || '')}" />
      </label>

      <div class="form-section-title">Chủ sở hữu</div>
      <label class="form-group">
        <span>Tìm khách hàng</span>
        <input class="form-control" id="kiosk-edit-customer-search" type="search" placeholder="Tên Facebook, SĐT..." />
      </label>
      <label class="form-group">
        <span>Khách hàng *</span>
        <select class="form-control" id="kiosk-edit-customer" required disabled><option>Đang tải...</option></select>
      </label>

      <div class="form-section-title">Thông tin dịch vụ</div>
      <div class="form-row">
        <label class="form-group">
          <span>Dịch vụ / Ngành hàng *</span>
          <select class="form-control" id="kiosk-edit-business-type" required disabled><option>Đang tải...</option></select>
        </label>
        <label class="form-group">
          <span>Tự động duyệt</span>
          <select class="form-control" id="kiosk-edit-auto-approve">
            <option value="true" ${state.kiosk?.auto_approve ? 'selected' : ''}>Có</option>
            <option value="false" ${!state.kiosk?.auto_approve ? 'selected' : ''}>Không</option>
          </select>
        </label>
      </div>
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

      <label class="form-group">
        <span>Ghi chú</span>
        <textarea class="form-control" id="kiosk-edit-note" rows="3">${escapeHtml(state.kiosk?.note || '')}</textarea>
      </label>
      
      ${state.isEdit ? `
      <label class="form-group">
        <span>Lý do thay đổi</span>
        <input class="form-control" id="kiosk-reason" type="text" autocomplete="off" />
      </label>
      ` : ''}

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
    loadBusinessTypes(),
  ]);
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
  const select = document.getElementById('kiosk-edit-business-type');
  if (!select) return;
  select.disabled = true;

  try {
    const { data } = await BusinessTypeService.listActive();
    state.businessTypes = data || [];
    select.innerHTML = `<option value="">Chọn dịch vụ</option>${state.businessTypes.map((bt) => `<option value="${bt.id}">${escapeHtml(bt.name)}</option>`).join('')}`;
    if (state.kiosk?.business_type_id) {
      select.value = state.kiosk.business_type_id;
    }
  } catch (error) {
    showError('Không thể tải danh sách dịch vụ.');
  } finally {
    select.disabled = false;
  }
}

function readPayload() {
  const businessTypeId = document.getElementById('kiosk-edit-business-type')?.value;
  const businessType = state.businessTypes.find((bt) => String(bt.id) === String(businessTypeId));
  return {
    facebook_name: document.getElementById('kiosk-edit-name')?.value.trim(),
    facebook_id: document.getElementById('kiosk-edit-fb-id')?.value.trim() || null,
    facebook_link: document.getElementById('kiosk-edit-fb-link')?.value.trim() || null,
    facebook_group_link: document.getElementById('kiosk-edit-group-link')?.value.trim() || null,
    customer_id: document.getElementById('kiosk-edit-customer')?.value || null,
    business_type_id: businessTypeId || null,
    category_id: businessType?.category_id || null,
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
  if (!payload.business_type_id) return { valid: false, message: 'Dịch vụ là bắt buộc.' };
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
