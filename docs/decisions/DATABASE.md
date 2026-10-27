# Schema contract tương thích cho test

Tài liệu chính về database nằm tại [../DATABASE.md](../DATABASE.md). File này được giữ vì test `tests/registration-request-column-hotfix.test.cjs` đọc trực tiếp đường dẫn hiện tại; không dùng nó như một bản mô tả database độc lập.

### `registration_requests`

Các mốc audit của contract hiện hành gồm `submitted_at`, `reviewed_at`. Schema không định nghĩa một mốc cập nhật tổng quát cho bảng này; migration hotfix sửa các function lịch sử ghi sai thay vì thêm cột mới.

## Tài liệu chính

Xem [Database, RPC và phân quyền](../DATABASE.md) để có mô tả hiện hành đầy đủ.
