import { requireSupabaseClient, runQuery } from './BaseService.js';

export const TtcService = {
  async listInteractionTypes() {
    return runQuery(
      requireSupabaseClient()
        .from('ttc_interaction_types')
        .select('*')
        .eq('is_active', true)
        .order('code'),
    );
  },

  async listAvailableTasks({
    facebookAccountId = null,
    page = 1,
    pageSize = 25,
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('list_available_ttc_tasks', {
      facebook_account_id_input: facebookAccountId ? positiveInteger(facebookAccountId, 'Tài khoản Facebook') : null,
      page_number: positiveInteger(page, 'Trang'),
      page_size: positiveInteger(pageSize, 'Số dòng'),
    }));

    return {
      data: Array.isArray(data?.rows) ? data.rows : [],
      count: Number(data?.total || 0),
      page: Number(data?.page || page),
      pageSize: Number(data?.pageSize || pageSize),
      facebookAccountId: data?.facebook_account_id || facebookAccountId || null,
    };
  },

  async listAvailableCampaigns({
    facebookAccountId = null,
    page = 1,
    pageSize = 25,
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('list_available_ttc_campaigns', {
      facebook_account_id_input: facebookAccountId ? positiveInteger(facebookAccountId, 'Tài khoản Facebook') : null,
      page_number: positiveInteger(page, 'Trang'),
      page_size: positiveInteger(pageSize, 'Số dòng'),
    }));

    return {
      data: Array.isArray(data?.rows) ? data.rows : [],
      totalTasks: Number(data?.totalTasks || 0),
      page: Number(data?.page || page),
      pageSize: Number(data?.pageSize || pageSize),
      facebookAccountId: data?.facebook_account_id || facebookAccountId || null,
    };
  },

  async listMyTasks({
    status = '',
    page = 1,
    pageSize = 25,
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('list_my_ttc_tasks', {
      status_input: normalizeOptional(status),
      page_number: positiveInteger(page, 'Trang'),
      page_size: positiveInteger(pageSize, 'Số dòng'),
    }));

    return {
      data: Array.isArray(data?.rows) ? data.rows : [],
      count: Number(data?.total || 0),
      page: Number(data?.page || page),
      pageSize: Number(data?.pageSize || pageSize),
    };
  },

  async listMyCampaigns({
    status = '',
    page = 1,
    pageSize = 25,
  } = {}) {
    let query = requireSupabaseClient()
      .from('ttc_campaigns')
      .select('*, ttc_interaction_types(label, config)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, count } = await runQuery(query.range(
      (positiveInteger(page, 'Trang') - 1) * positiveInteger(pageSize, 'Số dòng'),
      (positiveInteger(page, 'Trang') * positiveInteger(pageSize, 'Số dòng')) - 1,
    ));

    return {
      data: data || [],
      count: Number(count || 0),
      page,
      pageSize,
    };
  },

  async createCampaign({
    interactionType,
    targetUrl,
    targetQuantity,
    targetFacebookId = null,
    targetLabel = null,
    commentOptions = [],
    metadata = {},
    idempotencyKey = createIdempotencyKey('ttc-campaign'),
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('create_ttc_campaign', {
      interaction_type_input: normalizeRequired(interactionType, 'Loại tương tác'),
      target_url_input: normalizeRequired(targetUrl, 'Link mục tiêu'),
      target_quantity_input: positiveInteger(targetQuantity, 'Số lượng'),
      idempotency_key_input: idempotencyKey,
      target_facebook_id_input: normalizeOptional(targetFacebookId),
      target_label_input: normalizeOptional(targetLabel),
      comment_options_input: Array.isArray(commentOptions) ? commentOptions : [],
      metadata_input: metadata && typeof metadata === 'object' ? metadata : {},
    }));
    return { data };
  },

  async claimTask({
    campaignId,
    facebookAccountId,
    idempotencyKey = createIdempotencyKey('ttc-claim'),
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('claim_ttc_task', {
      campaign_id_input: positiveInteger(campaignId, 'Tăng tương tác'),
      facebook_account_id_input: positiveInteger(facebookAccountId, 'Tài khoản Facebook'),
      idempotency_key_input: idempotencyKey,
    }));
    return { data };
  },

  async submitTask(taskId, evidence = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('submit_ttc_task', {
      task_id_input: positiveInteger(taskId, 'Nhiệm vụ'),
      evidence_input: evidence && typeof evidence === 'object' ? evidence : {},
    }));
    return { data };
  },

  async cancelCampaign(campaignId, reason, idempotencyKey = createIdempotencyKey('ttc-cancel')) {
    const { data } = await runQuery(requireSupabaseClient().rpc('cancel_ttc_campaign', {
      campaign_id_input: positiveInteger(campaignId, 'Tăng tương tác'),
      reason_input: normalizeRequired(reason, 'Lý do hủy'),
      idempotency_key_input: idempotencyKey,
    }));
    return { data };
  },
};

function normalizeOptional(value) {
  return String(value || '').trim() || null;
}

function normalizeRequired(value, label) {
  const normalized = normalizeOptional(value);
  if (!normalized) throw new Error(`${label} là bắt buộc.`);
  return normalized;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} phải là số nguyên lớn hơn 0.`);
  }
  return parsed;
}

function createIdempotencyKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
