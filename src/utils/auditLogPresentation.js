import { PERMISSION_LABELS } from '../constants/permissions.js';
import { formatCurrency } from './currency.js';

export const AUDIT_CATEGORY_FILTERS = Object.freeze([
  { value: '', label: 'Tất cả' },
  { value: 'kiosk', label: 'Kiosk' },
  { value: 'customer', label: 'Khách hàng' },
  { value: 'payment', label: 'Thanh toán' },
  { value: 'renewal', label: 'Gia hạn' },
  { value: 'user', label: 'Người dùng' },
  { value: 'promotion', label: 'Mã giảm giá' },
  { value: 'expense', label: 'Chi phí' },
  { value: 'system', label: 'Hệ thống' },
]);

const CATEGORY_LABELS = Object.freeze(Object.fromEntries(AUDIT_CATEGORY_FILTERS.map((item) => [item.value, item.label])));
const ACTION_LABELS = Object.freeze({
  registration_pending: 'Đăng ký', renewal_pending: 'Gia hạn', renewal_paid: 'Gia hạn thành công', payment_review_required: 'Cần đối soát',
  create: 'Tạo mới', update: 'Cập nhật', delete: 'Xóa', confirm: 'Xác nhận', cancel: 'Hủy',
  reject: 'Từ chối', approve: 'Phê duyệt', approved: 'Phê duyệt', set_active: 'Đổi trạng thái',
  reset_password: 'Đặt lại mật khẩu', update_profile: 'Cập nhật người dùng',
  admin_reset_user_password: 'Đặt lại mật khẩu', admin_update_user_profile: 'Cập nhật người dùng',
  admin_update_user_status: 'Đổi trạng thái người dùng',
  sync_permissions: 'Thay đổi quyền', lock_user: 'Khóa người dùng', unlock_user: 'Mở khóa người dùng',
  adjust_wallet: 'Điều chỉnh số dư', admin_adjustment: 'Điều chỉnh số dư',
  admin_manual_renewal: 'Gia hạn', confirm_payos: 'PayOS xác nhận',
  confirm_payos_batch: 'PayOS xác nhận', admin_cancel: 'Hủy Kiosk',
  review_legacy_approve: 'Duyệt hồ sơ', review_legacy_cancel: 'Hủy hồ sơ',
  create_promotion: 'Tạo mã giảm giá', update_promotion: 'Sửa mã giảm giá',
  pause_promotion: 'Tạm ngưng', reactivate_promotion: 'Kích hoạt', delete_promotion: 'Xóa mã giảm giá',
  create_expense: 'Thêm chi phí', create_salary_expense: 'Ghi nhận lương',
  update_expense: 'Sửa chi phí', archive_expense: 'Hủy chi phí',
  expire: 'Đánh dấu hết hạn', expired: 'Đánh dấu hết hạn', activate: 'Kích hoạt', deactivate: 'Vô hiệu hóa',
});

const FIELD_LABELS = Object.freeze({
  facebook_name: 'Tên hiển thị', name: 'Tên', display_name: 'Họ tên', username: 'Tên đăng nhập',
  phone: 'Số điện thoại', email: 'Email', facebook_id: 'Facebook ID', facebook_link: 'Liên kết Facebook',
  facebook_url_original: 'Liên kết Facebook', customer_id: 'Khách hàng', kiosk_id: 'Kiosk', user_id: 'Người dùng',
  payment_id: 'Thanh toán', promotion_id: 'Mã giảm giá', category_id: 'Danh mục',
  business_type_id: 'Ngành nghề', start_date: 'Ngày bắt đầu', end_date: 'Ngày hết hạn',
  kiosk_end_date: 'Thời hạn hiện tại của Kiosk',
  requested_start_date: 'Ngày bắt đầu', requested_end_date: 'Ngày hết hạn',
  renewal_period_start: 'Ngày bắt đầu gia hạn', new_start_date: 'Ngày bắt đầu mới',
  new_expiry_date: 'Ngày hết hạn mới', old_expiry_date: 'Ngày hết hạn cũ',
  status: 'Trạng thái', payment_status: 'Trạng thái thanh toán', payment_method: 'Phương thức thanh toán',
  months: 'Gói dịch vụ', service_month_delta: 'Số tháng gia hạn', total_amount: 'Số tiền thanh toán',
  actual_amount: 'Số tiền thực nhận', amount: 'Số tiền', balance: 'Số dư', balance_before: 'Số dư trước',
  balance_after: 'Số dư sau', discount: 'Giảm giá', discount_value: 'Giá trị giảm', discount_type: 'Loại giảm giá',
  is_active: 'Trạng thái áp dụng', web_access_enabled: 'Quyền truy cập Web', permissions: 'Quyền được cấp',
  tier: 'Cấp bậc TTC', credit_limit: 'Hạn mức', note: 'Ghi chú', reason: 'Lý do', kiosk_count: 'Số Kiosk',
  expense_date: 'Ngày chi', salary_period: 'Kỳ lương', employee_user_id: 'Nhân viên', category: 'Danh mục chi phí',
});

