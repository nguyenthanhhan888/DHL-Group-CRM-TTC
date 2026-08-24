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
    runQuery(supabase.from('payments').select('id,payment_status,total_amount,confirmed_at,created_at,transaction_type,registration_batch_id,customer_id,kiosk_id,customers(facebook_name),kiosks(facebook_name)').eq('payment_status','completed').not('confirmed_at','is',null).order('confirmed_at',{ascending:false}).limit(20)),
    runQuery(supabase.from('registration_requests').select('id,status,total_amount,reviewed_at,submitted_at,payment_id,facebook_name,metadata,kiosks(facebook_name)').eq('status','approved').not('reviewed_at','is',null).order('reviewed_at',{ascending:false}).limit(20)),
  ]);
  return buildRecentActivity(paymentsResult.data, requestsResult.data);
}

export function buildRecentActivity(paymentRows, requestRows) {
  const payments=(paymentRows||[]).filter(item=>item.payment_status==='completed'&&item.confirmed_at);const completedPaymentIds=new Set(payments.map(item=>String(item.id)));
  const paymentEvents=payments.map(item=>({id:`payment:${item.id}`,type:paymentActivityType(item),label:paymentActivityType(item),name:item.kiosks?.facebook_name||item.customers?.facebook_name||'Kiosk',amount:Number(item.total_amount||0),occurredAt:item.confirmed_at}));
  const additionalEvents=(requestRows||[]).filter(item=>item.status==='approved'&&item.reviewed_at&&isAdditionalRegistration(item)&&(!item.payment_id||!completedPaymentIds.has(String(item.payment_id)))).map(item=>({id:`request:${item.id}`,type:'Bổ sung Kiosk',label:'Bổ sung Kiosk',name:item.kiosks?.facebook_name||item.facebook_name||'Kiosk',amount:Number(item.total_amount||0),occurredAt:item.reviewed_at}));
  return [...paymentEvents,...additionalEvents].sort((a,b)=>Date.parse(b.occurredAt||0)-Date.parse(a.occurredAt||0)).slice(0,5);
}

function paymentActivityType(payment){if(String(payment.transaction_type).toLowerCase()==='renewal')return'Gia hạn';if(payment.registration_batch_id)return'Đăng ký mới';return'Thanh toán thành công';}
function isAdditionalRegistration(request){const source=String(request.metadata?.source||request.metadata?.registration_type||'').toLowerCase();return source.includes('legacy')||source.includes('additional');}

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
