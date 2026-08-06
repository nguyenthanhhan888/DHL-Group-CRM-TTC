import { requireSupabaseClient, runQuery } from './BaseService.js';

const PAGE_SIZES = new Set([10, 25, 50]);

export const AuditLogService = {
  async log(entry = {}) {
    const before = entry.before ?? null;
    const after = entry.after ?? null;
    const entity = normalizeOptional(entry.entity) || normalizeOptional(entry.module);
    const recordId = normalizeOptional(entry.record_id)
      || normalizeOptional(after?.id)
      || normalizeOptional(before?.id)
      || normalizeOptional(after?.payment?.id)
      || normalizeOptional(before?.payment?.id);

    return runQuery(requireSupabaseClient().rpc('write_audit_log', {
      module_input: normalizeRequired(entry.module, 'Module'),
      action_input: normalizeRequired(entry.action, 'Hành động'),
      entity_input: entity,
      record_id_input: recordId,
      before_input: before,
      after_input: after,
      reason_input: normalizeOptional(entry.reason),
    }));
  },

  async list({
    searchTerm = '',
    actor = '',
    action = '',
    module = '',
    fromTime = null,
    toTime = null,
    pagination = {},
  } = {}) {
    const page = positiveInteger(pagination.page, 1);
    const requestedSize = positiveInteger(pagination.pageSize, 25);
    const pageSize = PAGE_SIZES.has(requestedSize) ? requestedSize : 25;
    const { data } = await runQuery(requireSupabaseClient().rpc('get_audit_logs', {
      actor_filter: normalizeOptional(actor),
      module_filter: normalizeOptional(module),
      action_filter: normalizeOptional(action),
      from_time: normalizeDateTime(fromTime),
      to_time: normalizeDateTime(toTime),
      search_term: normalizeOptional(searchTerm),
      page_number: page,
      page_size: pageSize,
    }));

    return {
      data: Array.isArray(data?.rows) ? data.rows : [],
      count: Number(data?.total || 0),
      page: Number(data?.page || page),
      pageSize: Number(data?.pageSize || pageSize),
    };
  },

  async getById(id) {
    const { data } = await runQuery(requireSupabaseClient().rpc('get_audit_log', {
      log_id_input: Number(id),
    }));
    return { data };
  },
};

function normalizeRequired(value, label) {
  const normalized = normalizeOptional(value);
  if (!normalized) throw new Error(`${label} là bắt buộc.`);
  return normalized;
}

function normalizeOptional(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() || null;
}

function normalizeDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
