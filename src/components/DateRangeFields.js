import { escapeHtml } from '../utils/html.js';

export function DateRangeFields({
  fromId,
  toId,
  fromLabel = 'Từ ngày',
  toLabel = 'Đến ngày',
  fieldClass = 'filter-field filter-field-date',
  inputClass = 'form-control compact-date',
} = {}) {
  return `
    <label class="${escapeHtml(fieldClass)}">
      <span>${escapeHtml(fromLabel)}</span>
      <input id="${escapeHtml(fromId)}" class="${escapeHtml(inputClass)}" type="date" aria-label="${escapeHtml(fromLabel)}" />
    </label>
    <label class="${escapeHtml(fieldClass)}">
      <span>${escapeHtml(toLabel)}</span>
      <input id="${escapeHtml(toId)}" class="${escapeHtml(inputClass)}" type="date" aria-label="${escapeHtml(toLabel)}" />
    </label>`;
}
