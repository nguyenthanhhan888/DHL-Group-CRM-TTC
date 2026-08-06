# Báo cáo rà soát và sửa lỗi Kiosk CRM

Ngày kiểm tra: 30/07/2026

## Kết quả chính

Đã xác định đúng lỗi nghiêm trọng ở luồng **Bổ sung khách hàng cũ → Duyệt**:

- RPC `review_public_legacy_registration_request` trước đây chỉ đổi trạng thái yêu cầu sang `approved`.
- RPC không tạo bản ghi `customers`, không tạo bản ghi `kiosks`, và không gán `customer_id`/`kiosk_id` vào yêu cầu.
- Dữ liệu production xác nhận yêu cầu `#7` đã `approved` nhưng `customer_id = NULL` và `kiosk_id = NULL`.

Đã triển khai migration `materialize_legacy_registration_approval` lên Supabase. Luồng duyệt mới chạy trong một transaction:

1. Kiểm tra đăng nhập và quyền `registration-requests`.
2. Khóa yêu cầu và khóa logic theo `request_code` để tránh duyệt đồng thời.
3. Tạo hoặc liên kết đúng customer; các kiosk của cùng một lần gửi nhiều-kiosk dùng chung customer.
4. Tạo kiosk với danh mục, dịch vụ, thời hạn, số tiền và trạng thái tương ứng.
5. Gán `customer_id` và `kiosk_id` vào `registration_requests`.
6. Chỉ chuyển sang `approved` sau khi các bước lưu dữ liệu thành công.
7. Ghi audit log kèm ID customer/kiosk.
8. Cho phép chạy lại an toàn với yêu cầu đã được xử lý hoàn chỉnh.

### Bổ sung sau kiểm thử hồ sơ thực tế

Hồ sơ `#11` dùng link Facebook dạng `/share/...`, nên dịch vụ phân giải không lấy được Facebook ID và form lưu `facebook_id = NULL`. Form/schema đã cho phép trường hợp này nhưng phiên bản đầu của RPC duyệt vẫn bắt buộc ID, gây lỗi “Hồ sơ thiếu dữ liệu bắt buộc để tạo kiosk”. RPC đã được sửa để Facebook ID là tùy chọn; kiosk vẫn được tạo bằng tên và link Facebook, còn unique ID được áp dụng khi có ID.

Đã kiểm thử database bằng đúng dữ liệu hồ sơ `#11`: customer và kiosk được tạo thành công khi Facebook ID là `NULL`, quan hệ `kiosk.customer_id` đúng, sau đó transaction kiểm thử được rollback. Hậu kiểm xác nhận không còn dữ liệu test và hồ sơ `#11` vẫn ở trạng thái `pending` để quản trị viên duyệt thật.

Migration nguồn: `supabase/migrations/20260730120000_materialize_legacy_registration_approval.sql`.

## Sửa giao diện duyệt

- Đổi nút `Xác nhận` thành `Duyệt & lưu` để phản ánh đúng hành vi.
- Sau khi thành công hiển thị rõ customer ID và kiosk ID vừa lưu.
- Với yêu cầu cũ đã `approved` nhưng chưa có liên kết, tab `Đã duyệt` hiển thị nút `Hoàn tất lưu` để quản trị viên phục hồi bằng đúng RPC và đúng quyền đăng nhập.
- Trong lúc xử lý, các nút cùng hàng bị khóa để tránh bấm lặp.

## Rà soát form và button

Đã rà soát mã nguồn của các trang và component:

- Đăng nhập.
- Đăng ký mới.
- Bổ sung khách hàng cũ (một kiosk và nhiều kiosk).
- Duyệt đơn.
- Dashboard và báo cáo.
- Customers và chi tiết customer.
- Kiosks và chi tiết kiosk.
- Payments và chi tiết payment.
- Categories, business types.
- Staff, permissions.
- Settings và logs.
- Các modal tạo/sửa/gia hạn/xóa.

Các form chính đều có submit handler; các button thao tác có click handler hoặc event delegation tương ứng. Toàn bộ file JavaScript trong `src/` đã qua `node --check`, không phát hiện lỗi cú pháp.

## Kiểm thử thực tế

- Local HTTP server tải `index.html` thành công.
- Chrome headless tải và render trang `#/legacy-registration` với cấu hình Supabase thật.
- Dữ liệu danh mục, nội dung cộng đồng và thông tin hỗ trợ được tải và hiển thị.
- Ảnh chụp desktop xác nhận bố cục, typography, card và trạng thái tab hoạt động.
- Đã chạy ảnh chụp viewport mobile và bổ sung các ràng buộc co giãn để tránh nội dung/tab/topbar tràn ngang.
- Đã đối chiếu schema production: `customers`, `kiosks`, `registration_requests` đều bật RLS; khóa ngoại và unique index liên quan tồn tại.
- Migration RPC mới đã được Supabase chấp nhận và triển khai thành công.
- Hậu kiểm quyền RPC: `anon` không có quyền gọi; `authenticated` có quyền gọi nhưng bên trong RPC vẫn kiểm tra user active và quyền nghiệp vụ; `search_path` đã được cố định.

## UI/UX đã chỉnh

- Giới hạn đúng chiều rộng của public shell/content.
- Cho topbar, link đăng nhập và hai tab co giãn, xuống dòng an toàn trên màn hình nhỏ.
- Ngăn text dài và label tab làm rộng toàn trang.
- Giảm padding/font tab trên mobile.
- Giữ bảng dữ liệu cuộn ngang trong `.table-card`, không đẩy rộng page.
- Thông báo duyệt nay mô tả kết quả lưu thật thay vì chỉ tải lại danh sách.
- Khai báo favicon hiện có của dự án để loại bỏ request `/favicon.ico` bị 404.

## Trạng thái dữ liệu cũ cần hoàn tất

Yêu cầu `#7` đang là dữ liệu lịch sử bị duyệt dở. Không tự ý giả mạo phiên admin để sửa production. Quản trị viên đăng nhập, mở:

`Duyệt đơn đăng ký → Đã duyệt → Hoàn tất lưu`

Sau khi bấm, hệ thống sẽ tạo/liên kết customer và kiosk trong một transaction. Có thể xác nhận lại bằng việc mở trang Customers/Kiosks hoặc kiểm tra `customer_id` và `kiosk_id` của yêu cầu.

## File thay đổi trong đợt này

- `src/pages/RegistrationRequestsPage.js`
- `src/styles/app.css`
- `index.html`
- `supabase/migrations/20260730120000_materialize_legacy_registration_approval.sql`
- `reports.md`

## Giới hạn kiểm thử

Không thực hiện tự động thao tác phá hủy hoặc tạo hàng loạt dữ liệu giả trên production. Phiên browser tích hợp không khả dụng; phần render thực tế được kiểm tra bằng Chrome headless. Thao tác phục hồi yêu cầu `#7` cần được thực hiện trong phiên admin hợp lệ như hướng dẫn ở trên.

Supabase Advisor còn báo các cảnh báo tồn tại từ trước, đáng chú ý là policy `task08_authenticated_baseline` quá rộng trên một số bảng, nhiều permissive policy bị chồng lặp, và một số function cũ chưa cố định `search_path`. Không thay đổi hàng loạt các policy này trong đợt sửa luồng duyệt vì có thể làm mất quyền truy cập của các trang đang chạy; nên xử lý bằng một migration bảo mật riêng sau khi lập ma trận quyền cho admin/reviewer.
