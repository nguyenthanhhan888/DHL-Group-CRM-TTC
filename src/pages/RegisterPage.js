import { PageHeader } from '../components/PageHeader.js';
import { PublicSupport } from '../components/PublicSupport.js';
import { PaymentActionButtons, PaymentKioskList, PaymentProgress, PaymentSecureNote, PaymentStatusHero, PaymentSummaryCard } from '../components/PaymentExperience.js';
import { fetchPayosStatus } from '../components/PayosResultCard.js';
import { Toast } from '../components/Toast.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields, validateFacebookResolver } from '../components/FacebookIdResolver.js';
import { BusinessDiscovery, renderBusinessSelection, renderBusinessSuggestions } from '../components/BusinessDiscovery.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { RegistrationService } from '../services/RegistrationService.js';
import { settingsService } from '../services/SettingsService.js';
import { formatCurrency } from '../utils/currency.js';
import { duplicateValues, isValidPhone, setInlineError } from '../utils/formValidation.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';

const state = { categories: [], businessTypes: [], sequence: 0, step: 1, submitting: false };

export function RegisterPage() {
  resetState();
  return `<div class="public-form-flow registration-v2">
    ${PageHeader({ title: 'Đăng ký Kiosk trực tuyến', description: 'Chỉ 3 bước đơn giản để đăng ký và thanh toán an toàn qua PayOS.' })}
    <section class="registration-card registration-wizard">
      <ol class="registration-stepper" aria-label="Tiến trình đăng ký">
        <li class="registration-step active" data-step-indicator="1"><span>1</span><strong>Thông tin</strong></li>
        <li class="registration-step" data-step-indicator="2"><span>2</span><strong>Ngành nghề & gói</strong></li>
        <li class="registration-step" data-step-indicator="3"><span>3</span><strong>Xác nhận</strong></li>
      </ol>
      <form id="public-registration-form" novalidate>
        <div id="registration-form-error" class="form-error hidden" role="alert"></div>
        <section class="registration-panel" data-registration-panel="1">
          ${panelHeader(1, 'Thông tin Facebook & liên hệ', 'Facebook ID sẽ được nhận diện tự động từ link của bạn.')}
          ${FacebookIdResolverFields({ urlId: 'register-customer-link', idId: 'register-customer-id', requiredUrl: true, requiredId: false, manualFallback: 'on-error', autoResolve: true, nameTarget: '#register-facebook-name', buttonLabel: 'Xác thực Facebook', helperText: 'Dán link trang cá nhân hoặc Fanpage bạn dùng để đăng bài trong Group. Ưu tiên dùng link chính thức.' })}
          ${field('Tên Facebook', 'register-facebook-name', { required: true, autocomplete: 'name' })}
          <div class="form-row">${field('Số điện thoại', 'register-phone', { required: true, type: 'tel', inputmode: 'tel', autocomplete: 'tel' })}${field('Địa chỉ', 'register-address')}</div>
          <div class="registration-actions"><button class="btn-primary registration-cta" type="button" data-next-step>Tiếp tục ${renderIcon('chevron-right')}</button></div>
        </section>
        <section class="registration-panel hidden" data-registration-panel="2">
          ${panelHeader(2, 'Kiosk & ngành nghề', 'Nói đơn giản bạn đang bán gì hoặc kinh doanh gì để xem gợi ý.')}
          <div id="register-kiosk-list"></div>
          <button class="btn-secondary register-add-kiosk-bottom" id="register-add-kiosk-button" type="button">${renderIcon('plus')} Thêm Kiosk mới</button>
          <section class="registration-order-summary">
            <label class="form-group"><span>Mã giảm giá <small class="field-optional">Sắp có</small></span><div class="discount-row"><input class="form-control" placeholder="Nhập mã giảm giá" disabled /><button class="btn-secondary" type="button" disabled>Áp dụng</button></div></label>
            <div><span>Tạm tính (<strong id="register-kiosk-count">1</strong> Kiosk)</span><strong id="register-total-amount">0 VNĐ</strong></div>
            <div><span>Giảm giá</span><strong>0 VNĐ</strong></div>
            <div class="registration-grand-total"><span>TỔNG THANH TOÁN</span><strong id="register-grand-total">0 VNĐ</strong></div>
          </section>
          <div class="registration-actions"><button class="btn-secondary" type="button" data-previous-step>${renderIcon('chevron-left')} Quay lại</button><button class="btn-primary registration-cta" type="button" data-next-step>Kiểm tra thông tin ${renderIcon('chevron-right')}</button></div>
        </section>
        <section class="registration-panel hidden" data-registration-panel="3">
          ${panelHeader(3, 'Xác nhận & thanh toán', 'Kiểm tra kỹ thông tin trước khi tạo yêu cầu thanh toán.')}
          <div id="registration-review"></div>
          <div class="classification-warning"><span class="registration-section-icon">${renderIcon('warning')}</span><div><strong>Vui lòng kiểm tra kỹ Danh mục và Loại hình kinh doanh.</strong><p>Hệ thống sử dụng thông tin này để nhận diện và hỗ trợ duyệt bài đúng nội dung kinh doanh của Kiosk. Nếu chọn sai, bài đăng có thể không được nhận diện hoặc duyệt chính xác.</p></div></div>
          <label class="checkbox-field registration-confirmation"><input id="register-confirmation" type="checkbox" required /><span id="register-confirmation-copy">Tôi xác nhận Danh mục và Loại hình kinh doanh đã chọn đúng với hoạt động kinh doanh của mình.</span></label>
          <div class="registration-actions"><button class="btn-secondary" type="button" data-previous-step>${renderIcon('chevron-left')} Chỉnh sửa</button><button class="btn-primary registration-cta" id="register-submit-button" type="submit">${renderIcon('shield')} Xác nhận & Thanh toán</button></div><p class="registration-secure-note">${renderIcon('shield')} Thanh toán an toàn qua PayOS</p>
        </section>
      </form><div id="registration-success" class="registration-success hidden" aria-live="polite"></div>
    </section>${PublicSupport()}</div>`;
}

