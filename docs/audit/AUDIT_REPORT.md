# Báo cáo Kiểm tra Toàn diện Dự án Kiosk CRM - V2

- **Ngày tạo:** 25/07/2026
- **Người thực hiện:** Gemini (Senior Full Stack, QA, Security, BA)
- **Phiên bản:** 2.0

## 1. Tóm tắt Điều hành (Executive Summary)

Báo cáo này là kết quả của một cuộc kiểm tra toàn diện (audit) mã nguồn, cơ sở dữ liệu, và logic nghiệp vụ của dự án Kiosk CRM. Nhìn chung, dự án có một nền tảng tốt, mã nguồn phía client được tổ chức tương đối rõ ràng theo component, page, và service. Tuy nhiên, có nhiều vấn đề nghiêm trọng cần được giải quyết ở cả tầng nghiệp vụ, bảo mật, và dữ liệu để hệ thống có thể hoạt động ổn định và an toàn.

**Các điểm chính:**

*   **Điểm mạnh:**
    *   Cấu trúc thư mục frontend rõ ràng, dễ điều hướng.
    *   Sử dụng vanilla JS, không có sự phức tạp từ framework lớn, dễ tiếp cận.
    *   Tận dụng tốt các tính năng của Supabase (RPC, policies).
    *   Có sự tách biệt giữa tầng giao diện, dịch vụ và router.

*   **Điểm yếu và Rủi ro cao:**
    *   **Bảo mật:** Không có Row Level Security (RLS) trên hầu hết các bảng quan trọng, cho phép bất kỳ ai có `anon_key` đều có thể đọc/ghi dữ liệu. `service_role_key` bị lộ trong Edge Function.
    *   **Logic nghiệp vụ:** Nhiều logic quan trọng (tính toán, cập nhật trạng thái) được xử lý ở phía client, dẫn đến không nhất quán và dễ bị thao túng.
    *   **Thiếu sót chức năng:** Nhiều luồng nghiệp vụ còn sơ sài hoặc chưa hoàn thiện (ví dụ: dashboard, báo cáo, quản lý nhân viên).
    *   **Trùng lặp code:** Có sự lặp lại đáng kể trong việc truy vấn và xử lý dữ liệu ở các services và pages.
    *   **Thiếu Test:** Không có bất kỳ test tự động nào (unit test, integration test), làm tăng rủi ro khi thay đổi code.

**Ước tính hoàn thành toàn dự án (sau khi audit sâu): ~65%**. Nền tảng tốt, nhưng các vấn đề về nghiệp vụ và dữ liệu cần được giải quyết triệt để trước khi có thể coi là hoàn thiện.

---

## 2. Phân tích Chi tiết

### 2.1. Kiểm tra theo Chức năng

#### Dashboard
*   **Hiện trạng:** Trang dashboard (`DashboardPage.js`) hiển thị các chỉ số tổng quan (khách hàng, kiosk, doanh thu) và các danh sách (kiosk sắp hết hạn, khách hàng gần đây).
*   **Vấn đề:**
    *   **Query không hiệu quả:** `DashboardService.js` thực hiện nhiều truy vấn `count` riêng lẻ thay vì gộp lại thành một RPC duy nhất, làm tăng độ trễ.
    *   **Logic tính toán phía client:** Việc tính toán doanh thu tháng/năm (`sumPaymentRevenue`, `buildMonthlyRevenueSeries`) được thực hiện ở client, có thể không chính xác nếu dữ liệu bị phân trang hoặc có lỗi.
    *   **UI chưa hoàn thiện:** Các biểu đồ (`DashboardCharts.js`) không có các trạng thái lỗi hoặc loading chi tiết. Nếu một truy vấn thất bại, toàn bộ dashboard sẽ bị ảnh hưởng.

