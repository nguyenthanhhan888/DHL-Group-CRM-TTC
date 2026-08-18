import { PageHeader } from '../components/PageHeader.js';
import { PublicSupport } from '../components/PublicSupport.js';
import { fetchPayosStatus } from '../components/PayosResultCard.js';
import { Toast } from '../components/Toast.js';
import {
  bindFacebookIdResolvers,
  FacebookIdResolverFields,
  validateFacebookResolver,
} from '../components/FacebookIdResolver.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { RegistrationService } from '../services/RegistrationService.js';
import { settingsService } from '../services/SettingsService.js';
import { formatCurrency } from '../utils/currency.js';
import { duplicateValues, isValidPhone, setInlineError } from '../utils/formValidation.js';
import { escapeHtml } from '../utils/html.js';

const state = {
  categories: [],
  businessTypes: [],
  sequence: 0,
  submitting: false,
};

export function RegisterPage() {
  resetState();
  return `
    <div class="public-form-flow">
    ${PageHeader({
      title: 'Đăng ký Kiosk trực tuyến',
      description: 'Đăng ký một hoặc nhiều Kiosk và thanh toán an toàn qua PayOS.',
    })}
    <section class="form-card registration-card">
      <form id="public-registration-form" novalidate>
        <div id="registration-form-error" class="form-error hidden" role="alert"></div>
        <div class="form-section-title">Thông tin liên hệ</div>
        <div class="form-row">
          ${field('Tên Facebook', 'register-contact-name', { required: true, autocomplete: 'name' })}
          <input id="register-facebook-name" type="hidden">
        </div>
        <div class="form-row">
          ${field('Số điện thoại', 'register-phone', { required: true, type: 'tel', inputmode: 'tel', autocomplete: 'tel' })}
          ${field('Địa chỉ', 'register-address', {})}
        </div>
        ${field('Ghi chú chung', 'register-note', { textarea: true })}

        <div class="registration-list-heading">
          <div>
            <div class="form-section-title">Danh sách Kiosk</div>
            <p class="muted-text">Mỗi Kiosk có Facebook ID, danh mục, gói và giá riêng.</p>
          </div>
        </div>
        <div id="register-kiosk-list"></div>
        <div class="registration-add-row">
          <button class="btn-secondary register-add-kiosk-bottom" id="register-add-kiosk-button" type="button">+ Thêm Kiosk</button>
          <span class="field-helper">Nhập xong Kiosk hiện tại rồi bấm để thêm Kiosk tiếp theo.</span>
        </div>
        <div class="registration-total-sticky">
          <span>Tổng đăng ký (<strong id="register-kiosk-count">1</strong> Kiosk)</span>
          <strong id="register-total-amount">0 VNĐ</strong>
        </div>
        <div class="registration-actions">
          <button class="btn-primary" id="register-submit-button" type="submit">Gửi đăng ký</button>
        </div>
      </form>
      <div id="registration-success" class="registration-success hidden" aria-live="polite"></div>
    </section>
    ${PublicSupport()}
    </div>
  `;
}

RegisterPage.afterRender = async function afterRenderRegister() {
  if (await handleRegistrationReturn()) return;
  addKiosk({ announce: false, focusNewCard: false });
  bindEvents();
  settingsService.getPublicSettings().catch(() => null);
  await loadOptions();
};

function bindEvents() {
  document.getElementById('register-contact-name')?.addEventListener('input', syncSingleKioskIdentity);
  document.getElementById('register-add-kiosk-button')?.addEventListener('click', addKiosk);
  document.getElementById('register-kiosk-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-kiosk]');
    if (!button) return;
    if (document.querySelectorAll('[data-register-kiosk]').length <= 1) {
      showFormError('Cần ít nhất một Kiosk.');
      return;
    }
    button.closest('[data-register-kiosk]')?.remove();
    renumberKiosks();
    updateRegistrationMode();
    calculateTotal();
  });
  document.getElementById('public-registration-form')?.addEventListener('submit', submitRegistration);
}

