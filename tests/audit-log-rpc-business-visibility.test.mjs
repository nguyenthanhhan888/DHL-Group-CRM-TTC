import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260829074503_business_audit_event_visibility_and_category_aliases.sql', import.meta.url),
  'utf8',
);

const BUSINESS_EVENTS = [
  'create', 'update', 'delete', 'confirm', 'cancel', 'reject', 'approve', 'approved',
  'set_active', 'reset_password', 'update_profile', 'admin_reset_user_password',
  'admin_update_user_profile', 'admin_update_user_status', 'sync_permissions',
  'lock_user', 'unlock_user', 'adjust_wallet', 'admin_adjustment',
  'admin_manual_renewal', 'confirm_payos', 'confirm_payos_batch', 'admin_cancel',
  'review_legacy_approve', 'review_legacy_cancel', 'create_promotion',
  'update_promotion', 'pause_promotion', 'reactivate_promotion', 'delete_promotion',
  'expire', 'expired', 'activate', 'deactivate',
];

function visibilityEvents() {
  const visible = migration.match(/visible as materialized \([\s\S]*?c\.normalized_action = any \(array\[([\s\S]*?)\]::text\[\]\)/)?.[1] || '';
  return [...visible.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('OFF mode whitelist exactly matches the formatter business event catalog', () => {
  assert.deepEqual(visibilityEvents(), BUSINESS_EVENTS);
  for (const technicalOnly of ['wallet_ledger', 'username_login', 'approve_profile_pending_payment', 'manual_review', 'cleanup', 'webhook_retry', 'metadata_update']) {
    assert.equal(visibilityEvents().includes(technicalOnly), false, technicalOnly);
  }
  assert.match(migration, /where show_technical\s+or \(/);
  assert.match(migration, /c\.category <> 'system'[\s\S]*array\['expire','expired','activate','deactivate'\]/);
});

test('canonical category filters include historical module and entity aliases', () => {
  const contracts = {
    kiosk: ['kiosk', 'kiosks', 'registration', 'registration_requests', 'registration_batches', 'public_registration'],
    customer: ['customer', 'customers', 'client', 'clients'],
    payment: ['payment', 'payments', 'transaction', 'transactions', 'payos', 'payment_intents'],
    renewal: ['renewal', 'renewals', 'kiosk_renewal', 'gia_han'],
    user: ['usermanagement', 'user_management', 'user_profiles', 'staff', 'staff_members', 'user_permissions', 'wallet', 'ttc_user_wallets'],
    promotion: ['promotion', 'promotions', 'discount', 'coupon', 'promotion_usages'],
    system: ['system', 'webhook', 'cron', 'cleanup', 'sync', 'database_trigger'],
  };
  for (const [category, aliases] of Object.entries(contracts)) {
    for (const alias of aliases) {
      assert.match(migration, new RegExp(`when '${alias}' then '${category}'`), `${alias} -> ${category}`);
    }
  }
  assert.match(migration, /r\.category = requested_category/);
  assert.match(migration, /or r\.normalized_module = pg_catalog\.lower/);
  assert.match(migration, /or r\.normalized_entity = pg_catalog\.lower/);
});

test('RPC remains authorized, immutable-data compatible and pagination-safe', () => {
  assert.match(migration, /perform private\.assert_audit_access\(\)/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /from public\.audit_logs al/);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\.audit_logs/i);
  assert.match(migration, /stats as \([\s\S]*count\(\*\)[\s\S]*from filtered/);
  assert.match(migration, /least\(normalized_page,[\s\S]*effective_page/);
  assert.match(migration, /limit normalized_size[\s\S]*offset/);
  assert.match(migration, /revoke all on function public\.get_audit_logs[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_audit_logs[\s\S]*to authenticated/);
});

test('normalized category is returned while internal normalization fields are removed', () => {
  assert.match(migration, /end as category/);
  assert.match(migration, /to_jsonb\(p\) - 'normalized_module' - 'normalized_entity' - 'normalized_action'/);
  assert.doesNotMatch(migration, /to_jsonb\(p\)\s*-\s*'category'/);
});
