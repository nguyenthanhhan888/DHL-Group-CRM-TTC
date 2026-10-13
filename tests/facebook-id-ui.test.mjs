import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindFacebookIdResolvers, FacebookIdResolverFields, validateFacebookResolver } from '../src/components/FacebookIdResolver.js';

const resolverCss = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');

function computedResolverDisplay(target, options = {}) {
  const autoResolve = options.autoResolve ?? true;
  const manualFallback = options.manualFallback || 'on-error';
  const state = options.state || options.resolverState || 'idle';
  const registrationV2 = options.registrationV2 ?? true;
  const attributes = { autoResolve: String(autoResolve), manualFallback, resolverState: state };
  let winner = { specificity: -1, order: -1, display: target === 'row' ? 'grid' : target === 'button' ? 'inline-flex' : 'block' };
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  let order = 0;
  while ((match = rulePattern.exec(resolverCss))) {
    const display = match[2].match(/(?:^|;)\s*display\s*:\s*([^;]+)/)?.[1]?.trim();
    if (!display) continue;
    for (const rawSelector of match[1].split(',')) {
      const selector = rawSelector.trim();
      if (!matchesResolverSelector(selector, target, attributes, registrationV2)) continue;
      const specificity = selectorSpecificity(selector);
      if (specificity > winner.specificity || (specificity === winner.specificity && order >= winner.order)) {
        winner = { specificity, order, display };
      }
    }
    order += 1;
  }
  return winner.display;
}

function matchesResolverSelector(selector, target, attributes, registrationV2) {
  if (!selector.includes('facebook-id-resolver') && !selector.includes('facebook-id-resolver-row')) return false;
  if (selector.includes('.registration-v2') && !registrationV2) return false;
  if (target === 'row' && selector.includes('.form-group')) return false;
  if (target === 'row' && selector.includes('.facebook-id-resolve-button')) return false;
  if (target === 'inputGroup' && !selector.includes('.form-group')) return false;
  if (target === 'button' && !selector.includes('.facebook-id-resolve-button')) return false;
  if (selector.includes(':not([data-manual-fallback="always"])') && attributes.manualFallback === 'always') return false;
  const withoutNot = selector.replace(/:not\([^)]*\)/g, '');
  const attributeMap = {
    'data-auto-resolve': attributes.autoResolve,
    'data-manual-fallback': attributes.manualFallback,
    'data-resolver-state': attributes.resolverState,
  };
  return [...withoutNot.matchAll(/\[([^=\]]+)="([^"]+)"\]/g)]
    .every(([, name, value]) => attributeMap[name] === value);
}

function selectorSpecificity(selector) {
  const normalized = selector.replace(/:not\(([^)]+)\)/g, '$1');
  return (normalized.match(/#[\w-]+/g) || []).length * 100
    + ((normalized.match(/\.[\w-]+/g) || []).length + (normalized.match(/\[[^\]]+\]/g) || []).length
      + (normalized.match(/:(?!:)[\w-]+/g) || []).length) * 10;
}

function createResolverFixture({ manualFallback = 'always', autoResolve = false } = {}) {
  const listeners = {};
  const urlListeners = {};
  const idListeners = {};
  const nameListeners = {};
  const urlInput = {
    value: 'https://facebook.com/example',
    focus() {},
    addEventListener(type, listener) { urlListeners[type] = listener; },
  };
  const idInput = {
    value: '',
    readOnly: manualFallback === 'never' || manualFallback === 'on-error',
    dispatchEvent() {},
    addEventListener(type, listener) { idListeners[type] = listener; },
  };
  const nameInput = {
    value: '', readOnly: false,
    addEventListener(type, listener) { nameListeners[type] = listener; },
    dispatchEvent(event) { nameListeners[event.type]?.(event); },
    setCustomValidity() {}, removeAttribute() {},
  };
  const button = {
    dataset: {},
    disabled: false,
    textContent: 'Lấy Facebook ID',
    addEventListener(type, listener) { listeners[type] = listener; },
  };
  const status = { className: '', textContent: '' };
  const elements = {
    'input[type="url"]': urlInput,
    'input[inputmode="numeric"]': idInput,
    '[data-facebook-id-resolve]': button,
    '[data-facebook-id-status]': status,
  };
  const root = {
    dataset: { manualFallback, autoResolve: String(autoResolve), nameTarget: '#facebook-name' },
    querySelector(selector) { return elements[selector] || null; },
    closest() { return { querySelector: selector => selector === '#facebook-name' ? nameInput : null }; },
  };
  const container = {
    querySelectorAll() { return [root]; },
  };
  bindFacebookIdResolvers(container);
  return { button, idInput, idListeners, listeners, nameInput, nameListeners, root, status, urlInput, urlListeners };
}