const MONEY_FIELDS = /(?:^|_)(?:amount|balance|price|total|discount|credit_limit)(?:$|_)/i;
const DATE_FIELDS = /(?:^|_)(?:date|at)(?:$|_)/i;
const HIDDEN_BUSINESS_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'confirmed_by', 'reviewed_by',
  'metadata', 'provider_payload', 'raw_payload', 'request_payload', 'response_payload', 'legacy_log_id',
]);
const BUSINESS_ACTIONS = new Set(Object.keys(ACTION_LABELS));

export function formatAuditLog(log = {}) {
  const category = categoryForLog(log);
  const actorName = actorDisplayName(log);
  const objectName = entityDisplayName(log);
  const changes = businessChanges(log);
  const action = normalizeAction(log.action);
  const actionLabelValue = isHistoricalPaymentCorrection(log) ? 'Sửa dữ liệu thanh toán' : actionLabel(action);
  const title = businessTitle({ log, action, category, actorName, objectName, changes });
  const secondary = businessSecondary({ log, action, category, changes });
  return {
    category,
    categoryLabel: categoryLabel(category),
    actionLabel: actionLabelValue,
    title,
    secondary,
    actorName,
    objectName,
    source: sourceLabel(log),
    timestamp: log.created_at || null,
    changes,
    technical: isTechnicalLog(log),
    technicalData: {
      event: log.action || null,
      table: log.entity || log.module || null,
      recordId: log.record_id || null,
      before: log.before || null,
      after: log.after || null,
      reason: log.reason || null,
    },
  };
}

export function categoryForLog(log = {}) {
  const action = normalizeAction(log.action);
  const scope = `${log.module || ''} ${log.entity || ''}`.toLowerCase();
  if (/expense/.test(scope) || /expense/.test(action)) return 'expense';
  if (AUDIT_CATEGORY_FILTERS.some((item) => item.value && item.value === log.category)) return log.category;
  if (/renew|gia_han/.test(scope) || /renewal/.test(action)) return 'renewal';
  if (/promotion|discount|coupon/.test(scope) || /promotion/.test(action)) return 'promotion';
  if (/payment|payos|transaction/.test(scope) || /payos|refund|payment/.test(action)) return 'payment';
  if (/user|staff|profile|permission|wallet/.test(scope) || /password|permission|lock_user|unlock_user|wallet/.test(action)) return 'user';
  if (/customer/.test(scope)) return 'customer';
  if (/kiosk|registration/.test(scope) || /legacy_(?:approve|cancel)|admin_cancel/.test(action)) return action === 'admin_manual_renewal' ? 'renewal' : 'kiosk';
  return 'system';
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || 'Hệ thống';
}

export function actionLabel(action) {
  const normalized = normalizeAction(action);
  return ACTION_LABELS[normalized] || (normalized ? 'Sự kiện tự động' : 'Cập nhật hệ thống');
}

