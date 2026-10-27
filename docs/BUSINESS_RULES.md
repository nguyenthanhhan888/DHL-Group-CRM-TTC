# Quy tắc nghiệp vụ

Tài liệu này ghi nhận các quy tắc đã được xác nhận bằng source, migrations, tests và quyết định chính thức của chủ dự án. Chi tiết cột, RPC và RLS nằm trong [DATABASE.md](./DATABASE.md).

## Khách hàng và kiosk

### Quy tắc nghiệp vụ đã xác nhận

- Một khách hàng có thể có nhiều kiosk; mỗi kiosk thuộc một khách hàng.
- Facebook ID được kiểm tra trùng trên kiosk hiện có và yêu cầu đăng ký đang chờ. Trùng tên hoặc số điện thoại được dùng để cảnh báo/tra cứu, không được tài liệu hóa như ràng buộc duy nhất ở database.
- Luồng tạo kiosk cho khách hàng hiện có dùng một nghiệp vụ hợp nhất: tạo ý định thanh toán PayOS hoặc ghi nhận thanh toán ngoài đã hoàn tất.
- Source hiện không cung cấp thao tác xóa cứng khách hàng trong `CustomerService`.

### Chi tiết kỹ thuật

- Danh sách và trạng thái kiosk chuẩn được lấy qua `get_kiosk_status_data`; trạng thái động được giải quyết ở database, có dùng số ngày cảnh báo trong settings.
- `kiosk_lifecycle` và `registered_kiosks` tách kiosk kinh doanh đã đăng ký khỏi bản ghi đăng ký chưa thanh toán hoặc đã hủy.
- `find_customer_duplicates` hỗ trợ phát hiện dữ liệu có khả năng trùng; hệ thống không tự hợp nhất khách hàng.

## Các luồng đăng ký

### Đăng ký công khai

- Luồng đăng ký mới hỗ trợ một hoặc nhiều kiosk, loại hình, danh mục, số tháng và khuyến mãi nếu hợp lệ.
- Hệ thống tạo yêu cầu/batch/thanh toán bền vững trước khi chuyển sang PayOS.
- Kiosk chưa thanh toán trong luồng công khai không được tính như kiosk kinh doanh trên dashboard.

### Legacy

- Form Legacy tiếp nhận thông tin kiosk cũ và bằng chứng thanh toán để gửi yêu cầu xem xét.
- Đây là luồng review; form Legacy không tự tạo checkout PayOS.
- Các yêu cầu Legacy hoặc kiosk bổ sung được xử lý bằng RPC review tương ứng, không dùng nguyên trạng quy trình đăng ký mới.

### Admin

- Admin có thể tạo kiosk cho khách hàng hiện có bằng luồng hợp nhất.
- Chế độ PayOS tạo các bản ghi pending có thể tiếp tục xử lý; chế độ đã thanh toán ngoài xác nhận và kích hoạt trong cùng giao dịch.
- Yêu cầu đăng ký mới thông thường có thể được duyệt hoặc từ chối. Việc duyệt hồ sơ và việc xác nhận thanh toán là hai bước riêng: duyệt hồ sơ không tự biến payment pending thành completed.
- Yêu cầu ở trạng thái chờ thanh toán được hoàn tất bởi PayOS hoặc xác nhận thanh toán ngoài; cũng có thể bị hủy theo điều kiện của RPC.

## Thanh toán và PayOS

### Trạng thái và thay đổi

- Payment pending có thể được cập nhật, hủy hoặc từ chối theo quyền và điều kiện hiện hành.
- Payment completed bình thường được bảo vệ khỏi sửa đổi tùy tiện bởi database trigger.
- Điều chỉnh tài chính được ghi thành bản ghi adjustment riêng.
- Ngoại lệ sửa lịch sử `correct_historical_payment` được chính thức giữ lại và chỉ System Admin được sử dụng. RPC chỉ cho phép sửa `start_date`, `end_date`, `months` và `total_amount` của payment completed; lý do là bắt buộc, các điều kiện dữ liệu phải hợp lệ, và cập nhật cùng audit diễn ra trong một giao dịch. Thao tác không được rút ngắn kiosk qua kỳ của payment/batch completed mới hơn.

### PayOS

- Webhook PayOS phải qua kiểm tra chữ ký và được xử lý idempotent.
- Endpoint kiểm tra trạng thái chỉ đọc trạng thái; polling không tự kích hoạt dịch vụ.
- Xử lý webhook có kiểm tra các trường hợp thanh toán muộn, webhook lặp và ý định thanh toán đã bị thay thế.
- Source frontend không giữ PayOS secret; các secret chỉ tồn tại ở môi trường server-side.

## Gia hạn và thời hạn dịch vụ

### Quy tắc đã xác nhận trong code

