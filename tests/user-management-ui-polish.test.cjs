const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS } = require('../shared/permissions.js');

const root = path.join(__dirname, '..');
const staff = readFileSync(path.join(root, 'src/pages/StaffPage.js'), 'utf8');
const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8');

test('user list keeps the requested compact columns and one Manage action', () => {
  for (const heading of ['Người dùng', 'Liên hệ', 'TTC / Ví', 'Quyền Web', 'Trạng thái', 'Đăng nhập gần nhất', 'Quản lý']) {
    assert.match(staff, new RegExp(`<th>${heading.replace('/', '\\/')}</th>`));
  }
  const rowActions = functionSource('rowActions', 'openUserDetail');
  assert.match(rowActions, />Quản lý<\/button>/);
  assert.equal((rowActions.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(rowActions, /<details|<summary|Thao tác|Xem chi tiết|Sửa số dư|Đặt lại mật khẩu/);
  assert.doesNotMatch(functionSource('renderRows', 'rowActions'), /Facebook ID/);
});

test('Manage button opens User Detail and all five tabs remain wired', () => {
  assert.match(staff, /openUserDetail\(action\.dataset\.userId, 'account'\)/);
  const tabs = [...staff.matchAll(/detailTab\('([^']+)', '([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ['account', 'ttc', 'access', 'ledger', 'security']);
  assert.match(staff, /data-detail-tab=/);
  assert.match(staff, /state\.activeTab = button\.dataset\.detailTab/);
});

test('permission groups cover the unchanged canonical catalog with Vietnamese labels only', () => {
  const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
  assert.deepEqual(new Set(grouped), new Set(ALL_PERMISSIONS));
  assert.equal(ALL_PERMISSIONS.length, 24);
  for (const permission of ALL_PERMISSIONS) {
    assert.equal(typeof PERMISSION_LABELS[permission], 'string');
    assert.ok(PERMISSION_LABELS[permission].length > 0);
    assert.notEqual(PERMISSION_LABELS[permission], permission);
  }
  const permissionMarkup = functionSource('permissionGroup', 'permissionConfirmationDialog');
  assert.match(permissionMarkup, /value="\$\{escapeHtml\(permission\)\}"/);
  assert.match(permissionMarkup, /PERMISSION_LABELS\[permission\]/);
  assert.doesNotMatch(permissionMarkup, /<small>|\|\| permission/);
});

test('saving permissions opens a confirmation dialog and reuses the existing backend flow', () => {
  const accessMarkup = functionSource('accessPanel', 'permissionGroup');
  assert.match(accessMarkup, /data-permission-save/);
  assert.match(accessMarkup, /permissionConfirmationDialog\(\)/);
  assert.doesNotMatch(accessMarkup, /adminPasswordField\(\).*Lý do.*Lưu tập quyền/s);

  const confirmation = functionSource('permissionConfirmationDialog', 'ledgerPanel');
  assert.match(confirmation, /role="dialog" aria-modal="true"/);
  assert.match(confirmation, /\$\{adminPasswordField\(\)\}/);
  assert.match(functionSource('adminPasswordField', 'bindDetailEvents'), /Xác nhận mật khẩu quản trị/);
  assert.match(confirmation, /<span>Lý do<\/span>/);
  assert.match(confirmation, />Hủy<\/button>/);
  assert.match(confirmation, />Xác nhận thay đổi<\/button>/);

  const bindings = functionSource('bindPermissionEvents', 'bindSubmit');
  assert.match(bindings, /permissionForm\.addEventListener\('submit'.*openConfirmation/s);
  assert.match(bindings, /StaffService\.syncPermissions\(user\.user_id, selectedPermissions\(\), form\.elements\.adminPassword\.value, form\.elements\.reason\.value\)/);
  assert.match(bindings, /data-permission-dirty/);
});

test('table keeps user data bindings and web access uses explicit business copy', () => {
  const rows = functionSource('renderRows', 'rowActions');
  for (const binding of ['display_name', 'username', 'email', 'phone', 'last_sign_in_at']) assert.match(rows, new RegExp(binding));
  assert.match(rows, /userWallet\(user\)/);
  assert.match(rows, /webAccessSummary\(user\)/);
  assert.match(staff, /Quyền truy cập Web/);
  assert.match(staff, /Đang bật/);
  assert.match(staff, /Đang tắt/);
  assert.match(staff, /Toàn quyền hệ thống/);
  assert.match(staff, /quyền được cấp/);
});

test('modal, permission cards and sticky actions are compact and responsive', () => {
  assert.match(css, /\.unified-user-modal\{[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow:hidden/);
  assert.match(css, /\.unified-user-modal \.modal-body\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.unified-user-tabs\{[^}]*position:sticky/);
  assert.match(css, /\.permission-group-grid\{columns:2/);
  assert.match(css, /\.permission-group\{[^}]*break-inside:avoid/);
  assert.match(css, /\.permission-action-bar\{[^}]*position:sticky[^}]*bottom:0/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.permission-group-grid\{columns:1\}/);
  assert.match(css, /@media\(max-width:960px\)[\s\S]*?\.unified-users-table thead\{display:none\}/);
});

function functionSource(startName, nextName) {
  const start = staff.indexOf(`function ${startName}`);
  const end = staff.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `Missing function ${startName}`);
  assert.notEqual(end, -1, `Missing function ${nextName}`);
  return staff.slice(start, end);
}
