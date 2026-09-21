import { requireSupabaseClient, runQuery } from './BaseService.js';

export const RegistrationRequestService = {
  async list(status = '') {
    return runQuery(requireSupabaseClient().rpc('admin_list_registration_requests', {
      status_input: status || null,
    }));
  },

  async create(request) {
    const supabase = requireSupabaseClient();
    return runQuery(
      supabase
        .from('registration_requests')
        .insert([request])
        .select()
        .single(),
    );
  },

  async approve(id) {
    return runQuery(requireSupabaseClient().rpc('approve_registration_request', {
      request_id_input: id,
    }));
  },

  async reject(id, reason) {
    return runQuery(requireSupabaseClient().rpc('reject_registration_request', {
      request_id_input: id,
      reason_input: reason,
    }));
  },

  async reviewLegacy(id, action, reason = '') {
    return runQuery(requireSupabaseClient().rpc('review_public_legacy_registration_request', {
      request_id_input: id,
      action_input: action,
      reason_input: reason || null,
    }));
  },

  async completeExternal(id, note = '') {
    return runQuery(requireSupabaseClient().rpc('admin_complete_awaiting_registration', {
      request_id_input: id,
      note_input: note || null,
    }));
  },

  async cancelAwaiting(id, reason) {
    return runQuery(requireSupabaseClient().rpc('admin_cancel_awaiting_registration', {
      request_id_input: id,
      reason_input: reason,
    }));
  },
};
