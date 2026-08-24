import { requireSupabaseClient, runQuery } from './BaseService.js';
import { AuditLogService } from './AuditLogService.js';

const CUSTOMER_MUTABLE_FIELDS = [
  'facebook_name',
  'facebook_id',
  'facebook_link',
  'facebook_group_link',
  'phone',
  'address',
  'status',
  'note',
];

export const CustomerService = {
  async list({
    searchTerm = '',
    status = '',
    kioskState = '',
    sort = { column: 'created_at', ascending: false },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    const { data, error } = await runQuery(supabase.rpc('get_customer_status_data', {
      p_search: String(searchTerm || '').trim() || null,
      p_customer_status: String(status || '').trim().toLowerCase() || null,
      p_kiosk_status: String(kioskState || '').trim().toLowerCase() || null,
      p_customer_id: null,
      p_sort_by: sort?.column || 'created_at',
      p_sort_direction: sort?.ascending ? 'asc' : 'desc',
      p_page: positiveInteger(pagination?.page, 1),
      p_page_size: positiveInteger(pagination?.pageSize, 10),
    }));
    if (error) return { data: [], count: 0, error };
    return { data: Array.isArray(data?.rows) ? data.rows : [], count: Number(data?.totalRows || 0) };
  },

  async search({ facebookId = '', phone = '' }) {
    if (!facebookId && !phone) {
      return { data: [] };
    }
    const supabase = requireSupabaseClient();
    let query = supabase.from('customers').select('*');
    if (facebookId) {
      query = query.eq('facebook_id', facebookId);
    } else if (phone) {
      query = query.eq('phone', phone);
    }
    return runQuery(query);
  },

  async getById(id) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .single(),
    );
  },

  async getStatusById(id) {
    const supabase = requireSupabaseClient();
    const { data } = await runQuery(supabase.rpc('get_customer_status_data', {
      p_search: null,
      p_customer_status: null,
      p_kiosk_status: null,
      p_customer_id: positiveInteger(id, null),
      p_sort_by: 'created_at',
      p_sort_direction: 'desc',
      p_page: 1,
      p_page_size: 10,
    }));
    return { data: Array.isArray(data?.rows) ? data.rows[0] || null : null };
  },

  async getByFacebookId(facebookId) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('customers')
        .select('*')
        .eq('facebook_id', facebookId)
        .maybeSingle(),
    );
  },

  async getByPhone(phone) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .maybeSingle(),
    );
  },

  async create(customer, reason) {
    const supabase = requireSupabaseClient();
    const { data, error } = await runQuery(
      supabase
        .from('customers')
        .insert([pickCustomerPayload(customer)])
        .select()
        .single(),
    );

    if (error) throw error;

    await AuditLogService.log({
      module: 'Customer',
      action: 'create',
      after: data,
      reason,
    });

    return { data };
  },

  async update(id, customer, reason) {
    const supabase = requireSupabaseClient();
    const { data: before, error: beforeError } = await this.getById(id);
    if (beforeError) throw beforeError;

    const { data, error } = await runQuery(
      supabase
        .from('customers')
        .update(pickCustomerPayload(customer))
        .eq('id', id)
        .select()
        .single(),
    );

    if (error) throw error;

    await AuditLogService.log({
      module: 'Customer',
      action: 'update',
      before,
      after: data,
      reason,
    });

    return { data };
  },

  async findDuplicates({ phone, name, excludeId = null }) {
    const supabase = requireSupabaseClient();
    // Re-use the internal helper function
    return findDuplicates(supabase, { phone, name, excludeId });
  },
};

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function findDuplicates(supabase, { phone, name, excludeId = null }) {
  const filters = [];
  if (phone) filters.push(`phone.eq.${phone}`);
  if (name) filters.push(`facebook_name.eq.${name}`);

  if (!filters.length) return { data: [] };

  let query = supabase.from('customers').select('id, facebook_name, phone').or(filters.join(','));
  if (excludeId) {
    query = query.not('id', 'eq', excludeId);
  }

  const { data, error } = await query.limit(5);
  if (error) throw error;
  return { data: data || [] };
}

function pickCustomerPayload(customer = {}) {
  return CUSTOMER_MUTABLE_FIELDS.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(customer, field)) {
      payload[field] = customer[field] ?? null;
    }

    return payload;
  }, {});
}
