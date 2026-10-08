import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_SECTIONS, PAGE_TITLES } from '../src/constants/navigation.js';
import { AppLayout } from '../src/layouts/AppLayout.js';
import '../shared/permissions.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const deleted = ['src/pages/TtcPage.js', 'src/pages/AdminTtcPage.js', 'src/services/TtcService.js',
  'src/services/TtcAdminService.js', 'src/services/WalletService.js', 'api/ttc/verify-facebook-task.js',
  'scripts/seed-qa-live.mjs', 'scripts/seed-ttc-admin-demo.mjs', 'tests/verify-facebook-task.test.cjs'];
const directConsumers = ['src/app.js', 'src/pages/UserHomePage.js', 'src/pages/StaffPage.js',
  'src/services/index.js', 'src/services/StaffService.js', 'src/layouts/AppLayout.js',
  'src/constants/navigation.js', 'src/constants/roles.js', 'shared/permissions.js',
  'api/user-management.js', 'scripts/dev-server.cjs'];
const removedPermissions = ['ttc', 'services', 'tasks', 'wallet', 'pricing', 'violations', 'admin-ttc'];
const removedRoutes = ['ttc', 'ttc-earn', 'ttc-campaign-create', 'ttc-campaigns', 'ttc-wallet', 'ttc-wallet-history',
  'admin', 'admin/ttc', 'admin-ttc-campaigns', 'admin-ttc-announcements', 'admin-ttc-tasks', 'admin-ttc-users',
  'admin-ttc-wallets', 'admin-ttc-settings', 'admin-ttc-logs'];
const migration = read('supabase/migrations/20261003231601_remove_ttc_crm_surface.sql');
const tables = ['ttc_campaigns', 'ttc_checker_accounts', 'ttc_checker_sessions', 'ttc_interaction_types',
  'ttc_job_matches', 'ttc_target_scans', 'ttc_task_check_logs', 'ttc_tasks', 'ttc_verify_jobs'];
const functions = ['admin_create_ttc_campaign_for_user', 'admin_post_wallet_ledger', 'admin_update_ttc_verify_job',
  'cancel_ttc_campaign', 'create_ttc_campaign', 'enqueue_ttc_verify_job', 'get_my_wallet', 'list_available_ttc_tasks',
  'submit_ttc_task', 'verify_ttc_task', 'claim_ttc_task', 'list_available_ttc_campaigns', 'get_my_wallet_ledger',
  'list_my_ttc_tasks', 'system_verify_ttc_task', 'assert_ttc_staff'];

test('verified TTC-only files are absent and direct consumers have no deleted-code references', () => {
  for (const path of deleted) assert.equal(existsSync(resolve(root, path)), false, path);
  for (const path of directConsumers) {
    assert.doesNotMatch(read(path), /\b(?:WalletService|TtcService|TtcAdminService|TtcPage|AdminTtcPage)\b|verify-facebook-task|seed-ttc-admin-demo|seed-qa-live/, path);
  }
});

test('all removed route aliases and navigation titles are absent; sidebar has no TTC surface', () => {
  const routes = read('src/app.js').match(/const routes = \{([\s\S]*?)\n\};/)[1];
  const registered = [...routes.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):/gm)].map(match => match[1] || match[2]);
  const navigation = NAV_SECTIONS.flatMap(section => section.items.map(item => item.route));
  for (const route of removedRoutes) {
    assert.ok(!registered.includes(route), route); assert.ok(!navigation.includes(route), route);
    assert.equal(PAGE_TITLES[route], undefined, route);
  }
  const markup = AppLayout({ navSections: NAV_SECTIONS, user: { is_system_admin: true, username: 'admin' } });
  assert.doesNotMatch(markup, /ttc|Ví xu|TƯƠNG TÁC CHÉO/i);
});

