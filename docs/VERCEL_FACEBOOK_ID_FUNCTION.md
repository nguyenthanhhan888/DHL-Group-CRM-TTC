# Vercel Function lấy Facebook ID

## Tổng quan

CRM dùng endpoint cùng domain:

```text
POST /api/facebook-id
```

Frontend chỉ gửi Facebook URL đến endpoint này. Vercel Function gọi server-side đến:

```text
https://id.traodoisub.com/api.php
```

Browser không gọi trực tiếp Traodoisub. Việc lấy ID chỉ điền ô Facebook ID; form không tự lưu hoặc tự đăng ký.

## File đã thêm

- `api/facebook-id.js`: Vercel Function.
- `src/services/FacebookIdService.js`: client gọi endpoint cùng domain.
- `src/components/FacebookIdResolver.js`: UI dùng chung cho URL, ID, loading, lỗi và thử lại.
- `tests/facebook-id.test.cjs`: test backend.
- `tests/facebook-id-ui.test.mjs`: test loading, retry, nhập tay và double-click.
- `docs/VERCEL_FACEBOOK_ID_FUNCTION.md`: tài liệu này.

## Form đã sửa

- Public registration:
  - Kiosk chính.
  - Các kiosk bổ sung.
- Legacy registration:
  - Thông tin khách hàng/người liên hệ.
  - Một kiosk hoặc từng kiosk trong chế độ nhiều kiosk.
- Create customer.
- Create kiosk.
- Edit kiosk.

Admin vẫn có thể nhập hoặc sửa Facebook ID thủ công nếu dịch vụ ngoài không hoạt động.

## API contract

### Input

```json
{
  "facebook_url": "https://www.facebook.com/..."
}
```

### Thành công

```json
{
  "success": true,
  "facebook_id": "1000123456789",
  "facebook_url": "https://www.facebook.com/..."
}
```

### Thất bại

```json
{
  "success": false,
  "code": "FACEBOOK_ID_NOT_FOUND",
  "message": "Không tìm thấy Facebook ID từ URL này. Bạn có thể thử lại hoặc nhập ID thủ công."
}
```

Các mã lỗi chính:

- `METHOD_NOT_ALLOWED`
- `INVALID_JSON`
- `FACEBOOK_URL_REQUIRED`
- `INVALID_URL`
- `INVALID_FACEBOOK_DOMAIN`
- `UPSTREAM_HTTP_ERROR`
- `UPSTREAM_INVALID_JSON`
- `FACEBOOK_ID_NOT_FOUND`
- `UPSTREAM_TIMEOUT`
- `UPSTREAM_REQUEST_FAILED`

Function chỉ chấp nhận `POST`, chỉ chấp nhận HTTP/HTTPS trên `facebook.com`, subdomain của `facebook.com`, `fb.com` hoặc subdomain của `fb.com`. Request đến upstream dùng `application/x-www-form-urlencoded`, timeout sau 10 giây và không retry.

Function không ghi Facebook URL, Facebook ID hoặc response upstream vào log.

## Chạy local

Python static server hoặc VS Code Live Server không chạy thư mục `api/` như Vercel Function. Để kiểm tra đầy đủ frontend và `/api/facebook-id`, dùng Vercel CLI:

```bash
npx vercel dev
```

Mở URL Vercel CLI hiển thị, thường là:

```text
http://localhost:3000
```

Test endpoint:

```bash
curl -X POST http://localhost:3000/api/facebook-id \
  -H 'Content-Type: application/json' \
  --data '{"facebook_url":"https://www.facebook.com/profile.php?id=100067917442253"}'
```

Chạy test tự động:

```bash
node --test tests/facebook-id.test.cjs
node --experimental-default-type=module --test tests/facebook-id-ui.test.mjs
```

## Test trên Vercel

Sau khi tạo Preview Deployment:

```bash
curl -X POST https://TEN-PREVIEW.vercel.app/api/facebook-id \
  -H 'Content-Type: application/json' \
  --data '{"facebook_url":"https://www.facebook.com/..."}'
```

Kiểm tra thủ công:

1. Mở từng form trong danh sách trên.
2. Nhập Facebook URL.
3. Bấm **Lấy Facebook ID**.
4. Xác nhận nút chuyển sang trạng thái loading.
5. Xác nhận ID được điền nhưng form chưa được lưu.
6. Bấm nhanh hai lần và kiểm tra chỉ có một request trong Network.
7. Thử URL sai domain và URL Facebook không phân giải được.
8. Khi có lỗi, xác nhận nút đổi thành **Thử lại** và ô ID vẫn nhập tay được.
9. Bấm nút Lưu/Đăng ký riêng để xác nhận luồng form cũ vẫn hoạt động.

## Lỗi có thể gặp

### `FACEBOOK_ID_NOT_FOUND`

Traodoisub không phân giải được URL, thường gặp với URL share tạm thời, nội dung riêng tư hoặc URL không còn tồn tại. Thử URL profile/page đầy đủ hoặc nhập ID thủ công nếu là admin.

### `UPSTREAM_TIMEOUT`

Traodoisub không trả lời trong 10 giây. Có thể bấm **Thử lại**; Function không tự retry.

### `UPSTREAM_HTTP_ERROR` / `UPSTREAM_REQUEST_FAILED`

Dịch vụ ngoài đang lỗi, chặn request từ datacenter hoặc mất kết nối. Không ảnh hưởng thao tác khác của CRM.

### Local trả 404 cho `/api/facebook-id`

Đang dùng static server. Chuyển sang `npx vercel dev`.

## Rollback

Không có thay đổi Supabase schema hoặc dữ liệu.

Để rollback:

1. Xóa `api/facebook-id.js`.
2. Xóa `src/services/FacebookIdService.js`.
3. Xóa `src/components/FacebookIdResolver.js`.
4. Hoàn tác các import, markup và binding resolver trong năm nhóm form đã liệt kê.
5. Hoàn tác CSS `.facebook-id-*` trong `src/styles/app.css`.
6. Redeploy phiên bản Vercel trước đó.

Các form lưu dữ liệu vẫn dùng nút submit cũ và service CRM cũ; resolver không sở hữu thao tác lưu.
