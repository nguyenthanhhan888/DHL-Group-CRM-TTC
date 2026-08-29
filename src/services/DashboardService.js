import { requireSupabaseClient, runQuery } from './BaseService.js';
import { RevenueService } from './RevenueService.js';

export const DashboardService = {
  async getDashboardData(selectedDate = new Date()) {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth() + 1;
    const supabase = requireSupabaseClient();
    const [{ data }, recentActivity] = await Promise.all([runQuery(
      supabase.rpc('get_dashboard_data', {
        p_year: year,
        p_month: month,
      }),
    ), loadRecentActivity(supabase)]);
    const dashboard = data || {};
    const summary = dashboard.summary || {};
    const charts = dashboard.charts || {};
    const lists = dashboard.lists || {};
    return {
      summary: {
        totalCustomers: toCount(summary.totalCustomers),
        totalKiosks: toCount(summary.totalKiosks),
        activeKiosks: toCount(summary.activeKiosks),
        pendingKiosks: toCount(summary.pendingKiosks),
        expiredKiosks: toCount(summary.expiredKiosks),
        expiringSoon: toCount(summary.expiringSoon),
        revenueThisMonth: RevenueService.toAmount(summary.revenueThisMonth),
        revenueThisYear: RevenueService.toAmount(summary.revenueThisYear),
      },
      charts: {
        monthlyRevenue: RevenueService.normalizeMonthlySeries(charts.monthlyRevenue),
        categoryDistribution: Array.isArray(charts.categoryDistribution)
          ? charts.categoryDistribution.map((item) => ({
            name: item?.name || 'Chưa phân loại',
            count: toCount(item?.count),
          }))
          : [],
      },
      lists: {
        expiringKiosks: Array.isArray(lists.expiringKiosks) ? lists.expiringKiosks : [],
        recentActivity,
      },
      year: toCount(dashboard.year) || year,
      month: toCount(dashboard.month) || month,
      warningDays: toCount(dashboard.warningDays),
    };
  },
};

async function loadRecentActivity(supabase) {
  const [paymentsResult, requestsResult] = await Promise.all([
    runQuery(supabase.from('payments').select('id,payment_status,total_amount,confirmed_at,created_at,transaction_type,registration_batch_id,registration_request_id,payment_intent_key,note,customer_id,kiosk_id,customers(facebook_name),kiosks(facebook_name)').eq('payment_status','completed').not('confirmed_at','is',null).order('confirmed_at',{ascending:false}).limit(20)),
    runQuery(supabase.from('registration_requests').select('id,status,total_amount,reviewed_at,submitted_at,payment_id,facebook_name,metadata,kiosks(facebook_name)').eq('status','approved').not('reviewed_at','is',null).order('reviewed_at',{ascending:false}).limit(20)),
  ]);
  const completedPayments = (paymentsResult.data || [])
    .filter((item) => item.payment_status === 'completed' && item.confirmed_at);
  const paymentIds = completedPayments.map((item) => String(item.id));
  if (!paymentIds.length) return buildRecentActivity([], requestsResult.data, []);

  const linkedRequestsResult = await runQuery(supabase.from('registration_requests').select('id,status,total_amount,reviewed_at,submitted_at,payment_id,facebook_name,metadata,kiosks(facebook_name)').in('payment_id', paymentIds));
  const requests = uniqueById([...(requestsResult.data || []), ...(linkedRequestsResult.data || [])]);
  const requestsByPaymentId = requestMapByPaymentId(requests);
  const auditCandidateIds = completedPayments
    .filter((item) => !knownPaymentActivityType(item, requestsByPaymentId.get(String(item.id))))
    .map((item) => String(item.id));
  const paymentAudits = await loadPaymentAudits(supabase, auditCandidateIds);
  return buildRecentActivity(completedPayments, requests, paymentAudits);
}

