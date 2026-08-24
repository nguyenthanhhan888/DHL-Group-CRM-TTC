import { FacebookIdService } from '../services/FacebookIdService.js';
import { Modal } from './Modal.js';
import { renderIcon } from '../utils/icons.js';

export function FacebookIdResolverFields({
  urlId = '',
  idId = '',
  urlAttributes = '',
  idAttributes = '',
  requiredUrl = false,
  requiredId = true,
  manualFallback = 'always',
  prefix = '',
  urlLabel = 'Link Facebook',
  idLabel = 'Facebook ID',
  buttonLabel = 'Lấy Facebook ID',
  helperText: customHelperText = '',
  autoResolve = false,
  nameTarget = '',
} = {}) {
  const scope = prefix || urlId || idId;
  const isManualDisabled = manualFallback === 'never';
  const isManualLockedUntilError = manualFallback === 'on-error';
  const readonlyAttribute = isManualDisabled || isManualLockedUntilError ? 'readonly' : '';
  const manualHint = isManualDisabled
    ? ''
    : '<small class="field-optional">Có thể nhập thủ công</small>';
  const helperText = customHelperText || (isManualDisabled
    ? 'Dán link Facebook rồi bấm lấy ID. Hệ thống sẽ tự lưu ID lấy được từ link.'
    : 'Nên lấy ID tự động. Chỉ nhập thủ công khi không thể lấy tự động.');
  return `
    <div class="facebook-id-resolver" data-facebook-id-resolver="${scope}"
      data-manual-fallback="${manualFallback}" data-auto-resolve="${autoResolve}" data-name-target="${nameTarget}" data-resolver-state="idle">
      <div class="form-group">
        <div class="field-label-row">
          <span>${urlLabel}${requiredUrl ? ' *' : ''}</span>
          <button type="button" class="fb-help-trigger-btn" data-fb-help-btn aria-label="Hướng dẫn lấy link Facebook">Không biết lấy Link Facebook? Xem hướng dẫn</button>
        </div>
        <input class="form-control" ${urlId ? `id="${urlId}"` : ''} ${urlAttributes}
          type="url" inputmode="url" autocomplete="url" placeholder="https://facebook.com/..." ${requiredUrl ? 'required' : ''} />
      </div>
      <div class="facebook-id-resolver-row resolver-secondary-fields">
        <label class="form-group">
          <span>${idLabel} ${manualHint}</span>
          <input class="form-control" ${idId ? `id="${idId}"` : ''} ${idAttributes}
            type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
            placeholder="ID tự động hoặc nhập số"
            ${requiredId ? 'required' : ''} ${readonlyAttribute} />
          <span class="field-error hidden" data-facebook-id-error></span>
        </label>
        <button class="btn-secondary facebook-id-resolve-button" type="button" data-facebook-id-resolve>
          ${buttonLabel}
        </button>
      </div>
      <div class="facebook-id-resolver-status muted-text" data-facebook-id-status aria-live="polite"></div>
      <div class="facebook-identity-summary hidden" data-facebook-identity-summary aria-live="polite"></div>
      <div class="field-helper">${helperText}</div>
    </div>
  `;
}

