import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findBusinessSuggestions, normalizeBusinessSearch } from '../src/components/BusinessDiscovery.js';
import { RegistrationService } from '../src/services/RegistrationService.js';

test('business discovery is accent and case insensitive', () => {
  assert.equal(normalizeBusinessSearch('BÁN Hoa'), 'ban hoa');
  assert.equal(normalizeBusinessSearch('Cà phê'), 'ca phe');
});

test('business discovery matches type, category, and description while preserving their IDs', () => {
  const categories = [{ id: 7, name: 'Dịch vụ' }, { id: 8, name: 'Ẩm thực' }];
  const types = [
    { id: 70, category_id: 7, name: 'Cửa hàng hoa', description: 'Bán hoa tươi', price_per_month: 150000 },
    { id: 80, category_id: 8, name: 'Quán cà phê', price_per_month: 200000 },
  ];
  const byType = findBusinessSuggestions('ban hoa', categories, types);
  assert.equal(byType[0].businessType.id, 70);
  assert.equal(byType[0].category.id, 7);
  const byCategory = findBusinessSuggestions('am thuc', categories, types);
  assert.equal(byCategory[0].businessType.id, 80);
  assert.deepEqual(findBusinessSuggestions('khong ton tai', categories, types), []);
});

test('registration V2 keeps category and business type separate and preserves production integrations', async () => {
  const source = await readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8');
  assert.match(source, /category_id: card\.querySelector/);
  assert.match(source, /business_type_id: value\(card, 'business-type'\)/);
  assert.match(source, /RegistrationService\.submitWithPayos/);
  assert.match(source, /discount: 0/);
  assert.match(source, /type="number" data-kiosk-months min="1" max="120" step="1"/);
  assert.doesNotMatch(source, /\[1, 3, 6, 12\]\.map/);
  assert.match(source, /data-registration-panel="1"/);
  assert.match(source, /data-registration-panel="2"/);
  assert.match(source, /data-registration-panel="3"/);
});

test('arbitrary registration months preserve the existing pricing calculation', () => {
  const businessType = { id: 70, category_id: 7, name: 'Cửa hàng hoa', price_per_month: 150000 };
  for (const months of [1, 2, 4, 7, 12]) {
    const preview = RegistrationService.calculatePreview(businessType, { months });
    assert.equal(preview.months, months);
    assert.equal(preview.subtotal, months * 150000);
    assert.equal(preview.totalAmount, months * 150000);
  }
});

test('single Kiosk reuses the Step 1 Facebook identity without rendering a second resolver', async () => {
  const source = await readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8');
  assert.match(source, /const isFirst = list\.children\.length === 0/);
  assert.match(source, /isFirst \? '' : independentFacebookFields\(id\)/);
  assert.match(source, /return usesCustomerFacebook\(card\)\s*\? customerFacebookIdentity\(\)/);
  assert.match(source, /const identity = kioskFacebookIdentity\(card\)/);
});

test('multi Kiosk first card can switch between customer and independent Facebook', async () => {
  const source = await readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8');
  assert.match(source, /data-use-customer-facebook checked/);
  assert.match(source, /Dùng Facebook của người đăng ký/);
  assert.match(source, /independent\.innerHTML = independentFacebookFields/);
  assert.match(source, /bindFacebookIdResolvers\(independent\)/);
});

test('resolver success explicitly clears stale name and ID validity state', async () => {
  const source = await readFile(new URL('../src/components/FacebookIdResolver.js', import.meta.url), 'utf8');
  assert.match(source, /nameInput\.setCustomValidity\?\.\(''\)/);
  assert.match(source, /nameInput\.removeAttribute\?\.\('aria-invalid'\)/);
  assert.match(source, /idInput\.setCustomValidity\?\.\(''\)/);
  assert.match(source, /data-facebook-identity-summary/);
});

test('discount checkout is visibly in maintenance while submitted kiosk discounts remain zero', async () => {
  const source = await readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8');
  assert.match(source, /Mã giảm giá đang được bảo trì và sẽ sớm hoạt động trở lại\./);
  assert.doesNotMatch(source, /applyPromotion|evaluate-promotion|state\.promotion/);
  assert.deepEqual([...source.matchAll(/discount:\s*([^,}]+)/g)].map((match) => match[1].trim()), ['0']);
});
