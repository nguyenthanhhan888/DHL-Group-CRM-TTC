import { formatCurrency } from './currency.js';

export function knownName(value) {
  const name = String(value || '').trim();
  return /^(không tên|không xác định|unknown|—)$/i.test(name) ? '' : name;
}
const names = rows => [...new Set((rows || []).map(row => knownName(row.facebook_name)).filter(Boolean))].join(', ');
const ISSUE_COPY = {
  completed_without_confirmed_at: ['Thiếu thời điểm xác nhận', 'Kiểm tra thời điểm xác nhận của thanh toán đã hoàn thành.'],
  payment_without_customer: ['Thiếu liên kết khách hàng', 'Đối chiếu hồ sơ và chủ Kiosk để kiểm tra liên kết khách hàng của thanh toán.'],
  payment_without_kiosk: ['Thiếu liên kết Kiosk', 'Kiểm tra Kiosk trong hồ sơ hoặc lô đăng ký liên quan; thanh toán chưa có liên kết Kiosk trực tiếp hợp lệ.'],
  kiosk_without_customer: ['Kiosk thiếu liên kết khách hàng', 'Kiểm tra hồ sơ sở hữu và liên kết khách hàng của Kiosk.'],
  kiosk_without_facebook_id: ['Kiosk thiếu Facebook ID', 'Kiểm tra và bổ sung Facebook ID của Kiosk.'],
  duplicate_facebook_id: ['Facebook ID Kiosk bị trùng', 'Đối chiếu các Kiosk dùng cùng Facebook ID trước khi chỉnh sửa.'],
  kiosk_without_end_date: ['Kiosk thiếu ngày hết hạn', 'Kiểm tra thời hạn sử dụng đã được ghi nhận cho Kiosk.'],
  customer_total_kiosks_mismatch: ['Tổng số Kiosk chưa khớp', 'Đối chiếu số Kiosk lưu trên khách hàng với các Kiosk đang liên kết.'],
  customer_total_paid_mismatch: ['Tổng đã trả chưa khớp', 'Đối chiếu tổng đã trả lưu trên khách hàng với các thanh toán đã hoàn thành và xác nhận.'],
  invalid_completed_payment_amount: ['Số tiền thanh toán không hợp lệ', 'Kiểm tra số tiền và loại giao dịch trên thanh toán đã hoàn thành.'],
  duplicated_pending_request: ['Hồ sơ chờ duyệt trùng Facebook ID', 'Đối chiếu các hồ sơ có cùng Facebook ID trước khi xử lý.'],
};

export function reviewReference(row) {
  return { paymentId: row.paymentId || (row.entityType === 'payment' ? row.recordId : null), customerId: row.customerId,
    kioskId: row.kioskId, requestId: row.entityType === 'registration_request' ? row.recordId : null };
}
export function eventReviewReference(event) {
  const match = /^(payment|reconciliation):(\d+)$/.exec(String(event.event_key));
  return match ? { [match[1] === 'payment' ? 'paymentId' : 'orderId']: match[2] } : {};
}

export function integrityPresentation(row, context = {}) {
  const [issue, guidance] = ISSUE_COPY[row.issueCode] || ['Dữ liệu cần kiểm tra', 'Mở bản ghi liên quan để đối chiếu thông tin hiện có.'];
  const type = { payment: 'Thanh toán', customer: 'Khách hàng', kiosk: 'Kiosk', registration_request: 'Hồ sơ đăng ký' }[row.entityType] || 'Bản ghi';
  const customer = names(context.customers) || knownName(row.customerName) || 'Không xác định';
  const kiosk = names(context.kiosks) || knownName(row.kioskName) || 'Không xác định';
  const id = row.recordId;
  const destination = { payment: 'payment-detail', customer: 'customer-detail', kiosk: 'kiosk-detail' }[row.entityType];
  return { title: `${type}${id != null ? ` #${id}` : ''} cần kiểm tra`, issue, guidance, customer, kiosk,
    href: id != null && destination ? `#/${destination}?id=${encodeURIComponent(id)}` : row.entityType === 'registration_request' ? '#/registration-requests' : '',
    amount: row.entityType === 'payment' || row.entityType === 'registration_request' || row.issueCode === 'customer_total_paid_mismatch' ? formatCurrency(row.totalAmount) : '',
  };
}