export function moduleLabel(module) {
  const normalized = String(module || '').toLowerCase();
  const direct = {
    customer: 'Khách hàng', customers: 'Khách hàng', kiosk: 'Kiosk', kiosks: 'Kiosk',
    payment: 'Thanh toán', payments: 'Thanh toán', renewal: 'Gia hạn', registration: 'Kiosk',
    registration_requests: 'Kiosk', registration_batches: 'Kiosk', staff: 'Người dùng',
    user: 'Người dùng', users: 'Người dùng', usermanagement: 'Người dùng', user_profiles: 'Người dùng',
    promotion: 'Mã giảm giá', promotions: 'Mã giảm giá', system: 'Hệ thống',
    expense: 'Chi phí', expenses: 'Chi phí',
  };
  return direct[normalized] || 'Đối tượng';
}

export function actorDisplayName(log = {}) {
  const actor = String(log.actor_name || '').trim();
  const type = String(log.actor_type || '').toLowerCase();
  const action = normalizeAction(log.action);
  const reason = String(log.reason || '').toLowerCase();
  if (action.includes('payos') || reason.includes('payos')) return 'Hệ thống PayOS';
  if (type === 'public') return 'Người dùng đăng ký';
  if (type === 'database_trigger') return 'Hệ thống tự động';
  if (type === 'system' || !actor || /^(system|database trigger)$/i.test(actor)) {
    if (/webhook/.test(reason)) return 'Hệ thống webhook';
    if (/cron|expire|cleanup|sync|automatic|tự động/.test(`${action} ${reason}`)) return 'Hệ thống tự động';
    return 'Hệ thống CRM';
  }
  return actor;
}

export function sourceLabel(log = {}) {
  const actor = actorDisplayName(log);
  if (actor === 'Hệ thống PayOS') return 'PayOS';
  if (actor === 'Hệ thống webhook') return 'Webhook';
  if (actor === 'Hệ thống tự động') return 'Tự động';
  if (actor === 'Người dùng đăng ký') return 'Cổng đăng ký';
  if (actor === 'Hệ thống CRM') return 'CRM';
  return 'Quản trị viên';
}

export function entityDisplayName(log = {}) {
  const resolved = log.resolved_entity;
  if (resolved?.name) return entityWithKind(resolved.kind, resolved.name);
  const category = categoryForLog(log);
  const sources = [log.after, log.before].filter(isObject);
  const names = log.resolved_names || {};
  if (category === 'promotion') {
    const code = firstNestedValue(sources, ['code']) || names.promotion?.name;
    if (code) return `Mã giảm giá ${code}`;
  }
  if (category === 'user') {
    const name = names.user?.name || firstNestedValue(sources, ['display_name', 'username']);
    if (name) return `Người dùng ${name}`;
  }
  const directName = firstNestedValue(sources, ['facebook_name', 'kiosk_name', 'customer_name', 'name']);
  if (directName) return entityWithKind(moduleLabel(log.entity || log.module), directName);
  const kioskName = names.kiosk?.name || firstNestedValue(sources, ['kiosk.facebook_name', 'kiosk.name']);
  if (kioskName) return `Kiosk ${kioskName}`;
  const customerName = names.customer?.name;
  if (customerName) return `Khách hàng ${customerName}`;
  if (category === 'payment') {
    const amount = extractValue(log, ['actual_amount', 'total_amount', 'amount']);
    return amount !== null ? `Thanh toán ${formatCurrency(amount)}` : fallbackEntity('Thanh toán', log.record_id);
  }
  if (resolved?.missing) return fallbackEntity(resolved.kind, resolved.id || log.record_id, true);
  return fallbackEntity(moduleLabel(log.entity || log.module), log.record_id);
}

export function businessChanges(log = {}) {
  const before = isObject(log.before) ? log.before : null;
  const after = isObject(log.after) ? log.after : null;
  const fields = summarizeChangedFields(before, after)
    .filter((field) => !HIDDEN_BUSINESS_FIELDS.has(field))
    .filter((field) => !isObject(before?.[field]) && !isObject(after?.[field]));
  return fields.map((field) => ({
    field,
    label: fieldLabel(field),
    before: formatBusinessValue(field, before?.[field], log),
    after: formatBusinessValue(field, after?.[field], log),
  }));
}