function addKiosk({ announce = true, focusNewCard = true } = {}) {
  const list = document.getElementById('register-kiosk-list');
  if (!list) return;
  if (document.querySelectorAll('[data-register-kiosk]').length >= 20) {
    showFormError('Mỗi yêu cầu tối đa 20 Kiosk.');
    return;
  }
  const id = ++state.sequence;
  list.insertAdjacentHTML('beforeend', renderKioskCard(id));
  const card = list.lastElementChild;
  bindKiosk(card);
  applyOptions(card);
  renumberKiosks();
  updateRegistrationMode();
  calculateTotal();
  const kioskNumber = [...document.querySelectorAll('[data-register-kiosk]')].indexOf(card) + 1;
  if (announce && kioskNumber > 1) {
    Toast.show(`Đã thêm Kiosk ${kioskNumber}`);
  }
  if (focusNewCard) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.querySelector('[data-kiosk-name]')?.focus({ preventScroll: true });
  }
}

function updateRegistrationMode() {
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  cards[0]?.querySelector('[data-kiosk-name]')?.closest('.form-group')?.classList.toggle('hidden', cards.length === 1);
  syncSingleKioskIdentity();
}

function syncSingleKioskIdentity() {
  const contact = document.getElementById('register-contact-name')?.value || '';
  const customerName = document.getElementById('register-facebook-name');
  if (customerName) customerName.value = contact;
  const cards = document.querySelectorAll('[data-register-kiosk]');
  if (cards.length === 1) {
    const kioskName = cards[0].querySelector('[data-kiosk-name]');
    if (kioskName) kioskName.value = contact;
  }
}

function renderKioskCard(id) {
  return `
    <section class="form-card public-kiosk-card" data-register-kiosk="${id}">
      <div class="legacy-kiosk-card-header">
        <strong data-kiosk-title>Kiosk</strong>
        <button class="btn-secondary" type="button" data-remove-kiosk>Xóa Kiosk</button>
      </div>
      ${field('Tên Facebook hiển thị', '', { required: true, data: 'data-kiosk-name' })}
      ${FacebookIdResolverFields({
        urlAttributes: 'data-kiosk-link',
        idAttributes: 'data-kiosk-id',
        requiredUrl: true,
        requiredId: false,
        manualFallback: 'always',
        prefix: `register-kiosk-${id}`,
      })}
      <div class="form-row">
        ${selectField('Danh mục', 'data-kiosk-category', 'Đang tải danh mục...')}
        ${selectField('Loại hình kinh doanh', 'data-kiosk-business-type', 'Chọn danh mục trước', true)}
      </div>
      <div class="form-row">
        ${field('Số tháng / Gói', '', { required: true, type: 'number', min: '1', max: '120', step: '1', value: '1', data: 'data-kiosk-months' })}
      </div>
      ${field('Ghi chú Kiosk', '', { textarea: true, data: 'data-kiosk-note' })}
      <div class="kiosk-price-summary">
        <span>Giá/tháng: <strong data-kiosk-price>—</strong></span>
        <span>Thành tiền: <strong data-kiosk-subtotal>—</strong></span>
      </div>
    </section>
  `;
}

function bindKiosk(card) {
  bindFacebookIdResolvers(card);
  bindSelectSearch(card);
  card.querySelector('[data-kiosk-category]')?.addEventListener('change', () => {
    renderBusinessTypes(card);
    calculateCard(card);
  });
  ['business-type', 'months'].forEach((name) => {
    card.querySelector(`[data-kiosk-${name}]`)?.addEventListener('input', () => calculateCard(card));
  });
}

async function loadOptions() {
  clearFormError();
  try {
    const [categories, businessTypes] = await Promise.all([
      CategoryService.listPublicActive(),
      BusinessTypeService.listPublicActive(),
    ]);
    state.categories = sortVietnamese(categories.data || []);
    state.businessTypes = sortVietnamese(businessTypes.data || []);
    if (!state.categories.length) {
      showFormError('Hiện chưa có danh mục hoạt động. Vui lòng liên hệ Ban quản trị.');
    }
  } catch (error) {
    state.categories = [];
    state.businessTypes = [];
    showFormError(error?.message || 'Không thể tải danh mục và loại hình kinh doanh.');
  } finally {
    document.querySelectorAll('[data-register-kiosk]').forEach(applyOptions);
  }
}