test('manual fallback never hides manual copy and keeps ID readonly after resolve', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      facebook_id: '123456789',
      facebook_url: 'https://facebook.com/example',
    }),
  });

  const html = FacebookIdResolverFields({ manualFallback: 'never' });
  assert.doesNotMatch(html, /Có thể nhập thủ công/);
  assert.match(html, /Hệ thống sẽ tự lưu ID/);

  const fixture = createResolverFixture({ manualFallback: 'never' });
  await fixture.listeners.click();
  assert.equal(fixture.idInput.value, '123456789');
  assert.equal(fixture.idInput.readOnly, true);
});

test('double-click sends one request and does not submit the form', async () => {
  let fetchCalls = 0;
  let finishRequest;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    await new Promise((resolve) => { finishRequest = resolve; });
    return {
      ok: true,
      json: async () => ({
        success: true,
        facebook_id: '123456789',
        facebook_url: 'https://facebook.com/example',
      }),
    };
  };

  const fixture = createResolverFixture();
  const firstClick = fixture.listeners.click();
  const secondClick = fixture.listeners.click();
  assert.equal(fetchCalls, 1);
  assert.equal(fixture.button.disabled, true);

  finishRequest();
  await Promise.all([firstClick, secondClick]);
  assert.equal(fixture.idInput.value, '123456789');
  assert.equal(fixture.button.disabled, false);
  assert.match(fixture.status.textContent, /123456789/);
});

test('failed request exposes retry state and keeps manual ID editable', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({
      success: false,
      code: 'FACEBOOK_ID_NOT_FOUND',
      message: 'Không tìm thấy Facebook ID.',
    }),
  });

  const fixture = createResolverFixture();
  fixture.idInput.value = '9988';
  await fixture.listeners.click();
  assert.equal(fixture.button.textContent, 'Thử lại');
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.idInput.value, '9988');
  assert.match(fixture.status.className, /error/);
});

