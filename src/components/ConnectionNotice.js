import { getSupabaseStatus } from '../supabase/client.js';

export function ConnectionNotice() {
  const status = getSupabaseStatus();
  if (status.configured) {
    return `
      <div class="notice success">
        <strong>Hệ thống hoạt động bình thường</strong>
        <span>Kết nối dữ liệu đã sẵn sàng.</span>
      </div>
    `;
  }

  const diagnostics = [
    !status.hasSdk ? 'Giao diện chưa tải được mô-đun kết nối dữ liệu.' : '',
    !status.hasUrl || !status.hasAnonKey ? 'Thiếu cấu hình kết nối dữ liệu.' : '',
  ].filter(Boolean);

  return `
    <div class="notice warning">
      <strong>Không thể kết nối dữ liệu</strong>
      <span>${diagnostics.join(' ') || 'Kiểm tra kết nối hoặc liên hệ người phụ trách kỹ thuật.'}</span>
    </div>
  `;
}
