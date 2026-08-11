import { PageHeader } from '../components/PageHeader.js';
import { bindPayosCopyButtons, PayosResultCard } from '../components/PayosResultCard.js';
import { Toast } from '../components/Toast.js';
import {
  bindFacebookIdResolvers,
  FacebookIdResolverFields,
  validateFacebookResolver,
} from '../components/FacebookIdResolver.js';
import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { RegistrationService } from '../services/RegistrationService.js';
import { formatCurrency } from '../utils/currency.js';
import { duplicateValues, isValidPhone, setInlineError } from '../utils/formValidation.js';
import { escapeHtml } from '../utils/html.js';
import { PublicSupportBlock, publicIcon } from '../components/OfficialCommunityCard.js';
import { bindMoneyInputs, parseMoneyInput } from '../utils/moneyInput.js';
import { enhanceSearchableSelect, refreshSearchableSelect } from '../components/SearchableSelect.js';

const state = {
  mode: 'single',
  categories: [],
  businessTypes: [],
  sequence: 0,
  submitting: false,
};

const PUBLIC_LOOKUP_NOT_FOUND = 'Không tìm thấy Kiosk với thông tin đã nhập.';

export function PublicKioskLookupPage() {
  return `
    <header class="page-header public-lookup-heading"><div><span class="public-eyebrow">Tra cứu trực tuyến</span><h1>Tra cứu Kiosk</h1><p>Kiểm tra nhanh thông tin, trạng thái và thời hạn Kiosk bằng số điện thoại đã đăng ký.</p></div></header>
    <section class="public-lookup-guide" aria-labelledby="public-lookup-guide-title">
      <div class="public-lookup-guide-heading"><span>${publicIcon('info')}</span><div><h2 id="public-lookup-guide-title">Cách sử dụng</h2><p>Thực hiện theo bốn bước ngắn dưới đây.</p></div></div>
      <ol><li><span>1</span>Nhập số điện thoại đã dùng khi đăng ký Kiosk.</li><li><span>2</span>Nhấn “Tra cứu”.</li><li><span>3</span>Xem các Kiosk liên kết với số điện thoại đó.</li><li><span>4</span>Kiểm tra trạng thái và ngày hết hạn để chủ động liên hệ gia hạn khi cần.</li></ol>
      <p class="public-privacy-note">${publicIcon('shield')} Trang chỉ hiển thị các thông tin Kiosk cần thiết phục vụ việc tra cứu.</p>
    </section>
    <section class="form-card public-lookup-card">
      <form id="public-kiosk-lookup-form" class="public-lookup-form" novalidate>
        <label class="form-group" for="public-lookup-phone"><span>Số điện thoại đăng ký</span><input class="form-control" id="public-lookup-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ví dụ: 0912 345 678" required></label>
        <button class="btn-primary" id="public-lookup-submit" type="submit">Tra cứu</button>
      </form>
      <div id="public-lookup-message" class="public-lookup-message" aria-live="polite"></div>
    </section>
    <section id="public-lookup-results" class="public-lookup-results" aria-live="polite"></section>
    <div class="public-lookup-add"><a class="btn-secondary link-button" href="#/register">Đăng ký thêm Kiosk</a></div>
    ${PublicSupportBlock({ title: 'Bạn cần gia hạn hoặc hỗ trợ?' })}`;
}

PublicKioskLookupPage.afterRender = function afterRenderPublicLookup() {
  document.getElementById('public-kiosk-lookup-form')?.addEventListener('submit', submitPublicLookup);
};

