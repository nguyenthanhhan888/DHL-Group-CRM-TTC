import { requireSupabaseClient, runQuery } from './BaseService.js';

export const WorkItemService = {
  list(filters = {}) {
    return runQuery(requireSupabaseClient().rpc('get_crm_work_items', {
      p_search: textOrNull(filters.search),
      p_status: textOrNull(filters.status),
      p_work_type: textOrNull(filters.workType),
      p_assignee_employee_id: positiveIntegerOrNull(filters.assigneeEmployeeId),
      p_from_date: textOrNull(filters.fromDate),
      p_to_date: textOrNull(filters.toDate),
      p_include_closed: filters.status === 'all',
    }));
  },

  save(item, id = null) {
    return runQuery(requireSupabaseClient().rpc('save_crm_work_item', {
      p_id: positiveIntegerOrNull(id),
      p_title: String(item.title || '').trim(),
      p_work_type: String(item.workType || '').trim(),
      p_customer_id: positiveIntegerOrNull(item.customerId),
      p_kiosk_id: positiveIntegerOrNull(item.kioskId),
      p_assignee_employee_id: positiveIntegerOrNull(item.assigneeEmployeeId),
      p_start_date: textOrNull(item.startDate),
      p_due_date: textOrNull(item.dueDate),
      p_status: String(item.status || 'pending').trim(),
      p_note: textOrNull(item.note),
    }));
  },

  setStatus(id, status) {
    return runQuery(requireSupabaseClient().rpc('set_crm_work_item_status', {
      p_id: positiveIntegerOrNull(id),
      p_status: String(status || '').trim(),
    }));
  },
};

function textOrNull(value) {
  return String(value ?? '').trim() || null;
}

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
