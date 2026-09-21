import { PageHeader } from '../components/PageHeader.js';
import { ConnectionNotice } from '../components/ConnectionNotice.js';
import { settingsService } from '../services/SettingsService.js';
import { Toast } from '../components/Toast.js';
import { escapeHtml } from '../utils/html.js';
import { HomepageContentAdmin, mountHomepageContentAdmin } from './HomepageContentPage.js';

const fields = [
  { key: 'facebook_group_id', label: 'Mã nhóm Facebook', inputmode: 'numeric', pattern: '[0-9]+', help: 'Dùng để tạo liên kết thành viên Facebook.' },
  { key: 'warning_days', label: 'Cảnh báo trước khi hết hạn', type: 'number', min: '1', max: '365', required: true, help: 'Số ngày dùng chung cho Dashboard, danh sách Kiosk và báo cáo.' },
  { key: 'company_info', label: 'Thông tin đơn vị', type: 'textarea' },
  { key: 'business_info', label: 'Thông tin kinh doanh', type: 'textarea' },
  { key: 'system_settings', label: 'Ghi chú vận hành', type: 'textarea', help: 'Thông tin nội bộ dành cho quản trị viên.' },
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
      <section class="settings-section"><div class="settings-section-head"><h3>Vận hành</h3><p>Cảnh báo hết hạn và thông tin quản trị.</p></div>
      <div class="form-grid">${fields.map(renderSettingInput).join('')}</div></section>

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

  return `<label class="form-group"><span>${field.label}</span>${input}${field.help ? `<small class="field-helper">${field.help}</small>` : ''}</label>`;
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
      description: 'Quản lý cấu hình vận hành và nội dung Website công khai tại một nơi.',
      actions: '<a class="btn-secondary" href="#/home" target="_blank" rel="noopener">Xem Website</a>',
    })}
    ${ConnectionNotice()}
    <div class="settings-page">
      <div class="settings-workspace-tabs" role="tablist" aria-label="Nhóm cài đặt">
        <button class="active" type="button" data-settings-workspace-tab="operations">Vận hành</button>
        <button type="button" data-settings-workspace-tab="website">Website công khai</button>
      </div>
      <section class="admin-card" data-settings-workspace-panel="operations">
        <div id="settings-form-container"><p>Đang tải cài đặt...</p></div>
      </section>
      <section class="hidden" data-settings-workspace-panel="website">${HomepageContentAdmin()}</section>
    </div>
  `;
}

SettingsPage.afterRender = ({ outlet }) => {
  loadAndRenderSettings(outlet);
  let websiteLoaded = false;
  outlet.querySelectorAll('[data-settings-workspace-tab]').forEach((button) => button.addEventListener('click', () => {
    const active = button.dataset.settingsWorkspaceTab;
    outlet.querySelectorAll('[data-settings-workspace-tab]').forEach((item) => item.classList.toggle('active', item === button));
    outlet.querySelectorAll('[data-settings-workspace-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.settingsWorkspacePanel !== active));
    if (active === 'website' && !websiteLoaded) { websiteLoaded = true; mountHomepageContentAdmin(); }
  }));
};
