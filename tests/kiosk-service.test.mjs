import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceOrganizationSettings } from '../src/config/organization.js';
import { CustomerService } from '../src/services/CustomerService.js';
import { DashboardService } from '../src/services/DashboardService.js';
import { KioskService } from '../src/services/KioskService.js';
import { ReportService } from '../src/services/ReportService.js';

let calls = [];

test('kiosk list delegates warning and active sorting to the authoritative status RPC', async () => {
  calls = [];
  setupSupabaseMock();

  await KioskService.list({
    status: 'warning',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.deepEqual(calls.find(([method, name]) => method === 'rpc' && name === 'get_kiosk_status_data')?.[2], {
    p_search: null, p_status: 'warning', p_business_type_id: null,
    p_sort_by: 'end_date', p_sort_direction: 'asc', p_page: 1, p_page_size: 12,
  });

  calls.length = 0;
  await KioskService.list({
    status: 'active',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.deepEqual(calls.find(([method, name]) => method === 'rpc' && name === 'get_kiosk_status_data')?.[2], {
    p_search: null, p_status: 'active', p_business_type_id: null,
    p_sort_by: 'created_at', p_sort_direction: 'desc', p_page: 1, p_page_size: 12,
  });
});

test('kiosk status filters use only the authoritative status RPC', async () => {
  calls = [];
  replaceOrganizationSettings({ warning_days: '20' });
  setupSupabaseMock();

  await KioskService.list({
    status: 'warning',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.deepEqual(calls.filter(([method]) => method === 'rpc').map((call) => call[1]), ['get_kiosk_status_data']);
  assert.deepEqual(calls.filter(([method]) => method === 'from'), []);

  calls = [];
  await KioskService.list({
    status: 'expired',
    pagination: { page: 1, pageSize: 12 },
  });

  assert.equal(calls.find(([method, name]) => method === 'rpc' && name === 'get_kiosk_status_data')?.[2].p_status, 'expired');
  assert.deepEqual(calls.filter(([method]) => method === 'from'), []);

  replaceOrganizationSettings({});
});

test('customer kiosk-state filters use only the authoritative customer status RPC', async () => {
  calls = [];
  replaceOrganizationSettings({ warning_days: '20' });
  setupSupabaseMock();

  const { data, count } = await CustomerService.list({
    kioskState: 'warning',
    pagination: { page: 1, pageSize: 10 },
  });

  assert.equal(calls.find(([method, name]) => method === 'rpc' && name === 'get_customer_status_data')?.[2].p_kiosk_status, 'warning');
  assert.deepEqual(calls.filter(([method]) => method === 'from'), []);
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
  assert.deepEqual(calls.filter(([method]) => method === 'rpc').map((call) => call.slice(0, 2)), [
    ['rpc', 'get_dashboard_data'],
    ['rpc', 'get_business_events'],
    ['rpc', 'get_business_events'],
    ['rpc', 'get_business_events'],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'from').map((call) => call[1]), []);

  replaceOrganizationSettings({});
});

test('kiosk reports use only the authoritative report RPC result', async () => {
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
  assert.deepEqual(calls.filter(([method]) => method === 'rpc').map((call) => call.slice(0, 2)), [
    ['rpc', 'get_reports_data'],
    ['rpc', 'get_registration_operations_summary'],
    ['rpc', 'get_expense_report_summary'],
    ['rpc', 'get_current_financial_kpis'],
  ]);
  assert.deepEqual(calls.filter(([method]) => method === 'from'), []);

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
        rpc: (name, args) => {
          calls.push(['rpc', name, args]);
          const statusRows = [
            { id: 101, facebook_name: 'A', status: 'warning' },
            { id: 102, facebook_name: 'B', status: 'warning' },
          ];
          if (name === 'get_kiosk_status_data' || name === 'get_customer_status_data') {
            return Promise.resolve({
              data: { rows: statusRows, totalRows: 2, statusCounts: { warning: 2 }, warningDays: 20 },
              error: null,
            });
          }
          return Promise.resolve({
            data: {
              summary: { totalKiosks: 3, expiringSoon: 3 },
              charts: {},
              groups: { kioskStatuses: [] },
              rows: [
                { id: 201, endDate: dateOnlyFromToday(1), derivedStatus: 'warning' },
                { id: 202, endDate: dateOnlyFromToday(3), derivedStatus: 'warning' },
                { id: 203, endDate: dateOnlyFromToday(5), derivedStatus: 'warning' },
              ],
              pagination: { page: 1, pageSize: 50, totalRows: 3, totalPages: 1 },
              lists: {
                expiringKiosks: [
                  { id: 201, end_date: dateOnlyFromToday(1) },
                  { id: 202, end_date: dateOnlyFromToday(3) },
                  { id: 203, end_date: dateOnlyFromToday(5) },
                ],
              },
              warningDays: 20,
              reportDate: todayDate(),
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
    not(...args) {
      calls.push(['not', ...args]);
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
    limit(...args) {
      calls.push(['limit', ...args]);
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
