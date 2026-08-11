import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { CustomerService } from '../services/CustomerService.js';
import { KioskService } from '../services/KioskService.js';
import { RegistrationService } from '../services/RegistrationService.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from './FacebookIdResolver.js';
import { bindCurrencyInput, formatCurrency, parseCurrencyInput } from '../utils/currency.js';
import { debounce } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';

const CUSTOMER_PAGE_SIZE = 50;
let customers = [];
let categories = [];
let businessTypes = [];
let preferredCustomerId = '';

export function openKioskForm({ customer = null, onSaved } = {}) {
  customers = [];
  categories = [];
  businessTypes = [];
  preferredCustomerId = customer?.id || '';

  Modal.open({
    title: 'Đăng ký thêm Kiosk',
    body: renderKioskForm(),
    className: 'modal-wide',
  });

  bindKioskForm(onSaved);
  loadInitialOptions();
}

function bindKioskForm(onSaved) {
  bindFacebookIdResolvers(document.getElementById('add-kiosk-form'));
  bindCurrencyInput(document.getElementById('add-kiosk-discount'));
  document.querySelector('[data-kiosk-cancel]')?.addEventListener('click', Modal.close);
  document.getElementById('add-kiosk-customer-search')?.addEventListener('input', debounce((event) => {
    loadCustomerOptions(event.target.value.trim());
  }, 300));

  document.getElementById('add-kiosk-category')?.addEventListener('change', renderBusinessTypeOptions);
  document.getElementById('add-kiosk-business-type-search')?.addEventListener('input', renderBusinessTypeOptions);
  document.getElementById('add-kiosk-business-type')?.addEventListener('change', updateKioskPreview);
  document.getElementById('add-kiosk-months')?.addEventListener('input', updateKioskPreview);
  document.getElementById('add-kiosk-discount')?.addEventListener('input', updateKioskPreview);

  document.getElementById('add-kiosk-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError();

    const validation = validateKioskForm();
    if (!validation.valid) {
      showFormError(validation.message);
      return;
    }

    const saveButton = document.getElementById('add-kiosk-save-button');
    setSaving(saveButton, true);

    try {
      const payload = readKioskPayload();
      if (await KioskService.isFacebookIdInUse(payload.kiosk.facebook_id)) {
        throw new Error('Facebook ID này đã tồn tại trong Kiosk hoặc yêu cầu đang chờ.');
      }
      const { data: nameWarnings } = await KioskService.findNameWarnings(payload.kiosk.facebook_name);
      if (nameWarnings.length && !confirm(
        `Cảnh báo: Có ${nameWarnings.length} Kiosk trùng tên Facebook. Bạn vẫn muốn tiếp tục?`,
      )) return;

      const result = await RegistrationService.submitExistingCustomerKiosk(payload);
      Modal.close();
      Toast.show('Đã tạo kiosk chờ xác nhận thanh toán.');
      await onSaved?.(result.data);
    } catch (error) {
      showFormError(error?.message || 'Không thể tạo kiosk.');
    } finally {
      setSaving(saveButton, false);
    }
  });
}

