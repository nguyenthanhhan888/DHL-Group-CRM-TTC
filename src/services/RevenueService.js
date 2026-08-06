/**
 * Normalizes database-calculated revenue values for display.
 * Authoritative filtering, date boundaries, sums, and grouping live in
 * the `get_dashboard_data` RPC.
 */
export const RevenueService = {
  toAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : 0;
  },

  normalizeMonthlySeries(series) {
    const totalsByMonth = new Map(
      (Array.isArray(series) ? series : []).map((item) => [
        Number(item?.month),
        this.toAmount(item?.total),
      ]),
    );

    return Array.from({ length: 12 }, (_, month) => ({
      month,
      total: totalsByMonth.get(month) || 0,
    }));
  },
};
