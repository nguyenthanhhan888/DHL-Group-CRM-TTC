# Báo cáo trang bổ sung thông tin khách hàng cũ

## Route công khai và xác thực

- Route: `#/legacy-registration`.
- `src/app.js` xử lý route này bằng public shell trước bước kiểm tra hồ sơ/quyền, cho cả khách chưa đăng nhập và người đang đăng nhập.
- Route không dùng `AuthService` để bảo vệ, không chuyển sang `#/login`, và dùng cùng public layout với `#/register`.

## Nội dung và Settings

- Đã thêm đầy đủ phần giới thiệu/phạm vi sử dụng theo yêu cầu.
- Phần “Thông tin chính thức của hệ thống” dùng các key Settings dùng chung:
  - `official_group_name`
  - `group_url`
  - `sub_group_url`
  - `recruitment_group_url`
  - `fanpage_url`
  - `zalo_url`
  - `support_phone`
- URL được hiển thị dưới dạng liên kết mở tab mới. Giá trị thiếu hiển thị “Đang cập nhật”; không hiển thị `null`/`undefined`.

## Zalo

- Nút chính “Gửi bill qua Zalo” dùng URL trực tiếp từ `zalo_url`.
- Nếu `zalo_url` là số điện thoại, trang tạo liên kết `https://zalo.me/{số}`.
- Nút mở tab mới và hiển thị số Zalo kế bên khi số có trong cấu hình/URL.
- Nút “Sao chép số Zalo” dùng Clipboard API và hiển thị toast thành công.
- Khi thiếu cấu hình, hai thao tác bị vô hiệu hóa và trang hiển thị “Thông tin Zalo hỗ trợ đang được cập nhật.”

## Luồng biểu mẫu

- Mặc định một Kiosk; có lựa chọn một/nhiều Kiosk.
- Luồng một Kiosk hỗ trợ checkbox sao chép tên, URL và Facebook ID từ khách hàng.
- Luồng nhiều Kiosk nhập thông tin liên hệ một lần, thêm/xóa thẻ Kiosk động và luôn yêu cầu ít nhất một Kiosk.
- Mỗi Kiosk có đủ Facebook, ngành hàng, số tiền, ngày đăng ký và ngày hết hạn.
- Không thêm trường upload bill, thời gian gửi bill hoặc mô tả bằng chứng.
- Có checkbox xác nhận gửi bill và checkbox xác nhận thông tin cuối.

## Facebook ID và trùng lặp

- URL Facebook được chuẩn hóa và gọi Edge Function `resolve-facebook-id` hiện có.
- Có trạng thái đang tải/thành công/lỗi; không tạo hoặc giả Facebook ID.
- Facebook ID trùng ngay trong biểu mẫu là lỗi chặn; tên trùng trong biểu mẫu là cảnh báo.
- Trang công khai không đọc trực tiếp bảng Customers/Kiosks, tránh đưa dữ liệu CRM riêng tư về trình duyệt.
- Kiểm tra Facebook ID với dữ liệu CRM phải nằm trong public pending-request API an toàn. API đó chưa tồn tại cho legacy flow và là một phần của tích hợp gửi cuối đang BLOCKED.

## Validation

- Kiểm tra trường bắt buộc, URL Facebook, Facebook ID dạng số, số điện thoại, số tiền không âm, ngày hợp lệ, ngày hết hạn không trước ngày đăng ký, tối thiểu một Kiosk, hai checkbox xác nhận.
- Có khóa chống submit hai lần.
- Khi dữ liệu phía giao diện hợp lệ, trang vẫn ở public route và hướng dẫn gửi thông tin qua Zalo.

## Trạng thái submission

**BLOCKED — chỉ tích hợp gửi cuối:** RPC `submit_legacy_registration` hiện có chỉ được cấp cho vai trò `authenticated` và phục vụ luồng quản trị; không phải public pending-request API. Trang không gọi RPC này, không tạo Active Kiosk, không ghi nhận doanh thu, không tạo Completed Payment và không sửa bản ghi hiện hữu.

Thông báo hiển thị:

> Chức năng gửi trực tuyến đang được hoàn thiện. Vui lòng gửi bill và thông tin qua Zalo hỗ trợ.

Không tạo SQL, migration, RPC hay thay đổi RLS trong task.

## Kiểm thử

- `node --check src/app.js`: đạt.
- `node --check src/pages/LegacyRegistrationPage.js`: đạt.
- `git diff --check`: đạt.
- Kiểm tra tĩnh xác nhận route public được xử lý trước auth và các nội dung/nút bắt buộc có mặt.
- CSS responsive tại breakpoint 640px: form chuyển một cột; thẻ liên hệ, cụm Zalo và header Kiosk xếp dọc; nút Zalo/copy chiếm toàn chiều rộng.
- Browser runtime không có trình duyệt khả dụng trong phiên này, nên chưa thể hoàn tất kiểm thử tương tác/ảnh chụp desktop và mobile. Đây là giới hạn môi trường kiểm thử, không phải backend BLOCKED của tính năng.

## Git diff --stat

Worktree đã có nhiều thay đổi chưa commit từ trước. Stat giới hạn ở ba file mã nguồn liên quan tại thời điểm báo cáo:

```text
 src/app.js                           | 143 ++++++--
 src/pages/LegacyRegistrationPage.js | 632 +++++++++++++++++++++++++++++++-----
 src/styles/app.css                   | 249 +++++++++++++-
 3 files changed, 918 insertions(+), 106 deletions(-)
```

Các số trên bao gồm thay đổi có sẵn trước task trong cùng ba file. Task không commit và không push.
