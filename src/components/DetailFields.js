import { escapeHtml } from '../utils/html.js';

// Shared label/value pattern from the accepted Business Log detail.
export function DetailFields(rows, className = '') {
  return `<dl class="detail-fields ${escapeHtml(className)}">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? '—')}</dd></div>`).join('')}</dl>`;
}
