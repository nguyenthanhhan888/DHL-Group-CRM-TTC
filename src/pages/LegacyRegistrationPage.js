import { BusinessTypeService } from '../services/BusinessTypeService.js';
import { CategoryService } from '../services/CategoryService.js';
import { LegacyRegistrationService } from '../services/LegacyRegistrationService.js';
import { settingsService } from '../services/SettingsService.js';
import { PageHeader } from '../components/PageHeader.js';
import { bindFacebookIdResolvers, FacebookIdResolverFields, validateFacebookResolver } from '../components/FacebookIdResolver.js';
import { Toast } from '../components/Toast.js';
import { getOrganizationSetting } from '../config/organization.js';
import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';
import { startOfVietnamToday, toDateOnly } from '../utils/date.js';
import { debounce } from '../utils/dom.js';
import { duplicateValues, isDigits, isValidDateOnly, setInlineError } from '../utils/formValidation.js';
import { bindCurrencyInput, parseCurrencyInput } from '../utils/currency.js';

const state = {
  mode: 'single',
  categories: [],
  businessTypes: [],
  catalogStatus: 'loading',
  catalogError: '',
  catalogRequestId: 0,
  kioskSequence: 0,
  isSubmitting: false,
};

const CATALOG_TIMEOUT_MS = 15_000;

export function LegacyRegistrationPage() {
  resetState();
  return `
    <div class="public-form-flow legacy-registration-v3">
    ${PageHeader({
      title: 'Bổ sung thông tin khách hàng cũ',
      description: 'Bổ sung thông tin Kiosk đã đăng ký trước đây nhưng hiện chưa có đầy đủ dữ liệu trên hệ thống.',
    })}
    <section class="registration-card legacy-registration-card">
      <ol class="registration-stepper legacy-stepper" aria-label="Các bước bổ sung Kiosk"><li class="registration-step active"><span>1</span><strong>Thông tin khách hàng</strong></li><li class="registration-step active"><span>2</span><strong>Kiosk bổ sung</strong></li><li class="registration-step active"><span>3</span><strong>Xác nhận</strong></li></ol>
      <div class="legacy-scope-notice"><p>Điền thông tin Kiosk và gửi bill cũ để Ban quản trị kiểm tra.</p></div>
      <form id="legacy-registration-form" novalidate>
        <div id="legacy-registration-error" class="form-error hidden" role="alert"></div>
        <div id="legacy-registration-warning" class="legacy-warning hidden" role="status"></div>

        <fieldset class="legacy-mode-picker">
          <legend>Bạn có bao nhiêu kiosk?</legend>
          <label><input type="radio" name="legacy-kiosk-mode" value="single" checked /> Tôi chỉ có 1 kiosk</label>
          <label><input type="radio" name="legacy-kiosk-mode" value="multiple" /> Tôi có nhiều kiosk</label>
        </fieldset>

        <section id="legacy-customer-section" class="legacy-flow-section" aria-label="Bước 1: Thông tin khách hàng"></section>
        <section id="legacy-kiosk-section" class="legacy-flow-section" aria-label="Bước 2: Kiosk bổ sung"></section>
        <label class="form-group">
          <span>Ghi chú cho Ban quản trị <small class="field-optional">Không bắt buộc</small></span>
          <textarea class="form-control" id="legacy-customer-note" rows="3"></textarea>
        </label>

        <section class="legacy-confirmations legacy-flow-section" aria-label="Bước 3: Xác nhận">
          <div class="legacy-payment-proof">
            <strong>Bill thanh toán là bắt buộc để xác minh khách hàng cũ.</strong>
            <p>Vui lòng bấm nút “Gửi bill qua Zalo” và gửi ảnh chuyển khoản, hóa đơn hoặc bằng chứng thanh toán cho Ban quản trị.</p>
            <p><strong>Yêu cầu không có bill sẽ không được duyệt.</strong></p>
          </div>
          <section class="legacy-zalo-card" aria-labelledby="legacy-zalo-title">
            <div>
              <h2 id="legacy-zalo-title">Gửi bill thanh toán</h2>
              <p>Số Zalo hỗ trợ: <strong id="legacy-zalo-number">Đang cập nhật</strong></p>
              <p id="legacy-zalo-unavailable" class="muted-text hidden">Thông tin Zalo hỗ trợ đang được cập nhật.</p>
            </div>
            <div class="legacy-zalo-actions">
              <a id="legacy-zalo-button" class="legacy-zalo-button" href="#" target="_blank" rel="noopener noreferrer" aria-disabled="true">Gửi bill qua Zalo</a>
              <button id="legacy-copy-zalo" class="btn-secondary" type="button" disabled>Sao chép số Zalo</button>
            </div>
          </section>
          <label class="checkbox-field">
            <input id="legacy-bill-confirmation" type="checkbox" required />
            <span>Tôi xác nhận đã gửi bill thanh toán qua Zalo hỗ trợ.</span>
          </label>
          <label class="checkbox-field">
            <input id="legacy-final-confirmation" type="checkbox" required />
            <span>Tôi xác nhận các thông tin đã cung cấp là đúng theo những gì tôi biết.</span>
          </label>
        </section>

        <div class="modal-actions">
          <button class="btn-primary" id="legacy-save-button" type="submit">Kiểm tra và gửi</button>
        </div>
      </form>
      <div id="legacy-registration-success" class="registration-success hidden" aria-live="polite"></div>
    </section>
    </div>
  `;
}

