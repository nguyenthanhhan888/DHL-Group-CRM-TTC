# Payment lifecycle — Prompt 1

Ngày chốt code: 11/09/2026. Tài liệu này mô tả thay đổi cục bộ; chưa migration, deploy hoặc push lên production.

## Root cause đã xác nhận

- Đăng ký công khai materialize `customers` và `kiosks` trước khi PayOS xác nhận. Các màn hình chính đọc trực tiếp `kiosks`, nên hồ sơ chưa trả tiền hoặc đã hủy vẫn bị xem là Kiosk hợp lệ.
- Renewal chưa dùng promotion engine hiện có. Payment pending đã được khóa theo intent nhưng luồng tạo lại QR và bằng chứng webhook chưa xử lý đầy đủ trường hợp nhiều PayOS order cùng trỏ về một payment.
- Dashboard và report dùng thời điểm/ngưỡng timezone khác nhau; màn Payment hiển thị `created_at` theo timezone trình duyệt. Khoản xác nhận lúc 01:09 giờ Việt Nam có thể hiển thị là 31:08 ở Berlin. Source of truth mới là payment `completed`, có `confirmed_at`, với ngày lịch `Asia/Ho_Chi_Minh` và khoảng `[from, to + 1 ngày)`.
- Trigger audit ghi cả update kỹ thuật/no-op và các lần đồng bộ totals, tạo nhiều log cho một thao tác nghiệp vụ.

## Hành vi sau thay đổi

- `registered_kiosks` là read model cho danh sách, dashboard và report. Record tương thích vẫn được giữ trong DB, nhưng unpaid/cancelled không vào số liệu nghiệp vụ.
- Regenerate giữ nguyên registration request, customer, kiosk, payment/renewal intent; chỉ tạo PayOS order mới khi lần cũ đã hết hiệu lực theo UI/provider.
- Hết hạn checkout không làm mất khả năng nhận tiền của order cũ. Không gọi cancel PayOS chỉ vì QR hết hạn. Webhook đúng mapping của bất kỳ order nào có thể hoàn tất payment pending đầu tiên.
- Payment được khóa trước khi áp dụng nghiệp vụ. Lần nhận tiền đầu tiên hoàn tất activation/renewal/revenue đúng một lần. Một reference/order khác nhận tiền sau đó được giữ trong `payos_webhook_events`, đánh dấu `payos_orders.reconciliation_required`, và tạo business log `payment_review_required`; hệ thống không áp dụng effect lần hai.
- Renewal công khai, PayOS trong CRM và xác nhận thủ công của Admin dùng chung promotion evaluator và `promotion_usages`. Snapshot ưu đãi và bonus months được khóa trên payment.
- Payment list, dashboard, reports, monthly chart, summary RPC và CSV cùng dùng `confirmed_at` theo giờ Việt Nam cho doanh thu. CSV tải toàn bộ tập dữ liệu theo filter và dừng nếu snapshot thay đổi trong lúc phân trang.
- Default Logs chỉ trả business events và nhóm hoạt động dễ hiểu. Actor/data-group/technical changes nằm trong bộ lọc nâng cao; raw technical audit vẫn được giữ.

## Đối soát giao dịch thứ hai

Admin tìm business log `payment_review_required`, sau đó đối chiếu `payos_orders` và `payos_webhook_events` theo `order_code`, `payment_link_id`, `reference`, `amount` và payload đã lưu. Không dùng lại webhook để tự gia hạn/activate. Hoàn tiền hoặc xử lý kế toán là quyết định thủ công ngoài migration này.

## Triển khai thủ công sau khi review

1. Backup database và áp dụng migration `20260911074545_payment_lifecycle_revenue_business_logs.sql` trên staging.
2. Chạy smoke test qua PostgREST/RLS bằng tài khoản public, staff và service role; kiểm tra schema cache đã reload.
3. Test PayOS sandbox/staging cho regenerate và cả hai thứ tự QR cũ/mới; xác nhận giao dịch thứ hai xuất hiện trong hàng đối soát.
4. So sánh một khoảng ngày giờ Việt Nam giữa Dashboard, Reports, Payments và CSV.
5. Chỉ sau khi duyệt staging mới tự thực hiện `supabase db push` và deploy theo quy trình production của dự án.

## Giới hạn xác minh cục bộ

Postgres integration tests chạy trên PGlite với schema-only fixture, không chứa dữ liệu production. Chúng kiểm tra function/trigger/transaction thật nhưng chưa thay thế smoke test PostgREST RLS và PayOS sandbox. Không có thay đổi tự động nào đối với dữ liệu lịch sử hoặc giao dịch cần đối soát hiện có.
