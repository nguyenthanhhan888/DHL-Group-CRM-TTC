import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { CategoryService } from '../services/CategoryService.js';
import { escapeHtml } from '../utils/html.js';

export function openCategoryForm({ category = null, onSaved } = {}) {
  const isEdit = Boolean(category?.id);

  Modal.open({
    title: isEdit ? 'Cập nhật danh mục' : 'Thêm danh mục',
    body: renderCategoryForm(category),
  });

  const form = document.getElementById('category-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormError();

    const validation = validateCategoryForm();
    if (!validation.valid) {
      showFormError(validation.message);
      return;
    }

    const saveButton = document.getElementById('category-save-button');
    setSaving(saveButton, true);

    try {
      const payload = readCategoryPayload();
      const result = isEdit
        ? await CategoryService.update(category.id, payload)
        : await CategoryService.create(payload);

      Modal.close();
      Toast.show(isEdit ? 'Đã cập nhật danh mục.' : 'Đã thêm danh mục.');
      await onSaved?.(result.data);
    } catch (error) {
      showFormError(error?.message || 'Không thể lưu danh mục vào Supabase.');
    } finally {
      setSaving(saveButton, false);
    }
  });
}

function renderCategoryForm(category) {
  const sortOrder = Number.isFinite(Number(category?.sort_order))
    ? Number(category.sort_order)
    : 0;

  return `
    <form id="category-form" class="modal-form" novalidate>
      <div id="category-form-error" class="form-error hidden"></div>
      <label class="form-group">
        <span>Tên danh mục *</span>
        <input class="form-control" id="category-name" type="text" value="${escapeHtml(category?.name || '')}" autocomplete="off" required />
      </label>
      <label class="form-group">
        <span>Mô tả</span>
        <textarea class="form-control" id="category-description" rows="3">${escapeHtml(category?.description || '')}</textarea>
      </label>
      <label class="form-group">
        <span>Thứ tự sắp xếp *</span>
        <input class="form-control" id="category-sort-order" type="number" min="0" step="1" value="${sortOrder}" required />
      </label>
      <label class="checkbox-field">
        <input id="category-is-active" type="checkbox" ${category?.is_active === false ? '' : 'checked'} />
        <span>Hoạt động</span>
      </label>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-category-cancel>Hủy</button>
        <button class="btn-primary" id="category-save-button" type="submit">Lưu</button>
      </div>
    </form>
  `;
}

function readCategoryPayload() {
  return {
    name: readValue('category-name'),
    description: optionalValue('category-description'),
    sort_order: Number(readValue('category-sort-order')),
    is_active: Boolean(document.getElementById('category-is-active')?.checked),
  };
}

function validateCategoryForm() {
  if (!readValue('category-name')) {
    return { valid: false, message: 'Tên danh mục là bắt buộc.' };
  }

  const sortOrder = Number(readValue('category-sort-order'));
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { valid: false, message: 'Thứ tự sắp xếp phải là số nguyên không âm.' };
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
  const element = document.getElementById('category-form-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearFormError() {
  const element = document.getElementById('category-form-error');
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
  if (event.target.matches('[data-category-cancel]')) {
    Modal.close();
  }
});
