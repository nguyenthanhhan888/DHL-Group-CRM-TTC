import { getSupabaseClient } from '../supabase/client.js';

export function requireSupabaseClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase chưa được cấu hình. Kiểm tra config.local.js.');
  }
  return client;
}

export async function runQuery(query) {
  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count };
}

export function applyPagination(query, pagination = {}) {
  const page = Number(pagination.page || 1);
  const pageSize = Number(pagination.pageSize || 25);
  if (!Number.isFinite(page) || !Number.isFinite(pageSize) || page < 1 || pageSize < 1) {
    return query;
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return query.range(from, to);
}

export function applySort(query, sort = {}) {
  if (!sort.column) return query;
  return query.order(sort.column, { ascending: sort.ascending !== false });
}