test('URL changed during a request is resolved after debounce and stale data cannot overwrite it', async () => {
  const pending = [];
  globalThis.fetch = async (_url, options) => new Promise((resolve) => {
    pending.push({ requestUrl: JSON.parse(options.body).facebook_url, resolve });
  });

  const fixture = createResolverFixture({ manualFallback: 'on-error', autoResolve: true });
  const firstRequest = fixture.listeners.click();
  fixture.urlInput.value = 'https://facebook.com/newer';
  fixture.urlListeners.input();
  await new Promise((resolve) => setTimeout(resolve, 700));

  assert.equal(pending.length, 1);
  pending[0].resolve({
    ok: true,
    json: async () => ({ success: true, facebook_id: '111', facebook_url: 'https://facebook.com/example' }),
  });
  await firstRequest;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(pending.length, 2);
  assert.equal(pending[1].requestUrl, 'https://facebook.com/newer');
  assert.equal(fixture.idInput.value, '');

  pending[1].resolve({
    ok: true,
    json: async () => ({ success: true, facebook_id: '222', facebook_url: 'https://facebook.com/newer' }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fixture.idInput.value, '222');
  assert.equal(fixture.urlInput.value, 'https://facebook.com/newer');
});

test('manual Facebook ID plus Enter remains visible and cannot submit its parent form', () => {
  const fixture = createResolverFixture({ manualFallback: 'always' });
  fixture.idInput.value = '100001234567890';
  fixture.idListeners.input();
  let prevented = false;
  let stopped = false;
  fixture.idListeners.keydown({
    key: 'Enter',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });
  assert.equal(fixture.idInput.value, '100001234567890');
  assert.equal(fixture.idInput.readOnly, false);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test('manual ID entered while lookup is loading wins over the delayed response', async () => {
  let finishRequest;
  globalThis.fetch = async () => new Promise((resolve) => { finishRequest = resolve; });
  const fixture = createResolverFixture({ manualFallback: 'always' });
  const request = fixture.listeners.click();
  fixture.idInput.value = '100009999999999';
  fixture.idListeners.input();
  finishRequest({
    ok: true,
    json: async () => ({ success: true, facebook_id: '100001111111111', facebook_url: fixture.urlInput.value }),
  });
  await request;
  assert.equal(fixture.idInput.value, '100009999999999');
  assert.equal(fixture.root.dataset.resolverState, 'manual');
});

test('resolved Facebook Name remains editable and manual edits are not overwritten by auto lookup', async () => {
  let responseName = 'Tên tự động';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, facebook_id: '100001234567890', facebook_name: responseName, facebook_url: 'https://facebook.com/example' }),
  });
  const fixture = createResolverFixture({ manualFallback: 'always', autoResolve: true });
  await fixture.listeners.click();
  assert.equal(fixture.nameInput.value, 'Tên tự động');
  assert.equal(fixture.nameInput.readOnly, false);
  fixture.nameInput.value = 'Tên nhập tay';
  fixture.nameListeners.input();
  responseName = 'Tên mới từ API';
  fixture.urlInput.value = 'https://facebook.com/newer';
  fixture.urlListeners.input();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(fixture.nameInput.value, 'Tên nhập tay');
});

test('provider-blocked exposes manual ID and Retry, then manual state stays visible through input, Enter and retry', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: false,
      json: async () => ({
        success: false,
        code: 'FACEBOOK_ID_PROVIDER_BLOCKED',
        message: 'CAPTCHA',
      }),
    };
  };

  const fixture = createResolverFixture({ manualFallback: 'on-error', autoResolve: true });
  await fixture.listeners.click();
  assert.equal(fixture.root.dataset.resolverState, 'provider-blocked');
  assert.equal(fixture.idInput.readOnly, false);
  assert.equal(fixture.button.textContent, 'Thử lại');
  assert.match(fixture.status.textContent, /hạn chế tra cứu tự động/);
  assert.equal(computedResolverDisplay('row', fixture.root.dataset), 'grid');
  assert.notEqual(computedResolverDisplay('inputGroup', fixture.root.dataset), 'none');
  assert.notEqual(computedResolverDisplay('button', fixture.root.dataset), 'none');

  fixture.idInput.value = '100001234567890';
  fixture.idListeners.input();
  assert.equal(fixture.root.dataset.resolverState, 'manual');
  assert.equal(computedResolverDisplay('row', fixture.root.dataset), 'grid');
  assert.equal(fixture.idInput.value, '100001234567890');

  let prevented = false;
  let stopped = false;
  fixture.idListeners.keydown({
    key: 'Enter',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(fixture.idInput.value, '100001234567890');

  await fixture.listeners.click();
  assert.equal(fetchCalls, 2);
  assert.equal(fixture.button.textContent, 'Thử lại');
  assert.equal(fixture.idInput.value, '100001234567890');
  assert.equal(computedResolverDisplay('row', fixture.root.dataset), 'grid');
});