async function submitPublicLookup(event) {
  event.preventDefault();
  const input = document.getElementById('public-lookup-phone');
  const button = document.getElementById('public-lookup-submit');
  const results = document.getElementById('public-lookup-results');
  setPublicLookupMessage('Đang tra cứu Kiosk…', 'loading');
  if (results) results.innerHTML = '';
  button.disabled = true;
  button.textContent = 'Đang tra cứu…';
  try {
    const response = await fetch('/api/public/kiosk-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: input?.value || '' }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.kiosks) || !payload.kiosks.length) {
      setPublicLookupMessage(payload.message || PUBLIC_LOOKUP_NOT_FOUND, response.status === 429 ? 'error' : 'empty');
      return;
    }
    setPublicLookupMessage(`Tìm thấy ${payload.kiosks.length} Kiosk.`, 'success');
    results.innerHTML = payload.kiosks.map(renderPublicKiosk).join('');
  } catch {
    setPublicLookupMessage('Không thể tra cứu lúc này. Vui lòng thử lại sau.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Tra cứu';
  }
}

export function renderPublicKiosk(kiosk) {
  const tone = kiosk.status === 'Đã hết hạn' ? 'expired' : kiosk.status === 'Sắp hết hạn' ? 'warning' : 'active';
  const notice = tone === 'expired' ? 'Kiosk đã hết hạn.' : tone === 'warning' ? 'Kiosk sắp hết hạn. Vui lòng liên hệ Ban quản trị để gia hạn.' : 'Kiosk đang hoạt động bình thường.';
  const statusIcon = tone === 'warning' ? 'warning' : tone === 'expired' ? 'close' : 'check-circle';
  return `<article class="public-result-card ${tone}"><div class="public-result-head"><h2>${escapeHtml(kiosk.name || 'Kiosk')}</h2><span class="public-status ${tone}">${publicIcon(statusIcon)} ${escapeHtml(kiosk.status)}</span></div><dl class="public-result-details">${publicLookupDetail('Danh mục', kiosk.category || '—')}${publicLookupDetail('Loại hình kinh doanh', kiosk.businessType || '—')}${publicLookupDetail('Ngày bắt đầu', formatPublicLookupDate(kiosk.startDate))}${publicLookupDetail('Ngày hết hạn', formatPublicLookupDate(kiosk.expirationDate))}${publicLookupDetail('Số ngày còn lại', Number.isInteger(kiosk.remainingDays) && kiosk.remainingDays >= 0 ? `${kiosk.remainingDays} ngày` : '—')}${publicLookupDetail('Tự động duyệt', kiosk.autoApprove ? 'Có' : 'Không')}</dl><p class="public-status-notice ${tone}">${publicIcon(statusIcon)} ${escapeHtml(notice)}</p><button class="btn-secondary" type="button" disabled title="Gia hạn công khai đang chờ phê duyệt bảo mật">Gia hạn</button></article>`;
}

function publicLookupDetail(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function formatPublicLookupDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—'; const [year, month, day] = value.split('-'); return `${day}/${month}/${year}`; }
function setPublicLookupMessage(message, stateName) { const element = document.getElementById('public-lookup-message'); if (!element) return; element.className = `public-lookup-message ${stateName}`; element.textContent = message; }

export function RegisterPage() {
  resetState();
  return `
    ${PageHeader({
      title: 'Đăng ký Kiosk trực tuyến',
      description: 'Đăng ký Kiosk mới và gửi yêu cầu trực tiếp tới hệ thống.',
    })}
    <ol class="public-form-steps public-form-steps-five" aria-label="Quy trình đăng ký"><li class="active"><span>1</span>Facebook & liên hệ</li><li><span>2</span>Kiosk</li><li><span>3</span>Thời gian & báo giá</li><li><span>4</span>Xác nhận</li><li><span>5</span>Thanh toán</li></ol>
    <section class="form-card registration-card">
      <form id="public-registration-form" novalidate>
        <div id="registration-form-error" class="form-error hidden" role="alert"></div>
        <fieldset class="public-kiosk-mode" id="register-kiosk-mode">
          <legend>Bạn có bao nhiêu Kiosk?</legend>
          <label><input type="radio" name="register-kiosk-mode" value="single" checked><span>${publicIcon('store')}<strong>Tôi chỉ có 1 Kiosk</strong><small>Tôi sử dụng một tài khoản Facebook để đăng bài.</small></span></label>
          <label><input type="radio" name="register-kiosk-mode" value="multiple"><span>${publicIcon('users')}<strong>Tôi có nhiều Kiosk</strong><small>Tôi có nhiều tài khoản Facebook hoặc nhiều nội dung kinh doanh khác nhau.</small></span></label>
        </fieldset>
        <section id="register-customer-section">${renderCustomerSection()}</section>

        <div class="registration-list-heading">
          <div>
            <div class="form-section-title" id="register-kiosk-heading">Thông tin đăng ký</div>
            <p class="muted-text" id="register-kiosk-helper">Một luồng đơn giản cho một tài khoản Facebook và một nội dung kinh doanh.</p>
          </div>
        </div>
        <div id="register-kiosk-list"></div>
        <div class="form-section-title registration-confirmation-title" id="registration-confirmation-title">Xác nhận & thanh toán</div>
        <div class="registration-total-sticky">
          <span>Tổng đăng ký (<strong id="register-kiosk-count">1</strong> Kiosk)</span>
          <strong id="register-total-amount">0 ₫</strong>
        </div>
        <div class="registration-add-row hidden" id="register-add-kiosk-row">
          <span class="registration-add-icon">${publicIcon('store')}</span><div><strong>Thêm Kiosk khác</strong><span class="field-helper">Đăng ký thêm một tài khoản Facebook hoặc nội dung kinh doanh.</span></div>
          <button class="btn-secondary register-add-kiosk-bottom" id="register-add-kiosk-button" type="button">${publicIcon('store')} Thêm Kiosk</button>
        </div>
        <div class="registration-actions">
          <button class="btn-primary" id="register-submit-button" type="submit">Gửi đăng ký</button>
        </div>
      </form>
      <div id="registration-success" class="registration-success hidden" aria-live="polite"></div>
    </section>
    ${PublicSupportBlock({ title: 'Gặp khó khăn khi đăng ký?' })}
  `;
}

RegisterPage.afterRender = async function afterRenderRegister() {
  addKiosk({ announce: false, focusNewCard: false });
  bindEvents();
  await loadOptions();
};

function bindEvents() {
  bindFacebookIdResolvers(document.getElementById('register-customer-section'));
  document.querySelectorAll('input[name="register-kiosk-mode"]').forEach((radio) => radio.addEventListener('change', (event) => {
    state.mode = event.target.value;
    if (state.mode === 'single') {
      [...document.querySelectorAll('[data-register-kiosk]')].slice(1).forEach((card) => card.remove());
      renumberKiosks();
      calculateTotal();
    }
    const customer = document.getElementById('register-customer-section');
    if (customer) customer.innerHTML = renderCustomerSection();
    bindFacebookIdResolvers(customer);
    syncRegistrationMode();
  }));
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
  calculateTotal();
  syncRegistrationMode();
  const kioskNumber = [...document.querySelectorAll('[data-register-kiosk]')].indexOf(card) + 1;
  if (announce && kioskNumber > 1) {
    Toast.show(`Đã thêm Kiosk ${kioskNumber}`);
  }
  if (focusNewCard) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.querySelector('[data-kiosk-name]')?.focus({ preventScroll: true });
  }
}

function renderKioskCard(id) {
  return `
    <section class="form-card public-kiosk-card" data-register-kiosk="${id}">
      <div class="legacy-kiosk-card-header" data-kiosk-header>
        <strong data-kiosk-title>Kiosk</strong>
        <button class="btn-secondary" type="button" data-remove-kiosk>Xóa Kiosk</button>
      </div>
      <div data-kiosk-facebook-identity>
        ${field('Tên Facebook / Tên Kiosk', '', { required: true, data: 'data-kiosk-name', placeholder: 'Ví dụ: Cửa hàng An Nhiên' })}
        ${FacebookIdResolverFields({
          urlAttributes: 'data-kiosk-link',
          idAttributes: 'data-kiosk-id',
          requiredUrl: true,
          requiredId: true,
          manualFallback: 'always',
          prefix: `register-kiosk-${id}`,
          idLabel: 'Facebook UID',
        })}
      </div>
      <div class="kiosk-subsection-title">Thông tin Kiosk</div>
      <div class="form-row">
        ${selectField('Danh mục', 'data-kiosk-category', 'Đang tải danh mục...')}
        ${selectField('Loại hình kinh doanh', 'data-kiosk-business-type', 'Chọn danh mục trước', true)}
      </div>
      <div class="kiosk-subsection-title">Thời gian &amp; báo giá</div>
      <div class="form-row">
        ${field('Số tháng / Gói', '', { required: true, type: 'number', min: '1', max: '120', step: '1', value: '1', data: 'data-kiosk-months' })}
        ${moneyField('Giảm giá', 'data-kiosk-discount')}
      </div>
      ${field('Lý do giảm giá', '', { data: 'data-kiosk-discount-reason' })}
      <div data-kiosk-note-field>${field('Ghi chú riêng cho Kiosk', '', { textarea: true, data: 'data-kiosk-note' })}</div>
      <div class="kiosk-price-summary">
        <span>Giá/tháng: <strong data-kiosk-price>—</strong></span>
        <span>Thành tiền: <strong data-kiosk-subtotal>—</strong></span>
      </div>
    </section>
  `;
}

function bindKiosk(card) {
  bindFacebookIdResolvers(card);
  bindMoneyInputs(card);
  enhanceSearchableSelect(card.querySelector('[data-kiosk-category]'), { placeholder: 'Tìm danh mục' });
  enhanceSearchableSelect(card.querySelector('[data-kiosk-business-type]'), { placeholder: 'Tìm loại hình kinh doanh' });
  card.querySelector('[data-kiosk-category]')?.addEventListener('change', () => {
    renderBusinessTypes(card);
    calculateCard(card);
  });
  ['business-type', 'months', 'discount'].forEach((name) => {
    card.querySelector(`[data-kiosk-${name}]`)?.addEventListener(name === 'discount' ? 'moneychange' : 'input', () => calculateCard(card));
  });
}

async function loadOptions() {
  clearFormError();
  try {
    const [categories, businessTypes] = await Promise.all([
      CategoryService.listActive(),
      BusinessTypeService.listActive(),
    ]);
    state.categories = categories.data || [];
    state.businessTypes = businessTypes.data || [];
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
    ${[...state.categories].sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
  refreshSearchableSelect(select, { placeholder: 'Tìm danh mục' });
  renderBusinessTypes(card);
}

function renderBusinessTypes(card) {
  const categoryId = card.querySelector('[data-kiosk-category]')?.value || '';
  const select = card.querySelector('[data-kiosk-business-type]');
  const options = state.businessTypes.filter((item) => String(item.category_id) === String(categoryId));
  select.disabled = !categoryId || !options.length;
  select.innerHTML = categoryId
    ? `<option value="">${options.length ? 'Chọn loại hình' : 'Danh mục này chưa có loại hình hoạt động'}</option>
       ${[...options].sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi')).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`
    : '<option value="">Chọn danh mục trước</option>';
  refreshSearchableSelect(select, { placeholder: 'Tìm loại hình kinh doanh' });
}

function calculateCard(card) {
  const businessType = findBusinessType(card);
  const months = Number(value(card, 'months'));
  const discount = parseMoneyInput(value(card, 'discount'));
  let total = 0;
  if (businessType && Number.isInteger(months) && months > 0 && discount >= 0) {
    total = (Number(businessType.price_per_month) * months) - discount;
    if (total < 0) total = 0;
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
  const phone = document.getElementById('register-phone');
  valid = setInlineError(contactName, contactName?.value.trim() ? '' : 'Tên Facebook là bắt buộc.') && valid;
  valid = validateFacebookResolver(document.querySelector('#register-customer-section [data-facebook-id-resolver]')) && valid;
  valid = setInlineError(phone, isValidPhone(phone.value) ? '' : 'Số điện thoại phải có từ 9 đến 15 chữ số.') && valid;

  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  if (!cards.length) {
    showFormError('Cần ít nhất một Kiosk.');
    return false;
  }
  const ids = cards.map((card) => state.mode === 'single' ? read('register-contact-id') : value(card, 'id'));
  const duplicates = duplicateValues(ids);
  cards.forEach((card, index) => {
    const prefix = `Kiosk ${index + 1}`;
    const name = state.mode === 'single' ? contactName : card.querySelector('[data-kiosk-name]');
    if (state.mode === 'multiple') valid = setInlineError(name, name.value.trim() ? '' : `${prefix}: tên Facebook là bắt buộc.`) && valid;
    if (state.mode === 'multiple') valid = validateFacebookResolver(card.querySelector('[data-facebook-id-resolver]')) && valid;
    const idInput = state.mode === 'single' ? document.getElementById('register-contact-id') : card.querySelector('[data-kiosk-id]');
    if (state.mode === 'multiple' && idInput.value.trim() && duplicates.has(idInput.value.trim())) {
      valid = setInlineError(idInput, 'Facebook ID bị trùng trong biểu mẫu.') && valid;
    }
    const category = card.querySelector('[data-kiosk-category]');
    const businessType = card.querySelector('[data-kiosk-business-type]');
    const months = card.querySelector('[data-kiosk-months]');
    const discount = card.querySelector('[data-kiosk-discount]');
    const discountReason = card.querySelector('[data-kiosk-discount-reason]');
    const bt = findBusinessType(card);
    valid = setInlineError(category, category.value ? '' : 'Danh mục là bắt buộc.') && valid;
    valid = setInlineError(businessType, businessType.value ? '' : 'Loại hình kinh doanh là bắt buộc.') && valid;
    valid = setInlineError(months, Number.isInteger(Number(months.value)) && Number(months.value) >= 1 && Number(months.value) <= 120
      ? '' : 'Số tháng phải từ 1 đến 120.') && valid;
    const subtotal = Number(bt?.price_per_month || 0) * Number(months.value || 0);
    const discountValue = parseMoneyInput(discount.value);
    valid = setInlineError(discount, discountValue >= 0 && discountValue <= subtotal
      ? '' : 'Giảm giá không hợp lệ hoặc lớn hơn tạm tính.') && valid;
    valid = setInlineError(discountReason, discountValue === 0 || discountReason.value.trim()
      ? '' : 'Cần nhập lý do giảm giá.') && valid;
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
    const customerName = state.mode === 'single' ? kiosks[0].facebook_name : read('register-contact-name');
    const { data } = await RegistrationService.submitWithPayos({
      customer: {
        contact_name: customerName,
        facebook_name: customerName,
        facebook_id: read('register-contact-id'),
        facebook_link: read('register-contact-link'),
        phone: read('register-phone'),
        address: read('register-address'),
        note: read('register-note'),
      },
      kiosks,
    });
    renderSuccess(data, kiosks);
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
    facebook_name: state.mode === 'single' ? read('register-contact-name') : value(card, 'name'),
    facebook_id: state.mode === 'single' ? read('register-contact-id') : value(card, 'id'),
    facebook_link: state.mode === 'single' ? read('register-contact-link') : value(card, 'link'),
    category_id: card.querySelector('[data-kiosk-category]')?.value || '',
    business_type_id: value(card, 'business-type'),
    months: Number(value(card, 'months')),
    discount: parseMoneyInput(value(card, 'discount')),
    discount_reason: value(card, 'discount-reason'),
    note: state.mode === 'multiple' ? value(card, 'note') : '',
  };
}

function renderSuccess(data, submittedKiosks) {
  document.getElementById('public-registration-form')?.classList.add('hidden');
  const success = document.getElementById('registration-success');
  const items = data?.kiosks || [];
  const total = items.reduce((sum, item) => sum + Number(item.preview?.totalAmount || 0), 0);
  const codes = items.map((item) => item.request?.id).filter(Boolean).join(', ');
  success.classList.remove('hidden');
  success.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">${publicIcon('check')}</div>
      <div class="empty-state-title">Đã gửi đăng ký</div>
      <div class="empty-state-message">Yêu cầu đã được ghi nhận. Vui lòng thanh toán đúng số tiền bên dưới để hệ thống tự cập nhật khi ngân hàng báo về.</div>
    </div>
    <div class="registration-summary">
      ${summary('Mã yêu cầu', escapeHtml(codes || 'Được cấp sau khi tiếp nhận'))}
      ${summary('Kiosk đã gửi', escapeHtml(submittedKiosks.map((item) => item.facebook_name).join(', ')))}
      ${summary('Tổng tiền', formatCurrency(total))}
      ${summary('Trạng thái', '<span class="badge badge-pending">Chờ thanh toán</span>')}
      ${summary('Bước tiếp theo', data?.payosPayments?.length ? 'Quét QR hoặc mở link PayOS để thanh toán.' : 'Chưa tạo được QR tự động, Ban quản trị sẽ hỗ trợ thanh toán.')}
    </div>
    ${renderPayosPayments(data?.payosPayments || [])}
    ${data?.payosError ? '<div class="form-error">Chưa tạo được QR PayOS tự động. Ban quản trị sẽ hỗ trợ thanh toán yêu cầu này.</div>' : ''}`;
  bindPayosCopyButtons(success);
}

function renderPayosPayments(payments) {
  if (!payments.length) return '';
  return `
    <div class="public-payos-list">
      <h3>Thanh toán PayOS</h3>
      ${payments.map((payment, index) => `
        ${PayosResultCard({
          amountLabel: `${payments.length > 1 ? `Kiosk ${index + 1} · ` : ''}${formatCurrency(payment.amount || 0)}`,
          checkoutUrl: payment.checkoutUrl,
          orderCode: payment.orderCode,
          paymentLinkId: payment.paymentLinkId,
          qrCode: payment.qrCode,
          note: 'Thanh toán đúng số tiền, hệ thống sẽ tự cập nhật khi PayOS webhook xác nhận.',
          className: 'public-payos-card',
        })}
      `).join('')}
    </div>
  `;
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
    <select class="form-control" ${dataAttribute} required ${disabled ? 'disabled' : ''}><option value="">${placeholder}</option></select>
    <span class="field-error hidden"></span></label>`;
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
  state.mode = 'single';
  state.categories = [];
  state.businessTypes = [];
  state.sequence = 0;
  state.submitting = false;
}

function syncRegistrationMode() {
  const multiple = state.mode === 'multiple';
  document.getElementById('register-add-kiosk-row')?.classList.toggle('hidden', !multiple);
  const cards = [...document.querySelectorAll('[data-register-kiosk]')];
  cards.forEach((card) => {
    card.classList.toggle('single-kiosk-card', !multiple);
    card.querySelector('[data-kiosk-header]')?.classList.toggle('hidden', !multiple);
    card.querySelector('[data-kiosk-facebook-identity]')?.classList.toggle('hidden', !multiple);
    card.querySelector('[data-kiosk-note-field]')?.classList.toggle('hidden', !multiple);
    card.querySelector('[data-remove-kiosk]')?.classList.toggle('hidden', !multiple || cards.length <= 1);
  });
  setText('register-kiosk-heading', multiple ? 'Danh sách Kiosk' : 'Thông tin đăng ký Kiosk');
  setText('register-kiosk-helper', multiple ? 'Mỗi Kiosk có tài khoản Facebook, loại hình và gói riêng.' : 'Một luồng đơn giản cho một tài khoản Facebook và một nội dung kinh doanh.');
  setText('registration-confirmation-title', multiple ? 'Tổng đăng ký & thanh toán' : 'Xác nhận & thanh toán');
}

function renderCustomerSection() {
  const title = state.mode === 'single' ? 'Thông tin Facebook & liên hệ' : 'Thông tin người liên hệ';
  return `<div class="form-section-title">${title}</div>${field('Tên Facebook', 'register-contact-name', { required: true, autocomplete: 'name', placeholder: 'Tên Facebook dùng để liên hệ' })}${FacebookIdResolverFields({ urlId: 'register-contact-link', idId: 'register-contact-id', requiredUrl: true, requiredId: true, manualFallback: 'always', prefix: 'register-contact', idLabel: 'Facebook UID' })}<div class="form-row">${field('Số điện thoại', 'register-phone', { required: true, type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: 'Ví dụ: 0912 345 678' })}${field('Địa chỉ', 'register-address', { placeholder: 'Không bắt buộc' })}</div>${field('Ghi chú cho Ban quản trị', 'register-note', { textarea: true })}`;
}

function moneyField(label, data) {
  return `<label class="form-group"><span>${label} <small class="field-optional">Không bắt buộc</small></span><span class="money-input-shell"><input class="form-control" type="text" inputmode="numeric" autocomplete="off" placeholder="0 VNĐ" data-money-input ${data}><span class="money-input-suffix">VNĐ</span></span><span class="field-error hidden"></span></label>`;
}
