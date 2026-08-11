import { requireSupabaseClient, runQuery } from './BaseService.js';
import { KioskService } from './KioskService.js';
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
    const expiringKiosks = await getExpiringKiosks();

    return {
      summary: {
        totalCustomers: toCount(summary.totalCustomers),
        totalKiosks: toCount(summary.totalKiosks),
        activeKiosks: toCount(summary.activeKiosks),
        pendingKiosks: toCount(summary.pendingKiosks),
        expiredKiosks: toCount(summary.expiredKiosks),
        expiringSoon: expiringKiosks.count,
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
        expiringKiosks: expiringKiosks.data,
        recentCustomers: Array.isArray(lists.recentCustomers) ? lists.recentCustomers : [],
      },
      year: toCount(dashboard.year) || year,
      month: toCount(dashboard.month) || month,
      warningDays: toCount(dashboard.warningDays),
    };
  },
};

async function getExpiringKiosks() {
  const { data, count } = await KioskService.list({
    status: 'warning',
    pagination: { page: 1, pageSize: 24 },
  });
  return {
    data: Array.isArray(data) ? data : [],
    count: Number.isFinite(Number(count)) ? Number(count) : (data || []).length,
  };
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}
