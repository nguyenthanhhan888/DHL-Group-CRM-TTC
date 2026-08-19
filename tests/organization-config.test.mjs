import test from 'node:test';
import assert from 'node:assert/strict';
import { getExpiryWarningDays, replaceOrganizationSettings } from '../src/config/organization.js';
import { CustomersPage } from '../src/pages/CustomersPage.js';
import { expiringKiosksEmptyMessage } from '../src/pages/DashboardPage.js';
import { KiosksPage } from '../src/pages/KiosksPage.js';
import { publicKioskStatusLabel } from '../src/pages/LookupPage.js';
import { deriveKioskStatus, expiryDateRange, isExpiringSoon } from '../src/utils/kioskStatus.js';

test('expiry warning days follows organization settings with a safe fallback', () => {
  replaceOrganizationSettings({ warning_days: '45' });
  assert.equal(getExpiryWarningDays(), 45);

  replaceOrganizationSettings({ warning_days: '12.9' });
  assert.equal(getExpiryWarningDays(), 12);

  replaceOrganizationSettings({ warning_days: '0' });
  assert.equal(getExpiryWarningDays(), 30);

  replaceOrganizationSettings({});
  assert.equal(getExpiryWarningDays(), 30);
});

test('expiry warning labels render from organization settings', () => {
  replaceOrganizationSettings({ warning_days: '10' });

  assert.ok(KiosksPage().includes('Sắp hết hạn (≤10 ngày)'));
  assert.ok(CustomersPage().includes('Có Kiosk sắp hết hạn (≤10 ngày)'));
  assert.equal(expiringKiosksEmptyMessage(), 'Không tìm thấy kiosk sắp hết hạn trong 10 ngày tới.');
  assert.equal(expiringKiosksEmptyMessage(7), 'Không tìm thấy kiosk sắp hết hạn trong 7 ngày tới.');

  replaceOrganizationSettings({});
});

test('kiosk status label is derived from end date before stored status', () => {
  replaceOrganizationSettings({ warning_days: '20' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = (offsetDays) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offsetDays);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };

  assert.equal(deriveKioskStatus({ status: 'warning', end_date: dateOnly(-1) }), 'expired');
  assert.equal(deriveKioskStatus({ status: 'active', end_date: dateOnly(5) }), 'warning');
  assert.equal(deriveKioskStatus({ status: 'warning', end_date: dateOnly(25) }), 'active');
  assert.equal(deriveKioskStatus({ status: 'suspended', end_date: dateOnly(-1) }), 'suspended');

  replaceOrganizationSettings({});
});

for (const warningDays of [5, 10]) {
  test(`inclusive expiry contract uses every boundary for warning_days = ${warningDays}`, () => {
    replaceOrganizationSettings({ warning_days: String(warningDays) });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateOnly = (offsetDays) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offsetDays);
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
    };
    const kiosk = (offsetDays) => ({ status: 'active', end_date: dateOnly(offsetDays) });

    assert.equal(deriveKioskStatus(kiosk(warningDays + 1)), 'active');
    assert.equal(deriveKioskStatus(kiosk(warningDays)), 'warning');
    assert.equal(deriveKioskStatus(kiosk(1)), 'warning');
    assert.equal(deriveKioskStatus(kiosk(0)), 'warning');
    assert.equal(deriveKioskStatus(kiosk(-1)), 'expired');
    assert.equal(isExpiringSoon(kiosk(warningDays), { today }), true);
    assert.equal(isExpiringSoon(kiosk(warningDays + 1), { today }), false);
    assert.deepEqual(expiryDateRange({ today }).endDate, dateOnly(warningDays));
    assert.equal(publicKioskStatusLabel('active', dateOnly(warningDays)), 'Sắp hết hạn');

    replaceOrganizationSettings({});
  });
}
