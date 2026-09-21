import { EmptyState } from '../components/EmptyState.js';
import { Modal } from '../components/Modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { Toast } from '../components/Toast.js';
import { HomepageContentService } from '../services/HomepageContentService.js';
import { setButtonBusy } from '../utils/buttonState.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';

const SECTION_OPTIONS = [
  ['featured_businesses', 'Doanh nghiệp nổi bật'], ['kiosk_services', 'Dịch vụ Kiosk'],
  ['posting_rules', 'Quy tắc đăng bài'], ['community_links', 'Hệ thống cộng đồng'], ['contact', 'Liên hệ Admin'],
];
const COMMUNITY_DEFAULTS = [
  ['primary', 'Group chính'], ['community', 'Group cộng đồng'], ['recruitment', 'Group tuyển dụng'], ['fanpage', 'Fanpage Admin'],
];
const state = { content: null, businesses: [], loading: false };

export function HomepageContentPage() {
  return `<div class="homepage-admin-page">
    ${PageHeader({ title: 'Website công khai', description: 'Nguồn nội dung duy nhất cho trang công khai và footer.', actions: '<a class="btn-secondary" href="#/home" target="_blank" rel="noopener">Xem trang công khai</a>' })}
    ${HomepageContentAdmin()}
  </div>`;
}

export function HomepageContentAdmin() {
  return '<div id="homepage-admin-content"><div class="admin-card homepage-admin-loading" role="status">Đang tải nội dung trang chủ...</div></div>';
}

export function mountHomepageContentAdmin() {
  return loadAdminContent();
}

HomepageContentPage.afterRender = () => mountHomepageContentAdmin();

async function loadAdminContent() {
  const container = document.getElementById('homepage-admin-content');
  if (!container || state.loading) return;
  state.loading = true;
  try {
    const data = await HomepageContentService.getAdminData();
    state.content = data.content;
    state.businesses = data.featuredBusinesses;
    container.innerHTML = renderAdminContent();
    bindAdminEvents(container);
  } catch (error) {
    container.innerHTML = `${EmptyState({ title: 'Không thể tải nội dung trang chủ', message: error?.message || 'Vui lòng thử lại.' })}<div class="homepage-admin-retry"><button class="btn-secondary" type="button" data-homepage-admin-retry>Thử lại</button></div>`;
    container.querySelector('[data-homepage-admin-retry]')?.addEventListener('click', loadAdminContent);
  } finally {
    state.loading = false;
  }
}

