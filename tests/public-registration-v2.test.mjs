import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { findBusinessSuggestions, normalizeBusinessSearch } from '../src/components/BusinessDiscovery.js';
import { RegistrationService } from '../src/services/RegistrationService.js';

test('public stepper uses three responsive segments without connector lines', async () => {
  const css = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.public-site \.registration-step[^{}]*::after/);
  assert.match(css, /\.public-site \.registration-stepper \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\); gap:12px/);
  assert.match(css, /\.public-site \.registration-step \{[^}]*min-width:0;[^}]*background:var\(--bg-muted\);[^}]*border:1px solid var\(--border-default\)/);
  assert.match(css, /\.public-site \.registration-step.active \{[^}]*background:var\(--primary-soft\); border-color:var\(--primary\)/);
  assert.match(css, /\.public-site \.registration-step.completed \{[^}]*background:var\(--success-bg\); border-color:var\(--success-border\)/);
  assert.match(css, /\.public-site \.registration-stepper \{[^}]*gap:6px; width:100%/);
  assert.match(css, /\.public-site \.registration-step strong \{[^}]*white-space:normal/);
});

test('Register keeps its checkout stepper while Legacy remains one simpler form', async () => {
  const [register, legacy] = await Promise.all([
    readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LegacyRegistrationPage.js', import.meta.url), 'utf8'),
  ]);
  assert.match(register, /class="registration-stepper"/);
  assert.doesNotMatch(legacy, /legacy-stepper/);
  assert.equal((legacy.match(/<form id="legacy-registration-form"/g) || []).length, 1);
  assert.doesNotMatch(legacy, /data-registration-panel|data-next-step|data-previous-step/);
  assert.doesNotMatch(register, /PublicSupport/);
  assert.doesNotMatch(legacy, /PublicSupport/);
});

test('stepper keeps labels, accessible list, active state and completed checkmarks through navigation', async () => {
  const source = await readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8');
  assert.match(source, /<ol class="registration-stepper" aria-label="Tiến trình đăng ký">/);
  const labels = [...source.matchAll(/data-step-indicator="(\d)"><span>\d<\/span><strong>([^<]+)<\/strong>/g)];
  assert.deepEqual(labels.map(match => [match[1], match[2]]), [['1', 'Thông tin'], ['2', 'Chọn gói'], ['3', 'Thanh toán']]);
  const indicators = [1, 2, 3].map(number => ({
    dataset: { stepIndicator: String(number) }, classes: {}, marker: {},
    classList: { toggle(name, value) { indicators[number - 1].classes[name] = value; } },
    querySelector() { return this.marker; },
  }));
  const panels = [1, 2, 3].map(number => ({ dataset: { registrationPanel: String(number) },
    classList: { toggle(name, hidden) { panels[number - 1].hidden = hidden; } },
  }));
  const box = vm.createContext({ state: {}, clearFormError() {}, renderReview() {}, document: {
    querySelectorAll: selector => selector === '[data-step-indicator]' ? indicators : panels,
    querySelector: () => ({ scrollIntoView() {} }),
  } });
  vm.runInContext(source.slice(source.indexOf('function goToStep('), source.indexOf('function renderReview(')), box);
  for (const step of [1, 2, 3, 2, 1]) {
    box.goToStep(step);
    indicators.forEach((item, index) => {
      assert.equal(item.classes.active, index + 1 === step);
      assert.equal(item.classes.completed, index + 1 < step);
      assert.equal(item.marker.textContent, index + 1 < step ? '✓' : String(index + 1));
      assert.equal(panels[index].hidden, index + 1 !== step);
    });
  }
});

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

test('discount checkout previews optional promotion while submitted kiosk discounts remain zero', async () => {
  const source = await readFile(new URL('../src/pages/RegisterPage.js', import.meta.url), 'utf8');
  assert.match(source, /applyPromotion/);
  assert.match(source, /evaluate-promotion/);
  assert.match(source, /promotionCode: state\.promotion\?\.code \|\| null/);
  assert.deepEqual([...source.matchAll(/discount:\s*([^,}]+)/g)].map((match) => match[1].trim()), ['0']);
});
