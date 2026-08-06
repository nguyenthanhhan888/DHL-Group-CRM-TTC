# Các quyết định cần Chủ dự án xác nhận

- **Ngày tạo:** 25/07/2026
- **Người thực hiện:** Gemini
- **Phiên bản:** 1.0

## Giới thiệu
Tài liệu này tổng hợp các câu hỏi về nghiệp vụ và luồng xử lý mà mã nguồn hiện tại không thể tự quyết định một cách an toàn. Các quyết định này cần được Product Owner xác nhận để đảm bảo hệ thống hoạt động đúng mục tiêu và nhất quán.

---

## 1. Quản lý Doanh thu và Thanh toán (Revenue & Payments)

### 1.1. [OWNER DECISION REQUIRED] Ngày tính Doanh thu

- **Chủ đề:** Doanh thu trên Dashboard và Báo cáo được tính dựa trên ngày nào của thanh toán?
- **Hiện trạng trong source:**
    - `DashboardService.js` (`getPaymentRevenueInRange`): Sử dụng `start_date` để lọc doanh thu trong kỳ (tháng, năm).
    - `ReportService.js` (`getPayments`): Cũng sử dụng `start_date` để lọc theo `filters.startDate` và `filters.endDate`.
    - DB Migration `...use_vietnam_date_when_confirming_payments.sql`: Khi xác nhận thanh toán (`private.complete_payment`), `start_date` được tính là `greatest(coalesce(payment_record.start_date, confirmation_date), confirmation_date)`, trong đó `confirmation_date` là ngày hiện tại ở múi giờ Việt Nam.
- **Tại sao chưa rõ:** Logic hiện tại dựa vào `start_date`, nhưng trong nhiều hệ thống, doanh thu được ghi nhận tại thời điểm thanh toán được xác nhận (`confirmed_at`). `start_date` có thể là một ngày trong tương lai hoặc quá khứ.
- **Rủi ro nếu AI tự quyết:** AI có thể chọn `confirmed_at` vì nó phản ánh chính xác hơn thời điểm dòng tiền đi vào, nhưng điều này có thể mâu thuẫn với cách tính kỳ hạn sử dụng của Kiosk. Việc tự ý thay đổi có thể làm sai lệch toàn bộ báo cáo tài chính.
- **Các phương án có thể:**
    1.  **Giữ nguyên (dựa trên `start_date`):** Doanh thu được ghi nhận vào ngày bắt đầu kỳ hạn của Kiosk. Ưu điểm: Gắn liền với dịch vụ. Nhược điểm: Có thể gây khó khăn cho việc đối soát kế toán theo ngày.
    2.  **Sửa lại (dựa trên `confirmed_at`):** Doanh thu được ghi nhận tại ngày xác nhận thanh toán. Ưu điểm: Phản ánh đúng dòng tiền, dễ đối soát. Nhược điểm: Cần cập nhật lại tất cả các query liên quan.
- **Khuyến nghị:** Sử dụng **Phương án 2 (dựa trên `confirmed_at`)** vì đây là chuẩn mực kế toán phổ biến, giúp báo cáo tài chính rõ ràng hơn.
- **Chờ Product Owner quyết định:** Cần xác nhận ngày dùng để ghi nhận doanh thu là `start_date` hay `confirmed_at`.

### 1.2. [OWNER DECISION REQUIRED] Sửa/Hủy một thanh toán đã hoàn thành

- **Chủ đề:** Admin có được phép sửa hoặc hủy một thanh toán (`payment`) đã ở trạng thái `completed` không?
- **Hiện trạng trong source:**
    - `PaymentService.js`: Chỉ có các hàm `updatePending`, `cancelRegistration` (hủy khi đang `pending`), và `reject`. Không có hàm nào cho phép sửa một payment đã `completed`.
    - Giao diện không cung cấp nút để sửa/hủy các payment đã hoàn thành.