function renderKioskForm() {
  return `
    <form id="add-kiosk-form" class="modal-form" novalidate>
      <div id="add-kiosk-form-error" class="form-error hidden"></div>

      <div class="form-section-title">1. Chọn khách hàng</div>
      <label class="form-group">
        <span>Tìm khách hàng</span>
        <input class="form-control" id="add-kiosk-customer-search" type="search" placeholder="Tên Facebook, SĐT, Facebook ID" autocomplete="off" />
      </label>

      <label class="form-group">
        <span>Khách hàng *</span>
        <select class="form-control" id="add-kiosk-customer" required disabled>
          <option value="">Đang tải khách hàng...</option>
        </select>
      </label>

      <div class="form-section-title">2. Nhập thông tin Kiosk</div>
      <label class="form-group">
        <span>Tên Facebook *</span>
        <input class="form-control" id="add-kiosk-facebook-name" type="text" autocomplete="off" required />
      </label>

      ${FacebookIdResolverFields({
        urlId: 'add-kiosk-facebook-link',
        idId: 'add-kiosk-facebook-id',
        requiredUrl: true,
      })}

      <label class="form-group">
        <span>Số tháng *</span>
        <input class="form-control" id="add-kiosk-months" type="number" min="1" step="1" value="1" required />
      </label>

      <label class="form-group">
        <span>Link nhóm Facebook</span>
        <input class="form-control" id="add-kiosk-facebook-group-link" type="url" autocomplete="off" />
      </label>

      <div class="form-section-title">3. Chọn dịch vụ và tính tiền</div>
      <div class="form-row">
        <label class="form-group">
          <span>Danh mục *</span>
          <select class="form-control" id="add-kiosk-category" required disabled><option value="">Đang tải danh mục...</option></select>
        </label>
        <label class="form-group">
          <span>Tìm loại hình kinh doanh</span>
          <input class="form-control" id="add-kiosk-business-type-search" type="search" placeholder="Nhập tên loại hình..." autocomplete="off" />
        </label>
      </div>
      <label class="form-group">
        <span>Loại hình kinh doanh *</span>
        <select class="form-control" id="add-kiosk-business-type" required disabled><option value="">Chọn danh mục trước</option></select>
      </label>

      <div class="form-row">
        <label class="form-group"><span>Giảm giá</span><input class="form-control" id="add-kiosk-discount" type="text" inputmode="numeric" placeholder="0 VNĐ" /></label>
        <label class="form-group"><span>Lý do giảm giá</span><input class="form-control" id="add-kiosk-discount-reason" type="text" placeholder="Bắt buộc nếu có giảm giá" autocomplete="off" /></label>
      </div>

      <label class="form-group">
        <span>Ghi chú</span>
        <textarea class="form-control" id="add-kiosk-note" rows="3"></textarea>
      </label>

      <div class="renew-calculation" id="add-kiosk-preview">
        ${renderPreviewState('Chọn loại hình kinh doanh để tính tiền.')}
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-kiosk-cancel>Hủy</button>
        <button class="btn-primary" id="add-kiosk-save-button" type="submit">Tạo Kiosk</button>
      </div>
    </form>
  `;
}

async function loadInitialOptions() {
  await Promise.all([
    loadCustomerOptions(''),
    loadCategoryOptions(),
    loadBusinessTypeOptions(),
  ]);
  updateKioskPreview();
}

async function loadCustomerOptions(searchTerm) {
  const select = document.getElementById('add-kiosk-customer');
  if (!select) return;

  select.disabled = true;
  select.innerHTML = '<option value="">Đang tải khách hàng...</option>';

  try {
    const { data } = await CustomerService.list({
      searchTerm,
      sort: { column: 'facebook_name', ascending: true },
      pagination: { page: 1, pageSize: CUSTOMER_PAGE_SIZE },
    });
    customers = data || [];
    if (preferredCustomerId && !customers.some((item) => String(item.id) === String(preferredCustomerId))) {
      const { data: preferredCustomer } = await CustomerService.getById(preferredCustomerId);
      if (preferredCustomer?.id) customers.unshift(preferredCustomer);
    }
    renderCustomerOptions();
  } catch (error) {
    customers = [];
    select.innerHTML = '<option value="">Không tải được khách hàng</option>';
  } finally {
    select.disabled = Boolean(preferredCustomerId);
  }
}