function renderAdminContent() {
  const content = state.content || {};
  return `<div class="homepage-admin-tabs" role="tablist"><button class="active" type="button" data-homepage-tab="overview">Tổng quan</button><button type="button" data-homepage-tab="businesses">Doanh nghiệp nổi bật</button></div><div data-homepage-panel="overview"><form id="homepage-content-form" class="homepage-content-form">
    <section class="settings-section"><div class="settings-section-head"><h3>Hero</h3><p>Nội dung đầu tiên khách truy cập nhìn thấy.</p></div><div class="form-grid">
      ${input('heroTitle', 'Tiêu đề', content.heroTitle, { required: true })}
      ${input('heroImageUrl', 'URL banner / hình ảnh', content.heroImageUrl, { type: 'url-or-path' })}
      ${textarea('heroSubtitle', 'Mô tả ngắn', content.heroSubtitle, 3, true)}
      ${input('heroGroupCtaLabel', 'Nhãn CTA Group', content.heroGroupCtaLabel, { required: true })}
      ${input('heroGroupCtaUrl', 'URL Group', content.heroGroupCtaUrl, { type: 'url', required: true })}
      ${input('heroKioskCtaLabel', 'Nhãn CTA Kiosk', content.heroKioskCtaLabel, { required: true })}
      ${input('heroKioskCtaRoute', 'Route CTA Kiosk', content.heroKioskCtaRoute, { required: true, pattern: '#/[a-z0-9-]+' })}
    </div></section>
    <section class="settings-section"><div class="settings-section-head"><h3>Quy tắc đăng bài</h3><p>Mỗi dòng được hiển thị thành một quy tắc ngắn.</p></div>${textarea('postingRules', 'Nội dung', content.postingRules, 7, true)}</section>
    <section class="settings-section"><div class="settings-section-head"><h3>Liên hệ Admin</h3><p>Thông tin công khai; không nhập token hoặc cấu hình bí mật.</p></div><div class="form-grid">
      ${input('zalo1Label', 'Zalo 1 – nhãn', content.zaloContacts?.[0]?.label)}${input('zalo1Url', 'Zalo 1 – URL', content.zaloContacts?.[0]?.url, { type: 'url' })}
      ${input('zalo2Label', 'Zalo 2 – nhãn', content.zaloContacts?.[1]?.label)}${input('zalo2Url', 'Zalo 2 – URL', content.zaloContacts?.[1]?.url, { type: 'url' })}
      ${input('hotlineLabel', 'Hotline hiển thị', content.hotlineLabel, { required: true })}${input('hotlineNumber', 'Số gọi hotline', content.hotlineNumber, { type: 'tel', required: true })}
      ${input('fanpageLabel', 'Tên Fanpage', content.fanpageLabel, { required: true })}${input('fanpageUrl', 'URL Fanpage', content.fanpageUrl, { type: 'url', required: true })}
    </div></section>
    <section class="settings-section"><div class="settings-section-head"><h3>Hệ thống cộng đồng</h3><p>Sửa tên, URL, trạng thái và thứ tự hiển thị.</p></div><div class="homepage-admin-link-list">${communityRows(content.communityLinks).map(renderCommunityAdminRow).join('')}</div></section>
    <section class="settings-section"><div class="settings-section-head"><h3>Hiển thị và thứ tự section</h3><p>Số nhỏ hơn được hiển thị trước.</p></div><div class="homepage-section-controls">${SECTION_OPTIONS.map(([key, label]) => renderSectionControl(key, label, content)).join('')}</div></section>
    <div class="homepage-admin-sticky-actions"><span data-homepage-save-status aria-live="polite"></span><button class="btn-primary" type="submit" data-save-homepage-content>Lưu nội dung trang chủ</button></div>
  </form></div>
  <section class="admin-card homepage-business-admin hidden" data-homepage-panel="businesses"><div class="homepage-business-admin-head"><div><h3>Doanh nghiệp nổi bật</h3><p>Quản lý các cửa hàng và dịch vụ xuất hiện trên trang công khai.</p></div><button class="btn-primary" type="button" data-add-featured-business>${renderIcon('plus')}<span>Thêm doanh nghiệp</span></button></div><div data-featured-business-list>${renderBusinessList()}</div></section>`;
}

