import { requireSupabaseClient, runQuery } from './BaseService.js';

export const EXPENSE_CATEGORIES = Object.freeze([
  { value: 'salary', label: 'Lương nhân viên' },
  { value: 'bonus', label: 'Thưởng' },
  { value: 'advertising', label: 'Quảng cáo' },
  { value: 'infrastructure', label: 'Hosting / Domain / API' },
  { value: 'refund', label: 'Hoàn tiền' },
  { value: 'other', label: 'Chi khác' },
]);

export const ExpenseService = {
  list(filters = {}) {
    return runQuery(requireSupabaseClient().rpc('get_expenses_data', {
      p_start_date: dateOrNull(filters.startDate),
      p_end_date: dateOrNull(filters.endDate),
      p_category: textOrNull(filters.category),
      p_employee_user_id: textOrNull(filters.employeeUserId),
      p_include_archived: false,
    }));
  },

  save(values, id = null) {
    return runQuery(requireSupabaseClient().rpc('save_expense', {
      p_id: id || null,
      p_category: values.category,
      p_amount: Number(values.amount),
      p_expense_date: values.expenseDate,
      p_employee_user_id: textOrNull(values.employeeUserId),
      p_salary_period: salaryPeriodDate(values.category, values.salaryPeriod),
      p_payment_method: values.paymentMethod,
      p_note: textOrNull(values.note),
    }));
  },

  checkSalaryDuplicate(employeeUserId, salaryPeriod, excludeId = null) {
    return runQuery(requireSupabaseClient().rpc('check_duplicate_salary_expense', {
      p_employee_user_id: textOrNull(employeeUserId),
      p_salary_period: salaryPeriodDate('salary', salaryPeriod),
      p_exclude_id: excludeId || null,
    }));
  },

  archive(id, reason = '') {
    return runQuery(requireSupabaseClient().rpc('archive_expense', {
      p_id: id,
      p_reason: textOrNull(reason),
    }));
  },

  saveCategory(name, id = null) {
    return runQuery(requireSupabaseClient().rpc('save_expense_category', {
      p_id: id || null,
      p_name: String(name || '').trim(),
    }));
  },

  archiveCategory(id) {
    return runQuery(requireSupabaseClient().rpc('archive_expense_category', { p_id: id }));
  },
};

function salaryPeriodDate(category, value) {
  if (category !== 'salary' || !/^\d{4}-\d{2}$/.test(String(value || ''))) return null;
  return `${value}-01`;
}

function dateOrNull(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
}

function textOrNull(value) {
  const text = String(value || '').trim();
  return text || null;
}
