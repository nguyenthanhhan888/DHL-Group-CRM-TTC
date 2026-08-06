import { applyPagination, applySort, requireSupabaseClient, runQuery } from './BaseService.js';
import { AuditLogService } from './AuditLogService.js';
import { startOfToday, toDateOnly } from '../utils/date.js';

const EXPIRING_WINDOW_DAYS = 30;

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
    const kioskCustomerIds = await findCustomerIdsByKioskState(supabase, kioskState);
    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' });

    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      query = query.or(`phone.ilike.${pattern},facebook_id.ilike.${pattern},facebook_name.ilike.${pattern}`);
    }

    if (status) query = query.eq('status', status);
    if (kioskCustomerIds) {
      if (!kioskCustomerIds.length) {
        return { data: [], count: 0 };
      }

      query = query.in('id', kioskCustomerIds);
    }

    return runQuery(applyPagination(applySort(query, sort), pagination));
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

async function findCustomerIdsByKioskState(supabase, kioskState) {
  if (!kioskState) return null;

  const today = startOfToday();
  const todayDate = toDateOnly(today);
  let query = supabase
    .from('kiosks')
    .select('customer_id');

  if (kioskState === 'expired') {
    query = query.or(`status.eq.expired,end_date.lt.${todayDate}`);
  } else if (kioskState === 'warning') {
    const warningEndDate = new Date(today);
    warningEndDate.setDate(today.getDate() + EXPIRING_WINDOW_DAYS);
    query = query
      .in('status', ['active', 'warning'])
      .gte('end_date', todayDate)
      .lte('end_date', toDateOnly(warningEndDate));
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error) throw error;

  return [...new Set((data || [])
    .map((kiosk) => kiosk.customer_id)
    .filter(Boolean))];
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