export function bindFacebookIdResolvers(container = document) {
  container.querySelectorAll('[data-facebook-id-resolver]').forEach((root) => {
    if (root.dataset.facebookIdBound === 'true') return;
    root.dataset.facebookIdBound = 'true';

    const helpBtn = root.querySelector('[data-fb-help-btn]');
    helpBtn?.addEventListener?.('click', () => {
      Modal.open({
        title: 'Hướng dẫn lấy Link Facebook',
        className: 'modal-facebook-help',
        body: `
          <div class="fb-help-modal-flow">
            <p class="fb-help-intro">Thực hiện các bước sau trên trang Facebook bạn muốn đăng ký.</p>
            <div class="fb-help-step">
              <span class="fb-step-badge">1</span>
              <div class="fb-step-body">
                <strong>Mở Facebook</strong>
                <p>Mở ứng dụng Facebook hoặc website Facebook trên thiết bị của bạn.</p>
              </div>
            </div>
            <div class="fb-help-step">
              <span class="fb-step-badge">2</span>
              <div class="fb-step-body">
                <strong>Mở trang cá nhân hoặc Fanpage</strong>
                <p>Truy cập đúng trang Facebook của Kiosk cần đăng ký.</p>
              </div>
            </div>
            <div class="fb-help-step">
              <span class="fb-step-badge">3</span>
              <div class="fb-step-body">
                <strong>Nhấn dấu ba chấm hoặc Chia sẻ</strong>
                <p>Mở menu của trang cá nhân hoặc Fanpage.</p>
              </div>
            </div>
            <div class="fb-help-step">
              <span class="fb-step-badge">4</span>
              <div class="fb-step-body">
                <strong>Chọn Sao chép liên kết</strong>
                <p>Ưu tiên sao chép link trang cá nhân hoặc Fanpage chính thức, không dùng link bài viết.</p>
              </div>
            </div>
            <div class="fb-help-step">
              <span class="fb-step-badge">5</span>
              <div class="fb-step-body">
                <strong>Quay lại và dán Link Facebook</strong>
                <p>Facebook Name và Facebook ID sẽ được nhận diện tự động.</p>
              </div>
            </div>
            <div class="notice info fb-help-example">
              <strong>Ví dụ liên kết hợp lệ</strong>
              <code>https://facebook.com/ten.nguoi.dung</code>
              <code>https://facebook.com/profile.php?id=1000...</code>
            </div>
          </div>
        `,
      });
    });

    const urlInput = root.querySelector('input[type="url"]');
    const idInput = root.querySelector('input[inputmode="numeric"]');
    const button = root.querySelector('[data-facebook-id-resolve]');
    const status = root.querySelector('[data-facebook-id-status]');
    const errorElement = root.querySelector('[data-facebook-id-error]');
    const identitySummary = root.querySelector('[data-facebook-identity-summary]');
    if (!urlInput || !idInput || !button || !status) return;
    if (!idInput.dataset) idInput.dataset = {};

    const originalLabel = button.textContent.trim() || 'Lấy Facebook ID';
    const autoResolve = root.dataset.autoResolve === 'true';
    let debounceTimer = null;
    let requestId = 0;
    let queuedAutoResolve = false;
    const manualFallback = root.dataset.manualFallback || 'always';
    const hasManualFallback = manualFallback !== 'never';
    const allowManual = () => {
      if (manualFallback === 'on-error') idInput.readOnly = false;
    };
    const markUnverified = (
      message = hasManualFallback
        ? 'URL đã thay đổi. Vui lòng lấy lại ID hoặc xác nhận bằng cách nhập ID thủ công.'
        : 'URL đã thay đổi. Vui lòng lấy lại ID từ link mới.',
    ) => {
      const previousResolvedName = root.dataset.resolvedName;
      root.dataset.resolverState = 'idle';
      root.dataset.resolvedUrl = '';
      root.dataset.resolvedName = '';
      idInput.dataset.verifiedUrl = '';
      identitySummary?.classList.add('hidden');
      if (identitySummary) identitySummary.innerHTML = '';
      if (idInput.value === root.dataset.resolvedId) idInput.value = '';
      const nameInput = root.dataset.nameTarget
        ? (root.closest('[data-register-kiosk], [data-legacy-kiosk], form') || document).querySelector(root.dataset.nameTarget)
        : null;
      if (nameInput) {
        if (previousResolvedName && nameInput.value === previousResolvedName) nameInput.value = '';
        nameInput.readOnly = false;
        nameInput.setCustomValidity?.('');
        nameInput.removeAttribute?.('aria-invalid');
      }
      if (manualFallback === 'never' || manualFallback === 'on-error') idInput.readOnly = true;
      setStatus(status, 'warning', message);
      button.textContent = originalLabel;
    };

    urlInput.addEventListener?.('input', () => {
      const normalized = urlInput.value.trim();
      if (button.dataset.loading === 'true') requestId += 1;
      if (root.dataset.resolvedUrl && normalized !== root.dataset.resolvedUrl) markUnverified();
      if (!autoResolve) return;
      clearTimeout(debounceTimer);
      if (!normalized) {
        queuedAutoResolve = false;
        setStatus(status, '', '');
        return;
      }
      debounceTimer = setTimeout(() => resolveUrl({ queueIfBusy: true }), 650);
    });

    idInput.addEventListener?.('input', () => {
      idInput.value = idInput.value.trim();
      const valid = !idInput.value || /^\d+$/.test(idInput.value);
      errorElement?.classList.toggle('hidden', valid);
      if (errorElement) errorElement.textContent = valid ? '' : 'Facebook ID chỉ được chứa chữ số.';
      if (idInput.value !== root.dataset.resolvedId) {
        root.dataset.resolverState = 'manual';
        idInput.dataset.verifiedUrl = '';
      }
    });

    button.addEventListener('click', () => resolveUrl({ focusInvalid: true }));

    async function resolveUrl({ focusInvalid = false, queueIfBusy = false } = {}) {
      if (button.dataset.loading === 'true') {
        if (queueIfBusy) queuedAutoResolve = true;
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = null;
      const facebookUrl = urlInput.value.trim();
      if (!facebookUrl) {
        root.dataset.resolverState = 'invalid-url';
        setStatus(status, 'error', 'Vui lòng nhập Facebook URL trước.');
        if (focusInvalid) urlInput.focus();
        return;
      }

      const currentRequest = ++requestId;
      button.dataset.loading = 'true';
      root.dataset.resolverState = 'loading';
      root.dataset.resolvedName = '';
      idInput.setCustomValidity?.('');
      if (errorElement) {
        errorElement.textContent = '';
        errorElement.classList.add('hidden');
      }
      identitySummary?.classList.add('hidden');
      button.disabled = true;
      button.textContent = 'Đang lấy ID...';
      setStatus(status, 'loading', 'Đang kiểm tra Facebook URL...');

      try {
        const result = await FacebookIdService.resolve(facebookUrl);
        if (currentRequest !== requestId || facebookUrl !== urlInput.value.trim()) return;
        idInput.value = result.facebookId;
        idInput.readOnly = manualFallback === 'never';
        root.dataset.resolverState = 'success';
        root.dataset.resolvedId = result.facebookId;
        root.dataset.resolvedUrl = result.facebookUrl || facebookUrl;
        root.dataset.resolvedName = result.facebookName || '';
        if (result.facebookUrl) urlInput.value = result.facebookUrl;
        const nameInput = root.dataset.nameTarget
          ? (root.closest('[data-register-kiosk], [data-legacy-kiosk], form') || document).querySelector(root.dataset.nameTarget)
          : null;
        if (nameInput && result.facebookName) {
          nameInput.value = result.facebookName;
          nameInput.readOnly = true;
          nameInput.setCustomValidity?.('');
          nameInput.removeAttribute?.('aria-invalid');
          const nameError = nameInput.closest?.('.form-group')?.querySelector?.('.field-error');
          if (nameError) {
            nameError.textContent = '';
            nameError.classList.add('hidden');
          }
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (typeof CustomEvent === 'function') {
          root.dispatchEvent?.(new CustomEvent('facebook-id-resolved', { bubbles: true, detail: result }));
        }
        idInput.dataset.verifiedUrl = result.facebookUrl || facebookUrl;
        idInput.setCustomValidity?.('');
        idInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (identitySummary) {
          identitySummary.classList.remove('hidden');
          identitySummary.innerHTML = `<span class="facebook-identity-icon">${renderIcon('check-circle')}</span><div><strong>Đã xác thực Facebook</strong>${result.facebookName ? `<b>${escapeIdentity(result.facebookName)}</b>` : ''}<small>Facebook ID: ${escapeIdentity(result.facebookId)}</small><small>${escapeIdentity(result.facebookUrl || facebookUrl)}</small></div>`;
        }
        setStatus(status, 'success', result.facebookName
          ? `Đã nhận diện Facebook: ${result.facebookName} · ID ${result.facebookId}`
          : `Đã nhận diện Facebook ID: ${result.facebookId}`);
        button.textContent = 'Lấy lại Facebook ID';
      } catch (error) {
        if (currentRequest !== requestId) return;
        const state = resolverErrorState(error?.code);
        root.dataset.resolverState = state;
        allowManual();
        const nameInput = root.dataset.nameTarget
          ? (root.closest('[data-register-kiosk], [data-legacy-kiosk], form') || document).querySelector(root.dataset.nameTarget)
          : null;
        if (nameInput) nameInput.readOnly = false;
        identitySummary?.classList.add('hidden');
        setStatus(status, 'error', friendlyResolverMessage(error));
        button.textContent = 'Thử lại';
      } finally {
        button.dataset.loading = 'false';
        button.disabled = false;
        if (queuedAutoResolve) {
          queuedAutoResolve = false;
          void resolveUrl();
        }
      }
    }
  });
}

function escapeIdentity(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function friendlyResolverMessage(error) {
  if (['INVALID_URL', 'INVALID_FACEBOOK_DOMAIN'].includes(error?.code)) return 'Link này chưa được hỗ trợ. Hãy sao chép link trang cá nhân hoặc Fanpage.';
  if (error?.code === 'FACEBOOK_ID_NOT_FOUND') return 'Không thể nhận diện link này. Hãy thử link trang cá nhân hoặc Fanpage chính thức, hoặc nhập ID thủ công.';
  if (error?.code === 'UPSTREAM_TIMEOUT') return 'Quá trình xác thực mất quá nhiều thời gian. Vui lòng thử lại.';
  return 'Không thể xác thực Link Facebook. Vui lòng thử lại.';
}

function setStatus(element, state, message) {
  element.className = `facebook-id-resolver-status ${state}`;
  element.textContent = message;
}

function resolverErrorState(code) {
  if (['FACEBOOK_URL_REQUIRED', 'INVALID_URL', 'INVALID_FACEBOOK_DOMAIN'].includes(code)) return 'invalid-url';
  if (code === 'FACEBOOK_ID_NOT_FOUND') return 'not-found';
  if (code === 'UPSTREAM_TIMEOUT') return 'timeout';
  return 'upstream-error';
}

export function validateFacebookResolver(root, { requireVerifiedOrManual = true, requireId = true } = {}) {
  const urlInput = root?.querySelector('input[type="url"]');
  const idInput = root?.querySelector('input[inputmode="numeric"]');
  const error = root?.querySelector('[data-facebook-id-error]');
  const url = urlInput?.value.trim() || '';
  const id = idInput?.value.trim() || '';
  const hasManualFallback = root?.dataset?.manualFallback !== 'never';
  let message = '';

  if (!url) message = 'Facebook URL là bắt buộc.';
  else {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (!['http:', 'https:'].includes(parsed.protocol)
        || !(host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com' || host.endsWith('.fb.com'))) {
        message = 'Facebook URL không hợp lệ.';
      }
    } catch {
      message = 'Facebook URL không hợp lệ.';
    }
  }
  if (!message && requireId && !id) message = 'Facebook ID là bắt buộc.';
  if (!message && id && !/^\d+$/.test(id)) message = 'Facebook ID chỉ được chứa chữ số.';
  if (!message && requireVerifiedOrManual && root.dataset.resolvedUrl
    && root.dataset.resolvedUrl !== url && id === root.dataset.resolvedId) {
    message = hasManualFallback
      ? 'ID này thuộc URL cũ. Vui lòng lấy lại ID hoặc nhập lại thủ công.'
      : 'ID này thuộc URL cũ. Vui lòng lấy lại ID từ link mới.';
  }

  if (error) {
    error.textContent = message;
    error.classList.toggle('hidden', !message);
  }
  if (!message) {
    idInput?.setCustomValidity?.('');
    urlInput?.setCustomValidity?.('');
  }
  (message ? (idInput || urlInput) : null)?.setCustomValidity?.(message);
  return !message;
}
