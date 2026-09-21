import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RegisterPage } from '../src/pages/RegisterPage.js';
import { AccountRegisterPage } from '../src/pages/AccountRegisterPage.js';
import { NAV_SECTIONS } from '../src/constants/navigation.js';
import { canAccessRoute } from '../src/constants/permissions.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public Kiosk registration exposes exactly three requested steps', () => {
  const html = RegisterPage();
  assert.equal((html.match(/data-step-indicator=/g) || []).length, 3);
  assert.equal((html.match(/data-registration-panel=/g) || []).length, 3);
  for (const label of ['Thông tin', 'Chọn gói', 'Thanh toán']) assert.match(html, new RegExp(`<strong>${label}</strong>`));
  assert.match(html, /Facebook/);
  assert.match(html, /Số điện thoại/);
  assert.match(html, /Địa chỉ/);
  assert.match(html, /Mã giảm giá/);
  assert.match(html, /register-confirmation/);
});

test('step-three payment and regenerated checkout redirect directly to PayOS', async () => {
  const registration = await source('src/pages/RegisterPage.js');
  assert.doesNotMatch(registration, /Sẵn sàng thanh toán|registration-checkout-button|renderCheckoutConfirmation/);
  assert.match(registration, /Thanh toán \$\{formatCurrency/);
  assert.match(registration, /window\.location\.assign\(payment\.checkoutUrl\)/);
  assert.match(registration, /RegistrationService\.retryPayos[\s\S]*window\.location\.assign\(data\.payment\.checkoutUrl\)/);
  assert.ok(registration.indexOf("sessionStorage.setItem('registration-checkout-pending'") < registration.indexOf('window.location.assign(payment.checkoutUrl)'));
});

test('registration protects submit re-entry and preserves reusable checkout state', async () => {
  const [registration, service, recoveryMigration] = await Promise.all([
    source('src/pages/RegisterPage.js'),
    source('src/services/RegistrationService.js'),
    source('supabase/migrations/20260825140000_fix_public_registration_payment_recovery.sql'),
  ]);
  assert.match(registration, /if \(state\.submitting \|\|/);
  assert.match(registration, /state\.submitting = true/);
  assert.match(registration, /registration-checkout-pending/);
  assert.match(service, /submitWithPayos/);
  assert.match(service, /retryPayos/);
  assert.match(recoveryMigration, /registration_requests/);
  assert.match(recoveryMigration, /awaiting_payment/);
});

test('promotion and late-payment guidance remain present in the direct checkout flow', async () => {
  const registration = await source('src/pages/RegisterPage.js');
  assert.match(registration, /promotionCode: state\.promotion\?\.code \|\| null/);
  assert.match(registration, /Mã ưu đãi/);
  assert.match(registration, /bonusMonths/);
  assert.match(registration, /mã trước, hệ thống vẫn tiếp tục đối chiếu/);
});

test('registration stepper stays aligned across desktop and mobile rules', async () => {
  const css = await source('src/styles/app.css');
  assert.match(css, /\.registration-wizard \.registration-stepper \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.registration-step\.completed:not\(:last-child\)::after \{ background:var\(--success-border\)/);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*\.registration-wizard \.registration-stepper \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('self-registration form uses username/password and does not require email', () => {
  const html = AccountRegisterPage();
  assert.match(html, /id="account-register-form"/);
  assert.match(html, /id="signup-username"/);
  assert.match(html, /id="signup-password"/);
  assert.doesNotMatch(html, /signup-password-confirmation|signup-phone|signup-display-name/);
  assert.doesNotMatch(html, /type="email"|id="signup-email"/);
  assert.match(html, /href="#\/login"/);
});

test('normal users see personal routes only, granted users gain their module, and System Admin sees all', () => {
  const normal = { status: 'active', web_access_enabled: true, is_system_admin: false, permissions: [] };
  const granted = { ...normal, permissions: ['customers'] };
  const admin = { ...normal, is_system_admin: true };
  const routes = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.matchRoute || item.route));

  assert.equal(canAccessRoute(normal, 'user'), true);
  assert.equal(canAccessRoute(normal, 'user-kiosks'), true);
  for (const route of ['dashboard', 'customers', 'kiosks', 'payments', 'settings', 'user-management']) {
    assert.equal(canAccessRoute(normal, route), false, route);
  }
  assert.equal(canAccessRoute(granted, 'customers'), true);
  assert.equal(canAccessRoute(granted, 'kiosks'), false);
  for (const route of routes) assert.equal(canAccessRoute(admin, route), true, route);
});

test('CRM Data API policies remove authenticated-wide access and use canonical permissions', async () => {
  const migration = await source('supabase/migrations/20260912100000_enforce_unified_crm_permissions.sql');
  for (const table of ['customers', 'kiosks', 'payments', 'categories', 'business_types', 'registration_requests', 'settings']) {
    assert.match(migration, new RegExp(`drop policy if exists task08_authenticated_baseline on public\\.${table}`));
  }
  assert.match(migration, /has_user_permission\('customers'\)/);
  assert.match(migration, /has_user_permission\('kiosks'\)/);
  assert.match(migration, /has_user_permission\('payments'\)/);
  assert.doesNotMatch(migration, /using \(true\)|with check \(true\)/i);
});
