import { getExpiryWarningDays } from '../config/organization.js';
import { startOfToday } from './date.js';

const DATE_DRIVEN_STATUSES = new Set(['active', 'warning', 'expired']);

export function deriveKioskStatus(kioskOrStatus, endDateValue = null) {
  const source = typeof kioskOrStatus === 'object' && kioskOrStatus !== null
    ? kioskOrStatus
    : { status: kioskOrStatus, end_date: endDateValue };
  const normalized = String(source.status || 'inactive').toLowerCase();
  if (!DATE_DRIVEN_STATUSES.has(normalized)) return normalized;

  const endDate = parseDateOnly(source.end_date);
  if (!endDate) return normalized;
  const today = startOfToday();
  if (endDate < today) return 'expired';

  const warningEndDate = new Date(today);
  warningEndDate.setDate(today.getDate() + getExpiryWarningDays());
  if (endDate < warningEndDate) return 'warning';
  return 'active';
}

function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}
