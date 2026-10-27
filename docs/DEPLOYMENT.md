# Triển khai Vercel và Supabase

Production hiện dùng Vercel cho frontend và các API trong `api/`; Supabase cung cấp Auth, PostgreSQL, RPC/RLS, Storage và Edge Functions. Repository không dùng GitHub Pages như một đường triển khai hiện hành.

## Yêu cầu

- Node.js 22 trở lên.
- Một Vercel project trỏ đúng repository và root directory.
- Supabase CLI đã đăng nhập/link đúng project khi cần triển khai migration hoặc Edge Function.
- Biến môi trường được cấu hình riêng cho Development, Preview và Production theo chính sách của dự án.

## Biến môi trường

Chỉ các tên dưới đây được xác nhận từ source hiện hành:

### Frontend build

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

`npm run build` ghi hai giá trị công khai này vào `config.js`. Anon key chịu RLS và không thay thế service-role key.

### Vercel Serverless Functions

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_KEY` — tên fallback tương thích trong PayOS utility; ưu tiên tên service-role ở trên.
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PUBLIC_RENEWAL_TOKEN_SECRET`
- `APP_BASE_URL` — tùy chọn, dùng để giới hạn base URL hợp lệ cho luồng gia hạn công khai.
- `VERCEL_URL` — Vercel cung cấp trong môi trường triển khai và được source dùng làm fallback URL.

`PUBLIC_RENEWAL_TOKEN_SECRET` phải là secret server-side đủ mạnh theo validation của source. Không đưa các service/PayOS/renewal secret vào frontend hoặc commit vào Git.

### Supabase Edge Functions

- Các Supabase secret chuẩn cần cho function đang triển khai.
- `SUPABASE_SERVICE_ROLE_KEY` hoặc `SUPABASE_SECRET_KEY` theo contract của `manage-staff`.

Không sao chép mù quáng `.env.deploy.example`: file mẫu cũ có thể chứa tên biến của tính năng đã ngừng dùng. Luôn đối chiếu tên với source trước khi cấu hình.

## Build và Vercel

`vercel.json` hiện quy định:

- Build command: `npm run build`.
- Output directory: `.`.
- Rewrite tương thích: `/api/staff` sang `/api/user-management?compat=staff`.
- Header no-store để tránh cache dữ liệu ứng dụng/API không phù hợp.

Quy trình phát hành an toàn:

1. Cài dependency bằng `npm install` hoặc quy trình lockfile đã được đội dự án phê duyệt.
2. Cấu hình biến môi trường cho Preview.
3. Chạy `npm test`.
4. Chạy `npm run build` với `SUPABASE_URL` và `SUPABASE_ANON_KEY` hợp lệ.
5. Tạo Vercel Preview Deployment qua integration hiện hành.
6. Smoke-test route công khai, đăng nhập, quyền CRM và các endpoint liên quan; không tạo thanh toán thật khi chỉ kiểm thử.
7. Chỉ promote/deploy Production sau khi Preview được duyệt và migration cần thiết đã được xử lý theo đúng thứ tự.

Local static server không mô phỏng đầy đủ `api/`. Dùng:

```bash
npx vercel dev
```

Endpoint `/api/facebook-id` là Vercel Function cùng domain. Source hiện có thể thử nhiều nguồn phân giải và vẫn cho phép nhập ID thủ công khi không phân giải được; không phụ thuộc riêng một provider như tài liệu cũ từng mô tả.

## Supabase migration workflow

1. Không sửa migration đã có trong lịch sử.
2. Tạo migration timestamp mới cho thay đổi schema/RPC/RLS.
3. Link CLI vào đúng project và kiểm tra danh sách:

   ```bash
   npx supabase migration list
   ```

4. Review migration theo thứ tự, kiểm tra grants/RLS và chạy test trên môi trường không phải Production.
5. Khi đã được phê duyệt, áp dụng bằng workflow chuẩn của dự án, thường là:

   ```bash
   npx supabase db push
   ```

6. Đối chiếu migration list và smoke-test các RPC/RLS bị ảnh hưởng.

Không chạy SQL thủ công trên Production để “sửa nhanh” rồi bỏ qua migration history.

## Supabase Edge Functions

Repository có `manage-staff` và `resolve-facebook-id`. Chỉ deploy function thực sự thay đổi và kiểm tra cấu hình JWT trong `supabase/config.toml`; `manage-staff` hiện bật `verify_jwt = true`.

Ví dụ lệnh triển khai có chủ đích:

```bash
npx supabase functions deploy <function-name>
```

Không deploy toàn bộ function theo thói quen nếu release không thay đổi chúng.

## Kiểm tra trước khi phát hành

```bash
npm test
npm run build
git diff --check
git status --short
```

Ngoài kết quả lệnh, cần kiểm tra:

- `config.js` chỉ chứa cấu hình Supabase công khai.
- `.env.local`, `config.local.js`, `.vercel/` và secret không được đưa vào Git.
- Vercel Preview gọi được các route trong `api/`.
- Migration list local/remote khớp với kế hoạch release.
- RLS/RPC được kiểm thử bằng tài khoản đúng nhóm quyền.
- Webhook PayOS chỉ được kiểm tra bằng quy trình an toàn, không giả lập ghi dữ liệu Production ngoài kế hoạch.

## Rollback an toàn

- Ứng dụng/Vercel: redeploy hoặc promote lại deployment ổn định trước đó sau khi xác nhận biến môi trường tương thích.
- Database: ưu tiên migration sửa tiến (forward-fix). Không xóa/sửa migration đã áp dụng và không rewrite history.
- Nếu cần phục hồi dữ liệu, dùng backup/PITR và quy trình được chủ project/Supabase project cho phép; không tự dùng SQL dump không rõ trạng thái.
- PayOS: nếu lỗi liên quan webhook/secret, cô lập release, khôi phục deployment ổn định và xác minh cấu hình trước khi nhận lại traffic. Không sửa trạng thái payment trực tiếp để mô phỏng rollback.

Rollback frontend không tự động rollback database; phải kiểm tra tính tương thích giữa deployment được khôi phục và schema hiện tại.
