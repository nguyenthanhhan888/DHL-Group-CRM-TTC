# Quy tắc Nghiệp vụ Chính thức (Official Business Rules) - Kiosk CRM

- **Ngày tạo:** 25/07/2026
- **Phiên bản:** 1.0
- **Mục đích:** Tài liệu này là nguồn chân lý (single source of truth) cho tất cả các quy tắc nghiệp vụ của hệ thống Kiosk CRM. Tất cả các tính năng, mã nguồn, và thay đổi trong tương lai phải tuân thủ các quy tắc được định nghĩa dưới đây.

---

## 1. Quy tắc Doanh thu (Revenue Rules)

1.  **Ghi nhận Doanh thu:** Doanh thu chỉ được ghi nhận khi một thanh toán được xác nhận (`payment.status = 'Completed'`).
2.  **Ngày ghi nhận Doanh thu:** Ngày ghi nhận doanh thu luôn là `confirmed_at` (ngày thanh toán được xác nhận).
3.  **Nguồn tính Doanh thu:** Tất cả các báo cáo, dashboard, và thống kê tài chính phải tính toán doanh thu dựa trên tổng `final_amount` của các thanh toán đã hoàn thành, được nhóm theo `confirmed_at`.
4.  **Phân biệt với Kỳ hạn Dịch vụ:** `start_date` và `end_date` chỉ dùng để xác định kỳ hạn dịch vụ của Kiosk và không bao giờ được sử dụng để tính toán doanh thu tài chính.
5.  **Báo cáo Tương lai:** Trong tương lai, hệ thống có thể cung cấp hai loại báo cáo độc lập: "Báo cáo Doanh thu Tài chính" (dựa trên `confirmed_at`) và "Báo cáo Kích hoạt Dịch vụ" (dựa trên `start_date`), nhưng chúng không bao giờ được trộn lẫn. Báo cáo mặc định luôn là Báo cáo Doanh thu Tài chính.

---

## 2. Quy tắc Thanh toán (Payment Rules)

1.  **Thanh toán Bất biến:** Các bản ghi thanh toán đã hoàn thành (`Completed`) được coi là các bản ghi tài chính bất biến.
2.  **Cấm Sửa đổi Tài chính:** Các trường tài chính của thanh toán đã hoàn thành (số tiền, chiết khấu, ngày tháng, ID khách hàng/Kiosk) không bao giờ được sửa đổi trực tiếp.
3.  **Cho phép Sửa đổi Phi tài chính:** Admin có thể sửa đổi các thông tin phi tài chính như ghi chú, mô tả nội bộ, mã tham chiếu.
4.  **Xử lý Sai sót:**
    *   Nếu một thanh toán đã hoàn thành bị sai, không được sửa hoặc xóa bản ghi gốc.
    *   Phải tạo một **giao dịch điều chỉnh hoặc đảo ngược** riêng biệt.
    *   Giao dịch điều chỉnh phải tham chiếu đến thanh toán gốc, ghi lại lý do bắt buộc, và được ghi log kiểm toán đầy đủ.
    *   Giao dịch điều chỉnh phải tự động tính toán và cập nhật lại kỳ hạn Kiosk và các giá trị tổng hợp (`total_paid`) trong cùng một giao dịch database.
5.  **Cấm Xóa cứng:** Xóa cứng (`hard delete`) thanh toán ở bất kỳ trạng thái nào đều bị cấm vĩnh viễn.
6.  **Thanh toán đang chờ (Pending):** Các thanh toán đang chờ có thể được sửa đổi, từ chối, hoặc hủy bỏ trước khi được xác nhận.
7.  **Tác động của Trạng thái:** Chỉ các thanh toán `Completed` mới ảnh hưởng đến doanh thu, `total_paid` của khách hàng và kích hoạt/gia hạn Kiosk. Các trạng thái khác (`Pending`, `Rejected`, `Cancelled`) không có tác động tài chính.

---

## 3. Quy tắc Khách hàng (Customer Rules)

1.  **Tạo Khách hàng:** Một Khách hàng phải luôn được tạo trước, sau đó mới tạo một hoặc nhiều Kiosk thuộc về khách hàng đó. Một Kiosk không thể tồn tại mà không có Khách hàng.
2.  **Định danh và Trùng lặp:**
    *   Số điện thoại không phải là định danh duy nhất và chỉ nên hiển thị cảnh báo khi trùng lặp.
    *   Hệ thống không bao giờ được tự động hợp nhất (merge) các khách hàng. Chỉ Admin hoặc Product Owner mới có thể quyết định hai khách hàng có phải là một hay không.