RegisterPage.afterRender = async function afterRenderRegister() {
  if (await handleRegistrationReturn()) return;
  addKiosk({ announce: false, focus: false });
  bindEvents();
  settingsService.getPublicSettings().catch(() => null);
  await loadOptions();
};

function panelHeader(number, title, description) {
  const icon = number === 1 ? 'user-circle' : number === 2 ? 'store' : 'check-circle';
  return `<header class="registration-panel-header"><span class="registration-panel-icon">${renderIcon(icon)}</span><div><small>BƯỚC ${number}</small><h2>${title}</h2><p>${description}</p></div></header>`;
}

function bindEvents() {
  bindFacebookIdResolvers(document);
  document.querySelector('[data-registration-panel="1"] [data-facebook-id-resolver]')?.addEventListener('facebook-id-resolved', (event) => {
    const name = document.getElementById('register-facebook-name');
    if (event.detail?.facebookName && name) setInlineError(name, '');
    syncCustomerIdentityPreview();
  });
  document.getElementById('register-facebook-name')?.addEventListener('input', syncCustomerIdentityPreview);
  document.getElementById('register-add-kiosk-button')?.addEventListener('click', () => addKiosk());
  document.getElementById('register-kiosk-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-kiosk]');
    if (!button) return;
    if (document.querySelectorAll('[data-register-kiosk]').length === 1) return showFormError('Cần ít nhất một Kiosk.');
    button.closest('[data-register-kiosk]')?.remove();
    renumberKiosks(); updateIdentityMode(); calculateTotal();
  });
  document.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => {
    if (validateStep(state.step)) goToStep(state.step + 1);
  }));
  document.querySelectorAll('[data-previous-step]').forEach((button) => button.addEventListener('click', () => goToStep(state.step - 1)));
  document.getElementById('public-registration-form')?.addEventListener('submit', submitRegistration);
}

function addKiosk({ announce = true, focus = true } = {}) {
  const list = document.getElementById('register-kiosk-list');
  if (!list || list.children.length >= 20) return;
  const id = ++state.sequence;
  const isFirst = list.children.length === 0;
  list.insertAdjacentHTML('beforeend', kioskCard(id, isFirst));
  const card = list.lastElementChild;
  bindKiosk(card); applyOptions(card); renumberKiosks(); updateIdentityMode(); calculateTotal();
  if (announce) Toast.show(`Đã thêm Kiosk ${list.children.length}`);
  if (focus) card.querySelector('[data-kiosk-link]')?.focus();
}

