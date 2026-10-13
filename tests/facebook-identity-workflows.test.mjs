import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateFacebookResolver } from '../src/components/FacebookIdResolver.js';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Customer CREATE and EDIT use the shared automatic resolver without dropping stored values', async () => {
  const form = await source('src/components/CustomerForm.js');
  assert.match(form, /nameTarget: '#customer-facebook-name'/);
  assert.match(form, /autoResolve: true/);
  assert.match(form, /validateFacebookResolver\(resolver, \{ requireId: false \}\)/);
  assert.match(form, /customer\?\.facebook_name \|\| ''/);
  assert.match(form, /customer\?\.facebook_id \|\| ''/);
  assert.match(form, /customerFacebookLink\(customer\)/);
  assert.match(form, /CustomerService\.findDuplicates/);
});

test('Kiosk CREATE, additional registration and EDIT share automatic lookup and duplicate checks', async () => {
  const [create, edit] = await Promise.all([
    source('src/components/KioskForm.js'),
    source('src/components/KioskEditForm.js'),
  ]);
  assert.match(create, /nameTarget: '#add-kiosk-facebook-name'/);
  assert.match(create, /validateFacebookResolver/);
  assert.match(create, /KioskService\.isFacebookIdInUse/);
  assert.match(create, /RegistrationService\.submitExistingCustomerKiosk/);
  assert.match(edit, /nameTarget: '#kiosk-edit-name'/);
  assert.match(edit, /state\.kiosk\?\.facebook_id \|\| ''/);
  assert.match(edit, /KioskService\.isFacebookIdInUse\(payload\.facebook_id, state\.kiosk\?\.id\)/);
  assert.doesNotMatch(create, /customer\.facebook_id\s*=/);
});

test('public multi-Kiosk identities remain card-scoped and require a numeric manual fallback', async () => {
  const register = await source('src/pages/RegisterPage.js');
  assert.match(register, /prefix: `register-kiosk-\$\{id\}`/);
  assert.match(register, /bindFacebookIdResolvers\(card\)/);
  assert.match(register, /return usesCustomerFacebook\(card\)\s*\? customerFacebookIdentity\(\)/);
  assert.match(register, /validateFacebookResolver\(card\.querySelector\('\[data-facebook-id-resolver\]'\)\)/);
  assert.match(register, /!identity\.facebook_name \|\| !identity\.facebook_link \|\| !identity\.facebook_id/);
  assert.match(register, /duplicateValues\(cards\.map/);
});

test('Legacy customer and every independent Kiosk retain manual resolver support', async () => {
  const legacy = await source('src/pages/LegacyRegistrationPage.js');
  assert.ok((legacy.match(/manualFallback: 'always'/g) || []).length >= 3);
  assert.match(legacy, /validateFacebookResolver\(customerResolver\)/);
  assert.match(legacy, /card\?\.querySelector\('\[data-facebook-id-resolver\]'\)/);
  assert.match(legacy, /duplicateValues\(kiosks\.map\(\(kiosk\) => kiosk\.facebook_id\)\)/);
  assert.match(legacy, /LegacyRegistrationService\.createPublicRequest/);
});

test('a changed URL cannot silently keep its previously associated Facebook ID', () => {
  const error = { textContent: '', classList: { toggle() {} } };
  const urlInput = { value: 'https://facebook.com/new-account', setCustomValidity() {} };
  const idInput = { value: '', setCustomValidity(message) { this.message = message; } };
  const root = {
    dataset: {
      manualFallback: 'always', staleIdentity: 'true', initialId: '100001234567890',
      resolvedId: '100001234567890', resolvedUrl: 'https://facebook.com/old-account',
    },
    querySelector(selector) {
      if (selector === 'input[type="url"]') return urlInput;
      if (selector === 'input[inputmode="numeric"]') return idInput;
      if (selector === '[data-facebook-id-error]') return error;
      return null;
    },
  };
  assert.equal(validateFacebookResolver(root, { requireId: false }), false);
  assert.match(error.textContent, /Link Facebook đã thay đổi/);
  idInput.value = '100009999999999';
  root.dataset.staleIdentity = 'false';
  assert.equal(validateFacebookResolver(root), true);
});

test('Facebook lookup endpoint has no payment, activation, database or migration side effects', async () => {
  const endpoint = await source('api/facebook-id.js');
  assert.doesNotMatch(endpoint, /supabase|payment|payos|kiosk.*(?:insert|update)|migration/i);
  assert.match(endpoint, /Cache-Control', 'no-store'/);
  assert.match(endpoint, /FACEBOOK_ID_PROVIDER_BLOCKED/);
});
