import { toVietnamDateTimeInput as promotionLocalDate, fromVietnamDateTimeInput as promotionInstant } from './date.js';
import { BUSINESS_TIME_ZONE, formatDateTime } from './date.js';
import { formatCurrency } from './currency.js';

export { toVietnamDateTimeInput as promotionLocalDate, fromVietnamDateTimeInput as promotionInstant } from './date.js';

export function promotionDateDefaults(item = {}, now = new Date()) {
  if (item.id) return { starts_at: promotionLocalDate(item.starts_at), ends_at: promotionLocalDate(item.ends_at) };
  const start = new Date(Math.floor(now.getTime() / 60000) * 60000);
  return { starts_at: promotionLocalDate(start), ends_at: promotionLocalDate(new Date(start.getTime() + 7 * 86400000)) };
}

export function promotionDraft(item = {}, now = new Date()) {
  return { ...item, ...promotionDateDefaults(item, now),
    time_mode: item.id && !item.ends_at ? 'unlimited' : 'timed',
    start_mode: item.id && !item.starts_at ? 'immediate' : 'scheduled',
    discount_type: item.discount_type || 'percentage', scope_type: item.scope_type || 'all',
    is_active: item.is_active !== false,
  };
}

export function switchPromotionTimeMode(draft, mode, now = new Date()) {
  if (mode === 'unlimited') return { ...draft, time_mode: mode, ends_at: '' };
  const defaults = promotionDateDefaults({}, now);
  const start = draft.start_mode === 'scheduled' && draft.starts_at ? promotionInstant(draft.starts_at) : promotionInstant(defaults.starts_at);
  const endFrom = Math.max(Date.parse(start), Date.parse(promotionInstant(defaults.starts_at)));
  return { ...draft, time_mode: 'timed',
    starts_at: draft.start_mode === 'scheduled' ? draft.starts_at || defaults.starts_at : '',
    ends_at: draft.ends_at || promotionLocalDate(new Date(endFrom + 7 * 86400000)),
  };
}

export function promotionPayload(draft, original = {}) {
  const timestamp = key => original.id && draft[key] === promotionLocalDate(original[key]) ? original[key] ?? null : draft[key] || null;
  return { ...draft,
    starts_at: draft.start_mode === 'immediate' ? null : timestamp('starts_at'),
    ends_at: draft.time_mode === 'unlimited' ? null : timestamp('ends_at'),
    is_active: original.id ? original.is_active : draft.is_active !== false && draft.is_active !== 'false',
    max_discount_amount: draft.discount_type === 'percentage' ? draft.max_discount_amount : null,
  };
}

