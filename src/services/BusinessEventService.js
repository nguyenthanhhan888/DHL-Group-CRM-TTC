import { requireSupabaseClient, runQuery } from './BaseService.js';

const PAGE_SIZES = new Set([5, 10, 20, 50]);

export const BusinessEventService = {
  async list({ context = 'logs', searchTerm = '', actor = '', activity = '', source = '', fromTime = null, toTime = null, page = 1, pageSize = 20 } = {}) {
    const normalizedSize = PAGE_SIZES.has(Number(pageSize)) ? Number(pageSize) : 20;
    const normalizedPage = Math.max(1, Number(page) || 1);
    const { data } = await runQuery(requireSupabaseClient().rpc('get_business_events', {
      p_context: context,
      p_search_term: optional(searchTerm),
      p_actor_filter: optional(actor),
      p_activity_filter: optional(activity),
      p_source_filter: optional(source),
      p_from_time: dateTime(fromTime),
      p_to_time: dateTime(toTime),
      p_page: normalizedPage,
      p_page_size: normalizedSize,
    }));
    return {
      data: Array.isArray(data?.rows) ? data.rows : [],
      count: Number(data?.total || 0),
      page: Number(data?.page || normalizedPage),
      pageSize: Number(data?.pageSize || normalizedSize),
    };
  },
};

function optional(value) { return String(value || '').trim() || null; }
function dateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