- **Tại sao chưa rõ:** Luồng nghiệp vụ thực tế có thể phát sinh các trường hợp cần điều chỉnh (ví dụ: nhập sai số tiền, cần hoàn tiền). Hệ thống hiện tại không hỗ trợ.
- **Rủi ro nếu AI tự quyết:** AI có thể tự ý thêm chức năng cho phép sửa/xóa, nhưng việc này rất nguy hiểm. Sửa một payment đã hoàn thành có thể ảnh hưởng đến kỳ hạn của Kiosk, doanh thu đã ghi nhận, và lịch sử của khách hàng, gây ra sự không nhất quán nghiêm trọng cho dữ liệu.
- **Các phương án có thể:**
    1.  **Không cho phép sửa/hủy:** Mọi sai sót phải được xử lý bằng một giao dịch mới (ví dụ: tạo một payment mới với số tiền âm để ghi nhận hoàn tiền). Ưu điểm: Bảo toàn lịch sử, minh bạch. Nhược điểm: Phức tạp cho người dùng.
    2.  **Cho phép hủy (nhưng không sửa):** Cho phép admin có quyền đặc biệt hủy một payment đã `completed`. Khi hủy, hệ thống phải tự động đảo ngược tất cả các tác động (cập nhật lại kỳ hạn Kiosk, `total_paid` của khách hàng).
    3.  **Cho phép sửa (giới hạn):** Cho phép admin sửa một số trường nhất định (ví dụ: ghi chú), nhưng không phải số tiền hoặc ngày tháng.
- **Khuyến nghị:** **Phương án 1**. Đây là cách tiếp cận an toàn nhất theo chuẩn kế toán, tạo ra một "đường đi" rõ ràng cho mọi giao dịch.
- **Chờ Product Owner quyết định:** Cần định nghĩa rõ quy trình xử lý khi một thanh toán đã hoàn thành bị sai sót.

---

## 2. Quản lý Khách hàng và Kiosk (Customers & Kiosks)

### 2.1. [OWNER DECISION REQUIRED] Quy tắc chống trùng lặp Khách hàng

- **Chủ đề:** Hệ thống nên xử lý như thế nào khi một khách hàng mới được tạo có thông tin (số điện thoại, Facebook ID) trùng với một khách hàng đã tồn tại?
- **Hiện trạng trong source:**
    - `CustomerService.js`, `LegacyRegistrationService.js`: Không có bất kỳ logic nào kiểm tra trùng lặp trước khi tạo khách hàng mới.
    - Database: Cột `phone` và `facebook_id` trong bảng `customers` không có `UNIQUE` constraint.
- **Tại sao chưa rõ:** Việc cho phép tạo khách hàng trùng lặp sẽ làm "rác" dữ liệu, gây khó khăn cho việc quản lý, báo cáo và chăm sóc khách hàng.
- **Rủi ro nếu AI tự quyết:** AI có thể tự thêm `UNIQUE` constraint vào database, nhưng điều này có thể làm lỗi các chức năng đang hoạt động nếu dữ liệu hiện tại đã có trùng lặp. Việc tự quyết quy tắc hợp nhất (merge) cũng có thể làm mất dữ liệu.
- **Các phương án có thể:**
    1.  **Chặn ở frontend:** Khi người dùng nhập SĐT/Facebook ID, hệ thống kiểm tra và cảnh báo nếu đã tồn tại. Nếu admin vẫn muốn tạo, hệ thống cho phép.
    2.  **Chặn cứng ở backend/database:** Thêm `UNIQUE` constraint vào cột `phone` và/hoặc `facebook_id`. Mọi yêu cầu tạo khách hàng trùng lặp sẽ thất bại.
    3.  **Hợp nhất thông minh:** Khi phát hiện trùng lặp, hệ thống gợi ý cho admin hợp nhất thông tin vào khách hàng đã có.
- **Khuyến nghị:** **Phương án 2** cho cột `phone` (vì SĐT thường là định danh duy nhất). Đối với `facebook_id`, có thể áp dụng **Phương án 1** vì một người có thể có nhiều tài khoản. Cần một chức năng riêng để admin dọn dẹp và hợp nhất dữ liệu trùng lặp hiện có.
- **Chờ Product Owner quyết định:** Cần xác định (1) các trường nào là duy nhất, và (2) hệ thống nên hành xử thế nào khi phát hiện trùng lặp.