LegacyRegistrationPage.afterRender = function afterRenderLegacy() {
  renderFlow();
  bindStaticEvents();
  startLegacyBackgroundInitialization();
};

export function startLegacyBackgroundInitialization({
  catalogTask = loadCatalog,
  settingsTask = () => settingsService.getPublicSettings(),
  zaloTask = bindZaloActions,
} = {}) {
  const catalogPromise = runBackgroundTask(catalogTask);
  const settingsPromise = runBackgroundTask(settingsTask)
    .then(() => zaloTask(), () => zaloTask());
  return { catalogPromise, settingsPromise };
}

function runBackgroundTask(task) {
  try {
    return Promise.resolve(task());
  } catch (error) {
    return Promise.reject(error);
  }
}

function resetState() {
  state.mode = 'single';
  state.categories = [];
  state.businessTypes = [];
  state.catalogStatus = 'loading';
  state.catalogError = '';
  state.catalogRequestId += 1;
  state.kioskSequence = 0;
  state.isSubmitting = false;
}

function bindStaticEvents() {
  document.querySelectorAll('input[name="legacy-kiosk-mode"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      state.mode = event.target.value;
      state.kioskSequence = 0;
      clearMessages();
      renderFlow();
    });
  });

  document.getElementById('legacy-registration-form')?.addEventListener('submit', handleSubmit);
  document.getElementById('legacy-registration-form')?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-legacy-catalog-retry]')) return;
    loadCatalog();
  });
}

function renderFlow() {
  const customerSection = document.getElementById('legacy-customer-section');
  const kioskSection = document.getElementById('legacy-kiosk-section');
  if (!customerSection || !kioskSection) return;

  customerSection.innerHTML = state.mode === 'single' ? renderSingleCustomer() : renderMultipleCustomer();
  kioskSection.innerHTML = state.mode === 'single'
    ? `<div class="form-section-title">Thông tin kiosk</div>${catalogStateMarkup()}${renderKioskCard({ copyCustomer: true })}`
    : `
      <div class="legacy-kiosk-heading">
        <div class="form-section-title">Danh sách kiosk</div>
      </div>
      ${catalogStateMarkup()}
      <div id="legacy-kiosk-list">${renderKioskCard()}</div>
      <div class="registration-add-row legacy-add-row">
        <button class="btn-secondary register-add-kiosk-bottom" id="legacy-add-kiosk" type="button">+ Thêm kiosk</button>
        <span class="field-helper">Nhập xong kiosk hiện tại rồi bấm để thêm kiosk tiếp theo.</span>
      </div>
    `;

  bindFlowEvents();
}

