import { addMonths, startOfToday, toDateOnly } from '../utils/date.js';
import { requireSupabaseClient, runQuery } from './BaseService.js';

const DEFAULT_PAYMENT_METHOD = 'transfer';

export const RegistrationService = {
  calculatePreview(businessType, { months = 1, discount = 0 } = {}) {
    return buildRegistrationPreview(businessType, { months, discount });
  },

  async submit({
    customer: customerInput,
    kiosks,
    businessTypeId,
    months = 1,
    discount = 0,
    discountReason = '',
    bill = null,
  } = {}) {
    const payload = await buildPublicRegistrationPayload({
      customerInput,
      kiosks,
      businessTypeId,
      months,
      discount,
      discountReason,
      bill,
    });
    const { data } = await runQuery(requireSupabaseClient().rpc('submit_public_registration', {
      customer_input: payload.customer,
      kiosks_input: payload.kiosks,
      bill_input: payload.bill,
    }));

    return normalizeRegistrationResponse(data);
  },

  async submitWithPayos(options = {}) {
    const submitted = await this.submit(options);
    const requestIds = (submitted.data?.kiosks || [])
      .map((item) => item?.request?.id)
      .filter(Boolean);
    if (!requestIds.length) return submitted;

    try {
      const response = await fetch('/api/payos/create-registration-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestIds,
          phone: submitted.data?.customer?.phone || options.customer?.phone,
          returnUrl: buildPublicRouteUrl('#/register'),
          cancelUrl: buildPublicRouteUrl('#/register'),
        }),
      });
      const data = await safeJson(response);
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || 'Không tạo được QR PayOS.');
      }
      return {
        data: {
          ...submitted.data,
          payosPayments: data.payments || [],
        },
      };
    } catch (error) {
      return {
        data: {
          ...submitted.data,
          payosError: error?.message || 'Không tạo được QR PayOS.',
        },
      };
    }
  },

  async submitExistingCustomerKiosk({
    customerId,
    kiosk,
    businessTypeId,
    months = 1,
    discount = 0,
    discountReason = '',
  } = {}) {
    if (!customerId) {
      throw new Error('Khách hàng là bắt buộc.');
    }

    if (!kiosk) {
      throw new Error('Thông tin Kiosk là bắt buộc.');
    }

    if (!businessTypeId) {
      throw new Error('Loại hình kinh doanh là bắt buộc.');
    }

    const { data } = await runQuery(requireSupabaseClient().rpc('submit_existing_customer_kiosk', {
      customer_id_input: Number(customerId),
      kiosk_input: {
        facebook_name: normalizeRequiredText(kiosk.facebook_name, 'Tên Facebook'),
        facebook_id: normalizeOptionalText(kiosk.facebook_id),
        facebook_link: normalizeOptionalText(kiosk.facebook_link),
        facebook_group_link: normalizeOptionalText(kiosk.facebook_group_link),
        business_type_id: Number(businessTypeId),
        months: Number(months),
        discount: Number(discount || 0),
        discount_reason: normalizeDiscountReason(discount, discountReason),
        payment_method: DEFAULT_PAYMENT_METHOD,
        note: normalizeOptionalText(kiosk.note),
      },
    }));
    return { data };
  },
};

