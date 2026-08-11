import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { calculateRenewalAmounts, calculateRenewalPeriod } from '../src/utils/renewal.js';

test('active Kiosk renewal starts after current expiry without losing active time', () => {
  assert.deepEqual(calculateRenewalPeriod({
    currentEndDate: '2026-09-30', months: 3, today: '2026-08-10',
  }), { defaultStartDate: '2026-10-01', startDate: '2026-10-01', endDate: '2026-12-31' });
});

test('expired Kiosk renewal starts today by default', () => {
  assert.deepEqual(calculateRenewalPeriod({
    currentEndDate: '2026-06-30', months: 3, today: '2026-08-10',
  }), { defaultStartDate: '2026-08-10', startDate: '2026-08-10', endDate: '2026-11-09' });
});

test('calendar renewal supports 1, 3, 6 and 12 month periods', () => {
  const expected = new Map([[1, '2026-09-30'], [3, '2026-11-30'], [6, '2027-02-28'], [12, '2027-08-31']]);
  for (const [months, endDate] of expected) {
    assert.equal(calculateRenewalPeriod({ months, today: '2026-09-01' }).endDate, endDate);
  }
});

test('actual revenue equals base less discount and rejects invalid discounts', () => {
  assert.deepEqual(calculateRenewalAmounts({ baseAmount: 300000 }), { baseAmount: 300000, discount: 0, actualAmount: 300000 });
  assert.deepEqual(calculateRenewalAmounts({ baseAmount: 300000, discount: 30000 }), { baseAmount: 300000, discount: 30000, actualAmount: 270000 });
  assert.throws(() => calculateRenewalAmounts({ baseAmount: 300000, discount: -1 }), /Giảm giá/);
  assert.throws(() => calculateRenewalAmounts({ baseAmount: 300000, discount: 300001 }), /Giảm giá/);
});

test('admin renewal migration is atomic, authorized and append-only', async () => {
  const sql = await fs.readFile(new URL('../supabase/migrations/20260809225650_create_admin_manual_kiosk_renewal.sql', import.meta.url), 'utf8');
  assert.match(sql, /actor := private\.assert_payment_permission\(\)/);
  assert.match(sql, /lower\(actor\.role\) <> 'admin'/);
  assert.match(sql, /insert into public\.payments/);
  assert.doesNotMatch(sql, /update public\.payments[\s\S]*where id\s*(?:=|<>)\s*(?:original|old)_/i);
  assert.match(sql, /update public\.kiosks[\s\S]*status = 'active'/);
  assert.match(sql, /payment_status = 'completed'/);
  assert.match(sql, /confirmed_by = actor\.user_id::text/);
  assert.match(sql, /stored_method := normalized_method/);
  assert.doesNotMatch(sql, /stored_method := 'admin_manual_'/);
  assert.match(sql, /'payment_source', 'admin_manual'/);
  assert.match(sql, /private\.write_payment_audit/);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute[\s\S]*to authenticated/);
});

test('existing PayOS renewal implementation remains present and separate', async () => {
  const service = await fs.readFile(new URL('../src/services/PaymentService.js', import.meta.url), 'utf8');
  const payos = await fs.readFile(new URL('../src/services/PayosService.js', import.meta.url), 'utf8');
  assert.match(service, /create_renewal_payment/);
  assert.match(service, /admin_manual_renew_kiosk/);
  assert.match(payos, /createCrmPayment/);
});