function renderSingleCustomer() {
  return `
    <div class="form-section-title">Thông tin khách hàng</div>
    ${FacebookIdResolverFields({
      urlId: 'legacy-customer-link',
      idId: 'legacy-customer-id',
      requiredUrl: true,
      requiredId: true,
      manualFallback: 'always',
      autoResolve: true,
      nameTarget: '#legacy-customer-name',
    })}
    ${field('Tên Facebook', 'legacy-customer-name', { required: true, autocomplete: 'name' })}
    ${field('Số điện thoại', 'legacy-customer-phone', { type: 'tel', required: true, inputmode: 'tel', autocomplete: 'tel' })}
    <label class="checkbox-field legacy-copy-toggle">
      <input id="legacy-copy-customer" type="checkbox" checked />
      <span>Thông tin kiosk giống thông tin khách hàng</span>
    </label>
  `;
}

function renderMultipleCustomer() {
  return `
    <div class="form-section-title">Thông tin khách hàng / Người liên hệ</div>
    ${FacebookIdResolverFields({
      urlId: 'legacy-customer-link',
      idId: 'legacy-customer-id',
      requiredUrl: true,
      requiredId: true,
      manualFallback: 'always',
      autoResolve: true,
      nameTarget: '#legacy-customer-name',
    })}
    <div class="form-row">
      ${field('Tên Facebook chính / Người liên hệ', 'legacy-customer-name', { required: true, autocomplete: 'name' })}
      ${field('Số điện thoại', 'legacy-customer-phone', { type: 'tel', required: true, inputmode: 'tel', autocomplete: 'tel' })}
    </div>
  `;
}

function renderKioskCard({ copyCustomer = false } = {}) {
  const kioskId = ++state.kioskSequence;
  const today = toDateOnly(startOfVietnamToday());
  return `
    <section class="form-card legacy-kiosk-card" data-legacy-kiosk="${kioskId}">
      <div class="legacy-kiosk-card-header">
        <strong data-kiosk-title>Kiosk ${state.mode === 'single' ? '' : kioskId}</strong>
        ${state.mode === 'multiple' ? '<button class="btn-secondary" type="button" data-remove-kiosk>Xóa kiosk này</button>' : ''}
      </div>
      <div data-kiosk-facebook-fields class="${copyCustomer ? 'hidden' : ''}">
        ${FacebookIdResolverFields({
          urlAttributes: 'data-kiosk-field="link"',
          idAttributes: 'data-kiosk-field="facebook-id"',
          requiredUrl: !copyCustomer,
          requiredId: !copyCustomer,
          manualFallback: 'always',
          autoResolve: true,
          nameTarget: '[data-kiosk-field="name"]',
          prefix: `legacy-kiosk-${kioskId}`,
        })}
        ${nestedField('Tên Facebook', 'name', { required: !copyCustomer })}
      </div>
      <div class="form-row legacy-kiosk-grid legacy-kiosk-taxonomy">
        <label class="form-group">
          <span>Danh mục *</span>
          <select class="form-control" data-kiosk-category required>${categoryOptions()}</select>
        </label>
        <label class="form-group">
          <span>Dịch vụ *</span>
          <select class="form-control" data-kiosk-business-type required disabled>
            <option value="">Chọn danh mục trước</option>
          </select>
        </label>
      </div>
      <div class="form-row legacy-kiosk-grid legacy-kiosk-history">
        ${nestedField('Số tiền đã thanh toán', 'amount', { type: 'text', inputmode: 'numeric', placeholder: '0 VNĐ', required: true })}
        ${nestedField('Ngày đăng ký', 'start', { type: 'date', value: today, required: true })}
      </div>
      <div class="form-row legacy-kiosk-grid legacy-kiosk-history">
        ${nestedField('Ngày hết hạn', 'end', { type: 'date', value: today, required: true })}
        <label class="form-group">
          <span>Ghi chú / Bằng chứng <small class="field-optional">Không bắt buộc</small></span>
          <textarea class="form-control" data-kiosk-field="note" rows="2"></textarea>
        </label>
      </div>
    </section>
  `;
}

function bindFlowEvents() {
  bindFacebookIdResolvers(document.getElementById('legacy-registration-form'));
  const customerName = document.getElementById('legacy-customer-name');
  const customerPhone = document.getElementById('legacy-customer-phone');
  customerName?.addEventListener('input', debounce(checkWarningsAndDuplicates, 500));
  customerPhone?.addEventListener('input', debounce(checkWarningsAndDuplicates, 500));

  if (state.mode === 'single') {
    document.getElementById('legacy-copy-customer')?.addEventListener('change', toggleCopyCustomer);
  }

  document.getElementById('legacy-add-kiosk')?.addEventListener('click', addKiosk);
  const list = document.getElementById('legacy-kiosk-list') || document.getElementById('legacy-kiosk-section');
  list?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-kiosk]');
    if (!button) return;
    button.closest('[data-legacy-kiosk]')?.remove();
    renumberKiosks();
    checkWarningsAndDuplicates();
  });

  bindKioskInputs();
}