### 2.2. [OWNER DECISION REQUIRED] Xử lý khi xóa Khách hàng

- **Chủ đề:** Điều gì sẽ xảy ra khi một khách hàng bị xóa? Các Kiosk và Payment liên quan sẽ được xử lý như thế nào?
- **Hiện trạng trong source:**
    - `CustomerService.js`: có hàm `remove(id)` thực hiện `delete()` trực tiếp.
    - Database: Foreign key từ `kiosks.customer_id` và `payments.customer_id` tới `customers.id` có thể có hành vi `ON DELETE` mặc định (thường là `NO ACTION` hoặc `RESTRICT`), sẽ gây lỗi nếu khách hàng vẫn còn kiosk/payment.
- **Tại sao chưa rõ:** Việc xóa một khách hàng có thể để lại dữ liệu Kiosk và Payment "mồ côi" hoặc gây lỗi hệ thống nếu database chặn.
- **Rủi ro nếu AI tự quyết:** AI có thể set `ON DELETE CASCADE`, tự động xóa tất cả kiosk và payment của khách hàng, dẫn đến mất dữ liệu lịch sử kinh doanh vĩnh viễn. Hoặc AI có thể chọn `SET NULL`, giữ lại kiosk/payment nhưng không biết của ai.
- **Các phương án có thể:**
    1.  **Xóa mềm (Soft Delete):** Thêm cột `is_active` vào bảng `customers`. Thay vì xóa, chỉ cập nhật `is_active = false`. Khách hàng sẽ bị ẩn khỏi các giao diện chính nhưng dữ liệu vẫn còn.
    2.  **Chặn xóa:** Không cho phép xóa khách hàng nếu họ vẫn còn Kiosk hoặc Payment. Admin phải xóa/gán lại các bản ghi con trước.
    3.  **Xóa logic:** Cung cấp một công cụ cho phép admin chuyển toàn bộ Kiosk/Payment của khách hàng này sang một khách hàng khác trước khi xóa.
- **Khuyến nghị:** **Phương án 1 (Xóa mềm)**. Đây là phương án an toàn nhất, bảo toàn toàn vẹn dữ liệu và lịch sử.
- **Chờ Product Owner quyết định:** Cần quyết định chính sách xóa khách hàng: xóa mềm, chặn, hay cho phép xóa có điều kiện.

### 2.3. [OWNER DECISION REQUIRED] Cập nhật các trường tổng hợp của Khách hàng

- **Chủ đề:** Các trường `total_kiosks` và `total_paid` trên bảng `customers` được cập nhật như thế nào?
- **Hiện trạng trong source:**
    - `AUDIT_REPORT.md` đã chỉ ra: không có trigger hay logic nào ở client để cập nhật các trường này.
    - Các trường này hiện không được sử dụng ở bất kỳ đâu trên giao diện.
- **Tại sao chưa rõ:** Các trường này rõ ràng được tạo ra với mục đích cache/tổng hợp, nhưng logic cập nhật chưa được định nghĩa. Dữ liệu trong đó có thể luôn luôn sai.
- **Rủi ro nếu AI tự quyết:** AI có thể tự tạo trigger trong database để cập nhật. Tuy nhiên, việc tính toán `total_paid` có thể phức tạp (ví dụ: chỉ tính payment `completed`?), và việc thêm trigger có thể ảnh hưởng đến hiệu năng ghi của các bảng `kiosks` và `payments`.
- **Các phương án có thể:**
    1.  **Database Triggers:** Tạo các trigger trên bảng `kiosks` và `payments` để tự động cập nhật `customers` khi có thay đổi. Ưu điểm: Dữ liệu luôn nhất quán. Nhược điểm: Tăng độ phức tạp cho database.
    2.  **RPC Function:** Tạo một hàm RPC để tính toán lại các giá trị này theo yêu cầu, hoặc chạy định kỳ. Ưu điểm: Ít ảnh hưởng đến hiệu năng ghi. Nhược điểm: Dữ liệu có độ trễ.
    3.  **Xóa bỏ các trường:** Nếu không thực sự cần thiết, hãy xóa các trường này và tính toán trực tiếp mỗi khi cần. Ưu điểm: Đơn giản hóa mô hình dữ liệu. Nhược điểm: Có thể ảnh hưởng hiệu năng đọc nếu cần truy vấn thường xuyên.