export function summarizeChangedFields(before, after) {
  if (!before && after) return Object.keys(after);
  if (before && !after) return Object.keys(before);
  if (!before || !after) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export function fieldLabel(field) {
  return FIELD_LABELS[field] || humanizeKey(field);
}

export function formatBusinessValue(field, value, log = {}) {
  if (value === undefined || value === null || value === '') return 'Trống';
  const resolved = resolvedFieldValue(field, value, log.resolved_names || {});
  if (resolved) return resolved;
  if (field === 'permissions' && Array.isArray(value)) {
    return value.length ? value.map((permission) => PERMISSION_LABELS[permission] || 'Quyền khác').join(', ') : 'Không có quyền';
  }
  if (/_id$/.test(field)) return `${fieldLabel(field)} #${value}`;
  if (MONEY_FIELDS.test(field) && Number.isFinite(Number(value))) return formatCurrency(value);
  if (DATE_FIELDS.test(field) || /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value))) return formatDateOnly(value);
  if (field === 'months' || field === 'service_month_delta') return `${value} tháng`;
  if (field === 'is_active' || field === 'web_access_enabled') return value === true ? 'Đang bật' : 'Đang tắt';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (isObject(value)) return complexValueSummary(value);
  const statuses = {
    active: 'Hoạt động', warning: 'Sắp hết hạn', expired: 'Hết hạn', pending: 'Chờ xử lý',
    suspended: 'Tạm ngưng', completed: 'Hoàn thành', confirmed: 'Đã xác nhận', approved: 'Đã duyệt',
    rejected: 'Từ chối', cancelled: 'Đã hủy', locked: 'Đã khóa', inactive: 'Ngừng hoạt động',
  };
  return statuses[String(value).toLowerCase()] || String(value);
}

export function importantChange(log) {
  return formatAuditLog(log).secondary;
}

export function humanLogSummary(log) {
  return formatAuditLog(log).title;
}

export function isTechnicalLog(log = {}) {
  const action = normalizeAction(log.action);
  if (log.legacy_log_id || log.reason === 'Mirrored from legacy logs') return true;
  return !BUSINESS_ACTIONS.has(action);
}

function businessTitle({ log, action, category, actorName, objectName, changes }) {
  const amount = extractValue(log, ['actual_amount', 'total_amount', 'amount']);
  const kioskName = log.resolved_names?.kiosk?.name;
  if (action === 'create_salary_expense') {
    const period = extractValue(log, ['salary_period']);
    const employee = extractValue(log, ['employee_name']) || 'nhân viên';
    return `Ghi nhận lương${period ? ` tháng ${formatSalaryPeriod(period)}` : ''} cho ${employee}${amount !== null ? ` – ${formatCurrency(amount)}` : ''}`;
  }
  if (action === 'create_expense') return `Thêm chi phí${amount !== null ? ` ${formatCurrency(amount)}` : ''} – ${expenseCategoryLabel(extractValue(log, ['category']))}`;
  if (action === 'update_expense') return `Sửa chi phí${amount !== null ? ` ${formatCurrency(amount)}` : ''} – ${expenseCategoryLabel(extractValue(log, ['category']))}`;
  if (action === 'archive_expense') return `Hủy chi phí${amount !== null ? ` ${formatCurrency(amount)}` : ''} – ${expenseCategoryLabel(extractValue(log, ['category']))}`;
  if (action === 'registration_pending') return `Đăng ký ${objectName} – Chờ thanh toán`;
  if (action === 'renewal_pending') return `Gia hạn ${objectName} – Chờ thanh toán`;
  if (action === 'renewal_paid') return `Gia hạn ${objectName} thành công`;
  if (action === 'payment_review_required') return `${objectName} cần đối soát thanh toán`;
  if (isHistoricalPaymentCorrection(log)) return `${actorName} đã sửa dữ liệu thanh toán của ${objectName}`;
  if (action === 'admin_manual_renewal') return `${objectName} được gia hạn`;
  if (action === 'confirm_payos' || action === 'confirm_payos_batch') {
    const payment = amount !== null ? `Thanh toán ${formatCurrency(amount)}` : 'Thanh toán';
    return `${payment}${kioskName ? ` của Kiosk ${kioskName}` : ''} đã được PayOS xác nhận`;
  }
  if (action === 'admin_cancel' || action === 'review_legacy_cancel') return `${objectName} đã bị hủy`;
  if (action === 'create' && category === 'kiosk') return `${objectName} vừa đăng ký`;
  if (action === 'create' && category === 'customer') return `${actorName} đã tạo ${objectName}`;
  if (action === 'create_promotion') return `${actorName} đã tạo ${objectName}`;
  if (action === 'pause_promotion') return `${objectName} đã được tạm ngưng`;
  if (action === 'reactivate_promotion') return `${objectName} đã được kích hoạt lại`;
  if (action === 'delete_promotion') return `${objectName} đã bị xóa`;
  if (action === 'lock_user') return `${actorName} đã khóa ${objectName}`;
  if (action === 'unlock_user') return `${actorName} đã mở khóa ${objectName}`;
  if (action === 'reset_password' || action === 'admin_reset_user_password') return `${actorName} đã đặt lại mật khẩu của ${objectName}`;
  if (action === 'sync_permissions') return `${actorName} đã thay đổi quyền của ${objectName}`;
  if (/wallet|adjustment/.test(action)) return walletTitle(actorName, objectName, log);
  if (action === 'update' || action === 'update_profile' || action === 'admin_update_user_profile' || action === 'update_promotion') {
    if (changes.length === 1) return singleChangeTitle(actorName, objectName, changes[0]);
    return `${actorName} đã cập nhật thông tin của ${objectName}`;
  }
  if (action === 'delete') return `${actorName} đã xóa ${objectName}`;
  if (/approve|approved/.test(action)) return `${actorName} đã duyệt ${objectName}`;
  if (/expire/.test(action)) return `${objectName} đã được đánh dấu hết hạn`;
  if (/activate|set_active/.test(action)) return `${actorName} đã thay đổi trạng thái của ${objectName}`;
  return `${actorName} đã ghi nhận ${actionLabel(action).toLocaleLowerCase('vi')} cho ${objectName}`;
}