function bindKioskInputs(container = document) {
  const cards = container.matches?.('[data-legacy-kiosk]')
    ? [container]
    : [...container.querySelectorAll('[data-legacy-kiosk]')];
  cards.forEach((card) => {
    if (card.dataset.bound === 'true') return;
    card.dataset.bound = 'true';
    bindFacebookIdResolvers(card);
    bindCurrencyInput(card.querySelector('[data-kiosk-field="amount"]'));
    card.querySelector('[data-kiosk-field="name"]')?.addEventListener('input', debounce(checkWarningsAndDuplicates, 500));
    card.querySelector('[data-kiosk-category]')?.addEventListener('change', (event) => {
      renderBusinessTypeSelect(card, event.target.value);
    });
  });
}

function toggleCopyCustomer(event) {
  const card = document.querySelector('[data-legacy-kiosk]');
  const fields = card?.querySelector('[data-kiosk-facebook-fields]');
  fields?.classList.toggle('hidden', event.target.checked);
  fields?.querySelectorAll('input').forEach((input) => {
    input.required = !event.target.checked && input.inputMode !== 'numeric';
  });
  checkWarningsAndDuplicates();
}

function addKiosk() {
  const list = document.getElementById('legacy-kiosk-list');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', renderKioskCard());
  const card = list.lastElementChild;
  bindKioskInputs(card);
  renumberKiosks();
  const kioskNumber = [...document.querySelectorAll('[data-legacy-kiosk]')].indexOf(card) + 1;
  Toast.show(`Đã thêm Kiosk ${kioskNumber}`);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.querySelector('[data-kiosk-field="name"]')?.focus({ preventScroll: true });
}

function renumberKiosks() {
  document.querySelectorAll('[data-legacy-kiosk]').forEach((card, index) => {
    const title = card.querySelector('[data-kiosk-title]');
    if (title) title.textContent = `Kiosk ${index + 1}`;
  });
}

async function loadCatalog() {
  const requestId = ++state.catalogRequestId;
  state.catalogStatus = 'loading';
  state.catalogError = '';
  updateCatalogUi();

  try {
    const result = await fetchLegacyPublicCatalog();
    if (requestId !== state.catalogRequestId) return;
    state.categories = result.categories;
    state.businessTypes = result.businessTypes;
    state.catalogStatus = result.status;
  } catch (error) {
    if (requestId !== state.catalogRequestId) return;
    state.categories = [];
    state.businessTypes = [];
    state.catalogStatus = 'error';
    state.catalogError = error?.message === 'Quá thời gian tải danh mục và dịch vụ.'
      ? error.message
      : 'Không thể tải danh mục và dịch vụ. Vui lòng thử lại.';
  }
  updateCatalogUi();
}

export async function fetchLegacyPublicCatalog({
  categoryService = CategoryService,
  businessTypeService = BusinessTypeService,
  timeoutMs = CATALOG_TIMEOUT_MS,
} = {}) {
  const [categoriesResult, businessTypesResult] = await withTimeout(Promise.all([
    categoryService.listPublicActive(),
    businessTypeService.listPublicActive(),
  ]), timeoutMs);
  const categories = sortVietnamese(categoriesResult.data || []);
  const businessTypes = sortVietnamese(businessTypesResult.data || []);
  return {
    categories,
    businessTypes,
    status: categories.length && businessTypes.length ? 'success' : 'empty',
  };
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(new Error('Quá thời gian tải danh mục và dịch vụ.')),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timeoutId));
}

function updateCatalogUi() {
  const status = document.getElementById('legacy-catalog-status');
  if (status) status.outerHTML = catalogStateMarkup();
  document.querySelectorAll('[data-legacy-kiosk]').forEach(applyCatalogToCard);
}

