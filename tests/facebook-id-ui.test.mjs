import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from '../src/components/FacebookIdResolver.js';

function createResolverFixture({ manualFallback = 'always', autoResolve = false } = {}) {
  const listeners = {};
  const urlListeners = {};
  const urlInput = {
    value: 'https://facebook.com/example',
    focus() {},
    addEventListener(type, listener) { urlListeners[type] = listener; },
  };
  const idInput = {
    value: '',
    readOnly: manualFallback === 'never' || manualFallback === 'on-error',
    dispatchEvent() {},
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
    dataset: { manualFallback, autoResolve: String(autoResolve) },
    querySelector(selector) { return elements[selector] || null; },
  };
  const container = {
    querySelectorAll() { return [root]; },
  };
  bindFacebookIdResolvers(container);
  return { button, idInput, listeners, status, urlInput, urlListeners };
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
