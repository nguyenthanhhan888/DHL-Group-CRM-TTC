const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const permissions = read('shared/permissions.js');
const navigation = read('src/constants/navigation.js');
const app = read('src/app.js');
const page = read('src/pages/ExpensesPage.js');
const service = read('src/services/ExpenseService.js');
const reports = read('src/services/ReportService.js');
const reportPage = read('src/pages/ReportsPage.js');
const audit = read('src/utils/auditLogPresentation.js');
const migration = read('supabase/migrations/20260912143000_create_admin_expenses.sql');

test('expense route and menu use the unified permission model', () => {
  assert.match(permissions, /EXPENSES: 'expenses'/);
  assert.match(permissions, /expenses: PERMISSIONS\.EXPENSES/);
  assert.match(navigation, /route: 'expenses', label: 'Chi phí'/);
  assert.match(app, /expenses: ExpensesPage/);
  assert.match(migration, /has_user_permission\('expenses'\)/);
  assert.match(migration, /enable row level security/);
});

test('expense UI provides CRUD, requested filters, salary fields and duplicate warning', () => {
  for (const category of ['Lương nhân viên', 'Thưởng', 'Quảng cáo', 'Hosting / Domain / API', 'Hoàn tiền', 'Chi khác']) assert.match(service, new RegExp(category.replaceAll('/', '\\/')));
  for (const id of ['expense-start-date', 'expense-end-date', 'expense-category-filter', 'expense-employee-filter']) assert.match(page, new RegExp(id));
  assert.match(page, /name="employeeUserId"/);
  assert.match(page, /name="salaryPeriod" type="month"/);
  assert.match(page, /Đã có khoản lương[\s\S]*khoản bổ sung/);
  assert.match(page, /ExpenseService\.save/);
  assert.match(page, /ExpenseService\.archive/);
  assert.match(page, /amount <= 0[\s\S]*Số tiền phải lớn hơn 0/);
});

test('expense mutations are transactional business events without generic update spam', () => {
  for (const action of ['create_expense', 'create_salary_expense', 'update_expense', 'archive_expense']) assert.match(migration, new RegExp(action));
  assert.match(migration, /insert into public\.audit_logs/);
  assert.doesNotMatch(migration, /create trigger[^;]*audit/i);
  assert.match(audit, /Ghi nhận lương[\s\S]*formatSalaryPeriod/);
  assert.match(audit, /Thêm chi phí[\s\S]*expenseCategoryLabel/);
});

test('Reports applies the same date filters and computes estimated profit from unchanged revenue', () => {
  assert.match(reports, /rpc\('get_reports_data'[\s\S]*p_start_date: normalizeDate\(filters\.startDate\)[\s\S]*p_end_date: normalizeDate\(filters\.endDate\)/);
  assert.match(reports, /rpc\('get_expense_report_summary'[\s\S]*p_start_date: normalizeDate\(filters\.startDate\)[\s\S]*p_end_date: normalizeDate\(filters\.endDate\)/);
  assert.match(reports, /summary\.estimatedProfit = Number\(summary\.totalRevenue \|\| 0\) - summary\.totalExpense/);
  for (const label of ['Doanh thu năm', 'Doanh thu tháng', 'Chi tiêu năm', 'Lợi nhuận ước tính năm']) assert.match(reportPage, new RegExp(label));
  assert.doesNotMatch(migration, /update public\.payments|insert into public\.payments|delete from public\.payments/i);
});