function applyCatalogToCard(card) {
  const categorySelect = card.querySelector('[data-kiosk-category]');
  if (!categorySelect) return;
  const businessTypeSelect = card.querySelector('[data-kiosk-business-type]');
  if (categorySelect.value) card.dataset.catalogCategory = categorySelect.value;
  if (businessTypeSelect?.value) card.dataset.catalogBusinessType = businessTypeSelect.value;
  const selectedCategory = categorySelect.value || card.dataset.catalogCategory || '';
  const selectedBusinessType = businessTypeSelect?.value || card.dataset.catalogBusinessType || '';
  categorySelect.innerHTML = categoryOptions();
  categorySelect.disabled = state.catalogStatus !== 'success';
  if (state.categories.some((item) => String(item.id) === String(selectedCategory))) {
    categorySelect.value = selectedCategory;
  } else if (state.catalogStatus === 'success') {
    delete card.dataset.catalogCategory;
    delete card.dataset.catalogBusinessType;
  }
  renderBusinessTypeSelect(card, categorySelect.value, selectedBusinessType);
  if (state.catalogStatus === 'success' && businessTypeSelect?.value) {
    card.dataset.catalogCategory = categorySelect.value;
    card.dataset.catalogBusinessType = businessTypeSelect.value;
  }
}

function categoryOptions() {
  if (state.catalogStatus === 'loading') return '<option value="">Đang tải...</option>';
  if (state.catalogStatus === 'error') return '<option value="">Không thể tải danh mục</option>';
  if (state.catalogStatus === 'empty') return '<option value="">Chưa có danh mục hoạt động</option>';
  return `<option value="">Chọn danh mục</option>${state.categories
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('')}`;
}

function renderBusinessTypeSelect(card, categoryId, selectedBusinessType = '') {
  const select = card?.querySelector('[data-kiosk-business-type]');
  if (!select) return;
  const items = filterLegacyBusinessTypes(state.businessTypes, categoryId);
  if (state.catalogStatus !== 'success') {
    select.disabled = true;
    select.innerHTML = `<option value="">${state.catalogStatus === 'loading' ? 'Đang tải...' : 'Dịch vụ chưa sẵn sàng'}</option>`;
    return;
  }
  select.disabled = !categoryId || !items.length;
  select.innerHTML = categoryId
    ? `<option value="">${items.length ? 'Chọn dịch vụ' : 'Danh mục này chưa có dịch vụ'}</option>${items
      .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
      .join('')}`
    : '<option value="">Chọn danh mục trước</option>';
  if (items.some((item) => String(item.id) === String(selectedBusinessType))) {
    select.value = selectedBusinessType;
  }
}

export function filterLegacyBusinessTypes(businessTypes, categoryId) {
  return businessTypes.filter((item) => String(item.category_id) === String(categoryId));
}

function catalogStateMarkup() {
  const content = {
    loading: ['Đang tải danh mục và dịch vụ…', 'Vui lòng chờ trong giây lát.'],
    success: ['Đã tải danh mục', 'Chọn danh mục để xem các dịch vụ tương ứng.'],
    empty: ['Chưa có danh mục hoạt động', 'Vui lòng thử tải lại hoặc liên hệ Ban quản trị.'],
    error: ['Không thể tải danh mục', state.catalogError || 'Vui lòng kiểm tra kết nối và thử lại.'],
  }[state.catalogStatus];
  const retry = ['empty', 'error'].includes(state.catalogStatus)
    ? '<button class="btn-secondary" type="button" data-legacy-catalog-retry>Thử lại</button>'
    : '';
  return `<div id="legacy-catalog-status" class="legacy-catalog-state is-${state.catalogStatus}" data-catalog-state="${state.catalogStatus}" role="${state.catalogStatus === 'error' ? 'alert' : 'status'}" aria-live="polite"><div><strong>${escapeHtml(content[0])}</strong><span>${escapeHtml(content[1])}</span></div>${retry}</div>`;
}

function normalizeFacebookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    if (host !== 'facebook.com' && host !== 'fb.com') return '';
    url.protocol = 'https:';
    url.hostname = 'www.facebook.com';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