export function promotionErrors(draft, categoryIds = [], businessTypeIds = []) {
  const errors = {};
  if (!String(draft.code || '').trim()) errors.code = 'Vui lòng nhập mã chương trình.';
  if (!String(draft.name || '').trim()) errors.name = 'Vui lòng nhập tên chương trình.';
  const reward = Number(draft.discount_value);
  if (!Number.isSafeInteger(reward) || reward <= 0) errors.discount_value = {
    percentage: 'Phần trăm giảm phải là số nguyên lớn hơn 0.', fixed_amount: 'Số tiền giảm phải là số nguyên lớn hơn 0.',
    bonus_months: 'Vui lòng nhập số tháng tặng thêm là số nguyên lớn hơn 0.',
  }[draft.discount_type] || 'Vui lòng chọn loại ưu đãi.';
  if (draft.discount_type === 'percentage' && reward > 100) errors.discount_value = 'Phần trăm giảm không được vượt quá 100%.';
  const labels = { max_discount_amount: 'Mức giảm tối đa', minimum_order_amount: 'Giá trị đơn tối thiểu', minimum_kiosk_count: 'Số Kiosk tối thiểu', minimum_months: 'Số tháng tối thiểu', usage_limit_total: 'Tổng lượt sử dụng', usage_limit_per_customer: 'Lượt dùng mỗi khách' };
  for (const [key, label] of Object.entries(labels)) {
    if (key === 'max_discount_amount' && draft.discount_type !== 'percentage') continue;
    if (draft[key] == null || draft[key] === '') continue;
    const value = Number(draft[key]), minimum = key === 'minimum_order_amount' ? 0 : 1;
    const maximum = ['minimum_kiosk_count','minimum_months','usage_limit_total','usage_limit_per_customer'].includes(key) ? 2147483647 : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) errors[key] = `${label} phải là số nguyên ${minimum ? 'lớn hơn 0' : 'không âm'} trong giới hạn cho phép.`;
  }
  if (draft.scope_type === 'category' && !categoryIds.length) errors.scope_type = 'Vui lòng chọn ít nhất một danh mục.';
  if (draft.scope_type === 'business_type' && !businessTypeIds.length) errors.scope_type = 'Vui lòng chọn ít nhất một loại hình kinh doanh.';
  let start, end;
  for (const [key, needed, label] of [['starts_at', draft.start_mode === 'scheduled', 'bắt đầu'], ['ends_at', draft.time_mode === 'timed', 'kết thúc']]) {
    if (!needed) continue;
    try {
      if (!draft[key]) throw Error();
      const value = Date.parse(promotionInstant(draft[key]));
      if (key === 'starts_at') start = value; else end = value;
    } catch { errors[key] = `Vui lòng chọn thời gian ${label} hợp lệ.`; }
  }
  if (start != null && end != null && end < start) errors.ends_at = 'Thời gian kết thúc phải từ thời gian bắt đầu trở đi.';
  return errors;
}

export function promotionReward(item) {
  if (!(Number(item.discount_value) > 0)) return 'Chưa nhập giá trị ưu đãi';
  if (item.discount_type === 'bonus_months') return `Tặng thêm ${item.discount_value} tháng cho mỗi Kiosk đủ điều kiện`;
  if (item.discount_type === 'fixed_amount') return `Giảm ${formatCurrency(item.discount_value)} trên phần đơn đủ điều kiện`;
  return `Giảm ${item.discount_value}% trên phần đơn đủ điều kiện${item.max_discount_amount ? `, tối đa ${formatCurrency(item.max_discount_amount)}` : ''}`;
}

export function promotionApplicability(item, names = []) {
  const scope = item.scope_type === 'all' ? 'Tất cả ngành nghề' : names.join(', ') || 'Chưa chọn phạm vi';
  const conditions = [scope];
  if (item.minimum_months) conditions.push(`mỗi Kiosk đăng ký/gia hạn từ ${item.minimum_months} tháng`);
  if (item.minimum_order_amount) conditions.push(`đơn từ ${formatCurrency(item.minimum_order_amount)}`);
  if (item.minimum_kiosk_count) conditions.push(`đơn có ít nhất ${item.minimum_kiosk_count} Kiosk`);
  return `Đăng ký mới và gia hạn · ${conditions.join(' · ')}`;
}

export function promotionPeriod(item) {
  const start = item.starts_at ? formatDateTime(item.starts_at) : '';
  if (!item.ends_at) return `Không giới hạn thời gian${start ? ` · Bắt đầu từ ${start}` : ' · Bắt đầu ngay'}`;
  return `${start ? `Từ ${start}` : 'Không đặt mốc bắt đầu'} đến ${formatDateTime(item.ends_at)}`;
}

export function promotionSaveError(error = {}) {
  if (error.code === '23505') return 'Mã chương trình đã tồn tại. Vui lòng chọn mã khác.';
  if (error.code === '42501') return 'Bạn không có quyền lưu chương trình. Vui lòng tải lại trang.';
  if (error.code === '23503' || error.code === '22023') return 'Phạm vi áp dụng không còn hợp lệ. Vui lòng tải lại và chọn lại.';
  return 'Không thể lưu chương trình. Vui lòng kiểm tra thông tin và thử lại.';
}
