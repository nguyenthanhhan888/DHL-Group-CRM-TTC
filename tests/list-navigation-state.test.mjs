import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  captureListScroll,
  clearAccountNavigationState,
  clearListNavigationState,
  detailOrigin,
  prepareListScrollRestore,
  readListNavigationState,
  restoreListScroll,
  shouldUseHistoryBack,
  writeListNavigationState,
} from '../src/utils/listNavigationState.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const defaults = {
  searchTerm: '', status: '', page: 1, pageSize: 10,
  sort: { column: 'created_at', ascending: false },
};

test('Back and Forward retain filters, sorting, pagination and scroll for the same account', () => {
  const storage = new MemoryStorage();
  const profile = { user_id: 'account-a' };
  writeListNavigationState('customers', {
    searchTerm: 'Nguyễn', status: 'expired', page: 3, pageSize: 25,
    sort: { column: 'facebook_name', ascending: true },
  }, profile, storage);
  captureListScroll('customers', profile, 742, storage);

  assert.equal(detailOrigin('customers', 'customer-detail'), 'customers');
  assert.equal(shouldUseHistoryBack({ dhlListOrigin: 'customers' }, 'customers'), true);
  assert.equal(shouldUseHistoryBack({ dhlListOrigin: 'kiosks' }, 'customers'), false);

  prepareListScrollRestore('customers', profile, storage);
  const scrollCalls = [];
  const restored = restoreListScroll('customers', profile, {
    view: { scrollTo: (position) => scrollCalls.push(position) },
    schedule: (callback) => callback(),
  });
  const afterBack = readListNavigationState('customers', defaults, profile, storage);

  assert.equal(restored, true);
  assert.deepEqual(scrollCalls, [{ top: 742, left: 0, behavior: 'auto' }]);
  assert.deepEqual(afterBack, {
    ...defaults,
    searchTerm: 'Nguyễn', status: 'expired', page: 3, pageSize: 25, scrollY: 742,
    sort: { column: 'facebook_name', ascending: true },
  });

  // Simulate Forward to detail and Back to the list a second time.
  prepareListScrollRestore('customers', profile, storage);
  assert.equal(restoreListScroll('customers', profile, {
    view: { scrollTo: (position) => scrollCalls.push(position) },
    schedule: (callback) => callback(),
  }), true);
  assert.equal(readListNavigationState('customers', defaults, profile, storage).page, 3);
});

test('navigation state is isolated by account and cleared on logout', () => {
  const storage = new MemoryStorage();
  const accountA = { user_id: 'account-a' };
  const accountB = { user_id: 'account-b' };
  writeListNavigationState('payments', { searchTerm: 'A', page: 4 }, accountA, storage);
  writeListNavigationState('payments', { searchTerm: 'B', page: 2 }, accountB, storage);

  assert.equal(readListNavigationState('payments', defaults, accountA, storage).searchTerm, 'A');
  assert.equal(readListNavigationState('payments', defaults, accountB, storage).searchTerm, 'B');

  clearAccountNavigationState(accountA, storage);
  assert.deepEqual(readListNavigationState('payments', defaults, accountA, storage), defaults);
  assert.equal(readListNavigationState('payments', defaults, accountB, storage).page, 2);
});

test('explicit Reset clears only the selected list and restores defaults', () => {
  const storage = new MemoryStorage();
  const profile = { user_id: 'account-a' };
  writeListNavigationState('kiosks', { searchTerm: 'shop', status: 'expired', page: 5, pageSize: 48 }, profile, storage);
  writeListNavigationState('payments', { status: 'completed', page: 2 }, profile, storage);

  clearListNavigationState('kiosks', profile, storage);

  assert.deepEqual(readListNavigationState('kiosks', defaults, profile, storage), defaults);
  assert.equal(readListNavigationState('payments', defaults, profile, storage).status, 'completed');
});

test('Customers, Kiosks and Payments wire restoration, Reset and safe back links', async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [customers, kiosks, payments, customerDetail, kioskDetail, paymentDetail, router, app] = await Promise.all([
    read('src/pages/CustomersPage.js'),
    read('src/pages/KiosksPage.js'),
    read('src/pages/PaymentsPage.js'),
    read('src/pages/CustomerDetailPage.js'),
    read('src/pages/KioskDetailPage.js'),
    read('src/pages/PaymentDetailPage.js'),
    read('src/router/index.js'),
    read('src/app.js'),
  ]);

  for (const [source, route] of [[customers, 'customers'], [kiosks, 'kiosks'], [payments, 'payments']]) {
    assert.match(source, new RegExp(`readListNavigationState\\('${route}'`));
    assert.match(source, new RegExp(`writeListNavigationState\\('${route}'`));
    assert.match(source, new RegExp(`restoreListScroll\\('${route}'`));
    assert.match(source, /filter-reset/);
    assert.match(source, /onPage:[\s\S]*persist/);
    assert.match(source, /onPageSize:[\s\S]*persist/);
  }
  assert.doesNotMatch(kiosks, /export function KiosksPage[^]*state\.status = 'active'/);
  assert.match(customerDetail, /data-list-back="customers"/);
  assert.match(kioskDetail, /data-list-back="kiosks"/);
  assert.match(paymentDetail, /data-list-back="payments"/);
  assert.match(router, /window\.history\.replaceState[^]*dhlListOrigin/);
  assert.match(router, /window\.history\.back\(\)/);
  assert.match(app, /clearAccountNavigationState\(profile\)/);
});
