const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/ttc/verify-facebook-task.js');

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test('allows Facebook verify bypass on Vercel preview but never production', () => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview',
    FACEBOOK_VERIFY_DEV_BYPASS: 'true',
  };

  assert.equal(handler.__test.isProductionRuntime(), false);
  assert.equal(handler.__test.isDevBypassEnabled(), true);

  process.env.VERCEL_ENV = 'production';

  assert.equal(handler.__test.isProductionRuntime(), true);
  assert.equal(handler.__test.isDevBypassEnabled(), false);
});
