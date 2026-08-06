import { getSupabaseStatus } from '../supabase/client.js';

export function ConnectionNotice() {
  const status = getSupabaseStatus();
  if (status.configured) {
    return `
      <div class="notice success">
        <strong>Supabase đã được cấu hình.</strong>
        <span>Lớp dữ liệu vận hành đã sẵn sàng.</span>
      </div>
    `;
  }

  const missing = [
    !status.hasUrl ? 'URL dự án' : '',
    !status.hasAnonKey ? 'anon key' : '',
    !status.hasSdk ? 'Supabase browser SDK' : '',
  ].filter(Boolean).join(', ');

  return `
    <div class="notice warning">
      <strong>Supabase chưa được cấu hình.</strong>
      <span>Thêm ${missing || 'cấu hình'} trong <code>config.local.js</code>.</span>
    </div>
  `;
}
