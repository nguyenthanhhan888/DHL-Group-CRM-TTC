import { applyPagination, applySort, requireSupabaseClient, runQuery } from './BaseService.js';

export const TtcAdminService = {
  async listUsers({
    searchTerm = '',
    pagination,
  } = {}) {
    let query = requireSupabaseClient()
      .from('user_profiles')
      .select('*, wallets(balance, total_earned, total_spent), user_facebook_accounts(id, facebook_id, facebook_id_status)', { count: 'exact' })
      .order('created_at', { ascending: false });

    const normalizedSearch = String(searchTerm || '').trim();
    if (normalizedSearch) {
      const pattern = `%${normalizedSearch}%`;
      query = query.or(`display_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`);
    }

    return runQuery(applyPagination(query, pagination));
  },

  async listInteractionTypes() {
    return runQuery(
      requireSupabaseClient()
        .from('ttc_interaction_types')
        .select('*')
        .order('code'),
    );
  },

  async listWalletLedger({
    walletUserId = '',
    pagination,
  } = {}) {
    let query = requireSupabaseClient()
      .from('wallet_ledger')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (walletUserId) query = query.eq('wallet_user_id', walletUserId);

    return runQuery(applyPagination(query, pagination));
  },

  async updateInteractionType(code, payload = {}) {
    const updatePayload = {
      label: normalizeRequired(payload.label, 'Tên loại tương tác'),
      unit_cost: nonNegativeNumber(payload.unitCost, 'Giá mua'),
      worker_reward: nonNegativeNumber(payload.workerReward, 'Xu thưởng'),
      min_quantity: positiveInteger(payload.minQuantity, 'Số lượng tối thiểu'),
      max_quantity: positiveInteger(payload.maxQuantity, 'Số lượng tối đa'),
      hold_seconds: nonNegativeInteger(payload.holdSeconds, 'Thời gian giữ'),
      is_active: Boolean(payload.isActive),
    };
    if (updatePayload.max_quantity < updatePayload.min_quantity) {
      throw new Error('Số lượng tối đa phải lớn hơn hoặc bằng tối thiểu.');
    }
    return runQuery(
      requireSupabaseClient()
        .from('ttc_interaction_types')
        .update(updatePayload)
        .eq('code', normalizeRequired(code, 'Mã loại tương tác'))
        .select()
        .single(),
    );
  },

  async listCampaigns({
    status = '',
    interactionType = '',
    sort = { column: 'created_at', ascending: false },
    pagination,
  } = {}) {
    let query = requireSupabaseClient()
      .from('ttc_campaigns')
      .select('*, user_profiles(display_name, phone, email), ttc_interaction_types(label, config)', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (interactionType) query = query.eq('interaction_type_code', interactionType);

    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listTasks({
    campaignId = '',
    status = '',
    sort = { column: 'updated_at', ascending: false },
    pagination,
  } = {}) {
    let query = requireSupabaseClient()
      .from('ttc_tasks')
      .select('*, ttc_campaigns(id, interaction_type_code, target_url, owner_user_id), user_profiles(display_name, phone, email)', { count: 'exact' });

    if (campaignId) query = query.eq('campaign_id', Number(campaignId));
    if (status) query = query.eq('status', status);

    return runQuery(applyPagination(applySort(query, sort), pagination));
  },

  async listCheckLogs({
    taskId = '',
    campaignId = '',
    pagination,
  } = {}) {
    let query = requireSupabaseClient()
      .from('ttc_task_check_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (taskId) query = query.eq('task_id', Number(taskId));
    if (campaignId) query = query.eq('campaign_id', Number(campaignId));

    return runQuery(applyPagination(query, pagination));
  },

  async adjustWallet({
    userId,
    amount,
    reason,
    description = '',
    idempotencyKey = createIdempotencyKey('admin-wallet-adjustment'),
    metadata = {},
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('admin_post_wallet_ledger', {
      wallet_user_id_input: normalizeRequired(userId, 'User'),
      amount_input: nonZeroNumber(amount, 'Số xu'),
      transaction_type_input: 'admin_adjustment',
      related_table_input: null,
      related_id_input: null,
      idempotency_key_input: idempotencyKey,
      description_input: normalizeOptional(description),
      reason_input: normalizeRequired(reason, 'Lý do'),
      metadata_input: metadata && typeof metadata === 'object' ? metadata : {},
    }));
    return { data };
  },

  async createCampaignForUser({
    ownerUserId,
    interactionType,
    targetUrl,
    targetQuantity,
    targetFacebookId = null,
    targetLabel = null,
    commentOptions = [],
    reason = '',
    metadata = {},
    idempotencyKey = createIdempotencyKey('admin-ttc-campaign'),
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('admin_create_ttc_campaign_for_user', {
      owner_user_id_input: normalizeRequired(ownerUserId, 'User owner'),
      interaction_type_input: normalizeRequired(interactionType, 'Loại tương tác'),
      target_url_input: normalizeRequired(targetUrl, 'Link mục tiêu'),
      target_quantity_input: positiveInteger(targetQuantity, 'Số lượng'),
      idempotency_key_input: idempotencyKey,
      target_facebook_id_input: normalizeOptional(targetFacebookId),
      target_label_input: normalizeOptional(targetLabel),
      comment_options_input: Array.isArray(commentOptions) ? commentOptions : [],
      metadata_input: metadata && typeof metadata === 'object' ? metadata : {},
      admin_reason_input: normalizeOptional(reason),
    }));
    return { data };
  },

  async verifyTask(taskId, action, reason = '', metadata = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('verify_ttc_task', {
      task_id_input: positiveInteger(taskId, 'Nhiệm vụ'),
      action_input: normalizeRequired(action, 'Thao tác'),
      reason_input: normalizeOptional(reason),
      metadata_input: metadata && typeof metadata === 'object' ? metadata : {},
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

function nonZeroNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) {
    throw new Error(`${label} phải khác 0.`);
  }
  return parsed;
}

function nonNegativeNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} phải là số không âm.`);
  }
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} phải là số nguyên không âm.`);
  }
  return parsed;
}

function createIdempotencyKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
