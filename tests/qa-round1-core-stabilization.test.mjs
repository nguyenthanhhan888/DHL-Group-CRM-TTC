import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const core = await readFile(new URL('../supabase/migrations/20260916120000_qa_round1_core_stabilization.sql', import.meta.url), 'utf8');
const orphan = await readFile(new URL('../supabase/migrations/20260916123000_safe_registration_orphan_archival.sql', import.meta.url), 'utf8');
const registrationPermissions = await readFile(new URL('../supabase/migrations/20260916124500_unify_registration_rpc_permissions.sql', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/services/DashboardService.js', import.meta.url), 'utf8');
const logs = await readFile(new URL('../src/pages/LogsPage.js', import.meta.url), 'utf8');
const report = await readFile(new URL('../src/services/ReportService.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../src/pages/HomePage.js', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/PublicLayout.js', import.meta.url), 'utf8');
const account = await readFile(new URL('../src/pages/AccountRegisterPage.js', import.meta.url), 'utf8');
const accountApi = await readFile(new URL('../api/auth-account.js', import.meta.url), 'utf8');

test('QR display expiry remains separate from registration/payment business intent', () => {
  assert.doesNotMatch(core, /update public\.(registration_requests|registration_batches|payments)[\s\S]{0,120}expire/i);
  assert.match(core, /never expires a business[\s\S]*intent merely because its PayOS checkout UI has expired/i);
});

test('future cancellation archives only transaction-proven provisional customers', () => {
  assert.match(core, /provisional_customer_id/);
  assert.match(core, /c\.xmin::text = pg_current_xact_id\(\)::text/);
  assert.match(orphan, /payment_status='completed'/);
  assert.match(orphan, /registration_batch_id is distinct from batch_record\.id/);
  assert.match(orphan, /archived_reason='cancelled_unpaid_registration:'/);
  assert.doesNotMatch(orphan, /delete\s+from\s+public\.customers/i);
});

test('Dashboard and Logs consume one permission-checked business event RPC', () => {
  assert.match(core, /create or replace function public\.get_business_events/);
  assert.match(core, /when p\.registration_batch_id is not null or p\.registration_request_id is not null then 'registration'/);
  assert.match(core, /else 'reconciliation' end event_type/);
  assert.match(core, /correction_type'='historical_payment'/);
  assert.match(core, /audit_events as materialized/);
  assert.match(dashboard, /DASHBOARD_ACTIVITY_TYPES = \['registration', 'legacy', 'renewal'\]/);
  assert.match(dashboard, /BusinessEventService\.list\(\{[\s\S]*context: 'dashboard', activity/);
  assert.match(logs, /BusinessEventService\.list/);
});

test('financial KPI query and labels use runtime Vietnam year and month', () => {
  assert.match(core, /time zone 'Asia\/Ho_Chi_Minh'/);
  assert.match(core, /date_trunc\('year',business_now\)/);
  assert.match(core, /date_trunc\('month',business_now\)/);
  assert.match(report, /get_current_financial_kpis/);
  assert.doesNotMatch(report, /2026|September|tháng 9/);
});

test('module permission guards protect reports, logs, payments, registration and storage', () => {
  for (const permission of ['reports', 'logs', 'payments', 'registration-requests']) {
    assert.match(core, new RegExp(`has_user_permission\\('${permission}'\\)`));
  }
  assert.match(core, /has_user_permission\(''homepage-content''\)/);
  assert.match(registrationPermissions, /assert_registration_permission/);
  assert.match(registrationPermissions, /admin_list_registration_requests/);
  assert.match(registrationPermissions, /admin_complete_awaiting_registration/);
  assert.match(registrationPermissions, /admin_cancel_awaiting_registration/);
  assert.match(registrationPermissions, /review_public_legacy_registration_request/);
  assert.match(core, /homepage_assets_public_read/);
  assert.match(core, /homepage_assets_editor_insert/);
  assert.doesNotMatch(core, /authenticated[\s\S]{0,80}using \(true\)/i);
});

test('homepage body is focused and Hero/Footer share the public content object', () => {
  const body = home.match(/function renderHomepage[\s\S]*?function renderHero/)?.[0] || '';
  assert.doesNotMatch(body, /renderCommunityLinks|renderContact|renderKioskServices/);
  assert.match(home, /applyPublicHomepageContent\(data\?\.content\)/);
  assert.match(layout, /content\.heroGroupCtaUrl|content\.communityLinks/);
  assert.match(layout, /data-public-official-channels/);
});

test('account self-registration requires only username and password', () => {
  assert.match(account, /signup-username/);
  assert.match(account, /signup-password/);
  assert.doesNotMatch(account, /signup-display-name|signup-phone|password-confirmation/);
  assert.doesNotMatch(accountApi.match(/async function createUserAccount[\s\S]*?function signupFailure/)?.[0] || '', /body\.(displayName|phone|email)/);
  assert.match(accountApi, /is_system_admin: false/);
});
