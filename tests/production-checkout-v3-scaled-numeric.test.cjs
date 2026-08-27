const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const appliedEngine = read('supabase/migrations/20260824170000_create_discount_promotion_engine_v1.sql');
const fix = read('supabase/migrations/20260826221308_accept_scaled_numeric_promotion_item_totals.sql');

test('production NUMERIC 2000.00 shape is accepted at the evaluator bigint boundary', () => {
  const actualProductionText = '2000.00';

  // PostgreSQL reports 22P02 for the old direct text -> bigint conversion.
  assert.match(appliedEngine, /\(item->>'totalAmount'\)::bigint/);
  assert.match(actualProductionText, /^\d+\.\d+$/);

  // Parse NUMERIC text first, then preserve the evaluator's integer-VND type.
  assert.equal((fix.match(/\(item->>'totalAmount'\)::numeric::bigint/g) || []).length, 2);
  assert.doesNotMatch(fix, /\(item->>'totalAmount'\)::bigint/);
});

test('scaled-numeric correction replaces only the private evaluator contract', () => {
  assert.equal((fix.match(/create or replace function private\.evaluate_registration_promotion/g) || []).length, 1);
  assert.doesNotMatch(fix, /prepare_registration_checkout_v3|registration_requests|registration_batches|payos_orders|handle_payos_webhook/);
  assert.match(fix, /security definer\s+set search_path = ''/);
  assert.match(fix, /revoke all on function private\.evaluate_registration_promotion\(text, bigint, jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
});

