import { requireSupabaseClient, runQuery } from './BaseService.js';
import { RevenueService } from './RevenueService.js';

export const DashboardService = {
  async getDashboardData(selectedDate = new Date()) {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth() + 1;
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('get_dashboard_data', {
        p_year: year,
        p_month: month,
      }),
    );
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
        recentRegistrations: normalizeRecentRegistrations(lists.recentRegistrations),
      },
      year: toCount(dashboard.year) || year,
      month: toCount(dashboard.month) || month,
      warningDays: toCount(dashboard.warningDays),
    };
  },
};

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
