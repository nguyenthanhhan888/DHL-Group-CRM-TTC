import { escapeHtml } from '../utils/html.js';

const DEFAULT_LABELS = {
  active: 'Hoạt động',
  warning: 'Sắp hết hạn',
  expired: 'Hết hạn',
  pending: 'Chờ duyệt',
  suspended: 'Tạm ngưng',
  inactive: 'Không hoạt động',
  completed: 'Hoàn thành',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  cancelled: 'Đã hủy',
  unknown: 'Không rõ',
};

const TONES = {
  active: 'success',
  completed: 'success',
  approved: 'success',
  warning: 'warning',
  expired: 'danger',
  rejected: 'danger',
  cancelled: 'danger',
  pending: 'pending',
  suspended: 'neutral',
  inactive: 'neutral',
  unknown: 'neutral',
};

export function StatusBadge(status, { labels = {}, label } = {}) {
  const normalized = String(status || 'unknown').toLowerCase();
  const tone = TONES[normalized] || 'neutral';
  const text = label || labels[normalized] || DEFAULT_LABELS[normalized] || status || DEFAULT_LABELS.unknown;
  return `<span class="status-badge status-badge--${tone}" data-status="${escapeHtml(normalized)}"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}
