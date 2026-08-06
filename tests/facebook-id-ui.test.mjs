import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFacebookIdResolvers, FacebookIdResolverFields } from '../src/components/FacebookIdResolver.js';

function createResolverFixture({ manualFallback = 'always' } = {}) {
  const listeners = {};
  const urlInput = { value: 'https://facebook.com/example', focus() {} };
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
    dataset: { manualFallback },
    querySelector(selector) { return elements[selector] || null; },
  };
  const container = {
    querySelectorAll() { return [root]; },
  };
  bindFacebookIdResolvers(container);
  return { button, idInput, listeners, status };
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