function kioskCard(id, isFirst = false) {
  return `<article class="public-kiosk-card" data-register-kiosk="${id}">
    <header class="kiosk-card-header"><div><span data-kiosk-title>Kiosk</span><small>Thông tin riêng của Kiosk này</small></div><button class="btn-danger-subtle" type="button" data-remove-kiosk aria-label="Xóa Kiosk">${renderIcon('trash')}<span>Xóa</span></button></header>
    <section class="kiosk-facebook-section ${isFirst ? 'hidden' : ''}" data-kiosk-facebook-section>
      ${isFirst ? '<label class="reuse-customer-toggle"><input type="checkbox" data-use-customer-facebook checked><span><strong>Dùng Facebook của người đăng ký</strong><small>Không cần dán lại Link Facebook</small></span></label><div class="customer-identity-preview" data-customer-identity-preview></div>' : ''}
      <div class="${isFirst ? 'hidden' : ''}" data-independent-facebook>${isFirst ? '' : independentFacebookFields(id)}</div>
    </section>
    ${BusinessDiscovery({ prefix: `register-kiosk-${id}` })}
    <fieldset class="registration-month-control form-group"><legend>${renderIcon('calendar')} Thời hạn đăng ký *</legend><div class="month-stepper"><button type="button" data-month-decrease aria-label="Giảm một tháng">−</button><label><input class="form-control" type="number" data-kiosk-months min="1" max="120" step="1" value="1" inputmode="numeric"><span>tháng</span></label><button type="button" data-month-increase aria-label="Tăng một tháng">+</button></div><span class="field-error hidden" data-month-error></span><p data-price-equation>Chọn ngành nghề để xem giá</p></fieldset>
    <div class="kiosk-price-summary"><span>Giá/tháng: <strong data-kiosk-price>—</strong></span><span>Thành tiền: <strong data-kiosk-subtotal>—</strong></span></div>
  </article>`;
}

function independentFacebookFields(id) {
  return `${FacebookIdResolverFields({ urlAttributes: 'data-kiosk-link', idAttributes: 'data-kiosk-id', requiredUrl: true, requiredId: false, manualFallback: 'on-error', autoResolve: true, nameTarget: '[data-kiosk-name]', prefix: `register-kiosk-${id}`, buttonLabel: 'Xác thực Facebook', helperText: 'Dán link Facebook của Kiosk này. Mỗi Kiosk cần đúng link riêng.' })}${field('Tên Facebook', '', { required: true, data: 'data-kiosk-name' })}`;
}

function bindKiosk(card) {
  bindFacebookIdResolvers(card);
  card.querySelector('[data-use-customer-facebook]')?.addEventListener('change', (event) => {
    const independent = card.querySelector('[data-independent-facebook]');
    if (!event.target.checked && independent && !independent.children.length) {
      independent.innerHTML = independentFacebookFields(card.dataset.registerKiosk);
      bindFacebookIdResolvers(independent);
    }
    independent?.classList.toggle('hidden', event.target.checked);
    syncCustomerIdentityPreview();
  });
  const discovery = card.querySelector('[data-business-discovery]');
  discovery.querySelector('[data-business-search]').addEventListener('input', (event) => renderBusinessSuggestions(discovery.querySelector('[data-business-suggestions]'), event.target.value, state.categories, state.businessTypes));
  discovery.querySelector('[data-business-suggestions]').addEventListener('click', (event) => selectSuggestion(card, event));
  discovery.querySelector('[data-business-manual-toggle]').addEventListener('click', (event) => {
    const manual = discovery.querySelector('[data-business-manual]');
    const open = !manual.classList.toggle('hidden');
    event.currentTarget.setAttribute('aria-expanded', String(open));
    event.currentTarget.textContent = open ? 'Ẩn lựa chọn thủ công' : 'Chọn thủ công';
  });
  card.querySelector('[data-kiosk-category]').addEventListener('change', () => { renderBusinessTypes(card); calculateCard(card); });
  card.querySelector('[data-kiosk-business-type]').addEventListener('change', () => { showSelection(card); calculateCard(card); });
  card.querySelectorAll('[data-kiosk-months]').forEach((input) => input.addEventListener('change', () => calculateCard(card)));
  card.querySelector('[data-kiosk-months]')?.addEventListener('input', () => calculateCard(card));
  card.querySelector('[data-month-decrease]')?.addEventListener('click', () => adjustMonths(card, -1));
  card.querySelector('[data-month-increase]')?.addEventListener('click', () => adjustMonths(card, 1));
}

