import { replaceOrganizationSettings } from '../config/organization.js';
import { requireSupabaseClient } from './BaseService.js';

export class SettingsService {
  async getSettings() {
    const client = requireSupabaseClient();
    const { data, error } = await client.rpc('get_organization_settings');
    if (error) throw error;
    const settings = data || {};
    replaceOrganizationSettings(settings);
    return settings;
  }

  async getPublicSettings() {
    const client = requireSupabaseClient();
    const { data, error } = await client.rpc('get_public_organization_settings');
    if (error) throw error;
    const settings = data || {};
    replaceOrganizationSettings(settings);
    return settings;
  }

  async updateSettings(settings, reason = 'Cập nhật cài đặt tổ chức') {
    const client = requireSupabaseClient();
    const { data, error } = await client.rpc('update_organization_settings', {
      settings_input: settings,
      reason_input: reason,
    });
    if (error) throw error;
    const saved = data || {};
    replaceOrganizationSettings(saved);
    return saved;
  }
}

export const settingsService = new SettingsService();