const METHODS = { transfer: 'Chuyển khoản', bank_transfer: 'Chuyển khoản ngân hàng', cash: 'Tiền mặt', payos: 'PayOS', momo: 'MoMo', import_excel: 'Dữ liệu nhập từ Excel', other: 'Khác' };
const STATUSES = { completed: 'Hoàn thành', pending: 'Chờ thanh toán', paid: 'Đã thanh toán', cancelled: 'Đã hủy', rejected: 'Từ chối', expired: 'Hết hạn', failed: 'Không thành công' };
const REASONS = {
  PAYMENT_NOT_FOUND: 'Không tìm thấy thanh toán liên quan.', PAYMENT_NOT_PENDING: 'Thanh toán không còn ở trạng thái chờ xử lý.',
  AMOUNT_MISMATCH: 'Số tiền nhận được chưa khớp số tiền cần thanh toán.', ORDER_AMOUNT_MISMATCH: 'Số tiền giao dịch chưa khớp.',
  PAYMENT_LINK_MISMATCH: 'Liên kết thanh toán nhận được chưa khớp giao dịch.',
  MISSING_BANK_REFERENCE: 'Thiếu mã tham chiếu giao dịch ngân hàng.',
  ADDITIONAL_TRANSFER_ON_PAID_ORDER: 'Có thêm khoản chuyển tiền cho giao dịch đã thanh toán.',
  BUSINESS_PAYMENT_MISMATCH: 'Không tìm thấy thanh toán khớp với số tiền nhận được.',
  BUSINESS_PAYMENT_ALREADY_CLOSED: 'Thanh toán liên quan không còn ở trạng thái chờ xử lý.',
  INTENT_REQUIRES_REVIEW: 'Thanh toán liên quan đang có thông tin cần kiểm tra.',
  ORDER_EXPIRED: 'Giao dịch được ghi nhận sau khi yêu cầu thanh toán hết hạn.',
};
export function reconciliationPresentation(event, context = {}) {
  const payment = context.payment || {};
  const order = context.order || {};
  const ref = eventReviewReference(event);
  const id = payment.id || ref.paymentId;
  const customer = names(context.customers);
  const kiosk = names(context.kiosks);
  const type = payment.registration_batch_id || payment.registration_request_id ? 'Đăng ký Kiosk'
    : { renewal: 'Gia hạn Kiosk', registration: 'Đăng ký Kiosk', adjustment: 'Điều chỉnh thanh toán' }[payment.transaction_type] || '';
  const methodRaw = payment.payment_method || (ref.orderId ? 'payos' : String(event.secondary || '').split('·').at(-1)?.trim().toLowerCase());
  const method = METHODS[methodRaw] || 'Không xác định';
  const amount = event.amount ?? payment.total_amount ?? order.amount;
  const reasonRaw = order.reconciliation_reason || (ref.orderId ? event.secondary : '');
  const reason = REASONS[reasonRaw] || (reasonRaw && !(/intent|event_key/i.test(reasonRaw) || /^[A-Z_]+$/.test(reasonRaw)) ? reasonRaw : 'Cần đối chiếu thanh toán với hồ sơ hoặc giao dịch liên quan.');
  const title = `${id ? `Thanh toán #${id}` : 'Giao dịch PayOS'}${customer ? ` của ${customer}` : ''} cần kiểm tra`;
  return { title, secondary: [kiosk ? `Kiosk: ${kiosk}` : '', amount != null ? formatCurrency(amount) : '', method !== 'Không xác định' ? method : ''].filter(Boolean).join(' · '),
    actorName: event.actor_name || 'Hệ thống', source: event.source || 'CRM', activityLabel: 'Cần kiểm tra', result: event.result || 'Cần kiểm tra',
    reviewFields: [['Khách hàng', customer || 'Không xác định được khách hàng từ dữ liệu hiện có'], ['Kiosk', kiosk || 'Không xác định được Kiosk từ dữ liệu hiện có'],
      ['Loại giao dịch', type || 'Không xác định'], ['Số tiền', amount != null ? formatCurrency(amount) : 'Không xác định'],
      ['Mã thanh toán', id ? `#${id}` : 'Không xác định'], ['Phương thức', method],
      ['Trạng thái', STATUSES[payment.payment_status || order.status] || event.result || 'Không xác định'], ['Lý do', reason]],
  };
}