async function loadCategoryOptions() {
  const select = document.getElementById('add-kiosk-category');
  if (!select) return;
  try {
    const { data } = await CategoryService.listActive();
    categories = data || [];
    select.innerHTML = `<option value="">Chọn danh mục</option>${categories.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
  } catch {
    select.innerHTML = '<option value="">Không tải được danh mục</option>';
  } finally {
    select.disabled = false;
  }
}

async function loadBusinessTypeOptions() {
  const select = document.getElementById('add-kiosk-business-type');
  if (!select) return;

  select.disabled = true;
  select.innerHTML = '<option value="">Đang tải loại hình kinh doanh...</option>';

  try {
    const { data } = await BusinessTypeService.listActive();
    businessTypes = data || [];
    renderBusinessTypeOptions();
  } catch (error) {
    businessTypes = [];
    select.innerHTML = '<option value="">Không tải được loại hình kinh doanh</option>';
  } finally {
    select.disabled = !readValue('add-kiosk-category');
  }
}

function renderCustomerOptions() {
  const select = document.getElementById('add-kiosk-customer');
  if (!select) return;

  select.innerHTML = `
    <option value="">Chọn khách hàng</option>
    ${customers.map((customer) => `
      <option value="${escapeHtml(customer.id)}">
        ${escapeHtml(customer.facebook_name || 'Không tên')} · ${escapeHtml(customer.phone || 'Không SĐT')}
      </option>
    `).join('')}
  `;
  if (preferredCustomerId) {
    select.value = preferredCustomerId;
    select.disabled = true;
    const search = document.getElementById('add-kiosk-customer-search');
    if (search) search.disabled = true;
  }
}

function renderBusinessTypeOptions() {
  const select = document.getElementById('add-kiosk-business-type');
  if (!select) return;
  const categoryId = readValue('add-kiosk-category');
  const searchTerm = readValue('add-kiosk-business-type-search').toLocaleLowerCase('vi');
  const options = businessTypes.filter((item) => (
    (!categoryId || String(item.category_id) === String(categoryId))
    && (!searchTerm || String(item.name || '').toLocaleLowerCase('vi').includes(searchTerm))
  ));

  select.innerHTML = `
    <option value="">${categoryId ? 'Chọn loại hình kinh doanh' : 'Chọn danh mục trước'}</option>
    ${options.map((businessType) => `
      <option value="${escapeHtml(businessType.id)}">
        ${escapeHtml(businessType.name || 'Không tên')} · ${formatCurrency(businessType.price_per_month || 0)}/tháng
      </option>
    `).join('')}
  `;
  select.disabled = !categoryId;
  updateKioskPreview();
}

function updateKioskPreview() {
  const previewElement = document.getElementById('add-kiosk-preview');
  if (!previewElement) return;

  const businessType = selectedBusinessType();
  if (!businessType) {
    previewElement.innerHTML = renderPreviewState('Chọn loại hình kinh doanh để tính tiền.');
    return;
  }

  try {
    const preview = RegistrationService.calculatePreview(businessType, {
      months: readNumber('add-kiosk-months'),
      discount: parseCurrencyInput(readValue('add-kiosk-discount')),
    });

    previewElement.innerHTML = `
      <div class="setting-item">
        <span class="setting-name">Ngày bắt đầu</span>
        <span class="setting-value">${escapeHtml(preview.startDate)}</span>
      </div>
      <div class="setting-item">
        <span class="setting-name">Ngày hết hạn</span>
        <span class="setting-value">${escapeHtml(preview.endDate)}</span>
      </div>
      <div class="setting-item">
        <span class="setting-name">Giá/tháng</span>
        <span class="setting-value">${formatCurrency(preview.pricePerMonth)}</span>
      </div>
      <div class="setting-item">
        <span class="setting-name">Tạm tính</span>
        <span class="setting-value">${formatCurrency(preview.subtotal)}</span>
      </div>
      <div class="setting-item">
        <span class="setting-name">Giảm giá</span>
        <span class="setting-value">${formatCurrency(preview.discount)}</span>
      </div>
      <div class="setting-item">
        <span class="setting-name">Thành tiền</span>
        <span class="setting-value">${formatCurrency(preview.totalAmount)}</span>
      </div>
    `;
  } catch (error) {
    previewElement.innerHTML = renderPreviewState(error?.message || 'Không thể tính tiền.');
  }
}

function renderPreviewState(message) {
  return `<div class="muted-text">${escapeHtml(message)}</div>`;
}

function readKioskPayload() {
  return {
    customerId: readValue('add-kiosk-customer'),
    businessTypeId: readValue('add-kiosk-business-type'),
    months: readNumber('add-kiosk-months'),
    discount: parseCurrencyInput(readValue('add-kiosk-discount')),
    discountReason: readValue('add-kiosk-discount-reason'),
    kiosk: {
      facebook_name: readValue('add-kiosk-facebook-name'),
      facebook_id: optionalValue('add-kiosk-facebook-id'),
      facebook_link: optionalValue('add-kiosk-facebook-link'),
      facebook_group_link: optionalValue('add-kiosk-facebook-group-link'),
      note: optionalValue('add-kiosk-note'),
    },
  };
}

function validateKioskForm() {
  if (!readValue('add-kiosk-customer')) {
    return { valid: false, message: 'Khách hàng là bắt buộc.' };
  }

  if (!readValue('add-kiosk-facebook-name')) {
    return { valid: false, message: 'Tên Facebook là bắt buộc.' };
  }
  if (!readValue('add-kiosk-facebook-link')) {
    return { valid: false, message: 'Link Facebook là bắt buộc.' };
  }
  if (!readValue('add-kiosk-facebook-id')) {
    return { valid: false, message: 'Facebook ID là bắt buộc.' };
  }
  if (!/^\d+$/.test(readValue('add-kiosk-facebook-id'))) {
    return { valid: false, message: 'Facebook ID phải là dạng số.' };
  }

  if (!readValue('add-kiosk-business-type')) {
    return { valid: false, message: 'Loại hình kinh doanh là bắt buộc.' };
  }

  if (!readValue('add-kiosk-category')) {
    return { valid: false, message: 'Danh mục là bắt buộc.' };
  }

  const months = readNumber('add-kiosk-months');
  if (!Number.isInteger(months) || months < 1) {
    return { valid: false, message: 'Số tháng phải là số nguyên lớn hơn 0.' };
  }

  const discount = parseCurrencyInput(readValue('add-kiosk-discount'));
  const businessType = selectedBusinessType();
  const subtotal = Number(businessType?.price_per_month || 0) * months;
  if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) {
    return { valid: false, message: 'Giảm giá phải từ 0 đến tạm tính.' };
  }
  if (discount > 0 && !readValue('add-kiosk-discount-reason')) {
    return { valid: false, message: 'Cần nhập lý do khi áp dụng giảm giá.' };
  }

  const facebookLink = optionalValue('add-kiosk-facebook-link');
  if (facebookLink && !isValidUrl(facebookLink)) {
    return { valid: false, message: 'Link Facebook không hợp lệ.' };
  }

  const groupLink = optionalValue('add-kiosk-facebook-group-link');
  if (groupLink && !isValidUrl(groupLink)) {
    return { valid: false, message: 'Link nhóm Facebook không hợp lệ.' };
  }

  return { valid: true };
}

function selectedBusinessType() {
  const id = readValue('add-kiosk-business-type');
  return businessTypes.find((businessType) => String(businessType.id) === String(id));
}

function readValue(id) {
  return String(document.getElementById(id)?.value || '').trim();
}

function optionalValue(id) {
  return readValue(id) || null;
}

function readNumber(id) {
  return Number(document.getElementById(id)?.value || 0);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

function setSaving(button, saving) {
  if (!button) return;
  button.disabled = saving;
  button.textContent = saving ? 'Đang lưu...' : 'Tạo Kiosk';
}

function showFormError(message) {
  const element = document.getElementById('add-kiosk-form-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearFormError() {
  const element = document.getElementById('add-kiosk-form-error');
  if (!element) return;
  element.textContent = '';
  element.classList.add('hidden');
}
