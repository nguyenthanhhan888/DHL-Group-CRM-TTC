import {
  applyPagination,
  applySort,
  requirePublicSupabaseClient,
  requireSupabaseClient,
  runQuery,
} from './BaseService.js';

const BUSINESS_TYPE_MUTABLE_FIELDS = [
  'category_id',
  'name',
  'description',
  'price_per_month',
  'is_active',
];

export const BusinessTypeService = {
  async list({
    searchTerm = '',
    status = '',
    categoryId = '',
    sort = { column: 'category_id', ascending: true },
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

    return runQuery(applyPagination(applyBusinessTypeSort(query, sort), pagination));
  },

  async listWithStats({
    searchTerm = '',
    status = '',
    categoryId = '',
    sort = { column: 'category_name', ascending: true },
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

    return runQuery(applyPagination(applyBusinessTypeSort(query, sort), pagination));
  },

  async listByCategory(categoryId) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('business_types')
        .select('id, name, price_per_month')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('name', { ascending: true }),
    );
  },

  async listActive() {
    const supabase = requireSupabaseClient();
    const result = await runQuery(
      supabase
        .from('business_types')
        .select('id, name, price_per_month, category_id, categories(name)')
        .eq('is_active', true)
        .order('category_id', { ascending: true })
        .order('name', { ascending: true }),
    );
    result.data = sortBusinessTypesByCategory(result.data);
    return result;
  },

  async listPublicActive() {
    const supabase = requirePublicSupabaseClient();
    const result = await runQuery(
      supabase
        .from('business_types')
        .select('id, name, price_per_month, category_id, categories(name)')
        .eq('is_active', true)
        .order('category_id', { ascending: true })
        .order('name', { ascending: true }),
    );
    result.data = sortBusinessTypesByCategory(result.data);
    return result;
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

function applyBusinessTypeSort(query, sort = {}) {
  const column = sort?.column || 'category_id';
  const ascending = sort?.ascending !== false;
  const sorted = applySort(query, { column, ascending });
  return ['category_id', 'category_name'].includes(column)
    ? sorted.order('name', { ascending: true })
    : sorted;
}

function pickBusinessTypePayload(businessType = {}) {
  return BUSINESS_TYPE_MUTABLE_FIELDS.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(businessType, field)) {
      payload[field] = businessType[field] ?? null;
    }

    return payload;
  }, {});
}

const vietnameseCollator = new Intl.Collator('vi', { sensitivity: 'base' });

function sortBusinessTypesByCategory(businessTypes = []) {
  return [...businessTypes].sort((left, right) => {
    const categoryDifference = vietnameseCollator.compare(
      left.categories?.name || '',
      right.categories?.name || '',
    );
    return categoryDifference || vietnameseCollator.compare(left.name || '', right.name || '');
  });
}