- Gia hạn công khai bắt đầu bằng tra cứu số điện thoại và token gia hạn có chữ ký.
- Luồng công khai chỉ nhận số tháng `1`, `3`, `6` hoặc `12`.
- Nếu kiosk còn hiệu lực, sắp hết hạn hoặc hết hạn trong ngày xác nhận, kỳ mới bắt đầu sau `end_date` hiện tại. Nếu đã hết hạn, kỳ mới bắt đầu từ ngày xác nhận.
- `end_date` là ngày cuối cùng được sử dụng: ngày kết thúc bằng ngày bắt đầu cộng tổng số tháng dịch vụ rồi trừ một ngày.
- Tháng thưởng kéo dài dịch vụ nhưng không làm tăng số tiền thanh toán.
- `kiosks.start_date` chính thức là ngày bắt đầu gốc của kiosk. Gia hạn giữ nguyên trường này và cập nhật `end_date` theo kỳ dịch vụ mới.
- Gia hạn thủ công của admin và gia hạn PayOS là hai luồng riêng. Thao tác gia hạn thủ công nhạy cảm yêu cầu System Admin.
- Gia hạn công khai qua PayOS được tự động hoàn tất khi webhook hợp lệ đã qua kiểm tra chữ ký và điều kiện nghiệp vụ; không cần Admin duyệt thêm.

## Khuyến mãi và tháng thưởng

- Cùng một promotion engine được dùng để đánh giá điều kiện đăng ký và gia hạn.
- Giảm giá làm thay đổi số tiền; tháng thưởng làm tăng `effective_service_months` nhưng không làm tăng `total_amount`.
- Snapshot khuyến mãi được lưu cùng giao dịch để lịch sử không thay đổi khi cấu hình khuyến mãi về sau được chỉnh sửa.
- Lượt sử dụng khuyến mãi chỉ được ghi một lần khi thanh toán hoàn tất.

## Doanh thu và ngày nghiệp vụ

### Quy tắc nghiệp vụ

- Chỉ payment có trạng thái completed và có `confirmed_at` mới tạo doanh thu.
- Ngày doanh thu là ngày lịch Việt Nam của `confirmed_at`, không phải `start_date` hoặc `created_at`.
- Dashboard và báo cáo cộng `total_amount` theo nguồn dữ liệu chuẩn; không dùng trường `final_amount` trong tài liệu cũ.
- Các allocation/adjustment Legacy không đại diện doanh thu được loại khỏi tập doanh thu chuẩn để tránh tính trùng.

### Chi tiết kỹ thuật

- `payment_business_dates` cung cấp ngày nghiệp vụ chuẩn.
- `get_dashboard_data`, `get_reports_data_filtered` và các RPC KPI thực hiện lọc/tổng hợp tại database.
- Bộ lọc ngày dùng múi giờ `Asia/Ho_Chi_Minh` để không lệch ngày khi Vercel hoặc database chạy ở múi giờ khác.

## Phân quyền CRM

- Người dùng website chỉ vào được hệ thống khi profile đang active và `web_access_enabled = true`.
- System Admin được bypass quyền module; người dùng khác cần quyền trực tiếp trong `user_permissions` tương ứng với catalog active của `app_permissions`.
- Route cá nhân cần tài khoản hợp lệ nhưng không đòi một quyền CRM riêng cho từng trang.
- `staff` và `permissions` là alias tương thích của trang `user-management`.
- Khuyến mãi và một số thao tác sửa chữa tài chính nhạy cảm chỉ dành cho System Admin, kể cả khi người dùng khác có nhiều quyền module.
- RLS/RPC/API kiểm tra quyền ở backend. Việc ẩn nút hoặc route ở frontend không phải là biện pháp phân quyền duy nhất.

## Employees, chi phí và công việc

- Employee là hồ sơ nhân sự nghiệp vụ, không đồng nghĩa với tài khoản đăng nhập website.
- Tài khoản website có thể được liên kết hoặc hủy liên kết với employee mà không xóa hồ sơ nhân sự.
- Quyền `employees` và `expenses` độc lập.
- Chi phí có thể liên kết employee hoặc để trống; snapshot lịch sử được giữ khi trạng thái nhân sự thay đổi.
- Vòng đời nhân sự dùng các thao tác nghỉ việc, kích hoạt lại, lưu trữ và khôi phục; source không coi xóa hồ sơ là luồng chuẩn.
- Công việc CRM có thể giao cho employee, kể cả employee không có tài khoản website, đồng thời giữ khả năng tương thích với dữ liệu người nhận cũ.

## Các giới hạn cần nhớ

- Tài liệu không xác nhận dữ liệu Production thực tế; nó mô tả contract trong repository.
- Không suy diễn chính sách mới từ UI. Khi cần thay đổi quy tắc, phải có quyết định nghiệp vụ rồi mới thay source/migration bằng quy trình riêng.
