import { escapeHtml } from '../utils/html.js';

// Opt-in layout: existing report/table toolbars keep their own behavior.
export function FilterBar({ label = 'Bộ lọc', className = '', children = '', advanced = '' } = {}) {
  return `<section class="admin-filter-bar ${escapeHtml(className)}" aria-label="${escapeHtml(label)}">
    <div class="admin-filter-row">${children}</div>
    ${advanced}
  </section>`;
}
