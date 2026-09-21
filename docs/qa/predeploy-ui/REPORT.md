# PRE-DEPLOY CRM FINALIZATION — 2026-09-21

## 1. AUDIT SUMMARY

Đã hoàn tất vòng presentation/UX cho Sidebar/App Shell, Promotions, Reports và reconciliation Logs. Đã đọc và áp dụng `.agents/skills/ui-ux-pro-max/SKILL.md`; audit layout, navigation, tài khoản, FilterBar, Modal, các trang và read model trước khi sửa. Baseline trước triển khai: **491/491** test qua.

Các nguyên nhân chính: header không dùng chung chiều cao; TTC/System luôn mở; hai nhãn TTC giống nhau nhưng khác trang; account thiếu chữ Đăng xuất; promotion mới để trống thời gian; detail thiếu cấu trúc nhãn/giá trị; Reports filters chiếm nhiều hàng và integrity dùng từ kỹ thuật; Logs reconciliation thiếu ngữ cảnh từ quan hệ sẵn có.

Repo đã có nhiều thay đổi từ các vòng trước. Phạm vi vòng này được xác định bằng hash của 353 file ở thời điểm bắt đầu, không lấy toàn bộ `git diff` làm thay đổi mới. Xem [scope-check.json](scope-check.json).

## 2. SIDEBAR BEFORE → AFTER

Trước: TTC luôn mở, hai mục cùng tên “Tổng quan TTC”, nhóm hệ thống dài và account chủ yếu dùng icon logout. Sau: CRM luôn mở; TTC và System dùng disclosure, mặc định đóng khi không có route con đang active. Route con active tự mở nhóm và giữ `aria-current`. Sidebar cuộn độc lập, account nằm ở đáy; drawer mobile đóng/mở như trước.

Đủ **28 navigation routes** được giữ nguyên; hiển thị tiếp tục qua bộ lọc quyền hiện có. Cấu trúc đầy đủ dưới đây là cấu hình trước khi lọc quyền, không phải mọi tài khoản đều thấy tất cả.

| Nhóm | Nhãn → route |
|---|---|
| Cá nhân | Trang của tôi → `#/user`; Hồ sơ → `#/user-profile`; Kiosk của tôi → `#/user-kiosks`; Đăng ký Kiosk → `#/user-register-kiosk`; Thanh toán của tôi → `#/payments-mine`; Thông báo → `#/user-announcements`; Hỗ trợ → `#/user-support` |
| Standalone | Dashboard → `#/dashboard` |
| QUẢN LÝ CRM — luôn mở | Khách hàng → `#/customers`; Kiosk → `#/kiosks`; Đăng ký Kiosk → `#/register`; Hồ sơ Kiosk → `#/registration-requests`; Danh mục → `#/categories`; Loại hình kinh doanh → `#/business-types`; Mã giảm giá → `#/promotions`; Chi phí → `#/expenses`; Báo cáo → `#/reports` |
| TƯƠNG TÁC CHÉO (TTC) — thu gọn | TTC của tôi → `#/ttc`; Quản trị TTC → `#/admin/ttc`; Thông báo → `#/admin-ttc-announcements`; Tăng tương tác → `#/admin-ttc-campaigns`; Duyệt nhiệm vụ → `#/admin-ttc-tasks`; Ví xu → `#/admin-ttc-wallets`; Cấu hình giá → `#/admin-ttc-settings`; Kiểm tra & vi phạm → `#/admin-ttc-logs` |
| HỆ THỐNG — thu gọn | Quản lý người dùng → `#/user-management`; Nhật ký hoạt động → `#/logs`; Cài đặt → `#/settings` |

Hai TTC pages khác nhau:

| Route | Component thực tế | Chức năng hiện có | Nhãn mới |
|---|---|---|---|
| `#/ttc` | `src/pages/TtcPage.js`, `TtcPage` | Tổng quan TTC cá nhân: ví xu, Facebook ID; các tab Hồ sơ, Tăng tương tác, Kiếm xu, Lịch sử | TTC của tôi |
| `#/admin/ttc` | Router key `admin` → `src/pages/AdminTtcPage.js`, `AdminTtcPage` | Theo dõi danh sách tăng tương tác và trạng thái chạy từng đơn; cấu hình route mặc định hiển thị panel campaigns | Quản trị TTC |

Không xóa, gộp hoặc redirect trang nào. Giữ `matchRoute: admin`, permission `admin-ttc`; không sửa TTC pages/services. Các route TTC con và Website công khai vẫn được đánh dấu active tại nhóm tương ứng.