- **Khuyến nghị:** **Phương án 1 (Database Triggers)**. Với một hệ thống CRM, việc có dữ liệu tổng hợp chính xác ngay lập tức là rất quan trọng.
- **Chờ Product Owner quyết định:** Cần xác nhận (1) công thức chính xác để tính `total_kiosks` và `total_paid`, và (2) phương pháp cập nhật (trigger, RPC, hay tính trực tiếp).

---

## 3. Quy trình và Vòng đời (Flows & Lifecycle)

### 3.1. [OWNER DECISION REQUIRED] Quy trình Gia hạn Kiosk

- **Chủ đề:** Việc gia hạn một Kiosk được xử lý như thế nào?
- **Hiện trạng trong source:**
    - `RenewKioskForm.js` và `PaymentService.renewKiosk`: Khi gia hạn, hệ thống tạo một payment mới và ngay lập tức gọi `PaymentService.confirm(payment.id)`.
    - `nextRenewalStartDate` trong `PaymentService.js` tính ngày bắt đầu mới là `endDate + 1 day`.
- **Tại sao chưa rõ:**
    1.  **Tự động xác nhận:** Luồng gia hạn đang tự động xác nhận thanh toán mà không cần admin duyệt. Điều này khác với luồng đăng ký mới (cần duyệt). Có phải đây là yêu cầu nghiệp vụ?
    2.  **Kỳ hạn gối đầu:** Nếu một Kiosk còn hạn tới ngày 31/12/2026 và được gia hạn thêm 1 tháng vào ngày 01/12/2026, ngày bắt đầu của kỳ hạn mới sẽ là 01/01/2027. Logic `nextRenewalStartDate` hiện tại đã xử lý đúng điều này. Tuy nhiên, nếu một Kiosk đã hết hạn, ngày bắt đầu mới sẽ là ngày nào? Ngày ngay sau ngày hết hạn, hay là ngày hiện tại?
- **Rủi ro nếu AI tự quyết:** AI có thể giữ nguyên logic tự động xác nhận, bỏ qua bước đối soát tài chính quan trọng. AI cũng có thể tự quyết định ngày bắt đầu cho Kiosk hết hạn, có thể không đúng ý muốn (ví dụ: khách hàng mất một khoảng thời gian sử dụng nếu ngày bắt đầu tính từ ngày hết hạn cũ).
- **Các phương án có thể:**
    1.  **Gia hạn cần duyệt:** Luồng gia hạn cũng tạo ra một payment `pending` và chờ admin xác nhận như đăng ký mới.
    2.  **Gia hạn tự động (giữ nguyên):** Giữ nguyên logic hiện tại, tin rằng việc gia hạn ít rủi ro hơn.
    3.  **Định nghĩa ngày bắt đầu cho Kiosk hết hạn:**
        a. Luôn tính từ ngày hết hạn cũ (khách hàng không mất ngày nào).
        b. Tính từ ngày hiện tại (ngày thực hiện gia hạn).
- **Khuyến nghị:**
    - **Phương án 1 (Gia hạn cần duyệt)** để đảm bảo mọi khoản thu đều được đối soát.
    - **Phương án 3b** cho ngày bắt đầu của Kiosk hết hạn. Điều này khuyến khích khách hàng gia hạn đúng hạn.
- **Chờ Product Owner quyết định:** Cần xác nhận (1) Luồng gia hạn có cần admin duyệt không? (2) Ngày bắt đầu cho Kiosk đã hết hạn được tính như thế nào?

### 3.2. [OWNER DECISION REQUIRED] Chính sách Xóa mềm và Xóa cứng

