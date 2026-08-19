import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceOrganizationSettings } from '../src/config/organization.js';
import { CustomerService } from '../src/services/CustomerService.js';
import { DashboardService } from '../src/services/DashboardService.js';
import { KioskService } from '../src/services/KioskService.js';
import { ReportService } from '../src/services/ReportService.js';

let calls = [];

test('warning kiosks are sorted by nearest end date first by default', async () => {
  calls = [];
  setupSupabaseMock();

  await KioskService.list({
    status: 'warning',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.deepEqual(
    calls.filter(([method]) => method === 'order'),
    [['order', 'end_date', { ascending: true }]],
  );

  calls.length = 0;
  await KioskService.list({
    status: 'active',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.deepEqual(
    calls.filter(([method]) => method === 'order'),
    [['order', 'created_at', { ascending: false }]],
  );
});

test('kiosk expiry filters use kiosk end_date boundaries', async () => {
  calls = [];
  replaceOrganizationSettings({ warning_days: '20' });
  setupSupabaseMock();

  await KioskService.list({
    status: 'warning',
    pagination: { page: 1, pageSize: 12 },
  });

  const warningCalls = calls.slice();
  assert.deepEqual(warningCalls.filter(([method]) => method === 'in'), [
    ['in', 'status', ['active', 'warning']],
  ]);
  assert.equal(warningCalls.find(([method, column]) => method === 'gte' && column === 'end_date')?.[2], todayDate());
  assert.equal(warningCalls.find(([method, column]) => method === 'lte' && column === 'end_date')?.[2], dateOnlyFromToday(20));

  calls = [];
  await KioskService.list({
    status: 'expired',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.deepEqual(calls.filter(([method]) => method === 'or'), [
    ['or', `status.eq.expired,end_date.lt.${todayDate()}`],
  ]);

  replaceOrganizationSettings({});
});

test('customer kiosk-state filters use matching kiosk end_date rules', async () => {
  calls = [];
  replaceOrganizationSettings({ warning_days: '20' });
  setupSupabaseMock();

  const { data, count } = await CustomerService.list({
    kioskState: 'warning',
    pagination: { page: 1, pageSize: 10 },
  });

  assert.deepEqual(calls.filter(([method]) => method === 'from'), [
    ['from', 'kiosks'],
    ['from', 'customers'],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'in'), [
    ['in', 'status', ['active', 'warning']],
    ['in', 'id', [101, 102]],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'order'), [
    ['order', 'end_date', { ascending: true }],
  ]);
  assert.equal(calls.find(([method, column]) => method === 'gte' && column === 'end_date')?.[2], todayDate());
  assert.equal(calls.find(([method, column]) => method === 'lte' && column === 'end_date')?.[2], dateOnlyFromToday(20));
  assert.deepEqual(data.map((customer) => customer.id), [101, 102]);
  assert.equal(count, 2);

  replaceOrganizationSettings({});
});

test('dashboard keeps the inclusive RPC expiry result instead of replacing it', async () => {
  calls = [];
  replaceOrganizationSettings({ warning_days: '20' });
  setupSupabaseMock();

  const dashboard = await DashboardService.getDashboardData(new Date());

  assert.equal(dashboard.summary.expiringSoon, 3);
  assert.equal(dashboard.lists.expiringKiosks.length, 3);
  assert.deepEqual(calls.filter(([method]) => method === 'rpc'), [
    ['rpc', 'get_dashboard_data'],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'from'), []);

  replaceOrganizationSettings({});
});

test('kiosk reports expiring filter uses the same warning filter as kiosk list', async () => {
  calls = [];
  replaceOrganizationSettings({ warning_days: '20' });
  setupSupabaseMock();

  const { data: report } = await ReportService.getReportData('kiosks', { kioskStatus: 'expiring_soon' }, {
    page: 1,
    pageSize: 50,
  });

  assert.equal(report.summary.totalKiosks, 3);
  assert.equal(report.summary.expiringSoon, 3);
  assert.equal(report.rows.length, 3);
  assert.equal(report.pagination.totalRows, 3);
  assert.deepEqual(calls.filter(([method]) => method === 'rpc'), [
    ['rpc', 'get_reports_data'],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'in'), [
    ['in', 'status', ['active', 'warning']],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'order'), [
    ['order', 'end_date', { ascending: true }],
  ]);

  replaceOrganizationSettings({});
});

function setupSupabaseMock() {
  global.window = {
    DHL_CONFIG: {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    },
    supabase: {
      createClient: () => ({
        rpc: (name) => {
          calls.push(['rpc', name]);
          return Promise.resolve({
            data: {
              summary: { expiringSoon: 3 },
              charts: {},
              groups: { kioskStatuses: [] },
              rows: [],
              lists: {
                expiringKiosks: [
                  { id: 201, end_date: dateOnlyFromToday(1) },
                  { id: 202, end_date: dateOnlyFromToday(3) },
                  { id: 203, end_date: dateOnlyFromToday(5) },
                ],
              },
              warningDays: 20,
            },
            error: null,
          });
        },
        from: (table) => {
          calls.push(['from', table]);
          return createQuery(table);
        },
      }),
    },
  };
}

function createQuery(table) {
  const query = {
    select(...args) {
      calls.push(['select', ...args]);
      return query;
    },
    in(...args) {
      calls.push(['in', ...args]);
      return query;
    },
    gte(...args) {
      calls.push(['gte', ...args]);
      return query;
    },
    lte(...args) {
      calls.push(['lte', ...args]);
      return query;
    },
    lt(...args) {
      calls.push(['lt', ...args]);
      return query;
    },
    eq(...args) {
      calls.push(['eq', ...args]);
      return query;
    },
    or(...args) {
      calls.push(['or', ...args]);
      return query;
    },
    order(...args) {
      calls.push(['order', ...args]);
      return query;
    },
    range(...args) {
      calls.push(['range', ...args]);
      return query;
    },
    then(resolve) {
      resolve({
        data: table === 'kiosks'
          ? [
            {
              id: 201,
              facebook_name: 'Soon A',
              customer_id: 101,
              status: 'warning',
              end_date: dateOnlyFromToday(1),
              total_paid: 100000,
              customers: { id: 101, facebook_name: 'A' },
              business_types: { name: 'Quán ăn' },
              categories: { name: 'Ăn uống' },
            },
            {
              id: 202,
              facebook_name: 'Soon B',
              customer_id: 102,
              status: 'warning',
              end_date: dateOnlyFromToday(3),
              total_paid: 200000,
              customers: { id: 102, facebook_name: 'B' },
              business_types: { name: 'Mẹ & Bé' },
              categories: { name: 'Đồ chơi' },
            },
            {
              id: 203,
              facebook_name: 'Soon A2',
              customer_id: 101,
              status: 'warning',
              end_date: dateOnlyFromToday(5),
              total_paid: 300000,
              customers: { id: 101, facebook_name: 'A' },
              business_types: { name: 'Quán ăn' },
              categories: { name: 'Ăn uống' },
            },
          ]
          : [
            { id: 102, facebook_name: 'B' },
            { id: 101, facebook_name: 'A' },
          ],
        count: table === 'kiosks' ? 3 : 0,
        error: null,
      });
    },
  };
  return query;
}

function todayDate() {
  return dateOnlyFromToday(0);
}

function dateOnlyFromToday(offsetDays) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
