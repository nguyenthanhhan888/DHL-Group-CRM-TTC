export function calculateRenewalPeriod({ currentEndDate, months, today, startDate } = {}) {
  const normalizedMonths = Number(months);
  if (!Number.isInteger(normalizedMonths) || normalizedMonths < 1) {
    throw new Error('Số tháng phải là số nguyên lớn hơn 0.');
  }
  const todayDate = parseDateOnlyStrict(today);
  const currentEnd = currentEndDate ? parseDateOnlyStrict(currentEndDate) : null;
  const defaultStart = currentEnd && currentEnd >= todayDate
    ? addDays(currentEnd, 1)
    : todayDate;
  const effectiveStart = startDate ? parseDateOnlyStrict(startDate) : defaultStart;
  const endExclusive = addCalendarMonths(effectiveStart, normalizedMonths);
  return {
    defaultStartDate: toDateOnly(defaultStart),
    startDate: toDateOnly(effectiveStart),
    endDate: toDateOnly(addDays(endExclusive, -1)),
  };
}

export function calculateRenewalAmounts({ baseAmount, discount = 0 } = {}) {
  const base = Number(baseAmount);
  const reduction = Number(discount);
  if (!Number.isFinite(base) || base < 0) throw new Error('Giá gốc không hợp lệ.');
  if (!Number.isFinite(reduction) || reduction < 0 || reduction > base) {
    throw new Error('Giảm giá phải từ 0 đến giá gốc.');
  }
  return { baseAmount: base, discount: reduction, actualAmount: base - reduction };
}

function parseDateOnlyStrict(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('Ngày không hợp lệ.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (toDateOnly(date) !== value) throw new Error('Ngày không hợp lệ.');
  return date;
}

function addCalendarMonths(date, months) {
  const year = date.getUTCFullYear();
  const targetIndex = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function toDateOnly(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
