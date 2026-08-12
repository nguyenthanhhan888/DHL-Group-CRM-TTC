function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toDateOnly(value) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString().slice(0, 10)
    : null;
}

function vietnamToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function publicRenewalPeriod(currentExpiry, months, today = vietnamToday()) {
  const current = dateOnly(currentExpiry);
  const todayDate = dateOnly(today);
  const duration = Number(months);
  if (!todayDate || !Number.isInteger(duration) || duration < 1) return null;

  const start = current && current >= todayDate
    ? new Date(current.getTime() + 86400000)
    : todayDate;
  const targetMonth = start.getUTCMonth() + duration;
  const targetYear = start.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const endExclusive = new Date(Date.UTC(targetYear, normalizedMonth, Math.min(start.getUTCDate(), lastDay)));
  const end = new Date(endExclusive.getTime() - 86400000);
  return { startDate: toDateOnly(start), proposedExpiry: toDateOnly(end) };
}

module.exports = { publicRenewalPeriod, vietnamToday };
