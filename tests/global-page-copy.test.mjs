import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authenticated chrome leaves the primary page title to PageHeader', async () => {
  const [layout, app] = await Promise.all([
    read('src/layouts/AppLayout.js'),
    read('src/app.js'),
  ]);

  assert.doesNotMatch(layout, /data-page-title|class="page-title"/);
  assert.match(layout, /class="top-bar-context">Diễn Châu - À Đây Rồi \(DHL\)</);
  assert.match(layout, /data-current-date/);
  assert.match(app, /document\.title = `\$\{PAGE_TITLES\[route\]/);
});

test('admin data status uses operational copy without vendor terminology', async () => {
  const [layout, app, notice] = await Promise.all([
    read('src/layouts/AppLayout.js'),
    read('src/app.js'),
    read('src/components/ConnectionNotice.js'),
  ]);

  const presentation = `${layout}\n${app}\n${notice}`;
  assert.match(presentation, /Hệ thống hoạt động bình thường/);
  assert.match(presentation, /Không thể kết nối dữ liệu/);
  assert.match(notice, /Giao diện chưa tải được mô-đun kết nối dữ liệu/);
  assert.match(notice, /Thiếu cấu hình kết nối dữ liệu/);
  assert.doesNotMatch(layout, />[^<]*Supabase[^<]*</i);
  assert.doesNotMatch(notice, /(anon key|config\.local\.js|>[^<]*Supabase)/i);
  assert.doesNotMatch(app, /Supabase (sẵn sàng|MFA chưa sẵn sàng)|Chưa kết nối Supabase/i);
});

test('active non-TTC page copy does not expose implementation wording', async () => {
  const paths = [
    'src/pages/DashboardPage.js',
    'src/pages/CustomersPage.js',
    'src/pages/CustomerDetailPage.js',
    'src/pages/KiosksPage.js',
    'src/pages/KioskDetailPage.js',
    'src/pages/PaymentsPage.js',
    'src/pages/PaymentDetailPage.js',
    'src/pages/CategoriesPage.js',
    'src/pages/BusinessTypesPage.js',
    'src/pages/ReportsPage.js',
    'src/pages/LogsPage.js',
    'src/pages/SettingsPage.js',
    'src/pages/RegistrationRequestsPage.js',
    'src/pages/StaffPage.js',
    'src/pages/PermissionsPage.js',
    'src/pages/HomePage.js',
    'src/pages/RegisterPage.js',
    'src/pages/LegacyRegistrationPage.js',
    'src/pages/LookupPage.js',
    'src/pages/LoginPage.js',
    'src/pages/UserHomePage.js',
  ];
  const source = (await Promise.all(paths.map(read))).join('\n');

  for (const phrase of [
    'Đọc trực tiếp từ bảng',
    'Dữ liệu được tải từ Supabase',
    'Đang đọc dữ liệu từ Supabase',
    'Database đang',
    'luồng đăng ký public',
    'flow Facebook',
  ]) {
    assert.doesNotMatch(source, new RegExp(phrase, 'i'));
  }
});
