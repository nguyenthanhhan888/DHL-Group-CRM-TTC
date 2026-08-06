import { applyPagination, applySort, requireSupabaseClient, runQuery } from './BaseService.js';
import { AuditLogService } from './AuditLogService.js';
import { startOfToday, toDateOnly } from '../utils/date.js';

const KIOSK_SELECT = '*, customers(id, facebook_name, facebook_id, phone, address, status, total_paid, total_kiosks, note), categories(name), business_types(name, price_per_month)';
const EXPIRING_WINDOW_DAYS = 30;

export const KioskService = {
  async list({
    searchTerm = '',
    status = '',
    businessTypeId = '',
    sort = { column: 'created_at', ascending: false },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    const normalizedSearch = normalizeSearchTerm(searchTerm);
    let query = supabase
      .from('kiosks')
      .select(KIOSK_SELECT, { count: 'exact' });

    if (normalizedSearch) {
      const businessTypeIds = await findBusinessTypeIds(supabase, normalizedSearch);
      query = query.or(buildSearchFilter(normalizedSearch, businessTypeIds));
    }

    query = applyStatusFilter(query, status);
    if (businessTypeId) query = query.eq('business_type_id', businessTypeId);

    return runQuery(applyPagination(applySort(query, sort), pagination));
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
        .from('kiosks')
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
    const mutablePayload = { ...kiosk };
    delete mutablePayload.customer_id;

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

function applyStatusFilter(query, status) {
  if (!status) return query;

  const today = startOfToday();
  const todayDate = toDateOnly(today);

  if (status === 'expired') {
    return query.or(`status.eq.expired,end_date.lt.${todayDate}`);
  }

  if (status !== 'warning') return query.eq('status', status);

  const warningEndDate = new Date(today);
  warningEndDate.setDate(today.getDate() + EXPIRING_WINDOW_DAYS);

  return query
    .in('status', ['active', 'warning'])
    .gte('end_date', todayDate)
    .lte('end_date', toDateOnly(warningEndDate));
}

async function findBusinessTypeIds(supabase, searchTerm) {
  const { data, error } = await supabase
    .from('business_types')
    .select('id')
    .ilike('name', `%${searchTerm}%`)
    .limit(50);

  if (error) throw error;
  return (data || []).map((item) => item.id).filter(Boolean);
}

function buildSearchFilter(searchTerm, businessTypeIds = []) {
  const pattern = `%${searchTerm}%`;
  const conditions = [
    `facebook_id.ilike.${pattern}`,
    `facebook_name.ilike.${pattern}`,
    `status.ilike.${pattern}`,
  ];

  if (businessTypeIds.length) {
    conditions.push(`business_type_id.in.(${businessTypeIds.join(',')})`);
  }

  return conditions.join(',');
}