3.  **Đăng ký cho Khách hàng hiện tại:**
    *   Khi Admin tạo Kiosk mới cho khách hàng đã có, Kiosk mới phải được gắn vào khách hàng đó, không tạo khách hàng mới.
    *   Người dùng công cộng (public users) không được phép thêm Kiosk vào một khách hàng hiện có thông qua form đăng ký công khai. Luồng này phải được Admin xử lý thủ công.
4.  **Chính sách Xóa và Vòng đời:**
    *   Khách hàng không bao giờ bị xóa cứng.
    *   Trạng thái của khách hàng chỉ có `Active` và `Inactive`.
    *   Một khách hàng không còn sử dụng dịch vụ sẽ được chuyển sang trạng thái `Inactive`. Các Kiosk và Thanh toán liên quan vẫn được giữ lại trong lịch sử.
    *   Nếu một khách hàng `Inactive` quay trở lại, Admin sẽ chuyển trạng thái của họ thành `Active` và quyết định thủ công Kiosk nào sẽ được kích hoạt lại.

---

## 4. Quy tắc Kiosk (Kiosk Rules)

1.  **Định danh Duy nhất:** **Facebook ID** là định danh duy nhất chính cho một Kiosk và không được trùng lặp trên toàn hệ thống (bao gồm các Kiosk hiện có và các yêu cầu đang chờ xử lý).
2.  **Ưu tiên Kiểm tra Trùng lặp:**
    1.  Facebook ID (Chặn nếu trùng).
    2.  Yêu cầu đang chờ (Pending Requests) (Chặn nếu trùng).
    3.  Số điện thoại (Chỉ cảnh báo).
    4.  Tên Facebook (Chỉ cảnh báo).
3.  **Chính sách Xóa và Vòng đời:**
    *   Kiosk không bao giờ bị xóa cứng.
    *   Các trạng thái của Kiosk bao gồm: `Pending`, `Active`, `Expired`, `Suspended` (dành cho tương lai).
    *   Các Kiosk đã hết hạn (`Expired`) vẫn được lưu trữ vĩnh viễn để phục vụ báo cáo và xem lịch sử.
4.  **Quy tắc Gia hạn:**
    *   Mọi gia hạn đều phải được Admin phê duyệt.
    *   **Nếu Kiosk đã hết hạn:** Kỳ hạn mới bắt đầu từ ngày thanh toán được xác nhận (`confirmed_at`).
    *   **Nếu Kiosk vẫn còn hạn:** Kỳ hạn mới bắt đầu ngay sau `end_date` hiện tại.
    *   Nếu có nhiều yêu cầu gia hạn đang chờ, yêu cầu nào được xác nhận trước sẽ được áp dụng trước, và các yêu cầu sau đó phải được tính toán lại dựa trên `end_date` mới nhất.
5.  **Lịch sử Gia hạn:** Hệ thống phải lưu giữ toàn bộ lịch sử thanh toán và gia hạn. `start_date` và `end_date` hiện tại của Kiosk chỉ đại diện cho kỳ dịch vụ đang hoạt động.

---

## 5. Quy tắc Phê duyệt và Đăng ký (Approval & Registration Rules)

1.  **Phê duyệt Gia hạn:** Mọi gia hạn đều phải được Admin phê duyệt. Hệ thống chỉ xử lý (kích hoạt Kiosk, cập nhật doanh thu, v.v.) sau khi thanh toán được xác nhận.
2.  **Đăng ký Công khai:** Người dùng công cộng không được phép thêm Kiosk cho khách hàng hiện có. Yêu cầu này phải được Admin xử lý thủ công.
3.  **Xử lý Trùng lặp khi Đăng ký:** Form công khai phải kiểm tra trùng lặp Facebook ID. Nếu trùng, chặn yêu cầu và thông báo cho người dùng. Phản hồi không được tiết lộ dữ liệu cá nhân của khách hàng hiện có.

---

## 6. Quy tắc Nhân viên (Staff Rules)

1.  **Chính sách Xóa:**
    *   Tài khoản nhân viên không bao giờ được xóa cứng sau khi họ đã có bất kỳ hoạt động nghiệp vụ nào (tạo, duyệt, sửa đổi dữ liệu).
    *   Mặc định là hủy kích hoạt (deactivate) hoặc khóa tài khoản, giữ lại hồ sơ để bảo toàn lịch sử kiểm toán.
    *   Chỉ cho phép xóa cứng nếu tài khoản được tạo do nhầm lẫn và chưa có bất kỳ hoạt động nào.
