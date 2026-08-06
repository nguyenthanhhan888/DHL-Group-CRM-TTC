# Báo cáo sửa lỗi Public Legacy Customer Form

## Phạm vi

Chỉ sửa:

- `src/pages/LegacyRegistrationPage.js`
- Báo cáo này

Không tạo hoặc sửa SQL, migration, RPC, RLS hay Edge Function. Không commit và không push.

## Nguyên nhân Facebook ID lookup

Trang gọi:

```js
supabase.functions.invoke('resolve-facebook-id')
```

Edge Function hiện có có hai vấn đề trong mã nguồn:

1. Import runtime dùng URL không hợp lệ: `https-deno.com/server.ts`.
2. Các response thành công/lỗi không gắn CORS headers; chỉ OPTIONS response có CORS. Theo tài liệu Supabase, browser response cũng cần `Access-Control-Allow-Origin`.

Các trường hợp function chưa deploy, lỗi CORS hoặc không chạy được đều bị Supabase JS gom thành lỗi client “Failed to send a request to the Edge Function”.

Task không cho phép sửa/tạo Edge Function, nên frontend được sửa theo hướng graceful fallback.

## Facebook ID fix

- Facebook URL vẫn bắt buộc và được chuẩn hóa.
- Form vẫn thử tự động gọi resolver.
- Thành công: tự điền Facebook ID và chạy kiểm tra trùng.
- Resolver/API không khả dụng:
  - không hiển thị lỗi tiếng Anh thô;
  - hiển thị: “Không thể tự động tìm Facebook ID lúc này. Vui lòng nhập Facebook ID dạng số vào ô bên cạnh.”;
  - bật lại ô Facebook ID;
  - cho phép nhập thủ công;
  - không sinh ID giả.
- ID thủ công chỉ hợp lệ khi chứa chữ số.
- Ba trạng thái được phân biệt:
  - URL sai: “Link Facebook không hợp lệ…”
  - lookup không khả dụng: hướng dẫn nhập ID thủ công
  - ID trùng: “Facebook ID bị trùng trong biểu mẫu…”
- Kiểm tra trùng chạy khi ID hiện có là chuỗi số hợp lệ.

## Zalo và bill fix

- Nút “Gửi bill qua Zalo” vẫn là link `target="_blank"` đến contact đã cấu hình.
- Không có callback, timestamp, upload, hidden bill state hoặc điều kiện đã click Zalo.
- Mở Zalo không thay đổi/reset form.
- Checkbox bill là điều kiện frontend duy nhất liên quan tới bill.
- Checkbox đã tick được bỏ qua kiểm tra `value`; trước bugfix, logic kiểm tra trường rỗng có thể tiếp tục coi checkbox là chưa hợp lệ.
- Bill chưa xác nhận hiển thị đúng:
  - “Vui lòng xác nhận bạn đã gửi bill thanh toán qua Zalo hỗ trợ.”
- Xác nhận cuối chưa tick hiển thị đúng lỗi xác nhận thông tin.
- Mỗi lỗi validation gắn với field cụ thể, scroll tới field và focus field đầu tiên sai.

## Submission

RPC `submit_legacy_registration` hiện có không phải public pending-request integration:

- chỉ grant cho `authenticated`;
- trực tiếp insert Customer, Kiosk và Payment;
- do đó không phù hợp với trang public và vi phạm yêu cầu không tạo Active Kiosk/Completed Payment.

Trang không gọi RPC này.

Khi toàn bộ field và hai checkbox hợp lệ, form tiếp tục tới bước submission và hiển thị lỗi backend riêng:

> Không thể gửi yêu cầu: backend tiếp nhận công khai cho khách hàng cũ hiện chưa khả dụng. Không có dữ liệu nào được tạo. Vui lòng thử lại sau hoặc liên hệ Ban quản trị.

Lỗi backend không bị hiển thị thành cảnh báo Zalo/bill. Submit button được khóa trong lúc submit và luôn bật lại trong `finally` khi thất bại.

## Kiểm thử

Đã chạy test harness tạm thời, không để lại file test trong repository:

- Facebook lookup success → chuẩn hóa URL và tự điền ID: đạt.
- Facebook lookup failure → bật nhập thủ công và thông báo tiếng Việt: đạt.
- Nhập ID thủ công dạng số sau lookup failure: đạt.
- URL Facebook không hợp lệ: đạt.
- ID thủ công chứa ký tự không phải số: bị chặn đúng field: đạt.
- Bill chưa tick: lỗi đúng checkbox và focus checkbox: đạt.
- Bill đã tick + xác nhận cuối đã tick + các field hợp lệ: validation tiếp tục: đạt.
- Backend public không có: lỗi backend riêng, không phải lỗi Zalo: đạt qua kiểm tra control flow/source.
- Zalo mở tab mới và không có handler sửa/reset form: đạt qua kiểm tra markup/control flow.
- Public route không login: route `#/legacy-registration` vẫn được `src/app.js` xử lý bằng public shell trước auth; không thay đổi trong bugfix này.
- `node --check src/pages/LegacyRegistrationPage.js`: đạt.
- `git diff --check`: đạt.

Browser runtime của phiên làm việc không có browser khả dụng (`[]`), nên không thể chạy lại các thao tác end-to-end bằng browser thật. Các ca validation và resolver nêu trên được chạy bằng DOM mock trực tiếp trên chính các hàm của trang.

## Git diff --stat

Repository đã có thay đổi chưa commit từ trước; diff stat toàn worktree không đại diện riêng bugfix này. File mã nguồn duy nhất được sửa trong bugfix là:

```text
src/pages/LegacyRegistrationPage.js
```

Ngoài ra tạo:

```text
TASK_LEGACY_FORM_BUGFIX_REPORT.md
```
