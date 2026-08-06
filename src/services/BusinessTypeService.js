import { applyPagination, applySort, requireSupabaseClient, runQuery } from './BaseService.js';

const BUSINESS_TYPE_MUTABLE_FIELDS = [
  'category_id',
  'name',
  'description',
  'price_per_month',
  'sort_order',
  'is_active',
];

export const BusinessTypeService = {
  async list({
    searchTerm = '',
    status = '',
    categoryId = '',
    sort = { column: 'sort_order', ascending: true },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    let query = supabase
      .from('business_types')
      .select('*, categories(id, name)', { count: 'exact' });

    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
    }

    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);
    if (categoryId) query = query.eq('category_id', categoryId);

    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listWithStats({
    searchTerm = '',
    status = '',
    categoryId = '',
    sort = { column: 'sort_order', ascending: true },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    let query = supabase.rpc(
      'get_business_types_with_stats',
      { search_term: searchTerm || null },
      { count: 'exact' },
    );

    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);
    if (categoryId) query = query.eq('category_id', categoryId);

    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listByCategory(categoryId) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('business_types')
        .select('id, name, price_per_month')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('sort_order'),
    );
  },

  async listActive() {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('business_types')
        .select('id, name, price_per_month, category_id')
        .eq('is_active', true)
        .order('sort_order'),
    );
  },

  async getById(id) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('business_types')
        .select('*')
        .eq('id', id)
        .single(),
    );
  },

  async create(businessType) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('business_types')
        .insert([pickBusinessTypePayload(businessType)])
        .select()
        .single(),
    );
  },

  async update(id, businessType) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('business_types')
        .update(pickBusinessTypePayload(businessType))
        .eq('id', id)
        .select()
        .single(),
    );
  },

  async remove(id) {
    return BusinessTypeService.setActive(id, false);
  },

  async setActive(id, isActive) {
    return BusinessTypeService.update(id, { is_active: isActive });
  },
};

function pickBusinessTypePayload(businessType = {}) {
  return BUSINESS_TYPE_MUTABLE_FIELDS.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(businessType, field)) {
      payload[field] = businessType[field] ?? null;
    }

    return payload;
  }, {});
}
