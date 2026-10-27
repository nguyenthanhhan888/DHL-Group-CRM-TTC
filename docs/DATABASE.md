# Database, RPC và phân quyền

Tài liệu này mô tả schema có bằng chứng trong chuỗi migration, source và tests của repository. Trong đợt chuẩn hóa này không kết nối hay đọc schema/dữ liệu Production; vì vậy tính đồng bộ Production phải được xác minh riêng bằng Supabase CLI trước khi triển khai migration.

## Nguồn sự thật và nguyên tắc

- `supabase/migrations/` là lịch sử thay đổi schema, function, trigger, view, RLS và quyền thực thi.
- Source mới hơn có thể thay thế function/policy do migration cũ tạo. Phải đọc theo thứ tự timestamp, không chọn một migration cũ làm schema cuối.
- Không sửa hoặc xóa migration đã áp dụng. Mọi thay đổi database phải là migration mới.
- Frontend không được cấp service-role key. Các thao tác đặc quyền đi qua RPC `security definer`, Vercel API hoặc Edge Function có kiểm tra xác thực/quyền.

## Mô hình dữ liệu chính

### Khách hàng, kiosk và danh mục

- `customers`: hồ sơ khách hàng và thông tin liên hệ.
- `kiosks`: kiosk thuộc một customer; lưu định danh Facebook, loại hình/danh mục và các mốc dịch vụ.
- `categories`, `business_types`: dữ liệu phân loại và cấu hình phục vụ đăng ký/kiosk.
- `settings`: cấu hình nghiệp vụ, gồm các giá trị được dùng để tính cảnh báo trạng thái.

Quan hệ cốt lõi là customer một-nhiều kiosk. Trạng thái hiển thị không chỉ dựa vào một cột text; các function/view chuẩn hóa kết hợp trạng thái lưu, ngày kết thúc và lifecycle đăng ký.

### `registration_requests`

Yêu cầu đăng ký liên kết luồng công khai/Legacy/admin với customer, kiosk, payment hoặc batch tùy loại. Các mốc audit của contract hiện hành gồm `submitted_at`, `reviewed_at`; schema contract không định nghĩa `updated_at` cho bảng này. Các migration hotfix sửa những function lịch sử từng ghi nhầm cột, không thêm cột mới vào bảng.

### Đăng ký theo batch và thanh toán

- `registration_batches`: nhóm một lần đăng ký công khai.
- `registration_batch_items`: các kiosk/yêu cầu thuộc batch.
- `payments`: giao dịch đăng ký, gia hạn, điều chỉnh và trạng thái xác nhận.
- `payos_orders`: ý định/đơn PayOS, khóa idempotency, trạng thái xử lý và liên kết nghiệp vụ.
- `payos_webhook_events`: bằng chứng nhận/xử lý webhook để chống lặp và audit.

Các bảng trên cùng trigger/RPC chịu trách nhiệm giữ tính nguyên tử giữa hồ sơ đăng ký, payment, kỳ dịch vụ và kết quả PayOS.

### Khuyến mãi

- `promotions`: định nghĩa khuyến mãi và điều kiện hiệu lực.
- `promotion_categories`, `promotion_business_types`: phạm vi áp dụng.
- `promotion_usages`: lượt sử dụng đã hoàn tất.

Payment/batch giữ snapshot cần thiết để lịch sử không thay đổi khi cấu hình khuyến mãi về sau được chỉnh sửa.

### Người dùng và quyền

- `user_profiles`: trạng thái tài khoản ứng dụng, cờ truy cập web và cờ System Admin.
- `app_permissions`: catalog quyền CRM hiện hành.
- `user_permissions`: quyền trực tiếp theo người dùng.
- `user_facebook_accounts`, `customer_user_links`: liên kết tài khoản với định danh Facebook/khách hàng theo luồng tương ứng.
- `user_roles`, `role_permissions`: cấu trúc Legacy được giữ cho tương thích lịch sử; không phải mô hình cấp quyền web chính hiện tại.

Catalog hiện hành gồm các quyền module: `dashboard`, `reports`, `customers`, `customer-detail`, `kiosks`, `kiosk-detail`, `legacy-registration`, `payments`, `payment-detail`, `expenses`, `employees`, `homepage-content`, `sources`, `categories`, `business-types`, `registration-requests`, `work-items`, `notifications`, `user-management`, `logs`, `settings`.

### Nhân sự, chi phí và công việc

- `employees`: hồ sơ nhân sự độc lập với tài khoản Auth.
- `expense_categories`, `expenses`: danh mục và giao dịch chi phí, có thể liên kết employee.
- `crm_work_items`: công việc CRM và thông tin phân công.

Các luồng lifecycle giữ lịch sử khi nhân sự nghỉ việc/lưu trữ và khi liên kết website thay đổi.