test('every lookup classification keeps Retry and allowed manual identity available', async () => {
  const cases = [
    ['INVALID_FACEBOOK_URL', 'invalid-url', 'Link Facebook không hợp lệ. Vui lòng kiểm tra lại.'],
    ['FACEBOOK_PROFILE_NOT_FOUND', 'not-found', 'Không tìm thấy tài khoản Facebook. Liên kết có thể đã bị xóa hoặc không còn tồn tại.'],
    ['FACEBOOK_ID_PROVIDER_BLOCKED', 'provider-blocked', 'Facebook đang hạn chế tra cứu tự động. Chưa thể xác định trạng thái tài khoản. Bạn có thể nhập Facebook ID thủ công hoặc thử lại.'],
    ['FACEBOOK_LOOKUP_INCONCLUSIVE', 'inconclusive', 'Không thể nhận diện tài khoản từ liên kết này. Vui lòng kiểm tra URL hoặc nhập Facebook ID thủ công.'],
    ['UPSTREAM_TIMEOUT', 'timeout', 'Quá trình xác thực mất quá nhiều thời gian. Vui lòng thử lại.'],
    ['NETWORK_ERROR', 'upstream-error', 'Không thể xác thực Link Facebook. Vui lòng thử lại.'],
  ];

  for (const [code, state, message] of cases) {
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({ success: false, code, message: 'untrusted API detail' }),
    });
    const fixture = createResolverFixture({ manualFallback: 'on-error', autoResolve: true });
    fixture.idInput.value = '100001234567890';
    fixture.nameInput.value = 'Tên nhập tay';
    await fixture.listeners.click();

    assert.equal(fixture.root.dataset.resolverState, state, code);
    assert.equal(fixture.button.textContent, 'Thử lại', code);
    assert.equal(fixture.button.disabled, false, code);
    assert.equal(fixture.idInput.readOnly, false, code);
    assert.equal(fixture.idInput.value, '100001234567890', code);
    assert.equal(fixture.nameInput.value, 'Tên nhập tay', code);
    assert.equal(fixture.status.textContent, message, code);
    assert.equal(computedResolverDisplay('row', fixture.root.dataset), 'grid', code);
    assert.notEqual(computedResolverDisplay('inputGroup', fixture.root.dataset), 'none', code);

    fixture.idInput.value = '100009999999999';
    fixture.idListeners.input();
    assert.equal(fixture.root.dataset.resolverState, 'manual', code);
    assert.equal(fixture.idInput.dataset.verifiedUrl, '', code);
    assert.equal(validateFacebookResolver(fixture.root), true, code);
    assert.equal(fixture.nameInput.value, 'Tên nhập tay', code);
    assert.equal(computedResolverDisplay('row', fixture.root.dataset), 'grid', code);
  }
});

test('resolver CSS visibility matrix preserves always, on-error, never and mobile behavior', () => {
  assert.equal(computedResolverDisplay('row', { manualFallback: 'always', state: 'idle' }), 'grid');
  assert.equal(computedResolverDisplay('row', { manualFallback: 'on-error', state: 'idle' }), 'none');
  for (const state of ['invalid-url', 'not-found', 'timeout', 'upstream-error', 'inconclusive', 'provider-blocked', 'manual']) {
    assert.equal(computedResolverDisplay('row', { manualFallback: 'on-error', state }), 'grid', state);
  }
  assert.equal(computedResolverDisplay('row', { manualFallback: 'never', state: 'idle' }), 'none');
  for (const state of ['invalid-url', 'not-found', 'timeout', 'upstream-error', 'inconclusive', 'provider-blocked']) {
    assert.equal(computedResolverDisplay('row', { manualFallback: 'never', state }), 'grid', state);
    assert.equal(computedResolverDisplay('inputGroup', { manualFallback: 'never', state }), 'none', state);
    assert.notEqual(computedResolverDisplay('button', { manualFallback: 'never', state }), 'none', state);
  }
  assert.match(resolverCss, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.facebook-id-resolver-row\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(resolverCss, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.facebook-id-resolve-button\s*\{[\s\S]*?width:\s*100%/);
});
