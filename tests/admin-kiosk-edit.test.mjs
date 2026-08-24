import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pickAdminMutableFields } from '../src/services/KioskService.js';

const formUrl = new URL('../src/components/KioskEditForm.js', import.meta.url);

test('Admin Kiosk form exposes Category and Business Type as separate persisted controls', async () => {
  const source = await readFile(formUrl, 'utf8');
  assert.match(source, /id="kiosk-edit-category"/);
  assert.match(source, /id="kiosk-edit-business-type"/);
  assert.match(source, /category_id:\s*document\.getElementById\('kiosk-edit-category'\)/);
  assert.match(source, /business_type_id:\s*businessTypeId/);
  assert.match(source, /selectedBusinessType\.category_id/);
  assert.match(source, /state\.kiosk\?\.stored_status \|\| state\.kiosk\?\.status/);
  assert.doesNotMatch(source, /category_id:\s*businessType\?\.category_id/);
});

test('Admin Kiosk editable payload persists all approved fields and rejects payment or renewal fields', () => {
  const input = {
    customer_id: 9,
    facebook_name: 'Kiosk A', facebook_id: '123', facebook_link: 'https://facebook.com/a',
    facebook_group_link: 'https://facebook.com/groups/a', category_id: 2, business_type_id: 7,
    status: 'suspended', start_date: '2026-01-01', end_date: '2026-12-31',
    auto_approve: true, note: 'Ghi chú', total_paid: 999999, kiosk_total_paid: 999999,
    payment_status: 'completed', months: 12, renewal_id: 123,
  };
  assert.deepEqual(pickAdminMutableFields(input), {
    facebook_name: 'Kiosk A', facebook_id: '123', facebook_link: 'https://facebook.com/a',
    facebook_group_link: 'https://facebook.com/groups/a', category_id: 2, business_type_id: 7,
    status: 'suspended', start_date: '2026-01-01', end_date: '2026-12-31',
    auto_approve: true, note: 'Ghi chú',
  });
});

test('Admin date edit remains a direct audited Kiosk update without payment or renewal mutation', async () => {
  const [form, service] = await Promise.all([
    readFile(formUrl, 'utf8'),
    readFile(new URL('../src/services/KioskService.js', import.meta.url), 'utf8'),
  ]);
  assert.match(form, /payload\.end_date < payload\.start_date/);
  assert.match(form, /KioskService\.update\(state\.kiosk\.id, payload, reason/);
  assert.match(service, /AuditLogService\.log\([\s\S]*action: 'update'/);
  assert.doesNotMatch(form, /RenewKioskForm|PaymentService|confirm_crm_payment|PayOS/i);
  assert.doesNotMatch(service, /from\('payments'\)\.update|renewal/i);
});
