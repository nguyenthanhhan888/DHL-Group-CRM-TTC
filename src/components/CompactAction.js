import { escapeHtml } from '../utils/html.js';
import { renderIcon } from '../utils/icons.js';

export function CompactAction({ label, icon = 'view', tone = 'info', href = '', attrs = '' }) {
  const className = `compact-action compact-action--${tone}`;
  const content = `<span class="compact-action-icon" aria-hidden="true">${renderIcon(icon)}</span><span>${escapeHtml(label)}</span>`;
  return href
    ? `<a class="${className}" href="${escapeHtml(href)}" ${attrs}>${content}</a>`
    : `<button class="${className}" type="button" ${attrs}>${content}</button>`;
}
