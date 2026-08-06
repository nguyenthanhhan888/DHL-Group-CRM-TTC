import { requireSupabaseClient, runQuery } from './BaseService.js';

export const RegistrationRequestService = {
  async list(status = 'pending') {
    let query = requireSupabaseClient()
      .from('registration_requests')
      .select('id, facebook_name, facebook_id, facebook_link, phone, service_name, months, total_amount, requested_start_date, requested_end_date, status, submitted_at, reviewed_at, rejection_reason, customer_id, kiosk_id, metadata, categories(name), business_types(name)')
      .order('submitted_at', { ascending: false });
    if (status) query = query.eq('status', status);
    return runQuery(query);
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
};
