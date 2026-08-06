import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { escapeHtml } from '../utils/html.js';

export async function openBusinessTypeForm({ businessType = null, businessTypeId = '', onSaved } = {}) {
  const id = businessTypeId || businessType?.id || '';
  const isEdit = Boolean(id);

  try {
    const currentBusinessType = id
      ? (await BusinessTypeService.getById(id)).data
      : businessType;
    const categories = await loadCategoryOptions(currentBusinessType?.category_id);

    Modal.open({
      title: isEdit ? 'Cập nhật loại hình kinh doanh' : 'Thêm loại hình kinh doanh',
      body: renderBusinessTypeForm(currentBusinessType, categories),
    });

    bindBusinessTypeForm({
      id,
      isEdit,
      onSaved,
    });
  } catch (error) {
    Modal.open({
      title: isEdit ? 'Cập nhật loại hình kinh doanh' : 'Thêm loại hình kinh doanh',
      body: `
        <div class="form-error">${escapeHtml(error?.message || 'Không thể tải dữ liệu loại hình kinh doanh.')}</div>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-business-type-cancel>Đóng</button>
        </div>
      `,
    });
  }
}

function bindBusinessTypeForm({ id, isEdit, onSaved }) {
  const form = document.getElementById('business-type-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError();

    const validation = validateBusinessTypeForm();
    if (!validation.valid) {
      showFormError(validation.message);
      return;
    }

    const saveButton = document.getElementById('business-type-save-button');
    setSaving(saveButton, true);

    try {
      const payload = readBusinessTypePayload();
      const result = isEdit
        ? await BusinessTypeService.update(id, payload)
        : await BusinessTypeService.create(payload);

      Modal.close();
      Toast.show(isEdit ? 'Đã cập nhật loại hình kinh doanh.' : 'Đã thêm loại hình kinh doanh.');
      await onSaved?.(result.data);
    } catch (error) {
      showFormError(error?.message || 'Không thể lưu loại hình kinh doanh vào Supabase.');
    } finally {
      setSaving(saveButton, false);
    }
  });
}

async function loadCategoryOptions(selectedCategoryId) {
  const { data } = await CategoryService.listActive();
  const categories = [...(data || [])];

  if (
    selectedCategoryId
    && !categories.some((category) => String(category.id) === String(selectedCategoryId))
  ) {
    const { data: selectedCategory } = await CategoryService.getById(selectedCategoryId);
    if (selectedCategory) categories.push(selectedCategory);
  }

  return categories;
}

function renderBusinessTypeForm(businessType, categories) {
  const pricePerMonth = Number.isFinite(Number(businessType?.price_per_month))
    ? Number(businessType.price_per_month)
    : 0;
  const sortOrder = Number.isFinite(Number(businessType?.sort_order))
    ? Number(businessType.sort_order)
    : 0;

  return `
    <form id="business-type-form" class="modal-form" novalidate>
      <div id="business-type-form-error" class="form-error hidden"></div>
      <label class="form-group">
        <span>Danh mục *</span>
        <select class="form-control" id="business-type-category" required>
          <option value="">-- Chọn danh mục --</option>
          ${categories.map((category) => renderCategoryOption(category, businessType?.category_id)).join('')}
        </select>
      </label>
      <label class="form-group">
        <span>Tên loại hình *</span>
        <input class="form-control" id="business-type-name" type="text" value="${escapeHtml(businessType?.name || '')}" autocomplete="off" required />
      </label>
      <label class="form-group">
        <span>Giá theo tháng *</span>
        <input class="form-control" id="business-type-monthly-price" type="number" min="0" step="1000" value="${pricePerMonth}" required />
      </label>
      <label class="form-group">
        <span>Độ ưu tiên *</span>
        <input class="form-control" id="business-type-priority" type="number" min="0" step="1" value="${sortOrder}" required />
      </label>
      <label class="form-group">
        <span>Mô tả</span>
        <textarea class="form-control" id="business-type-description" rows="3">${escapeHtml(businessType?.description || '')}</textarea>
      </label>
      <label class="checkbox-field">
        <input id="business-type-is-active" type="checkbox" ${businessType?.is_active === false ? '' : 'checked'} />
        <span>Hoạt động</span>
      </label>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-business-type-cancel>Hủy</button>
        <button class="btn-primary" id="business-type-save-button" type="submit">Lưu</button>
      </div>
    </form>
  `;
}

function renderCategoryOption(category, selectedCategoryId) {
  const selected = String(category.id) === String(selectedCategoryId) ? 'selected' : '';
  const inactive = category.is_active === false ? ' (không hoạt động)' : '';
  return `<option value="${escapeHtml(category.id)}" ${selected}>${escapeHtml(category.name || 'Không tên')}${inactive}</option>`;
}

function readBusinessTypePayload() {
  return {
    category_id: readValue('business-type-category'),
    name: readValue('business-type-name'),
    description: optionalValue('business-type-description'),
    price_per_month: Number(readValue('business-type-monthly-price')),
    sort_order: Number(readValue('business-type-priority')),
    is_active: Boolean(document.getElementById('business-type-is-active')?.checked),
  };
}

function validateBusinessTypeForm() {
  if (!readValue('business-type-category')) {
    return { valid: false, message: 'Danh mục là bắt buộc.' };
  }

  if (!readValue('business-type-name')) {
    return { valid: false, message: 'Tên loại hình là bắt buộc.' };
  }

  const price = Number(readValue('business-type-monthly-price'));
  if (!Number.isFinite(price) || price < 0) {
    return { valid: false, message: 'Giá theo tháng phải là số không âm.' };
  }

  const priority = Number(readValue('business-type-priority'));
  if (!Number.isInteger(priority) || priority < 0) {
    return { valid: false, message: 'Độ ưu tiên phải là số nguyên không âm.' };
  }

  return { valid: true };
}

function readValue(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function optionalValue(id) {
  return readValue(id) || null;
}

function showFormError(message) {
  const element = document.getElementById('business-type-form-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearFormError() {
  const element = document.getElementById('business-type-form-error');
  if (!element) return;
  element.textContent = '';
  element.classList.add('hidden');
}

function setSaving(button, isSaving) {
  if (!button) return;
  button.disabled = isSaving;
  button.textContent = isSaving ? 'Đang lưu...' : 'Lưu';
}

document.addEventListener('click', (event) => {
  if (event.target.matches('[data-business-type-cancel]')) {
    Modal.close();
  }
});
