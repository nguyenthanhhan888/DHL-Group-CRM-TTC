import { countActionableRegistrations } from '../utils/registrationFollowup.js';
import { requireSupabaseClient, runQuery } from './BaseService.js';

export const RegistrationRequestService = {
  async getActionableCount() {
    const client = requireSupabaseClient();
    const rows = [];
    let lastId = null;
    // Read-only and independent of notification windows/read state. Keyset paging
    // also works when the server's response cap is lower than the requested limit.
    for (;;) {
      let query = client.from('registration_requests')
        .select('id,status,metadata,customer_id,kiosk_id,payment_id,total_amount,registration_batch_id')
        .order('id', { ascending: true }).limit(500);
      if (lastId !== null) query = query.gt('id', lastId);
      const { data } = await runQuery(query);
      if (!data?.length) break;
      const nextId = data[data.length - 1].id;
      if (nextId == null || String(nextId) === String(lastId)) throw new Error('Không thể đọc đủ hồ sơ Kiosk.');
      rows.push(...data);
      lastId = nextId;
    }
    return countActionableRegistrations(rows);
  },

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
