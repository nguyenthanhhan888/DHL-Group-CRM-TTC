import { requireSupabaseClient, runQuery } from './BaseService.js';

export const UserProfileService = {
  async getCurrentAppProfile() {
    const { data } = await runQuery(requireSupabaseClient().rpc('get_current_app_profile'));
    return { data };
  },

  async ensureMyProfile({
    displayName = '',
    phone = '',
    email = '',
    username = '',
    metadata = {},
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('ensure_my_user_profile', {
      display_name_input: normalizeOptional(displayName),
      phone_input: normalizeOptional(phone),
      email_input: normalizeOptional(email),
      username_input: normalizeOptional(username),
      metadata_input: metadata && typeof metadata === 'object' ? metadata : {},
    }));
    return { data };
  },

  async upsertMyFacebookAccount({
    accountId = null,
    facebookUrlOriginal,
    facebookUrlNormalized = '',
    facebookId = '',
    facebookIdStatus = '',
    isPrimary = false,
    note = '',
    metadata = {},
  } = {}) {
    const { data } = await runQuery(requireSupabaseClient().rpc('upsert_my_facebook_account', {
      account_id_input: accountId ? Number(accountId) : null,
      facebook_url_original_input: normalizeRequired(facebookUrlOriginal, 'Link Facebook'),
      facebook_url_normalized_input: normalizeOptional(facebookUrlNormalized),
      facebook_id_input: normalizeOptional(facebookId),
      facebook_id_status_input: normalizeOptional(facebookIdStatus),
      is_primary_input: Boolean(isPrimary),
      note_input: normalizeOptional(note),
      metadata_input: metadata && typeof metadata === 'object' ? metadata : {},
    }));
    return { data };
  },

  async listMyFacebookAccounts() {
    return runQuery(
      requireSupabaseClient()
        .from('user_facebook_accounts')
        .select('*')
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false }),
    );
  },

  async listMyCustomerLinks() {
    return runQuery(
      requireSupabaseClient()
        .from('customer_user_links')
        .select('*, customers(id, facebook_name, phone), kiosks(id, facebook_name, facebook_id, status)')
        .order('created_at', { ascending: false }),
    );
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