function bindAdminEvents(container) {
  container.querySelector('#homepage-content-form')?.addEventListener('submit', saveHomepageContent);
  container.querySelector('[data-add-featured-business]')?.addEventListener('click', () => openBusinessForm());
  container.querySelector('[data-featured-business-list]')?.addEventListener('click', handleBusinessAction);
  container.querySelectorAll('[data-homepage-tab]').forEach((button) => button.addEventListener('click', () => {
    container.querySelectorAll('[data-homepage-tab]').forEach((item) => item.classList.toggle('active', item === button));
    container.querySelectorAll('[data-homepage-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.homepagePanel !== button.dataset.homepageTab));
  }));
}

async function saveHomepageContent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('[data-save-homepage-content]');
  const status = form.querySelector('[data-homepage-save-status]');
  const values = Object.fromEntries(new FormData(form));
  const links = COMMUNITY_DEFAULTS.map(([key]) => ({
    key, name: String(values[`community_${key}_name`] || '').trim(), url: key === 'primary' ? String(values.heroGroupCtaUrl || '').trim() : String(values[`community_${key}_url`] || '').trim(),
    enabled: form.elements[`community_${key}_enabled`].checked, display_order: Number(values[`community_${key}_order`] || 0),
  }));
  const sectionOrder = SECTION_OPTIONS.map(([key]) => [key, Number(values[`section_${key}_order`] || 0)]).sort((a, b) => a[1] - b[1]).map(([key]) => key);
  const content = {
    heroTitle: values.heroTitle, heroSubtitle: values.heroSubtitle, heroImageUrl: values.heroImageUrl,
    heroGroupCtaLabel: values.heroGroupCtaLabel, heroGroupCtaUrl: values.heroGroupCtaUrl,
    heroKioskCtaLabel: values.heroKioskCtaLabel, heroKioskCtaRoute: values.heroKioskCtaRoute,
    postingRules: values.postingRules,
    zaloContacts: [{ label: values.zalo1Label, url: values.zalo1Url }, { label: values.zalo2Label, url: values.zalo2Url }].filter((item) => item.label && item.url),
    hotlineLabel: values.hotlineLabel, hotlineNumber: values.hotlineNumber, fanpageLabel: values.fanpageLabel, fanpageUrl: values.fanpageUrl,
    communityLinks: links, sectionVisibility: Object.fromEntries(SECTION_OPTIONS.map(([key]) => [key, form.elements[`section_${key}_visible`].checked])), sectionOrder,
  };
  setButtonBusy(button, true, { busyLabel: 'Đang lưu...' }); status.textContent = '';
  try { await HomepageContentService.saveContent(content); state.content = content; status.textContent = 'Đã lưu.'; Toast.show('Đã cập nhật nội dung trang chủ.'); }
  catch (error) { status.textContent = 'Chưa lưu được.'; Toast.show(error?.message || 'Không thể lưu nội dung trang chủ.', 'error'); }
  finally { setButtonBusy(button, false); }
}

function renderBusinessList() {
  if (!state.businesses.length) return EmptyState({ title: 'Chưa có doanh nghiệp nổi bật', message: 'Thêm doanh nghiệp đầu tiên để hiển thị trên trang chủ.' });
  return `<div class="homepage-business-table-wrap"><table class="data-table homepage-business-table"><thead><tr><th>Doanh nghiệp</th><th>Danh mục</th><th>Thứ tự</th><th>Hiển thị</th><th>Thời gian</th><th>Thao tác</th></tr></thead><tbody>${state.businesses.map((item) => `<tr><td data-label="Doanh nghiệp"><strong>${escapeHtml(item.name)}</strong>${item.badge ? `<small>${escapeHtml(item.badge)}</small>` : ''}</td><td data-label="Danh mục">${escapeHtml(item.category)}</td><td data-label="Thứ tự">${item.displayOrder}</td><td data-label="Hiển thị"><button class="status-badge ${item.enabled ? 'status-active' : 'status-inactive'}" type="button" data-business-action="toggle" data-business-id="${item.id}">${item.enabled ? 'Đang hiện' : 'Đang ẩn'}</button></td><td data-label="Thời gian">${visibilityText(item)}</td><td data-label="Thao tác"><div class="expense-row-actions"><button class="table-action-button" type="button" data-business-action="edit" data-business-id="${item.id}">Sửa</button><button class="table-action-button is-danger" type="button" data-business-action="archive" data-business-id="${item.id}">Lưu trữ</button></div></td></tr>`).join('')}</tbody></table></div>`;
}

function handleBusinessAction(event) {
  const button = event.target.closest('[data-business-action]'); if (!button) return;
  const item = state.businesses.find((row) => String(row.id) === button.dataset.businessId); if (!item) return;
  if (button.dataset.businessAction === 'edit') openBusinessForm(item);
  else if (button.dataset.businessAction === 'archive') confirmArchiveBusiness(item);
  else toggleBusiness(item, button);
}

