import { requireSupabaseClient, runQuery } from './BaseService.js';

const PAGE_SIZES = new Set([10, 20, 50]);

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
    showTechnical = false,
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
      show_technical: Boolean(showTechnical),
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

export async function enrichBusinessEntities(supabase, rows) {
  if (!rows.length) return rows;
  const requestIds = uniqueIds(rows.filter(isRegistrationLog).map((log) => log.record_id));
  const requests = requestIds.length
    ? await safeBatchSelect(supabase, 'registration_requests', 'id,kiosk_id,customer_id,facebook_name', 'id', requestIds)
    : [];
  const requestsById = new Map(requests.map((item) => [String(item.id), item]));
  const paymentIds = uniqueIds(rows.flatMap((log) => [...nestedIds(log, 'payment_id'), ...nestedIds(log, 'payment.id'), entityRecordId(log, 'payment')]));
  const payments = await safeBatchSelect(supabase, 'payments', 'id,kiosk_id,customer_id,total_amount,payment_status,start_date,end_date,months', 'id', paymentIds);
  const paymentById = new Map(payments.map((item) => [String(item.id), item]));
  const kioskIds = uniqueIds(rows.flatMap((log) => {
    const payment = paymentById.get(String(nestedId(log, 'payment_id') || nestedId(log, 'payment.id') || entityRecordId(log, 'payment')));
    return [...nestedIds(log, 'kiosk_id'), ...nestedIds(log, 'payment.kiosk_id'), entityRecordId(log, 'kiosk'), requestsById.get(String(log.record_id))?.kiosk_id, payment?.kiosk_id];
  }));
  const customerIds = uniqueIds(rows.flatMap((log) => {
    const payment = paymentById.get(String(nestedId(log, 'payment_id') || nestedId(log, 'payment.id') || entityRecordId(log, 'payment')));
    return [...nestedIds(log, 'customer_id'), ...nestedIds(log, 'payment.customer_id'), entityRecordId(log, 'customer'), requestsById.get(String(log.record_id))?.customer_id, payment?.customer_id];
  }));
  const promotionIds = uniqueIds(rows.flatMap((log) => [...nestedIds(log, 'promotion_id'), entityRecordId(log, 'promotion')]));
  const userIds = uniqueIds(rows.flatMap((log) => [...nestedIds(log, 'user_id'), ...nestedIds(log, 'wallet_user_id'), entityRecordId(log, 'user')]));
  const businessTypeIds = uniqueIds(rows.flatMap((log) => nestedIds(log, 'business_type_id')));
  const categoryIds = uniqueIds(rows.flatMap((log) => nestedIds(log, 'category_id')));
  const [kiosks, customers, promotions, users, businessTypes, categories] = await Promise.all([
    safeBatchSelect(supabase, 'kiosks', 'id,facebook_name', 'id', kioskIds),
    safeBatchSelect(supabase, 'customers', 'id,facebook_name', 'id', customerIds),
    safeBatchSelect(supabase, 'promotions', 'id,code,name', 'id', promotionIds),
    safeBatchSelect(supabase, 'user_profiles', 'user_id,display_name,username', 'user_id', userIds),
    safeBatchSelect(supabase, 'business_types', 'id,name', 'id', businessTypeIds),
    safeBatchSelect(supabase, 'categories', 'id,name', 'id', categoryIds),
  ]);
  const kioskById = new Map(kiosks.map((item) => [String(item.id), item]));
  const customerById = new Map(customers.map((item) => [String(item.id), item]));
  const promotionById = new Map(promotions.map((item) => [String(item.id), item]));
  const userById = new Map(users.map((item) => [String(item.user_id), item]));
  const businessTypeById = new Map(businessTypes.map((item) => [String(item.id), item]));
  const categoryById = new Map(categories.map((item) => [String(item.id), item]));
  return rows.map((log) => {
    const request = requestsById.get(String(log.record_id));
    const promotionId = nestedId(log, 'promotion_id') || entityRecordId(log, 'promotion');
    const paymentId = nestedId(log, 'payment_id') || nestedId(log, 'payment.id') || entityRecordId(log, 'payment');
    const payment = paymentById.get(String(paymentId));
    const kioskId = nestedId(log, 'kiosk_id') || nestedId(log, 'payment.kiosk_id') || entityRecordId(log, 'kiosk') || request?.kiosk_id || payment?.kiosk_id;
    const customerId = nestedId(log, 'customer_id') || nestedId(log, 'payment.customer_id') || entityRecordId(log, 'customer') || request?.customer_id || payment?.customer_id;
    const userId = nestedId(log, 'user_id') || nestedId(log, 'wallet_user_id') || entityRecordId(log, 'user');
    const resolvedNames = {
      kiosk: named(kioskById.get(String(kioskId))?.facebook_name, kioskId),
      customer: named(customerById.get(String(customerId))?.facebook_name, customerId),
      promotion: named(promotionById.get(String(promotionId))?.code, promotionId),
      user: named(userDisplayName(userById.get(String(userId))), userId),
      payment: named(paymentId ? `Thanh toán #${paymentId}` : null, paymentId),
      kiosks: mapNames(kioskById, (item) => item.facebook_name),
      customers: mapNames(customerById, (item) => item.facebook_name),
      promotions: mapNames(promotionById, (item) => item.code),
      users: mapNames(userById, userDisplayName),
      payments: mapNames(paymentById, (item) => `Thanh toán #${item.id}`),
      businessTypes: mapNames(businessTypeById, (item) => item.name),
      categories: mapNames(categoryById, (item) => item.name),
    };
    const enriched = { ...log, resolved_names: resolvedNames, resolved_payment: payment || null };
    if (promotionId) return withResolved(enriched, 'Mã giảm giá', resolvedNames.promotion?.name || null, promotionId);
    if (userId) return withResolved(enriched, 'Người dùng', resolvedNames.user?.name || null, userId);
    if (kioskId || isRegistrationLog(log)) return withResolved(enriched, 'Kiosk', resolvedNames.kiosk?.name || request?.facebook_name || null, kioskId);
    if (customerId) return withResolved(enriched, 'Khách hàng', resolvedNames.customer?.name || null, customerId);
    return enriched;
  });
}

async function safeBatchSelect(supabase, table, columns, idColumn, ids) {
  if (!ids.length) return [];
  try {
    const { data } = await runQuery(supabase.from(table).select(columns).in(idColumn, ids));
    return data || [];
  } catch {
    return [];
  }
}
function withResolved(log, kind, name, id) { return { ...log, resolved_entity: { kind, name, id, missing: !name } }; }
function uniqueIds(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String))]; }
function isRegistrationLog(log) { return /registration/i.test(String(log.entity || log.module || '')) || /review_legacy/i.test(String(log.action || '')); }
function entityRecordId(log, kind) {
  const scope = String(log.entity || log.module || '').toLowerCase();
  if (kind === 'user') return /user|staff|profile|permission|wallet/.test(scope) ? log.record_id : null;
  return scope.includes(kind) ? log.record_id : null;
}
function named(name, id) { return name || id ? { name: name || null, id: id || null } : null; }
function userDisplayName(item) { return item?.display_name || item?.username || null; }
function mapNames(map, label) { return Object.fromEntries([...map.entries()].map(([id, item]) => [id, label(item)]).filter(([, value]) => value)); }
function nestedId(log, path) {
  for (const source of [log.after, log.before]) {
    const value = path.split('.').reduce((current, key) => current?.[key], source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}
function nestedIds(log, path) {
  return [log.after, log.before].map((source) => path.split('.').reduce((current, key) => current?.[key], source));
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
