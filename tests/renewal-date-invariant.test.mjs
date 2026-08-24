import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarPeriodEnd, renewalStartDate } from '../src/components/RenewKioskForm.js';

const migrationUrl = new URL(
  '../supabase/migrations/20260822090000_preserve_kiosk_original_start_date_on_renewal.sql',
  import.meta.url,
);

test('active, expiring, and expires-today renewals start without a gap or overlap', () => {
  const confirmation = new Date(2026, 9, 1);
  for (const endDate of ['2026-10-19', '2026-10-02', '2026-10-01']) {
    const start = renewalStartDate(endDate, confirmation);
    const expected = new Date(`${endDate}T00:00:00`);
    expected.setDate(expected.getDate() + 1);
    const expectedText = [expected.getFullYear(), String(expected.getMonth() + 1).padStart(2, '0'), String(expected.getDate()).padStart(2, '0')].join('-');
    assert.equal(start, expectedText);
  }
  assert.equal(calendarPeriodEnd('2026-10-20', 1), '2026-11-19');
});

test('expired yesterday and long-expired renewals restart on confirmation date', () => {
  const confirmation = new Date(2026, 9, 20);
  assert.equal(renewalStartDate('2026-10-19', confirmation), '2026-10-20');
  assert.equal(renewalStartDate('2024-01-01', confirmation), '2026-10-20');
});

test('calendar-month periods cover three months, month ends, and year boundaries', () => {
  assert.equal(calendarPeriodEnd('2026-01-01', 3), '2026-03-31');
  assert.equal(calendarPeriodEnd('2026-01-31', 1), '2026-02-27');
  assert.equal(calendarPeriodEnd('2026-12-20', 1), '2027-01-19');
  assert.equal(calendarPeriodEnd('2026-10-20', 3), '2027-01-19');
});

test('forward migration preserves kiosk start_date in manual, PayOS, and trigger paths', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.admin_manual_renew_kiosk/);
  assert.match(sql, /create or replace function private\.confirm_crm_payment_from_payos/);
  assert.match(sql, /create or replace function private\.sync_completed_renewal_kiosk_period/);
  assert.doesNotMatch(sql, /update public\.kiosks[\s\S]{0,180}start_date\s*=/i);
  assert.match(sql, /set status = 'active',\s*end_date = calculated_end_date/);
  assert.match(sql, /set status = 'active', end_date = new\.end_date/);
  assert.match(sql, /Legacy NULL start_date[\s\S]*deliberately preserved/i);
});

test('manual and PayOS finalizers use the same authoritative inclusive period rule', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const authoritativeStartRules = sql.match(/when kiosk_record\.end_date is not null and kiosk_record\.end_date >= confirmation_date/g) || [];
  const inclusiveEndRules = sql.match(/pg_catalog\.make_interval\(months => (?:months_input|payment_record\.months)\)[\s\S]{0,60}- interval '1 day'/g) || [];
  assert.equal(authoritativeStartRules.length, 2);
  assert.equal(inclusiveEndRules.length, 2);
  assert.match(sql, /start_date_input remains in the public signature for client compatibility/);
});

test('PayOS webhook idempotency remains owned by the existing webhook implementation', async () => {
  const latestWebhook = await readFile(new URL('../supabase/migrations/20260818235900_create_public_registration_batches.sql', import.meta.url), 'utf8');
  assert.match(latestWebhook, /if event_record\.status='processed'/);
  assert.match(latestWebhook, /if order_record\.status='paid'/);
  assert.match(latestWebhook, /if payment_record\.payment_status='completed'/);
  const correctiveSql = await readFile(migrationUrl, 'utf8');
  assert.doesNotMatch(correctiveSql, /create or replace function public\.handle_payos_webhook/);
});
