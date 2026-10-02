import { requireSupabaseClient, runQuery } from './BaseService.js';

export const EmployeeService = {
  list({ search = '', status = '', includeArchived = false } = {}) {
    return runQuery(requireSupabaseClient().rpc('get_employees_data', {
      p_search: search.trim() || null, p_status: status || null, p_include_archived: includeArchived,
    }));
  },
  save(values, id = null) {
    return runQuery(requireSupabaseClient().rpc('save_employee', {
      p_id: id, p_full_name: String(values.fullName || '').trim(),
      p_phone: optional(values.phone), p_job_title: optional(values.jobTitle),
      p_start_date: values.startDate || null, p_employment_status: values.employmentStatus || 'active', p_notes: optional(values.notes),
    }));
  },
  lifecycle(id, action) {
    return runQuery(requireSupabaseClient().rpc('set_employee_lifecycle', { p_id: id, p_action: action }));
  },
};
function optional(value) { return String(value || '').trim() || null; }