#### Reports
*   **Hiện trạng:** Trang báo cáo (`ReportsPage.js`) cho phép xem theo nhiều tab (Tổng quan, Doanh thu, Kiosk, Đối soát) và lọc theo ngày, danh mục.
*   **Vấn đề:**
    *   **Query tất cả dữ liệu:** `ReportService.js` (`fetchReportRows`) lấy tới `20,000` dòng dữ liệu từ các bảng `payments` và `kiosks` về client để xử lý. **Đây là một vấn đề nghiêm trọng về hiệu năng và chi phí**, có thể làm treo trình duyệt và tiêu tốn tài nguyên Supabase.
    *   **Logic báo cáo ở client:** Toàn bộ logic tổng hợp, tính toán, và phân loại báo cáo nằm ở client. Điều này nên được chuyển xuống database (dùng RPC function hoặc materialized view) để đảm bảo hiệu năng và tính nhất quán.
    *   **Chức năng xuất CSV:** Chức năng `exportCurrentReport` xử lý dữ liệu lớn ở client, có thể gây treo trình duyệt.

#### Customers
*   **Hiện trạng:** Quản lý khách hàng (`CustomersPage.js`, `CustomerDetailPage.js`) với các chức năng tìm kiếm, lọc, thêm, sửa.
*   **Vấn đề:**
    *   **Query phức tạp ở client:** Logic tìm kiếm (`findCustomerIdsByKioskState`) và ghép các điều kiện `OR` trong `CustomerService.js` khá phức tạp và có thể được đơn giản hóa bằng một RPC function.
    *   **Cập nhật `total_kiosks` và `total_paid`:** Các trường này trên bảng `customers` có vẻ như được dự định để cache, nhưng không có trigger hoặc logic đồng bộ nào để đảm bảo chúng luôn đúng. Dữ liệu này có thể bị sai lệch.

#### Kiosks
*   **Hiện trạng:** Quản lý các kiosk (`KiosksPage.js`, `KioskDetailPage.js`), hiển thị dưới dạng thẻ (card view).
*   **Vấn đề:**
    *   **Trạng thái "động":** Trạng thái `warning` và `expired` của kiosk được tính toán ở client (`applyStatusFilter`, `deriveKioskStatus`). Logic này nên được xử lý ở tầng database để có thể truy vấn hiệu quả.
    *   **Thiếu bộ lọc quan trọng:** Thiếu khả năng lọc kiosk theo khách hàng.

#### Payments
*   **Hiện trạng:** Trang thanh toán (`PaymentsPage.js`) cho phép xem, tìm kiếm và xác nhận thanh toán.
*   **Vấn đề:**
    *   **Logic xác nhận thanh toán:** `PaymentService.confirm` gọi RPC `confirm_payment`. Đây là một điểm tốt. Tuy nhiên, function `private.complete_payment` trong migration `20260722150752` sử dụng `(now() at time zone 'Asia/Ho_Chi_Minh')::date`, điều này đúng nhưng nên được chuẩn hóa trong toàn bộ dự án.
    *   **Query summary:** `listWithSummary` thực hiện 2 truy vấn song song (một cho danh sách, một cho summary). Điều này có thể dẫn đến việc summary không khớp với danh sách nếu có bộ lọc phức tạp. Nên gộp lại bằng RPC.

#### Categories & Business Types
*   **Hiện trạng:** Quản lý danh mục và loại hình kinh doanh (`CategoriesPage.js`, `BusinessTypesPage.js`).
*   **Vấn đề:**
    *   **Xóa mềm/cứng:** `CategoryService.remove` thực hiện xóa cứng (`delete`), trong khi `BusinessTypeService.remove` thực hiện xóa mềm (`setActive(false)`). Luồng xóa không nhất quán.
    *   **Ràng buộc logic:** `ensureCategoryHasNoBusinessTypes` kiểm tra ràng buộc ở phía client trước khi xóa. Điều này nên được xử lý bởi foreign key constraint trong database để đảm bảo toàn vẹn dữ liệu.