function applyOptions(card) {
  const select = card?.querySelector('[data-kiosk-category]');
  if (!select) return;
  select.disabled = !state.categories.length;
  select.innerHTML = `<option value="">${state.categories.length ? 'Chọn danh mục' : 'Đang tải danh mục...'}</option>
    ${state.categories.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
  renderBusinessTypes(card);
}

function renderBusinessTypes(card) {
  const categoryId = card.querySelector('[data-kiosk-category]')?.value || '';
  const select = card.querySelector('[data-kiosk-business-type]');
  const options = state.businessTypes.filter((item) => String(item.category_id) === String(categoryId));
  select.disabled = !categoryId || !options.length;
  select.innerHTML = categoryId
    ? `<option value="">${options.length ? 'Chọn loại hình' : 'Danh mục này chưa có loại hình hoạt động'}</option>
       ${options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`
    : '<option value="">Chọn danh mục trước</option>';
}

function calculateCard(card) {
  const businessType = findBusinessType(card);
  const months = Number(value(card, 'months'));
  let total = 0;
  if (businessType && Number.isInteger(months) && months > 0) {
    total = Number(businessType.price_per_month) * months;
  }
  card.dataset.subtotal = String(total);
  card.querySelector('[data-kiosk-price]').textContent = businessType
    ? formatCurrency(businessType.price_per_month) : '—';
  card.querySelector('[data-kiosk-subtotal]').textContent = businessType ? formatCurrency(total) : '—';
  calculateTotal();
}

function calculateTotal() {
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  const total = cards.reduce((sum, card) => sum + Number(card.dataset.subtotal || 0), 0);
  setText('register-kiosk-count', String(cards.length));
  setText('register-total-amount', formatCurrency(total));
}

function validateForm() {
  clearFormError();
  let valid = true;
  const contactName = document.getElementById('register-contact-name');
  const facebookName = document.getElementById('register-facebook-name');
  const phone = document.getElementById('register-phone');
  valid = setInlineError(contactName, contactName.value.trim() ? '' : 'Tên người liên hệ là bắt buộc.') && valid;
  valid = setInlineError(facebookName, facebookName.value.trim() ? '' : 'Tên Facebook là bắt buộc.') && valid;
  valid = setInlineError(phone, isValidPhone(phone.value) ? '' : 'Số điện thoại phải có từ 9 đến 15 chữ số.') && valid;

  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  if (!cards.length) {
    showFormError('Cần ít nhất một Kiosk.');
    return false;
  }
  const ids = cards.map((card) => value(card, 'id'));
  const duplicates = duplicateValues(ids);
  cards.forEach((card, index) => {
    const prefix = `Kiosk ${index + 1}`;
    const name = card.querySelector('[data-kiosk-name]');
    valid = setInlineError(name, name.value.trim() ? '' : `${prefix}: tên Facebook là bắt buộc.`) && valid;
    valid = validateFacebookResolver(card.querySelector('[data-facebook-id-resolver]'), { requireId: false }) && valid;
    const idInput = card.querySelector('[data-kiosk-id]');
    if (idInput.value.trim() && duplicates.has(idInput.value.trim())) {
      valid = setInlineError(idInput, 'Facebook ID bị trùng trong biểu mẫu.') && valid;
    }
    const category = card.querySelector('[data-kiosk-category]');
    const businessType = card.querySelector('[data-kiosk-business-type]');
    const months = card.querySelector('[data-kiosk-months]');
    valid = setInlineError(category, category.value ? '' : 'Danh mục là bắt buộc.') && valid;
    valid = setInlineError(businessType, businessType.value ? '' : 'Loại hình kinh doanh là bắt buộc.') && valid;
    valid = setInlineError(months, Number.isInteger(Number(months.value)) && Number(months.value) >= 1 && Number(months.value) <= 120
      ? '' : 'Số tháng phải từ 1 đến 120.') && valid;
  });

  if (!valid) showFormError('Vui lòng kiểm tra các trường được đánh dấu bên dưới.');
  document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return valid;
}

async function submitRegistration(event) {
  event.preventDefault();
  if (state.submitting || !validateForm()) return;
  state.submitting = true;
  const button = document.getElementById('register-submit-button');
  button.disabled = true;
  button.textContent = 'Đang gửi đăng ký...';
  try {
    const kiosks = [...document.querySelectorAll('[data-register-kiosk]')].map(readKiosk);
    const { data } = await RegistrationService.submitWithPayos({
      customer: {
        contact_name: read('register-contact-name'),
        facebook_name: read('register-facebook-name'),
        phone: read('register-phone'),
        address: read('register-address'),
        note: read('register-note'),
      },
      kiosks,
    });
    const payment = data?.payosPayment;
    if (!payment?.checkoutUrl) throw new Error(data?.payosError || 'Chưa tạo được link thanh toán PayOS.');
    sessionStorage.setItem(`registration-payos:${payment.orderCode}`, JSON.stringify({
      paymentLinkId: payment.paymentLinkId,
      batchId: data?.registrationBatch?.id,
      requestIds: (data?.kiosks || []).map((item) => item?.request?.id).filter(Boolean),
    }));
    renderCheckoutConfirmation(data?.registrationBatch, payment);
  } catch (error) {
    showFormError(error?.message || 'Không thể gửi đăng ký. Dữ liệu của bạn vẫn được giữ để thử lại.');
  } finally {
    state.submitting = false;
    button.disabled = false;
    button.textContent = 'Gửi đăng ký';
  }
}

function readKiosk(card) {
  return {
    facebook_name: value(card, 'name'),
    facebook_id: value(card, 'id'),
    facebook_link: value(card, 'link'),
    category_id: card.querySelector('[data-kiosk-category]')?.value || '',
    business_type_id: value(card, 'business-type'),
    months: Number(value(card, 'months')),
    discount: 0,
    discount_reason: '',
    note: value(card, 'note'),
  };
}

function renderSuccess(data) {
  document.getElementById('public-registration-form')?.classList.add('hidden');
  const success = document.getElementById('registration-success');
  success.classList.remove('hidden');
  success.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">✓</div>
      <div class="empty-state-title">Thanh toán thành công</div>
      <div class="empty-state-message">Webhook PayOS đã xác nhận và hệ thống đã cập nhật hồ sơ.</div>
    </div>
    <div class="registration-summary">
      ${summary('Số tiền đã thanh toán', formatCurrency(data?.amount || 0))}
      ${summary('Trạng thái', '<span class="badge badge-success">Đang hoạt động</span>')}
    </div>
    <div class="registration-summary"><h3>Kiosk đã kích hoạt</h3>${(data?.kiosks || []).map((item) => `<div class="setting-item"><span class="setting-name">✓ ${escapeHtml(item.name || 'Kiosk')}</span><span class="setting-value detail-value">${escapeHtml(formatDateOnly(item.startDate))} → ${escapeHtml(formatDateOnly(item.endDate))}</span></div>`).join('')}</div>
    <a class="btn-primary link-button" href="#/lookup">Xem Kiosk / Tra cứu Kiosk</a>`;
}

function renderCheckoutConfirmation(batch, payment) {
  document.getElementById('public-registration-form')?.classList.add('hidden');
  const target = document.getElementById('registration-success');
  target?.classList.remove('hidden');
  if (!target) return;
  target.innerHTML = `<div class="empty-state"><div class="empty-state-title">Xác nhận thanh toán</div><div class="empty-state-message">Một thanh toán duy nhất sẽ kích hoạt toàn bộ Kiosk trong lô đăng ký.</div></div>
    <div class="registration-summary">${summary('Số Kiosk', escapeHtml(String(batch?.kiosks?.length || 0)))}${summary('Tổng thanh toán', formatCurrency(batch?.amount || payment.amount || 0))}${summary('Kiosk', escapeHtml((batch?.kiosks || []).map((item) => item.name || 'Kiosk').join(', ')))}</div>
    <button class="btn-primary" id="registration-checkout-button" type="button">Thanh toán</button>`;
  document.getElementById('registration-checkout-button')?.addEventListener('click', (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Đang chuyển đến PayOS...';
    window.location.assign(payment.checkoutUrl);
  });
}

async function handleRegistrationReturn() {
  const params = payosReturnParams();
  const orderCode = params.get('orderCode');
  if (!orderCode) return false;
  const stored = JSON.parse(sessionStorage.getItem(`registration-payos:${orderCode}`) || '{}');
  const paymentLinkId = params.get('id') || params.get('paymentLinkId') || stored.paymentLinkId;
  const success = document.getElementById('registration-success');
  document.getElementById('public-registration-form')?.classList.add('hidden');
  success?.classList.remove('hidden');
  if (String(params.get('cancel')).toLowerCase() === 'true' || String(params.get('status')).toLowerCase() === 'cancelled') {
    success.innerHTML = '<div class="empty-state"><div class="empty-state-title">Bạn đã huỷ thanh toán.</div><div class="empty-state-message">Yêu cầu vẫn được giữ để bạn có thể thử lại.</div><a class="btn-primary link-button" href="#/register">Thử lại</a></div>';
    return true;
  }
  success.innerHTML = '<div class="empty-state"><div class="empty-state-title">Thanh toán đang được xác nhận</div><div class="empty-state-message">Hệ thống đang chờ webhook PayOS xác nhận giao dịch.</div></div>';
  if (!paymentLinkId) { renderRegistrationPending(success); return true; }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const status = await fetchPayosStatus(orderCode, paymentLinkId);
      if (String(status.status).toLowerCase() === 'paid') { renderSuccess(status); return true; }
      if (['cancelled', 'canceled', 'failed', 'expired'].includes(String(status.status).toLowerCase())) break;
    } catch { /* Show the safe pending state after the bounded polling window. */ }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  renderRegistrationPending(success);
  return true;
}

