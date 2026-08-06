import { getSupabaseClient } from '../supabase/client.js';

export const PayosService = {
  async createPayment(payload = {}) {
    const token = await getAccessToken();
    const response = await fetch('/api/payos/create-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await safeJson(response);
    if (!response.ok || data?.success === false) {
      throw new Error(data?.message || 'Không tạo được link thanh toán PayOS.');
    }
    return { data };
  },

  async createCrmPayment({
    paymentId,
    amount,
    description,
    returnUrl,
    cancelUrl,
  } = {}) {
    return this.createPayment({
      purpose: 'crm_payment',
      paymentId,
      amount,
      description,
      returnUrl,
      cancelUrl,
    });
  },

  async createWalletTopup({
    walletUserId,
    amount,
    description,
    returnUrl,
    cancelUrl,
  } = {}) {
    return this.createPayment({
      purpose: 'wallet_topup',
      walletUserId,
      amount,
      description,
      returnUrl,
      cancelUrl,
    });
  },
};

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getAccessToken() {
  const supabase = getSupabaseClient();
  if (!supabase?.auth?.getSession) return '';
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
}
