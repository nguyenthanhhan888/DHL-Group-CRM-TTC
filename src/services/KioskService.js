import { requireSupabaseClient, runQuery } from './BaseService.js';
import { AuditLogService } from './AuditLogService.js';

const KIOSK_SELECT = '*, customers(id, facebook_name, facebook_id, phone, address, status, total_paid, total_kiosks, note), categories(name), business_types(name, price_per_month)';
const KIOSK_ADMIN_MUTABLE_FIELDS = [
  'facebook_name', 'facebook_id', 'facebook_link', 'facebook_group_link',
  'category_id', 'business_type_id', 'status', 'start_date', 'end_date',
  'auto_approve', 'note',
];

export const KioskService = {
  async list({
    searchTerm = '',
    status = '',
    businessTypeId = '',
    sort = null,
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    const resolvedSort = resolveKioskSort(status, sort);
    const { data, error } = await runQuery(supabase.rpc('get_kiosk_status_data', {
      p_search: normalizeSearchTerm(searchTerm) || null,
      p_status: String(status || '').trim().toLowerCase() || null,
      p_business_type_id: positiveIntegerOrNull(businessTypeId),
      p_sort_by: resolvedSort.column,
      p_sort_direction: resolvedSort.ascending ? 'asc' : 'desc',
      p_page: positiveInteger(pagination?.page, 1),
      p_page_size: positiveInteger(pagination?.pageSize, 12),
    }));
    if (error) return { data: [], count: 0, error };
    return { data: Array.isArray(data?.rows) ? data.rows : [], count: Number(data?.totalRows || 0) };
  },

  async getById(id) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('kiosks')
        .select(KIOSK_SELECT)
        .eq('id', id)
        .single(),
    );
  },

  async listByCustomer(customerId) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('registered_kiosks')
        .select('id, facebook_name, facebook_id, start_date, end_date, status, auto_approve, categories(name), business_types(name)')
        .eq('customer_id', customerId)
        .order('facebook_name'),
    );
  },

  async create(kiosk, reason) {
    const supabase = requireSupabaseClient();
    const { data, error } = await runQuery(
      supabase
        .from('kiosks')
        .insert([kiosk])
        .select()
        .single(),
    );

    if (error) throw error;

    await AuditLogService.log({
      module: 'Kiosk',
      action: 'create',
      after: data,
      reason,
    });

    return { data };
  },

  async update(id, kiosk, reason, { confirmReassignment = false } = {}) {
    const supabase = requireSupabaseClient();
    const { data: before, error: beforeError } = await this.getById(id);
    if (beforeError) throw beforeError;

    const hasCustomerChange = Object.prototype.hasOwnProperty.call(kiosk, 'customer_id')
      && String(kiosk.customer_id) !== String(before.customer_id);
    const mutablePayload = pickAdminMutableFields(kiosk);

    let data = before;
    if (Object.keys(mutablePayload).length) {
      const updateResult = await runQuery(
        supabase
          .from('kiosks')
          .update(mutablePayload)
          .eq('id', id)
          .select()
          .single(),
      );
      data = updateResult.data;
    }

    if (hasCustomerChange) {
      if (!confirmReassignment) {
        throw new Error('Cần xác nhận việc đổi khách hàng của Kiosk.');
      }
      await runQuery(supabase.rpc('reassign_kiosk_customer', {
        kiosk_id_input: Number(id),
        new_customer_id_input: Number(kiosk.customer_id),
        confirmed_input: true,
        reason_input: String(reason || '').trim(),
      }));
      ({ data } = await this.getById(id));
    }

    await AuditLogService.log({
      module: 'Kiosk',
      action: 'update',
      before,
      after: data,
      reason,
    });

    return { data };
  },

  async isFacebookIdInUse(facebookId, excludeKioskId = null) {
    if (!facebookId) return false;

    const supabase = requireSupabaseClient();
    const queries = [];

    // Check existing kiosks
    let kioskQuery = supabase.from('kiosks').select('id', { count: 'exact', head: true }).eq('facebook_id', facebookId);
    if (excludeKioskId) {
      kioskQuery = kioskQuery.not('id', 'eq', excludeKioskId);
    }
    queries.push(kioskQuery);

    // Only pending public requests can reserve an ID. Requests already linked to
    // this kiosk, or requests that were approved/rejected/cancelled, should not
    // block editing the kiosk's own Facebook ID.
    let registrationQuery = supabase
      .from('registration_requests')
      .select('id', { count: 'exact', head: true })
      .eq('facebook_id', facebookId)
      .in('status', ['pending', 'submitted', 'awaiting_payment', 'payment_pending']);
    if (excludeKioskId) {
      registrationQuery = registrationQuery.or(`kiosk_id.is.null,kiosk_id.neq.${excludeKioskId}`);
    }
    queries.push(registrationQuery);

    const [kioskResult, registrationResult] = await Promise.all(queries.map(runQuery));

    return (kioskResult.count || 0) > 0 || (registrationResult.count || 0) > 0;
  },

  async findNameWarnings(facebookName, excludeKioskId = null) {
    const normalizedName = String(facebookName || '').trim();
    if (!normalizedName) return { data: [] };

    let query = requireSupabaseClient()
      .from('kiosks')
      .select('id, facebook_name, facebook_id')
      .ilike('facebook_name', normalizedName)
      .limit(5);
    if (excludeKioskId) query = query.not('id', 'eq', excludeKioskId);
    return runQuery(query);
  },
};

function normalizeSearchTerm(value) {
  return String(value || '')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveKioskSort(status, sort) {
  if (sort?.column) return sort;
  if (status === 'warning') return { column: 'end_date', ascending: true };
  if (status === 'expired') return { column: 'end_date', ascending: false };
  return { column: 'created_at', ascending: false };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveIntegerOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function pickAdminMutableFields(kiosk = {}) {
  return KIOSK_ADMIN_MUTABLE_FIELDS.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(kiosk, field)) payload[field] = kiosk[field] ?? null;
    return payload;
  }, {});
}