async function buildPublicRegistrationPayload({
  customerInput,
  kiosks,
  businessTypeId,
  months = 1,
  discount = 0,
  discountReason = '',
  bill = null,
} = {}) {
  if (!customerInput) {
    throw new Error('Thông tin khách hàng là bắt buộc.');
  }

  const normalizedKiosks = (Array.isArray(kiosks) && kiosks.length ? kiosks : [{
    facebook_name: customerInput.facebook_name,
    facebook_link: customerInput.facebook_link,
    business_type_id: businessTypeId,
    months,
    discount,
    discount_reason: discountReason,
    note: customerInput.note,
  }]).map((item) => ({
    facebook_name: normalizeRequiredText(item.facebook_name, 'Tên Facebook'),
    facebook_id: normalizeOptionalDigits(item.facebook_id, 'Facebook ID'),
    facebook_link: normalizeRequiredText(item.facebook_link, 'Facebook URL'),
    category_id: item.category_id || null,
    business_type_id: item.business_type_id || businessTypeId,
    months: Number(item.months ?? months),
    discount: Number(item.discount ?? discount),
    discount_reason: normalizeOptionalText(item.discount_reason ?? discountReason),
    note: normalizeOptionalText(buildPublicRequestNote(customerInput, item.note)),
  }));

  return {
    customer: {
      facebook_name: normalizeRequiredText(customerInput.facebook_name, 'Tên khách hàng'),
      facebook_id: normalizeOptionalText(customerInput.facebook_id),
      facebook_link: normalizeOptionalText(customerInput.facebook_link),
      phone: normalizeRequiredText(customerInput.phone, 'Số điện thoại'),
      address: normalizeOptionalText(customerInput.address),
      note: normalizeOptionalText(customerInput.note),
    },
    kiosks: normalizedKiosks,
    bill: bill ? await encodeBill(bill) : null,
  };
}

function normalizeRegistrationResponse(data) {
  const first = data?.kiosks?.[0] || {};
  return {
    data: {
      ...data,
      kiosk: first.kiosk,
      payment: first.payment,
      request: first.request,
      preview: first.preview,
      businessType: first.businessType,
    },
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildPublicRouteUrl(route) {
  return `${window.location.origin}${window.location.pathname}${route}`;
}

function buildRegistrationPreview(businessType, { months = 1, discount = 0 } = {}) {
  if (!businessType) {
    throw new Error('Cần chọn loại hình kinh doanh để tính giá.');
  }

  const normalizedMonths = Number(months);
  const pricePerMonth = Number(businessType.price_per_month);
  const normalizedDiscount = Number(discount || 0);

  if (!Number.isInteger(normalizedMonths) || normalizedMonths < 1) {
    throw new Error('Số tháng phải là số nguyên lớn hơn 0.');
  }

  if (!Number.isFinite(pricePerMonth) || pricePerMonth < 0) {
    throw new Error('Giá loại hình kinh doanh không hợp lệ.');
  }

  if (!Number.isFinite(normalizedDiscount) || normalizedDiscount < 0) {
    throw new Error('Giảm giá phải là số lớn hơn hoặc bằng 0.');
  }

  const start = startOfToday();
  const end = addMonths(start, normalizedMonths);
  const subtotal = pricePerMonth * normalizedMonths;
  if (normalizedDiscount > subtotal) {
    throw new Error('Giảm giá không được lớn hơn tạm tính.');
  }

  return {
    businessTypeName: businessType.name || '',
    categoryId: businessType.category_id || '',
    months: normalizedMonths,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
    pricePerMonth,
    subtotal,
    discount: normalizedDiscount,
    totalAmount: subtotal - normalizedDiscount,
  };
}

async function encodeBill(file) {
  if (!(file instanceof File)) {
    throw new Error('Tệp hóa đơn không hợp lệ.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Hóa đơn phải nhỏ hơn hoặc bằng 5 MB.');
  }
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Hóa đơn phải là JPG, PNG, WEBP hoặc PDF.');
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp hóa đơn.'));
    reader.readAsDataURL(file);
  });

  return {
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
    content_base64: dataUrl.split(',')[1] || '',
  };
}

function normalizeRequiredText(value, label) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`${label} là bắt buộc.`);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  return String(value || '').trim() || null;
}

function normalizeDigits(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} là bắt buộc.`);
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} chỉ được chứa chữ số.`);
  return normalized;
}

function normalizeOptionalDigits(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} chỉ được chứa chữ số.`);
  return normalized;
}

function normalizeDiscountReason(discount, reason) {
  const normalizedReason = normalizeOptionalText(reason);
  if (Number(discount || 0) > 0 && !normalizedReason) {
    throw new Error('Cần nhập lý do khi áp dụng giảm giá.');
  }
  return normalizedReason;
}

function buildPublicRequestNote(customer, kioskNote) {
  return [
    customer?.contact_name ? `Người liên hệ: ${String(customer.contact_name).trim()}` : '',
    kioskNote || customer?.note || '',
  ].filter(Boolean).join('\n');
}
