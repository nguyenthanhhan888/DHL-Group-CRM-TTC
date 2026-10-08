import { isValidDateOnly } from './formValidation.js';

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
  const pure = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (pure) return isValidDateOnly(String(value)) ? `${pure[3]}/${pure[2]}/${pure[1]}` : '—';
  if (Number.isNaN(new Date(value).getTime())) return '—';
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
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function daysUntil(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return NaN;
  const text = String(value || '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const today = vietnamDateRangeYearToDate().to;
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
}

export function startOfToday() {
  return startOfVietnamToday();
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

// Only create fields explicitly opting into a today default should use this helper.
export function createDateValue(record, storedValue, now = new Date()) {
  return record ? storedValue ?? '' : vietnamDateRangeYearToDate(now).to;
}

export function toVietnamDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  const seconds = date.getUTCSeconds() || date.getUTCMilliseconds()
    ? `:${parts.second}${date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, '0')}` : ''}` : '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${seconds}`;
}

export function fromVietnamDateTimeInput(value) {
  if (!value) return null;
  // Unedited timestamps retain the original offset and sub-millisecond precision.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    if (!Number.isFinite(Date.parse(value))) throw Error('Thời gian không hợp lệ.');
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) throw Error('Thời gian không hợp lệ.');
  const date = new Date(`${value}+07:00`);
  const roundTrip = toVietnamDateTimeInput(date);
  if (!roundTrip || roundTrip.slice(0,16) !== value.slice(0,16)) throw Error('Thời gian không hợp lệ.');
  return date.toISOString();
}