export function buildRecentActivity(paymentRows, requestRows, paymentAuditRows = []) {
  const payments = (paymentRows || []).filter((item) => item.payment_status === 'completed' && item.confirmed_at);
  const completedPaymentIds = new Set(payments.map((item) => String(item.id)));
  const requestsByPaymentId = requestMapByPaymentId(requestRows);
  const auditActionsByPaymentId = paymentAuditActions(paymentAuditRows);
  const paymentEvents = payments.map((item) => {
    const type = paymentActivityType(
      item,
      requestsByPaymentId.get(String(item.id)),
      auditActionsByPaymentId.get(String(item.id)),
    );
    return {
      id: `payment:${item.id}`,
      type,
      label: type,
      name: item.kiosks?.facebook_name || item.customers?.facebook_name || 'Kiosk',
      amount: Number(item.total_amount || 0),
      occurredAt: item.confirmed_at,
    };
  });
  const additionalEvents = (requestRows || [])
    .filter((item) => item.status === 'approved'
      && item.reviewed_at
      && isAdditionalRegistration(item)
      && (!item.payment_id || !completedPaymentIds.has(String(item.payment_id))))
    .map((item) => ({
      id: `request:${item.id}`,
      type: 'Bổ sung Kiosk',
      label: 'Bổ sung Kiosk',
      name: item.kiosks?.facebook_name || item.facebook_name || 'Kiosk',
      amount: Number(item.total_amount || 0),
      occurredAt: item.reviewed_at,
    }));
  return [...paymentEvents,...additionalEvents].sort((a,b)=>Date.parse(b.occurredAt||0)-Date.parse(a.occurredAt||0)).slice(0,5);
}

function paymentActivityType(payment, linkedRequest, auditActions = new Set()) {
  const knownType = knownPaymentActivityType(payment, linkedRequest);
  if (knownType) return knownType;
  if (auditActions.has('admin_manual_renewal') || auditActions.has('create_renewal')) return 'Gia hạn';
  throw new Error(`Không thể phân loại hoạt động thanh toán #${payment.id}.`);
}

function knownPaymentActivityType(payment, linkedRequest) {
  if (isAdditionalRegistration(linkedRequest)) return 'Bổ sung Kiosk';
  if (payment.registration_batch_id != null
    || payment.registration_request_id != null
    || linkedRequest) return 'Đăng ký mới';

  const intentKey = String(payment.payment_intent_key || '').toLowerCase();
  const transactionType = String(payment.transaction_type || '').toLowerCase();
  const isRenewal = transactionType === 'renewal'
    || intentKey.startsWith('public-renewal:')
    || intentKey.startsWith('admin-renewal:')
    || payment.note === 'Public PayOS Kiosk renewal';
  if (isRenewal) return 'Gia hạn';
  return null;
}

function isAdditionalRegistration(request) {
  const source = String(request?.metadata?.request_type
    || request?.metadata?.source
    || request?.metadata?.registration_type
    || '').toLowerCase();
  return source.includes('legacy') || source.includes('additional');
}

function paymentAuditActions(rows) {
  const actions = new Map();
  (rows || []).forEach((row) => {
    const paymentId = String(row.record_id);
    if (!actions.has(paymentId)) actions.set(paymentId, new Set());
    actions.get(paymentId).add(String(row.action || '').toLowerCase());
  });
  return actions;
}

async function loadPaymentAudits(supabase, paymentIds) {
  const results = await Promise.all(paymentIds.map((paymentId) => runQuery(supabase.rpc('get_audit_logs', {
    actor_filter: null,
    module_filter: 'Payment',
    action_filter: null,
    from_time: null,
    to_time: null,
    search_term: paymentId,
    show_technical: true,
    page_number: 1,
    page_size: 10,
  }))));
  return results.flatMap(({ data }, index) => (data?.rows || [])
    .filter((row) => String(row.record_id) === paymentIds[index]
      && ['admin_manual_renewal', 'create_renewal'].includes(String(row.action).toLowerCase())));
}

function requestMapByPaymentId(rows) {
  return new Map((rows || [])
    .filter((item) => item.payment_id != null)
    .map((item) => [String(item.payment_id), item]));
}

function uniqueById(rows) {
  return [...new Map(rows.map((item) => [String(item.id), item])).values()];
}

export function normalizeRecentRegistrations(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: item?.id ?? null,
    kioskName: String(item?.kioskName || 'Kiosk'),
    amount: RevenueService.toAmount(item?.amount),
    createdAt: item?.createdAt || null,
  }));
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}
