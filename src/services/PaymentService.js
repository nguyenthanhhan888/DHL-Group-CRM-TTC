import { applyPagination, applySort, requireSupabaseClient, runQuery } from './BaseService.js';
import { AuditLogService } from './AuditLogService.js';

const PAYMENT_SELECT = '*, customers(facebook_name, phone), kiosks(facebook_name, facebook_id, business_type_id, business_types(name))';

export const PaymentService = {
  async renewKiosk({
    kioskId,
    months = 1,
    discount = 0,
    discountReason = '',
    note = '',
  } = {}) {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('create_renewal_payment', {
        kiosk_id_input: positiveInteger(kioskId, 'Kiosk'),
        months_input: positiveInteger(months, 'Số tháng'),
        discount_input: nonNegativeNumber(discount, 'Giảm giá'),
        discount_reason_input: normalizeOptionalText(discountReason),
        note_input: normalizeOptionalText(note),
      }),
    );
    return { data };
  },

  async list({
    searchTerm = '',
    status = '',
    paymentMethod = '',
    businessTypeId = '',
    sort = { column: 'created_at', ascending: false },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    const [searchContext, businessTypeKioskIds] = await Promise.all([
      buildSearchContext(supabase, searchTerm),
      findKioskIdsByBusinessType(supabase, businessTypeId),
    ]);
    let query = supabase
      .from('payments')
      .select(PAYMENT_SELECT, { count: 'exact' });

    query = applyPaymentFilters(query, {
      searchContext,
      status,
      paymentMethod,
      businessTypeKioskIds,
    });

    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listWithSummary({
    searchTerm = '',
    status = '',
    paymentMethod = '',
    businessTypeId = '',
    sort = { column: 'created_at', ascending: false },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    const [searchContext, businessTypeKioskIds] = await Promise.all([
      buildSearchContext(supabase, searchTerm),
      findKioskIdsByBusinessType(supabase, businessTypeId),
    ]);
    const filters = {
      searchContext,
      status,
      paymentMethod,
      businessTypeKioskIds,
    };

    let listQuery = supabase
      .from('payments')
      .select(PAYMENT_SELECT, { count: 'exact' });
    listQuery = applyPaymentFilters(listQuery, filters);

    const [listResult, summaryResult] = await Promise.all([
      runQuery(applyPagination(applySort(listQuery, sort), pagination)),
      getPaymentSummaryRpc(supabase, {
        searchTerm,
        status,
        paymentMethod,
        businessTypeId,
      }),
    ]);

    return {
      data: listResult.data,
      count: listResult.count,
      summary: normalizePaymentSummary(summaryResult.data),
    };
  },

  async getSummary({
    searchTerm = '',
    status = '',
    paymentMethod = '',
    businessTypeId = '',
  } = {}) {
    const supabase = requireSupabaseClient();
    const { data } = await getPaymentSummaryRpc(supabase, {
      searchTerm,
      status,
      paymentMethod,
      businessTypeId,
    });
    return { data: normalizePaymentSummary(data) };
  },

  async listPending() {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('payments')
        .select(PAYMENT_SELECT)
        .eq('payment_status', 'pending')
        .order('created_at', { ascending: true }),
    );
  },

  async listByKiosk(kioskId) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('payments')
        .select('id, created_at, start_date, end_date, months, price_per_month, discount, total_amount, payment_method, payment_status, note')
        .eq('kiosk_id', kioskId)
        .order('created_at', { ascending: false }),
    );
  },

  async listByCustomer(customerId) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('payments')
        .select('id, created_at, confirmed_at, start_date, end_date, months, price_per_month, discount, total_amount, payment_method, payment_status, note, kiosks(facebook_name)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false }),
    );
  },

  async getById(id) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('payments')
        .select('*, customers(*), kiosks(*)')
        .eq('id', id)
        .single(),
    );
  },

  async create(payment, reason) {
    if (String(payment?.payment_status || 'pending').toLowerCase() !== 'pending') {
      throw new Error('Thanh toán mới phải bắt đầu ở trạng thái Pending.');
    }
    const supabase = requireSupabaseClient();
    const { data, error } = await runQuery(
      supabase
        .from('payments')
        .insert([payment])
        .select()
        .single(),
    );

    if (error) throw error;

    await AuditLogService.log({
      module: 'Payment',
      action: 'create',
      after: data,
      reason,
    });

    return { data };
  },

  async updatePending(id, payment, reason) {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('update_pending_payment', {
        payment_id_input: positiveInteger(id, 'Thanh toán'),
        months_input: positiveInteger(payment.months, 'Số tháng'),
        discount_input: nonNegativeNumber(payment.discount, 'Giảm giá'),
        payment_method_input: requiredText(payment.payment_method, 'Phương thức thanh toán'),
        discount_reason_input: normalizeOptionalText(payment.discount_reason),
        note_input: normalizeOptionalText(payment.note),
        reason_input: normalizeOptionalText(reason) || 'Cập nhật thanh toán Pending',
      }),
    );
    return { data };
  },

  async updateNote(id, note, reason = 'Cập nhật ghi chú thanh toán') {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('update_payment_note', {
        payment_id_input: positiveInteger(id, 'Thanh toán'),
        note_input: normalizeOptionalText(note),
        reason_input: requiredText(reason, 'Lý do'),
      }),
    );
    return { data };
  },

  async confirm(id, reason = 'Xác nhận thanh toán') {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('confirm_payment', {
        payment_id_input: positiveInteger(id, 'Thanh toán'),
        reason_input: requiredText(reason, 'Lý do'),
      }),
    );
    return { data };
  },

  async cancel(id, reason) {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('cancel_payment', {
        payment_id_input: positiveInteger(id, 'Thanh toán'),
        reason_input: requiredText(reason, 'Lý do hủy'),
      }),
    );
    return { data };
  },

  async reject(id, reason) {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(
      supabase.rpc('reject_payment', {
        payment_id_input: positiveInteger(id, 'Thanh toán'),
        reason_input: requiredText(reason, 'Lý do từ chối'),
      }),
    );
    return { data };
  },

  async createAdjustment(id, {
    amountDelta,
    serviceMonthDelta = 0,
    reason,
  } = {}) {
    const supabase = requireSupabaseClient();
    const normalizedAmount = Number(amountDelta);
    const normalizedMonths = Number(serviceMonthDelta);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
      throw new Error('Số tiền điều chỉnh phải khác 0.');
    }
    if (!Number.isInteger(normalizedMonths)) {
      throw new Error('Số tháng điều chỉnh phải là số nguyên.');
    }
    const { data } = await runQuery(
      supabase.rpc('create_payment_adjustment', {
        original_payment_id_input: positiveInteger(id, 'Thanh toán gốc'),
        amount_delta_input: normalizedAmount,
        service_month_delta_input: normalizedMonths,
        reason_input: requiredText(reason, 'Lý do điều chỉnh'),
      }),
    );
    return { data };
  },
};