async function checkWarningsAndDuplicates() {
  const warningElement = document.getElementById('legacy-registration-warning');
  const customerName = readValue('legacy-customer-name');
  const kiosks = readKiosks();
  const names = kiosks.map((item) => item.facebook_name).filter(Boolean);
  const warnings = [];

  const normalizedNames = names.map((name) => name.toLocaleLowerCase('vi'));
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    warnings.push('Một hoặc nhiều tên Facebook Kiosk bị lặp trong biểu mẫu.');
  }
  if (state.mode === 'multiple' && customerName
    && normalizedNames.includes(customerName.toLocaleLowerCase('vi'))) {
    warnings.push('Tên người liên hệ trùng với tên một Kiosk; vui lòng kiểm tra lại.');
  }

  if (warningElement) {
    warningElement.textContent = warnings.join(' ');
    warningElement.classList.toggle('hidden', warnings.length === 0);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (state.isSubmitting) return;
  clearError();

  const form = event.currentTarget;
  if (!validateForm(form)) return;

  state.isSubmitting = true;
  const button = document.getElementById('legacy-save-button');
  button.disabled = true;
  button.textContent = 'Đang kiểm tra...';
  try {
    await checkWarningsAndDuplicates();
    await submitPublicLegacyRequest();
  } catch (error) {
    showError(error?.message || 'Không thể gửi yêu cầu do lỗi hệ thống. Vui lòng thử lại sau.');
  } finally {
    state.isSubmitting = false;
    button.disabled = false;
    button.textContent = 'Kiểm tra và gửi';
  }
}

function validateForm(form) {
  clearFieldValidity(form);

  for (const element of [...form.elements]) {
    if (!isVisibleFormControl(element) || !element.required) continue;
    if (element.type === 'checkbox' && !element.checked) {
      const message = element.id === 'legacy-bill-confirmation'
        ? 'Vui lòng xác nhận bạn đã gửi bill thanh toán qua Zalo hỗ trợ.'
        : 'Vui lòng xác nhận các thông tin đã cung cấp là đúng.';
      return failValidation(element, message);
    }
    if (element.type === 'checkbox') continue;
    if (!String(element.value || '').trim()) {
      return failValidation(element, requiredFieldMessage(element));
    }
  }

  const phoneInput = document.getElementById('legacy-customer-phone');
  if (!isValidPhone(phoneInput.value)) {
    return failValidation(phoneInput, 'Số điện thoại không hợp lệ. Vui lòng nhập từ 9 đến 15 chữ số.');
  }

  const customerResolver = document.querySelector('#legacy-customer-section [data-facebook-id-resolver]');
  if (!validateFacebookResolver(customerResolver)) {
    showError('Vui lòng kiểm tra Facebook URL và ID của khách hàng.');
    return false;
  }

  const kiosks = readKiosks();
  if (!kiosks.length) {
    showError('Cần ít nhất một kiosk.');
    document.getElementById('legacy-add-kiosk')?.focus();
    return false;
  }

  const duplicateIds = duplicateValues(kiosks.map((kiosk) => kiosk.facebook_id));

  for (const [index, kiosk] of kiosks.entries()) {
    const card = document.querySelectorAll('[data-legacy-kiosk]')[index];
    const copyCustomer = state.mode === 'single' && document.getElementById('legacy-copy-customer')?.checked;
    const linkInput = copyCustomer
      ? document.getElementById('legacy-customer-link')
      : card?.querySelector('[data-kiosk-field="link"]');
    if (!normalizeFacebookUrl(kiosk.facebook_link)) {
      return failValidation(linkInput, `Kiosk ${index + 1}: link Facebook không hợp lệ.`);
    }
    const resolver = copyCustomer
      ? document.querySelector('#legacy-customer-section [data-facebook-id-resolver]')
      : card?.querySelector('[data-facebook-id-resolver]');
    if (!validateFacebookResolver(resolver)) {
      showError(`Kiosk ${index + 1}: vui lòng kiểm tra Facebook URL và ID.`);
      return false;
    }
    const idInput = copyCustomer
      ? document.getElementById('legacy-customer-id')
      : card?.querySelector('[data-kiosk-field="facebook-id"]');
    if (!isDigits(kiosk.facebook_id)) {
      setInlineError(idInput, 'Facebook ID chỉ được chứa chữ số.');
      return failValidation(idInput, `Kiosk ${index + 1}: Facebook ID là bắt buộc và chỉ gồm chữ số.`);
    }
    if (duplicateIds.has(kiosk.facebook_id)) {
      setInlineError(idInput, 'Facebook ID bị trùng trong biểu mẫu.');
      return failValidation(idInput, `Kiosk ${index + 1}: Facebook ID bị trùng trong biểu mẫu.`);
    }
    if (Number(kiosk.amount) < 0 || !Number.isFinite(Number(kiosk.amount))) {
      return failValidation(
        card?.querySelector('[data-kiosk-field="amount"]'),
        `Kiosk ${index + 1}: số tiền không được âm.`,
      );
    }
    if (!isValidDateOnly(kiosk.start_date) || !isValidDateOnly(kiosk.end_date) || kiosk.end_date < kiosk.start_date) {
      return failValidation(
        card?.querySelector('[data-kiosk-field="end"]'),
        `Kiosk ${index + 1}: ngày hết hạn không được trước ngày đăng ký.`,
      );
    }
  }

  return true;
}

