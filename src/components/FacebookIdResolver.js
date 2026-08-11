import { FacebookIdService } from '../services/FacebookIdService.js';

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
      data-manual-fallback="${manualFallback}" data-resolver-state="idle">
      <label class="form-group">
        <span>${urlLabel}${requiredUrl ? ' *' : ''}</span>
        <input class="form-control" ${urlId ? `id="${urlId}"` : ''} ${urlAttributes}
          type="url" inputmode="url" autocomplete="url" ${requiredUrl ? 'required' : ''} />
      </label>
      <div class="facebook-id-resolver-row">
        <label class="form-group">
          <span>${idLabel} ${manualHint}</span>
          <input class="form-control" ${idId ? `id="${idId}"` : ''} ${idAttributes}
            type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
            ${requiredId ? 'required' : ''} ${readonlyAttribute} />
          <span class="field-error hidden" data-facebook-id-error></span>
        </label>
        <button class="btn-secondary facebook-id-resolve-button" type="button" data-facebook-id-resolve>
          ${buttonLabel}
        </button>
      </div>
      <div class="facebook-id-resolver-status muted-text" data-facebook-id-status aria-live="polite"></div>
      <div class="field-helper">${helperText}</div>
    </div>
  `;
}

export function bindFacebookIdResolvers(container = document) {
  container.querySelectorAll('[data-facebook-id-resolver]').forEach((root) => {
    if (root.dataset.facebookIdBound === 'true') return;
    root.dataset.facebookIdBound = 'true';

    const urlInput = root.querySelector('input[type="url"]');
    const idInput = root.querySelector('input[inputmode="numeric"]');
    const button = root.querySelector('[data-facebook-id-resolve]');
    const status = root.querySelector('[data-facebook-id-status]');
    const errorElement = root.querySelector('[data-facebook-id-error]');
    if (!urlInput || !idInput || !button || !status) return;
    if (!idInput.dataset) idInput.dataset = {};

    const originalLabel = button.textContent.trim() || 'Lấy Facebook ID';
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
      root.dataset.resolverState = 'idle';
      root.dataset.resolvedUrl = '';
      root.dataset.resolvedName = '';
      idInput.dataset.verifiedUrl = '';
      if (idInput.value === root.dataset.resolvedId) idInput.value = '';
      if (manualFallback === 'never' || manualFallback === 'on-error') idInput.readOnly = true;
      setStatus(status, 'warning', message);
      button.textContent = originalLabel;
    };

    urlInput.addEventListener?.('input', () => {
      const normalized = urlInput.value.trim();
      if (root.dataset.resolvedUrl && normalized !== root.dataset.resolvedUrl) markUnverified();
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

    button.addEventListener('click', async () => {
      if (button.dataset.loading === 'true') return;
      const facebookUrl = urlInput.value.trim();
      if (!facebookUrl) {
        root.dataset.resolverState = 'invalid-url';
        setStatus(status, 'error', 'Vui lòng nhập Facebook URL trước.');
        urlInput.focus();
        return;
      }

      button.dataset.loading = 'true';
      root.dataset.resolverState = 'loading';
      root.dataset.resolvedName = '';
      button.disabled = true;
      button.textContent = 'Đang lấy ID...';
      setStatus(status, 'loading', 'Đang kiểm tra Facebook URL...');

      try {
        const result = await FacebookIdService.resolve(facebookUrl);
        idInput.value = result.facebookId;
        idInput.readOnly = manualFallback === 'never';
        root.dataset.resolverState = 'success';
        root.dataset.resolvedId = result.facebookId;
        root.dataset.resolvedUrl = facebookUrl;
        root.dataset.resolvedName = result.facebookName || '';
        idInput.dataset.verifiedUrl = facebookUrl;
        idInput.dispatchEvent(new Event('input', { bubbles: true }));
        setStatus(status, 'success', result.facebookName
          ? `Đã lấy ID: ${result.facebookName} * ${result.facebookId}. Vui lòng kiểm tra link rồi tiếp tục lưu.`
          : `Đã lấy ID: ${result.facebookId}. Vui lòng kiểm tra link rồi tiếp tục lưu.`);
        button.textContent = 'Lấy lại Facebook ID';
      } catch (error) {
        const state = resolverErrorState(error?.code);
        root.dataset.resolverState = state;
        allowManual();
        setStatus(status, 'error', error?.message || 'Không thể lấy Facebook ID.');
        button.textContent = 'Thử lại';
      } finally {
        button.dataset.loading = 'false';
        button.disabled = false;
      }
    });
  });
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
  (message ? (idInput || urlInput) : null)?.setCustomValidity?.(message);
  return !message;
}