### Nội dung, thông báo và audit

- `homepage_content`, `featured_businesses`: nội dung trang công khai.
- `crm_notifications`, `crm_notification_reads`: thông báo và trạng thái đã đọc.
- `audit_logs`: audit có cấu trúc cho thao tác nhạy cảm.
- `logs`: bảng log Legacy còn được source/migration tương thích sử dụng.
- Storage bucket `homepage-assets`: tài sản cho nội dung trang chủ, chịu policy riêng.

## View và function quan trọng

### Trạng thái kiosk

- `kiosk_lifecycle`: biểu diễn vòng đời đăng ký/thanh toán của kiosk.
- `registered_kiosks`: tập kiosk đã trở thành kiosk kinh doanh.
- `resolve_kiosk_status`: giải quyết trạng thái chuẩn theo dữ liệu và ngày.
- `get_kiosk_status_data`: nguồn danh sách/trạng thái dùng bởi frontend.

### Doanh thu và báo cáo

- `payment_business_dates`: chuẩn hóa ngày xác nhận và ngày doanh thu theo lịch Việt Nam.
- `get_dashboard_data`: trả KPI dashboard đã tổng hợp ở database.
- `get_reports_data_filtered`: trả dữ liệu báo cáo theo bộ lọc.
- `get_current_financial_kpis`: các KPI tài chính hiện hành.

Doanh thu dựa trên payment completed có `confirmed_at` và `total_amount`; view/function hiện hành loại những allocation Legacy không phải doanh thu để tránh đếm trùng.

### Đăng ký, gia hạn và payment

Các entrypoint được source hiện tại sử dụng gồm:

- `submit_public_registration`, `submit_public_legacy_registration`, `submit_legacy_registration`.
- `admin_create_existing_customer_kiosk`.
- Các RPC list/review/approve/reject/complete/cancel registration request.
- `create_renewal_payment`, `admin_manual_renew_kiosk`, các RPC chuẩn bị/hoàn tất gia hạn công khai.
- RPC preview/evaluate promotion.
- RPC cập nhật payment pending, xác nhận, hủy, từ chối và tạo adjustment.
- `correct_historical_payment` cho ngoại lệ sửa lịch sử có audit.

Tên/signature chi tiết có thể được thay thế qua migration; khi gọi hoặc thay đổi phải kiểm tra migration cuối cùng định nghĩa function đó.

### Xác thực và quyền

- `get_my_access_profile`: trả profile và quyền hiệu lực cho phiên hiện tại.
- `has_user_permission`: kiểm tra quyền module.
- `is_system_admin`: kiểm tra cờ System Admin.

Các function/RPC nghiệp vụ tiếp tục kiểm tra trạng thái active, cờ web access và quyền cần thiết. System Admin chỉ bypass theo contract cụ thể; không nên suy ra rằng mọi `security definer` đều công khai.

## RLS và bề mặt công khai

- Các bảng nghiệp vụ sử dụng RLS và quyền thực thi RPC để giới hạn truy cập.
- Quyền xem/sửa CRM không dựa riêng vào router hoặc UI.
- Anonymous không được đọc trực tiếp dữ liệu CRM rộng. Luồng công khai đi qua RPC/API đã xác thực input và chỉ trả dữ liệu cần thiết.
- PayOS webhook và thao tác service-role chạy server-side; key đặc quyền không được đưa xuống browser.
- Khi thêm bảng/function mới, cần kiểm tra đồng thời RLS, grants, `search_path`, quyền execute và cách xác thực caller.

## Phần Legacy được giữ lại

Migration `20261003231601_remove_ttc_crm_surface.sql` loại bỏ bề mặt TTC đang hoạt động, gồm các bảng/RPC/quyền TTC được liệt kê trong migration. Một số cấu trúc lịch sử như `wallets`, `wallet_ledger`, role cũ hoặc helper có tên Legacy vẫn được giữ vì còn giá trị tương thích/audit. Tên cũ không đồng nghĩa tính năng TTC còn hoạt động và không được tự xóa nếu chưa phân tích dependency.

## Xác minh schema khi triển khai

Trước khi đưa migration mới lên môi trường đích:

1. Kiểm tra đúng Supabase project đã link.
2. So sánh migration local/remote bằng `npx supabase migration list`.
3. Review SQL và chạy test trên môi trường không phải Production trước.
4. Chỉ chạy `npx supabase db push` sau khi xác nhận danh sách migration cần áp dụng.
5. Sau triển khai, smoke-test RLS/RPC với các nhóm quyền liên quan và đối chiếu migration list lần nữa.

Không dùng SQL dump hoặc dữ liệu khách hàng làm nội dung tài liệu này.
