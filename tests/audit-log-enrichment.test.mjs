import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichBusinessEntities } from '../src/services/AuditLogService.js';

function mockSupabase(fixtures) {
  return {
    from(table) {
      return {
        select() {
          return {
            in(column, ids) {
              const wanted = new Set(ids.map(String));
              return Promise.resolve({
                data: (fixtures[table] || []).filter((row) => wanted.has(String(row[column]))),
                error: null,
              });
            },
          };
        },
      };
    },
  };
}

test('batch enrichment resolves payment, Kiosk, user and both sides of reference changes', async () => {
  const supabase = mockSupabase({
    payments: [{ id: 91, kiosk_id: 7, customer_id: 2, total_amount: 450000, payment_status: 'completed', start_date: '2026-08-01', end_date: '2026-08-31', months: 1 }],
    kiosks: [{ id: 7, facebook_name: 'Kiosk Hoa Sen' }],
    customers: [{ id: 2, facebook_name: 'Nguyễn Lan' }],
    user_profiles: [{ user_id: 'u-1', display_name: 'Lan Anh', username: 'lananh' }],
    business_types: [{ id: 47, name: 'Đồ ăn' }, { id: 52, name: 'Đồ uống' }],
    categories: [{ id: 3, name: 'Ẩm thực' }, { id: 4, name: 'Dịch vụ' }],
  });
  const rows = [
    { id: 1, action: 'confirm_payos', module: 'Payment', entity: 'payments', record_id: '91', before: null, after: { payment_id: 91 } },
    { id: 2, action: 'update', module: 'Kiosk', entity: 'kiosks', record_id: '7', before: { business_type_id: 47, category_id: 3 }, after: { business_type_id: 52, category_id: 4 } },
    { id: 3, action: 'sync_permissions', module: 'Staff', entity: 'staff', record_id: 'u-1', before: {}, after: {} },
  ];

  const result = await enrichBusinessEntities(supabase, rows);
  assert.equal(result[0].resolved_entity.name, 'Kiosk Hoa Sen');
  assert.equal(result[0].resolved_payment.total_amount, 450000);
  assert.equal(result[0].resolved_names.customer.name, 'Nguyễn Lan');
  assert.equal(result[1].resolved_names.businessTypes['47'], 'Đồ ăn');
  assert.equal(result[1].resolved_names.businessTypes['52'], 'Đồ uống');
  assert.equal(result[1].resolved_names.categories['3'], 'Ẩm thực');
  assert.equal(result[1].resolved_names.categories['4'], 'Dịch vụ');
  assert.equal(result[2].resolved_entity.name, 'Lan Anh');
});

test('lookup failures and deleted records preserve the original log with an explicit missing fallback', async () => {
  const failingSupabase = {
    from() {
      return { select() { return { in() { return Promise.resolve({ data: null, error: new Error('lookup unavailable') }); } }; } };
    },
  };
  const [customer, promotion] = await enrichBusinessEntities(failingSupabase, [
    { id: 4, action: 'update', module: 'Customer', entity: 'customers', record_id: '404', before: {}, after: {} },
    { id: 5, action: 'pause_promotion', module: 'Promotion', entity: 'promotions', record_id: '405', before: {}, after: {} },
  ]);
  assert.deepEqual(customer.resolved_entity, { kind: 'Khách hàng', name: null, id: '404', missing: true });
  assert.deepEqual(promotion.resolved_entity, { kind: 'Mã giảm giá', name: null, id: '405', missing: true });
  assert.equal(customer.id, 4);
  assert.equal(promotion.id, 5);
});