function renderRegistrationPending(target) {
  target.innerHTML = '<div class="empty-state"><div class="empty-state-title">Thanh toán đang được xác nhận</div><div class="empty-state-message">Thanh toán của bạn đang chờ hệ thống xác nhận. Kiosk hiện đang chờ xét duyệt. Vui lòng kiểm tra lại sau hoặc liên hệ Admin nếu cần hỗ trợ.</div><a class="btn-primary link-button" href="#/lookup">Tra cứu Kiosk</a></div>';
}

function payosReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const hashQuery = String(window.location.hash || '').split('?')[1];
  if (hashQuery) new URLSearchParams(hashQuery).forEach((value, key) => params.set(key, value));
  return params;
}

function formatDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function field(label, id, options = {}) {
  const attrs = [
    id ? `id="${id}"` : '',
    options.data || '',
    options.required ? 'required' : '',
    `type="${options.type || 'text'}"`,
    options.value != null ? `value="${escapeHtml(options.value)}"` : '',
    options.inputmode ? `inputmode="${options.inputmode}"` : '',
    options.autocomplete ? `autocomplete="${options.autocomplete}"` : 'autocomplete="off"',
    options.min != null ? `min="${options.min}"` : '',
    options.max != null ? `max="${options.max}"` : '',
    options.step != null ? `step="${options.step}"` : '',
    options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : '',
  ].filter(Boolean).join(' ');
  return `<label class="form-group"><span>${escapeHtml(label)}${options.required ? ' *' : ''}</span>
    ${options.textarea
      ? `<textarea class="form-control" ${id ? `id="${id}"` : ''} ${options.data || ''} rows="2"></textarea>`
      : `<input class="form-control" ${attrs} />`}
    <span class="field-error hidden"></span></label>`;
}

