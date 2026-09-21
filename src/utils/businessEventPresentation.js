import { reconciliationPresentation } from './reviewPresentation.js';
import { formatCurrency } from './currency.js';

const OBJECT_LABELS = {
  registration: 'hồ sơ đăng ký', registrations: 'hồ sơ đăng ký', registration_requests: 'hồ sơ đăng ký',
  registration_batches: 'lô đăng ký', profile: 'hồ sơ',
  kiosk: 'Kiosk', kiosks: 'Kiosk', customer: 'khách hàng', customers: 'khách hàng',
  payment: 'thanh toán', payments: 'thanh toán', expense: 'chi phí', expenses: 'chi phí',
};
const EXPENSE_LABELS = {
  salary: 'Lương nhân viên', bonus: 'Thưởng', advertising: 'Quảng cáo',
  infrastructure: 'Hosting / Domain / API', refund: 'Hoàn tiền', other: 'Chi khác',
};

// This is a view model for Logs only. It never changes stored events or Dashboard data.
export function businessEventPresentation(event = {}, audit = null) {
  if (event.event_type === 'reconciliation') return reconciliationPresentation(event, audit || {});
  const actorName = readable(event.actor_name) || readable(audit?.actor_name) || 'Hệ thống';
  const actor = /^(system|database trigger)$/i.test(actorName) ? 'Hệ thống' : actorName;
  const action = String(audit?.action || '').toLowerCase();
  const scope = String(audit?.entity || audit?.module || event.subject_name || '').toLowerCase();
  const before = audit?.before || {};
  const after = audit?.after || {};
  const value = (key) => after[key] ?? before[key];
  const name = readable(value('facebook_name')) || readable(value('name')) || readable(event.subject_name);
  const kind = OBJECT_LABELS[scope] || (/registration|legacy/.test(scope) ? 'hồ sơ đăng ký' : /kiosk/.test(scope) || event.event_type === 'status' ? 'Kiosk' : 'bản ghi nghiệp vụ');
  // Only a known business record ID may become #123; reasons and audit event IDs are never IDs.
  const id = audit?.record_id || value('registration_request_id') || value('payment_id');
  const object = `${kind}${name ? ` ${name}` : id ? ` #${id}` : ''}`;
  const reason = readable(audit?.reason) || (String(event.event_key).startsWith('audit:') ? readable(event.secondary) : '');
  const reasonText = reason ? (/^Lý do\s*:/i.test(reason) ? reason : `Lý do: ${reason}`) : '';
  let title = readable(event.title);
  let secondary = readable(event.secondary);
  const kioskStatusChanged = /kiosk/.test(scope) && action === 'update' && (
    (before.status != null && after.status != null && before.status !== after.status)
    || (typeof before.is_active === 'boolean' && typeof after.is_active === 'boolean' && before.is_active !== after.is_active)
  );

  if (event.event_type === 'cancel') {
    const verb = /reject/.test(action) ? 'từ chối' : /delete/.test(action) ? 'xóa' : 'hủy';
    title = `${actor} đã ${verb} ${object}`;
    secondary = reasonText;
  } else if (event.event_type === 'expense') {
    const verb = /create_salary/.test(action) ? 'ghi nhận lương' : /create/.test(action) ? 'thêm chi phí'
      : /archive|cancel/.test(action) ? 'hủy chi phí' : /update/.test(action) ? 'cập nhật chi phí' : 'ghi nhận thay đổi chi phí';
    const amount = value('amount');
    const money = amount !== null && amount !== undefined && amount !== '' && Number.isFinite(Number(amount)) ? ` ${formatCurrency(amount)}` : '';
    const category = readable(value('category_name')) || EXPENSE_LABELS[value('category')] || '';
    title = `${actor} đã ${verb}${money}${category ? ` – ${category}` : ''}`;
    // Expense creation/update reasons are generated summaries, not explanations.
    const generatedReason = /^(Thêm chi phí|Sửa chi phí|Ghi nhận lương|Hủy khoản chi)/i.test(reason);
    secondary = generatedReason ? '' : reasonText;
    if (/create_salary/.test(action)) {
      const period = String(value('salary_period') || '').match(/^(\d{4})-(\d{2})/);
      secondary = [readable(value('employee_name')) ? `Nhân viên: ${value('employee_name')}` : '', period ? `Kỳ lương: ${period[2]}/${period[1]}` : '', secondary].filter(Boolean).join(' · ');
    }
  } else if (event.event_type === 'status' || kioskStatusChanged) {
    const suspended = after.status === 'suspended' || after.is_active === false || /suspend|deactivat/.test(action);
    const active = after.status === 'active' || after.is_active === true || /reactivat/.test(action);
    title = `${actor} đã ${suspended ? 'tạm ngưng' : active ? 'kích hoạt lại' : 'cập nhật trạng thái'} ${object}`;
    secondary = reasonText;
  } else if (event.event_type === 'website') {
    const target = /homepage/i.test(String(audit?.module || scope)) ? 'Trang chủ' : 'Website';
    title = `${actor} đã cập nhật nội dung ${target}`;
    secondary = reasonText;
  } else if (event.event_type === 'payment' && String(event.event_key).startsWith('audit:')) {
    if (id) title = `${actor} đã cập nhật thanh toán lịch sử #${id}`;
    if (!title || !/đã cập nhật thanh toán lịch sử/.test(title)) title = `${actor} đã cập nhật thanh toán lịch sử`;
    secondary = reasonText;
  } else if (String(event.event_key).startsWith('audit:')) {
    if (audit || !title) title = `${actor} đã ${/create|insert/.test(action) ? 'thêm' : 'cập nhật'} ${object}`;
    secondary = reasonText;
  }

  return {
    title: title || `${actor} đã ghi nhận ${readable(event.activity_label)?.toLocaleLowerCase('vi') || 'hoạt động nghiệp vụ'}${name ? ` cho ${name}` : ''}`,
    secondary: secondary === title ? '' : secondary,
    actorName: actor,
    source: event.source || 'CRM',
    activityLabel: kioskStatusChanged ? 'Trạng thái Kiosk' : event.activity_label || 'Hoạt động',
    result: event.result || 'Hoàn tất',
  };
}

function readable(value) {
  const text = String(value ?? '').trim();
  if (OBJECT_LABELS[text.toLowerCase()] || /^(homepage|homepage content|website|featured business)$/i.test(text)) return '';
  if (!text || /^#?\d+$/.test(text) || /^[\da-f]{8}-[\da-f-]{27,}$/i.test(text)) return '';
  if (/legacy logs|không cung cấp lý do|^(?:kiosks?|customers?|registration_requests|registration_batches|expenses?|payments?)(?:\s+(?:UPDATE|INSERT|DELETE))?$/i.test(text)) return '';
  if (/ · (?:\d+|Cập nhật nghiệp vụ|Cập nhật chi phí)$/.test(text)) return '';
  return text;
}