function expenseCategoryLabel(value) {
  return {
    salary: 'Lương nhân viên', bonus: 'Thưởng', advertising: 'Quảng cáo',
    infrastructure: 'Hosting / Domain / API', refund: 'Hoàn tiền', other: 'Chi khác',
  }[value] || 'Chi khác';
}

function formatSalaryPeriod(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[2]}/${match[1]}` : String(value || '');
}

function businessSecondary({ log, action, category, changes }) {
  if (isHistoricalPaymentCorrection(log)) {
    const summary = changes.slice(0, 4).map((change) => `${change.label}: ${change.before} → ${change.after}`).join(' · ');
    return [summary, friendlyReason(log.reason, '') ? `Lý do: ${friendlyReason(log.reason, '')}` : ''].filter(Boolean).join(' · ');
  }
  if (action === 'admin_manual_renewal' || category === 'renewal') {
    const start = extractValue(log, ['renewal_period_start', 'new_start_date', 'requested_start_date', 'start_date']);
    const end = extractValue(log, ['new_expiry_date', 'requested_end_date', 'end_date']);
    const months = extractValue(log, ['months', 'service_month_delta']);
    const amount = extractValue(log, ['actual_amount', 'total_amount', 'amount']);
    return [months ? `Gói ${months} tháng` : '', start && end ? `${formatDateOnly(start)} → ${formatDateOnly(end)}` : '', amount !== null ? formatCurrency(amount) : ''].filter(Boolean).join(' · ') || 'Thời hạn Kiosk đã được cập nhật';
  }
  if (action === 'confirm_payos' || action === 'confirm_payos_batch') {
    const start = extractValue(log, ['start_date']);
    const end = extractValue(log, ['end_date']);
    const count = extractValue(log, ['kiosk_count']);
    return [start && end ? `${formatDateOnly(start)} → ${formatDateOnly(end)}` : '', count ? `${count} Kiosk` : '', friendlyReason(log.reason, '')].filter(Boolean).join(' · ') || 'Thanh toán đã hoàn tất';
  }
  if (changes.length) return changes.slice(0, 3).map((change) => `${change.label}: ${change.before} → ${change.after}`).join(' · ');
  const amount = extractValue(log, ['actual_amount', 'total_amount', 'amount']);
  return [amount !== null ? formatCurrency(amount) : '', friendlyReason(log.reason, '')].filter(Boolean).join(' · ') || `${categoryLabel(category)} đã được cập nhật`;
}

function isHistoricalPaymentCorrection(log = {}) {
  return [log.after, log.before].some((value) => value?.correction_type === 'historical_payment');
}

function walletTitle(actorName, objectName, log) {
  const before = extractValueFrom(log.before, ['balance_before', 'balance']);
  const after = extractValueFrom(log.after, ['balance_after', 'balance']);
  if (before !== null && after !== null) return `${actorName} đã cập nhật số dư của ${objectName} từ ${formatCurrency(before)} → ${formatCurrency(after)}`;
  return `${actorName} đã điều chỉnh số dư của ${objectName}`;
}

function singleChangeTitle(actorName, objectName, change) {
  const verbs = {
    business_type_id: 'đổi ngành nghề', category_id: 'đổi danh mục', phone: 'đổi số điện thoại',
    facebook_id: 'đổi Facebook ID', facebook_link: 'đổi liên kết Facebook', facebook_url_original: 'đổi liên kết Facebook',
    status: 'đổi trạng thái', payment_status: 'đổi trạng thái thanh toán', end_date: 'đổi ngày hết hạn',
    display_name: 'đổi tên', facebook_name: 'đổi tên', name: 'đổi tên', total_amount: 'đổi số tiền',
  };
  return `${actorName} đã ${verbs[change.field] || `thay đổi ${change.label.toLocaleLowerCase('vi')}`} của ${objectName} từ ${change.before} → ${change.after}`;
}

function resolvedFieldValue(field, value, resolvedNames) {
  const maps = {
    business_type_id: resolvedNames.businessTypes,
    category_id: resolvedNames.categories,
    customer_id: resolvedNames.customers,
    kiosk_id: resolvedNames.kiosks,
    user_id: resolvedNames.users,
    payment_id: resolvedNames.payments,
    promotion_id: resolvedNames.promotions,
  };
  const item = maps[field]?.[String(value)];
  return typeof item === 'string' ? item : item?.name || null;
}

function extractValue(log, keys) {
  for (const key of keys) {
    const value = firstNestedValue([log.after, log.before, log.resolved_payment].filter(isObject), [key, `payment.${key}`, `kiosk.${key}`]);
    if (value !== null) return value;
  }
  return null;
}

function extractValueFrom(source, keys) {
  return firstNestedValue(isObject(source) ? [source] : [], keys);
}

function firstNestedValue(sources, paths) {
  for (const source of sources) {
    for (const path of paths) {
      const value = path.split('.').reduce((current, key) => current?.[key], source);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return null;
}

function formatDateOnly(value) {
  if (!value) return '—';
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function entityWithKind(kind, name) {
  const text = String(name || '').trim();
  const safeKind = kind === 'Đối tượng' ? '' : String(kind || '').trim();
  if (!safeKind || text.toLocaleLowerCase('vi').startsWith(safeKind.toLocaleLowerCase('vi'))) return text;
  return `${safeKind} ${text}`;
}

function fallbackEntity(kind, id, missing = false) {
  const safeKind = kind && kind !== 'Đối tượng' ? kind : 'Đối tượng';
  if (!id) return safeKind;
  return `${safeKind}${missing ? ' đã xóa' : ''} #${id}`;
}

function friendlyReason(reason, fallback = 'Không có ghi chú') {
  if (!reason || /mirrored from legacy logs|imported from legacy logs|không cung cấp lý do/i.test(reason)) return fallback;
  return String(reason);
}

function complexValueSummary(value) {
  if (Array.isArray(value)) return `${value.length} mục`;
  const name = value?.facebook_name || value?.display_name || value?.name;
  return name ? String(name) : `${Object.keys(value || {}).length} trường`;
}

function humanizeKey(value) {
  return String(value || '').replace(/_/g, ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('vi'));
}

function normalizeAction(action) {
  return String(action || '').trim().toLowerCase();
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export const activityLogPresentation = Object.freeze({
  actionLabel,
  moduleLabel,
  categoryForLog,
  formatAuditLog,
  humanLogSummary,
  entityDisplayName,
  importantChange,
  fieldLabel,
  formatBusinessValue,
});
