import { vietnamDateRangeYearToDate } from './date.js';
import { isValidDateOnly } from './formValidation.js';

export function reportPeriod(filters = {}, now = new Date()) {
  const today = vietnamDateRangeYearToDate(now);
  // Explicit UI state distinguishes a user-selected YTD range from the default.
  const custom = filters.customDateRange ?? Boolean(filters.startDate || filters.endDate);
  const from = custom ? filters.startDate || today.from : today.from;
  const to = custom ? filters.endDate || today.to : today.to;
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) throw new Error('Khoảng ngày báo cáo không hợp lệ.');
  const year = Number(to.slice(0, 4)), month = Number(today.to.slice(5, 7));
  const currentYear = Number(today.to.slice(0, 4));
  const yearRange = { startDate: `${year}-01-01`, endDate: year === currentYear ? today.to : `${year}-12-31` };
  return {
    mode: custom ? 'range' : 'ytd', custom, year, month,
    selected: { startDate: from, endDate: to }, yearRange,
    monthRange: { startDate: `${today.to.slice(0, 7)}-01`, endDate: today.to },
    labels: [`Doanh thu năm ${year}`, custom ? 'Doanh thu trong kỳ' : `Doanh thu tháng ${month}`,
      custom ? 'Chi tiêu trong kỳ' : `Chi tiêu năm ${year}`,
      custom ? 'Lợi nhuận ròng trong kỳ' : `Lợi nhuận ròng năm ${year}`],
  };
}