#### Registration & Approval
*   **Hiện trạng:** Có 2 luồng đăng ký:
    1.  **Public:** `RegisterPage.js` cho khách hàng tự đăng ký, tạo ra bản ghi ở `registration_requests`.
    2.  **Admin:** `LegacyRegistrationPage.js` và `KioskForm.js` (thêm kiosk cho khách hàng có sẵn) cho admin tự nhập.
*   **Vấn đề:**
    *   **Logic phức tạp ở client:** `LegacyRegistrationService` và `RegistrationService.submitExistingCustomerKiosk` chứa logic tạo nhiều bản ghi (`customers`, `kiosks`, `payments`) tuần tự. Nếu một bước thất bại, có thể để lại dữ liệu "mồ côi". Toàn bộ logic này nên được gói gọn trong một RPC function duy nhất để đảm bảo tính toàn vẹn (transaction).
    *   **RPC `submit_registration_request`:** Function này chỉ tạo bản ghi ở `registration_requests`, logic còn lại vẫn nằm ở client.
    *   **Luồng duyệt:** `RegistrationRequestsPage.js` gọi RPC `approve_registration_request` và `reject_registration_request`. Đây là một điểm tốt, nhưng cần kiểm tra kỹ logic bên trong các function này.

#### Staff
*   **Hiện trạng:** Trang quản lý nhân viên (`StaffPage.js`) cho phép admin tạo, sửa, khóa, xóa tài khoản `reviewer`.
*   **Vấn đề:**
    *   **Bảo mật Edge Function:** `supabase/functions/manage-staff/index.ts` sử dụng `service_role_key` được lấy từ biến môi trường. Điều này là một **lỗ hổng bảo mật nghiêm trọng** vì `service_role_key` có thể bỏ qua mọi RLS. Lẽ ra nên sử dụng một client với quyền hạn giới hạn hơn.
    *   **Logic phân quyền:** Logic kiểm tra `profile?.role !== 'admin'` nằm trong chính Edge Function, nhưng nó nên được thực thi với quyền của người dùng đã xác thực, không phải `service_role`.

#### Logs
*   **Hiện trạng:** `LogsPage.js` hiển thị lịch sử thay đổi từ bảng `logs`.
*   **Vén đề:** Bảng `logs` có vẻ được ghi lại bởi các trigger (`audit.enable_tracking`). Cần kiểm tra xem tất cả các bảng quan trọng đã được bật tracking chưa. `private.complete_payment` tự ghi log, có thể gây không nhất quán.

#### Settings
*   **Hiện trạng:** Trang `SettingsPage.js` chỉ hiển thị thông tin cấu hình, không có chức năng thay đổi.

### 2.2. Kiểm tra theo Kỹ thuật