async function submitPublicLegacyRequest() {
  const { data } = await LegacyRegistrationService.createPublicRequest({
    customer: {
      facebook_name: readValue('legacy-customer-name'),
      facebook_id: readValue('legacy-customer-id'),
      facebook_link: readValue('legacy-customer-link'),
      phone: readValue('legacy-customer-phone'),
      note: readValue('legacy-customer-note'),
    },
    kiosks: readKiosks(),
  });
  const requestCode = data?.request_code || data?.requestCode || '';
  document.getElementById('legacy-registration-form')?.classList.add('hidden');
  const success = document.getElementById('legacy-registration-success');
  success.classList.remove('hidden');
  success.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">${renderIcon('check-circle')}</div>
      <div class="empty-state-title">Đã gửi dữ liệu cũ</div>
      <div class="empty-state-message">Ban quản trị sẽ đối chiếu bằng chứng trước khi cập nhật hệ thống.</div>
    </div>
    <div class="registration-summary">
      <div class="setting-item"><span class="setting-name">Mã yêu cầu</span><span class="setting-value">${escapeHtml(requestCode || 'Được cấp khi tiếp nhận')}</span></div>
      <div class="setting-item"><span class="setting-name">Số Kiosk</span><span class="setting-value">${escapeHtml(String(data?.count || readKiosks().length))}</span></div>
      <div class="setting-item"><span class="setting-name">Trạng thái</span><span class="badge badge-pending">Chờ duyệt</span></div>
      <div class="setting-item"><span class="setting-name">Bước tiếp theo</span><span class="setting-value">Ban quản trị kiểm tra bill và liên hệ lại.</span></div>
    </div>`;
  Toast.show(`Đã gửi yêu cầu #${requestCode}.`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearFieldValidity(form) {
  [...form.elements].forEach((element) => {
    if (typeof element.setCustomValidity === 'function') element.setCustomValidity('');
  });
}

function isVisibleFormControl(element) {
  return !element.disabled && element.type !== 'hidden' && !element.closest('.hidden');
}

function requiredFieldMessage(element) {
  const label = element.closest('label')?.querySelector('span')?.textContent?.replace(/\s*\*$/, '').trim();
  return label ? `Vui lòng nhập ${label}.` : 'Vui lòng điền trường bắt buộc này.';
}

function failValidation(element, message) {
  if (element && typeof element.setCustomValidity === 'function') {
    element.setCustomValidity(message);
  }
  showError(message);
  focusInvalidField(element);
  return false;
}

function focusInvalidField(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    element.focus({ preventScroll: true });
    element.reportValidity?.();
  }, 150);
}

function readKiosks() {
  const copyCustomer = state.mode === 'single' && document.getElementById('legacy-copy-customer')?.checked;
  return [...document.querySelectorAll('[data-legacy-kiosk]')].map((card) => ({
    facebook_name: copyCustomer ? readValue('legacy-customer-name') : nestedValue(card, 'name'),
    facebook_id: copyCustomer ? readValue('legacy-customer-id') : nestedValue(card, 'facebook-id'),
    facebook_link: copyCustomer ? readValue('legacy-customer-link') : nestedValue(card, 'link'),
    category_id: card.querySelector('[data-kiosk-category]')?.value || '',
    business_type_id: nestedValue(card, 'business-type'),
    amount: nestedValue(card, 'amount'),
    start_date: nestedValue(card, 'start'),
    end_date: nestedValue(card, 'end'),
    note: nestedValue(card, 'note'),
  }));
}

