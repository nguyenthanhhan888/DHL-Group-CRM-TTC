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

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    return {
      data: await enrichBusinessEntities(requireSupabaseClient(), rows),
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

async function enrichBusinessEntities(supabase, rows) {
  if (!rows.length) return rows;
  const requestIds = uniqueIds(rows.filter(isRegistrationLog).map((log) => log.record_id));
  const requests = requestIds.length
    ? (await runQuery(supabase.from('registration_requests').select('id,kiosk_id,customer_id,facebook_name').in('id', requestIds))).data || []
    : [];
  const requestsById = new Map(requests.map((item) => [String(item.id), item]));
  const kioskIds = uniqueIds(rows.flatMap((log) => [nestedId(log, 'kiosk_id'), nestedId(log, 'payment.kiosk_id'), entityRecordId(log, 'kiosk'), requestsById.get(String(log.record_id))?.kiosk_id]));
  const customerIds = uniqueIds(rows.flatMap((log) => [nestedId(log, 'customer_id'), nestedId(log, 'payment.customer_id'), entityRecordId(log, 'customer'), requestsById.get(String(log.record_id))?.customer_id]));
  const promotionIds = uniqueIds(rows.flatMap((log) => [nestedId(log, 'promotion_id'), entityRecordId(log, 'promotion')]));
  const [kiosks, customers, promotions] = await Promise.all([
    batchSelect(supabase, 'kiosks', 'id,facebook_name', kioskIds),
    batchSelect(supabase, 'customers', 'id,facebook_name', customerIds),
    batchSelect(supabase, 'promotions', 'id,code,name', promotionIds),
  ]);
  const kioskById = new Map(kiosks.map((item) => [String(item.id), item]));
  const customerById = new Map(customers.map((item) => [String(item.id), item]));
  const promotionById = new Map(promotions.map((item) => [String(item.id), item]));
  return rows.map((log) => {
    const request = requestsById.get(String(log.record_id));
    const promotionId = nestedId(log, 'promotion_id') || entityRecordId(log, 'promotion');
    const kioskId = nestedId(log, 'kiosk_id') || nestedId(log, 'payment.kiosk_id') || entityRecordId(log, 'kiosk') || request?.kiosk_id;
    const customerId = nestedId(log, 'customer_id') || nestedId(log, 'payment.customer_id') || entityRecordId(log, 'customer') || request?.customer_id;
    if (promotionId) return withResolved(log, 'Mã giảm giá', promotionById.get(String(promotionId))?.code || null, promotionId);
    if (kioskId || isRegistrationLog(log)) return withResolved(log, 'Kiosk', kioskById.get(String(kioskId))?.facebook_name || request?.facebook_name || null, kioskId);
    if (customerId) return withResolved(log, 'Khách hàng', customerById.get(String(customerId))?.facebook_name || null, customerId);
    return log;
  });
}

function batchSelect(supabase, table, columns, ids) {
  return ids.length ? runQuery(supabase.from(table).select(columns).in('id', ids)).then(({ data }) => data || []) : Promise.resolve([]);
}
function withResolved(log, kind, name, id) { return { ...log, resolved_entity: { kind, name, id, missing: !name } }; }
function uniqueIds(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String))]; }
function isRegistrationLog(log) { return /registration/i.test(String(log.entity || log.module || '')) || /review_legacy/i.test(String(log.action || '')); }
function entityRecordId(log, kind) { return String(log.entity || log.module || '').toLowerCase().includes(kind) ? log.record_id : null; }
function nestedId(log, path) {
  for (const source of [log.after, log.before]) {
    const value = path.split('.').reduce((current, key) => current?.[key], source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

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