Account dùng avatar/tên của người đăng nhập và mapping vai trò hiện có, Việt hóa nhãn System Admin theo cờ thực tế. Menu ⋮ gồm Hồ sơ, đường phân cách, icon kèm chữ **Đăng xuất**. Có xử lý Escape, click ngoài, focus và touch target 44px; không thay đổi authentication.

## 3. APP SHELL

Dùng chung token `--shell-header-height: 60px`, `--shell-sidebar-width: 252px`, `--shell-border`. Logo header và Topbar cùng border-box height/border; main offset dùng cùng sidebar width. Tablet/mobile giữ drawer, width tối đa 280px và không chiếm cố định màn hình.

Chrome kiểm tra tọa độ hai đường phân cách trùng nhau ở 1440/1280/768/390; không tràn ngang viewport. Bộ chụp đợi hiệu ứng drawer kết thúc trước khi đo/chụp.

## 4. PROMOTIONS

Promotion mới lấy **cùng thời điểm hiện tại theo giờ Việt Nam (UTC+7)** cho Bắt đầu và Kết thúc ngay khi mở form; không hard-code năm/tháng/ngày. Promotion đang chỉnh sửa giữ dữ liệu cũ, kể cả ngày trống. Xóa input vẫn truyền giá trị trống và giữ cơ chế không giới hạn của service hiện có.

Chi tiết dùng `DetailFields` theo khoảng cách của Logs Detail: sáu chỉ số, nhãn phụ và giá trị rõ ràng, desktop hai cột / mobile xếp dọc; không ghép chữ/số. Các phép đếm, tổng tiền và tháng tặng giữ nguyên. Test có mốc UTC chuyển sang năm mới ở Việt Nam, dữ liệu edit rỗng và thao tác clear/save trên trình duyệt.

## 5. REPORTS

Dùng shared FilterBar theo thứ tự Từ ngày → Đến ngày → Tìm kiếm → Nâng cao → Làm mới. Một hàng tại 1440/1280; panel nâng cao chỉ mở khi người dùng yêu cầu, giữ đủ chín trường. PageHeader và Xuất CSV giữ nguyên. Khoảng ngày, nguồn báo cáo, tính toán và CSV semantics không sửa.

“Đối soát” ở đây là **kiểm tra integrity/liên kết dữ liệu**: thiếu customer/kiosk/thời điểm xác nhận/ngày hết hạn/Facebook ID, Facebook ID trùng, tổng lưu sẵn chưa khớp, số tiền không hợp lệ hoặc hồ sơ pending trùng. Không phải hệ thống đối soát ngân hàng. Nhãn mới là **Cần kiểm tra**, giữ nguyên tab key và logic phát hiện hiện tại.

Card nêu bản ghi, trạng thái, khách hàng, Kiosk, tiền khi liên quan, thời điểm, vấn đề, hướng dẫn và nút Kiểm tra. Giải quyết tên bằng các khóa liên kết có thật qua payment, registration request/batch/item, kiosk và customer; không ghép bằng tên/số tiền. Không đủ dữ liệu hoặc bị RLS chặn thì dùng “Không xác định”. Card giải thích rõ trường hợp tìm được Kiosk qua hồ sơ nhưng payment vẫn thiếu liên kết Kiosk trực tiếp.

Bổ sung đọc theo lô cho các bản ghi đang hiển thị, không ghi dữ liệu. Bảng tổng quan đổi bố cục ở màn hình hẹp để số điện thoại/tiêu đề không bị ép hoặc khuất: 1280 một cột; mobile nhãn/giá trị. Nội dung và số liệu giữ nguyên.

## 6. LOGS

Chỉ thay presentation nhánh reconciliation, giữ giao diện Logs đã được chấp nhận và các loại sự kiện khác.

Ví dụ fixture có quan hệ đầy đủ:

- Trước: “Thanh toán #348 cần đối soát intent” — `150.000 VNĐ · transfer`.
- Sau: **“Thanh toán #348 của Lan Lan cần kiểm tra”** — **“Kiosk: Ngọc Anh · 150.000 VNĐ · Chuyển khoản”**.

Detail giữ metadata người thực hiện/nguồn/thời gian/kết quả; thêm khách hàng, Kiosk, loại giao dịch, số tiền, mã thanh toán, phương thức, trạng thái và lý do. Chỉ ghi loại đăng ký/gia hạn khi khóa quan hệ hoặc transaction type hỗ trợ. Không suy ra từ mô tả. Thiếu dữ liệu hiển thị thông báo không xác định từ dữ liệu hiện có.

