// Local QA only. Real page renderers, layouts, styles and event bindings;
// deterministic service responses. No Supabase client, credentials or mutations.
import { AppLayout } from '/src/layouts/AppLayout.js';
import { PublicLayout, bindPublicLayout } from '/src/components/PublicLayout.js';
import { Modal } from '/src/components/Modal.js';
import { NAV_SECTIONS } from '/src/constants/navigation.js';
import { PUBLIC_BRAND } from '/src/config/organization.js';
import { ExpensesPage } from '/src/pages/ExpensesPage.js';
import { LogsPage } from '/src/pages/LogsPage.js';
import { PromotionsPage } from '/src/pages/PromotionsPage.js';
import { HomePage } from '/src/pages/HomePage.js';
import { ExpenseService, EXPENSE_CATEGORIES } from '/src/services/ExpenseService.js';
import { BusinessEventService } from '/src/services/BusinessEventService.js';
import { AuditLogService } from '/src/services/AuditLogService.js';
import { PromotionService } from '/src/services/PromotionService.js';
import { HomepageContentService } from '/src/services/HomepageContentService.js';

const params = new URLSearchParams(location.search);
const page = params.get('page') || 'expenses';
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
const actor_name = 'Nguyễn Thanh Hân';
const occurred_at = '2026-09-16T10:59:00Z';
const auditRows = {
  1: { id: 1, entity: 'registration_requests', action: 'cancel', record_id: '123123', reason: 'Khách yêu cầu hủy', before: {}, after: {} },
  2: { id: 2, entity: 'expenses', action: 'create_expense', after: { amount: 450000, category: 'advertising' } },
  3: { id: 3, module: 'Homepage', entity: 'homepage_content', action: 'update', after: {} },
  4: { id: 4, entity: 'kiosks', action: 'update', before: { status: 'active' }, after: { facebook_name: 'Ngọc Anh', status: 'suspended' }, reason: 'Tạm dừng kinh doanh' },
};
const events = [
  { event_key: 'audit:5', event_type: 'payment', activity_label: 'Điều chỉnh thanh toán', title: `${actor_name} đã cập nhật thanh toán lịch sử #184`, secondary: 'Sai dữ liệu' },
  { event_key: 'audit:1', event_type: 'cancel', activity_label: 'Hủy', title: `${actor_name} · 123123`, secondary: '123123', subject_name: 'registration_requests' },
  { event_key: 'audit:2', event_type: 'expense', activity_label: 'Chi phí', title: `${actor_name} · Thêm chi phí`, subject_name: 'expenses' },
  { event_key: 'audit:3', event_type: 'website', activity_label: 'Nội dung Website', title: `${actor_name} đã cập nhật nội dung Website`, subject_name: 'homepage_content' },
  { event_key: 'audit:4', event_type: 'update', activity_label: 'Cập nhật', title: `${actor_name} đã cập nhật Kiosk Ngọc Anh`, subject_name: 'Ngọc Anh' },
  { event_key: 'payment:184', event_type: 'registration', activity_label: 'Đăng ký Kiosk', title: 'Đăng ký Kiosk Huyền Trần thành công', secondary: '450.000 VNĐ · PayOS', source: 'PayOS', actor_name: 'PayOS' },
  { event_key: 'audit:999', event_type: 'cancel', activity_label: 'Hủy', title: `${actor_name} · 123123`, secondary: '123123', subject_name: 'registration_requests' },
].map(event => ({ actor_name, occurred_at, source: 'CRM', result: 'Hoàn tất', ...event }));
window.qaCalls = { expenses: [], logs: [], technical: [] };
BusinessEventService.list = async (filters) => {
  window.qaCalls.logs.push(filters);
  const rows = events.filter(event => (!filters.activity || event.event_type === filters.activity)
    && (!filters.source || event.source === filters.source)
    && (!filters.actor || event.actor_name.includes(filters.actor))
    && (!filters.searchTerm || event.title.includes(filters.searchTerm)));
  return { data: rows, count: rows.length, page: 1 };
};
AuditLogService.getById = async (id) => { if (Number(id) === 999) throw new Error('Unavailable historic detail'); return { data: auditRows[id] }; };
AuditLogService.list = async (filters) => {
  window.qaCalls.technical.push(filters);
  return { data: [{ id: 99, module: 'Kiosk', entity: 'kiosks', action: 'update', actor_name, actor_type: 'staff', created_at: occurred_at, record_id: '18', before: { facebook_name: 'Ngọc Anh' }, after: { facebook_name: 'Ngọc Anh mới' } }], count: 1, page: 1 };
};
const categories = EXPENSE_CATEGORIES.map((item, i) => ({ id: i + 1, code: item.value, name: item.label, isActive: true, isSalary: item.value === 'salary' }));
const expenses = [
  { id: 1, expense_date: '2026-09-16', category: 'advertising', category_name: 'Quảng cáo', payment_method: 'bank_transfer', amount: 450000, note: 'Quảng cáo cộng đồng tháng 9' },
  { id: 2, expense_date: '2026-09-15', category: 'salary', category_name: 'Lương nhân viên', employee_user_id: 'employee-1', employee_name: 'Nguyễn Minh Anh', salary_period: '2026-09-01', payment_method: 'bank_transfer', amount: 5500000, note: 'Lương tháng 9' },
  { id: 3, expense_date: '2026-09-14', category: 'infrastructure', category_name: 'Hosting / Domain / API', payment_method: 'cash', amount: 1200000, note: 'Duy trì hệ thống' },
];
ExpenseService.list = async (filters) => {
  window.qaCalls.expenses.push({ ...filters });
  const rows = expenses.filter(row => (!filters.category || row.category === filters.category)
    && (!filters.employeeUserId || row.employee_user_id === filters.employeeUserId)
    && (!filters.startDate || row.expense_date >= filters.startDate) && (!filters.endDate || row.expense_date <= filters.endDate));
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  return { data: { rows, categories, employees: [{ user_id: 'employee-1', display_name: 'Nguyễn Minh Anh' }], totalAmount, totalRevenue: 24000000, netProfit: 24000000 - totalAmount } };
};
const promotionRows = [
  { id: 1, code: 'TRIAN2026', name: 'Tri ân khách hàng', description: 'Ưu đãi đăng ký mới', discount_type: 'percentage', discount_value: 20, is_active: true },
  { id: 2, code: 'TANGTHANG', name: 'Tặng thêm tháng sử dụng', description: 'Khách hàng thân thiết', discount_type: 'bonus_months', discount_value: 2, is_active: true, starts_at: '2099-01-01T00:00:00Z' },
  { id: 3, code: 'MUATHEM', name: 'Ưu đãi nhiều Kiosk', discount_type: 'fixed_amount', discount_value: 100000, is_active: true, ends_at: '2020-01-01T00:00:00Z' },
  { id: 4, code: 'TAMNGUNG', name: 'Ưu đãi theo mùa', discount_type: 'percentage', discount_value: 10, is_active: false },
].map(row => ({ scope_type: 'all', promotion_usages: [], ...row }));
PromotionService.list = async () => ({ data: promotionRows });
const contacts = PUBLIC_BRAND.contacts;
HomepageContentService.getPublic = async () => ({ content: {
  heroTitle: PUBLIC_BRAND.name, heroSubtitle: 'Kết nối cộng đồng, đồng hành cùng kinh doanh địa phương.', heroImageUrl: '/images/cover.PNG',
  heroGroupCtaLabel: 'Tham gia cộng đồng', heroGroupCtaUrl: contacts.groups.primary, heroKioskCtaLabel: 'Đăng ký Kiosk', heroKioskCtaRoute: '#/register',
  communityLinks: [{ key: 'primary', name: 'Group chính', url: contacts.groups.primary }, { key: 'secondary', name: 'Group phụ', url: contacts.groups.secondary }, { key: 'recruitment', name: 'Group tuyển dụng', url: contacts.groups.recruitment }, { name: 'Group chính bản sao', url: contacts.groups.primary }],
  fanpageUrl: contacts.fanpage, fanpageLabel: 'Fanpage Admin', zaloContacts: contacts.zalo.map(contact => ({ ...contact, label: `Zalo · ${contact.label}` })),
  hotlineNumber: contacts.hotline.number, hotlineLabel: `Hotline · ${contacts.hotline.label}`, postingRules: 'Đăng bài đúng danh mục.\nGiữ nội dung rõ ràng, văn minh.',
}, featuredBusinesses: [] });

const root = document.getElementById('app');
if (page === 'footer') {
  root.innerHTML = PublicLayout({ content: HomePage() });
  bindPublicLayout(root);
  await HomePage.afterRender();
} else {
  const renderer = { expenses: ExpensesPage, logs: LogsPage, detail: LogsPage, promotions: PromotionsPage }[page];
  root.innerHTML = AppLayout({ navSections: NAV_SECTIONS, user: { display_name: actor_name, username: 'qa-admin', is_system_admin: true } });
  document.querySelector('[data-route-outlet]').innerHTML = renderer();
  document.querySelector('[data-supabase-badge]').textContent = 'Dữ liệu kiểm thử cục bộ';
  renderer.afterRender();
}
Modal.mount();
await new Promise(resolve => setTimeout(resolve, 100));
if (page === 'detail') document.querySelector('[data-log-view="audit:5"]').click();
window.qaReady = true;
