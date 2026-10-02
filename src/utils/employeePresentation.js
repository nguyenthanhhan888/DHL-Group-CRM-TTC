import { escapeHtml } from './html.js';

export function employeeStatus(employee) {
  return employee.archived_at ? 'Đã lưu trữ' : employee.employment_status === 'left' ? 'Đã nghỉ' : 'Đang làm';
}
export function expenseEmployeeOptions(employees, selected = null, { filter = false, current = null } = {}) {
  const rows = [...employees];
  if (selected != null && selected !== '' && !rows.some(row => String(row.id) === String(selected)) && current) {
    rows.push({ id: selected, full_name: current.employee_current_name || current.employee_name, employment_status: current.employment_status, archived_at: current.employee_archived_at });
  }
  return `${filter ? '<option value="">Tất cả nhân viên</option>' : '<option value="">Không gắn nhân viên</option>'}${rows
    .filter(row => filter || (!row.archived_at && row.employment_status === 'active') || String(row.id) === String(selected))
    .map(row => `<option value="${escapeHtml(row.id)}" ${String(row.id) === String(selected ?? '') ? 'selected' : ''}>${escapeHtml(row.full_name || 'Chưa rõ tên')}${row.archived_at || row.employment_status === 'left' ? ` (${employeeStatus(row)})` : ''}</option>`).join('')}`;
}
export function expenseAttribution(item) {
  const name = item.employee_name_snapshot || item.employee_name || (item.employee_id || item.employee_user_id ? 'Chưa liên kết nhân viên' : 'Không gắn nhân viên');
  const notes = [];
  if (item.attribution_state === 'legacy') notes.push('Chưa liên kết nhân viên · thông tin lịch sử');
  if (item.employee_id && (item.employee_archived_at || item.employment_status === 'left')) notes.push(employeeStatus({ archived_at: item.employee_archived_at, employment_status: item.employment_status }));
  if (item.employee_id && item.employee_current_name && item.employee_current_name !== name) notes.push(`Tên hiện tại: ${item.employee_current_name}`);
  return { name, note: notes.join(' · ') };
}