function adjustMonths(card, delta) {
  const input = card.querySelector('[data-kiosk-months]');
  const current = Number(input.value) || 1;
  input.value = String(Math.min(120, Math.max(1, current + delta)));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectSuggestion(card, event) {
  const choice = event.target.closest('[data-select-business]');
  if (!choice) return;
  const type = state.businessTypes.find((item) => String(item.id) === choice.dataset.selectBusiness);
  if (!type) return;
  card.querySelector('[data-kiosk-category]').value = type.category_id;
  renderBusinessTypes(card);
  card.querySelector('[data-kiosk-business-type]').value = type.id;
  card.querySelector('[data-business-suggestions]').innerHTML = '';
  showSelection(card); calculateCard(card);
}

function showSelection(card) {
  const type = findBusinessType(card);
  const category = state.categories.find((item) => String(item.id) === String(type?.category_id));
  if (type) {
    const target = card.querySelector('[data-business-selection]');
    renderBusinessSelection(target, category, type);
    target.querySelector('[data-change-business]')?.addEventListener('click', () => {
      card.querySelector('[data-business-search]').focus();
      card.querySelector('[data-business-search]').select();
    });
  }
}

async function loadOptions() {
  try {
    const [categories, types] = await Promise.all([CategoryService.listPublicActive(), BusinessTypeService.listPublicActive()]);
    state.categories = sortVietnamese(categories.data || []);
    state.businessTypes = sortVietnamese(types.data || []);
    if (!state.categories.length) showFormError('Hiện chưa có danh mục hoạt động. Vui lòng liên hệ Ban quản trị.');
  } catch (error) {
    console.error('Public registration option loading failed', error);
    showFormError('Không thể tải danh sách ngành nghề. Vui lòng thử lại.');
  } finally {
    document.querySelectorAll('[data-register-kiosk]').forEach(applyOptions);
  }
}

function applyOptions(card) {
  const select = card.querySelector('[data-kiosk-category]');
  if (!select) return;
  select.disabled = !state.categories.length;
  select.innerHTML = `<option value="">Chọn danh mục</option>${state.categories.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
  renderBusinessTypes(card);
}

function renderBusinessTypes(card) {
  const categoryId = card.querySelector('[data-kiosk-category]')?.value || '';
  const select = card.querySelector('[data-kiosk-business-type]');
  const options = state.businessTypes.filter((item) => String(item.category_id) === String(categoryId));
  select.disabled = !categoryId || !options.length;
  select.innerHTML = categoryId ? `<option value="">${options.length ? 'Chọn loại hình' : 'Danh mục này chưa có loại hình'}</option>${options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}` : '<option value="">Chọn danh mục trước</option>';
}

function calculateCard(card) {
  const type = findBusinessType(card);
  const months = Number(value(card, 'months'));
  const total = type ? Number(type.price_per_month) * months : 0;
  card.dataset.subtotal = String(total);
  card.querySelector('[data-kiosk-price]').textContent = type ? formatCurrency(type.price_per_month) : '—';
  card.querySelector('[data-kiosk-subtotal]').textContent = type ? formatCurrency(total) : '—';
  const equation = card.querySelector('[data-price-equation]');
  if (equation) equation.innerHTML = type && Number.isInteger(months) && months > 0
    ? `<span>${months} tháng × ${formatCurrency(type.price_per_month)}/tháng</span><strong>= ${formatCurrency(total)}</strong>`
    : 'Chọn ngành nghề và nhập số tháng để xem giá';
  calculateTotal();
}

function calculateTotal() {
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  const total = cards.reduce((sum, card) => sum + Number(card.dataset.subtotal || 0), 0);
  setText('register-kiosk-count', cards.length); setText('register-total-amount', formatCurrency(total)); setText('register-grand-total', formatCurrency(total));
}

function usesCustomerFacebook(card) {
  const checkbox = card.querySelector('[data-use-customer-facebook]');
  return Boolean(checkbox?.checked);
}

function customerFacebookIdentity() {
  return {
    facebook_name: read('register-facebook-name'),
    facebook_id: read('register-customer-id'),
    facebook_link: read('register-customer-link'),
  };
}

function kioskFacebookIdentity(card) {
  return usesCustomerFacebook(card)
    ? customerFacebookIdentity()
    : { facebook_name: value(card, 'name'), facebook_id: value(card, 'id'), facebook_link: value(card, 'link') };
}

function updateIdentityMode() {
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  const multiple = cards.length > 1;
  const first = cards[0];
  first?.querySelector('[data-kiosk-facebook-section]')?.classList.toggle('hidden', !multiple);
  if (!multiple) {
    const checkbox = first?.querySelector('[data-use-customer-facebook]');
    if (checkbox) checkbox.checked = true;
    const independent = first?.querySelector('[data-independent-facebook]');
    independent?.classList.add('hidden');
    if (independent) independent.innerHTML = '';
  }
  setText('register-confirmation-copy', multiple
    ? 'Tôi đã kiểm tra Danh mục và Loại hình kinh doanh của từng Kiosk.'
    : 'Tôi xác nhận Danh mục và Loại hình kinh doanh đã chọn đúng với hoạt động kinh doanh của mình.');
  syncCustomerIdentityPreview();
}

function syncCustomerIdentityPreview() {
  const identity = customerFacebookIdentity();
  document.querySelectorAll('[data-customer-identity-preview]').forEach((target) => {
    target.innerHTML = `<strong>${escapeHtml(identity.facebook_name || 'Facebook người đăng ký')}</strong><small>${escapeHtml(identity.facebook_id ? `ID ${identity.facebook_id}` : identity.facebook_link || '')}</small>`;
  });
}

function validateStep(step) {
  clearFormError();
  let valid = true;
  if (step === 1) {
    valid = validateFacebookResolver(document.querySelector('[data-registration-panel="1"] [data-facebook-id-resolver]'), { requireId: false }) && valid;
    const name = document.getElementById('register-facebook-name');
    const phone = document.getElementById('register-phone');
    valid = setInlineError(name, name.value.trim() ? '' : 'Không nhận diện được tên Facebook. Vui lòng xác thực lại link.') && valid;
    valid = setInlineError(phone, isValidPhone(phone.value) ? '' : 'Số điện thoại phải có từ 9 đến 15 chữ số.') && valid;
  }
  if (step === 2) valid = validateKiosks();
  if (!valid) {
    showFormError('Vui lòng kiểm tra các trường được đánh dấu bên dưới.');
    document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return valid;
}

function validateKiosks() {
  let valid = true;
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  const duplicates = duplicateValues(cards.map((card) => kioskFacebookIdentity(card).facebook_id).filter(Boolean));
  cards.forEach((card, index) => {
    const identity = kioskFacebookIdentity(card);
    if (!usesCustomerFacebook(card)) {
      valid = validateFacebookResolver(card.querySelector('[data-facebook-id-resolver]'), { requireId: false }) && valid;
      const name = card.querySelector('[data-kiosk-name]');
      const id = card.querySelector('[data-kiosk-id]');
      valid = setInlineError(name, name.value.trim() ? '' : `Kiosk ${index + 1}: chưa nhận diện được tên Facebook.`) && valid;
      if (id.value.trim() && duplicates.has(id.value.trim())) valid = setInlineError(id, 'Facebook ID bị trùng trong biểu mẫu.') && valid;
    } else if (!identity.facebook_name || !identity.facebook_link) {
      showFormError('Facebook người đăng ký chưa đầy đủ. Vui lòng quay lại Bước 1.');
      valid = false;
    }
    const category = card.querySelector('[data-kiosk-category]');
    const type = card.querySelector('[data-kiosk-business-type]');
    const months = card.querySelector('[data-kiosk-months]');
    valid = setInlineError(category, category.value ? '' : 'Vui lòng chọn Danh mục.') && valid;
    valid = setInlineError(type, type.value ? '' : 'Vui lòng chọn Loại hình kinh doanh.') && valid;
    valid = setInlineError(months, Number.isInteger(Number(months.value)) && Number(months.value) >= 1 && Number(months.value) <= 120 ? '' : 'Số tháng phải là số nguyên từ 1 đến 120.') && valid;
  });
  return valid;
}

function goToStep(step) {
  state.step = Math.max(1, Math.min(3, step));
  clearFormError();
  document.querySelectorAll('[data-registration-panel]').forEach((panel) => panel.classList.toggle('hidden', Number(panel.dataset.registrationPanel) !== state.step));
  document.querySelectorAll('[data-step-indicator]').forEach((item) => {
    const number = Number(item.dataset.stepIndicator);
    item.classList.toggle('active', number === state.step);
    item.classList.toggle('completed', number < state.step);
    item.querySelector('span').textContent = number < state.step ? '✓' : String(number);
  });
  if (state.step === 3) renderReview();
  document.querySelector('.registration-wizard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReview() {
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  const total = cards.reduce((sum, card) => sum + Number(card.dataset.subtotal || 0), 0);
  document.getElementById('registration-review').innerHTML = `
    <section class="review-section"><h3><span class="registration-section-icon">${renderIcon('facebook')}</span>Thông tin Facebook</h3><dl>
      <div><dt>Tên Facebook</dt><dd>${escapeHtml(read('register-facebook-name'))}</dd></div>
      <div><dt>Facebook ID</dt><dd>${escapeHtml(read('register-customer-id') || '—')}</dd></div>
      <div><dt>Link Facebook</dt><dd>${escapeHtml(read('register-customer-link'))}</dd></div>
    </dl></section>
    <section class="review-section"><h3><span class="registration-section-icon">${renderIcon('user')}</span>Thông tin liên hệ</h3><dl>
      <div><dt>Số điện thoại</dt><dd>${escapeHtml(read('register-phone'))}</dd></div>
      <div><dt>Địa chỉ</dt><dd>${escapeHtml(read('register-address') || '—')}</dd></div>
    </dl></section>
    <section class="review-section"><h3><span class="registration-section-icon">${renderIcon('store')}</span>Kiosk đăng ký</h3>${cards.map((card, index) => {
    const type = findBusinessType(card);
    const category = state.categories.find((item) => String(item.id) === String(type?.category_id));
    const identity = kioskFacebookIdentity(card);
    return `<article class="review-kiosk"><strong>Kiosk ${index + 1}: ${escapeHtml(identity.facebook_name)}</strong><span>Danh mục: ${escapeHtml(category?.name || '')}</span><span>Loại hình: ${escapeHtml(type?.name || '')} · ${value(card, 'months')} tháng</span><b>${formatCurrency(card.dataset.subtotal || 0)}</b></article>`;
  }).join('')}</section>
    <section class="review-total" aria-label="Thanh toán"><h3><span class="registration-section-icon">${renderIcon('wallet')}</span>Thanh toán</h3><div><span>Tạm tính</span><strong>${formatCurrency(total)}</strong></div><div><span>Giảm giá</span><strong>0 VNĐ</strong></div><div><span>Tổng thanh toán</span><strong>${formatCurrency(total)}</strong></div></section>`;
  const button = document.getElementById('register-submit-button');
  if (button) button.innerHTML = `${renderIcon('shield')} Thanh toán ${formatCurrency(total)}`;
}

async function submitRegistration(event) {
  event.preventDefault();
  if (state.submitting || !validateStep(1) || !validateKiosks()) return;
  const confirmation = document.getElementById('register-confirmation');
  if (!confirmation.checked) { confirmation.focus(); showFormError('Vui lòng xác nhận thông tin trước khi thanh toán.'); return; }
  state.submitting = true;
  const button = document.getElementById('register-submit-button');
  const original = button.innerHTML;
  button.disabled = true; button.textContent = 'Đang tạo thanh toán...';
  try {
    const { data } = await RegistrationService.submitWithPayos({
      customer: { contact_name: read('register-facebook-name'), facebook_name: read('register-facebook-name'), facebook_id: read('register-customer-id'), facebook_link: read('register-customer-link'), phone: read('register-phone'), address: read('register-address') },
      kiosks: [...document.querySelectorAll('[data-register-kiosk]')].map(readKiosk),
    });
    const payment = data?.payosPayment;
    if (!payment?.checkoutUrl) throw new Error(data?.payosError || 'Chưa tạo được link thanh toán PayOS.');
    sessionStorage.setItem(`registration-payos:${payment.orderCode}`, JSON.stringify({ paymentLinkId: payment.paymentLinkId, batchId: data?.registrationBatch?.id, requestIds: (data?.kiosks || []).map((item) => item?.request?.id).filter(Boolean), phone: read('register-phone') }));
    renderCheckoutConfirmation(data?.registrationBatch, payment, data?.kiosks || []);
  } catch (error) {
    console.error('Public registration submission failed', error);
    showFormError('Không thể tạo thanh toán lúc này. Dữ liệu của bạn vẫn được giữ để thử lại.');
  } finally {
    state.submitting = false; button.disabled = false; button.innerHTML = original;
  }
}

function readKiosk(card) {
  const identity = kioskFacebookIdentity(card);
  return { ...identity, category_id: card.querySelector('[data-kiosk-category]')?.value || '', business_type_id: value(card, 'business-type'), months: Number(value(card, 'months')), discount: 0, discount_reason: '', note: '' };
}

function renderCheckoutConfirmation(batch, payment, submittedKiosks = []) {
  hideRegistrationForm();
  const target = document.getElementById('registration-success');
  target?.classList.remove('hidden');
  if (!target) return;
  const kiosks = (batch?.kiosks || []).map((item, index) => ({ ...item, businessType: submittedKiosks[index]?.businessType?.name || submittedKiosks[index]?.preview?.businessTypeName }));
  const amount = batch?.amount || payment.amount || 0;
  target.innerHTML = `<div class="payment-experience payment-checkout">${PaymentStatusHero({ status: 'checkout', eyebrow: 'Thanh toán đăng ký', title: 'Sẵn sàng thanh toán', description: 'Bạn sẽ được chuyển sang cổng PayOS an toàn.' })}${PaymentProgress({ activeStep: 1 })}${PaymentSummaryCard([{ label: 'Số lượng Kiosk', value: kiosks.length }, { label: 'Phương thức', value: 'PayOS' }, { label: 'Tổng thanh toán', value: formatCurrency(amount), emphasis: true }])}${PaymentKioskList(kiosks, { showAmounts: true })}${PaymentSecureNote()}${PaymentActionButtons([{ label: `Thanh toán qua PayOS · ${formatCurrency(amount)}`, icon: 'checkout', attrs: 'id="registration-checkout-button"' }])}</div>`;
  document.getElementById('registration-checkout-button')?.addEventListener('click', (clickEvent) => { clickEvent.currentTarget.disabled = true; clickEvent.currentTarget.textContent = 'Đang chuyển đến PayOS...'; window.location.assign(payment.checkoutUrl); });
}

async function handleRegistrationReturn() {
  const params = payosReturnParams();
  const orderCode = params.get('orderCode');
  if (!orderCode) return false;
  const stored = JSON.parse(sessionStorage.getItem(`registration-payos:${orderCode}`) || '{}');
  const paymentLinkId = params.get('id') || params.get('paymentLinkId') || stored.paymentLinkId;
  const success = document.getElementById('registration-success');
  hideRegistrationForm(); success?.classList.remove('hidden');
  if (String(params.get('cancel')).toLowerCase() === 'true' || String(params.get('status')).toLowerCase() === 'cancelled') {
    success.innerHTML = `<div class="payment-experience">${PaymentStatusHero({ status: 'cancelled', eyebrow: 'Giao dịch chưa hoàn tất', title: 'Bạn đã huỷ thanh toán', description: 'Giao dịch chưa được hoàn tất và Kiosk chưa được kích hoạt.' })}${PaymentActionButtons([{ label: 'Thử thanh toán lại', href: '#/register', icon: 'checkout' }, { label: 'Về trang đăng ký', href: '#/register', secondary: true }])}</div>`;
    return true;
  }
  success.innerHTML = pendingMarkup();
  if (!paymentLinkId) { renderPending(success); return true; }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const status = await fetchPayosStatus(orderCode, paymentLinkId);
      if (String(status.status).toLowerCase() === 'paid') { renderSuccess(status, stored.phone); return true; }
      const terminal = String(status.status).toLowerCase();
      if (['cancelled', 'canceled', 'failed', 'expired'].includes(terminal)) { renderTerminal(success, terminal); return true; }
    } catch { /* A friendly pending state is shown after the bounded polling window. */ }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  renderPending(success); return true;
}

function renderSuccess(data, phone = '') {
  const success = document.getElementById('registration-success');
  const kiosks = data?.kiosks || [];
  success.innerHTML = `<div class="payment-experience payment-receipt">${PaymentStatusHero({ status: 'success', eyebrow: 'Giao dịch hoàn tất', title: 'Thanh toán thành công', description: 'PayOS đã xác nhận giao dịch và Kiosk của bạn đã được kích hoạt.' })}${PaymentProgress({ activeStep: 4 })}${PaymentSummaryCard([{ label: 'Tổng đã thanh toán', value: formatCurrency(data?.amount || 0), emphasis: true }, { label: 'Số Kiosk đã kích hoạt', value: kiosks.length }])}${PaymentKioskList(kiosks, { success: true })}${PaymentActionButtons([{ label: 'Tra cứu Kiosk', href: '#/lookup', icon: 'kiosk', attrs: 'data-registration-lookup' }, { label: 'Về trang chủ', href: '#/', secondary: true }])}</div>`;
  success.querySelector('[data-registration-lookup]')?.addEventListener('click', (clickEvent) => { clickEvent.preventDefault(); if (phone) sessionStorage.setItem('lookup-prefill-phone', phone); window.history.replaceState({}, '', `${window.location.pathname}#/lookup`); window.location.reload(); });
}

function hideRegistrationForm() { document.getElementById('public-registration-form')?.classList.add('hidden'); document.querySelector('.registration-stepper')?.classList.add('hidden'); }
function renderPending(target) { target.innerHTML = `${pendingMarkup(true)}${PaymentActionButtons([{ label: 'Tra cứu Kiosk', href: '#/lookup', secondary: true }])}`; }
function pendingMarkup(timedOut = false) { return `<div class="payment-experience payment-processing" role="status" aria-live="polite">${PaymentStatusHero({ status: 'pending', eyebrow: 'Đang xử lý an toàn', title: 'Đang xác nhận thanh toán', description: timedOut ? 'Giao dịch đang chờ PayOS xác nhận. Bạn có thể kiểm tra lại sau ít phút.' : 'Ngân hàng đã tiếp nhận giao dịch. Hệ thống đang xác nhận với PayOS.', helper: 'Quá trình này thường chỉ mất vài giây.' })}${PaymentProgress({ activeStep: 2 })}</div>`; }
function renderTerminal(target, status) { target.innerHTML = `<div class="payment-experience">${PaymentStatusHero({ status: ['cancelled', 'canceled'].includes(status) ? 'cancelled' : 'warning', eyebrow: 'Giao dịch chưa hoàn tất', title: status === 'expired' ? 'Liên kết thanh toán đã hết hạn' : 'Thanh toán chưa hoàn tất', description: 'Kiosk chưa được kích hoạt. Yêu cầu đăng ký của bạn vẫn được giữ an toàn.' })}${PaymentActionButtons([{ label: 'Thử thanh toán lại', href: '#/register', icon: 'checkout' }, { label: 'Liên hệ hỗ trợ', href: '#/contact', secondary: true }])}</div>`; }
function payosReturnParams() { const params = new URLSearchParams(window.location.search); const hashQuery = String(window.location.hash || '').split('?')[1]; if (hashQuery) new URLSearchParams(hashQuery).forEach((item, key) => params.set(key, item)); return params; }
function field(label, id, options = {}) { const attrs = [id ? `id="${id}"` : '', options.data || '', options.required ? 'required' : '', `type="${options.type || 'text'}"`, options.inputmode ? `inputmode="${options.inputmode}"` : '', options.autocomplete ? `autocomplete="${options.autocomplete}"` : 'autocomplete="off"', options.readonly ? 'readonly' : ''].filter(Boolean).join(' '); return `<label class="form-group"><span>${escapeHtml(label)}${options.required ? ' *' : ''}</span><input class="form-control" ${attrs} /><span class="field-error hidden"></span></label>`; }
function findBusinessType(card) { return state.businessTypes.find((item) => String(item.id) === String(value(card, 'business-type'))) || null; }
function value(card, name) { const fields = [...card.querySelectorAll(`[data-kiosk-${name}]`)]; return (fields.find((item) => item.checked) || fields[0])?.value.trim() || ''; }
function read(id) { return document.getElementById(id)?.value.trim() || ''; }
function renumberKiosks() { const cards = document.querySelectorAll('[data-register-kiosk]'); cards.forEach((card, index) => { card.querySelector('[data-kiosk-title]').textContent = `Kiosk ${index + 1}`; card.querySelector('[data-remove-kiosk]').classList.toggle('hidden', cards.length === 1); }); setText('register-kiosk-count', cards.length); }
function showFormError(message) { const error = document.getElementById('registration-form-error'); if (error) { error.textContent = message; error.classList.remove('hidden'); } }
function clearFormError() { const error = document.getElementById('registration-form-error'); if (error) { error.textContent = ''; error.classList.add('hidden'); } }
function setText(id, text) { const element = document.getElementById(id); if (element) element.textContent = text; }
function resetState() { state.categories = []; state.businessTypes = []; state.sequence = 0; state.step = 1; state.submitting = false; }
function sortVietnamese(items) { return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { sensitivity: 'base' })); }