function selectField(label, dataAttribute, placeholder, disabled = false) {
  return `<label class="form-group"><span>${label} *</span>
    <input class="form-control select-search" type="search" data-search-for="${dataAttribute.replace('data-kiosk-', '')}" placeholder="Tìm nhanh..." autocomplete="off">
    <select class="form-control" ${dataAttribute} required ${disabled ? 'disabled' : ''}><option value="">${placeholder}</option></select>
    <span class="field-error hidden"></span></label>`;
}

function bindSelectSearch(card) {
  card.querySelectorAll('[data-search-for]').forEach((input) => input.addEventListener('input', () => {
    const select = card.querySelector(`[data-kiosk-${input.dataset.searchFor}]`);
    const query = input.value.trim().toLocaleLowerCase('vi');
    [...(select?.options || [])].forEach((option, index) => {
      option.hidden = Boolean(index > 0 && query && !option.textContent.toLocaleLowerCase('vi').includes(query));
    });
  }));
}

function findBusinessType(card) {
  const id = value(card, 'business-type');
  return state.businessTypes.find((item) => String(item.id) === String(id)) || null;
}

function value(card, name) {
  return card.querySelector(`[data-kiosk-${name}]`)?.value.trim() || '';
}

function read(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function renumberKiosks() {
  document.querySelectorAll('[data-register-kiosk]').forEach((card, index) => {
    card.querySelector('[data-kiosk-title]').textContent = `Kiosk ${index + 1}`;
  });
  setText('register-kiosk-count', String(document.querySelectorAll('[data-register-kiosk]').length));
}

function summary(label, value) {
  return `<div class="setting-item"><span class="setting-name">${label}</span><span class="setting-value detail-value">${value}</span></div>`;
}

function showFormError(message) {
  const error = document.getElementById('registration-form-error');
  if (!error) return;
  error.textContent = message;
  error.classList.remove('hidden');
}

function clearFormError() {
  const error = document.getElementById('registration-form-error');
  if (!error) return;
  error.textContent = '';
  error.classList.add('hidden');
}

function setText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function resetState() {
  state.categories = [];
  state.businessTypes = [];
  state.sequence = 0;
  state.submitting = false;
}

function sortVietnamese(items) {
  return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { sensitivity: 'base' }));
}
