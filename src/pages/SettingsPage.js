import { PageHeader } from '../components/PageHeader.js';
import { ConnectionNotice } from '../components/ConnectionNotice.js';
import { settingsService } from '../services/SettingsService.js';
import { Toast } from '../components/Toast.js';
import { escapeHtml } from '../utils/html.js';

const fields = [
  { key: 'official_group_name', label: 'Tên nhóm chính thức', required: true },
  { key: 'group_url', label: 'URL nhóm chính', type: 'url' },
  { key: 'sub_group_url', label: 'URL nhóm cộng đồng / nhóm phụ', type: 'url' },
  { key: 'recruitment_group_url', label: 'URL nhóm tuyển dụng', type: 'url' },
  { key: 'fanpage_url', label: 'URL fanpage chính thức', type: 'url' },
  { key: 'zalo_url', label: 'Zalo hỗ trợ', placeholder: 'Số Zalo hoặc URL Zalo' },
  { key: 'support_phone', label: 'Số điện thoại liên hệ', type: 'tel' },
  { key: 'facebook_group_id', label: 'Facebook Group ID', inputmode: 'numeric', pattern: '[0-9]+' },
  { key: 'warning_days', label: 'Số ngày cảnh báo sắp hết hạn', type: 'number', min: '1', max: '365', required: true },
  { key: 'company_info', label: 'Thông tin đơn vị', type: 'textarea' },
  { key: 'business_info', label: 'Thông tin kinh doanh', type: 'textarea' },
  { key: 'system_settings', label: 'Cài đặt hệ thống khác', type: 'textarea' },
];

let currentSettings = {};

async function loadAndRenderSettings(outlet) {
  const container = outlet.querySelector('#settings-form-container');
  try {
    currentSettings = await settingsService.getSettings();
    container.innerHTML = renderForm();
    attachEventListeners(container);
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(error?.message || 'Không thể tải cài đặt.')}</p>
        <button class="btn-secondary" type="button" data-retry-settings>Thử lại</button>
      </div>
    `;
    container.querySelector('[data-retry-settings]')?.addEventListener('click', () => {
      container.innerHTML = '<p>Đang tải cài đặt...</p>';
      loadAndRenderSettings(outlet);
    });
  }
}

function renderForm() {
  return `
    <form id="settings-form">
      <h3>Thông tin & liên kết chính thức</h3>
      <div class="form-grid">${fields.slice(0, 8).map(renderSettingInput).join('')}</div>

      <h3>Cảnh báo & thông tin tổ chức</h3>
      <div class="form-grid">${fields.slice(8).map(renderSettingInput).join('')}</div>

      <label class="form-group">
        <span>Lý do thay đổi</span>
        <input class="form-control" name="reason" maxlength="300" value="Cập nhật cài đặt tổ chức" required />
      </label>

      <div class="form-actions">
        <button type="submit" class="btn-primary" data-save-settings>Lưu thay đổi</button>
        <span class="muted-text" data-settings-status aria-live="polite"></span>
      </div>
    </form>
  `;
}

function renderSettingInput(field) {
  const value = escapeHtml(currentSettings[field.key] ?? '');
  const attributes = [
    field.required ? 'required' : '',
    field.min ? `min="${field.min}"` : '',
    field.max ? `max="${field.max}"` : '',
    field.pattern ? `pattern="${field.pattern}"` : '',
    field.inputmode ? `inputmode="${field.inputmode}"` : '',
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
  ].filter(Boolean).join(' ');
  const input = field.type === 'textarea'
    ? `<textarea id="${field.key}" name="${field.key}" rows="3" class="form-control" ${attributes}>${value}</textarea>`
    : `<input type="${field.type || 'text'}" id="${field.key}" name="${field.key}" value="${value}" class="form-control" ${attributes}>`;

  return `<label class="form-group"><span>${field.label}</span>${input}</label>`;
}

function attachEventListeners(container) {
  container.querySelector('#settings-form')?.addEventListener('submit', handleFormSubmit);
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const submitButton = form.querySelector('[data-save-settings]');
  const status = form.querySelector('[data-settings-status]');
  const formData = new FormData(form);
  const reason = String(formData.get('reason') || '').trim();
  const updatedSettings = Object.fromEntries(fields.map(({ key }) => [key, String(formData.get(key) || '').trim()]));

  submitButton.disabled = true;
  submitButton.textContent = 'Đang lưu...';
  status.textContent = '';
  try {
    currentSettings = await settingsService.updateSettings(updatedSettings, reason);
    status.textContent = 'Đã lưu.';
    Toast.show('Cập nhật cài đặt thành công.');
  } catch (error) {
    status.textContent = 'Chưa lưu được thay đổi.';
    Toast.show(error?.message || 'Cập nhật cài đặt thất bại.');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Lưu thay đổi';
  }
}

export function SettingsPage() {
  return `
    ${PageHeader({
      title: 'Cài đặt',
      description: 'Quản lý thông tin tổ chức, liên kết liên hệ và thời gian cảnh báo dùng chung.',
    })}
    ${ConnectionNotice()}
    <div class="settings-page">
      <section class="admin-card">
        <div id="settings-form-container"><p>Đang tải cài đặt...</p></div>
      </section>
    </div>
  `;
}

SettingsPage.afterRender = ({ outlet }) => {
  loadAndRenderSettings(outlet);
};
