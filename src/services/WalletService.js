import { requireSupabaseClient, runQuery } from './BaseService.js';

export const WalletService = {
  async getMyWallet() {
    const { data } = await runQuery(requireSupabaseClient().rpc('get_my_wallet'));
    return { data };
  },

  async getMyLedger({ page = 1, pageSize = 25 } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('get_my_wallet_ledger', {
      page_number: positiveInteger(page, 1),
      page_size: positiveInteger(pageSize, 25),
    }));

    return {
      data: Array.isArray(data?.rows) ? data.rows : [],
      count: Number(data?.total || 0),
      page: Number(data?.page || page),
      pageSize: Number(data?.pageSize || pageSize),
    };
  },
};

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
