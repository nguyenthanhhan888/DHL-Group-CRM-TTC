# TASK 10: Hoàn thiện trang Cài đặt

## Các thay đổi

### 1. Tạo bảng `settings` trong database

- Đã tạo một file migration mới `supabase/migrations/20260725140000_create_settings_table.sql` để tạo bảng `settings`.
- Bảng `settings` được thiết kế theo dạng key-value để lưu trữ các cấu hình hệ thống một cách linh hoạt.
- Các khóa (key) được thêm vào bao gồm:
    - `group_url`
    - `sub_group_url`
    - `recruitment_group_url`
    - `fanpage_url`
    - `zalo_url`
    - `support_phone`
    - `warning_days`
    - `company_info`
    - `business_info`
    - `system_settings`

### 2. Tạo `SettingsService`

- Đã tạo file `src/services/SettingsService.js` để quản lý việc tương tác với bảng `settings`.
- Service này cung cấp hai phương thức chính:
    - `getSettings()`: Lấy tất cả các cài đặt và chuyển đổi thành một object.
    - `updateSettings(settings)`: Cập nhật nhiều cài đặt cùng một lúc bằng `upsert`.
- Đã export `SettingsService` trong `src/services/index.js`.

### 3. Cập nhật `SettingsPage`

- Đã viết lại hoàn toàn file `src/pages/SettingsPage.js`.
- Trang Cài đặt giờ đây là một form cho phép quản trị viên xem và chỉnh sửa các thông số hệ thống.
- Giao diện được chia thành các nhóm logic:
    - Hỗ trợ & Liên kết
    - Cảnh báo & Thông tin
    - Hệ thống
- Trang sử dụng `SettingsService` để tải dữ liệu và lưu thay đổi.
- Cấu trúc component được điều chỉnh để phù hợp với kiến trúc router hiện tại, sử dụng `afterRender` để tải dữ liệu và gắn các event listener.
- Thêm thông báo (Toast) để xác nhận việc cập nhật thành công hay thất bại.
- Các giá trị không bị hardcode và cho phép Admin chỉnh sửa.

## Kết quả

- Hoàn thành trang Cài đặt theo yêu cầu.
- Admin có thể quản lý các cấu hình quan trọng của hệ thống một cách dễ dàng.
- Đảm bảo tính linh hoạt và không hardcode các giá trị.