Phân biệt `payment:<id>` với `reconciliation:<order-id>`; order phải đi qua payment_id thực tế, không dùng order ID làm payment ID. Các reason code đã biết được chuyển thành hướng dẫn nghiệp vụ. Không thay payment/PayOS/reconciliation lifecycle.

## 7. FILES CHANGED

12 file cập nhật + 7 file mới trong src/tests, theo baseline đầu vòng:

- `src/app.js`
- `src/constants/navigation.js`
- `src/utils/businessEventPresentation.js`
- `src/styles/app.css`
- `src/layouts/AppLayout.js`
- `src/pages/PromotionsPage.js`
- `src/pages/LogsPage.js`
- `src/pages/ReportsPage.js`
- `tests/ui-ux-presentation-polish.test.cjs`
- `tests/qa-round2-stabilization.test.mjs`
- `tests/reports-filter-ui.test.cjs`
- `tests/sidebar-redesign.test.cjs`
- `src/utils/reviewPresentation.js`
- `src/components/DetailFields.js`
- `src/services/ReviewContextService.js`
- `tests/predeploy-presentation.test.mjs`
- `tests/visual/run-predeploy-ui.mjs`
- `tests/visual/predeploy-ui-fixture.js`
- `tests/visual/predeploy-ui.html`

Thêm bằng chứng tại `docs/qa/predeploy-ui/`: báo cáo này, 60 PNG, results.json, scope-check.json và bảy file log. Shared `FilterBar.js`, `Modal.js` và các service nghiệp vụ hiện có không sửa trong vòng này.

## 8. DATABASE

**NO CHANGE.** Không tạo migration, không chỉnh schema/RLS, không ghi DB production. **94/94 file migration tồn tại tại baseline giữ nguyên hash**, không thêm/xóa migration trong vòng này. Những migration đang dirty trong Git là trạng thái có trước vòng này và được giữ nguyên.

`ReviewContextService` chỉ dùng client đã xác thực để đọc quan hệ với quyền/RLS hiện tại. Các kiểm thử database trong full suite chạy theo hạ tầng test cục bộ hiện có.

## 9. TEST RESULTS

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| Baseline trước sửa | 491/491 PASS, 9 suites | [before.log](before.log) |
| Focused — 5 test files | 29/29 PASS | [focused.log](focused.log) |
| Full suite sau sửa | 497/497 PASS, 9 suites; 0 fail/skip | [after.log](after.log) |
| `npm run build` | PASS; build hiện tại sinh browser config | [build.log](build.log) |
| `node --check` | 17 file JS/MJS/CJS thay đổi/thêm mới PASS | [syntax.log](syntax.log) |
| `git diff --check` | PASS, exit 0 | [diffcheck.log](diffcheck.log) |
| Browser matrix | 60/60 PASS; errors rỗng | [visual.log](visual.log), [results.json](results.json) |

Sáu regression tests mới bao phủ routes/quyền, actual router active-group behavior, thời gian Việt Nam và edit rỗng, resolver theo quan hệ/fallback khi từ chối đọc, integrity copy và reconciliation copy/ID/type. Cập nhật test cũ chỉ ở hợp đồng presentation đã đổi (nhãn, nhóm TTC, Reports filters); giữ các kiểm tra nghiệp vụ.

Build dùng cấu hình local mà không ghi vào log; khôi phục nguyên nội dung config.js sau chạy. Không deploy.

## 10. VISUAL QA

Đã chạy Chrome cục bộ, render **page/layout/CSS và handlers thực của ứng dụng**, với service fixtures xác định và profile trình duyệt riêng. Đã xem trực tiếp các ảnh light cho phạm vi yêu cầu ở bốn độ rộng; kiểm tra DOM và tương tác bổ sung. Đây là visual QA với dữ liệu kiểm thử, **chưa phải UAT đăng nhập production**.