function openBusinessForm(item = {}) {
  Modal.open({ title: item.id ? 'Sửa doanh nghiệp nổi bật' : 'Thêm doanh nghiệp nổi bật', className: 'featured-business-modal', body: `<form id="featured-business-form" class="modal-form"><div class="form-grid">
    ${input('name', 'Tên doanh nghiệp', item.name, { required: true })}${input('category', 'Danh mục', item.category, { required: true })}
    <label class="form-group homepage-image-upload"><span>Ảnh / logo</span><input class="form-control" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><input name="imageUrl" type="hidden" value="${escapeHtml(item.imageUrl || '')}"><small class="field-helper">JPG, PNG, WebP hoặc GIF · tối đa 5 MB.</small><div class="homepage-upload-preview" data-upload-preview>${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="Xem trước ảnh ${escapeHtml(item.name || '')}">` : '<span>Chưa có ảnh</span>'}</div></label>${input('badge', 'Badge', item.badge, { placeholder: 'VD: Nổi bật' })}
    ${textarea('shortDescription', 'Mô tả ngắn', item.shortDescription, 3)}${textarea('address', 'Địa chỉ', item.address, 3)}
    ${input('facebookUrl', 'Facebook URL', item.facebookUrl, { type: 'url' })}${input('zaloContact', 'Zalo / liên hệ', item.zaloContact)}
    ${input('phone', 'Số điện thoại', item.phone, { type: 'tel' })}${input('displayOrder', 'Thứ tự', item.displayOrder ?? 0, { type: 'number', min: 0 })}
    ${input('visibilityStart', 'Hiển thị từ', item.visibilityStart, { type: 'datetime-local' })}${input('visibilityEnd', 'Hiển thị đến', item.visibilityEnd, { type: 'datetime-local' })}
    <label class="form-check homepage-business-enabled"><input type="checkbox" name="enabled" ${item.enabled !== false ? 'checked' : ''}><span>Hiển thị công khai</span></label>
    </div><div class="form-error hidden" data-business-form-error role="alert"></div><div class="modal-actions"><button class="btn-secondary" type="button" data-business-cancel>Hủy</button><button class="btn-primary" type="submit">${item.id ? 'Lưu thay đổi' : 'Thêm doanh nghiệp'}</button></div></form>` });
  const form = document.getElementById('featured-business-form');
  form?.querySelector('[data-business-cancel]')?.addEventListener('click', Modal.close);
  form?.elements.imageFile?.addEventListener('change', () => previewBusinessImage(form));
  form?.addEventListener('submit', (event) => saveBusiness(event, item.id));
}

async function saveBusiness(event, id) {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]'); const errorBox = form.querySelector('[data-business-form-error]');
  const values = Object.fromEntries(new FormData(form));
  const payload = { ...values, id: id || undefined, enabled: form.elements.enabled.checked, displayOrder: Number(values.displayOrder || 0) };
  delete payload.imageFile;
  setButtonBusy(button, true, { busyLabel: 'Đang lưu...' });
  try {
    const file = form.elements.imageFile?.files?.[0];
    if (file) payload.imageUrl = (await HomepageContentService.uploadBusinessImage(file)).publicUrl;
    await HomepageContentService.saveBusiness(payload); Modal.close(); Toast.show('Đã lưu doanh nghiệp nổi bật.'); await loadAdminContent();
  }
  catch (error) { errorBox.textContent = error?.message || 'Không thể lưu doanh nghiệp.'; errorBox.classList.remove('hidden'); }
  finally { setButtonBusy(button, false); }
}

function previewBusinessImage(form) {
  const file = form.elements.imageFile?.files?.[0];
  const target = form.querySelector('[data-upload-preview]');
  if (!file || !target) return;
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    form.elements.imageFile.value = '';
    target.innerHTML = '<span>File không hợp lệ</span>';
    return;
  }
  const url = URL.createObjectURL(file);
  target.innerHTML = `<img src="${escapeHtml(url)}" alt="Xem trước ảnh đã chọn">`;
  target.querySelector('img')?.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
}

async function toggleBusiness(item, button) {
  setButtonBusy(button, true, { busyLabel: 'Đang lưu...' });
  try { await HomepageContentService.saveBusiness({ ...item, enabled: !item.enabled }); Toast.show(item.enabled ? 'Đã ẩn doanh nghiệp.' : 'Đã hiển thị doanh nghiệp.'); await loadAdminContent(); }
  catch (error) { Toast.show(error?.message || 'Không thể đổi trạng thái.', 'error'); setButtonBusy(button, false); }
}

function confirmArchiveBusiness(item) {
  Modal.open({ title: 'Lưu trữ doanh nghiệp?', body: `<p><strong>${escapeHtml(item.name)}</strong> sẽ không còn xuất hiện trên trang công khai.</p><div class="modal-actions"><button class="btn-secondary" type="button" data-archive-cancel>Hủy</button><button class="btn-danger" type="button" data-archive-confirm>Lưu trữ</button></div>` });
  document.querySelector('[data-archive-cancel]')?.addEventListener('click', Modal.close);
  document.querySelector('[data-archive-confirm]')?.addEventListener('click', async (event) => { const button = event.currentTarget; setButtonBusy(button, true, { busyLabel: 'Đang lưu trữ...' }); try { await HomepageContentService.archiveBusiness(item.id); Modal.close(); Toast.show('Đã lưu trữ doanh nghiệp.'); await loadAdminContent(); } catch (error) { Toast.show(error?.message || 'Không thể lưu trữ.', 'error'); setButtonBusy(button, false); } });
}

function communityRows(rows = []) { return COMMUNITY_DEFAULTS.map(([key, label], index) => rows.find((item) => item.key === key) || { key, name: label, url: '', enabled: true, display_order: (index + 1) * 10 }); }
function renderCommunityAdminRow(item) { const key = item.key; const urlField = key === 'primary' ? '<input type="hidden" name="community_primary_url" value="">' : input(`community_${key}_url`, 'URL', item.url, { type: 'url', required: true }); return `<div class="homepage-admin-link-row"><input type="hidden" name="community_${key}_key" value="${escapeHtml(key)}">${input(`community_${key}_name`, 'Tên', item.name, { required: true })}${urlField}${input(`community_${key}_order`, 'Thứ tự', item.display_order ?? item.displayOrder ?? 0, { type: 'number', min: 0 })}<label class="form-check"><input type="checkbox" name="community_${key}_enabled" ${item.enabled !== false ? 'checked' : ''}><span>Hiển thị</span></label></div>`; }
function renderSectionControl(key, label, content) { const order = Math.max(1, content.sectionOrder?.indexOf(key) + 1 || SECTION_OPTIONS.findIndex(([value]) => value === key) + 1); return `<div class="homepage-section-control"><label class="form-check"><input type="checkbox" name="section_${key}_visible" ${content.sectionVisibility?.[key] !== false ? 'checked' : ''}><span>${escapeHtml(label)}</span></label><label><span>Thứ tự</span><input class="form-control" type="number" min="1" max="5" name="section_${key}_order" value="${order}" required></label></div>`; }
function visibilityText(item) { if (!item.visibilityStart && !item.visibilityEnd) return 'Không giới hạn'; return `${item.visibilityStart ? `Từ ${escapeHtml(item.visibilityStart.replace('T', ' '))}` : 'Từ ngay'}<br>${item.visibilityEnd ? `đến ${escapeHtml(item.visibilityEnd.replace('T', ' '))}` : 'không ngày kết thúc'}`; }

function input(name, label, value = '', options = {}) {
  const type = options.type === 'url-or-path' ? 'text' : options.type || 'text';
  return `<label class="form-group"><span>${escapeHtml(label)}</span><input class="form-control" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value ?? '')}" ${options.required ? 'required' : ''} ${options.min != null ? `min="${options.min}"` : ''} ${options.pattern ? `pattern="${escapeHtml(options.pattern)}"` : ''} ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ''}></label>`;
}
function textarea(name, label, value = '', rows = 3, required = false) { return `<label class="form-group"><span>${escapeHtml(label)}</span><textarea class="form-control" name="${escapeHtml(name)}" rows="${rows}" maxlength="5000" ${required ? 'required' : ''}>${escapeHtml(value ?? '')}</textarea></label>`; }
