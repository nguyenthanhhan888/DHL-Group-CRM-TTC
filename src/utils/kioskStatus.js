import { getExpiryWarningDays, normalizeExpiryWarningDays } from '../config/organization.js';
import { startOfToday, toDateOnly } from './date.js';

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
  if (isExpiringSoon(source, { today })) return 'warning';
  return 'active';
}

export function isExpiringSoon(kiosk, {
  warningDays = getExpiryWarningDays(),
  today = startOfToday(),
} = {}) {
  const endDate = parseDateOnly(kiosk?.end_date);
  if (!endDate) return false;
  const { start, end } = expiryDateRange({ warningDays, today });
  return endDate >= start && endDate <= end;
}

export function expiryDateRange({
  warningDays = getExpiryWarningDays(),
  today = startOfToday(),
} = {}) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + normalizeExpiryWarningDays(warningDays));
  return {
    start,
    end,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  };
}

function parseDateOnly(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}
