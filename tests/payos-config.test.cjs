const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSupabaseServiceConfig,
  normalizeAppRedirectUrl,
  requirePayosEnabled,
} = require('../api/payos/_utils.js');

function withEnv(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('payOS is fail-closed unless PAYOS_ENABLED is exactly true', () => {
  withEnv({ PAYOS_ENABLED: undefined }, () => {
    assert.throws(requirePayosEnabled, (error) => error.code === 'PAYOS_DISABLED' && error.status === 503);
  });
  withEnv({ PAYOS_ENABLED: 'false' }, () => assert.throws(requirePayosEnabled, /tạm ngừng/));
  withEnv({ PAYOS_ENABLED: 'true' }, () => assert.doesNotThrow(requirePayosEnabled));
});

test('payOS redirects remain on the configured HTTPS APP_BASE_URL origin', () => {
  withEnv({ APP_BASE_URL: 'https://adayroidc.com' }, () => {
    assert.equal(normalizeAppRedirectUrl('/#/register', 'returnUrl'), 'https://adayroidc.com/#/register');
    assert.throws(
      () => normalizeAppRedirectUrl('https://example.net/capture', 'returnUrl'),
      (error) => error.code === 'INVALID_REDIRECT_ORIGIN',
    );
  });
});

test('server Supabase configuration accepts only SUPABASE_SERVICE_ROLE_KEY', () => {
  withEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only',
  }, () => {
    assert.deepEqual(getSupabaseServiceConfig(), {
      url: 'https://example.supabase.co',
      key: 'server-only',
    });
  });
});