test('TTC permission constants, route assignments, labels and selectable groups are removed', () => {
  const model = globalThis.DHL_PERMISSION_MODEL;
  for (const permission of removedPermissions) {
    assert.ok(!model.ALL_PERMISSIONS.includes(permission));
    assert.ok(!Object.values(model.ROUTE_PERMISSIONS).includes(permission));
    assert.ok(!model.PERMISSION_GROUPS.some(group => group.permissions.includes(permission)));
    assert.equal(model.PERMISSION_LABELS[permission], undefined);
  }
  for (const route of removedRoutes) assert.equal(model.ROUTE_PERMISSIONS[route], undefined);
});

test('user management no longer dispatches TTC wallet APIs or writes TTC profile metadata', () => {
  const api = read('api/user-management.js');
  assert.doesNotMatch(api, /action === '(?:adjust_wallet|wallet_ledger)'|admin_post_wallet_ledger|metadata\.(?:tier|credit_limit)/);
  assert.doesNotMatch(read('src/pages/StaffPage.js'), /ttcPanel|ledgerPanel|user-ttc-form|user-wallet-form|Ví xu/);
  assert.doesNotMatch(read('src/pages/UserHomePage.js'), /loadWallet|wallet-topup-form|ttc-wallet|get_my_wallet/);
});

test('every relative static import/export in direct consumers resolves to an existing file', () => {
  let count = 0;
  for (const path of directConsumers) {
    for (const match of read(path).matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      assert.ok(existsSync(resolve(root, dirname(path), match[1])), `${path} -> ${match[1]}`); count++;
    }
  }
  assert.ok(count > 0);
});

test('migration drop list is limited to nine TTC tables and sixteen TTC/coin UI routines', () => {
  const tableStatement = migration.match(/drop table if exists ([\s\S]*?) restrict;/i)[1];
  assert.deepEqual([...tableStatement.matchAll(/public\.(\w+)/g)].map(match => match[1]).sort(), [...tables].sort());
  const droppedFunctions = [...migration.matchAll(/drop function if exists (?:public|private)\.(\w+)\(/gi)].map(match => match[1]);
  assert.deepEqual(droppedFunctions.sort(), [...functions].sort());
  for (const statement of migration.matchAll(/drop (?:function|table)[\s\S]*?;/gi)) assert.match(statement[0], / restrict;$/i);
  assert.doesNotMatch(migration, /\bdrop\s+(?:schema|type|domain)\b/i);
});

test('migration makes no direct business-data writes; shared wallet and CRM tables are retained', () => {
  // Function definitions describe later RPC execution, not migration-time DML.
  const topLevel = migration.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$function\$[\s\S]*?\$function\$\s*;/g, '');
  assert.doesNotMatch(topLevel, /\b(?:insert\s+into|truncate)\b/i);
  const writes = [...topLevel.matchAll(/\b(?:delete\s+from|update)\s+public\.(\w+)/gi)].map(match => match[1]);
  assert.deepEqual(writes, ['user_permissions', 'role_permissions', 'app_permissions']);
  assert.match(topLevel, /where permission in \('ttc','services','tasks','wallet','pricing','violations','admin-ttc'\)/);
  assert.match(topLevel, /where r\.permissions && array\['ttc','services','tasks','wallet','pricing','violations','admin-ttc'\]/);
  assert.doesNotMatch(topLevel, /drop (?:table|function)[^;]*(?:public\.(?:wallets|wallet_ledger|customers|kiosks|payments|employees|user_profiles)\b|private\.(?:ensure_wallet|post_wallet_ledger|write_ttc_audit)\b)/i);
});

test('migration is transactional and refuses unknown TTC consumers or scheduled jobs', () => {
  assert.match(migration, /\nbegin;/); assert.match(migration, /\ncommit;\s*$/);
  assert.match(migration, /p\.prosrc ~/); assert.match(migration, /raise exception 'Cleanup stopped: retained function/);
  assert.match(migration, /to_regclass\('cron.job'\)/); assert.match(migration, /raise exception 'Cleanup stopped: scheduled job/);
});
