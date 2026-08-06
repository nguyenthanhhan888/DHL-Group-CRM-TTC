import { requireSupabaseClient, runQuery } from './BaseService.js';

export const LegacyRegistrationService = {
  async createPublicRequest({ customer, kiosks } = {}) {
    const normalizedCustomer = normalizeCustomer(customer);
    const normalizedKiosks = (kiosks || []).map(normalizeKiosk);
    if (!normalizedCustomer.facebook_name || !normalizedCustomer.phone) {
      throw new Error('Tên Facebook và số điện thoại khách hàng là bắt buộc.');
    }
    if (!normalizedKiosks.length) throw new Error('Cần ít nhất một kiosk.');
    normalizedKiosks.forEach(validateKiosk);

    const { data } = await runQuery(requireSupabaseClient().rpc('submit_public_legacy_registration', {
      customer_input: normalizedCustomer,
      kiosks_input: normalizedKiosks,
    }));
    return { data };
  },

  async create({
    customer,
    kiosk,
    kiosks,
    businessTypeId,
    amount,
    startDate,
    endDate,
    note = '',
  } = {}) {
    const normalizedCustomer = normalizeCustomer(customer);
    if (!normalizedCustomer.facebook_name) throw new Error('Tên Facebook khách hàng là bắt buộc.');
    if (!normalizedCustomer.phone) throw new Error('Số điện thoại khách hàng là bắt buộc.');
    const normalizedKiosks = (Array.isArray(kiosks) && kiosks.length ? kiosks : [{
      ...kiosk,
      business_type_id: businessTypeId,
      amount,
      start_date: startDate,
      end_date: endDate,
      note,
    }]).map(normalizeKiosk);

    if (!normalizedKiosks.length) throw new Error('Cần ít nhất một kiosk.');
    normalizedKiosks.forEach(validateKiosk);

    const { data } = await runQuery(requireSupabaseClient().rpc('submit_legacy_registration', {
      customer_input: {
        ...normalizedCustomer,
        note: normalizeOptional(note),
      },
      kiosks_input: normalizedKiosks,
    }));
    return {
      data: {
        ...data,
        kiosk: data?.items?.[0]?.kiosk || null,
        payment: data?.items?.[0]?.payment || null,
        legacyRequest: data?.items?.[0]?.legacyRequest || null,
      },
    };
  },
};

function normalizeCustomer(value = {}) {
  return {
    facebook_name: normalizeOptional(value.facebook_name),
    facebook_id: normalizeOptional(value.facebook_id),
    facebook_link: normalizeOptional(value.facebook_link),
    phone: normalizeOptional(value.phone),
    note: normalizeOptional(value.note),
  };
}

function normalizeKiosk(value = {}) {
  return {
    facebook_name: normalizeOptional(value.facebook_name),
    facebook_id: normalizeOptional(value.facebook_id),
    facebook_link: normalizeOptional(value.facebook_link),
    facebook_group_link: normalizeOptional(value.facebook_group_link),
    category_id: normalizeOptional(value.category_id),
    business_type_id: normalizeOptional(value.business_type_id),
    amount: Number(value.amount),
    start_date: normalizeOptional(value.start_date),
    end_date: normalizeOptional(value.end_date),
    note: normalizeOptional(value.note),
  };
}

function normalizeOptional(value) {
  return String(value || '').trim() || null;
}

function validateKiosk(kiosk, index) {
  const label = `Kiosk ${index + 1}`;
  if (!kiosk.facebook_name) throw new Error(`${label}: tên Facebook là bắt buộc.`);
  if (!kiosk.facebook_link) throw new Error(`${label}: link Facebook là bắt buộc.`);
  if (!kiosk.facebook_id) throw new Error(`${label}: Facebook ID là bắt buộc.`);
  if (!/^\d+$/.test(kiosk.facebook_id)) throw new Error(`${label}: Facebook ID chỉ được chứa chữ số.`);
  if (!kiosk.business_type_id) throw new Error(`${label}: dịch vụ là bắt buộc.`);
  if (!Number.isFinite(kiosk.amount) || kiosk.amount < 0) {
    throw new Error(`${label}: số tiền không hợp lệ.`);
  }
  if (!kiosk.start_date || !kiosk.end_date || kiosk.end_date < kiosk.start_date) {
    throw new Error(`${label}: ngày hết hạn phải từ ngày đăng ký trở đi.`);
  }
}