2.  **Quyền hạn:** Quyền của Reviewer phải được cấu hình linh hoạt và không được hard-code chỉ dựa trên tên vai trò.

---

## 7. Quy tắc Dashboard và Báo cáo (KPI & Reports Rules)

1.  **Nguồn Chân lý Duy nhất:** Tất cả các module (Dashboard, Reports, Customer Summary) phải sử dụng một dịch vụ tính toán chung duy nhất với các quy tắc thống nhất. Không module nào được tạo ra công thức nghiệp vụ riêng.
2.  **Hiệu suất:** Tất cả các KPI và báo cáo phải được tính toán ở phía database (dùng RPC, view, query tối ưu). Cấm việc tải hàng nghìn bản ghi về frontend để tính toán.
3.  **Định nghĩa KPI Dashboard:** Dashboard chỉ hiển thị các KPI nghiệp vụ chính. Các KPI vận hành (ví dụ: số thanh toán đang chờ) thuộc về module Báo cáo. Các công thức tính KPI đã được định nghĩa chi tiết (xem lại cuộc phỏng vấn).
4.  **Yêu cầu Báo cáo:** Các báo cáo phải tuân thủ đặc tả chi tiết đã được quyết định, bao gồm các bộ lọc, cột hiển thị, công thức, và quyền hạn truy cập.
5.  **Tính nhất quán:** Dashboard, Reports, và các màn hình tóm tắt khác phải luôn trả về các con số nhất quán cho cùng một bộ lọc.
6.  **Xử lý Dữ liệu lớn:** Phân trang, sắp xếp, lọc, và xuất file cho các tập dữ liệu lớn phải được xử lý ở phía database.
7.  **Báo cáo Đối soát (Reconciliation):** Báo cáo này chỉ phát hiện và hiển thị các vấn đề, không bao giờ được tự động sửa dữ liệu.

---

## 8. Chính sách Dữ liệu và Vòng đời (Data & Lifecycle Policy)

1.  **Chính sách Xóa (Delete Policy):**
    *   **Cấm Xóa cứng:** Dữ liệu nghiệp vụ và lịch sử (Customers, Kiosks, Payments, Staff có hoạt động) không bao giờ được xóa cứng.
    *   **Cho phép Xóa cứng có Điều kiện:** Dữ liệu cấu hình (Categories, Business Types) chỉ có thể được xóa cứng nếu chúng chưa từng được sử dụng và không có bất kỳ tham chiếu nào.
    *   **Mặc định là Xóa mềm:** Sử dụng trạng thái `Inactive` hoặc hủy kích hoạt.
2.  **Luồng Trạng thái (Status Flow):**
    *   **Customer:** `Active` <-> `Inactive`.
    *   **Kiosk:** `Pending` -> `Active` -> `Expired`. `Suspended` là một trạng thái có thể được sử dụng trong tương lai.
3.  **Trường Tổng hợp (Cached Fields):**
    *   `customers.total_kiosks` và `customers.total_paid` phải được cập nhật tự động bởi database.
    *   Các trường này là bản tóm tắt và phải có khả năng được tính toán lại từ dữ liệu gốc.
    *   Hệ thống cần cung cấp công cụ cho Admin để chạy tính toán lại khi cần.
4.  **Bảo vệ Database:** Cấm sử dụng `ON DELETE CASCADE`. Mối quan hệ giữa các bảng phải được bảo vệ bằng `RESTRICT`/`NO ACTION`.
5.  **Kiểm toán (Audit):** Mọi thay đổi trạng thái quan trọng (archive/restore, activate/deactivate, lock/unlock) và các hành động sửa chữa dữ liệu phải được ghi log đầy đủ (người thực hiện, thời gian, lý do, trạng thái cũ, trạng thái mới).

---

## 9. Lộ trình Tương lai (Future Roadmap Considerations)

1.  **Báo cáo Dịch vụ:** Có thể cần một báo cáo riêng về "Kích hoạt Dịch vụ" dựa trên `start_date`, tách biệt với báo cáo tài chính.
2.  **Trạng thái `Suspended` cho Kiosk:** Trạng thái này được giữ lại để có thể phát triển tính năng tạm khóa Kiosk trong tương lai mà không phải do hết hạn.
3.  **Kiến trúc KPI:** Kiến trúc hệ thống phải cho phép thêm các thẻ KPI mới trên Dashboard một cách linh hoạt.
4.  **Quyền hạn Reviewer:** Cần xây dựng một hệ thống cấu hình quyền hạn chi tiết cho vai trò Reviewer thay vì hard-code.