| Mục | Phát hiện | Mức độ | Ghi chú |
| --- | --- | --- | --- |
| **Route** | Cấu trúc router (`router/index.js`) đơn giản, dễ hiểu, dựa trên hash. | Tốt | Hoạt động tốt cho một SPA đơn giản. |
| **Query** | Các services (`src/services/*`) chứa nhiều logic query phức tạp, lặp lại. Nhiều query không hiệu quả (N+1, lấy thừa dữ liệu). | **Cao** | Cần tái cấu trúc mạnh mẽ, chuyển logic phức tạp sang RPC. |
| **RPC** | Đã sử dụng RPC cho các tác vụ quan trọng (confirm payment, approve request). | Tốt | Đây là một pattern tốt, cần được áp dụng cho nhiều chức năng hơn (đăng ký, báo cáo). |
| **Trigger** | Có sử dụng trigger cho audit log. | Tốt | Cần kiểm tra lại function `private.complete_payment` để tránh ghi log thủ công. |
| **Function** | Edge Function `manage-staff` có lỗ hổng bảo mật nghiêm trọng. | **Rất cao** | **Phải sửa ngay lập tức.** Không được dùng `service_role_key`. |
| **RLS** | **Không có RLS trên các bảng chính.** | **Rất cao** | **Lỗ hổng bảo mật nghiêm trọng nhất.** Bất kỳ ai có `anon_key` đều có thể truy cập toàn bộ dữ liệu. |
| **Duplicate Query** | Rất nhiều logic query bị lặp lại giữa các services, đặc biệt là các bộ lọc tìm kiếm và trạng thái. | Trung bình | Gây khó khăn cho việc bảo trì. Nên đóng gói lại thành các hàm dùng chung hoặc RPC. |
| **Security** | `anon_key` và `supabaseUrl` được quản lý trong `config.local.js` và nạp vào `window.DHL_CONFIG`. `anon_key` có thể bị lộ. | **Cao** | Kết hợp với việc thiếu RLS, đây là một rủi ro lớn. |
| **Secret** | `service_role_key` được sử dụng trong Edge Function. | **Rất cao** | **Không bao giờ được sử dụng service role key ở những nơi có thể truy cập từ client.** |
| **TODO** | Không có `TODO` nào đáng kể được tìm thấy trong code. | Thấp | |
| **UI chưa hoàn thiện** | Nhiều trang thiếu trạng thái loading/error chi tiết, xử lý lỗi chung chung. Các form chưa có validation phía client hoàn chỉnh. | Trung bình | Ảnh hưởng đến trải nghiệm người dùng. |
| **`getid.py`** | Script này dùng để lấy Facebook ID từ một dịch vụ bên thứ ba (`traodoisub.com`). Có chứa một `TDS_TOKEN` hard-coded. | **Cao** | Token này nên được quản lý như một biến môi trường, không nên commit vào code. Script này không thuộc luồng chính của ứng dụng web. |

---

## 3. Đề xuất và Các bước Tiếp theo

1.  **Ưu tiên hàng đầu (Bảo mật):**
    *   **Triển khai RLS:** Ngay lập tức thêm chính sách Row Level Security cho tất cả các bảng. Mặc định nên là `DENY ALL` và chỉ cho phép truy cập dựa trên vai trò (`admin`, `reviewer`) hoặc `auth.uid()`.
    *   **Sửa Edge Function:** Thay thế `service_role_key` trong `manage-staff` bằng `createClient` với quyền của người dùng đã xác thực. Việc kiểm tra quyền admin nên dựa trên RLS của một bảng `profiles` hoặc tương tự.
    *   **Quản lý `getid.py`:** Di chuyển `TDS_TOKEN` ra khỏi mã nguồn và nạp qua biến môi trường.

2.  **Tái cấu trúc Logic nghiệp vụ:**
    *   **Chuyển logic sang Database:**
        *   Tạo RPC function cho luồng đăng ký (legacy và public) để đảm bảo tính toàn vẹn (transaction).
        *   Tạo RPC function hoặc Materialized View cho trang Reports để xử lý dữ liệu lớn ở phía server.
        *   Tạo các function tính toán (ví dụ `derive_kiosk_status`) trong database để đơn giản hóa query.
    *   **Đồng bộ hóa dữ liệu:** Sử dụng database trigger để tự động cập nhật các trường cache như `customers.total_kiosks` và `customers.total_paid` khi có thay đổi ở bảng `kiosks` hoặc `payments`.

3.  **Cải thiện Hiệu năng:**
    *   Gộp các truy vấn `count` ở Dashboard thành một RPC duy nhất.
    *   Sử dụng `EXPLAIN` để phân tích các query phức tạp và thêm index nếu cần thiết (đặc biệt cho các cột foreign key và các cột được lọc thường xuyên).

4.  **Hoàn thiện Giao diện người dùng:**
    *   Thêm các trạng thái loading và error chi tiết cho từng component.
    *   Cải thiện validation cho các form.

5.  **Quy trình Phát triển:**
    *   Thiết lập một bộ test tự động (ví dụ dùng Vitest hoặc Jest) để kiểm tra các service và logic nghiệp vụ quan trọng.
    - Duy trì tài liệu `OWNER_DECISIONS_REQUIRED.md` để làm rõ các yêu cầu nghiệp vụ chưa xác định.