- **Chủ đề:** Khi nào nên dùng xóa mềm (`is_active = false`) và khi nào nên xóa cứng (`DELETE`)?
- **Hiện trạng trong source:**
    - `CategoryService.remove`: Xóa cứng.
    - `BusinessTypeService.remove`: Xóa mềm.
    - `CustomerService.remove`: Xóa cứng.
    - `StaffService.remove`: Xóa cứng, nhưng có kiểm tra nếu nhân viên đã có lịch sử duyệt đơn thì chặn.
- **Tại sao chưa rõ:** Chính sách xóa không nhất quán trên toàn hệ thống.
- **Rủi ro nếu AI tự quyết:** Việc tự ý chọn một phương pháp có thể gây mất dữ liệu vĩnh viễn (xóa cứng) hoặc làm phức tạp các câu truy vấn một cách không cần thiết (xóa mềm ở mọi nơi).
- **Các phương án có thể:**
    1.  **Xóa mềm cho tất cả:** Áp dụng xóa mềm (thêm cột `is_active` hoặc `deleted_at`) cho tất cả các bảng chính (`customers`, `kiosks`, `categories`, `business_types`, `payments`). Ưu điểm: An toàn tối đa. Nhược điểm: Phức tạp hóa tất cả các câu lệnh `SELECT`.
    2.  **Xóa cứng cho dữ liệu cấu hình, xóa mềm cho dữ liệu giao dịch:**
        *   Dữ liệu cấu hình (ít thay đổi): `categories`, `business_types` -> Có thể xóa cứng nếu không còn liên kết.
        *   Dữ liệu giao dịch (quan trọng): `customers`, `kiosks`, `payments`, `users` -> Phải xóa mềm.
- **Khuyến nghị:** **Phương án 2**. Đây là sự cân bằng giữa an toàn dữ liệu và sự đơn giản. Dữ liệu giao dịch không bao giờ nên bị xóa cứng.
- **Chờ Product Owner quyết định:** Cần một quy tắc chung cho toàn hệ thống về việc khi nào dùng xóa mềm và khi nào dùng xóa cứng.

### 3.3. [OWNER DECISION REQUIRED] Trạng thái của Kiosk

- **Chủ đề:** Các trạng thái của Kiosk (`active`, `warning`, `expired`, `pending`, `inactive`, `suspended`) được định nghĩa và chuyển đổi như thế nào?
- **Hiện trạng trong source:**
    - Bảng `kiosks` có cột `status` kiểu `text`.
    - `KioskService.js` (`deriveKioskStatus`) chứa logic ở client để "suy ra" trạng thái thực tế:
        - `expired` nếu `status` là `expired` HOẶC `end_date` đã qua.
        - `warning` nếu `status` là `active` VÀ `end_date` sắp đến.
        - Các trạng thái khác được giữ nguyên.
- **Tại sao chưa rõ:**
    - Logic tính toán ở client có thể không nhất quán và khó truy vấn.
    - Không có định nghĩa rõ ràng cho `inactive` và `suspended`. Khi nào một kiosk được chuyển sang các trạng thái này?
    - Mối quan hệ giữa `status` lưu trong DB và `derivedStatus` ở client là gì? Cái nào là "nguồn chân lý"?
- **Rủi ro nếu AI tự quyết:** AI có thể tự định nghĩa các luồng chuyển đổi trạng thái, ví dụ tự động chuyển Kiosk sang `suspended` nếu quá hạn lâu ngày. Điều này có thể không phản ánh đúng quy trình kinh doanh.
- **Các phương án có thể:**
    1.  **Đơn giản hóa trạng thái:** Chỉ lưu các trạng thái "cứng" trong DB: `active`, `pending`, `inactive`, `suspended`. Các trạng thái "động" (`warning`, `expired`) luôn được suy ra ở tầng truy vấn (bằng DB view hoặc function).
    2.  **Chuẩn hóa và tự động hóa:** Giữ tất cả các trạng thái trong DB. Tạo các job/trigger trong database để tự động chuyển trạng thái (ví dụ: mỗi ngày, quét các kiosk và cập nhật `status` thành `expired` hoặc `warning`).
