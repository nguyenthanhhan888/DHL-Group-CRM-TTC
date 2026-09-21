export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function formatToday() {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: BUSINESS_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function daysUntil(value) {
  const target = new Date(value);
  const today = startOfToday();
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

export function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfVietnamToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(value.year), Number(value.month) - 1, Number(value.day));
}

export function vietnamDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

export function vietnamDateRangeYearToDate(now = new Date()) {
  const { year, month, day } = vietnamDateParts(now);
  return {
    from: `${year}-01-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

export function parseDateOnly(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return startOfToday();
  return new Date(year, month - 1, day);
}

export function toDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
