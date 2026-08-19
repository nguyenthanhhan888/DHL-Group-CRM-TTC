import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getExpiryWarningDays, replaceOrganizationSettings } from '../src/config/organization.js';
import { SettingsService } from '../src/services/SettingsService.js';

test('public settings reload preserves warning_days in the shared cache', async () => {
  global.window = {
    DHL_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    supabase: {
      createClient: () => ({
        rpc: async (name) => {
          assert.equal(name, 'get_public_organization_settings');
          return { data: { official_group_name: 'DHL', warning_days: '5' }, error: null };
        },
      }),
    },
  };

  replaceOrganizationSettings({ warning_days: '10' });
  await new SettingsService().getPublicSettings();
  assert.equal(getExpiryWarningDays(), 5);
  replaceOrganizationSettings({});
});

test('forward migration exposes warning_days and preserves public RPC grants', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260819000500_include_warning_days_in_public_settings.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace function public\.get_public_organization_settings\(\)/i);
  assert.match(sql, /'warning_days'/);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.get_public_organization_settings\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_public_organization_settings\(\) to anon, authenticated/i);
});