| Nội dung | 1440 | 1280 | 768 | 390 |
|---|---|---|---|---|
| Sidebar / App Shell | [PASS](shell-1440-light.png) | [PASS](shell-1280-light.png) | [PASS](shell-768-light.png) | [PASS](shell-390-light.png) |
| Account menu | [PASS](account-1440-light.png) | [PASS](account-1280-light.png) | [PASS](account-768-light.png) | [PASS](account-390-light.png) |
| TTC mở / đóng | [PASS](ttc-1440-light.png) | [PASS](ttc-1280-light.png) | [PASS](ttc-768-light.png) | [PASS](ttc-390-light.png) |
| System mở / đóng | [PASS](system-1440-light.png) | [PASS](system-1280-light.png) | [PASS](system-768-light.png) | [PASS](system-390-light.png) |
| Tạo promotion | [PASS](promotion-create-1440-light.png) | [PASS](promotion-create-1280-light.png) | [PASS](promotion-create-768-light.png) | [PASS](promotion-create-390-light.png) |
| Chi tiết promotion | [PASS](promotion-detail-1440-light.png) | [PASS](promotion-detail-1280-light.png) | [PASS](promotion-detail-768-light.png) | [PASS](promotion-detail-390-light.png) |
| Reports filters / tổng quan | [PASS](reports-1440-light.png) | [PASS](reports-1280-light.png) | [PASS](reports-768-light.png) | [PASS](reports-390-light.png) |
| Reports Cần kiểm tra | [PASS](reports-integrity-1440-light.png) | [PASS](reports-integrity-1280-light.png) | [PASS](reports-integrity-768-light.png) | [PASS](reports-integrity-390-light.png) |
| Logs reconciliation | [PASS](logs-1440-light.png) | [PASS](logs-1280-light.png) | [PASS](logs-768-light.png) | [PASS](logs-390-light.png) |
| Chi tiết log | [PASS](log-detail-1440-light.png) | [PASS](log-detail-1280-light.png) | [PASS](log-detail-768-light.png) | [PASS](log-detail-390-light.png) |

20 trường hợp dark ở 1280/390 cũng qua kiểm tra tự động; đã xem mẫu [account 1280](account-1280-dark.png), [integrity 390](reports-integrity-390-dark.png), [promotion detail 390](promotion-detail-390-dark.png). Không tuyên bố đã duyệt thủ công toàn bộ ảnh dark.

Kiểm tra gồm: shared header baseline; đủ routes; group mặc định và tự mở theo active route; menu tài khoản/Escape/logout hook; drawer đóng trên mobile; date defaults/clear/edit; sáu chỉ số promotion và 12 cặp thông tin log không chồng nhãn/giá trị; desktop filters cùng hàng; chín advanced controls; giữ filters khi refresh; tìm tên thật trong integrity; không tràn viewport hoặc cắt bảng tổng quan. Sidebar và modal dài cuộn nội bộ; các tab Reports giữ cuộn ngang cục bộ trên mobile.

## 11. REGRESSION CHECK

So với baseline đầu vòng, hash các file nghiệp vụ liên quan giữ nguyên; full suite qua:

| Phạm vi khóa | Kết quả |
|---|---|
| Dashboard / Recent Activity | Không sửa page/service/component |
| Kiosk / Customer business logic | Không sửa page/service nghiệp vụ |
| Payment lifecycle / PayOS / historical correction | Không sửa API/service/lifecycle |
| Registration / public registration / renewal | Không sửa nghiệp vụ hoặc public forms |
| Revenue / expenses / expense categories | Không sửa tính toán/service/schema |
| User / Permissions | Không sửa auth hoặc rule quyền; chỉ account presentation và active navigation |
| TTC business logic | Không sửa TTC pages/services; giữ cả hai routes |
| Public Footer | Không sửa component/icons/links hoặc các rule CSS Footer đã được chấp nhận |
| Homepage architecture | Không sửa |
| Employee Management | Không triển khai |

Toàn bộ file baseline trong `api/`, `shared/`, `supabase/` giữ nguyên. CSS bổ sung được giới hạn vào shell/sidebar, detail fields và Reports; không chỉnh selectors Footer trong vòng này.

## 12. REMAINING ISSUES

Không còn lỗi gây thất bại trong phạm vi fixture/test đã kiểm tra. Giới hạn xác minh:

- Chưa kiểm tra đăng nhập và dữ liệu production; tên Lan Lan/Ngọc Anh trong ảnh là dữ liệu fixture, không phải xác nhận dữ liệu live.
- Quyền đọc quan hệ thực tế có thể khác theo vai trò. Resolver tôn trọng RLS và trả fallback khi quan hệ không tồn tại/không đọc được; không tự mở rộng quyền.
- Các lượt đọc bổ sung được gom theo lô cho trang hiện tại; chưa đo độ trễ trên dữ liệu production lớn.
- Full suite/visual QA không chứng minh mọi luồng production. Phần giao diện khác ngoài phạm vi không được tuyên bố đã UAT lại.

## 13. CONFIRM

- Không chạy `supabase db push`.
- Không deploy Vercel.
- Không chạy `git push`.
- Không commit, không thay applied migration history, không triển khai Employee Management.
