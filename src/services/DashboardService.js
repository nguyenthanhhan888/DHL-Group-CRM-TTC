import { startOfVietnamToday } from '../utils/date.js';
import { requireSupabaseClient, runQuery } from './BaseService.js';
import { RevenueService } from './RevenueService.js';
import { BusinessEventService } from './BusinessEventService.js';

const DASHBOARD_ACTIVITY_TYPES = ['registration', 'legacy', 'renewal'];

export const DashboardService = {
  async getDashboardData(selectedDate = startOfVietnamToday()) {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth() + 1;
    const supabase = requireSupabaseClient();
    const [{ data }, recentActivity] = await Promise.all([runQuery(
      supabase.rpc('get_dashboard_data', {
        p_year: year,
        p_month: month,
      }),
    ), loadRecentActivity()]);
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

async function loadRecentActivity() {
  const results = await Promise.all(DASHBOARD_ACTIVITY_TYPES.map((activity) => BusinessEventService.list({
    context: 'dashboard', activity, page: 1, pageSize: 5,
  })));
  return normalizeBusinessEvents(results.flatMap(({ data }) => data));
}

export function normalizeBusinessEvents(rows) {
  const events = (Array.isArray(rows) ? rows : [])
    .filter((item) => DASHBOARD_ACTIVITY_TYPES.includes(item?.event_type))
    .map((item) => ({
      id: item.event_key || item.id,
      type: item.event_type,
      label: item.activity_label || item.event_type,
      name: item.subject_name || 'Kiosk',
      amount: Number(item.amount || 0),
      occurredAt: item.occurred_at || item.created_at,
    }));
  return [...new Map(events.map((item) => [String(item.id), item])).values()]
    .sort((left, right) => Date.parse(right.occurredAt || 0) - Date.parse(left.occurredAt || 0)
      || String(right.id).localeCompare(String(left.id)))
    .slice(0, 5);
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