function normalizeOptionalText(value) {
  return String(value || '').trim() || null;
}

async function buildSearchContext(supabase, searchTerm) {
  const normalizedSearch = normalizeSearchTerm(searchTerm);
  if (!normalizedSearch) {
    return { searchTerm: '' };
  }

  const businessTypeIds = await findBusinessTypeIds(supabase, normalizedSearch);
  const [customerIds, kioskIds] = await Promise.all([
    findCustomerIds(supabase, normalizedSearch),
    findKioskIds(supabase, normalizedSearch, businessTypeIds),
  ]);

  return {
    searchTerm: normalizedSearch,
    customerIds,
    kioskIds,
  };
}

function applyPaymentFilters(query, {
  searchContext,
  status = '',
  paymentMethod = '',
  businessTypeKioskIds = null,
}) {
  if (status) query = query.eq('payment_status', status);
  if (paymentMethod) query = query.eq('payment_method', paymentMethod);
  if (Array.isArray(businessTypeKioskIds)) {
    query = businessTypeKioskIds.length
      ? query.in('kiosk_id', businessTypeKioskIds)
      : query.eq('kiosk_id', -1);
  }

  if (searchContext?.searchTerm) {
    query = query.or(buildSearchFilter(searchContext));
  }

  return query;
}

function buildSearchFilter({ searchTerm, customerIds = [], kioskIds = [] }) {
  const pattern = `%${searchTerm}%`;
  const conditions = [
    `payment_status.ilike.${pattern}`,
    `payment_method.ilike.${pattern}`,
    `discount_reason.ilike.${pattern}`,
    `note.ilike.${pattern}`,
  ];

  if (customerIds.length) {
    conditions.push(`customer_id.in.(${customerIds.join(',')})`);
  }

  if (kioskIds.length) {
    conditions.push(`kiosk_id.in.(${kioskIds.join(',')})`);
  }

  return conditions.join(',');
}

async function findCustomerIds(supabase, searchTerm) {
  const pattern = `%${searchTerm}%`;
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .or(`facebook_name.ilike.${pattern},facebook_id.ilike.${pattern},phone.ilike.${pattern}`)
    .limit(100);

  if (error) throw error;
  return (data || []).map((item) => item.id).filter(Boolean);
}

async function findBusinessTypeIds(supabase, searchTerm) {
  const { data, error } = await supabase
    .from('business_types')
    .select('id')
    .ilike('name', `%${searchTerm}%`)
    .limit(100);

  if (error) throw error;
  return (data || []).map((item) => item.id).filter(Boolean);
}

async function findKioskIds(supabase, searchTerm, businessTypeIds = []) {
  const pattern = `%${searchTerm}%`;
  const conditions = [
    `facebook_name.ilike.${pattern}`,
    `facebook_id.ilike.${pattern}`,
  ];

  if (businessTypeIds.length) {
    conditions.push(`business_type_id.in.(${businessTypeIds.join(',')})`);
  }

  const { data, error } = await supabase
    .from('kiosks')
    .select('id')
    .or(conditions.join(','))
    .limit(1000);

  if (error) throw error;
  return (data || []).map((item) => item.id).filter(Boolean);
}

async function findKioskIdsByBusinessType(supabase, businessTypeId) {
  if (!businessTypeId) return null;

  const { data, error } = await supabase
    .from('kiosks')
    .select('id')
    .eq('business_type_id', businessTypeId)
    .limit(1000);

  if (error) throw error;
  return (data || []).map((item) => item.id).filter(Boolean);
}

function normalizeSearchTerm(value) {
  return String(value || '')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getPaymentSummaryRpc(supabase, {
  searchTerm = '',
  status = '',
  paymentMethod = '',
  businessTypeId = '',
} = {}) {
  return runQuery(
    supabase.rpc('get_payment_summary', {
      search_input: normalizeOptionalText(searchTerm),
      status_input: normalizeOptionalText(status),
      payment_method_input: normalizeOptionalText(paymentMethod),
      business_type_id_input: businessTypeId
        ? positiveInteger(businessTypeId, 'Loại hình kinh doanh')
        : null,
    }),
  );
}

function normalizePaymentSummary(data) {
  return {
    totalRevenue: finiteNumber(data?.totalRevenue),
    monthRevenue: finiteNumber(data?.monthRevenue),
    transferRevenue: finiteNumber(data?.transferRevenue),
    pendingCount: finiteNumber(data?.pendingCount),
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} không hợp lệ.`);
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} không hợp lệ.`);
  }
  return number;
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} là bắt buộc.`);
  return text;
}
