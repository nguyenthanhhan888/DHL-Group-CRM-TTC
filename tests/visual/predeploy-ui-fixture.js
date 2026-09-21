// Real application renderers and handlers with deterministic local, read-only data.
import { AppLayout, bindSidebarPresentation, syncNavigationGroups } from '/src/layouts/AppLayout.js';
import { NAV_SECTIONS } from '/src/constants/navigation.js';
import { Modal } from '/src/components/Modal.js';
import { PromotionsPage } from '/src/pages/PromotionsPage.js';
import { ReportsPage } from '/src/pages/ReportsPage.js';
import { LogsPage } from '/src/pages/LogsPage.js';
import { PromotionService } from '/src/services/PromotionService.js';
import { CategoryService } from '/src/services/CategoryService.js';
import { BusinessTypeService } from '/src/services/BusinessTypeService.js';
import { ReportService } from '/src/services/ReportService.js';
import { BusinessEventService } from '/src/services/BusinessEventService.js';
import { ReviewContextService, resolveReviewContexts } from '/src/services/ReviewContextService.js';
const params = new URLSearchParams(location.search);
const page = params.get('page') || 'shell';
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
window.qaCalls = { reports: [], saved: [], logout: 0 };
const timestamp = '2026-09-20T03:30:00Z';
const promotion = { id: 1, code: 'TANG3THANG', name: 'Tặng 3 Tháng', discount_type: 'bonus_months', discount_value: 3, is_active: true, scope_type: 'all', starts_at: null, ends_at: null, promotion_usages: [{ customer_id: 1, subtotal_before_discount: 2400000, discount_amount: 0, final_amount: 2400000, total_bonus_months: 3 }] };
PromotionService.list = async () => ({ data: [promotion] });
PromotionService.save = async payload => { window.qaCalls.saved.push(payload); };
CategoryService.list = CategoryService.listActive = BusinessTypeService.list = BusinessTypeService.listActive = async () => ({ data: [] });
const store = {
  payments: [{ id: 348, customer_id: 1, kiosk_id: 2, total_amount: 150000, payment_method: 'transfer', payment_status: 'completed', transaction_type: 'standard' }, { id: 343, customer_id: 1, registration_request_id: 9, total_amount: 200000, payment_status: 'cancelled' }],
  payos_orders: [{ id: 50, payment_id: 348, status: 'paid', reconciliation_reason: 'AMOUNT_MISMATCH' }],
  registration_requests: [{ id: 9, payment_id: 343, kiosk_id: 2, customer_id: 1 }], registration_batches: [], registration_batch_items: [],
  kiosks: [{ id: 2, customer_id: 1, facebook_name: 'Ngọc Anh' }], customers: [{ id: 1, facebook_name: 'Lan Lan' }],
};
ReviewContextService.resolve = refs => resolveReviewContexts(refs, async (table, _, ids, key = 'id') => store[table].filter(row => ids.includes(String(row[key]))));
const issues = [
  { issueCode: 'payment_without_kiosk', entityType: 'payment', recordId: 343, paymentId: 343, customerId: 1, customerName: 'Lan Lan', kioskName: 'Không tên', totalAmount: 200000, status: 'cancelled', eventAt: timestamp },
  { issueCode: 'payment_without_customer', entityType: 'payment', recordId: 999, paymentId: 999, customerName: 'Không tên', kioskName: 'Không tên', totalAmount: 100000, status: 'completed', eventAt: timestamp },
  { issueCode: 'kiosk_without_end_date', entityType: 'kiosk', recordId: 2, kioskId: 2, customerId: 1, customerName: 'Lan Lan', kioskName: 'Ngọc Anh', status: 'active', eventAt: timestamp },
];
ReportService.getReportData = async (tab, filters, options) => {
  window.qaCalls.reports.push({ tab, filters: { ...filters }, options: { ...options } });
  return { data: { summary: { issueCount: issues.length, totalRevenue: 2400000, pendingReviewRequests: 2, awaitingPaymentRequests: 1, activeKiosks: 12, expiringSoon: 3, expiredKiosks: 1 }, rows: tab === 'reconciliation' ? issues : [], topCustomers: [{customerId:1,customerName:'Lan Lan',phone:'0900000000',paymentCount:3,totalAmount:2400000}], priorityKiosks: [{id:2,facebookName:'Ngọc Anh',customerName:'Lan Lan',derivedStatus:'warning',endDate:'2026-09-30'}], groups: {}, pagination: { page: 1, pageSize: 50, totalRows: tab === 'reconciliation' ? 3 : 0, totalPages: 1 } } };
};
const events = [
  { event_key: 'payment:348', title: 'Thanh toán #348 cần đối soát intent', amount: 150000, secondary: '150.000 VNĐ · transfer', result: 'Hoàn tất' },
  { event_key: 'reconciliation:50', title: 'Giao dịch PayOS cần Admin đối soát', amount: 150000, secondary: 'AMOUNT_MISMATCH', result: 'Cần xử lý' },
  { event_key: 'payment:999', title: 'Thanh toán #999 cần đối soát intent', amount: 100000, secondary: '100.000 VNĐ · cash', result: 'Hoàn tất' },
].map(row => ({ ...row, event_type: 'reconciliation', activity_label: 'Đối soát', occurred_at: timestamp, source: row.event_key.startsWith('reconciliation:') ? 'PayOS' : 'CRM', actor_name: row.event_key.startsWith('reconciliation:') ? 'PayOS' : 'Người kiểm tra' }));
BusinessEventService.list = async () => ({ data: events, count: events.length, page: 1 });
const render = page.startsWith('reports') ? ReportsPage : ['logs', 'log-detail', 'system'].includes(page) ? LogsPage : PromotionsPage;
document.getElementById('app').innerHTML = AppLayout({ navSections: NAV_SECTIONS, user: { display_name: 'Người kiểm tra CRM', username: 'qa-local', is_system_admin: true } });
document.querySelector('[data-route-outlet]').innerHTML = render();
document.querySelector('[data-supabase-badge]').textContent = 'Dữ liệu kiểm thử cục bộ';
Modal.mount(); bindSidebarPresentation();
const setSidebar = open => {
  document.querySelector('[data-sidebar]').classList.toggle('open', open);
  document.querySelector('[data-sidebar-overlay]').classList.toggle('open', open);
  document.querySelector('[data-menu-toggle]').setAttribute('aria-expanded', String(open));
};
document.querySelector('[data-menu-toggle]').addEventListener('click', () => setSidebar(!document.querySelector('[data-sidebar]').classList.contains('open')));
document.querySelector('[data-sidebar-overlay]').addEventListener('click', () => setSidebar(false));
document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', () => { window.qaCalls.logout++; Modal.open({ title: 'Xác nhận đăng xuất', body: '<p>Kiểm thử cục bộ — không kết thúc phiên thật.</p>' }); }));
window.qaNavigate = route => {
  location.hash = '#/' + route;
  document.querySelectorAll('[data-nav-route]').forEach(link => {
    const active = link.dataset.navRoute === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  syncNavigationGroups();
};
window.qaNavigate(render === ReportsPage ? 'reports' : render === LogsPage ? 'logs' : 'promotions');
render.afterRender();
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
await pause();
if (['shell', 'account', 'ttc', 'system'].includes(page) && innerWidth <= 900) setSidebar(true);
if (page === 'account') document.querySelector('[data-sidebar-account] summary').click();
if (page === 'ttc') {
  document.querySelectorAll('[data-nav-group]')[0].querySelector('summary').click();
  document.querySelectorAll('[data-nav-group]')[0].scrollIntoView({ block: 'nearest' });
}
if (page === 'system') document.querySelectorAll('[data-nav-group]')[1].scrollIntoView({ block: 'nearest' });
if (page === 'promotion-create') {
  document.getElementById('add-promotion').click(); await pause();
  document.querySelector('[name="starts_at"]').closest('section').scrollIntoView({ block: 'center' });
}
if (page === 'promotion-detail') document.querySelector('[data-promotion-action="details"]').click();
if (page === 'reports-integrity') { document.querySelector('[data-report-tab="reconciliation"]').click(); await pause(); }
if (page === 'log-detail') document.querySelector('[data-log-view="payment:348"]').click();
window.qaReady = true;
