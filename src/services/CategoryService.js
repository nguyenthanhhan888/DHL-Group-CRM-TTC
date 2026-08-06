import { applyPagination, applySort, requireSupabaseClient, runQuery } from './BaseService.js';

const CATEGORY_MUTABLE_FIELDS = [
  'name',
  'description',
  'sort_order',
  'is_active',
];

export const CategoryService = {
  async list({
    searchTerm = '',
    status = '',
    sort = { column: 'sort_order', ascending: true },
    pagination,
  } = {}) {
    const supabase = requireSupabaseClient();
    let query = supabase
      .from('categories')
      .select('*', { count: 'exact' });

    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
    }

    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);

    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listWithStats({ sort = { column: 'sort_order', ascending: true }, pagination } = {}) {
    const supabase = requireSupabaseClient();
    const query = supabase.rpc('get_categories_with_stats');
    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listActive() {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('categories')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order'),
    );
  },

  async getById(id) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('categories')
        .select('*')
        .eq('id', id)
        .single(),
    );
  },

  async create(category) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('categories')
        .insert([pickCategoryPayload(category)])
        .select()
        .single(),
    );
  },

  async update(id, category) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('categories')
        .update(pickCategoryPayload(category))
        .eq('id', id)
        .select()
        .single(),
    );
  },

  async remove(id) {
    const supabase = requireSupabaseClient();
    await ensureCategoryHasNoBusinessTypes(supabase, id);

    return runQuery(
      supabase
        .from('categories')
        .delete()
        .eq('id', id),
    );
  },

  async setActive(id, isActive) {
    return CategoryService.update(id, { is_active: isActive });
  },
};

async function ensureCategoryHasNoBusinessTypes(supabase, categoryId) {
  const { count, error } = await supabase
    .from('business_types')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  if (error) throw error;
  if (count > 0) {
    throw new Error('Không thể xóa danh mục đang có loại hình kinh doanh.');
  }
}

function pickCategoryPayload(category = {}) {
  return CATEGORY_MUTABLE_FIELDS.reduce((payload, field) => {
    if (Object.prototype.hasOwnProperty.call(category, field)) {
      payload[field] = category[field] ?? null;
    }

    return payload;
  }, {});
}