- **Khuyến nghị:** **Phương án 1**. Giữ cho dữ liệu được lưu trữ đơn giản và rõ ràng. Việc suy ra trạng thái động ở tầng truy vấn là một pattern phổ biến và hiệu quả.
- **Chờ Product Owner quyết định:** Cần định nghĩa rõ ràng: (1) Ý nghĩa của tất cả các trạng thái Kiosk. (2) Quy trình chuyển đổi giữa các trạng thái. (3) Trạng thái nào được lưu và trạng thái nào được suy ra.

---

## 4. Dashboard và Báo cáo (KPIs & Reporting)

### 4.1. [OWNER DECISION REQUIRED] Công thức tính các chỉ số KPI trên Dashboard

- **Chủ đề:** Các chỉ số trên Dashboard (`Tổng Kiosk`, `Kiosk đang hoạt động`, `Kiosk hết hạn`, `Doanh thu tháng/năm`) được tính chính xác như thế nào?
- **Hiện trạng trong source:**
    - `DashboardService.js`:
        - `totalKiosks`: `count` toàn bộ bảng `kiosks`.
        - `activeKiosks`: `count` các kiosk có `status` là `active` hoặc `warning` VÀ `end_date` chưa qua.
        - `expiredKiosks`: `count` các kiosk có `status` là `expired` HOẶC `end_date` đã qua.
        - `revenueThisMonth/Year`: `sum(total_amount)` của các `payment` có `payment_status` là `completed` và `start_date` trong kỳ.
- **Tại sao chưa rõ:** Các công thức này đang được hard-code ở client. Chúng có thể không phản ánh đúng định nghĩa KPI của Product Owner. Ví dụ, `Tổng Kiosk` có nên bao gồm cả các kiosk `inactive` không? `Kiosk đang hoạt động` có nên bao gồm cả kiosk `warning`?
- **Rủi ro nếu AI tự quyết:** Các chỉ số kinh doanh cốt lõi có thể bị định nghĩa sai, dẫn đến việc ra quyết định dựa trên thông tin không chính xác.
- **Các phương án có thể:** Không có phương án thay thế. Cần Product Owner cung cấp định nghĩa chính xác.
- **Khuyến nghị:** Tổ chức một buổi họp với Product Owner để xem xét lại từng chỉ số KPI, ghi lại công thức rõ ràng, và sau đó triển khai logic đó trong các RPC function ở database để đảm bảo tính nhất quán.
- **Chờ Product Owner quyết định:** Cần cung cấp công thức/định nghĩa chính xác cho TẤT CẢ các chỉ số trên Dashboard.

### 4.2. [OWNER DECISION REQUIRED] Yêu cầu chi tiết cho Báo cáo

- **Chủ đề:** Các báo cáo trong `ReportsPage.js` cần hiển thị những gì và tính toán ra sao?
- **Hiện trạng trong source:**
    - `ReportService.js` lấy một lượng lớn dữ liệu thô về client và thực hiện tất cả logic tính toán (doanh thu theo tháng, top khách hàng, trạng thái kiosk...).
- **Tại sao chưa rõ:** Logic báo cáo hiện tại là do Lập trình viên tự suy diễn dựa trên các dữ liệu có sẵn. Chưa có yêu cầu rõ ràng từ Product Owner về các cột cần hiển thị, các bộ lọc, hay công thức tính toán. Ví dụ: "Top 10 khách hàng" được tính theo doanh thu trong kỳ lọc, hay tổng doanh thu từ trước đến nay?
- **Rủi ro nếu AI tự quyết:** AI sẽ tạo ra các báo cáo dựa trên suy đoán, có thể hoàn toàn không đáp ứng được nhu cầu phân tích kinh doanh của người dùng cuối.
- **Các phương án có thể:** Không có phương án thay thế.
- **Khuyến nghị:** Product Owner cần cung cấp một bản đặc tả chi tiết cho từng loại báo cáo, bao gồm:
    - Tên báo cáo và mục đích.
    - Các bộ lọc có thể áp dụng.
    - Danh sách các cột cần hiển thị.
    - Công thức tính toán cho từng cột.
    - Cách sắp xếp mặc định.
- **Chờ Product Owner quyết định:** Cần đặc tả chi tiết cho từng báo cáo mong muốn.