function bindZaloActions() {
  const configured = getOrganizationSetting('zalo_url').trim();
  const directUrl = isConfiguredUrl(configured) ? configured : '';
  const zaloNumber = extractZaloNumber(configured);
  const contactUrl = directUrl || (zaloNumber ? `https://zalo.me/${encodeURIComponent(zaloNumber)}` : '');
  const numberElement = document.getElementById('legacy-zalo-number');
  const unavailable = document.getElementById('legacy-zalo-unavailable');
  const link = document.getElementById('legacy-zalo-button');
  const copyButton = document.getElementById('legacy-copy-zalo');

  if (numberElement) numberElement.textContent = zaloNumber || 'Đang cập nhật';
  unavailable?.classList.toggle('hidden', Boolean(contactUrl));
  if (link && contactUrl) {
    link.href = contactUrl;
    link.removeAttribute('aria-disabled');
  } else if (link) {
    link.classList.add('disabled');
    link.addEventListener('click', (event) => event.preventDefault());
  }
  if (copyButton && zaloNumber) {
    copyButton.disabled = false;
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(zaloNumber);
        Toast.show('Đã sao chép số Zalo hỗ trợ.');
      } catch {
        Toast.show('Không thể sao chép tự động. Vui lòng sao chép số Zalo trên màn hình.');
      }
    });
  }
}

function isConfiguredUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function extractZaloNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isConfiguredUrl(raw)) {
    const normalized = raw.replace(/[^\d+]/g, '');
    return /^\+?\d{9,15}$/.test(normalized) ? normalized : '';
  }
  try {
    const pathNumber = new URL(raw).pathname.split('/').filter(Boolean).find((part) => /^\d{9,15}$/.test(part));
    return pathNumber || '';
  } catch {
    return '';
  }
}

function field(label, id, options = {}) {
  return `<label class="form-group"><span>${escapeHtml(label)}${options.required ? ' *' : ''}</span><input class="form-control" id="${id}" ${inputAttributes(options)} /></label>`;
}

function nestedField(label, name, options = {}) {
  return `<label class="form-group"><span>${escapeHtml(label)}${options.required ? ' *' : ''}</span><input class="form-control" data-kiosk-field="${name}" ${inputAttributes(options)} /></label>`;
}

function inputAttributes(options) {
  return [
    `type="${options.type || 'text'}"`,
    `value="${escapeHtml(options.value || '')}"`,
    options.required ? 'required' : '',
    options.inputmode ? `inputmode="${options.inputmode}"` : '',
    options.pattern ? `pattern="${options.pattern}"` : '',
    options.min != null ? `min="${options.min}"` : '',
    options.step ? `step="${options.step}"` : '',
    options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : '',
    options.autocomplete ? `autocomplete="${options.autocomplete}"` : 'autocomplete="off"',
  ].filter(Boolean).join(' ');
}

function nestedValue(card, name) {
  if (name === 'business-type') return card.querySelector('[data-kiosk-business-type]')?.value || '';
  if (name === 'amount') return String(parseCurrencyInput(card.querySelector('[data-kiosk-field="amount"]')?.value));
  return card.querySelector(`[data-kiosk-field="${name}"]`)?.value.trim() || '';
}

function readValue(id) {
  return document.getElementById(id)?.value.trim() || '';
}

function isValidPhone(value) {
  const normalized = String(value || '').replace(/[\s().-]/g, '');
  return /^\+?\d{9,15}$/.test(normalized);
}

function showError(message) {
  const element = document.getElementById('legacy-registration-error');
  if (!element) return;
  element.textContent = message;
  element.classList.remove('hidden');
}

function clearError() {
  document.getElementById('legacy-registration-error')?.classList.add('hidden');
}

function clearMessages() {
  clearError();
  document.getElementById('legacy-registration-warning')?.classList.add('hidden');
}

function sortVietnamese(items) {
  return [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi', { sensitivity: 'base' }));
}
